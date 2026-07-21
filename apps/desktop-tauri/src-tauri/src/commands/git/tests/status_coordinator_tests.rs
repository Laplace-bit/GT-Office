use crate::commands::git::status_coordinator::{
    is_not_git_repository_error, GitStatusCoordinator, GitStatusSnapshot,
};
use gt_abstractions::{GitRepositorySummary, GitStatusFile, GitStatusSummary};

fn sample_summary() -> GitStatusSummary {
    let file = GitStatusFile {
        path: "src/main.rs".to_string(),
        staged: false,
        status: "modified".to_string(),
        repository_path: "/repo".to_string(),
        repo_relative_path: "src/main.rs".to_string(),
        content_signature: "12:34".to_string(),
        entry_kind: Default::default(),
        head_oid: None,
        expected_head_oid: None,
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
            total_changes: 1,
            ..GitRepositorySummary::default()
        }],
        total_changes: 1,
        ..GitStatusSummary::default()
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
    assert_eq!(payload.total_changes, 1);
    assert!(!payload.truncated);
    assert_eq!(payload.kind, Default::default());
    assert_eq!(payload.state, Default::default());
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
    assert_eq!(payload.total_changes, 0);
    assert!(!payload.truncated);
    assert!(payload.head_oid.is_none());
    assert!(payload.expected_head_oid.is_none());
    assert_eq!(payload.revision, 3);
}

#[test]
fn git_status_snapshot_uses_total_changes_for_truncated_dirty_state() {
    let mut summary = sample_summary();
    summary.files.clear();
    summary.total_changes = 8;
    summary.truncated = true;

    let payload = GitStatusSnapshot::Available(summary).into_payload("ws-3".into(), 5);

    assert!(payload.dirty);
    assert_eq!(payload.total_changes, 8);
    assert!(payload.truncated);
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

#[test]
fn git_status_coordinator_coalesces_immediate_requests_into_one_worker() {
    let coordinator = GitStatusCoordinator::default();
    coordinator
        .activate("ws-1")
        .expect("workspace should activate");

    assert!(coordinator.request_for_test("ws-1", false));
    assert!(!coordinator.request_for_test("ws-1", true));
    assert_eq!(coordinator.worker_slots_for_test("ws-1"), 1);
}

#[test]
fn git_status_coordinator_deactivation_rejects_stale_requests_and_reactivation_changes_generation()
{
    let coordinator = GitStatusCoordinator::default();
    let first_generation = coordinator
        .activate("ws-1")
        .expect("workspace should activate");
    assert!(coordinator.is_active("ws-1"));

    coordinator
        .deactivate("ws-1")
        .expect("workspace should deactivate");
    assert!(!coordinator.is_active("ws-1"));
    assert!(!coordinator.request_for_test("ws-1", true));
    assert_eq!(coordinator.worker_slots_for_test("ws-1"), 0);

    let second_generation = coordinator
        .activate("ws-1")
        .expect("workspace should reactivate");
    assert_ne!(first_generation, second_generation);
    assert!(coordinator.request_for_test("ws-1", true));
}
