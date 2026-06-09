pub mod status_coordinator;

use gt_abstractions::{GitStatusSummary, WorkspaceId};
use gt_git::{GitBranchEntry, GitCommitDetail, GitCommitEntry, GitStashEntry, GitTagEntry};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use tracing::warn;

use crate::app_state::AppState;

const GIT_COMMAND_TARGET_BUDGET_MS: u128 = 500;
const GIT_REMOTE_OPERATION_EVENT: &str = "git/remote_operation";

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
    run_git_blocking_with_app_state(state.inner().clone(), op_name, task).await
}

async fn run_git_blocking_with_app_state<T, F>(
    app_state: AppState,
    op_name: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(crate::app_state::AppState) -> Result<T, String> + Send + 'static,
{
    let started_at = Instant::now();
    let result = tokio::task::spawn_blocking(move || task(app_state))
        .await
        .map_err(|error| format!("{op_name}: git worker join failed: {error}"))?;
    let elapsed_ms = started_at.elapsed().as_millis();
    if elapsed_ms > GIT_COMMAND_TARGET_BUDGET_MS {
        warn!(
            op_name,
            elapsed_ms,
            target_budget_ms = GIT_COMMAND_TARGET_BUDGET_MS,
            "git command exceeded target budget"
        );
    }
    result
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum GitRemoteOperationKind {
    Fetch,
    Pull,
    Push,
    TagPush,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum GitRemoteOperationStatus {
    Started,
    Finished,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitRemoteOperationPayload {
    workspace_id: String,
    repository_path: Option<String>,
    operation: GitRemoteOperationKind,
    status: GitRemoteOperationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    remote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[allow(clippy::too_many_arguments)]
fn emit_git_remote_operation(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
    repository_path: Option<&str>,
    operation: GitRemoteOperationKind,
    status: GitRemoteOperationStatus,
    remote: Option<String>,
    branch: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        GIT_REMOTE_OPERATION_EVENT,
        GitRemoteOperationPayload {
            workspace_id: workspace_id.as_str().to_string(),
            repository_path: repository_path.map(ToOwned::to_owned),
            operation,
            status,
            remote,
            branch,
            error,
        },
    );
}

pub(crate) fn build_git_status_payload(
    workspace_id: &WorkspaceId,
    summary: &GitStatusSummary,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "primaryRepositoryPath": summary.primary_repository_path,
        "branch": summary.branch,
        "ahead": summary.ahead,
        "behind": summary.behind,
        "files": summary.files,
        "repositories": summary.repositories
    })
}

pub(crate) fn build_git_diff_payload(workspace_id: &WorkspaceId, path: &str, patch: &str) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "path": path,
        "patch": patch
    })
}

pub(crate) fn build_git_stage_payload(workspace_id: &WorkspaceId, staged: usize) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "staged": staged
    })
}

pub(crate) fn build_git_unstage_payload(workspace_id: &WorkspaceId, unstaged: usize) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "unstaged": unstaged
    })
}

pub(crate) fn build_git_discard_payload(workspace_id: &WorkspaceId, discarded: usize) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "discarded": discarded
    })
}

pub(crate) fn build_git_log_payload(
    workspace_id: &WorkspaceId,
    entries: Vec<GitCommitEntry>,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "entries": entries
    })
}

pub(crate) fn build_git_commit_detail_payload(
    workspace_id: &WorkspaceId,
    detail: GitCommitDetail,
) -> Value {
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

pub(crate) fn build_git_branches_payload(
    workspace_id: &WorkspaceId,
    branches: Vec<GitBranchEntry>,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "branches": branches
    })
}

pub(crate) fn build_git_stash_list_payload(
    workspace_id: &WorkspaceId,
    entries: Vec<GitStashEntry>,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "entries": entries
    })
}

