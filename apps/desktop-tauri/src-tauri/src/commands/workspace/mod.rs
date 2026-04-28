pub mod surface;

use gt_abstractions::{WorkspaceId, WorkspaceService, WorkspaceSessionSnapshot};
use gt_agent::{AgentRepository, GLOBAL_ROLE_WORKSPACE_ID};
use gt_storage::{SqliteAgentRepository, SqliteAiConfigRepository, SqliteStorage};
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State, Window};

use crate::app_state::AppState;

fn to_command_error(error: impl ToString) -> String {
    error.to_string()
}

fn build_window_active_response(window_label: &str, workspace_id: Option<String>) -> Value {
    json!({
        "windowLabel": window_label,
        "workspaceId": workspace_id,
    })
}

fn build_workspace_open_response(workspace_id: &str, name: &str, root: &str) -> Value {
    json!({
        "workspaceId": workspace_id,
        "name": name,
        "root": root,
    })
}

fn build_workspace_close_response(workspace_id: &str, closed: bool) -> Value {
    json!({
        "workspaceId": workspace_id,
        "closed": closed,
    })
}

fn build_workspace_restore_response(
    workspace_id: &str,
    session: &WorkspaceSessionSnapshot,
) -> Value {
    json!({
        "workspaceId": workspace_id,
        "windows": session.windows,
        "tabs": session.tabs,
        "terminals": session.terminals,
    })
}

fn build_workspace_switch_response(active_workspace_id: &str) -> Value {
    json!({ "activeWorkspaceId": active_workspace_id })
}

fn build_workspace_reset_response(workspace_id: &str) -> Value {
    json!({
        "workspaceId": workspace_id,
        "reset": true,
    })
}

fn allow_workspace_asset_scope<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
    root: &Path,
) -> Result<(), String> {
    manager
        .asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|error| {
            format!(
                "WORKSPACE_ASSET_SCOPE_FAILED: unable to allow workspace asset access for '{}': {error}",
                root.display()
            )
        })
}

fn active_workspace_id(state: &AppState) -> Result<Option<String>, String> {
    let workspaces = state.workspace_service.list().map_err(to_command_error)?;
    Ok(workspaces
        .into_iter()
        .find(|workspace| workspace.active)
        .map(|workspace| workspace.workspace_id.to_string()))
}

fn resolve_workspace_storage(app: &AppHandle) -> Result<SqliteStorage, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("WORKSPACE_RESET_STORAGE_PATH_FAILED: {error}"))?;
    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("WORKSPACE_RESET_STORAGE_PATH_FAILED: {error}"))?;
    SqliteStorage::new(base_dir.join("gtoffice.db")).map_err(to_command_error)
}

fn remove_workspace_state_dir(path: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "WORKSPACE_RESET_FILE_CLEANUP_FAILED: unable to remove '{}': {error}",
            path.display()
        )),
    }
}

fn emit_workspace_updated<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_id: &str,
    kind: &str,
) -> Result<(), String> {
    app.emit(
        "workspace/updated",
        json!({
            "workspaceId": workspace_id,
            "kind": kind,
        }),
    )
    .map_err(|err| format!("WORKSPACE_EVENT_EMIT_FAILED: {err}"))
}

fn emit_settings_updated<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_id: &str,
) -> Result<(), String> {
    app.emit(
        "settings/updated",
        json!({
            "workspaceId": workspace_id,
            "scope": "workspace",
            "tsMs": now_ts_ms(),
        }),
    )
    .map_err(|err| format!("WORKSPACE_EVENT_EMIT_FAILED: {err}"))
}

fn emit_ai_config_changed<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_id: &str,
) -> Result<(), String> {
    app.emit(
        "ai_config/changed",
        json!({
            "auditId": Value::Null,
            "workspaceId": workspace_id,
            "scope": "workspace",
            "changedKeys": [],
            "reset": true,
        }),
    )
    .map_err(|err| format!("WORKSPACE_EVENT_EMIT_FAILED: {err}"))
}

