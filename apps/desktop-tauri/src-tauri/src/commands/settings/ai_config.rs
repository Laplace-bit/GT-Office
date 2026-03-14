use std::collections::BTreeMap;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use vb_ai_config::{
    claude_provider_presets, codex_light_guide, gemini_light_guide, AiAgentConfigStatus,
    AiAgentInstallStatus, AiAgentSnapshotCard, AiConfigAgent, AiConfigReadSnapshotResponse,
    AiConfigService, AiConfigSnapshot, ClaudeDraftInput, ClaudeSnapshot,
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

fn resolve_ai_config_service(
    app: &AppHandle,
    state: &AppState,
) -> Result<AiConfigService, String> {
    Ok(AiConfigService::new(
        state.settings_service.clone(),
        resolve_ai_config_repository(app)?,
    ))
}

fn map_install_status(agent: AgentType) -> AiAgentInstallStatus {
    let status = AgentInstaller::install_status(agent);
    AiAgentInstallStatus {
        installed: status.installed,
        executable: status.executable,
        requires_node: status.requires_node,
        node_ready: status.node_ready,
    }
}

fn claude_summary(config: &vb_ai_config::ClaudeConfigSnapshot) -> Option<String> {
    let provider = config.provider_name.as_deref().unwrap_or("Native Claude");
    let model = config.model.as_deref().unwrap_or("default");
    config
        .active_mode
        .as_ref()
        .map(|mode| format!("{mode:?}: {provider} / {model}"))
}

fn claude_status(config: &vb_ai_config::ClaudeConfigSnapshot) -> AiAgentConfigStatus {
    if config.active_mode.is_some() {
        AiAgentConfigStatus::Configured
    } else {
        AiAgentConfigStatus::Unconfigured
    }
}

fn parse_tool_kind(value: Option<String>) -> AgentToolKind {
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

pub fn augment_terminal_env_for_agent(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
    tool_kind: AgentToolKind,
    mut env: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    if tool_kind != AgentToolKind::Claude {
        return Ok(env);
    }
    let workspace_root = state.workspace_root_path(workspace_id)?;
    let service = resolve_ai_config_service(app, state)?;
    let runtime_env = service
        .build_claude_runtime_env(&workspace_root)
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
    let claude_config = service
        .read_claude_config(&workspace_root)
        .map_err(|error| error.to_string())?;

    let snapshot = AiConfigSnapshot {
        agents: vec![
            AiAgentSnapshotCard {
                agent: AiConfigAgent::Claude,
                title: "Claude Code".to_string(),
                subtitle: "Full provider configuration, model override, and runtime injection."
                    .to_string(),
                install_status: map_install_status(AgentType::ClaudeCode),
                config_status: claude_status(&claude_config),
                active_summary: claude_summary(&claude_config),
            },
            AiAgentSnapshotCard {
                agent: AiConfigAgent::Codex,
                title: "Codex CLI".to_string(),
                subtitle: "Install check and official configuration guidance only in v1."
                    .to_string(),
                install_status: map_install_status(AgentType::Codex),
                config_status: AiAgentConfigStatus::GuidanceOnly,
                active_summary: Some("Use Codex's native login and config flow.".to_string()),
            },
            AiAgentSnapshotCard {
                agent: AiConfigAgent::Gemini,
                title: "Gemini CLI".to_string(),
                subtitle: "Install check and official configuration guidance only in v1."
                    .to_string(),
                install_status: map_install_status(AgentType::Gemini),
                config_status: AiAgentConfigStatus::GuidanceOnly,
                active_summary: Some("Use Gemini's native configuration flow.".to_string()),
            },
        ],
        claude: ClaudeSnapshot {
            presets: claude_provider_presets(),
            config: claude_config,
            can_apply_official_mode: true,
        },
        codex: codex_light_guide(),
        gemini: gemini_light_guide(),
    };

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
    let agent = AiConfigAgent::parse(&agent)
        .ok_or_else(|| "AI_CONFIG_AGENT_UNSUPPORTED: unsupported agent".to_string())?;
    if agent != AiConfigAgent::Claude {
        return Err("AI_CONFIG_AGENT_UNSUPPORTED: only Claude supports advanced provider configuration in v1".to_string());
    }

    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let service = resolve_ai_config_service(&app, &state)?;
    let draft: ClaudeDraftInput = serde_json::from_value(draft)
        .map_err(|error| format!("AI_CONFIG_INVALID_DRAFT: {error}"))?;
    let (preview, stored_preview) = service
        .preview_claude_patch(&workspace_id, &workspace_root, &scope, draft)
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
    let response = service
        .apply_claude_preview(&workspace_id, &workspace_root, &confirmed_by, &preview)
        .map_err(|error| error.to_string())?;
    let _ = app.emit(
        "ai_config/changed",
        serde_json::json!({
            "auditId": response.audit_id,
            "scope": "workspace",
            "changedKeys": preview.changed_keys,
        }),
    );
    Ok(response)
}

pub fn agent_tool_kind_from_param(value: Option<String>) -> AgentToolKind {
    parse_tool_kind(value)
}