pub(crate) fn build_git_tag_list_payload(
    workspace_id: &WorkspaceId,
    entries: Vec<GitTagEntry>,
) -> Value {
    json!({
        "workspaceId": workspace_id.as_str(),
        "entries": entries
    })
}

#[tauri::command]
pub async fn git_status(
    workspace_id: String,
    repository_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let summary = run_git_blocking(&state, "GIT_STATUS_FAILED", move |app_state| {
        if let Some(repository_path) = repository_path_owned.as_deref() {
            app_state
                .git_service
                .status_repo(&workspace_id_owned, Some(repository_path))
                .map_err(to_command_error)
        } else {
            app_state
                .git_service
                .status(&workspace_id_owned)
                .map_err(to_command_error)
        }
    })
    .await?;

    Ok(build_git_status_payload(&workspace_id, &summary))
}

#[tauri::command]
pub async fn git_init(
    workspace_id: String,
    repository_path: Option<String>,
    initial_branch: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let branch = run_git_blocking(&state, "GIT_INIT_FAILED", move |app_state| {
        app_state
            .git_service
            .init_repo(
                &workspace_id_owned,
                repository_path.as_deref(),
                initial_branch.as_deref(),
            )
            .map_err(to_command_error)
    })
    .await?;
    let _ = state.git_service.invalidate_repository_cache(&workspace_id);
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "branch": branch,
        "initialized": true
    }))
}

