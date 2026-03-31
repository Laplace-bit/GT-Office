use std::collections::BTreeMap;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use vb_ai_config::{
    AiConfigAgent, AiConfigReadSnapshotResponse, AiConfigService, ClaudeDraftInput,
    CodexDraftInput, GeminiDraftInput, StoredAiConfigPreview,
};
use vb_session_log::{latest_claude_session_id_for_cwd, SessionLogConfig};
use vb_storage::{SqliteAiConfigRepository, SqliteStorage};
use vb_task::{AgentRuntimeRegistration, AgentToolKind};
use vb_terminal::TerminalSessionProcessSnapshot;
use vb_tools::agent_installer::{AgentInstaller, AgentType};

use crate::app_state::AppState;
use crate::commands::task_center::write_terminal_with_submit;
const GLOBAL_AI_CONFIG_CONTEXT: &str = "global";
const CLAUDE_SESSION_REFRESH_INTERRUPT: &str = "\u{3}";
const CLAUDE_SESSION_REFRESH_DELAY_MS: u64 = 150;

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

fn resolve_ai_workspace_root(
    state: &AppState,
    workspace_id: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    workspace_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| state.workspace_root_path(value))
        .transpose()
}

fn should_inject_provider_env(tool_kind: AgentToolKind, include_provider_env: bool) -> bool {
    include_provider_env && matches!(tool_kind, AgentToolKind::Codex | AgentToolKind::Gemini)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ClaudeRefreshPlan {
    command: String,
    submit_sequence: String,
}

fn is_shell_safe_arg(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|ch| {
            ch.is_ascii_alphanumeric()
                || matches!(ch, '-' | '_' | '.' | '/' | ':' | '=' | '@' | '+')
        })
}

fn shell_escape_arg(value: &str) -> String {
    if is_shell_safe_arg(value) {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn build_claude_refresh_command(session_id: Option<&str>, model: &str) -> Option<String> {
    let model = model.trim();
    if model.is_empty() {
        return None;
    }

    let model_arg = shell_escape_arg(model);
    let session_id = session_id.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    Some(match session_id {
        Some(session_id) => {
            format!(
                "claude --resume {} --model {}",
                shell_escape_arg(session_id),
                model_arg
            )
        }
        None => format!("claude --continue --model {model_arg}"),
    })
}

fn terminal_snapshot_has_running_claude(snapshot: &TerminalSessionProcessSnapshot) -> bool {
    snapshot
        .current_process
        .iter()
        .chain(snapshot.processes.iter())
        .any(|process| {
            let executable = process.executable.to_ascii_lowercase();
            let args = process.args.to_ascii_lowercase();
            executable.contains("claude") || args.contains("claude")
        })
}

fn claude_refresh_session_id(runtime: &AgentRuntimeRegistration) -> Option<String> {
    runtime
        .provider_session
        .as_ref()
        .and_then(|session| {
            session
                .provider_session_id
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| {
                    session
                        .log_path
                        .as_ref()
                        .and_then(|path| Path::new(path).file_stem())
                        .map(|value| value.to_string_lossy().trim().to_string())
                        .filter(|value| !value.is_empty())
                })
        })
        .or_else(|| {
            runtime.resolved_cwd.as_deref().and_then(|cwd| {
                latest_claude_session_id_for_cwd(Path::new(cwd), SessionLogConfig::default())
            })
        })
}

fn build_claude_refresh_plan(
    runtime: &AgentRuntimeRegistration,
    snapshot: &TerminalSessionProcessSnapshot,
    model: &str,
) -> Option<ClaudeRefreshPlan> {
    if runtime.tool_kind != AgentToolKind::Claude || !terminal_snapshot_has_running_claude(snapshot)
    {
        return None;
    }

    let session_id = claude_refresh_session_id(runtime);
    let command = build_claude_refresh_command(session_id.as_deref(), model)?;
    Some(ClaudeRefreshPlan {
        command,
        submit_sequence: runtime
            .submit_sequence
            .clone()
            .unwrap_or_else(|| "\r".to_string()),
    })
}

fn refresh_running_claude_runtimes(state: &AppState, model: Option<&str>) {
    let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };

    for runtime in state.task_service.list_runtimes(None) {
        if runtime.tool_kind != AgentToolKind::Claude {
            continue;
        }

        let snapshot = match state
            .terminal_provider
            .describe_session_processes(&runtime.session_id)
        {
            Ok(snapshot) => snapshot,
            Err(error) => {
                tracing::warn!(
                    session_id = %runtime.session_id,
                    error = %error,
                    "failed to inspect Claude runtime before session refresh"
                );
                continue;
            }
        };
        let Some(plan) = build_claude_refresh_plan(&runtime, &snapshot, model) else {
            continue;
        };

        tracing::info!(
            workspace_id = %runtime.workspace_id,
            agent_id = %runtime.agent_id,
            session_id = %runtime.session_id,
            command = %plan.command,
            "refreshing running Claude runtime after provider switch"
        );

        if let Err(error) = state
            .terminal_provider
            .write_session(&runtime.session_id, CLAUDE_SESSION_REFRESH_INTERRUPT)
        {
            tracing::warn!(
                session_id = %runtime.session_id,
                error = %error,
                "failed to interrupt running Claude session before refresh"
            );
            continue;
        }

        std::thread::sleep(Duration::from_millis(CLAUDE_SESSION_REFRESH_DELAY_MS));

        if let Err(error) = write_terminal_with_submit(
            state,
            &runtime.session_id,
            &plan.command,
            &plan.submit_sequence,
        ) {
            tracing::warn!(
                session_id = %runtime.session_id,
                error = %error,
                "failed to relaunch Claude session with refreshed model"
            );
        }
    }
}

