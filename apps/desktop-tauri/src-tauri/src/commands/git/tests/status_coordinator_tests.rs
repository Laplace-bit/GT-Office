use crate::commands::git::status_coordinator::{is_not_git_repository_error, GitStatusSnapshot};
use gt_abstractions::{GitRepositorySummary, GitStatusFile, GitStatusSummary};

fn sample_summary() -> GitStatusSummary {
    let file = GitStatusFile {
        path: "src/main.rs".to_string(),
        staged: false,
        status: "modified".to_string(),
        repository_path: "/repo".to_string(),
        repo_relative_path: "src/main.rs".to_string(),
    };
    GitStatusSummary {
        primary_repository_path: "/repo".to_string(),
        branch: "main".to_string(),
        ahead: 2,
        behind: 1,
        files: vec![file.clone()],
        repositories: vec![GitRepositorySummary {
            repository_path: "/repo".to_string(),
            root: true,
            branch: "main".to_string(),
            ahead: 2,
            behind: 1,
            files: vec![file],
        }],
    }
}

#[test]
fn git_status_snapshot_payload_marks_available_dirty_and_revision() {
    let payload = GitStatusSnapshot::Available(sample_summary()).into_payload("ws-1".into(), 7);

    assert_eq!(payload.workspace_id, "ws-1");
    assert!(payload.available);
    assert_eq!(payload.primary_repository_path, "/repo");
    assert_eq!(payload.branch, "main");
    assert!(payload.dirty);
    assert_eq!(payload.ahead, 2);
    assert_eq!(payload.behind, 1);
    assert_eq!(payload.files.len(), 1);
    assert_eq!(payload.repositories.len(), 1);
    assert_eq!(payload.revision, 7);
}

#[test]
fn git_status_snapshot_payload_marks_unavailable_clean() {
    let payload = GitStatusSnapshot::Unavailable.into_payload("ws-2".into(), 3);

    assert_eq!(payload.workspace_id, "ws-2");
    assert!(!payload.available);
    assert_eq!(payload.primary_repository_path, "");
    assert_eq!(payload.branch, "");
    assert!(!payload.dirty);
    assert_eq!(payload.ahead, 0);
    assert_eq!(payload.behind, 0);
    assert!(payload.files.is_empty());
    assert!(payload.repositories.is_empty());
    assert_eq!(payload.revision, 3);
}

#[test]
fn git_status_snapshot_fingerprint_changes_with_status() {
    let clean = GitStatusSnapshot::Available(GitStatusSummary {
        files: Vec::new(),
        ..sample_summary()
    })
    .fingerprint();
    let dirty = GitStatusSnapshot::Available(sample_summary()).fingerprint();

    assert_ne!(clean, dirty);
    assert_eq!(GitStatusSnapshot::Unavailable.fingerprint(), "unavailable");
}

#[test]
fn not_git_repository_error_detection_matches_git_variants() {
    assert!(is_not_git_repository_error("GIT_REPO_INVALID: no repo"));
    assert!(is_not_git_repository_error("fatal: not a git repository"));
    assert!(is_not_git_repository_error(
        "this operation must be run in a work tree"
    ));
    assert!(!is_not_git_repository_error("permission denied"));
}
