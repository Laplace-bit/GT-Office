pub mod surface;

use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter, State, Window};
use vb_abstractions::{WorkspaceId, WorkspaceService, WorkspaceSessionSnapshot};

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

fn active_workspace_id(state: &AppState) -> Result<Option<String>, String> {
    let workspaces = state.workspace_service.list().map_err(to_command_error)?;
    Ok(workspaces
        .into_iter()
        .find(|workspace| workspace.active)
        .map(|workspace| workspace.workspace_id.to_string()))
}

fn emit_workspace_updated(app: &AppHandle, workspace_id: &str, kind: &str) -> Result<(), String> {
    app.emit(
        "workspace/updated",
        json!({
            "workspaceId": workspace_id,
            "kind": kind,
        }),
    )
    .map_err(|err| format!("WORKSPACE_EVENT_EMIT_FAILED: {err}"))
}

fn emit_active_changed(
    app: &AppHandle,
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
    let closed = state
        .workspace_service
        .close(&workspace_id)
        .map_err(to_command_error)?;
    if closed {
        let _ = state.remove_workspace_watcher(workspace_id.as_str());
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

#[cfg(test)]
#[path = "../tests/workspace_tests.rs"]
mod tests;
