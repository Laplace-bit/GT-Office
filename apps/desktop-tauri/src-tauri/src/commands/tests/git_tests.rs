use gt_abstractions::{
    ConflictFile, ConflictStatus, GitStatusFile, GitStatusSummary, MergeResult, MergeState,
    WorkspaceId,
};
use gt_git::{
    GitBranchEntry, GitCommitDetail, GitCommitEntry, GitFetchResult, GitPullResult, GitPushResult,
    GitStashEntry, GitTagEntry,
};
use serde_json::{json, Value};

use crate::commands::git::{
    build_git_branches_payload, build_git_commit_detail_payload, build_git_diff_payload,
    build_git_discard_payload, build_git_log_payload, build_git_stage_payload,
    build_git_stash_list_payload, build_git_status_payload, build_git_submodule_update_payload,
    build_git_tag_list_payload, build_git_unstage_payload,
};

fn build_git_fetch_payload(workspace_id: &WorkspaceId, result: GitFetchResult) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "remote": result.remote,
        "prune": result.prune,
        "includeTags": result.include_tags,
        "queued": true
    })
}

fn build_git_pull_payload(workspace_id: &WorkspaceId, result: GitPullResult) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "remote": result.remote,
        "branch": result.branch,
        "rebase": result.rebase,
        "queued": true
    })
}

fn build_git_push_payload(workspace_id: &WorkspaceId, result: GitPushResult) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "remote": result.remote,
        "branch": result.branch,
        "setUpstream": result.set_upstream,
        "forceWithLease": result.force_with_lease,
        "queued": true
    })
}

fn build_git_tag_push_payload(
    workspace_id: &WorkspaceId,
    remote: Option<String>,
    name: String,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "remote": remote,
        "name": name,
        "queued": true
    })
}

fn build_git_merge_payload(workspace_id: &WorkspaceId, result: MergeResult) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "success": result.success,
        "conflicts": result.conflicts,
        "mergedCommit": result.merged_commit,
    })
}

fn build_git_merge_continue_payload(workspace_id: &WorkspaceId, merged_commit: String) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "mergedCommit": merged_commit,
    })
}

fn build_git_merge_abort_payload(workspace_id: &WorkspaceId) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "aborted": true,
    })
}

fn build_git_conflict_list_payload(
    workspace_id: &WorkspaceId,
    conflicts: Vec<ConflictFile>,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "conflicts": conflicts,
    })
}

fn build_git_merge_state_payload(workspace_id: &WorkspaceId, state: MergeState) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "inProgress": state.in_progress,
        "conflicts": state.conflicts,
    })
}

fn build_git_conflict_resolve_payload(
    workspace_id: &WorkspaceId,
    path: String,
    side: String,
    conflicts: Vec<ConflictFile>,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "path": path,
        "side": side,
        "conflicts": conflicts,
    })
}

#[test]
fn git_status_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let summary = GitStatusSummary {
        primary_repository_path: String::new(),
        branch: "main".to_string(),
        ahead: 2,
        behind: 1,
        files: vec![GitStatusFile {
            path: "src/main.rs".to_string(),
            staged: false,
            status: "M".to_string(),
            repository_path: String::new(),
            repo_relative_path: "src/main.rs".to_string(),
            content_signature: "12:34".to_string(),
            entry_kind: Default::default(),
            head_oid: None,
            expected_head_oid: None,
        }],
        repositories: Vec::new(),
        total_changes: 1,
        truncated: false,
        ..GitStatusSummary::default()
    };

    let payload = build_git_status_payload(&workspace_id, &summary);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["branch"], "main");
    assert_eq!(payload["ahead"], 2);
    assert_eq!(payload["behind"], 1);
    assert_eq!(payload["files"][0]["path"], "src/main.rs");
    assert_eq!(payload["files"][0]["staged"], false);
    assert_eq!(payload["files"][0]["status"], "M");
    assert_eq!(payload["totalChanges"], 1);
    assert_eq!(payload["truncated"], false);
    assert_eq!(payload["kind"], "root");
    assert_eq!(payload["state"], "ready");
}

#[test]
fn git_submodule_update_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_submodule_update_payload(&workspace_id, "modules/child", true);

    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["repositoryPath"], "modules/child");
    assert_eq!(payload["recursive"], true);
    assert_eq!(payload["initialized"], true);
}

#[test]
fn git_diff_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_diff_payload(&workspace_id, "README.md", "diff --git");
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["path"], "README.md");
    assert_eq!(payload["patch"], "diff --git");
}

#[test]
fn git_stage_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_stage_payload(&workspace_id, 3);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["staged"], 3);
}

#[test]
fn git_stage_payload_supports_zero_staged_files() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_stage_payload(&workspace_id, 0);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["staged"], 0);
}