fn now_ts_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn reset_workspace_state_storage(
    workspace_id: &str,
    confirmation_text: &str,
    state: &AppState,
    storage: &SqliteStorage,
) -> Result<(), String> {
    if confirmation_text != "RESET" {
        return Err("WORKSPACE_RESET_CONFIRMATION_INVALID: invalid confirmation text".to_string());
    }

    let workspace_root = state.workspace_root_path(workspace_id)?;
    let workspace_state_dir = workspace_root.join(".gtoffice");
    remove_workspace_state_dir(&workspace_state_dir)?;

    let agent_repo = SqliteAgentRepository::new(storage.clone());
    let ai_repo = SqliteAiConfigRepository::new(storage.clone());
    agent_repo.ensure_schema().map_err(to_command_error)?;
    agent_repo
        .seed_defaults(GLOBAL_ROLE_WORKSPACE_ID)
        .map_err(to_command_error)?;
    ai_repo.ensure_schema().map_err(to_command_error)?;

    let mut conn = storage.open_connection().map_err(to_command_error)?;
    let tx = conn.transaction().map_err(to_command_error)?;
    agent_repo
        .reset_workspace_state_in_tx(&tx, workspace_id)
        .map_err(to_command_error)?;
    ai_repo
        .reset_workspace_state_in_tx(&tx, workspace_id)
        .map_err(to_command_error)?;
    tx.commit().map_err(to_command_error)?;

    Ok(())
}

#[cfg(not(test))]
pub(crate) fn workspace_reset_state_with_storage(
    workspace_id: String,
    confirmation_text: String,
    state: &AppState,
    app: &AppHandle,
    storage: SqliteStorage,
) -> Result<Value, String> {
    reset_workspace_state_storage(&workspace_id, &confirmation_text, state, &storage)?;
    state.invalidate_workspace_reset_state(app, &workspace_id)?;
    emit_workspace_updated(app, &workspace_id, "reset")?;
    emit_settings_updated(app, &workspace_id)?;
    emit_ai_config_changed(app, &workspace_id)?;

    Ok(build_workspace_reset_response(&workspace_id))
}

#[cfg(test)]
pub(crate) fn workspace_reset_state_with_storage<R: tauri::Runtime>(
    workspace_id: String,
    confirmation_text: String,
    state: &AppState,
    app: &AppHandle<R>,
    storage: SqliteStorage,
) -> Result<Value, String> {
    reset_workspace_state_storage(&workspace_id, &confirmation_text, state, &storage)?;
    state.invalidate_workspace_reset_state_for_test(&workspace_id)?;
    emit_workspace_updated(app, &workspace_id, "reset")?;
    emit_settings_updated(app, &workspace_id)?;
    emit_ai_config_changed(app, &workspace_id)?;

    Ok(build_workspace_reset_response(&workspace_id))
}

fn emit_active_changed<R: tauri::Runtime>(
    app: &AppHandle<R>,
    current: Option<&str>,
    previous: Option<&str>,
) -> Result<(), String> {
    if current == previous {
        return Ok(());
    }

    app.emit(
        "workspace/active_changed",
        json!({
            "workspaceId": current,
            "previousWorkspaceId": previous,
        }),
    )
    .map_err(|err| format!("WORKSPACE_EVENT_EMIT_FAILED: {err}"))
}

#[tauri::command]
pub fn workspace_list(state: State<'_, AppState>) -> Result<Value, String> {
    let workspaces = state.workspace_service.list().map_err(to_command_error)?;
    Ok(json!({ "workspaces": workspaces }))
}

