use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use vb_abstractions::{GitStatusSummary, WorkspaceId};
use vb_git::{
    GitBranchEntry, GitCommitDetail, GitCommitEntry, GitFetchResult, GitPullResult,
    GitPushResult, GitStashEntry,
};

use crate::app_state::AppState;

fn to_command_error(error: impl ToString) -> String {
    error.to_string()
}

fn emit_git_updated(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
    branch: &str,
    dirty: bool,
) -> Result<(), String> {
    app.emit(
        "git/updated",
        json!({
            "workspaceId": workspace_id.as_str(),
            "branch": branch,
            "dirty": dirty,
        }),
    )
    .map_err(|error| format!("GIT_EVENT_EMIT_FAILED: {error}"))
}

fn emit_git_updated_from_service(
    app: &AppHandle,
    state: &State<'_, AppState>,
    workspace_id: &WorkspaceId,
) -> Result<(), String> {
    let summary = state
        .git_service
        .status(workspace_id)
        .map_err(to_command_error)?;
    emit_git_updated(
        app,
        workspace_id,
        &summary.branch,
        !summary.files.is_empty(),
    )
}

fn build_git_status_payload(workspace_id: &WorkspaceId, summary: &GitStatusSummary) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "branch": summary.branch,
        "ahead": summary.ahead,
        "behind": summary.behind,
        "files": summary.files
    })
}

fn build_git_diff_payload(workspace_id: &WorkspaceId, path: &str, patch: &str) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "path": path,
        "patch": patch
    })
}

fn build_git_stage_payload(workspace_id: &WorkspaceId, staged: usize) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "staged": staged
    })
}

fn build_git_unstage_payload(workspace_id: &WorkspaceId, unstaged: usize) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "unstaged": unstaged
    })
}

fn build_git_discard_payload(workspace_id: &WorkspaceId, discarded: usize) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "discarded": discarded
    })
}

fn build_git_commit_payload(workspace_id: &WorkspaceId, message: &str, commit_id: &str) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "message": message,
        "commit": commit_id
    })
}

fn build_git_log_payload(workspace_id: &WorkspaceId, entries: Vec<GitCommitEntry>) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "entries": entries
    })
}

fn build_git_commit_detail_payload(workspace_id: &WorkspaceId, detail: GitCommitDetail) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "commit": detail.commit,
        "shortCommit": detail.short_commit,
        "parents": detail.parents,
        "refs": detail.refs,
        "authorName": detail.author_name,
        "authorEmail": detail.author_email,
        "authoredAt": detail.authored_at,
        "summary": detail.summary,
        "body": detail.body,
        "files": detail.files
    })
}

fn build_git_branches_payload(workspace_id: &WorkspaceId, branches: Vec<GitBranchEntry>) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "branches": branches
    })
}

fn build_git_fetch_payload(workspace_id: &WorkspaceId, result: GitFetchResult) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "remote": result.remote,
        "prune": result.prune,
        "includeTags": result.include_tags,
        "fetched": true
    })
}

fn build_git_pull_payload(workspace_id: &WorkspaceId, result: GitPullResult) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "remote": result.remote,
        "branch": result.branch,
        "rebase": result.rebase,
        "pulled": true
    })
}

fn build_git_push_payload(workspace_id: &WorkspaceId, result: GitPushResult) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "remote": result.remote,
        "branch": result.branch,
        "setUpstream": result.set_upstream,
        "forceWithLease": result.force_with_lease,
        "pushed": true
    })
}

fn build_git_stash_list_payload(workspace_id: &WorkspaceId, entries: Vec<GitStashEntry>) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "entries": entries
    })
}

#[tauri::command]
pub fn git_status(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let summary = state
        .git_service
        .status(&workspace_id)
        .map_err(to_command_error)?;

    emit_git_updated(
        &app,
        &workspace_id,
        &summary.branch,
        !summary.files.is_empty(),
    )?;

    Ok(build_git_status_payload(&workspace_id, &summary))
}

#[tauri::command]
pub fn git_init(
    workspace_id: String,
    initial_branch: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let branch = state
        .git_service
        .init_repo(&workspace_id, initial_branch.as_deref())
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "branch": branch,
        "initialized": true
    }))
}

#[tauri::command]
pub fn git_diff_file(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let patch = state
        .git_service
        .diff_file(&workspace_id, &path)
        .map_err(to_command_error)?;
    Ok(build_git_diff_payload(&workspace_id, &path, &patch))
}

/// High-performance structured diff command
/// Returns parsed diff hunks for immediate frontend rendering
#[tauri::command]
pub fn git_diff_file_structured(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let diff = state
        .git_service
        .diff_file_structured(&workspace_id, &path)
        .map_err(to_command_error)?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "path": diff.path,
        "isBinary": diff.is_binary,
        "isNew": diff.is_new,
        "isDeleted": diff.is_deleted,
        "isRenamed": diff.is_renamed,
        "oldPath": diff.old_path,
        "additions": diff.additions,
        "deletions": diff.deletions,
        "hunks": diff.hunks,
        "patch": diff.patch,
    }))
}

#[tauri::command]
pub fn git_stage(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let staged = state
        .git_service
        .stage(&workspace_id, &paths)
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(build_git_stage_payload(&workspace_id, staged))
}

#[tauri::command]
pub fn git_unstage(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let unstaged = state
        .git_service
        .unstage(&workspace_id, &paths)
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(build_git_unstage_payload(&workspace_id, unstaged))
}

