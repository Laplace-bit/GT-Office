use std::collections::BTreeMap;
use std::env;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use futures_util::future::join_all;
use gt_ai_config::{
    AiConfigAgent, AiConfigReadSnapshotResponse, AiConfigService, ClaudeDraftInput,
    CodexDraftInput, GeminiDraftInput, StoredAiConfigPreview,
};
use gt_storage::{SqliteAiConfigRepository, SqliteStorage};
use gt_task::AgentToolKind;
use gt_tools::agent_installer::{AgentInstaller, AgentType};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_state::AppState;
pub(super) const GLOBAL_AI_CONFIG_CONTEXT: &str = "global";

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

pub(super) fn resolve_ai_config_service(
    app: &AppHandle,
    state: &AppState,
) -> Result<AiConfigService, String> {
    Ok(AiConfigService::new(
        state.settings_service.clone(),
        resolve_ai_config_repository(app)?,
    ))
}

pub(super) fn resolve_ai_workspace_root(
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

    // Prepend the executable's parent directory to PATH
    if let Some(parent) = Path::new(&executable).parent() {
        let parent_str = parent.to_string_lossy().trim().to_string();
        if !parent_str.is_empty() && !parts.iter().any(|part| part == &parent_str) {
            parts.insert(0, parent_str);
        }
    }

    // For node-wrapped commands (codex, gemini), also prepend the node runtime
    // directory to PATH so the shebang #!/usr/bin/env node can resolve node.
    if AgentInstaller::requires_node_env(agent_type) {
        if let Some(node_dir) = AgentInstaller::find_node_runtime_dir() {
            let node_dir_str = node_dir.to_string_lossy().trim().to_string();
            if !node_dir_str.is_empty() && !parts.iter().any(|part| part == &node_dir_str) {
                parts.insert(0, node_dir_str);
            }
        }
    }

    // Prepend common binary directories (homebrew, fnm, nvm, cargo, etc.)
    // to PATH. macOS GUI apps inherit a minimal PATH that lacks these entries,
    // so shell initialization (e.g. fnm env) may fail to find required tools.
    // Adding them here ensures they are available even before the shell profile runs.
    let common_dirs = AgentInstaller::common_binary_dirs();
    for dir in common_dirs.into_iter().rev() {
        let dir_str = dir.to_string_lossy().trim().to_string();
        if !dir_str.is_empty() && !parts.iter().any(|part| part == &dir_str) {
            parts.insert(0, dir_str);
        }
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
) -> Result<gt_ai_config::AiConfigPreviewResponse, String> {
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
) -> Result<gt_ai_config::AiConfigApplyResponse, String> {
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
    Ok(response)
}

#[tauri::command]
pub fn ai_config_list_audit_logs(
    workspace_id: Option<String>,
    agent: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<gt_storage::AiConfigAuditLogInput>, String> {
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
) -> Result<gt_ai_config::AiConfigApplyResponse, String> {
    let workspace_root = resolve_ai_workspace_root(&state, workspace_id.as_deref())?;
    let service = resolve_ai_config_service(&app, &state)?;
    let agent = AiConfigAgent::parse(&agent)
        .ok_or_else(|| "AI_CONFIG_AGENT_UNSUPPORTED: unsupported agent".to_string())?;

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
) -> Result<gt_ai_config::AiConfigApplyResponse, String> {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigFetchedModel {
    pub id: String,
    pub owned_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigEndpointTestResult {
    pub url: String,
    pub latency_ms: Option<u128>,
    pub status_code: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Option<Vec<OpenAiModelEntry>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelEntry {
    id: String,
    owned_by: Option<String>,
}

const AI_CONFIG_FETCH_TIMEOUT_SECS: u64 = 15;
const AI_CONFIG_ENDPOINT_DEFAULT_TIMEOUT_SECS: u64 = 8;
const AI_CONFIG_MAX_ERROR_BODY_CHARS: usize = 512;
const KNOWN_COMPAT_SUFFIXES: &[&str] = &[
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
];

#[tauri::command]
pub async fn ai_config_fetch_models(
    base_url: String,
    api_key: String,
    is_full_url: Option<bool>,
    models_url_override: Option<String>,
) -> Result<Vec<AiConfigFetchedModel>, String> {
    if api_key.trim().is_empty() {
        return Err("AI_CONFIG_FETCH_MODELS_FAILED: api key is required".to_string());
    }

    let candidates = build_models_url_candidates(
        &base_url,
        is_full_url.unwrap_or(false),
        models_url_override.as_deref(),
    )?;
    let client = reqwest::Client::new();
    let mut last_err: Option<String> = None;

    for url in candidates {
        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key.trim()))
            .timeout(Duration::from_secs(AI_CONFIG_FETCH_TIMEOUT_SECS))
            .send()
            .await
            .map_err(|error| format!("AI_CONFIG_FETCH_MODELS_FAILED: request failed: {error}"))?;
        let status = response.status();

        if status.is_success() {
            let payload: OpenAiModelsResponse = response.json().await.map_err(|error| {
                format!("AI_CONFIG_FETCH_MODELS_FAILED: invalid response payload: {error}")
            })?;
            let mut models = payload
                .data
                .unwrap_or_default()
                .into_iter()
                .map(|entry| AiConfigFetchedModel {
                    id: entry.id,
                    owned_by: entry.owned_by,
                })
                .collect::<Vec<_>>();
            models.sort_by(|left, right| left.id.cmp(&right.id));
            return Ok(models);
        }

        let body = truncate_error_body(response.text().await.unwrap_or_default());
        if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
            last_err = Some(format!("HTTP {status}: {body}"));
            continue;
        }
        return Err(format!("AI_CONFIG_FETCH_MODELS_FAILED: HTTP {status}: {body}"));
    }

    Err(format!(
        "AI_CONFIG_FETCH_MODELS_FAILED: {}",
        last_err.unwrap_or_else(|| "all candidate endpoints failed".to_string())
    ))
}

#[tauri::command]
pub async fn ai_config_test_endpoints(
    urls: Vec<String>,
    timeout_secs: Option<u64>,
) -> Result<Vec<AiConfigEndpointTestResult>, String> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(AI_CONFIG_ENDPOINT_DEFAULT_TIMEOUT_SECS));
    let client = reqwest::Client::new();
    let tasks = urls
        .into_iter()
        .map(|raw_url| {
            let client = client.clone();
            async move {
                let url = normalize_endpoint_url(&raw_url);
                if url.is_empty() {
                    return AiConfigEndpointTestResult {
                        url: raw_url,
                        latency_ms: None,
                        status_code: None,
                        error: Some("Empty URL".to_string()),
                    };
                }
                if let Err(error) = reqwest::Url::parse(&url) {
                    return AiConfigEndpointTestResult {
                        url,
                        latency_ms: None,
                        status_code: None,
                        error: Some(format!("Invalid URL: {error}")),
                    };
                }
                let started_at = Instant::now();
                match client.get(&url).timeout(timeout).send().await {
                    Ok(response) => AiConfigEndpointTestResult {
                        url,
                        latency_ms: Some(started_at.elapsed().as_millis()),
                        status_code: Some(response.status().as_u16()),
                        error: None,
                    },
                    Err(error) => AiConfigEndpointTestResult {
                        url,
                        latency_ms: None,
                        status_code: None,
                        error: Some(error.to_string()),
                    },
                }
            }
        })
        .collect::<Vec<_>>();

    Ok(join_all(tasks).await)
}

