use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use vb_abstractions::{
    AbstractionError, TerminalCreateRequest, TerminalCwdMode, TerminalProvider, WorkspaceId,
};
use vb_ai_config::{
    AiConfigService, AiConfigSnapshot, ClaudeConfigSnapshot, CodexConfigSnapshot,
    GeminiConfigSnapshot,
};
use vb_storage::{SqliteAiConfigRepository, SqliteStorage};
use vb_task::{AgentRuntimeRegistration, AgentToolKind};

use crate::{
    app_state::AppState,
    commands::{
        settings::ai_config::augment_terminal_env_for_agent,
        task_center::write_terminal_with_submit,
    },
    mcp_bridge::refresh_directory_snapshot,
};

const AI_CONFIG_CACHE_TTL_MS: u64 = 5_000;
const TOOL_PROMPT_INJECTION_DELAY_MS: u64 = 150;

pub(crate) fn canonical_profile_tool_kind(profile_id: &str) -> Option<AgentToolKind> {
    match profile_id.trim().to_ascii_lowercase().as_str() {
        "claude" | "claude-code" => Some(AgentToolKind::Claude),
        "codex" | "codex-cli" => Some(AgentToolKind::Codex),
        "gemini" | "gemini-cli" => Some(AgentToolKind::Gemini),
        _ => None,
    }
}

pub(crate) fn canonical_profile_id(tool_kind: AgentToolKind) -> &'static str {
    match tool_kind {
        AgentToolKind::Claude => "claude",
        AgentToolKind::Codex => "codex",
        AgentToolKind::Gemini => "gemini",
        AgentToolKind::Shell | AgentToolKind::Unknown => "unknown",
    }
}

pub(crate) fn profile_title(tool_kind: AgentToolKind) -> &'static str {
    match tool_kind {
        AgentToolKind::Claude => "Claude",
        AgentToolKind::Codex => "Codex",
        AgentToolKind::Gemini => "Gemini",
        AgentToolKind::Shell | AgentToolKind::Unknown => "Unknown",
    }
}

fn default_launch_command(tool_kind: AgentToolKind) -> &'static str {
    canonical_profile_id(tool_kind)
}