pub fn augment_terminal_env_for_agent(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
    tool_kind: AgentToolKind,
    include_provider_env: bool,
    mut env: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let agent = match tool_kind {
        AgentToolKind::Claude => AiConfigAgent::Claude,
        AgentToolKind::Codex => AiConfigAgent::Codex,
        AgentToolKind::Gemini => AiConfigAgent::Gemini,
        _ => return Ok(env),
    };

    let inject_provider_env = should_inject_provider_env(tool_kind, include_provider_env);
    tracing::debug!(
        ?tool_kind,
        include_provider_env,
        inject_provider_env,
        workspace_id,
        "evaluated terminal provider env injection"
    );

    if inject_provider_env {
        let workspace_root = state.workspace_root_path(workspace_id)?;
        let service = resolve_ai_config_service(app, state)?;
        let runtime_env = service
            .build_agent_runtime_env(agent, &workspace_root)
            .map_err(|error| error.to_string())?;
        env.extend(runtime_env);
    } else if include_provider_env && tool_kind == AgentToolKind::Claude {
        tracing::debug!(
            workspace_id,
            "skipping Claude provider env injection so live settings hot-switching can take effect"
        );
    }
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

    let Some(executable) = AgentInstaller::launch_executable_hint(agent_type) else {
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
    workspace_id: Option<String>,
    allow: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AiConfigReadSnapshotResponse, String> {
    let workspace_root = resolve_ai_workspace_root(&state, workspace_id.as_deref())?;
    let cache_key = workspace_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(GLOBAL_AI_CONFIG_CONTEXT);
    let workspace_root_text = workspace_root
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| GLOBAL_AI_CONFIG_CONTEXT.to_string());

    // Check cache first (5 second TTL)
    if let Ok(Some(cached)) = state.get_ai_config_snapshot_cache(cache_key) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        let cache_age_ms = now_ms.saturating_sub(cached.cached_at_ms);

        if cache_age_ms < 5000 && cached.workspace_root == workspace_root_text {
            tracing::debug!("AI config cache hit for context {}", cache_key);
            return Ok(AiConfigReadSnapshotResponse {
                workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
                allow: allow.unwrap_or_else(|| "strict".to_string()),
                snapshot: cached.snapshot,
                masking: vec!["apiKey".to_string(), "secretRef".to_string()],
            });
        }
        tracing::debug!(
            "AI config cache expired for context {} (age: {}ms)",
            cache_key,
            cache_age_ms
        );
    }

    let workspace_root_for_read = workspace_root.clone();
    let app_for_read = app.clone();
    let settings_service = state.settings_service.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        let service = AiConfigService::new(
            settings_service,
            resolve_ai_config_repository(&app_for_read)?,
        );
        service
            .read_snapshot(GLOBAL_AI_CONFIG_CONTEXT, workspace_root_for_read.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("AI_CONFIG_SNAPSHOT_TASK_FAILED: {error}"))??;

    // Update cache
    let _ = state.set_ai_config_snapshot_cache(cache_key, &workspace_root_text, snapshot.clone());

    Ok(AiConfigReadSnapshotResponse {
        workspace_id: GLOBAL_AI_CONFIG_CONTEXT.to_string(),
        allow: allow.unwrap_or_else(|| "strict".to_string()),
        snapshot,
        masking: vec!["apiKey".to_string(), "secretRef".to_string()],
    })
}