fn build_models_url_candidates(
    base_url: &str,
    is_full_url: bool,
    models_url_override: Option<&str>,
) -> Result<Vec<String>, String> {
    if let Some(override_url) = models_url_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(vec![override_url.to_string()]);
    }

    let trimmed = normalize_endpoint_url(base_url);
    if trimmed.is_empty() {
        return Err("AI_CONFIG_FETCH_MODELS_FAILED: base url is empty".to_string());
    }

    if is_full_url {
        if let Some(index) = trimmed.find("/v1/") {
            return Ok(vec![format!("{}/v1/models", &trimmed[..index])]);
        }
        if let Some(index) = trimmed.rfind('/') {
            let root = &trimmed[..index];
            if root.contains("://") {
                return Ok(vec![format!("{root}/v1/models")]);
            }
        }
        return Err(
            "AI_CONFIG_FETCH_MODELS_FAILED: cannot derive models endpoint from full url"
                .to_string(),
        );
    }

    let mut candidates = Vec::new();
    if trimmed.ends_with("/v1") {
        candidates.push(format!("{trimmed}/models"));
    } else {
        candidates.push(format!("{trimmed}/v1/models"));
    }

    if let Some(root) = strip_compat_suffix(&trimmed) {
        let root = root.trim_end_matches('/');
        if !root.is_empty() && root.contains("://") {
            candidates.push(format!("{root}/v1/models"));
            candidates.push(format!("{root}/models"));
        }
    }

    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|existing: &String| existing == &candidate) {
            unique.push(candidate);
        }
    }
    Ok(unique)
}

fn normalize_endpoint_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn strip_compat_suffix(base_url: &str) -> Option<&str> {
    KNOWN_COMPAT_SUFFIXES
        .iter()
        .find(|suffix| base_url.ends_with(**suffix))
        .map(|suffix| &base_url[..base_url.len() - suffix.len()])
}

fn truncate_error_body(body: String) -> String {
    if body.chars().count() <= AI_CONFIG_MAX_ERROR_BODY_CHARS {
        return body;
    }
    let mut truncated = body
        .chars()
        .take(AI_CONFIG_MAX_ERROR_BODY_CHARS)
        .collect::<String>();
    truncated.push('…');
    truncated
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
    use super::*;

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
}
