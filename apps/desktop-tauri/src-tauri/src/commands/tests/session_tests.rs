use crate::commands::session::{home_dir, resolve_workspace_session_cwd_path};
use gt_changefeed::{GitStatusSnapshot, SessionActivityKind, SessionChangeFeed};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

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

#[test]
fn test_changefeed_query_empty() {
    let feed = SessionChangeFeed::new();
    assert!(feed.last_snapshot("ws1").is_none());
}

#[test]
fn test_changefeed_process_update() {
    let mut feed = SessionChangeFeed::new();
    let snapshot = GitStatusSnapshot {
        workspace_id: "ws1".to_string(),
        available: true,
        branch: "main".to_string(),
        dirty: false,
        ahead: 0,
        behind: 0,
        staged_files: 0,
        unstaged_files: 0,
        untracked_files: 0,
        revision: 1,
    };
    let items = feed.on_git_updated(&snapshot);
    assert!(items.is_empty());
    assert!(feed.last_snapshot("ws1").is_some());
}

#[test]
fn test_changefeed_branch_switch() {
    let mut feed = SessionChangeFeed::new();
    feed.on_git_updated(&GitStatusSnapshot {
        workspace_id: "ws1".to_string(),
        available: true,
        branch: "main".to_string(),
        dirty: false,
        ahead: 0,
        behind: 0,
        staged_files: 0,
        unstaged_files: 0,
        untracked_files: 0,
        revision: 1,
    });
    let items = feed.on_git_updated(&GitStatusSnapshot {
        workspace_id: "ws1".to_string(),
        available: true,
        branch: "feature".to_string(),
        dirty: false,
        ahead: 2,
        behind: 0,
        staged_files: 0,
        unstaged_files: 0,
        untracked_files: 0,
        revision: 2,
    });
    assert_eq!(items.len(), 2);
    assert!(items
        .iter()
        .any(|i| i.kind == SessionActivityKind::BranchSwitched));
    assert!(items
        .iter()
        .any(|i| i.kind == SessionActivityKind::NewCommits));
}

#[test]
fn test_home_dir_returns_path() {
    let path = home_dir();
    assert!(!path.as_os_str().is_empty());
}

#[test]
fn test_session_cwd_resolves_relative_path_inside_workspace() {
    let workspace = TempDir::create("gtoffice-session-ws");
    fs::create_dir_all(workspace.path.join("agents").join("alpha")).expect("create agent cwd");

    let resolved = resolve_workspace_session_cwd_path(&workspace.path, "agents/alpha")
        .expect("resolve session cwd");

    assert_eq!(
        resolved,
        fs::canonicalize(workspace.path.join("agents").join("alpha")).expect("canonical agent cwd")
    );
}

#[test]
fn test_session_cwd_rejects_path_outside_workspace() {
    let workspace = TempDir::create("gtoffice-session-ws");
    let outside = TempDir::create("gtoffice-session-outside");

    let error = resolve_workspace_session_cwd_path(
        &workspace.path,
        outside.path.to_string_lossy().as_ref(),
    )
    .expect_err("outside cwd should be rejected");

    assert!(error.contains("SESSION_CWD_OUTSIDE_WORKSPACE"));
}

#[test]
fn test_session_cwd_rejects_relative_traversal_outside_workspace() {
    let parent = TempDir::create("gtoffice-session-parent");
    let workspace_path = parent.path.join("workspace");
    let outside_path = parent.path.join("outside");
    fs::create_dir_all(&workspace_path).expect("create workspace");
    fs::create_dir_all(&outside_path).expect("create outside directory");

    let error = resolve_workspace_session_cwd_path(&workspace_path, "../outside")
        .expect_err("relative traversal outside workspace should be rejected");

    assert!(error.contains("SESSION_CWD_OUTSIDE_WORKSPACE"));
}

#[test]
fn test_session_cwd_rejects_empty_or_file_paths() {
    let workspace = TempDir::create("gtoffice-session-ws");
    let file_path = workspace.path.join("not-a-dir.txt");
    fs::write(&file_path, "content").expect("write file");

    let empty_error = resolve_workspace_session_cwd_path(&workspace.path, "  ")
        .expect_err("empty cwd should be rejected");
    assert!(empty_error.contains("SESSION_CWD_INVALID"));

    let file_error = resolve_workspace_session_cwd_path(&workspace.path, "not-a-dir.txt")
        .expect_err("file cwd should be rejected");
    assert!(file_error.contains("SESSION_CWD_INVALID"));
}