#[tauri::command]
pub fn ai_config_preview_patch(
    workspace_id: Option<String>,
    scope: String,
    agent: String,
    draft: Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<vb_ai_config::AiConfigPreviewResponse, String> {
    let agent_type = AiConfigAgent::parse(&agent)
        .ok_or_else(|| "AI_CONFIG_AGENT_UNSUPPORTED: unsupported agent".to_string())?;

    let workspace_root = resolve_ai_workspace_root(&state, workspace_id.as_deref())?;
    let root_ref = workspace_root.as_deref().unwrap_or_else(|| Path::new(""));
    let service = resolve_ai_config_service(&app, &state)?;

    let (preview, stored_preview) = match agent_type {
        AiConfigAgent::Claude => {
            let draft: ClaudeDraftInput = serde_json::from_value(draft)
                .map_err(|error| format!("AI_CONFIG_INVALID_DRAFT: {error}"))?;
            service.preview_claude_patch(GLOBAL_AI_CONFIG_CONTEXT, root_ref, &scope, draft)
        }
        AiConfigAgent::Codex => {
            let draft: CodexDraftInput = serde_json::from_value(draft)
                .map_err(|error| format!("AI_CONFIG_INVALID_DRAFT: {error}"))?;
            service.preview_codex_patch(GLOBAL_AI_CONFIG_CONTEXT, root_ref, draft)
        }
        AiConfigAgent::Gemini => {
            let draft: GeminiDraftInput = serde_json::from_value(draft)
                .map_err(|error| format!("AI_CONFIG_INVALID_DRAFT: {error}"))?;
            service.preview_gemini_patch(GLOBAL_AI_CONFIG_CONTEXT, root_ref, draft)
        }
    }
    .map_err(|error| error.to_string())?;

    state.cache_ai_config_preview(stored_preview)?;
    Ok(preview)
}

#[tauri::command]
pub fn ai_config_apply_patch(
    workspace_id: Option<String>,
    preview_id: String,
    confirmed_by: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<vb_ai_config::AiConfigApplyResponse, String> {
    let preview = state
        .take_ai_config_preview(&preview_id)?
        .ok_or_else(|| "AI_CONFIG_PREVIEW_NOT_FOUND: preview has expired".to_string())?;
    let workspace_root = resolve_ai_workspace_root(&state, workspace_id.as_deref())?;
    let root_ref = workspace_root.as_deref().unwrap_or_else(|| Path::new(""));
    let service = resolve_ai_config_service(&app, &state)?;

    let _ = state.invalidate_all_ai_config_snapshot_cache();

    let response = match &preview {
        StoredAiConfigPreview::Claude(p) => {
            service.apply_claude_preview(GLOBAL_AI_CONFIG_CONTEXT, root_ref, &confirmed_by, p)
        }
        StoredAiConfigPreview::Codex(p) => {
            service.apply_codex_preview(GLOBAL_AI_CONFIG_CONTEXT, root_ref, &confirmed_by, p)
        }
        StoredAiConfigPreview::Gemini(p) => {
            service.apply_gemini_preview(GLOBAL_AI_CONFIG_CONTEXT, root_ref, &confirmed_by, p)
        }
    }
    .map_err(|error| error.to_string())?;

    let changed_keys = match &preview {
        StoredAiConfigPreview::Claude(p) => p.changed_keys.clone(),
        StoredAiConfigPreview::Codex(p) => p.changed_keys.clone(),
        StoredAiConfigPreview::Gemini(p) => p.changed_keys.clone(),
    };

    let _ = app.emit(
        "ai_config/changed",
        json!({
            "auditId": response.audit_id,
            "scope": GLOBAL_AI_CONFIG_CONTEXT,
            "changedKeys": changed_keys,
        }),
    );

    if matches!(preview, StoredAiConfigPreview::Claude(_)) {
        refresh_running_claude_runtimes(
            state.inner(),
            response.effective.claude.config.model.as_deref(),
        );
    }
    Ok(response)
}

#[tauri::command]
pub fn ai_config_list_audit_logs(
    workspace_id: Option<String>,
    agent: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<vb_storage::AiConfigAuditLogInput>, String> {
    let service = resolve_ai_config_service(&app, &state)?;
    service
        .list_audit_logs(
            workspace_id
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(GLOBAL_AI_CONFIG_CONTEXT),
            &agent,
            limit.unwrap_or(10),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn ai_config_switch_saved_provider(
    workspace_id: Option<String>,
    agent: String,
    saved_provider_id: String,
    confirmed_by: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<vb_ai_config::AiConfigApplyResponse, String> {
    let workspace_root = resolve_ai_workspace_root(&state, workspace_id.as_deref())?;
    let service = resolve_ai_config_service(&app, &state)?;
    let agent = AiConfigAgent::parse(&agent)
        .ok_or_else(|| "AI_CONFIG_AGENT_UNSUPPORTED: unsupported agent".to_string())?;
    let refresh_claude_runtime = agent == AiConfigAgent::Claude;

    let _ = state.invalidate_all_ai_config_snapshot_cache();

    let response = service
        .switch_saved_provider(
            agent,
            workspace_root.as_deref(),
            &saved_provider_id,
            &confirmed_by,
        )
        .map_err(|error| error.to_string())?;

    let _ = app.emit(
        "ai_config/changed",
        json!({
            "auditId": response.audit_id,
            "scope": GLOBAL_AI_CONFIG_CONTEXT,
            "changedKeys": [],
        }),
    );

    if refresh_claude_runtime {
        refresh_running_claude_runtimes(
            state.inner(),
            response.effective.claude.config.model.as_deref(),
        );
    }
    Ok(response)
}

#[tauri::command]
pub fn ai_config_delete_saved_provider(
    workspace_id: Option<String>,
    agent: String,
    saved_provider_id: String,
    confirmed_by: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<vb_ai_config::AiConfigApplyResponse, String> {
    let workspace_root = resolve_ai_workspace_root(&state, workspace_id.as_deref())?;
    let service = resolve_ai_config_service(&app, &state)?;
    let agent = AiConfigAgent::parse(&agent)
        .ok_or_else(|| "AI_CONFIG_AGENT_UNSUPPORTED: unsupported agent".to_string())?;

    let _ = state.invalidate_all_ai_config_snapshot_cache();

    let response = service
        .delete_saved_provider(
            agent,
            workspace_root.as_deref(),
            &saved_provider_id,
            &confirmed_by,
        )
        .map_err(|error| error.to_string())?;

    let _ = app.emit(
        "ai_config/changed",
        json!({
            "auditId": response.audit_id,
            "scope": GLOBAL_AI_CONFIG_CONTEXT,
            "changedKeys": [],
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

#[cfg(test)]
mod tests {
    use vb_task::{AgentProviderSessionMetadata, AgentRuntimeRegistration};
    use vb_terminal::{TerminalSessionProcessInfo, TerminalSessionProcessSnapshot};

    use super::*;

    fn claude_runtime() -> AgentRuntimeRegistration {
        AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "agent-1".to_string(),
            station_id: "station-1".to_string(),
            role_key: None,
            session_id: "term-1".to_string(),
            tool_kind: AgentToolKind::Claude,
            resolved_cwd: Some("/tmp/project/.gtoffice/calude".to_string()),
            submit_sequence: Some("\r".to_string()),
            provider_session: Some(AgentProviderSessionMetadata {
                provider: AgentToolKind::Claude,
                provider_session_id: Some("session-123".to_string()),
                log_path: None,
                session_started_at_ms: None,
                discovery_confidence: None,
            }),
            online: true,
        }
    }

    fn process_snapshot(executable: &str, args: &str) -> TerminalSessionProcessSnapshot {
        TerminalSessionProcessSnapshot {
            session_id: "term-1".to_string(),
            root_pid: Some(100),
            current_process: Some(TerminalSessionProcessInfo {
                pid: 200,
                parent_pid: Some(100),
                executable: executable.to_string(),
                args: args.to_string(),
                depth: 1,
            }),
            processes: vec![],
        }
    }

    #[test]
    fn claude_provider_env_injection_is_disabled_for_hot_switching() {
        assert!(!should_inject_provider_env(AgentToolKind::Claude, true));
    }

    #[test]
    fn codex_and_gemini_provider_env_injection_remain_enabled() {
        assert!(should_inject_provider_env(AgentToolKind::Codex, true));
        assert!(should_inject_provider_env(AgentToolKind::Gemini, true));
        assert!(!should_inject_provider_env(AgentToolKind::Codex, false));
    }

    #[test]
    fn build_claude_refresh_command_prefers_resume_session_id() {
        let command = build_claude_refresh_command(Some("session-123"), "kimi-k2.5")
            .expect("refresh command");
        assert_eq!(command, "claude --resume session-123 --model kimi-k2.5");
    }

    #[test]
    fn build_claude_refresh_command_falls_back_to_continue_when_session_id_is_missing() {
        let command = build_claude_refresh_command(None, "kimi-k2.5").expect("refresh command");
        assert_eq!(command, "claude --continue --model kimi-k2.5");
    }

    #[test]
    fn build_claude_refresh_plan_skips_non_claude_processes() {
        let runtime = claude_runtime();
        let snapshot = process_snapshot("/bin/zsh", "zsh");
        assert_eq!(
            build_claude_refresh_plan(&runtime, &snapshot, "kimi-k2.5"),
            None
        );
    }

    #[test]
    fn build_claude_refresh_plan_uses_resume_for_running_claude_process() {
        let runtime = claude_runtime();
        let snapshot = process_snapshot("/Users/dzlin/.local/bin/claude", "claude");
        assert_eq!(
            build_claude_refresh_plan(&runtime, &snapshot, "kimi-k2.5"),
            Some(ClaudeRefreshPlan {
                command: "claude --resume session-123 --model kimi-k2.5".to_string(),
                submit_sequence: "\r".to_string(),
            })
        );
    }
}
