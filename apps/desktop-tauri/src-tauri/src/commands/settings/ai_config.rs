use std::collections::BTreeMap;
use std::env;
use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use vb_ai_config::{
    AiConfigAgent, AiConfigReadSnapshotResponse, AiConfigService, ClaudeDraftInput,
    LightAgentDraftInput, StoredAiConfigPreview,
};
use vb_storage::{SqliteAiConfigRepository, SqliteStorage};
use vb_task::AgentToolKind;
use vb_tools::agent_installer::{AgentInstaller, AgentType};

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

fn resolve_ai_config_service(app: &AppHandle, state: &AppState) -> Result<AiConfigService, String> {
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
    augment_terminal_command_env(tool_kind, &mut env);
    Ok(env)
}

fn augment_terminal_command_env(tool_kind: AgentToolKind, env_map: &mut BTreeMap<String, String>) {
    let (agent_type, override_var) = match tool_kind {
        AgentToolKind::Claude => (AgentType::ClaudeCode, "GTO_CLAUDE_COMMAND"),
        AgentToolKind::Codex => (AgentType::Codex, "GTO_CODEX_COMMAND"),
        AgentToolKind::Gemini => (AgentType::Gemini, "GTO_GEMINI_COMMAND"),
        _ => return,
    };

    let status = AgentInstaller::install_status(agent_type);
    let Some(executable) = status.executable else {
        return;
    };

    env_map.insert(override_var.to_string(), executable.clone());

    let Some(parent) = Path::new(&executable).parent() else {
        return;
    };
    let parent_str = parent.to_string_lossy().trim().to_string();
    if parent_str.is_empty() {
        return;
    }

    let current_path = env_map
        .get("PATH")
        .cloned()
        .or_else(|| env::var("PATH").ok())
        .unwrap_or_default();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let mut parts = current_path
        .split(separator)
        .filter(|part| !part.trim().is_empty())
        .map(|part| part.to_string())
        .collect::<Vec<_>>();

    if !parts.iter().any(|part| part == &parent_str) {
        parts.insert(0, parent_str);
    }

    env_map.insert("PATH".to_string(), parts.join(&separator.to_string()));
}

#[tauri::command]
pub async fn ai_config_read_snapshot(
    workspace_id: String,
    allow: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AiConfigReadSnapshotResponse, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let workspace_root = state.workspace_root_path(&workspace_id)?;

    // Check cache first (5 second TTL)
    if let Ok(Some(cached)) = state.get_ai_config_snapshot_cache(&workspace_id) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        let cache_age_ms = now_ms.saturating_sub(cached.cached_at_ms);

        // Cache valid for 5 seconds, and workspace root must match
        if cache_age_ms < 5000
            && cached.workspace_root == workspace_root.to_string_lossy().to_string()
        {
            tracing::debug!("AI config cache hit for workspace {}", workspace_id);
            return Ok(AiConfigReadSnapshotResponse {
                workspace_id,
                allow: allow.unwrap_or_else(|| "strict".to_string()),
                snapshot: cached.snapshot,
                masking: vec!["apiKey".to_string(), "secretRef".to_string()],
            });
        }
        tracing::debug!(
            "AI config cache expired for workspace {} (age: {}ms)",
            workspace_id,
            cache_age_ms
        );
    }

    let workspace_root_for_read = workspace_root.clone();
    let workspace_id_for_read = workspace_id.clone();
    let app_for_read = app.clone();
    let settings_service = state.settings_service.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        let service = AiConfigService::new(
            settings_service,
            resolve_ai_config_repository(&app_for_read)?,
        );
        service
            .read_snapshot(&workspace_id_for_read, &workspace_root_for_read)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("AI_CONFIG_SNAPSHOT_TASK_FAILED: {error}"))??;

    // Update cache
    let _ = state.set_ai_config_snapshot_cache(
        &workspace_id,
        &workspace_root.to_string_lossy(),
        snapshot.clone(),
    );

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

    // Invalidate cache before applying changes
    let _ = state.invalidate_ai_config_snapshot_cache(&workspace_id);

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
        StoredAiConfigPreview::Codex(p) | StoredAiConfigPreview::Gemini(p) => {
            p.changed_keys.clone()
        }
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

#[tauri::command]
pub fn ai_config_switch_saved_claude_provider(
    workspace_id: String,
    saved_provider_id: String,
    confirmed_by: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<vb_ai_config::AiConfigApplyResponse, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let service = resolve_ai_config_service(&app, &state)?;

    // Invalidate cache before switching
    let _ = state.invalidate_ai_config_snapshot_cache(&workspace_id);

    let response = service
        .switch_saved_claude_provider(
            &workspace_id,
            &workspace_root,
            &saved_provider_id,
            &confirmed_by,
        )
        .map_err(|error| error.to_string())?;

    let _ = app.emit(
        "ai_config/changed",
        json!({
            "auditId": response.audit_id,
            "scope": "workspace",
            "changedKeys": [
                "ai.providers.claude.savedProviderId",
                "ai.providers.claude.activeMode",
                "ai.providers.claude.providerId",
                "ai.providers.claude.providerName",
                "ai.providers.claude.baseUrl",
                "ai.providers.claude.model",
                "ai.providers.claude.authScheme",
            ],
        }),
    );
    Ok(response)
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