#[test]
fn git_unstage_and_discard_payload_keep_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let unstage_payload = build_git_unstage_payload(&workspace_id, 2);
    let discard_payload = build_git_discard_payload(&workspace_id, 1);
    assert_eq!(unstage_payload["unstaged"], 2);
    assert_eq!(discard_payload["discarded"], 1);
}

#[test]
fn git_log_branches_stash_payloads_keep_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let log_payload = build_git_log_payload(
        &workspace_id,
        vec![GitCommitEntry {
            commit: "123456".to_string(),
            short_commit: "123456".to_string(),
            parents: vec!["000001".to_string()],
            refs: vec!["HEAD -> main".to_string(), "origin/main".to_string()],
            author_name: "bot".to_string(),
            author_email: "bot@example.com".to_string(),
            authored_at: "2026-01-01T00:00:00Z".to_string(),
            summary: "feat: x".to_string(),
        }],
    );

    let branch_payload = build_git_branches_payload(
        &workspace_id,
        vec![GitBranchEntry {
            name: "main".to_string(),
            current: true,
            upstream: Some("origin/main".to_string()),
            tracking: Some("=".to_string()),
            commit: "abcdef".to_string(),
            summary: "feat: x".to_string(),
        }],
    );

    let stash_payload = build_git_stash_list_payload(
        &workspace_id,
        vec![GitStashEntry {
            stash: "stash@{0}".to_string(),
            commit: "abcdef".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            summary: "WIP".to_string(),
        }],
    );

    assert_eq!(log_payload["entries"][0]["summary"], "feat: x");
    assert_eq!(log_payload["entries"][0]["parents"][0], "000001");
    assert_eq!(log_payload["entries"][0]["refs"][0], "HEAD -> main");
    assert_eq!(branch_payload["branches"][0]["name"], "main");
    assert_eq!(stash_payload["entries"][0]["stash"], "stash@{0}");
}

#[test]
fn git_commit_detail_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_commit_detail_payload(
        &workspace_id,
        GitCommitDetail {
            commit: "1234567890abcdef".to_string(),
            short_commit: "1234567".to_string(),
            parents: vec!["1111111".to_string()],
            refs: vec!["HEAD -> main".to_string()],
            author_name: "bot".to_string(),
            author_email: "bot@example.com".to_string(),
            authored_at: "2026-01-01T00:00:00Z".to_string(),
            summary: "feat: detail".to_string(),
            body: "body".to_string(),
            files: vec![],
        },
    );

    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["shortCommit"], "1234567");
    assert_eq!(payload["summary"], "feat: detail");
    assert_eq!(payload["refs"][0], "HEAD -> main");
}

#[test]
fn git_fetch_pull_push_payloads_keep_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");

    let fetch_payload = build_git_fetch_payload(
        &workspace_id,
        GitFetchResult {
            remote: "origin".to_string(),
            prune: true,
            include_tags: true,
        },
    );
    assert_eq!(fetch_payload["queued"], true);
    assert_eq!(fetch_payload["includeTags"], true);

    let pull_payload = build_git_pull_payload(
        &workspace_id,
        GitPullResult {
            remote: "origin".to_string(),
            branch: Some("main".to_string()),
            rebase: false,
        },
    );
    assert_eq!(pull_payload["queued"], true);
    assert_eq!(pull_payload["branch"], "main");

    let push_payload = build_git_push_payload(
        &workspace_id,
        GitPushResult {
            remote: "origin".to_string(),
            branch: Some("main".to_string()),
            set_upstream: true,
            force_with_lease: false,
        },
    );
    assert_eq!(push_payload["queued"], true);
    assert_eq!(push_payload["setUpstream"], true);
}