#[tauri::command]
pub async fn git_diff_file(
    workspace_id: String,
    repository_path: Option<String>,
    path: String,
    staged: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let path_owned = path.clone();
    let repository_path_owned = repository_path.clone();
    let staged = staged.unwrap_or(false);
    let patch = run_git_blocking(&state, "GIT_DIFF_FAILED", move |app_state| {
        app_state
            .git_service
            .diff_file(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &path_owned,
                staged,
            )
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
    repository_path: Option<String>,
    path: String,
    staged: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let path_owned = path.clone();
    let repository_path_owned = repository_path.clone();
    let staged = staged.unwrap_or(false);
    let diff = run_git_blocking(&state, "GIT_DIFF_FAILED", move |app_state| {
        app_state
            .git_service
            .diff_file_structured(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &path_owned,
                staged,
            )
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
    repository_path: Option<String>,
    path: String,
    old_path: Option<String>,
    staged: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let path_owned = path.clone();
    let repository_path_owned = repository_path.clone();
    let old_path_owned = old_path.clone();
    let staged = staged.unwrap_or(false);
    let expanded = run_git_blocking(&state, "GIT_DIFF_EXPANSION_FAILED", move |app_state| {
        app_state
            .git_service
            .diff_file_expansion(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
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
    repository_path: Option<String>,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let staged = run_git_blocking(&state, "GIT_STAGE_FAILED", move |app_state| {
        app_state
            .git_service
            .stage(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &paths,
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(build_git_stage_payload(&workspace_id, staged))
}

#[tauri::command]
pub async fn git_unstage(
    workspace_id: String,
    repository_path: Option<String>,
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let unstaged = run_git_blocking(&state, "GIT_UNSTAGE_FAILED", move |app_state| {
        app_state
            .git_service
            .unstage(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &paths,
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(build_git_unstage_payload(&workspace_id, unstaged))
}

#[tauri::command]
pub async fn git_discard(
    workspace_id: String,
    repository_path: Option<String>,
    paths: Vec<String>,
    include_untracked: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let include_untracked = include_untracked.unwrap_or(false);
    let discarded = run_git_blocking(&state, "GIT_DISCARD_FAILED", move |app_state| {
        app_state
            .git_service
            .discard(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &paths,
                include_untracked,
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(build_git_discard_payload(&workspace_id, discarded))
}

#[tauri::command]
pub async fn git_commit(
    workspace_id: String,
    repository_path: Option<String>,
    message: String,
    amend: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id.clone());
    let ws_id = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    let is_amend = amend.unwrap_or(false);

    let sha = run_git_blocking(&state, "GIT_COMMIT_FAILED", move |app_state| {
        if is_amend {
            app_state
                .git_service
                .commit_amend(&ws_id, repository_path_owned.as_deref(), &message)
                .map_err(to_command_error)
        } else {
            app_state
                .git_service
                .commit(&ws_id, repository_path_owned.as_deref(), &message)
                .map_err(to_command_error)
        }
    })
    .await?;

    state
        .inner()
        .git_status_coordinator
        .refresh_immediate(&app, state.inner(), &workspace_id);
    Ok(json!({ "workspaceId": workspace_id_owned.as_str(), "commitSha": sha }))
}

#[tauri::command]
pub async fn git_log(
    workspace_id: String,
    repository_path: Option<String>,
    limit: Option<usize>,
    skip: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let effective_limit = limit.unwrap_or(50);
    let effective_skip = skip.unwrap_or(0);
    let entries = run_git_blocking(&state, "GIT_LOG_FAILED", move |app_state| {
        app_state
            .git_service
            .log(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                effective_limit,
                effective_skip,
            )
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_log_payload(&workspace_id, entries))
}

#[tauri::command]
pub async fn git_commit_detail(
    workspace_id: String,
    repository_path: Option<String>,
    commit: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let commit_owned = commit.clone();
    let detail = run_git_blocking(&state, "GIT_COMMIT_DETAIL_FAILED", move |app_state| {
        app_state
            .git_service
            .commit_detail(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &commit_owned,
            )
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_commit_detail_payload(&workspace_id, detail))
}

#[tauri::command]
pub async fn git_list_branches(
    workspace_id: String,
    repository_path: Option<String>,
    include_remote: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let include_remote = include_remote.unwrap_or(false);
    let branches = run_git_blocking(&state, "GIT_BRANCH_LIST_FAILED", move |app_state| {
        app_state
            .git_service
            .list_branches(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                include_remote,
            )
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_branches_payload(&workspace_id, branches))
}

#[tauri::command]
pub async fn git_checkout(
    workspace_id: String,
    repository_path: Option<String>,
    target: String,
    create: Option<bool>,
    start_point: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let target_owned = target.clone();
    let create = create.unwrap_or(false);
    let start_point_for_task = start_point.clone();
    run_git_blocking(&state, "GIT_CHECKOUT_FAILED", move |app_state| {
        app_state
            .git_service
            .checkout(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &target_owned,
                create,
                start_point_for_task.as_deref(),
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
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
    repository_path: Option<String>,
    branch: String,
    start_point: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let branch_owned = branch.clone();
    let start_point_for_task = start_point.clone();
    run_git_blocking(&state, "GIT_BRANCH_CREATE_FAILED", move |app_state| {
        app_state
            .git_service
            .create_branch(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
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
    repository_path: Option<String>,
    branch: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let branch_owned = branch.clone();
    let force = force.unwrap_or(false);
    run_git_blocking(&state, "GIT_BRANCH_DELETE_FAILED", move |app_state| {
        app_state
            .git_service
            .delete_branch(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &branch_owned,
                force,
            )
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
    repository_path: Option<String>,
    remote: Option<String>,
    prune: Option<bool>,
    include_tags: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let workspace_id_for_worker = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    let repository_path_for_worker = repository_path_owned.clone();
    let prune = prune.unwrap_or(true);
    let include_tags = include_tags.unwrap_or(true);
    let remote_for_task = remote.clone();
    let remote_for_worker = remote_for_task.clone();
    let app_state = state.inner().clone();
    emit_git_remote_operation(
        &app,
        &workspace_id,
        repository_path.as_deref(),
        GitRemoteOperationKind::Fetch,
        GitRemoteOperationStatus::Started,
        remote.clone(),
        None,
        None,
    );
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result =
            run_git_blocking_with_app_state(app_state.clone(), "GIT_FETCH_FAILED", move |state| {
                state
                    .git_service
                    .fetch(
                        &workspace_id_for_worker,
                        repository_path_for_worker.as_deref(),
                        remote_for_worker.as_deref(),
                        prune,
                        include_tags,
                    )
                    .map_err(to_command_error)
            })
            .await;
        match result {
            Ok(result) => {
                app_state.git_status_coordinator.refresh_immediate(
                    &app_handle,
                    &app_state,
                    workspace_id_owned.as_str(),
                );
                emit_git_remote_operation(
                    &app_handle,
                    &workspace_id_owned,
                    repository_path_owned.as_deref(),
                    GitRemoteOperationKind::Fetch,
                    GitRemoteOperationStatus::Finished,
                    Some(result.remote),
                    None,
                    None,
                );
            }
            Err(error) => emit_git_remote_operation(
                &app_handle,
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                GitRemoteOperationKind::Fetch,
                GitRemoteOperationStatus::Error,
                remote_for_task,
                None,
                Some(error),
            ),
        }
    });
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "remote": remote,
        "prune": prune,
        "includeTags": include_tags,
        "queued": true
    }))
}

#[tauri::command]
pub async fn git_pull(
    workspace_id: String,
    repository_path: Option<String>,
    remote: Option<String>,
    branch: Option<String>,
    rebase: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let workspace_id_for_worker = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    let repository_path_for_worker = repository_path_owned.clone();
    let rebase = rebase.unwrap_or(false);
    let remote_for_task = remote.clone();
    let remote_for_worker = remote_for_task.clone();
    let branch_for_task = branch.clone();
    let branch_for_worker = branch_for_task.clone();
    let app_state = state.inner().clone();
    emit_git_remote_operation(
        &app,
        &workspace_id,
        repository_path.as_deref(),
        GitRemoteOperationKind::Pull,
        GitRemoteOperationStatus::Started,
        remote.clone(),
        branch.clone(),
        None,
    );
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result =
            run_git_blocking_with_app_state(app_state.clone(), "GIT_PULL_FAILED", move |state| {
                state
                    .git_service
                    .pull(
                        &workspace_id_for_worker,
                        repository_path_for_worker.as_deref(),
                        remote_for_worker.as_deref(),
                        branch_for_worker.as_deref(),
                        rebase,
                    )
                    .map_err(to_command_error)
            })
            .await;
        match result {
            Ok(result) => {
                app_state.git_status_coordinator.refresh_immediate(
                    &app_handle,
                    &app_state,
                    workspace_id_owned.as_str(),
                );
                emit_git_remote_operation(
                    &app_handle,
                    &workspace_id_owned,
                    repository_path_owned.as_deref(),
                    GitRemoteOperationKind::Pull,
                    GitRemoteOperationStatus::Finished,
                    Some(result.remote),
                    result.branch,
                    None,
                );
            }
            Err(error) => emit_git_remote_operation(
                &app_handle,
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                GitRemoteOperationKind::Pull,
                GitRemoteOperationStatus::Error,
                remote_for_task,
                branch_for_task,
                Some(error),
            ),
        }
    });
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "remote": remote,
        "branch": branch,
        "rebase": rebase,
        "queued": true
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_push(
    workspace_id: String,
    repository_path: Option<String>,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let workspace_id_for_worker = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    let repository_path_for_worker = repository_path_owned.clone();
    let set_upstream = set_upstream.unwrap_or(false);
    let force_with_lease = force_with_lease.unwrap_or(false);
    let remote_for_task = remote.clone();
    let remote_for_worker = remote_for_task.clone();
    let branch_for_task = branch.clone();
    let branch_for_worker = branch_for_task.clone();
    let app_state = state.inner().clone();
    emit_git_remote_operation(
        &app,
        &workspace_id,
        repository_path.as_deref(),
        GitRemoteOperationKind::Push,
        GitRemoteOperationStatus::Started,
        remote.clone(),
        branch.clone(),
        None,
    );
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result =
            run_git_blocking_with_app_state(app_state.clone(), "GIT_PUSH_FAILED", move |state| {
                state
                    .git_service
                    .push(
                        &workspace_id_for_worker,
                        repository_path_for_worker.as_deref(),
                        remote_for_worker.as_deref(),
                        branch_for_worker.as_deref(),
                        set_upstream,
                        force_with_lease,
                    )
                    .map_err(to_command_error)
            })
            .await;
        match result {
            Ok(result) => {
                app_state.git_status_coordinator.refresh_immediate(
                    &app_handle,
                    &app_state,
                    workspace_id_owned.as_str(),
                );
                emit_git_remote_operation(
                    &app_handle,
                    &workspace_id_owned,
                    repository_path_owned.as_deref(),
                    GitRemoteOperationKind::Push,
                    GitRemoteOperationStatus::Finished,
                    Some(result.remote),
                    result.branch,
                    None,
                );
            }
            Err(error) => emit_git_remote_operation(
                &app_handle,
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                GitRemoteOperationKind::Push,
                GitRemoteOperationStatus::Error,
                remote_for_task,
                branch_for_task,
                Some(error),
            ),
        }
    });
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "remote": remote,
        "branch": branch,
        "setUpstream": set_upstream,
        "forceWithLease": force_with_lease,
        "queued": true
    }))
}

#[tauri::command]
pub async fn git_stash_push(
    workspace_id: String,
    repository_path: Option<String>,
    message: Option<String>,
    include_untracked: Option<bool>,
    keep_index: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let include_untracked = include_untracked.unwrap_or(false);
    let keep_index = keep_index.unwrap_or(false);
    let message_for_task = message.clone();
    run_git_blocking(&state, "GIT_STASH_PUSH_FAILED", move |app_state| {
        app_state
            .git_service
            .stash_push(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                message_for_task.as_deref(),
                include_untracked,
                keep_index,
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
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
    repository_path: Option<String>,
    stash: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let stash_for_task = stash.clone();
    run_git_blocking(&state, "GIT_STASH_POP_FAILED", move |app_state| {
        app_state
            .git_service
            .stash_pop(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                stash_for_task.as_deref(),
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "stash": stash,
        "popped": true
    }))
}

#[tauri::command]
pub async fn git_stash_list(
    workspace_id: String,
    repository_path: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let effective_limit = limit.unwrap_or(20);
    let entries = run_git_blocking(&state, "GIT_STASH_LIST_FAILED", move |app_state| {
        app_state
            .git_service
            .stash_list(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                effective_limit,
            )
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_stash_list_payload(&workspace_id, entries))
}

#[tauri::command]
pub async fn git_tag_list(
    workspace_id: String,
    repository_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let entries = run_git_blocking(&state, "GIT_TAG_LIST_FAILED", move |app_state| {
        app_state
            .git_service
            .tag_list(&workspace_id_owned, repository_path_owned.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    Ok(build_git_tag_list_payload(&workspace_id, entries))
}

#[tauri::command]
pub async fn git_tag_create(
    workspace_id: String,
    repository_path: Option<String>,
    name: String,
    target: String,
    annotated: Option<bool>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let name_owned = name.clone();
    let target_owned = target.clone();
    let repository_path_owned = repository_path.clone();
    let annotated = annotated.unwrap_or(false);
    let message_for_task = message.clone();
    run_git_blocking(&state, "GIT_TAG_CREATE_FAILED", move |app_state| {
        app_state
            .git_service
            .tag_create(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &name_owned,
                &target_owned,
                annotated,
                message_for_task.as_deref(),
            )
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "name": name,
        "target": target,
        "annotated": annotated,
        "message": message,
        "created": true
    }))
}

#[tauri::command]
pub async fn git_tag_delete(
    workspace_id: String,
    repository_path: Option<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let name_owned = name.clone();
    run_git_blocking(&state, "GIT_TAG_DELETE_FAILED", move |app_state| {
        app_state
            .git_service
            .tag_delete(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &name_owned,
            )
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "name": name,
        "deleted": true
    }))
}

#[tauri::command]
pub async fn git_cherry_pick(
    workspace_id: String,
    repository_path: Option<String>,
    commit: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id.clone());
    let ws_id = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    run_git_blocking(&state, "GIT_CHERRY_PICK_FAILED", move |app_state| {
        app_state
            .git_service
            .cherry_pick(&ws_id, repository_path_owned.as_deref(), &commit)
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_immediate(&app, state.inner(), &workspace_id);
    Ok(json!({ "workspaceId": workspace_id_owned.as_str() }))
}

#[tauri::command]
pub async fn git_revert(
    workspace_id: String,
    repository_path: Option<String>,
    commit: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id.clone());
    let ws_id = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    run_git_blocking(&state, "GIT_REVERT_FAILED", move |app_state| {
        app_state
            .git_service
            .revert(&ws_id, repository_path_owned.as_deref(), &commit)
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_immediate(&app, state.inner(), &workspace_id);
    Ok(json!({ "workspaceId": workspace_id_owned.as_str() }))
}

#[tauri::command]
pub async fn git_reset(
    workspace_id: String,
    repository_path: Option<String>,
    target: String,
    mode: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id.clone());
    let ws_id = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    run_git_blocking(&state, "GIT_RESET_FAILED", move |app_state| {
        app_state
            .git_service
            .reset(&ws_id, repository_path_owned.as_deref(), &target, &mode)
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_immediate(&app, state.inner(), &workspace_id);
    Ok(json!({ "workspaceId": workspace_id_owned.as_str() }))
}

#[tauri::command]
pub async fn git_tag_push(
    workspace_id: String,
    repository_path: Option<String>,
    remote: Option<String>,
    name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let workspace_id_for_worker = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    let repository_path_for_worker = repository_path_owned.clone();
    let name_for_task = name.clone();
    let name_for_worker = name_for_task.clone();
    let remote_for_task = remote.clone();
    let remote_for_worker = remote_for_task.clone();
    let app_state = state.inner().clone();
    emit_git_remote_operation(
        &app,
        &workspace_id,
        repository_path.as_deref(),
        GitRemoteOperationKind::TagPush,
        GitRemoteOperationStatus::Started,
        remote.clone(),
        Some(name.clone()),
        None,
    );
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_git_blocking_with_app_state(
            app_state.clone(),
            "GIT_TAG_PUSH_FAILED",
            move |state| {
                state
                    .git_service
                    .tag_push(
                        &workspace_id_for_worker,
                        repository_path_for_worker.as_deref(),
                        remote_for_worker.as_deref(),
                        &name_for_worker,
                    )
                    .map_err(to_command_error)
            },
        )
        .await;
        match result {
            Ok(()) => emit_git_remote_operation(
                &app_handle,
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                GitRemoteOperationKind::TagPush,
                GitRemoteOperationStatus::Finished,
                remote_for_task,
                Some(name_for_task),
                None,
            ),
            Err(error) => emit_git_remote_operation(
                &app_handle,
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                GitRemoteOperationKind::TagPush,
                GitRemoteOperationStatus::Error,
                remote_for_task,
                Some(name_for_task),
                Some(error),
            ),
        }
    });
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "remote": remote,
        "name": name,
        "queued": true
    }))
}

#[tauri::command]
pub async fn git_merge(
    workspace_id: String,
    repository_path: Option<String>,
    target: String,
    no_ff: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let target_owned = target.clone();
    let no_ff = no_ff.unwrap_or(false);
    let result = run_git_blocking(&state, "GIT_MERGE_FAILED", move |app_state| {
        app_state
            .git_service
            .merge(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &target_owned,
                no_ff,
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "success": result.success,
        "conflicts": result.conflicts,
        "mergedCommit": result.merged_commit,
    }))
}

#[tauri::command]
pub async fn git_merge_continue(
    workspace_id: String,
    repository_path: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let commit = run_git_blocking(&state, "GIT_MERGE_CONTINUE_FAILED", move |app_state| {
        app_state
            .git_service
            .merge_continue(&workspace_id_owned, repository_path_owned.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "mergedCommit": commit,
    }))
}

#[tauri::command]
pub async fn git_merge_abort(
    workspace_id: String,
    repository_path: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    run_git_blocking(&state, "GIT_MERGE_ABORT_FAILED", move |app_state| {
        app_state
            .git_service
            .merge_abort(&workspace_id_owned, repository_path_owned.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "aborted": true,
    }))
}

#[tauri::command]
pub async fn git_conflict_list(
    workspace_id: String,
    repository_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let conflicts = run_git_blocking(&state, "GIT_CONFLICT_LIST_FAILED", move |app_state| {
        app_state
            .git_service
            .conflict_list(&workspace_id_owned, repository_path_owned.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "conflicts": conflicts,
    }))
}

#[tauri::command]
pub async fn git_conflict_resolve(
    workspace_id: String,
    repository_path: Option<String>,
    path: String,
    side: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let path_owned = path.clone();
    let side_owned = side.clone();
    let conflicts = run_git_blocking(&state, "GIT_CONFLICT_RESOLVE_FAILED", move |app_state| {
        app_state
            .git_service
            .resolve_conflict(
                &workspace_id_owned,
                repository_path_owned.as_deref(),
                &path_owned,
                &side_owned,
            )
            .map_err(to_command_error)
    })
    .await?;
    state.inner().git_status_coordinator.refresh_immediate(
        &app,
        state.inner(),
        workspace_id.as_str(),
    );
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "path": path,
        "side": side,
        "conflicts": conflicts,
    }))
}

#[tauri::command]
pub async fn git_merge_state(
    workspace_id: String,
    repository_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_id_owned = workspace_id.clone();
    let repository_path_owned = repository_path.clone();
    let merge_state = run_git_blocking(&state, "GIT_MERGE_STATE_FAILED", move |app_state| {
        app_state
            .git_service
            .merge_state(&workspace_id_owned, repository_path_owned.as_deref())
            .map_err(to_command_error)
    })
    .await?;
    Ok(json!({
        "workspaceId": workspace_id.as_str(),
        "inProgress": merge_state.in_progress,
        "conflicts": merge_state.conflicts,
    }))
}

#[tauri::command]
pub async fn git_stage_hunk(
    workspace_id: String,
    repository_path: Option<String>,
    path: String,
    patch: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id.clone());
    let ws_id = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    let path_owned = path.clone();
    run_git_blocking(&state, "GIT_STAGE_HUNK_FAILED", move |app_state| {
        app_state
            .git_service
            .stage_hunk(
                &ws_id,
                repository_path_owned.as_deref(),
                &path_owned,
                &patch,
            )
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_immediate(&app, state.inner(), &workspace_id);
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn git_unstage_hunk(
    workspace_id: String,
    repository_path: Option<String>,
    path: String,
    patch: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let workspace_id_owned = WorkspaceId::new(workspace_id.clone());
    let ws_id = workspace_id_owned.clone();
    let repository_path_owned = repository_path.clone();
    let path_owned = path.clone();
    run_git_blocking(&state, "GIT_UNSTAGE_HUNK_FAILED", move |app_state| {
        app_state
            .git_service
            .unstage_hunk(
                &ws_id,
                repository_path_owned.as_deref(),
                &path_owned,
                &patch,
            )
            .map_err(to_command_error)
    })
    .await?;
    state
        .inner()
        .git_status_coordinator
        .refresh_immediate(&app, state.inner(), &workspace_id);
    Ok(json!({ "ok": true }))
}
