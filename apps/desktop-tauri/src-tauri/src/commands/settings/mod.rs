pub mod ai_config;
pub mod update;

use gt_abstractions::SettingsScope;
use gt_settings::JsonSettingsService;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::app_state::AppState;

#[tauri::command]
pub fn settings_get_effective(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let effective = state.load_effective_settings(workspace_id.as_deref())?;
    Ok(json!({
        "workspaceId": workspace_id,
        "values": effective.values,
        "sources": effective.sources
    }))
}

#[tauri::command]
pub fn settings_update(
    workspace_id: Option<String>,
    scope: String,
    patch: Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let parsed_scope =
        JsonSettingsService::parse_scope(scope.as_str()).map_err(|e| e.to_string())?;
    let effective = state.update_settings(parsed_scope.clone(), workspace_id.as_deref(), &patch)?;
    reload_watchers_if_needed(&state, &app, parsed_scope, workspace_id.as_deref());
    let _ = app.emit(
        "settings/updated",
        json!({
            "workspaceId": workspace_id,
            "scope": scope,
            "tsMs": now_ts_ms(),
        }),
    );

    Ok(json!({
        "workspaceId": workspace_id,
        "scope": scope,
        "patch": patch,
        "updated": true,
        "effective": effective.values
    }))
}

#[tauri::command]
pub fn settings_reset(
    workspace_id: Option<String>,
    scope: String,
    keys: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let parsed_scope =
        JsonSettingsService::parse_scope(scope.as_str()).map_err(|e| e.to_string())?;
    let effective = state.reset_settings(
        parsed_scope.clone(),
        workspace_id.as_deref(),
        keys.as_slice(),
    )?;
    reload_watchers_if_needed(&state, &app, parsed_scope, workspace_id.as_deref());
    let _ = app.emit(
        "settings/updated",
        json!({
            "workspaceId": workspace_id,
            "scope": scope,
            "keys": keys,
            "tsMs": now_ts_ms(),
        }),
    );

    Ok(json!({
        "workspaceId": workspace_id,
        "scope": scope,
        "keys": keys,
        "reset": true,
        "effective": effective.values
    }))
}

fn reload_watchers_if_needed(
    state: &AppState,
    app: &AppHandle,
    scope: SettingsScope,
    workspace_id: Option<&str>,
) {
    match scope {
        SettingsScope::Session => {}
        SettingsScope::Workspace => {
            if let Some(workspace_id) = workspace_id {
                let _ = state.reload_workspace_watcher(app, workspace_id);
            }
        }
        SettingsScope::User => {
            if let Some(workspace_id) = workspace_id {
                let _ = state.reload_workspace_watcher(app, workspace_id);
            } else {
                let _ = state.reload_all_workspace_watchers(app);
            }
        }
    }
}

fn now_ts_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