#[test]
fn git_merge_payloads_keep_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");

    let merge_payload = build_git_merge_payload(
        &workspace_id,
        MergeResult {
            success: false,
            conflicts: vec![ConflictFile {
                path: "src/conflicted.rs".to_string(),
                status: ConflictStatus::BothModified,
            }],
            merged_commit: None,
        },
    );
    assert_eq!(merge_payload["workspaceId"], "ws-1");
    assert_eq!(merge_payload["success"], false);
    assert_eq!(merge_payload["conflicts"][0]["path"], "src/conflicted.rs");
    assert_eq!(merge_payload["conflicts"][0]["status"], "both_modified");
    assert!(merge_payload["mergedCommit"].is_null());

    let continue_payload =
        build_git_merge_continue_payload(&workspace_id, "abc123def456".to_string());
    assert_eq!(continue_payload["workspaceId"], "ws-1");
    assert_eq!(continue_payload["mergedCommit"], "abc123def456");

    let abort_payload = build_git_merge_abort_payload(&workspace_id);
    assert_eq!(abort_payload["workspaceId"], "ws-1");
    assert_eq!(abort_payload["aborted"], true);

    let conflict_list_payload = build_git_conflict_list_payload(
        &workspace_id,
        vec![ConflictFile {
            path: "src/deleted.txt".to_string(),
            status: ConflictStatus::DeletedByThem,
        }],
    );
    assert_eq!(conflict_list_payload["workspaceId"], "ws-1");
    assert_eq!(
        conflict_list_payload["conflicts"][0]["status"],
        "deleted_by_them"
    );

    let merge_state_payload = build_git_merge_state_payload(
        &workspace_id,
        MergeState {
            in_progress: true,
            conflicts: vec![ConflictFile {
                path: "src/resolved-later.rs".to_string(),
                status: ConflictStatus::AddedByUs,
            }],
        },
    );
    assert_eq!(merge_state_payload["workspaceId"], "ws-1");
    assert_eq!(merge_state_payload["inProgress"], true);
    assert_eq!(merge_state_payload["conflicts"][0]["status"], "added_by_us");
}

#[test]
fn git_conflict_payload_serializes_all_conflict_statuses() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_conflict_list_payload(
        &workspace_id,
        vec![
            ConflictFile {
                path: "both-modified.txt".to_string(),
                status: ConflictStatus::BothModified,
            },
            ConflictFile {
                path: "deleted-by-us.txt".to_string(),
                status: ConflictStatus::DeletedByUs,
            },
            ConflictFile {
                path: "deleted-by-them.txt".to_string(),
                status: ConflictStatus::DeletedByThem,
            },
            ConflictFile {
                path: "added-by-us.txt".to_string(),
                status: ConflictStatus::AddedByUs,
            },
            ConflictFile {
                path: "added-by-them.txt".to_string(),
                status: ConflictStatus::AddedByThem,
            },
            ConflictFile {
                path: "both-added.txt".to_string(),
                status: ConflictStatus::BothAdded,
            },
            ConflictFile {
                path: "both-deleted.txt".to_string(),
                status: ConflictStatus::BothDeleted,
            },
        ],
    );

    let statuses = payload["conflicts"]
        .as_array()
        .expect("conflicts should be an array")
        .iter()
        .map(|conflict| {
            conflict["status"]
                .as_str()
                .expect("status should be string")
        })
        .collect::<Vec<_>>();
    assert_eq!(
        statuses,
        vec![
            "both_modified",
            "deleted_by_us",
            "deleted_by_them",
            "added_by_us",
            "added_by_them",
            "both_added",
            "both_deleted",
        ]
    );
}

#[test]
fn git_conflict_resolve_payload_keeps_remaining_conflicts() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_conflict_resolve_payload(
        &workspace_id,
        "src/conflicted.rs".to_string(),
        "ours".to_string(),
        vec![ConflictFile {
            path: "src/other.rs".to_string(),
            status: ConflictStatus::BothModified,
        }],
    );

    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["path"], "src/conflicted.rs");
    assert_eq!(payload["side"], "ours");
    assert_eq!(payload["conflicts"][0]["path"], "src/other.rs");
}

#[test]
fn git_tag_push_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_tag_push_payload(
        &workspace_id,
        Some("origin".to_string()),
        "v1.2.3".to_string(),
    );

    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["remote"], "origin");
    assert_eq!(payload["name"], "v1.2.3");
    assert_eq!(payload["queued"], true);
}

#[test]
fn git_tag_list_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_tag_list_payload(
        &workspace_id,
        vec![GitTagEntry {
            name: "v1.0".to_string(),
            oid: "abc123def456".to_string(),
            target: "abc123".to_string(),
            tagger: Some("bot".to_string()),
            message: Some("Release 1.0".to_string()),
        }],
    );

    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["entries"][0]["name"], "v1.0");
    assert_eq!(payload["entries"][0]["oid"], "abc123def456");
    assert_eq!(payload["entries"][0]["target"], "abc123");
    assert_eq!(payload["entries"][0]["tagger"], "bot");
    assert_eq!(payload["entries"][0]["message"], "Release 1.0");
}

#[test]
fn git_tag_list_payload_handles_lightweight_tags() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_tag_list_payload(
        &workspace_id,
        vec![GitTagEntry {
            name: "v2.0".to_string(),
            oid: "def456".to_string(),
            target: "def456".to_string(),
            tagger: None,
            message: None,
        }],
    );

    assert_eq!(payload["entries"][0]["name"], "v2.0");
    assert!(payload["entries"][0]["tagger"].is_null());
    assert!(payload["entries"][0]["message"].is_null());
}