#[tauri::command]
pub fn git_discard(
    workspace_id: String,
    paths: Vec<String>,
    include_untracked: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let discarded = state
        .git_service
        .discard(&workspace_id, &paths, include_untracked.unwrap_or(false))
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(build_git_discard_payload(&workspace_id, discarded))
}

#[tauri::command]
pub fn git_commit(
    workspace_id: String,
    message: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let commit_id = state
        .git_service
        .commit(&workspace_id, &message)
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(build_git_commit_payload(
        &workspace_id,
        &message,
        &commit_id,
    ))
}

#[tauri::command]
pub fn git_log(
    workspace_id: String,
    limit: Option<usize>,
    skip: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let entries = state
        .git_service
        .log(&workspace_id, limit.unwrap_or(50), skip.unwrap_or(0))
        .map_err(to_command_error)?;
    Ok(build_git_log_payload(&workspace_id, entries))
}

#[tauri::command]
pub fn git_commit_detail(
    workspace_id: String,
    commit: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let detail = state
        .git_service
        .commit_detail(&workspace_id, &commit)
        .map_err(to_command_error)?;
    Ok(build_git_commit_detail_payload(&workspace_id, detail))
}

#[tauri::command]
pub fn git_list_branches(
    workspace_id: String,
    include_remote: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let branches = state
        .git_service
        .list_branches(&workspace_id, include_remote.unwrap_or(false))
        .map_err(to_command_error)?;
    Ok(build_git_branches_payload(&workspace_id, branches))
}

#[tauri::command]
pub fn git_checkout(
    workspace_id: String,
    target: String,
    create: Option<bool>,
    start_point: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    state
        .git_service
        .checkout(
            &workspace_id,
            &target,
            create.unwrap_or(false),
            start_point.as_deref(),
        )
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "target": target,
        "create": create.unwrap_or(false),
        "startPoint": start_point,
        "checkedOut": true
    }))
}

#[tauri::command]
pub fn git_create_branch(
    workspace_id: String,
    branch: String,
    start_point: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    state
        .git_service
        .create_branch(&workspace_id, &branch, start_point.as_deref())
        .map_err(to_command_error)?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "branch": branch,
        "startPoint": start_point,
        "created": true
    }))
}

#[tauri::command]
pub fn git_delete_branch(
    workspace_id: String,
    branch: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    state
        .git_service
        .delete_branch(&workspace_id, &branch, force.unwrap_or(false))
        .map_err(to_command_error)?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "branch": branch,
        "force": force.unwrap_or(false),
        "deleted": true
    }))
}

#[tauri::command]
pub fn git_fetch(
    workspace_id: String,
    remote: Option<String>,
    prune: Option<bool>,
    include_tags: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let result = state
        .git_service
        .fetch(
            &workspace_id,
            remote.as_deref(),
            prune.unwrap_or(true),
            include_tags.unwrap_or(true),
        )
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(build_git_fetch_payload(&workspace_id, result))
}

#[tauri::command]
pub fn git_pull(
    workspace_id: String,
    remote: Option<String>,
    branch: Option<String>,
    rebase: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let result = state
        .git_service
        .pull(
            &workspace_id,
            remote.as_deref(),
            branch.as_deref(),
            rebase.unwrap_or(false),
        )
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(build_git_pull_payload(&workspace_id, result))
}

#[tauri::command]
pub fn git_push(
    workspace_id: String,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let result = state
        .git_service
        .push(
            &workspace_id,
            remote.as_deref(),
            branch.as_deref(),
            set_upstream.unwrap_or(false),
            force_with_lease.unwrap_or(false),
        )
        .map_err(to_command_error)?;
    Ok(build_git_push_payload(&workspace_id, result))
}

#[tauri::command]
pub fn git_stash_push(
    workspace_id: String,
    message: Option<String>,
    include_untracked: Option<bool>,
    keep_index: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    state
        .git_service
        .stash_push(
            &workspace_id,
            message.as_deref(),
            include_untracked.unwrap_or(false),
            keep_index.unwrap_or(false),
        )
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "message": message,
        "includeUntracked": include_untracked.unwrap_or(false),
        "keepIndex": keep_index.unwrap_or(false),
        "stashed": true
    }))
}

#[tauri::command]
pub fn git_stash_pop(
    workspace_id: String,
    stash: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    state
        .git_service
        .stash_pop(&workspace_id, stash.as_deref())
        .map_err(to_command_error)?;
    emit_git_updated_from_service(&app, &state, &workspace_id)?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "stash": stash,
        "popped": true
    }))
}

#[tauri::command]
pub fn git_stash_list(
    workspace_id: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let entries = state
        .git_service
        .stash_list(&workspace_id, limit.unwrap_or(20))
        .map_err(to_command_error)?;
    Ok(build_git_stash_list_payload(&workspace_id, entries))
}

#[cfg(test)]
mod tests {
    use super::{
        build_git_branches_payload, build_git_commit_payload, build_git_diff_payload,
        build_git_commit_detail_payload, build_git_discard_payload, build_git_fetch_payload,
        build_git_log_payload, build_git_pull_payload, build_git_push_payload,
        build_git_stage_payload, build_git_stash_list_payload, build_git_status_payload,
        build_git_unstage_payload,
    };
    use vb_abstractions::{GitStatusFile, GitStatusSummary, WorkspaceId};
    use vb_git::{
        GitBranchEntry, GitCommitDetail, GitCommitEntry, GitFetchResult, GitPullResult,
        GitPushResult, GitStashEntry,
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
}