fn to_terminal_error(error: AbstractionError) -> String {
    match error {
        AbstractionError::WorkspaceNotFound { workspace_id } => {
            format!("WORKSPACE_NOT_FOUND: workspace '{workspace_id}' does not exist")
        }
        AbstractionError::InvalidArgument { message } => message,
        AbstractionError::AccessDenied { message } => message,
        AbstractionError::Conflict { message } => format!("TERMINAL_CONFLICT: {message}"),
        AbstractionError::Internal { message } => message,
    }
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

pub(crate) fn read_ai_config_snapshot(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> Result<AiConfigSnapshot, String> {
    let workspace_root = state.workspace_root_path(workspace_id)?;
    let workspace_root_text = workspace_root.to_string_lossy().to_string();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    if let Ok(Some(cached)) = state.get_ai_config_snapshot_cache(workspace_id) {
        let cache_age_ms = now_ms.saturating_sub(cached.cached_at_ms);
        if cache_age_ms < AI_CONFIG_CACHE_TTL_MS && cached.workspace_root == workspace_root_text {
            return Ok(cached.snapshot);
        }
    }

    let service = resolve_ai_config_service(app, state)?;
    let snapshot = service
        .read_snapshot(workspace_id, &workspace_root)
        .map_err(|error| error.to_string())?;
    let _ =
        state.set_ai_config_snapshot_cache(workspace_id, &workspace_root_text, snapshot.clone());
    Ok(snapshot)
}

fn claude_provider_summary(config: &ClaudeConfigSnapshot) -> Option<String> {
    let provider = config.provider_name.as_deref().unwrap_or("Native Claude");
    let model = config.model.as_deref().unwrap_or("default");
    config
        .active_mode
        .as_ref()
        .map(|mode| format!("{mode:?}: {provider} / {model}"))
}

fn codex_provider_summary(config: &CodexConfigSnapshot) -> Option<String> {
    let provider = config.provider_name.as_deref().unwrap_or("Codex");
    let model = config.model.as_deref().unwrap_or("default");
    config
        .active_mode
        .as_ref()
        .map(|mode| format!("{mode:?}: {provider} / {model}"))
}

fn gemini_provider_summary(config: &GeminiConfigSnapshot) -> Option<String> {
    let provider = config.provider_name.as_deref().unwrap_or("Gemini");
    let model = config.model.as_deref().unwrap_or("default");
    config
        .active_mode
        .as_ref()
        .map(|mode| format!("{mode:?}: {provider} / {model}"))
}

fn profile_warnings(snapshot: &AiConfigSnapshot, tool_kind: AgentToolKind) -> Vec<String> {
    match tool_kind {
        AgentToolKind::Claude => {
            if snapshot.claude.config.active_mode.is_some() {
                Vec::new()
            } else {
                vec![
                    "TOOL_PROFILE_PROVIDER_UNCONFIGURED: Claude has no active GT Office provider for this workspace; launch will fall back to existing CLI defaults."
                        .to_string(),
                ]
            }
        }
        AgentToolKind::Codex => {
            if snapshot.codex.config.active_mode.is_some() {
                Vec::new()
            } else {
                vec![
                    "TOOL_PROFILE_PROVIDER_UNCONFIGURED: Codex has no active GT Office provider for this workspace; launch will fall back to existing local CLI config."
                        .to_string(),
                ]
            }
        }
        AgentToolKind::Gemini => {
            if snapshot.gemini.config.active_mode.is_some() {
                Vec::new()
            } else {
                vec![
                    "TOOL_PROFILE_PROVIDER_UNCONFIGURED: Gemini has no active GT Office provider for this workspace; launch will fall back to existing local CLI config."
                        .to_string(),
                ]
            }
        }
        AgentToolKind::Shell | AgentToolKind::Unknown => {
            vec!["TOOL_PROFILE_UNSUPPORTED: unsupported tool profile".to_string()]
        }
    }
}

fn dock_icon(tool_kind: AgentToolKind) -> &'static str {
    match tool_kind {
        AgentToolKind::Claude | AgentToolKind::Codex | AgentToolKind::Gemini => "sparkles",
        AgentToolKind::Shell | AgentToolKind::Unknown => "terminal",
    }
}

fn build_profile_value(
    workspace_id: &str,
    snapshot: &AiConfigSnapshot,
    tool_kind: AgentToolKind,
) -> Value {
    let (configured, provider_summary, provider_metadata) = match tool_kind {
        AgentToolKind::Claude => (
            snapshot.claude.config.active_mode.is_some(),
            claude_provider_summary(&snapshot.claude.config),
            json!({
                "savedProviderId": snapshot.claude.config.saved_provider_id,
                "activeMode": snapshot.claude.config.active_mode,
                "providerId": snapshot.claude.config.provider_id,
                "providerName": snapshot.claude.config.provider_name,
                "baseUrl": snapshot.claude.config.base_url,
                "model": snapshot.claude.config.model,
                "authScheme": snapshot.claude.config.auth_scheme,
                "hasSecret": snapshot.claude.config.has_secret,
                "updatedAtMs": snapshot.claude.config.updated_at_ms,
            }),
        ),
        AgentToolKind::Codex => (
            snapshot.codex.config.active_mode.is_some(),
            codex_provider_summary(&snapshot.codex.config),
            json!({
                "activeMode": snapshot.codex.config.active_mode,
                "providerId": snapshot.codex.config.provider_id,
                "providerName": snapshot.codex.config.provider_name,
                "baseUrl": snapshot.codex.config.base_url,
                "model": snapshot.codex.config.model,
                "hasSecret": snapshot.codex.config.has_secret,
                "updatedAtMs": snapshot.codex.config.updated_at_ms,
                "configPath": snapshot.codex.config_path,
                "docsUrl": snapshot.codex.docs_url,
            }),
        ),
        AgentToolKind::Gemini => (
            snapshot.gemini.config.active_mode.is_some(),
            gemini_provider_summary(&snapshot.gemini.config),
            json!({
                "activeMode": snapshot.gemini.config.active_mode,
                "authMode": snapshot.gemini.config.auth_mode,
                "providerId": snapshot.gemini.config.provider_id,
                "providerName": snapshot.gemini.config.provider_name,
                "baseUrl": snapshot.gemini.config.base_url,
                "model": snapshot.gemini.config.model,
                "selectedType": snapshot.gemini.config.selected_type,
                "hasSecret": snapshot.gemini.config.has_secret,
                "updatedAtMs": snapshot.gemini.config.updated_at_ms,
                "configPath": snapshot.gemini.config_path,
                "docsUrl": snapshot.gemini.docs_url,
            }),
        ),
        AgentToolKind::Shell | AgentToolKind::Unknown => (false, None, json!({})),
    };

    json!({
        "workspaceId": workspace_id,
        "id": canonical_profile_id(tool_kind),
        "profileId": canonical_profile_id(tool_kind),
        "toolKind": canonical_profile_id(tool_kind),
        "label": profile_title(tool_kind),
        "shortLabel": profile_title(tool_kind),
        "tooltip": format!("Launch {} with workspace-aware GT Office provider config", profile_title(tool_kind)),
        "icon": dock_icon(tool_kind),
        "providerKind": canonical_profile_id(tool_kind),
        "category": "launch_tool",
        "surfaceTarget": "tool_adapter",
        "scopeKind": "station",
        "priority": match tool_kind {
            AgentToolKind::Claude => 400,
            AgentToolKind::Codex => 410,
            AgentToolKind::Gemini => 420,
            AgentToolKind::Shell | AgentToolKind::Unknown => 900,
        },
        "group": "profiles",
        "requiresLiveSession": false,
        "supportsDetachedWindow": false,
        "supportsParallelTargets": true,
        "title": profile_title(tool_kind),
        "launchMode": "dock",
        "configured": configured,
        "providerSummary": provider_summary,
        "provider": provider_metadata,
        "launchDefaults": {
            "cwdMode": "workspace_root",
            "submitSequence": "\r",
        },
        "supports": {
            "workspaceScoped": true,
            "customCwd": true,
            "relativeCwd": true,
            "initialPrompt": true,
        },
        "warnings": profile_warnings(snapshot, tool_kind),
    })
}

fn context_string(context: Option<&Value>, keys: &[&str]) -> Option<String> {
    let object = context?.as_object()?;
    for key in keys {
        let Some(value) = object.get(*key).and_then(Value::as_str) else {
            continue;
        };
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn context_string_list(context: Option<&Value>, keys: &[&str]) -> Vec<String> {
    let Some(object) = context.and_then(Value::as_object) else {
        return Vec::new();
    };

    for key in keys {
        let Some(values) = object.get(*key).and_then(Value::as_array) else {
            continue;
        };
        let collected = values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !collected.is_empty() {
            return collected;
        }
    }

    Vec::new()
}

fn context_env_map(context: Option<&Value>) -> BTreeMap<String, String> {
    let Some(env_object) = context
        .and_then(Value::as_object)
        .and_then(|object| object.get("env"))
        .and_then(Value::as_object)
    else {
        return BTreeMap::new();
    };

    env_object
        .iter()
        .filter_map(|(key, value)| value.as_str().map(|raw| (key.trim(), raw.trim())))
        .filter(|(key, value)| !key.is_empty() && !value.is_empty())
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

fn resolve_workspace_scoped_path(candidate: &str, workspace_root: &Path) -> Option<String> {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return None;
    }

    let path = Path::new(candidate);
    let resolved = if path.is_absolute() {
        PathBuf::from(path)
    } else {
        workspace_root.join(path)
    };
    Some(resolved.to_string_lossy().to_string())
}

fn resolve_launch_cwd(context: Option<&Value>, workspace_root: &Path) -> Option<String> {
    let candidates = [
        "cwd",
        "workdir",
        "launchCwd",
        "agentWorkdirRel",
        "workdirRel",
        "roleWorkdirRel",
    ];
    for key in candidates {
        if let Some(value) = context_string(context, &[key]) {
            return resolve_workspace_scoped_path(&value, workspace_root);
        }
    }
    None
}

fn parse_launch_cwd_mode(
    context: Option<&Value>,
    has_custom_cwd: bool,
) -> Result<TerminalCwdMode, String> {
    let raw_mode = context_string(context, &["cwdMode"]);
    match raw_mode.as_deref() {
        Some("workspace_root") => Ok(TerminalCwdMode::WorkspaceRoot),
        Some("custom") => Ok(TerminalCwdMode::Custom),
        Some(invalid) => Err(format!(
            "TOOL_LAUNCH_CONTEXT_INVALID: unsupported cwdMode '{invalid}'"
        )),
        None if has_custom_cwd => Ok(TerminalCwdMode::Custom),
        None => Ok(TerminalCwdMode::WorkspaceRoot),
    }
}

fn build_initial_prompt(context: Option<&Value>) -> Option<String> {
    let primary = context_string(
        context,
        &[
            "initialPrompt",
            "prompt",
            "task",
            "instruction",
            "message",
            "query",
        ],
    );
    let selection = context_string(context, &["selection"]);
    let notes = context_string(context, &["notes"]);
    let files = context_string_list(context, &["files", "paths", "openFiles"]);

    let mut sections = Vec::new();
    if let Some(primary) = primary {
        sections.push(primary);
    }
    if !files.is_empty() {
        sections.push(format!(
            "Relevant files:\n{}",
            files
                .iter()
                .map(|path| format!("- {path}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if let Some(selection) = selection {
        sections.push(format!("Selection:\n{selection}"));
    }
    if let Some(notes) = notes {
        sections.push(format!("Notes:\n{notes}"));
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}

fn build_launch_env(
    workspace_id: &str,
    agent_id: &str,
    role_key: Option<&str>,
    station_id: &str,
) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    env.insert("GTO_WORKSPACE_ID".to_string(), workspace_id.to_string());
    env.insert("GTO_AGENT_ID".to_string(), agent_id.to_string());
    env.insert("GTO_STATION_ID".to_string(), station_id.to_string());
    if let Some(role_key) = role_key.map(str::trim).filter(|value| !value.is_empty()) {
        env.insert("GTO_ROLE_KEY".to_string(), role_key.to_string());
    }
    env
}

fn build_runtime_identity(
    context: Option<&Value>,
    tool_kind: AgentToolKind,
) -> (String, String, Option<String>, String) {
    let provided_agent_id = context_string(context, &["agentId"]);
    let provided_station_id = context_string(context, &["stationId"]);
    let role_key = context_string(context, &["roleKey"]);
    let submit_sequence =
        context_string(context, &["submitSequence"]).unwrap_or_else(|| "\r".to_string());

    let fallback_id = format!(
        "dock-{}-{}",
        canonical_profile_id(tool_kind),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let agent_id = provided_agent_id
        .clone()
        .or_else(|| provided_station_id.clone())
        .unwrap_or(fallback_id);
    let station_id = provided_station_id.unwrap_or_else(|| agent_id.clone());

    (agent_id, station_id, role_key, submit_sequence)
}

#[tauri::command]
pub fn tool_list_profiles(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let snapshot = read_ai_config_snapshot(&app, state.inner(), &workspace_id)?;
    let profiles = [
        AgentToolKind::Claude,
        AgentToolKind::Codex,
        AgentToolKind::Gemini,
    ]
    .into_iter()
    .map(|tool_kind| build_profile_value(&workspace_id, &snapshot, tool_kind))
    .collect::<Vec<_>>();
    Ok(json!({ "workspaceId": workspace_id, "profiles": profiles }))
}

#[tauri::command]
pub fn tool_launch(
    workspace_id: String,
    profile_id: String,
    context: Option<Value>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let tool_kind = canonical_profile_tool_kind(&profile_id).ok_or_else(|| {
        format!(
            "TOOL_PROFILE_UNSUPPORTED: unsupported tool profile '{}'",
            profile_id.trim()
        )
    })?;
    let profile_id_canonical = canonical_profile_id(tool_kind).to_string();
    let workspace_root = state.workspace_root_path(&workspace_id)?;
    let resolved_cwd = resolve_launch_cwd(context.as_ref(), &workspace_root);
    let cwd_mode = parse_launch_cwd_mode(context.as_ref(), resolved_cwd.is_some())?;
    let shell_name =
        context_string(context.as_ref(), &["shell"]).unwrap_or_else(|| "auto".to_string());
    let initial_prompt = build_initial_prompt(context.as_ref());
    let (agent_id, station_id, role_key, submit_sequence) =
        build_runtime_identity(context.as_ref(), tool_kind);

    let mut env = build_launch_env(&workspace_id, &agent_id, role_key.as_deref(), &station_id);
    env.extend(context_env_map(context.as_ref()));
    let env = augment_terminal_env_for_agent(&app, state.inner(), &workspace_id, tool_kind, env)?;

    let request = TerminalCreateRequest {
        workspace_id: WorkspaceId::new(workspace_id.clone()),
        shell: Some(shell_name.clone()),
        cwd: resolved_cwd.clone(),
        cwd_mode: cwd_mode.clone(),
        env,
        agent_tool_kind: Some(profile_id_canonical.clone()),
    };
    let session = state
        .terminal_provider
        .create_session(request)
        .map_err(to_terminal_error)?;

    let launch_command = default_launch_command(tool_kind).to_string();
    write_terminal_with_submit(
        state.inner(),
        &session.session_id,
        &launch_command,
        &submit_sequence,
    )?;

    if let Some(prompt) = initial_prompt
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        thread::sleep(Duration::from_millis(TOOL_PROMPT_INJECTION_DELAY_MS));
        write_terminal_with_submit(state.inner(), &session.session_id, prompt, &submit_sequence)?;
    }

    state
        .task_service
        .register_runtime(AgentRuntimeRegistration {
            workspace_id: workspace_id.clone(),
            agent_id: agent_id.clone(),
            station_id: station_id.clone(),
            role_key: role_key.clone(),
            session_id: session.session_id.clone(),
            tool_kind,
            resolved_cwd: Some(session.resolved_cwd.clone()),
            submit_sequence: Some(submit_sequence.clone()),
            provider_session: None,
            online: true,
        });
    let _ = refresh_directory_snapshot(&app, state.inner(), &workspace_id);

    Ok(json!({
        "workspaceId": workspace_id,
        "profileId": profile_id_canonical,
        "toolKind": canonical_profile_id(tool_kind),
        "context": context,
        "toolSessionId": agent_id,
        "terminalSessionId": session.session_id,
        "stationId": station_id,
        "roleKey": role_key,
        "resolvedCwd": session.resolved_cwd,
        "shell": shell_name,
        "submitSequence": submit_sequence,
        "launchCommand": launch_command,
        "initialPrompt": initial_prompt,
    }))
}

#[tauri::command]
pub fn tool_validate_profile(
    profile: Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let profile_id = context_string(Some(&profile), &["profileId", "id", "toolKind"]);
    let workspace_id = context_string(Some(&profile), &["workspaceId"]);

    let Some(tool_kind) = profile_id.as_deref().and_then(canonical_profile_tool_kind) else {
        return Ok(json!({
            "profile": profile,
            "valid": false,
            "warnings": ["TOOL_PROFILE_UNSUPPORTED: unsupported tool profile"],
        }));
    };

    let mut warnings = Vec::new();
    if let Some(workspace_id) = workspace_id.as_deref() {
        match read_ai_config_snapshot(&app, state.inner(), workspace_id) {
            Ok(snapshot) => warnings.extend(profile_warnings(&snapshot, tool_kind)),
            Err(error) => warnings.push(format!(
                "TOOL_PROFILE_WORKSPACE_INVALID: unable to load workspace context: {error}"
            )),
        }
    }

    Ok(json!({
        "profile": profile,
        "valid": true,
        "profileId": canonical_profile_id(tool_kind),
        "toolKind": canonical_profile_id(tool_kind),
        "warnings": warnings,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_profile_tool_kind_supports_cli_aliases() {
        assert_eq!(
            canonical_profile_tool_kind("claude"),
            Some(AgentToolKind::Claude)
        );
        assert_eq!(
            canonical_profile_tool_kind("claude-code"),
            Some(AgentToolKind::Claude)
        );
        assert_eq!(
            canonical_profile_tool_kind("codex-cli"),
            Some(AgentToolKind::Codex)
        );
        assert_eq!(
            canonical_profile_tool_kind("gemini"),
            Some(AgentToolKind::Gemini)
        );
        assert_eq!(canonical_profile_tool_kind("shell"), None);
    }

    #[test]
    fn resolve_launch_cwd_joins_relative_station_paths_to_workspace_root() {
        let workspace_root = PathBuf::from("/tmp/gto-workspace");
        let context = json!({
            "agentWorkdirRel": ".gtoffice/org/build/agent-01"
        });

        let resolved = resolve_launch_cwd(Some(&context), &workspace_root).expect("resolved cwd");
        assert_eq!(
            PathBuf::from(resolved),
            workspace_root.join(".gtoffice/org/build/agent-01")
        );
    }

    #[test]
    fn build_initial_prompt_includes_primary_text_files_and_selection() {
        let context = json!({
            "prompt": "Review the latest changes.",
            "files": ["src/main.rs", "Cargo.toml"],
            "selection": "Focus on the launch flow.",
            "notes": "Keep the diff small.",
        });

        let prompt = build_initial_prompt(Some(&context)).expect("prompt");
        assert!(prompt.contains("Review the latest changes."));
        assert!(prompt.contains("Relevant files:\n- src/main.rs\n- Cargo.toml"));
        assert!(prompt.contains("Selection:\nFocus on the launch flow."));
        assert!(prompt.contains("Notes:\nKeep the diff small."));
    }
}
