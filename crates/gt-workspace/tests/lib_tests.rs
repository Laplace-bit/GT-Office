use serde_json::json;
use std::{fs, path::PathBuf};
use uuid::Uuid;
use gt_abstractions::{TerminalCwdMode, WorkspaceService};
use gt_workspace::InMemoryWorkspaceService;

struct TempWorkspaceDir {
    path: PathBuf,
}

impl TempWorkspaceDir {
    fn create() -> Self {
        let path = std::env::temp_dir().join(format!("gtoffice-ws-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("failed to create temporary workspace directory");
        Self { path }
    }
}

impl Drop for TempWorkspaceDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn open_then_list_returns_workspace() {
    let tmp = TempWorkspaceDir::create();
    let service = InMemoryWorkspaceService::new();

    let opened = service.open(&tmp.path).expect("open workspace");
    let listed = service.list().expect("list workspaces");

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].workspace_id, opened.workspace_id);
    assert!(listed[0].active);
}

#[test]
fn open_same_directory_is_deduplicated() {
    let tmp = TempWorkspaceDir::create();
    let service = InMemoryWorkspaceService::new();

    let first = service.open(&tmp.path).expect("first open");
    let nested = tmp.path.join(".");
    let second = service.open(&nested).expect("second open");

    assert_eq!(first.workspace_id, second.workspace_id);
    assert_eq!(service.list().expect("list").len(), 1);
}

#[test]
fn open_same_directory_across_service_instances_keeps_stable_workspace_id() {
    let tmp = TempWorkspaceDir::create();
    let first_service = InMemoryWorkspaceService::new();
    let second_service = InMemoryWorkspaceService::new();

    let first = first_service.open(&tmp.path).expect("first open");
    let second = second_service.open(&tmp.path).expect("second open");

    assert_eq!(first.workspace_id, second.workspace_id);
}

#[test]
fn get_context_returns_workspace_root_default_cwd() {
    let tmp = TempWorkspaceDir::create();
    let service = InMemoryWorkspaceService::new();
    let opened = service.open(&tmp.path).expect("open workspace");

    let context = service
        .get_context(&opened.workspace_id)
        .expect("get context");
    assert_eq!(context.workspace_id, opened.workspace_id);
    assert_eq!(context.terminal_default_cwd, TerminalCwdMode::WorkspaceRoot);
    assert!(!context.root.is_empty());
}

#[test]
fn restore_session_returns_default_when_snapshot_file_missing() {
    let tmp = TempWorkspaceDir::create();
    let service = InMemoryWorkspaceService::new();
    let opened = service.open(&tmp.path).expect("open workspace");

    let snapshot = service
        .restore_session(&opened.workspace_id)
        .expect("restore session");
    assert!(snapshot.windows.is_empty());
    assert!(snapshot.tabs.is_empty());
    assert!(snapshot.terminals.is_empty());
}

#[test]
fn restore_session_reads_snapshot_from_workspace_file() {
    let tmp = TempWorkspaceDir::create();
    let service = InMemoryWorkspaceService::new();
    let opened = service.open(&tmp.path).expect("open workspace");

    let snapshot_path = tmp.path.join(".gtoffice/session.snapshot.json");
    fs::create_dir_all(
        snapshot_path
            .parent()
            .expect("snapshot file parent directory"),
    )
    .expect("create .gtoffice directory");
    fs::write(
        &snapshot_path,
        serde_json::to_string_pretty(&json!({
            "version": 1,
            "updatedAtMs": 1739350400000u64,
            "windows": [{ "activeNavId": "files" }],
            "tabs": [{ "path": "README.md", "active": true }],
            "terminals": [{ "stationId": "agent-01", "cwdMode": "custom", "resolvedCwd": "/tmp/repo" }]
        }))
        .expect("serialize snapshot"),
    )
    .expect("write snapshot");

    let snapshot = service
        .restore_session(&opened.workspace_id)
        .expect("restore session");
    assert_eq!(snapshot.windows.len(), 1);
    assert_eq!(snapshot.tabs.len(), 1);
    assert_eq!(snapshot.terminals.len(), 1);
    assert_eq!(snapshot.tabs[0]["path"], "README.md");
}

#[test]
fn restore_session_ignores_invalid_snapshot_payload() {
    let tmp = TempWorkspaceDir::create();
    let service = InMemoryWorkspaceService::new();
    let opened = service.open(&tmp.path).expect("open workspace");

    let snapshot_path = tmp.path.join(".gtoffice/session.snapshot.json");
    fs::create_dir_all(
        snapshot_path
            .parent()
            .expect("snapshot file parent directory"),
    )
    .expect("create .gtoffice directory");
    fs::write(&snapshot_path, "this-is-not-json").expect("write invalid snapshot");

    let snapshot = service
        .restore_session(&opened.workspace_id)
        .expect("restore session");
    assert!(snapshot.windows.is_empty());
    assert!(snapshot.tabs.is_empty());
    assert!(snapshot.terminals.is_empty());
}
