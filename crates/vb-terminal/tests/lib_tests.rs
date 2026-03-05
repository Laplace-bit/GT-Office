use vb_terminal::{InMemoryTerminalProvider, PtyTerminalProvider, TerminalRuntimeEvent};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use vb_abstractions::{
    AbstractionError, AllowAllPolicyEvaluator, TerminalCreateRequest, TerminalCwdMode,
    TerminalProvider, WorkspaceService,
};
use vb_workspace::InMemoryWorkspaceService;

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn create(prefix: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock drift")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{prefix}-{now}"));
        fs::create_dir_all(&path).expect("failed to create temporary directory");
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn create_provider_with_workspace(
    workspace_path: &Path,
) -> (
    InMemoryWorkspaceService,
    InMemoryTerminalProvider<InMemoryWorkspaceService, AllowAllPolicyEvaluator>,
    String,
) {
    let workspace_service = InMemoryWorkspaceService::new();
    let workspace = workspace_service
        .open(workspace_path)
        .expect("open workspace");
    let provider =
        InMemoryTerminalProvider::new(workspace_service.clone(), AllowAllPolicyEvaluator);
    (
        workspace_service,
        provider,
        workspace.workspace_id.to_string(),
    )
}

fn normalize_test_path(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let raw = path.to_string_lossy();
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{stripped}"));
        }
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped.to_string());
        }
        if let Some(stripped) = raw.strip_prefix(r"\??\") {
            return PathBuf::from(stripped.to_string());
        }
    }
    path.to_path_buf()
}

#[test]
fn workspace_root_mode_resolves_to_workspace_root() {
    let workspace_dir = TempDir::create("gtoffice-terminal-ws");
    let (_workspace_service, provider, workspace_id) =
        create_provider_with_workspace(&workspace_dir.path);

    let session = provider
        .create_session(TerminalCreateRequest {
            workspace_id: workspace_id.into(),
            shell: None,
            cwd: None,
            cwd_mode: TerminalCwdMode::WorkspaceRoot,
            env: BTreeMap::new(),
        })
        .expect("create session");

    let expected = normalize_test_path(&workspace_dir.path.canonicalize().expect("canonical root"));
    assert_eq!(PathBuf::from(session.resolved_cwd), expected);
    assert!(provider.has_session(&session.session_id));
}

#[test]
fn custom_mode_resolves_relative_path_inside_workspace() {
    let workspace_dir = TempDir::create("gtoffice-terminal-ws");
    fs::create_dir_all(workspace_dir.path.join("src")).expect("create src directory");
    let (_workspace_service, provider, workspace_id) =
        create_provider_with_workspace(&workspace_dir.path);

    let session = provider
        .create_session(TerminalCreateRequest {
            workspace_id: workspace_id.into(),
            shell: Some("bash".to_string()),
            cwd: Some("src".to_string()),
            cwd_mode: TerminalCwdMode::Custom,
            env: BTreeMap::new(),
        })
        .expect("create session");

    let expected = normalize_test_path(&workspace_dir
        .path
        .join("src")
        .canonicalize()
        .expect("canonical src"));
    assert_eq!(PathBuf::from(session.resolved_cwd), expected);
}

#[test]
fn custom_mode_rejects_path_outside_workspace() {
    let workspace_dir = TempDir::create("gtoffice-terminal-ws");
    let outside_dir = TempDir::create("gtoffice-terminal-outside");
    let (_workspace_service, provider, workspace_id) =
        create_provider_with_workspace(&workspace_dir.path);

    let result = provider.create_session(TerminalCreateRequest {
        workspace_id: workspace_id.into(),
        shell: None,
        cwd: Some(outside_dir.path.to_string_lossy().to_string()),
        cwd_mode: TerminalCwdMode::Custom,
        env: BTreeMap::new(),
    });

    let error = result.expect_err("should reject outside cwd");
    match error {
        AbstractionError::AccessDenied { message } => {
            assert!(message.contains("TERMINAL_CWD_OUTSIDE_WORKSPACE"));
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[cfg(not(target_os = "windows"))]
#[test]
fn pty_provider_emits_output_event_after_write() {
    let workspace_dir = TempDir::create("gtoffice-terminal-pty-ws");
    let workspace_service = InMemoryWorkspaceService::new();
    let workspace = workspace_service
        .open(&workspace_dir.path)
        .expect("open workspace");
    let provider = PtyTerminalProvider::new(workspace_service, AllowAllPolicyEvaluator);
    let receiver = provider
        .take_event_receiver()
        .expect("take terminal event receiver");

    let session = provider
        .create_session(TerminalCreateRequest {
            workspace_id: workspace.workspace_id.clone(),
            shell: Some("/bin/bash".to_string()),
            cwd: None,
            cwd_mode: TerminalCwdMode::WorkspaceRoot,
            env: BTreeMap::new(),
        })
        .expect("create pty session");
    provider
        .set_session_visibility(&session.session_id, true)
        .expect("set session visible");

    provider
        .write_session(&session.session_id, "echo __VB_TERMINAL_EVENT_TEST__\n")
        .expect("write pty command");

    let mut observed_output = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
        let event = receiver
            .recv_timeout(Duration::from_millis(300))
            .expect("should receive runtime event");
        if let TerminalRuntimeEvent::Output(output) = event {
            observed_output.push_str(&String::from_utf8_lossy(&output.chunk));
            if observed_output.contains("__VB_TERMINAL_EVENT_TEST__") {
                break;
            }
        }
    }

    assert!(
        observed_output.contains("__VB_TERMINAL_EVENT_TEST__"),
        "terminal output did not include marker, got: {observed_output}"
    );

    let _ = provider.kill_session(&session.session_id);
}
