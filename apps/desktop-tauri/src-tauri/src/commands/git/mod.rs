pub mod status_coordinator;

use serde_json::{json, Value};
use tauri::{AppHandle, State};
use gt_abstractions::{GitStatusSummary, WorkspaceId};
use gt_git::{
    GitBranchEntry, GitCommitDetail, GitCommitEntry, GitFetchResult, GitPullResult, GitPushResult,
    GitStashEntry,
};

use crate::app_state::AppState;

fn to_command_error(error: impl ToString) -> String {
    error.to_string()
}

async fn run_git_blocking<T, F>(
    state: &State<'_, AppState>,
    op_name: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(crate::app_state::AppState) -> Result<T, String> + Send + 'static,
{
    let app_state = state.inner().clone();
    tokio::task::spawn_blocking(move || task(app_state))
        .await
        .map_err(|error| format!("{op_name}: git worker join failed: {error}"))?
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
pub async fn git_status(workspace_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let summary = run_git_blocking(&state, "GIT_STATUS_FAILED", move |app_state| {
        app_state
            .git_service
            .status(&workspace_id_owned)
            .map_err(to_command_error)
    })
    .await?;

    Ok(build_git_status_payload(&workspace_id, &summary))
}

#[tauri::command]
pub async fn git_init(
    workspace_id: String,
    initial_branch: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let branch = run_git_blocking(&state, "GIT_INIT_FAILED", move |app_state| {
        app_state
            .git_service
            .init_repo(&workspace_id_owned, initial_branch.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "branch": branch,
        "initialized": true
    }))
}

#[tauri::command]
pub async fn git_diff_file(
    workspace_id: String,
    path: String,
    staged: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let path_owned = path.clone();
    let staged = staged.unwrap_or(false);
    let patch = run_git_blocking(&state, "GIT_DIFF_FAILED", move |app_state| {
        app_state
            .git_service
            .diff_file(&workspace_id_owned, &path_owned, staged)
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_diff_payload(&workspace_id, &path, &patch))
}

/// High-performance structured diff command
/// Returns parsed diff hunks for immediate frontend rendering
#[tauri::command]
pub async fn git_diff_file_structured(
    workspace_id: String,
    path: String,
    staged: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let path_owned = path.clone();
    let staged = staged.unwrap_or(false);
    let diff = run_git_blocking(&state, "GIT_DIFF_FAILED", move |app_state| {
        app_state
            .git_service
            .diff_file_structured(&workspace_id_owned, &path_owned, staged)
            .map_err(to_command_error)
    })
    .await?;
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
pub async fn git_diff_file_expansion(
    workspace_id: String,
    path: String,
    old_path: Option<String>,
    staged: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let path_owned = path.clone();
    let old_path_owned = old_path.clone();
    let staged = staged.unwrap_or(false);
    let expanded = run_git_blocking(&state, "GIT_DIFF_EXPANSION_FAILED", move |app_state| {
        app_state
            .git_service
            .diff_file_expansion(
                &workspace_id_owned,
                &path_owned,
                old_path_owned.as_deref(),
                staged,
            )
            .map_err(to_command_error)
    })
    .await?;
    let full_diff = if let Some(full_diff) = expanded.full_diff {
        json!({
            "workspaceId": workspace_id.as_str(),
            "path": full_diff.path,
            "isBinary": full_diff.is_binary,
            "isNew": full_diff.is_new,
            "isDeleted": full_diff.is_deleted,
            "isRenamed": full_diff.is_renamed,
            "oldPath": full_diff.old_path,
            "additions": full_diff.additions,
            "deletions": full_diff.deletions,
            "hunks": full_diff.hunks,
            "patch": full_diff.patch,
        })
    } else {
        Value::Null
    };
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "path": expanded.path,
        "oldPath": expanded.old_path,
        "isBinary": expanded.is_binary,
        "oldExists": expanded.old_exists,
        "newExists": expanded.new_exists,
        "fullDiff": full_diff,
    }))
}

#[tauri::command]
pub async fn git_stage(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let staged = run_git_blocking(&state, "GIT_STAGE_FAILED", move |app_state| {
        app_state
            .git_service
            .stage(&workspace_id_owned, &paths)
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(build_git_stage_payload(&workspace_id, staged))
}

#[tauri::command]
pub async fn git_unstage(
    workspace_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let unstaged = run_git_blocking(&state, "GIT_UNSTAGE_FAILED", move |app_state| {
        app_state
            .git_service
            .unstage(&workspace_id_owned, &paths)
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(build_git_unstage_payload(&workspace_id, unstaged))
}

#[tauri::command]
pub async fn git_discard(
    workspace_id: String,
    paths: Vec<String>,
    include_untracked: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let include_untracked = include_untracked.unwrap_or(false);
    let discarded = run_git_blocking(&state, "GIT_DISCARD_FAILED", move |app_state| {
        app_state
            .git_service
            .discard(&workspace_id_owned, &paths, include_untracked)
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(build_git_discard_payload(&workspace_id, discarded))
}

#[tauri::command]
pub async fn git_commit(
    workspace_id: String,
    message: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let message_owned = message.clone();
    let commit_id = run_git_blocking(&state, "GIT_COMMIT_FAILED", move |app_state| {
        app_state
            .git_service
            .commit(&workspace_id_owned, &message_owned)
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(build_git_commit_payload(
        &workspace_id,
        &message,
        &commit_id,
    ))
}

#[tauri::command]
pub async fn git_log(
    workspace_id: String,
    limit: Option<usize>,
    skip: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let effective_limit = limit.unwrap_or(50);
    let effective_skip = skip.unwrap_or(0);
    let entries = run_git_blocking(&state, "GIT_LOG_FAILED", move |app_state| {
        app_state
            .git_service
            .log(&workspace_id_owned, effective_limit, effective_skip)
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_log_payload(&workspace_id, entries))
}

#[tauri::command]
pub async fn git_commit_detail(
    workspace_id: String,
    commit: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let commit_owned = commit.clone();
    let detail = run_git_blocking(&state, "GIT_COMMIT_DETAIL_FAILED", move |app_state| {
        app_state
            .git_service
            .commit_detail(&workspace_id_owned, &commit_owned)
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_commit_detail_payload(&workspace_id, detail))
}

#[tauri::command]
pub async fn git_list_branches(
    workspace_id: String,
    include_remote: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let include_remote = include_remote.unwrap_or(false);
    let branches = run_git_blocking(&state, "GIT_BRANCH_LIST_FAILED", move |app_state| {
        app_state
            .git_service
            .list_branches(&workspace_id_owned, include_remote)
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_branches_payload(&workspace_id, branches))
}

#[tauri::command]
pub async fn git_checkout(
    workspace_id: String,
    target: String,
    create: Option<bool>,
    start_point: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let target_owned = target.clone();
    let create = create.unwrap_or(false);
    let start_point_for_task = start_point.clone();
    run_git_blocking(&state, "GIT_CHECKOUT_FAILED", move |app_state| {
        app_state
            .git_service
            .checkout(
                &workspace_id_owned,
                &target_owned,
                create,
                start_point_for_task.as_deref(),
            )
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "target": target,
        "create": create,
        "startPoint": start_point,
        "checkedOut": true
    }))
}

#[tauri::command]
pub async fn git_create_branch(
    workspace_id: String,
    branch: String,
    start_point: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let branch_owned = branch.clone();
    let start_point_for_task = start_point.clone();
    run_git_blocking(&state, "GIT_BRANCH_CREATE_FAILED", move |app_state| {
        app_state
            .git_service
            .create_branch(
                &workspace_id_owned,
                &branch_owned,
                start_point_for_task.as_deref(),
            )
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "branch": branch,
        "startPoint": start_point,
        "created": true
    }))
}

#[tauri::command]
pub async fn git_delete_branch(
    workspace_id: String,
    branch: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let branch_owned = branch.clone();
    let force = force.unwrap_or(false);
    run_git_blocking(&state, "GIT_BRANCH_DELETE_FAILED", move |app_state| {
        app_state
            .git_service
            .delete_branch(&workspace_id_owned, &branch_owned, force)
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "branch": branch,
        "force": force,
        "deleted": true
    }))
}

#[tauri::command]
pub async fn git_fetch(
    workspace_id: String,
    remote: Option<String>,
    prune: Option<bool>,
    include_tags: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let prune = prune.unwrap_or(true);
    let include_tags = include_tags.unwrap_or(true);
    let remote_for_task = remote.clone();
    let result = run_git_blocking(&state, "GIT_FETCH_FAILED", move |app_state| {
        app_state
            .git_service
            .fetch(
                &workspace_id_owned,
                remote_for_task.as_deref(),
                prune,
                include_tags,
            )
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(build_git_fetch_payload(&workspace_id, result))
}

#[tauri::command]
pub async fn git_pull(
    workspace_id: String,
    remote: Option<String>,
    branch: Option<String>,
    rebase: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let rebase = rebase.unwrap_or(false);
    let remote_for_task = remote.clone();
    let branch_for_task = branch.clone();
    let result = run_git_blocking(&state, "GIT_PULL_FAILED", move |app_state| {
        app_state
            .git_service
            .pull(
                &workspace_id_owned,
                remote_for_task.as_deref(),
                branch_for_task.as_deref(),
                rebase,
            )
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(build_git_pull_payload(&workspace_id, result))
}

#[tauri::command]
pub async fn git_push(
    workspace_id: String,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let set_upstream = set_upstream.unwrap_or(false);
    let force_with_lease = force_with_lease.unwrap_or(false);
    let remote_for_task = remote.clone();
    let branch_for_task = branch.clone();
    let result = run_git_blocking(&state, "GIT_PUSH_FAILED", move |app_state| {
        app_state
            .git_service
            .push(
                &workspace_id_owned,
                remote_for_task.as_deref(),
                branch_for_task.as_deref(),
                set_upstream,
                force_with_lease,
            )
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(build_git_push_payload(&workspace_id, result))
}

#[tauri::command]
pub async fn git_stash_push(
    workspace_id: String,
    message: Option<String>,
    include_untracked: Option<bool>,
    keep_index: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let include_untracked = include_untracked.unwrap_or(false);
    let keep_index = keep_index.unwrap_or(false);
    let message_for_task = message.clone();
    run_git_blocking(&state, "GIT_STASH_PUSH_FAILED", move |app_state| {
        app_state
            .git_service
            .stash_push(
                &workspace_id_owned,
                message_for_task.as_deref(),
                include_untracked,
                keep_index,
            )
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "message": message,
        "includeUntracked": include_untracked,
        "keepIndex": keep_index,
        "stashed": true
    }))
}

#[tauri::command]
pub async fn git_stash_pop(
    workspace_id: String,
    stash: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let stash_for_task = stash.clone();
    run_git_blocking(&state, "GIT_STASH_POP_FAILED", move |app_state| {
        app_state
            .git_service
            .stash_pop(&workspace_id_owned, stash_for_task.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_now(&app, state.inner(), &workspace_id);
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "stash": stash,
        "popped": true
    }))
}

#[tauri::command]
pub async fn git_stash_list(
    workspace_id: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let effective_limit = limit.unwrap_or(20);
    let entries = run_git_blocking(&state, "GIT_STASH_LIST_FAILED", move |app_state| {
        app_state
            .git_service
            .stash_list(&workspace_id_owned, effective_limit)
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_stash_list_payload(&workspace_id, entries))
}

#[cfg(test)]
#[path = "../tests/git_tests.rs"]
mod tests;
