use std::collections::BTreeMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use vb_ai_config::{
    AiConfigAgent, AiConfigReadSnapshotResponse, AiConfigService, ClaudeDraftInput,
    LightAgentDraftInput, StoredAiConfigPreview,
};
use vb_storage::{SqliteAiConfigRepository, SqliteStorage};
use vb_task::AgentToolKind;

use crate::app_state::AppState;

fn ensure_workspace_exists(state: &AppState, workspace_id: &str) -> Result<(), String> {
    state.workspace_root_path(workspace_id).map(|_| ())
}

fn resolve_ai_config_repository(app: &AppHandle) -> Result<SqliteAiConfigRepository, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("AI_CONFIG_STORAGE_PATH_FAILED: {error}"))?;
    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("AI_CONFIG_STORAGE_PATH_FAILED: {error}"))?;
    let db_path = base_dir.join("gtoffice.db");
    let storage = SqliteStorage::new(db_path).map_err(|error| error.to_string())?;
    Ok(SqliteAiConfigRepository::new(storage))
}

fn resolve_ai_config_service(
    app: &AppHandle,
    state: &AppState,
) -> Result<AiConfigService, String> {
    Ok(AiConfigService::new(
        state.settings_service.clone(),
        resolve_ai_config_repository(app)?,
    ))
}

pub fn augment_terminal_env_for_agent(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
    tool_kind: AgentToolKind,
    mut env: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let agent = match tool_kind {
        AgentToolKind::Claude => AiConfigAgent::Claude,
        AgentToolKind::Codex => AiConfigAgent::Codex,
        AgentToolKind::Gemini => AiConfigAgent::Gemini,
        _ => return Ok(env),
    };

    let workspace_root = state.workspace_root_path(workspace_id)?;
    let service = resolve_ai_config_service(app, state)?;
    let runtime_env = service
        .build_agent_runtime_env(agent, &workspace_root)
        .map_err(|error| error.to_string())?;
    env.extend(runtime_env);
    Ok(env)
}

#[tauri::command]
pub fn ai_config_read_snapshot(
    workspace_id: String,
    allow: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AiConfigReadSnapshotResponse, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let service = resolve_ai_config_service(&app, &state)?;
    let snapshot = service
        .read_snapshot(&workspace_id, &workspace_root)
        .map_err(|error| error.to_string())?;

    Ok(AiConfigReadSnapshotResponse {
        workspace_id,
        allow: allow.unwrap_or_else(|| "strict".to_string()),
        snapshot,
        masking: vec!["apiKey".to_string(), "secretRef".to_string()],
    })
}

#[tauri::command]
pub fn ai_config_preview_patch(
    workspace_id: String,
    scope: String,
    agent: String,
    draft: Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<vb_ai_config::AiConfigPreviewResponse, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let agent_type = AiConfigAgent::parse(&agent)
        .ok_or_else(|| "AI_CONFIG_AGENT_UNSUPPORTED: unsupported agent".to_string())?;

    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let service = resolve_ai_config_service(&app, &state)?;

    let (preview, stored_preview) = match agent_type {
        AiConfigAgent::Claude => {
            let draft: ClaudeDraftInput = serde_json::from_value(draft)
                .map_err(|error| format!("AI_CONFIG_INVALID_DRAFT: {error}"))?;
            service.preview_claude_patch(&workspace_id, &workspace_root, &scope, draft)
        }
        AiConfigAgent::Codex | AiConfigAgent::Gemini => {
            let draft: LightAgentDraftInput = serde_json::from_value(draft)
                .map_err(|error| format!("AI_CONFIG_INVALID_DRAFT: {error}"))?;
            service.preview_light_agent_patch(&workspace_id, &workspace_root, agent_type, draft)
        }
    }
    .map_err(|error| error.to_string())?;

    state.cache_ai_config_preview(stored_preview)?;
    Ok(preview)
}

#[tauri::command]
pub fn ai_config_apply_patch(
    workspace_id: String,
    preview_id: String,
    confirmed_by: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<vb_ai_config::AiConfigApplyResponse, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let preview = state
        .take_ai_config_preview(&preview_id)?
        .ok_or_else(|| "AI_CONFIG_PREVIEW_NOT_FOUND: preview has expired".to_string())?;
    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let service = resolve_ai_config_service(&app, &state)?;

    let response = match &preview {
        StoredAiConfigPreview::Claude(p) => {
            service.apply_claude_preview(&workspace_id, &workspace_root, &confirmed_by, p)
        }
        StoredAiConfigPreview::Codex(p) | StoredAiConfigPreview::Gemini(p) => {
            service.apply_light_agent_preview(&workspace_id, &workspace_root, &confirmed_by, p)
        }
    }
    .map_err(|error| error.to_string())?;

    let changed_keys = match &preview {
        StoredAiConfigPreview::Claude(p) => p.changed_keys.clone(),
        StoredAiConfigPreview::Codex(p) | StoredAiConfigPreview::Gemini(p) => p.changed_keys.clone(),
    };

    let _ = app.emit(
        "ai_config/changed",
        json!({
            "auditId": response.audit_id,
            "scope": "workspace",
            "changedKeys": changed_keys,
        }),
    );
    Ok(response)
}

#[tauri::command]
pub fn ai_config_list_audit_logs(
    workspace_id: String,
    agent: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<vb_storage::AiConfigAuditLogInput>, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let service = resolve_ai_config_service(&app, &state)?;
    service
        .list_audit_logs(&workspace_id, &agent, limit.unwrap_or(10))
        .map_err(|error| error.to_string())
}

pub fn agent_tool_kind_from_param(value: Option<String>) -> AgentToolKind {
    match value
        .unwrap_or_else(|| "unknown".to_string())
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "claude" => AgentToolKind::Claude,
        "codex" => AgentToolKind::Codex,
        "gemini" => AgentToolKind::Gemini,
        "shell" => AgentToolKind::Shell,
        _ => AgentToolKind::Unknown,
    }
}