#[tauri::command]
pub fn workspace_open(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
    window: Window,
) -> Result<Value, String> {
    let before_active = active_workspace_id(&state)?;
    let workspace = state
        .workspace_service
        .open(Path::new(&path))
        .map_err(to_command_error)?;

    if let Err(error) = allow_workspace_asset_scope(&app, Path::new(&workspace.root)) {
        let _ = state.workspace_service.close(&workspace.workspace_id);
        return Err(error);
    }

    let after_active = active_workspace_id(&state)?;
    state.bind_window_workspace(window.label(), workspace.workspace_id.as_str())?;
    let app_for_watcher = app.clone();
    let state_for_watcher = state.inner().clone();
    let watcher_workspace_id = workspace.workspace_id.to_string();
    let watcher_workspace_root = workspace.root.clone();
    // Do watcher initialization in background to avoid blocking workspace open on large trees.
    tauri::async_runtime::spawn(async move {
        if let Err(error) = state_for_watcher.ensure_workspace_watcher(
            &app_for_watcher,
            watcher_workspace_id.as_str(),
            &watcher_workspace_root,
        ) {
            let _ = app_for_watcher.emit(
                "filesystem/watch_error",
                json!({
                    "workspaceId": watcher_workspace_id,
                    "detail": error,
                }),
            );
        }
    });
    emit_workspace_updated(&app, workspace.workspace_id.as_str(), "opened")?;
    emit_active_changed(&app, after_active.as_deref(), before_active.as_deref())?;
    Ok(build_workspace_open_response(
        workspace.workspace_id.as_str(),
        &workspace.name,
        &workspace.root,
    ))
}

#[tauri::command]
pub fn workspace_close(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
    window: Window,
) -> Result<Value, String> {
    let before_active = active_workspace_id(&state)?;
    let workspace_id = WorkspaceId::new(workspace_id);
    let workspace_root = state.workspace_root_path(workspace_id.as_str())?;
    let closed = state
        .workspace_service
        .close(&workspace_id)
        .map_err(to_command_error)?;
    if closed {
        let _ = state.remove_workspace_watcher(workspace_id.as_str());
        let snapshot_path = workspace_root.join(".gtoffice").join("session.snapshot.json");
        let _ = std::fs::remove_file(&snapshot_path);
    }
    let after_active = active_workspace_id(&state)?;
    if let Some(active_workspace_id) = after_active.as_deref() {
        state.bind_window_workspace(window.label(), active_workspace_id)?;
    } else {
        state.clear_window_workspace(window.label())?;
    }
    emit_workspace_updated(&app, workspace_id.as_str(), "closed")?;
    emit_active_changed(&app, after_active.as_deref(), before_active.as_deref())?;
    Ok(build_workspace_close_response(
        workspace_id.as_str(),
        closed,
    ))
}

#[tauri::command]
pub fn workspace_restore_session(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let session = state
        .workspace_service
        .restore_session(&workspace_id)
        .map_err(to_command_error)?;
    Ok(build_workspace_restore_response(
        workspace_id.as_str(),
        &session,
    ))
}

#[tauri::command]
pub fn workspace_switch_active(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
    window: Window,
) -> Result<Value, String> {
    let before_active = active_workspace_id(&state)?;
    let workspace_id = WorkspaceId::new(workspace_id);
    let active_workspace_id = state
        .workspace_service
        .switch_active(&workspace_id)
        .map_err(to_command_error)?;
    let after_active = Some(active_workspace_id.to_string());
    state.bind_window_workspace(window.label(), active_workspace_id.as_str())?;
    emit_active_changed(&app, after_active.as_deref(), before_active.as_deref())?;
    Ok(build_workspace_switch_response(
        active_workspace_id.as_str(),
    ))
}

#[tauri::command]
pub fn workspace_get_context(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = WorkspaceId::new(workspace_id);
    let context = state
        .workspace_service
        .get_context(&workspace_id)
        .map_err(to_command_error)?;
    serde_json::to_value(context).map_err(to_command_error)
}

#[tauri::command]
pub fn workspace_get_window_active(
    state: State<'_, AppState>,
    window: Window,
) -> Result<Value, String> {
    let workspace_id = state.window_workspace(window.label())?;
    Ok(build_window_active_response(window.label(), workspace_id))
}

#[tauri::command]
pub fn workspace_reset_state(
    workspace_id: String,
    confirmation_text: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    workspace_reset_state_with_storage(
        workspace_id,
        confirmation_text,
        state.inner(),
        &app,
        resolve_workspace_storage(&app)?,
    )
}

#[cfg(test)]
#[path = "../tests/workspace_tests.rs"]
mod tests;
