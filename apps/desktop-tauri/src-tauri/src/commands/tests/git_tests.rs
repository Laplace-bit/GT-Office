use super::{
    build_git_branches_payload, build_git_commit_detail_payload, build_git_commit_payload,
    build_git_diff_payload, build_git_discard_payload, build_git_fetch_payload,
    build_git_log_payload, build_git_pull_payload, build_git_push_payload, build_git_stage_payload,
    build_git_stash_list_payload, build_git_status_payload, build_git_unstage_payload,
};
use gt_abstractions::{GitStatusFile, GitStatusSummary, WorkspaceId};
use gt_git::{
    GitBranchEntry, GitCommitDetail, GitCommitEntry, GitFetchResult, GitPullResult, GitPushResult,
    GitStashEntry,
};

#[test]
fn git_status_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let summary = GitStatusSummary {
        branch: "main".to_string(),
        ahead: 2,
        behind: 1,
        files: vec![GitStatusFile {
            path: "src/main.rs".to_string(),
            staged: false,
            status: "M".to_string(),
        }],
    };

    let payload = build_git_status_payload(&workspace_id, &summary);
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["branch"], "main");
    assert_eq!(payload["ahead"], 2);
    assert_eq!(payload["behind"], 1);
    assert_eq!(payload["files"][0]["path"], "src/main.rs");
    assert_eq!(payload["files"][0]["staged"], false);
    assert_eq!(payload["files"][0]["status"], "M");
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
fn git_unstage_and_discard_payload_keep_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let unstage_payload = build_git_unstage_payload(&workspace_id, 2);
    let discard_payload = build_git_discard_payload(&workspace_id, 1);
    assert_eq!(unstage_payload["unstaged"], 2);
    assert_eq!(discard_payload["discarded"], 1);
}

#[test]
fn git_commit_payload_keeps_contract_fields() {
    let workspace_id = WorkspaceId::new("ws-1");
    let payload = build_git_commit_payload(&workspace_id, "feat: init", "abc123");
    assert_eq!(payload["workspaceId"], "ws-1");
    assert_eq!(payload["message"], "feat: init");
    assert_eq!(payload["commit"], "abc123");
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
    assert_eq!(fetch_payload["fetched"], true);
    assert_eq!(fetch_payload["includeTags"], true);

    let pull_payload = build_git_pull_payload(
        &workspace_id,
        GitPullResult {
            remote: "origin".to_string(),
            branch: Some("main".to_string()),
            rebase: false,
        },
    );
    assert_eq!(pull_payload["pulled"], true);
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
    assert_eq!(push_payload["pushed"], true);
    assert_eq!(push_payload["setUpstream"], true);
}
