pub mod tool_profiles;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{sleep, Duration};
use tracing::{debug, warn};
use uuid::Uuid;
use vb_abstractions::WorkspaceService;
use vb_agent::{AgentRepository, AgentState, RoleStatus};
use vb_storage::{SqliteAgentRepository, SqliteStorage};
use vb_task::{
    AgentRuntimeRegistration, AgentToolKind, ChannelAckEvent, ChannelRouteBinding,
    ExternalAccessPolicyMode, ExternalInboundMessage, ExternalInboundResponse,
    ExternalInboundStatus, ExternalRouteResolution, TaskDispatchBatchRequest,
    TaskDispatchProgressEvent, TaskDispatchStatus,
};

use crate::{
    app_state::{AppState, ExternalReplyDispatchPhase, ExternalReplyRelayTarget},
    connectors::telegram,
};

const EXTERNAL_REPLY_FLUSH_LOOP_MS: u64 = 700;
const EXTERNAL_REPLY_IDLE_FLUSH_MS: u64 = 2_000; // 降低到2秒，更快响应
const EXTERNAL_REPLY_MAX_WAIT_MS: u64 = 15 * 60 * 1000;
const EXTERNAL_REPLY_STREAM_THROTTLE_MS: u64 = 800; // 降低到800ms，更快的预览更新
const EXTERNAL_REPLY_STREAM_MIN_INITIAL_CHARS: usize = 16; // 降低到16个字符，更早开始发送
const EXTERNAL_REPLY_MAX_TEXT_CHARS: usize = 3_800;
const CHANNEL_STATE_FILE_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelBindingListRequest {
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccessApproveRequest {
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
    pub identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccessListRequest {
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccessPolicySetRequest {
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
    pub mode: ExternalAccessPolicyMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInboundRequest {
    pub message: ExternalInboundMessage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConnectorAccountUpsertRequest {
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub bot_token: Option<String>,
    #[serde(default)]
    pub bot_token_ref: Option<String>,
    #[serde(default)]
    pub webhook_secret: Option<String>,
    #[serde(default)]
    pub webhook_secret_ref: Option<String>,
    #[serde(default)]
    pub webhook_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConnectorAccountListRequest {
    pub channel: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConnectorHealthRequest {
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConnectorWebhookSyncRequest {
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub webhook_url: Option<String>,
}

const ROLE_TARGET_PREFIX: &str = "role:";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedChannelAccessPolicy {
    channel: String,
    account_id: String,
    mode: ExternalAccessPolicyMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedChannelAllowEntry {
    channel: String,
    account_id: String,
    identity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedChannelStateFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    route_bindings: Vec<PersistedRouteBindingRecord>,
    #[serde(default)]
    access_policies: Vec<PersistedChannelAccessPolicy>,
    #[serde(default)]
    allowlist_entries: Vec<PersistedChannelAllowEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedRouteBindingRecord {
    #[serde(flatten)]
    binding: ChannelRouteBinding,
    #[serde(default)]
    workspace_root: Option<String>,
}

fn normalize_account_id(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn user_home_dir() -> Option<PathBuf> {
    if let Some(value) = env::var_os("HOME") {
        let path = PathBuf::from(value);
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }
    if let Some(value) = env::var_os("USERPROFILE") {
        let path = PathBuf::from(value);
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }
    None
}

async fn resolve_binding_bot_name(
    app: &AppHandle,
    binding: &ChannelRouteBinding,
) -> Option<String> {
    let channel = binding.channel.trim().to_ascii_lowercase();
    if channel.as_str() != "telegram" {
        return None;
    }
    let runtime_webhook =
        crate::channel_adapter_runtime::runtime_snapshot().map(|runtime| runtime.telegram_webhook);
    let snapshot = telegram::health_check(app, binding.account_id.as_deref(), runtime_webhook)
        .await
        .ok()?;
    snapshot
        .bot_username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn channel_state_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_STATE_PATH_FAILED: {error}"))?;
    Ok(app_data.join("channel/state.json"))
}

fn read_channel_state_file(app: &AppHandle) -> Result<PersistedChannelStateFile, String> {
    let path = channel_state_file_path(app)?;
    if !path.exists() {
        return Ok(PersistedChannelStateFile {
            version: CHANNEL_STATE_FILE_VERSION,
            ..PersistedChannelStateFile::default()
        });
    }
    let payload = fs::read(&path).map_err(|error| format!("CHANNEL_STATE_READ_FAILED: {error}"))?;
    serde_json::from_slice::<PersistedChannelStateFile>(&payload)
        .map_err(|error| format!("CHANNEL_STATE_DECODE_FAILED: {error}"))
}

fn write_channel_state_file(
    app: &AppHandle,
    state_file: &PersistedChannelStateFile,
) -> Result<(), String> {
    let path = channel_state_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("CHANNEL_STATE_WRITE_FAILED: {error}"))?;
    }
    let payload = serde_json::to_vec_pretty(state_file)
        .map_err(|error| format!("CHANNEL_STATE_ENCODE_FAILED: {error}"))?;
    fs::write(path, payload).map_err(|error| format!("CHANNEL_STATE_WRITE_FAILED: {error}"))
}

fn persist_route_bindings(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let mut state_file = read_channel_state_file(app)?;
    state_file.version = CHANNEL_STATE_FILE_VERSION;
    state_file.route_bindings = state
        .task_service
        .list_route_bindings(None)
        .into_iter()
        .map(|binding| {
            let workspace_root = state
                .workspace_root_path(&binding.workspace_id)
                .ok()
                .map(|path| path.to_string_lossy().to_string());
            PersistedRouteBindingRecord {
                binding,
                workspace_root,
            }
        })
        .collect();
    write_channel_state_file(app, &state_file)
}

fn persist_access_policy(
    app: &AppHandle,
    channel: &str,
    account_id: &str,
    mode: ExternalAccessPolicyMode,
) -> Result<(), String> {
    let mut state_file = read_channel_state_file(app)?;
    state_file.version = CHANNEL_STATE_FILE_VERSION;
    let channel_key = channel.trim().to_ascii_lowercase();
    let account_key = account_id.trim().to_ascii_lowercase();
    if let Some(existing) = state_file.access_policies.iter_mut().find(|entry| {
        entry.channel.trim().eq_ignore_ascii_case(&channel_key)
            && entry.account_id.trim().eq_ignore_ascii_case(&account_key)
    }) {
        existing.mode = mode;
    } else {
        state_file
            .access_policies
            .push(PersistedChannelAccessPolicy {
                channel: channel_key,
                account_id: account_key,
                mode,
            });
    }
    write_channel_state_file(app, &state_file)
}

fn persist_allow_entry(
    app: &AppHandle,
    channel: &str,
    account_id: &str,
    identity: &str,
) -> Result<(), String> {
    let mut state_file = read_channel_state_file(app)?;
    state_file.version = CHANNEL_STATE_FILE_VERSION;
    let channel_key = channel.trim().to_ascii_lowercase();
    let account_key = account_id.trim().to_ascii_lowercase();
    let identity_key = identity.trim().to_ascii_lowercase();
    let exists = state_file.allowlist_entries.iter().any(|entry| {
        entry.channel.trim().eq_ignore_ascii_case(&channel_key)
            && entry.account_id.trim().eq_ignore_ascii_case(&account_key)
            && entry.identity.trim().eq_ignore_ascii_case(&identity_key)
    });
    if !exists {
        state_file
            .allowlist_entries
            .push(PersistedChannelAllowEntry {
                channel: channel_key,
                account_id: account_key,
                identity: identity_key,
            });
    }
    write_channel_state_file(app, &state_file)
}

pub fn restore_persisted_channel_state(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let state_file = read_channel_state_file(app)?;
    for record in state_file.route_bindings {
        let mut binding = record.binding;
        if state.workspace_root_path(&binding.workspace_id).is_err() {
            if let Some(root) = record
                .workspace_root
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if let Ok(summary) = state.workspace_service.open(Path::new(root)) {
                    binding.workspace_id = summary.workspace_id.to_string();
                }
            } else if let Ok(workspaces) = state.workspace_service.list() {
                if workspaces.len() == 1 {
                    binding.workspace_id = workspaces[0].workspace_id.to_string();
                }
            }
        }
        state.task_service.upsert_route_binding(binding);
    }
    for policy in state_file.access_policies {
        state.task_service.set_external_access_policy(
            &policy.channel,
            &policy.account_id,
            policy.mode,
        );
    }
    for entry in state_file.allowlist_entries {
        state.task_service.approve_external_access(
            &entry.channel,
            &entry.account_id,
            &entry.identity,
        );
    }
    Ok(())
}

fn truncate_text_for_channel(text: &str, max_chars: usize) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    chars.truncate(max_chars);
    let mut truncated: String = chars.into_iter().collect();
    truncated.push_str("\n\n... [truncated]");
    truncated
}

fn split_text_for_channel(text: &str, max_chars: usize) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    if text.chars().count() <= max_chars {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.chars().count() <= max_chars {
            chunks.push(remaining.to_string());
            break;
        }

        let mut split_byte = 0usize;
        let mut last_newline_byte = None;
        let mut char_count = 0usize;
        for (idx, ch) in remaining.char_indices() {
            char_count += 1;
            split_byte = idx + ch.len_utf8();
            if ch == '\n' {
                last_newline_byte = Some(split_byte);
            }
            if char_count >= max_chars {
                break;
            }
        }

        let chunk_end = last_newline_byte
            .filter(|value| *value > 0)
            .unwrap_or(split_byte);
        let chunk = remaining[..chunk_end].trim_end().to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }
        remaining = remaining[chunk_end..].trim_start_matches('\n');
    }

    chunks
}

fn structured_cli_spec(tool_kind: AgentToolKind) -> Option<(&'static str, &'static str)> {
    match tool_kind {
        AgentToolKind::Claude => Some(("claude", "GTO_CLAUDE_COMMAND")),
        AgentToolKind::Codex => Some(("codex", "GTO_CODEX_COMMAND")),
        AgentToolKind::Gemini => Some(("gemini", "GTO_GEMINI_COMMAND")),
        _ => None,
    }
}

fn resolve_structured_cli_command(tool_kind: AgentToolKind) -> Result<PathBuf, String> {
    let (command_name, override_var) = structured_cli_spec(tool_kind)
        .ok_or_else(|| format!("unsupported structured relay tool: {:?}", tool_kind))?;

    if let Some(override_value) = env::var(override_var)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if let Some(path) = resolve_cli_candidate(&override_value, command_name) {
            debug!(
                tool = command_name,
                resolved = %path.display(),
                source = override_var,
                "resolved structured relay command from override"
            );
            return Ok(path);
        }

        return Err(format!(
            "{override_var} is set to '{override_value}' but does not resolve to an executable for '{command_name}'"
        ));
    }

    if let Some(path) = resolve_cli_candidate(command_name, command_name) {
        debug!(
            tool = command_name,
            resolved = %path.display(),
            source = "PATH/common",
            "resolved structured relay command"
        );
        return Ok(path);
    }

    let mut attempted = vec![override_var.to_string(), "PATH".to_string()];
    attempted.extend(
        common_cli_search_roots()
            .into_iter()
            .map(|path| path.display().to_string()),
    );
    #[cfg(not(target_os = "windows"))]
    attempted.push("login-shell".to_string());

    Err(format!(
        "unable to resolve executable '{command_name}'; searched {}",
        attempted.join(", ")
    ))
}

fn resolve_cli_candidate(candidate: &str, command_name: &str) -> Option<PathBuf> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = PathBuf::from(trimmed);
    if path.components().count() > 1 || path.is_absolute() {
        return normalize_executable_path(path);
    }

    if let Some(path) = resolve_command_in_path(trimmed) {
        return Some(path);
    }

    if trimmed != command_name {
        for root in common_cli_search_roots() {
            if let Some(path) = find_command_in_dir(&root, trimmed) {
                return Some(path);
            }
        }
        #[cfg(not(target_os = "windows"))]
        if let Some(path) = resolve_command_via_login_shell(trimmed) {
            return Some(path);
        }
    } else {
        if let Some(path) = resolve_command_in_common_roots(command_name) {
            return Some(path);
        }
        #[cfg(not(target_os = "windows"))]
        if let Some(path) = resolve_command_via_login_shell(command_name) {
            return Some(path);
        }
    }

    None
}

fn resolve_command_in_path(command_name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        if let Some(path) = find_command_in_dir(&dir, command_name) {
            return Some(path);
        }
    }
    None
}

fn resolve_command_in_common_roots(command_name: &str) -> Option<PathBuf> {
    for root in common_cli_search_roots() {
        if let Some(path) = find_command_in_dir(&root, command_name) {
            return Some(path);
        }
    }
    None
}

fn common_cli_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(home) = user_home_dir() {
        roots.push(home.join(".local/bin"));
        roots.push(home.join(".cargo/bin"));
        roots.push(home.join(".volta/bin"));
        roots.push(home.join(".asdf/shims"));
        roots.push(home.join(".fnm/current/bin"));
        roots.extend(nvm_bin_dirs(&home));
    }

    if let Some(appdata) = env::var_os("APPDATA").map(PathBuf::from) {
        roots.push(appdata.join("npm"));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        roots.push(local_app_data.join("Programs/nodejs"));
    }
    if let Some(nvm_home) = env::var_os("NVM_HOME").map(PathBuf::from) {
        roots.push(nvm_home);
    }
    if let Some(nvm_symlink) = env::var_os("NVM_SYMLINK").map(PathBuf::from) {
        roots.push(nvm_symlink);
    }

    if cfg!(target_os = "windows") {
        if let Some(program_files) = env::var_os("ProgramFiles").map(PathBuf::from) {
            roots.push(program_files.join("nodejs"));
        }
    } else {
        roots.push(PathBuf::from("/usr/local/bin"));
        roots.push(PathBuf::from("/opt/homebrew/bin"));
        roots.push(PathBuf::from("/usr/bin"));
        roots.push(PathBuf::from("/bin"));
    }

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let normalized = root;
        let key = normalized.to_string_lossy().to_string();
        if seen.insert(key) {
            deduped.push(normalized);
        }
    }
    deduped
}

fn nvm_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let versions_root = home.join(".nvm/versions/node");
    let Ok(entries) = fs::read_dir(&versions_root) else {
        return dirs;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path.join("bin"));
        }
    }
    dirs
}

fn find_command_in_dir(dir: &Path, command_name: &str) -> Option<PathBuf> {
    for file_name in command_name_variants(command_name) {
        let candidate = dir.join(file_name);
        if let Some(path) = normalize_executable_path(candidate) {
            return Some(path);
        }
    }
    None
}

fn command_name_variants(command_name: &str) -> Vec<String> {
    let mut variants = vec![command_name.to_string()];
    if cfg!(target_os = "windows") {
        for suffix in [".cmd", ".exe", ".bat"] {
            if !command_name.ends_with(suffix) {
                variants.push(format!("{command_name}{suffix}"));
            }
        }
    }
    variants
}

fn normalize_executable_path(path: PathBuf) -> Option<PathBuf> {
    if !path.is_file() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let metadata = fs::metadata(&path).ok()?;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }
    Some(path)
}

#[cfg(not(target_os = "windows"))]
fn resolve_command_via_login_shell(command_name: &str) -> Option<PathBuf> {
    for shell in [("bash", "-lc"), ("zsh", "-lc"), ("sh", "-lc")] {
        let Ok(output) = std::process::Command::new(shell.0)
            .arg(shell.1)
            .arg(format!("command -v {command_name}"))
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let candidate = stdout.trim();
        if candidate.is_empty() {
            continue;
        }
        if let Some(path) = normalize_executable_path(PathBuf::from(candidate)) {
            return Some(path);
        }
    }
    None
}

fn runtime_supports_structured_relay(runtime: &AgentRuntimeRegistration) -> bool {
    matches!(
        runtime.tool_kind,
        AgentToolKind::Claude | AgentToolKind::Codex
    ) && runtime
        .resolved_cwd
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
}

fn emit_external_outbound_result(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    message_id: &str,
    status: &str,
    detail: &str,
    ts_ms: u64,
    relay_mode: &str,
    confidence: &str,
) {
    let _ = app.emit(
        "external/channel_outbound_result",
        json!({
            "traceId": target.trace_id,
            "workspaceId": target.workspace_id,
            "messageId": message_id,
            "targetAgentId": target.target_agent_id,
            "status": status,
            "detail": detail,
            "tsMs": ts_ms,
            "relayMode": relay_mode,
            "confidence": confidence,
        }),
    );
}

fn emit_structured_reply_skipped(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    detail: &str,
    relay_mode: &str,
) {
    emit_external_outbound_result(
        app,
        target,
        &target.inbound_message_id,
        "skipped",
        detail,
        now_ms(),
        relay_mode,
        "high",
    );
}

async fn deliver_external_reply_text(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    phase: ExternalReplyDispatchPhase,
    raw_text: &str,
    preview_message_id: &mut Option<String>,
    relay_mode: &str,
    confidence: &str,
) -> Result<(), String> {
    let text = truncate_text_for_channel(raw_text.trim(), EXTERNAL_REPLY_MAX_TEXT_CHARS);
    if text.is_empty() {
        return Ok(());
    }

    let delivery_result = match target.channel.as_str() {
        "telegram" => match phase {
            ExternalReplyDispatchPhase::Preview => {
                if let Some(message_id) = preview_message_id.as_deref() {
                    telegram::edit_text_reply(
                        app,
                        Some(&target.account_id),
                        &target.peer_id,
                        message_id,
                        &text,
                    )
                    .await
                } else {
                    if let Err(error) =
                        telegram::send_typing_action(app, Some(&target.account_id), &target.peer_id)
                            .await
                    {
                        debug!(
                            trace_id = %target.trace_id,
                            error = %error,
                            "telegram typing action failed (non-fatal)"
                        );
                    }
                    telegram::send_text_reply(
                        app,
                        Some(&target.account_id),
                        &target.peer_id,
                        &text,
                        Some(&target.inbound_message_id),
                    )
                    .await
                }
            }
            ExternalReplyDispatchPhase::Finalize => {
                if let Some(message_id) = preview_message_id.as_deref() {
                    match telegram::edit_text_reply(
                        app,
                        Some(&target.account_id),
                        &target.peer_id,
                        message_id,
                        &text,
                    )
                    .await
                    {
                        Ok(snapshot) => Ok(snapshot),
                        Err(_) => {
                            telegram::send_text_reply(
                                app,
                                Some(&target.account_id),
                                &target.peer_id,
                                &text,
                                Some(&target.inbound_message_id),
                            )
                            .await
                        }
                    }
                } else {
                    telegram::send_text_reply(
                        app,
                        Some(&target.account_id),
                        &target.peer_id,
                        &text,
                        Some(&target.inbound_message_id),
                    )
                    .await
                }
            }
        },
        _ => Err(format!(
            "CHANNEL_REPLY_SEND_UNSUPPORTED: channel {} outbound is unsupported",
            target.channel
        )),
    };

    match delivery_result {
        Ok(send_result) => {
            if phase == ExternalReplyDispatchPhase::Preview {
                *preview_message_id = Some(send_result.message_id.clone());
            }
            emit_external_outbound_result(
                app,
                target,
                &send_result.message_id,
                "delivered",
                if phase == ExternalReplyDispatchPhase::Preview {
                    "stream preview updated"
                } else {
                    "reply finalized"
                },
                send_result.delivered_at_ms,
                relay_mode,
                confidence,
            );
            Ok(())
        }
        Err(error) => {
            emit_external_outbound_result(
                app,
                target,
                preview_message_id
                    .as_deref()
                    .unwrap_or(&target.inbound_message_id),
                "failed",
                &error,
                now_ms(),
                relay_mode,
                confidence,
            );
            Err(error)
        }
    }
}

fn spawn_structured_reply_jobs(
    app: &AppHandle,
    message: &ExternalInboundMessage,
    trace_id: &str,
    workspace_id: &str,
    results: &[vb_task::TaskDispatchTargetResult],
    runtimes_by_agent: &HashMap<String, AgentRuntimeRegistration>,
) {
    if !message.channel.trim().eq_ignore_ascii_case("telegram") {
        return;
    }

    for result in results {
        if result.status != TaskDispatchStatus::Sent {
            continue;
        }

        let target = ExternalReplyRelayTarget {
            trace_id: trace_id.to_string(),
            channel: message.channel.trim().to_ascii_lowercase(),
            account_id: normalize_account_id(Some(&message.account_id)),
            peer_id: message.peer_id.clone(),
            inbound_message_id: message.message_id.clone(),
            workspace_id: workspace_id.to_string(),
            target_agent_id: result.target_agent_id.clone(),
            injected_input: Some(message.text.trim().to_string()).filter(|text| !text.is_empty()),
        };

        let Some(runtime) = runtimes_by_agent.get(&result.target_agent_id).cloned() else {
            emit_structured_reply_skipped(
                app,
                &target,
                "CHANNEL_REPLY_RUNTIME_MISSING: target runtime metadata unavailable",
                "unsupported",
            );
            continue;
        };

        if !runtime_supports_structured_relay(&runtime) {
            emit_structured_reply_skipped(
                app,
                &target,
                &format!(
                    "CHANNEL_REPLY_RELAY_SKIPPED: tool {:?} does not provide a structured reply stream",
                    runtime.tool_kind
                ),
                "unsupported",
            );
            continue;
        }

        let prompt = message.text.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) =
                run_structured_reply_job(&app, target.clone(), runtime, prompt).await
            {
                emit_external_error(
                    &app,
                    &target.trace_id,
                    "CHANNEL_REPLY_STRUCTURED_FAILED",
                    &error,
                );
                emit_external_outbound_result(
                    &app,
                    &target,
                    &target.inbound_message_id,
                    "failed",
                    &error,
                    now_ms(),
                    "structured-headless",
                    "high",
                );
            }
        });
    }
}

async fn run_structured_reply_job(
    app: &AppHandle,
    target: ExternalReplyRelayTarget,
    runtime: AgentRuntimeRegistration,
    prompt: String,
) -> Result<(), String> {
    match runtime.tool_kind {
        AgentToolKind::Claude => run_claude_structured_relay(app, &target, &runtime, &prompt).await,
        AgentToolKind::Codex => run_codex_structured_relay(app, &target, &runtime, &prompt).await,
        _ => Err(format!(
            "CHANNEL_REPLY_STRUCTURED_UNSUPPORTED: tool {:?} is not supported",
            runtime.tool_kind
        )),
    }
}

async fn run_claude_structured_relay(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    runtime: &AgentRuntimeRegistration,
    prompt: &str,
) -> Result<(), String> {
    let mut last_error = String::new();
    for continue_session in [true, false] {
        match stream_claude_once(app, target, runtime, prompt, continue_session).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error;
            }
        }
    }
    Err(last_error)
}

async fn stream_claude_once(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    runtime: &AgentRuntimeRegistration,
    prompt: &str,
    continue_session: bool,
) -> Result<(), String> {
    let cwd = runtime
        .resolved_cwd
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "CHANNEL_REPLY_RUNTIME_INVALID: resolved cwd is required".to_string())?;
    let command_path = resolve_structured_cli_command(AgentToolKind::Claude)
        .map_err(|error| format!("CHANNEL_REPLY_CLAUDE_COMMAND_NOT_FOUND: {error}"))?;
    let mut command = Command::new(&command_path);
    command
        .current_dir(cwd)
        .arg("-p")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages");
    if continue_session {
        command.arg("-c");
    }
    command.arg(prompt);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("CHANNEL_REPLY_CLAUDE_SPAWN_FAILED: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "CHANNEL_REPLY_CLAUDE_STDOUT_MISSING".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "CHANNEL_REPLY_CLAUDE_STDERR_MISSING".to_string())?;
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut buf = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut buf).await;
        buf
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut final_text = String::new();
    let mut last_preview_text = String::new();
    let mut last_preview_sent_at_ms = 0u64;
    let mut preview_message_id: Option<String> = None;

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("CHANNEL_REPLY_CLAUDE_READ_FAILED: {error}"))?
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let event: Value = serde_json::from_str(trimmed).map_err(|error| {
            format!("CHANNEL_REPLY_CLAUDE_JSON_INVALID: {error}; line={trimmed}")
        })?;
        let Some(event_type) = event.get("type").and_then(Value::as_str) else {
            continue;
        };
        if event_type == "content_block_delta"
            && event
                .pointer("/delta/type")
                .and_then(Value::as_str)
                .is_some_and(|value| value == "text_delta")
        {
            if let Some(delta) = event.pointer("/delta/text").and_then(Value::as_str) {
                final_text.push_str(delta);
                let preview_due = now_ms().saturating_sub(last_preview_sent_at_ms)
                    >= EXTERNAL_REPLY_STREAM_THROTTLE_MS;
                let preview_ready = final_text.chars().count()
                    >= EXTERNAL_REPLY_STREAM_MIN_INITIAL_CHARS
                    || preview_message_id.is_some();
                if preview_due && preview_ready && final_text != last_preview_text {
                    deliver_external_reply_text(
                        app,
                        target,
                        ExternalReplyDispatchPhase::Preview,
                        &final_text,
                        &mut preview_message_id,
                        "structured-headless",
                        "high",
                    )
                    .await?;
                    last_preview_text = final_text.clone();
                    last_preview_sent_at_ms = now_ms();
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|error| format!("CHANNEL_REPLY_CLAUDE_WAIT_FAILED: {error}"))?;
    let stderr = stderr_task
        .await
        .map_err(|error| format!("CHANNEL_REPLY_CLAUDE_STDERR_JOIN_FAILED: {error}"))?;
    if !status.success() {
        return Err(format!(
            "CHANNEL_REPLY_CLAUDE_EXIT_FAILED: status={status}; stderr={}",
            stderr.trim()
        ));
    }
    if final_text.trim().is_empty() {
        return Err(format!(
            "CHANNEL_REPLY_CLAUDE_EMPTY: no assistant text produced; stderr={}",
            stderr.trim()
        ));
    }

    deliver_external_reply_text(
        app,
        target,
        ExternalReplyDispatchPhase::Finalize,
        &final_text,
        &mut preview_message_id,
        "structured-headless",
        "high",
    )
    .await
}

async fn run_codex_structured_relay(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    runtime: &AgentRuntimeRegistration,
    prompt: &str,
) -> Result<(), String> {
    let mut last_error = String::new();
    for resume_last in [true, false] {
        match stream_codex_once(app, target, runtime, prompt, resume_last).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error;
            }
        }
    }
    Err(last_error)
}

fn codex_event_text(event: &Value) -> Option<(String, bool)> {
    let event_type = event.get("type").and_then(Value::as_str)?;
    match event_type {
        "item.completed" => {
            let item = event.get("item")?;
            let item_type = item.get("type").and_then(Value::as_str)?;
            if matches!(item_type, "agent_message" | "assistant_message") {
                let text = item
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if !text.trim().is_empty() {
                    return Some((text, true));
                }
            }
            None
        }
        "item.updated" | "agent_message_delta" | "assistant_message_delta" => {
            let delta = event
                .pointer("/delta/text")
                .and_then(Value::as_str)
                .or_else(|| event.pointer("/item/text").and_then(Value::as_str))
                .or_else(|| event.get("text").and_then(Value::as_str))?;
            if delta.is_empty() {
                None
            } else {
                Some((delta.to_string(), false))
            }
        }
        _ => None,
    }
}

async fn stream_codex_once(
    app: &AppHandle,
    target: &ExternalReplyRelayTarget,
    runtime: &AgentRuntimeRegistration,
    prompt: &str,
    resume_last: bool,
) -> Result<(), String> {
    let cwd = runtime
        .resolved_cwd
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "CHANNEL_REPLY_RUNTIME_INVALID: resolved cwd is required".to_string())?;
    let temp_output = std::env::temp_dir().join(format!(
        "gtoffice-codex-last-message-{}.txt",
        Uuid::new_v4()
    ));

    let command_path = resolve_structured_cli_command(AgentToolKind::Codex)
        .map_err(|error| format!("CHANNEL_REPLY_CODEX_COMMAND_NOT_FOUND: {error}"))?;
    let mut command = Command::new(&command_path);
    command.current_dir(cwd);
    if resume_last {
        command
            .arg("exec")
            .arg("resume")
            .arg("--last")
            .arg("--json");
    } else {
        command.arg("exec").arg("--json");
    }
    command
        .arg("--skip-git-repo-check")
        .arg("--output-last-message")
        .arg(&temp_output)
        .arg(prompt)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("CHANNEL_REPLY_CODEX_SPAWN_FAILED: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "CHANNEL_REPLY_CODEX_STDOUT_MISSING".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "CHANNEL_REPLY_CODEX_STDERR_MISSING".to_string())?;
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut buf = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut buf).await;
        buf
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut final_text = String::new();
    let mut last_preview_text = String::new();
    let mut last_preview_sent_at_ms = 0u64;
    let mut preview_message_id: Option<String> = None;

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("CHANNEL_REPLY_CODEX_READ_FAILED: {error}"))?
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let event: Value = serde_json::from_str(trimmed).map_err(|error| {
            format!("CHANNEL_REPLY_CODEX_JSON_INVALID: {error}; line={trimmed}")
        })?;
        if let Some((text, is_final)) = codex_event_text(&event) {
            if is_final {
                final_text = text;
            } else {
                final_text.push_str(&text);
            }
            let preview_due = now_ms().saturating_sub(last_preview_sent_at_ms)
                >= EXTERNAL_REPLY_STREAM_THROTTLE_MS;
            let preview_ready = final_text.chars().count()
                >= EXTERNAL_REPLY_STREAM_MIN_INITIAL_CHARS
                || preview_message_id.is_some();
            if preview_due && preview_ready && final_text != last_preview_text {
                deliver_external_reply_text(
                    app,
                    target,
                    ExternalReplyDispatchPhase::Preview,
                    &final_text,
                    &mut preview_message_id,
                    "structured-headless",
                    "high",
                )
                .await?;
                last_preview_text = final_text.clone();
                last_preview_sent_at_ms = now_ms();
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|error| format!("CHANNEL_REPLY_CODEX_WAIT_FAILED: {error}"))?;
    let stderr = stderr_task
        .await
        .map_err(|error| format!("CHANNEL_REPLY_CODEX_STDERR_JOIN_FAILED: {error}"))?;

    if let Ok(text) = tokio::fs::read_to_string(&temp_output).await {
        if !text.trim().is_empty() {
            final_text = text;
        }
    }
    let _ = tokio::fs::remove_file(&temp_output).await;

    if !status.success() {
        return Err(format!(
            "CHANNEL_REPLY_CODEX_EXIT_FAILED: status={status}; stderr={}",
            stderr.trim()
        ));
    }
    if final_text.trim().is_empty() {
        return Err(format!(
            "CHANNEL_REPLY_CODEX_EMPTY: no assistant text produced; stderr={}",
            stderr.trim()
        ));
    }

    deliver_external_reply_text(
        app,
        target,
        ExternalReplyDispatchPhase::Finalize,
        &final_text,
        &mut preview_message_id,
        "structured-headless",
        "high",
    )
    .await
}

fn resolve_workspace_from_persisted_route(
    app: &AppHandle,
    state: &AppState,
    message: &ExternalInboundMessage,
    route: &ExternalRouteResolution,
) -> Option<(String, PathBuf)> {
    let state_file = read_channel_state_file(app).ok()?;
    let channel_key = message.channel.trim().to_ascii_lowercase();
    let account_key = normalize_account_id(Some(message.account_id.as_str())).to_ascii_lowercase();
    for record in state_file.route_bindings {
        let binding = record.binding;
        if binding.workspace_id != route.workspace_id
            || binding.target_agent_id != route.target_agent_id
            || !binding.channel.eq_ignore_ascii_case(&channel_key)
        {
            continue;
        }
        let binding_account = normalize_account_id(binding.account_id.as_deref());
        if !binding_account.eq_ignore_ascii_case(&account_key) {
            continue;
        }
        let root = match record.workspace_root {
            Some(root) if !root.trim().is_empty() => root,
            _ => continue,
        };
        if let Ok(summary) = state.workspace_service.open(Path::new(root.trim())) {
            let workspace_id = summary.workspace_id.to_string();
            if let Ok(path) = state.workspace_root_path(&workspace_id) {
                return Some((workspace_id, path));
            }
        }
    }
    None
}

#[allow(dead_code)]
fn bind_external_reply_sessions(
    state: &AppState,
    app: &AppHandle,
    message: &ExternalInboundMessage,
    trace_id: &str,
    workspace_id: &str,
    results: &[vb_task::TaskDispatchTargetResult],
) {
    let channel = message.channel.trim().to_ascii_lowercase();
    if channel != "telegram" {
        return;
    }

    let runtime_by_agent: HashMap<String, AgentRuntimeRegistration> = state
        .task_service
        .list_runtimes(Some(workspace_id))
        .into_iter()
        .map(|runtime| (runtime.agent_id.clone(), runtime))
        .collect();

    for result in results {
        if result.status != TaskDispatchStatus::Sent {
            continue;
        }
        let Some(runtime) = runtime_by_agent.get(&result.target_agent_id) else {
            emit_external_error(
                app,
                trace_id,
                "CHANNEL_REPLY_BIND_FAILED",
                &format!(
                    "runtime session not found for target agent {}",
                    result.target_agent_id
                ),
            );
            continue;
        };
        let session_id = runtime.session_id.as_str();
        let target = ExternalReplyRelayTarget {
            trace_id: trace_id.to_string(),
            channel: channel.clone(),
            account_id: normalize_account_id(Some(&message.account_id)),
            peer_id: message.peer_id.clone(),
            inbound_message_id: message.message_id.clone(),
            workspace_id: workspace_id.to_string(),
            target_agent_id: result.target_agent_id.clone(),
            injected_input: Some(message.text.trim().to_string()).filter(|text| !text.is_empty()),
        };
        if let Err(error) = state.bind_external_reply_session(session_id, target, now_ms()) {
            emit_external_error(app, trace_id, "CHANNEL_REPLY_BIND_FAILED", &error);
            continue;
        }
        if let Err(error) = state.set_external_reply_session_tool_kind(session_id, runtime.tool_kind) {
            emit_external_error(app, trace_id, "CHANNEL_REPLY_BIND_FAILED", &error);
            continue;
        }
        debug!(
            trace_id = %trace_id,
            workspace_id = %workspace_id,
            target_agent_id = %result.target_agent_id,
            session_id = %session_id,
            tool_kind = ?runtime.tool_kind,
            "bound external reply session"
        );
    }
}

pub(crate) fn ingest_external_reply_terminal_output(
    state: &AppState,
    session_id: &str,
    chunk: &[u8],
    ts_ms: u64,
) {
    if let Err(error) = state.append_external_reply_chunk(session_id, chunk, ts_ms) {
        warn!(session_id = %session_id, error = %error, "append external reply chunk failed");
    }
}

pub(crate) fn ingest_external_reply_terminal_state(
    state: &AppState,
    session_id: &str,
    to_state: &str,
    ts_ms: u64,
) {
    if !to_state.eq_ignore_ascii_case("exited") {
        return;
    }
    if let Err(error) = state.mark_external_reply_session_ended(session_id, ts_ms) {
        warn!(session_id = %session_id, error = %error, "mark external reply session ended failed");
    }
}

pub(crate) fn spawn_external_reply_flush_worker(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = flush_external_reply_candidates(&state, &app).await {
                warn!(error = %error, "flush external reply candidates failed");
            }
            sleep(Duration::from_millis(EXTERNAL_REPLY_FLUSH_LOOP_MS)).await;
        }
    });
}

async fn flush_external_reply_candidates(state: &AppState, app: &AppHandle) -> Result<(), String> {
    let candidates = state.take_external_reply_dispatch_candidates(
        now_ms(),
        EXTERNAL_REPLY_IDLE_FLUSH_MS,
        EXTERNAL_REPLY_MAX_WAIT_MS,
        EXTERNAL_REPLY_STREAM_THROTTLE_MS,
        EXTERNAL_REPLY_STREAM_MIN_INITIAL_CHARS,
    )?;
    if !candidates.is_empty() {
        debug!(count = candidates.len(), "flushing external reply candidates");
    }
    for candidate in candidates {
        let chunks = split_text_for_channel(&candidate.text, EXTERNAL_REPLY_MAX_TEXT_CHARS);
        if chunks.is_empty() {
            continue;
        }
        debug!(
            trace_id = %candidate.target.trace_id,
            session_id = %candidate.session_id,
            channel = %candidate.target.channel,
            phase = ?candidate.phase,
            text_chars = candidate.text.chars().count(),
            chunk_count = chunks.len(),
            "delivering external reply candidate"
        );
        let text = chunks[0].clone();
        match candidate.target.channel.as_str() {
            "telegram" => {
                let delivery_result = match candidate.phase {
                    ExternalReplyDispatchPhase::Preview => {
                        if let Some(preview_message_id) = candidate.preview_message_id.as_deref() {
                            match telegram::edit_text_reply(
                                app,
                                Some(&candidate.target.account_id),
                                &candidate.target.peer_id,
                                preview_message_id,
                                &text,
                            )
                            .await
                            {
                                Ok(snapshot) => Ok(snapshot),
                                Err(error) => {
                                    warn!(
                                        trace_id = %candidate.target.trace_id,
                                        session_id = %candidate.session_id,
                                        preview_message_id = %preview_message_id,
                                        error = %error,
                                        "telegram preview edit failed, falling back to send"
                                    );
                                    telegram::send_text_reply(
                                        app,
                                        Some(&candidate.target.account_id),
                                        &candidate.target.peer_id,
                                        &text,
                                        Some(&candidate.target.inbound_message_id),
                                    )
                                    .await
                                }
                            }
                        } else {
                            // First preview message — send a "typing" indicator
                            // before the actual message for better UX
                            if let Err(error) = telegram::send_typing_action(
                                app,
                                Some(&candidate.target.account_id),
                                &candidate.target.peer_id,
                            )
                            .await
                            {
                                debug!(
                                    trace_id = %candidate.target.trace_id,
                                    error = %error,
                                    "telegram typing action failed (non-fatal)"
                                );
                            }
                            telegram::send_text_reply(
                                app,
                                Some(&candidate.target.account_id),
                                &candidate.target.peer_id,
                                &text,
                                Some(&candidate.target.inbound_message_id),
                            )
                            .await
                        }
                    }
                    ExternalReplyDispatchPhase::Finalize => {
                        if let Some(preview_message_id) = candidate.preview_message_id.as_deref() {
                            match telegram::edit_text_reply(
                                app,
                                Some(&candidate.target.account_id),
                                &candidate.target.peer_id,
                                preview_message_id,
                                &text,
                            )
                            .await
                            {
                                Ok(snapshot) => Ok(snapshot),
                                Err(error) => {
                                    warn!(
                                        trace_id = %candidate.target.trace_id,
                                        session_id = %candidate.session_id,
                                        preview_message_id = %preview_message_id,
                                        error = %error,
                                        "telegram final edit failed, falling back to send"
                                    );
                                    telegram::send_text_reply(
                                        app,
                                        Some(&candidate.target.account_id),
                                        &candidate.target.peer_id,
                                        &text,
                                        Some(&candidate.target.inbound_message_id),
                                    )
                                    .await
                                }
                            }
                        } else {
                            telegram::send_text_reply(
                                app,
                                Some(&candidate.target.account_id),
                                &candidate.target.peer_id,
                                &text,
                                Some(&candidate.target.inbound_message_id),
                            )
                            .await
                        }
                    }
                };

                match delivery_result {
                    Ok(send_result) => {
                        if candidate.phase == ExternalReplyDispatchPhase::Finalize {
                            for extra_chunk in chunks.iter().skip(1) {
                                telegram::send_text_reply(
                                    app,
                                    Some(&candidate.target.account_id),
                                    &candidate.target.peer_id,
                                    extra_chunk,
                                    Some(&candidate.target.inbound_message_id),
                                )
                                .await
                                .map_err(|error| {
                                    format!(
                                        "CHANNEL_REPLY_CONTINUATION_SEND_FAILED: {}",
                                        error
                                    )
                                })?;
                            }
                            if let Err(error) = state
                                .mark_external_reply_finalize_delivered(&candidate.session_id)
                            {
                                warn!(
                                    trace_id = %candidate.target.trace_id,
                                    session_id = %candidate.session_id,
                                    error = %error,
                                    "failed to clear finalized external reply session"
                                );
                            }
                        }
                        if candidate.phase == ExternalReplyDispatchPhase::Preview {
                            let _ = state.set_external_reply_preview_message_id(
                                &candidate.session_id,
                                &send_result.message_id,
                            );
                        }
                        let _ = app.emit(
                            "external/channel_outbound_result",
                            json!({
                                "traceId": candidate.target.trace_id,
                                "workspaceId": candidate.target.workspace_id,
                                "messageId": send_result.message_id,
                                "targetAgentId": candidate.target.target_agent_id,
                                "status": "delivered",
                                "detail": if candidate.phase == ExternalReplyDispatchPhase::Preview {
                                    "stream preview updated"
                                } else if chunks.len() > 1 {
                                    "reply finalized with continuation chunks"
                                } else {
                                    "reply finalized"
                                },
                                "tsMs": send_result.delivered_at_ms,
                                "relayMode": "pty-fallback",
                                "confidence": "low",
                            }),
                        );
                    }
                    Err(error) => {
                        if candidate.phase == ExternalReplyDispatchPhase::Preview {
                            let _ = state.mark_external_reply_preview_delivery_failed(
                                &candidate.session_id,
                                &candidate.text,
                            );
                        }
                        let _ = app.emit(
                            "external/channel_outbound_result",
                            json!({
                                "traceId": candidate.target.trace_id,
                                "workspaceId": candidate.target.workspace_id,
                                "messageId": candidate.preview_message_id.as_deref().unwrap_or(&candidate.target.inbound_message_id),
                                "targetAgentId": candidate.target.target_agent_id,
                                "status": "failed",
                                "detail": error,
                                "tsMs": now_ms(),
                                "relayMode": "pty-fallback",
                                "confidence": "low",
                            }),
                        );
                        emit_external_error(
                            app,
                            &candidate.target.trace_id,
                            "CHANNEL_REPLY_SEND_FAILED",
                            &error,
                        );
                    }
                }
            }
            _ => {
                let detail = format!(
                    "CHANNEL_REPLY_SEND_UNSUPPORTED: channel {} outbound is unsupported",
                    candidate.target.channel
                );
                let _ = app.emit(
                    "external/channel_outbound_result",
                    json!({
                    "traceId": candidate.target.trace_id,
                    "workspaceId": candidate.target.workspace_id,
                    "messageId": candidate.target.inbound_message_id,
                        "targetAgentId": candidate.target.target_agent_id,
                        "status": "failed",
                        "detail": detail,
                        "tsMs": now_ms(),
                        "relayMode": "unsupported",
                        "confidence": "high",
                    }),
                );
            }
        }
    }
    Ok(())
}

fn normalized_idempotency_key(message: &ExternalInboundMessage) -> String {
    if let Some(key) = message
        .idempotency_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return key.to_string();
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    message.text.hash(&mut hasher);
    let body_hash = hasher.finish();
    format!(
        "{}:{}:{}:{}:{body_hash:x}",
        message.channel.trim().to_lowercase(),
        normalize_account_id(Some(&message.account_id)).to_lowercase(),
        message.peer_id.trim().to_lowercase(),
        message.message_id.trim().to_lowercase()
    )
}

fn build_external_title(text: &str) -> String {
    let first_line = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("外部通道任务");
    let trimmed = first_line.trim();
    if trimmed.chars().count() <= 72 {
        return trimmed.to_string();
    }
    trimmed.chars().take(72).collect()
}

fn emit_dispatch_progress_events(app: &AppHandle, events: &[TaskDispatchProgressEvent]) {
    for event in events {
        let _ = app.emit("task/dispatch_progress", event);
        let _ = app.emit(
            "external/channel_dispatch_progress",
            json!({
                "traceId": event.batch_id,
                "workspaceId": event.workspace_id,
                "targetAgentId": event.target_agent_id,
                "taskId": event.task_id,
                "status": event.status,
                "detail": event.detail,
            }),
        );
    }
}

fn emit_channel_events(app: &AppHandle, ack_events: &[ChannelAckEvent], trace_id: Option<&str>) {
    for event in ack_events {
        let _ = app.emit("channel/ack", event);
        let _ = app.emit(
            "external/channel_reply",
            json!({
                "workspaceId": event.workspace_id,
                "messageId": event.message_id,
                "targetAgentId": event.target_agent_id,
                "status": event.status,
                "reason": event.reason,
            }),
        );
        let _ = app.emit(
            "external/channel_outbound_result",
            json!({
                "traceId": trace_id,
                "workspaceId": event.workspace_id,
                "messageId": event.message_id,
                "targetAgentId": event.target_agent_id,
                "status": event.status,
                "detail": event.reason,
                "tsMs": event.ts_ms,
                "relayMode": "dispatch-ack",
                "confidence": "high",
            }),
        );
    }
}

fn emit_external_error(app: &AppHandle, trace_id: &str, code: &str, detail: &str) {
    let _ = app.emit(
        "external/channel_error",
        json!({
            "traceId": trace_id,
            "code": code,
            "detail": detail,
        }),
    );
}

fn route_from_hints(message: &ExternalInboundMessage) -> Option<ExternalRouteResolution> {
    let workspace_id = message
        .workspace_id_hint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let target_agent_id = message
        .target_agent_id_hint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(ExternalRouteResolution {
        workspace_id: workspace_id.to_string(),
        target_agent_id: target_agent_id.to_string(),
        matched_by: "hint".to_string(),
    })
}

fn resolve_agent_repository(app: &AppHandle) -> Result<SqliteAgentRepository, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_AGENT_STORAGE_PATH_FAILED: {error}"))?;
    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("CHANNEL_AGENT_STORAGE_PATH_FAILED: {error}"))?;
    let db_path = base_dir.join("gtoffice.db");
    let storage = SqliteStorage::new(db_path)
        .map_err(|error| format!("CHANNEL_AGENT_STORAGE_PATH_FAILED: {error}"))?;
    Ok(SqliteAgentRepository::new(storage))
}

fn resolve_role_dispatch_targets(
    state: &AppState,
    app: &AppHandle,
    workspace_id: &str,
    role_selector: &str,
) -> Result<Vec<String>, String> {
    let selector = role_selector.trim();
    if selector.is_empty() {
        return Err("CHANNEL_ROLE_INVALID: empty role selector".to_string());
    }

    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema()
        .map_err(|error| format!("CHANNEL_ROLE_RESOLVE_FAILED: {error}"))?;
    repo.seed_defaults(workspace_id)
        .map_err(|error| format!("CHANNEL_ROLE_RESOLVE_FAILED: {error}"))?;

    let roles = repo
        .list_roles(workspace_id)
        .map_err(|error| format!("CHANNEL_ROLE_RESOLVE_FAILED: {error}"))?;
    let matched_roles: Vec<_> = roles
        .iter()
        .filter(|role| {
            role.status != RoleStatus::Disabled
                && (role.id.eq_ignore_ascii_case(selector)
                    || role.role_key.eq_ignore_ascii_case(selector))
        })
        .collect();
    let matched_role_ids: HashSet<String> =
        matched_roles.iter().map(|role| role.id.clone()).collect();
    let matched_role_keys: HashSet<String> = matched_roles
        .iter()
        .map(|role| role.role_key.to_ascii_lowercase())
        .collect();

    if matched_role_ids.is_empty() {
        return Err(format!("CHANNEL_ROLE_NOT_FOUND: {selector}"));
    }

    let agents = repo
        .list_agents(workspace_id)
        .map_err(|error| format!("CHANNEL_ROLE_RESOLVE_FAILED: {error}"))?;
    let mut targets: Vec<String> = agents
        .iter()
        .filter(|agent| {
            matched_role_ids.contains(&agent.role_id) && agent.state != AgentState::Terminated
        })
        .map(|agent| agent.id.clone())
        .collect();
    for runtime in state.task_service.list_runtimes(Some(workspace_id)) {
        let Some(role_key) = runtime.role_key.as_deref() else {
            continue;
        };
        if matched_role_keys.contains(&role_key.to_ascii_lowercase()) {
            targets.push(runtime.agent_id);
        }
    }
    targets.sort();
    targets.dedup();

    if targets.is_empty() {
        return Err(format!(
            "CHANNEL_ROLE_EMPTY: no dispatch targets found for {selector}"
        ));
    }

    Ok(targets)
}

fn resolve_dispatch_targets(
    state: &AppState,
    app: &AppHandle,
    workspace_id: &str,
    target_selector: &str,
) -> Result<Vec<String>, String> {
    let trimmed = target_selector.trim();
    if trimmed.is_empty() {
        return Err("CHANNEL_TARGET_INVALID: target selector is required".to_string());
    }
    if let Some(role_selector) = trimmed.strip_prefix(ROLE_TARGET_PREFIX) {
        return resolve_role_dispatch_targets(state, app, workspace_id, role_selector);
    }
    Ok(vec![trimmed.to_string()])
}

fn into_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

pub(crate) fn process_external_inbound_message(
    state: &AppState,
    app: &AppHandle,
    message: ExternalInboundMessage,
) -> Result<ExternalInboundResponse, String> {
    if message.channel.trim().is_empty() {
        return Err("CHANNEL_EXTERNAL_INVALID: channel is required".to_string());
    }
    if message.peer_id.trim().is_empty() {
        return Err("CHANNEL_EXTERNAL_INVALID: peerId is required".to_string());
    }
    if message.sender_id.trim().is_empty() {
        return Err("CHANNEL_EXTERNAL_INVALID: senderId is required".to_string());
    }
    if message.message_id.trim().is_empty() {
        return Err("CHANNEL_EXTERNAL_INVALID: messageId is required".to_string());
    }

    let account_id = normalize_account_id(Some(&message.account_id));
    let identity = message.sender_id.trim().to_lowercase();
    let idempotency_key = normalized_idempotency_key(&message);
    let trace_id = format!("trace_{}_{}", vb_task::module_name(), idempotency_key);

    let _ = app.emit(
        "external/channel_inbound",
        json!({
            "traceId": trace_id,
            "channel": message.channel,
            "accountId": account_id,
            "peerKind": message.peer_kind,
            "peerId": message.peer_id,
            "senderId": message.sender_id,
            "senderName": message.sender_name,
            "messageId": message.message_id,
            "text": message.text,
        }),
    );

    if let Some(mut cached) = state
        .task_service
        .check_external_idempotency(&idempotency_key)
    {
        cached.idempotent_hit = true;
        cached.status = ExternalInboundStatus::Duplicate;
        return Ok(cached);
    }

    let route = state
        .task_service
        .resolve_external_route(&message)
        .or_else(|| route_from_hints(&message));
    let Some(route) = route else {
        let response = ExternalInboundResponse {
            trace_id: trace_id.clone(),
            status: ExternalInboundStatus::RouteNotFound,
            idempotent_hit: false,
            workspace_id: None,
            target_agent_id: None,
            task_id: None,
            pairing_code: None,
            detail: Some("CHANNEL_ROUTE_NOT_FOUND".to_string()),
        };
        emit_external_error(
            app,
            &response.trace_id,
            "CHANNEL_ROUTE_NOT_FOUND",
            "no route binding matched inbound message",
        );
        state
            .task_service
            .store_external_idempotency(idempotency_key, response.clone());
        return Ok(response);
    };

    let policy = state
        .task_service
        .get_external_access_policy(&message.channel, &account_id);
    let allowed = match policy {
        ExternalAccessPolicyMode::Disabled => false,
        ExternalAccessPolicyMode::Open => true,
        ExternalAccessPolicyMode::Allowlist | ExternalAccessPolicyMode::Pairing => state
            .task_service
            .is_external_allowed(&message.channel, &account_id, &identity),
    };

    if !allowed {
        let response =
            match policy {
                ExternalAccessPolicyMode::Pairing => {
                    let (code, _created, _expires_at_ms) = state
                        .task_service
                        .ensure_external_pairing(&message.channel, &account_id, &identity);
                    let pairing_detail = format!(
                        "CHANNEL_PAIRING_REQUIRED: identity={identity}, pairingCode={code}. \
Approve this identity in Channel settings or switch policy to open."
                    );
                    ExternalInboundResponse {
                        trace_id: trace_id.clone(),
                        status: ExternalInboundStatus::PairingRequired,
                        idempotent_hit: false,
                        workspace_id: Some(route.workspace_id.clone()),
                        target_agent_id: Some(route.target_agent_id.clone()),
                        task_id: None,
                        pairing_code: Some(code),
                        detail: Some(pairing_detail),
                    }
                }
                ExternalAccessPolicyMode::Disabled => ExternalInboundResponse {
                    trace_id: trace_id.clone(),
                    status: ExternalInboundStatus::Denied,
                    idempotent_hit: false,
                    workspace_id: Some(route.workspace_id.clone()),
                    target_agent_id: Some(route.target_agent_id.clone()),
                    task_id: None,
                    pairing_code: None,
                    detail: Some("CHANNEL_DISABLED".to_string()),
                },
                ExternalAccessPolicyMode::Allowlist => ExternalInboundResponse {
                    trace_id: trace_id.clone(),
                    status: ExternalInboundStatus::Denied,
                    idempotent_hit: false,
                    workspace_id: Some(route.workspace_id.clone()),
                    target_agent_id: Some(route.target_agent_id.clone()),
                    task_id: None,
                    pairing_code: None,
                    detail: Some("CHANNEL_ALLOWLIST_DENIED".to_string()),
                },
                ExternalAccessPolicyMode::Open => unreachable!(),
            };
        if let Some(detail) = response.detail.as_deref() {
            emit_external_error(app, &response.trace_id, detail, detail);
        }
        state
            .task_service
            .store_external_idempotency(idempotency_key, response.clone());
        return Ok(response);
    }

    let mut resolved_workspace_id = route.workspace_id.clone();
    let workspace_root = match state.workspace_root_path(&resolved_workspace_id) {
        Ok(path) => path,
        Err(error) => {
            if let Some((workspace_id, path)) =
                resolve_workspace_from_persisted_route(app, state, &message, &route)
            {
                resolved_workspace_id = workspace_id;
                path
            } else {
                let fallback_workspace_id =
                    state.workspace_service.list().ok().and_then(|workspaces| {
                        workspaces
                            .iter()
                            .find(|workspace| workspace.active)
                            .map(|workspace| workspace.workspace_id.to_string())
                            .or_else(|| {
                                if workspaces.len() == 1 {
                                    Some(workspaces[0].workspace_id.to_string())
                                } else {
                                    None
                                }
                            })
                    });
                if let Some(fallback_workspace_id) = fallback_workspace_id {
                    if let Ok(path) = state.workspace_root_path(&fallback_workspace_id) {
                        resolved_workspace_id = fallback_workspace_id;
                        path
                    } else {
                        let response = ExternalInboundResponse {
                            trace_id: trace_id.clone(),
                            status: ExternalInboundStatus::Failed,
                            idempotent_hit: false,
                            workspace_id: Some(route.workspace_id),
                            target_agent_id: Some(route.target_agent_id),
                            task_id: None,
                            pairing_code: None,
                            detail: Some(format!("WORKSPACE_RESOLVE_FAILED: {error}")),
                        };
                        emit_external_error(
                            app,
                            &response.trace_id,
                            "WORKSPACE_RESOLVE_FAILED",
                            &error,
                        );
                        state
                            .task_service
                            .store_external_idempotency(idempotency_key, response.clone());
                        return Ok(response);
                    }
                } else {
                    let response = ExternalInboundResponse {
                        trace_id: trace_id.clone(),
                        status: ExternalInboundStatus::Failed,
                        idempotent_hit: false,
                        workspace_id: Some(route.workspace_id),
                        target_agent_id: Some(route.target_agent_id),
                        task_id: None,
                        pairing_code: None,
                        detail: Some(format!("WORKSPACE_RESOLVE_FAILED: {error}")),
                    };
                    emit_external_error(
                        app,
                        &response.trace_id,
                        "WORKSPACE_RESOLVE_FAILED",
                        &error,
                    );
                    state
                        .task_service
                        .store_external_idempotency(idempotency_key, response.clone());
                    return Ok(response);
                }
            }
        }
    };

    let dispatch_targets = match resolve_dispatch_targets(
        state,
        app,
        &resolved_workspace_id,
        &route.target_agent_id,
    ) {
        Ok(targets) => targets,
        Err(error) => {
            let response = ExternalInboundResponse {
                trace_id: trace_id.clone(),
                status: ExternalInboundStatus::Failed,
                idempotent_hit: false,
                workspace_id: Some(route.workspace_id),
                target_agent_id: Some(route.target_agent_id),
                task_id: None,
                pairing_code: None,
                detail: Some(error.clone()),
            };
            emit_external_error(
                app,
                &response.trace_id,
                "CHANNEL_TARGET_RESOLVE_FAILED",
                &error,
            );
            state
                .task_service
                .store_external_idempotency(idempotency_key, response.clone());
            return Ok(response);
        }
    };

    let _ = app.emit(
        "external/channel_routed",
        json!({
            "traceId": trace_id,
            "workspaceId": resolved_workspace_id,
            "targetAgentId": route.target_agent_id,
            "matchedBy": route.matched_by,
            "resolvedTargets": dispatch_targets,
        }),
    );

    let dispatch_request = TaskDispatchBatchRequest {
        workspace_id: resolved_workspace_id.clone(),
        sender: vb_task::DispatchSender::default(),
        targets: dispatch_targets,
        title: build_external_title(&message.text),
        markdown: message.text.clone(),
        attachments: Vec::new(),
        submit_sequences: std::collections::HashMap::new(),
    };
    let outcome = state.task_service.dispatch_batch(
        &dispatch_request,
        &workspace_root,
        |session_id, command, submit_sequence| {
            let accepted_command = state
                .terminal_provider
                .write_session(session_id, command)
                .map_err(|error| error.to_string())?;
            if !accepted_command {
                Err("CHANNEL_DELIVERY_FAILED: terminal write rejected".to_string())
            } else {
                std::thread::sleep(std::time::Duration::from_millis(50));
                let accepted_submit = state
                    .terminal_provider
                    .write_session(session_id, submit_sequence)
                    .map_err(|error| error.to_string())?;
                if accepted_submit {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    // Some interactive CLIs may consume the first Enter for suggestion/menu handling.
                    // Send a second hard Enter to make external inbound submission deterministic.
                    let _ = state
                        .terminal_provider
                        .write_session(session_id, "\r")
                        .map_err(|error| error.to_string())?;
                    Ok(())
                } else {
                    Err("CHANNEL_DELIVERY_FAILED: terminal submit rejected".to_string())
                }
            }
        },
    );
    emit_dispatch_progress_events(app, &outcome.progress_events);
    emit_channel_events(app, &outcome.ack_events, Some(&trace_id));
    bind_external_reply_sessions(
        state,
        app,
        &message,
        &trace_id,
        &resolved_workspace_id,
        &outcome.response.results,
    );

    let sent_results: Vec<_> = outcome
        .response
        .results
        .iter()
        .filter(|result| result.status == vb_task::TaskDispatchStatus::Sent)
        .collect();
    let response = if !sent_results.is_empty() {
        let detail = if sent_results.len() < outcome.response.results.len() {
            Some(format!(
                "CHANNEL_PARTIAL_DISPATCH: sent {}/{}",
                sent_results.len(),
                outcome.response.results.len()
            ))
        } else {
            None
        };
        ExternalInboundResponse {
            trace_id: trace_id.clone(),
            status: ExternalInboundStatus::Dispatched,
            idempotent_hit: false,
            workspace_id: Some(route.workspace_id),
            target_agent_id: Some(route.target_agent_id),
            task_id: sent_results.first().map(|result| result.task_id.clone()),
            pairing_code: None,
            detail,
        }
    } else if let Some(first_failed) = outcome.response.results.first() {
        ExternalInboundResponse {
            trace_id: trace_id.clone(),
            status: ExternalInboundStatus::Failed,
            idempotent_hit: false,
            workspace_id: Some(route.workspace_id),
            target_agent_id: Some(route.target_agent_id),
            task_id: Some(first_failed.task_id.clone()),
            pairing_code: None,
            detail: first_failed
                .detail
                .clone()
                .or_else(|| Some("CHANNEL_DISPATCH_FAILED_ALL".to_string())),
        }
    } else {
        ExternalInboundResponse {
            trace_id: trace_id.clone(),
            status: ExternalInboundStatus::Failed,
            idempotent_hit: false,
            workspace_id: Some(route.workspace_id),
            target_agent_id: Some(route.target_agent_id),
            task_id: None,
            pairing_code: None,
            detail: Some("CHANNEL_DISPATCH_EMPTY_RESULT".to_string()),
        }
    };
    if response.status == ExternalInboundStatus::Failed {
        emit_external_error(
            app,
            &response.trace_id,
            "CHANNEL_DISPATCH_FAILED",
            response.detail.as_deref().unwrap_or("dispatch failed"),
        );
    }

    state
        .task_service
        .store_external_idempotency(idempotency_key, response.clone());
    Ok(response)
}

#[tauri::command]
pub fn channel_connector_account_upsert(
    request: ChannelConnectorAccountUpsertRequest,
    app: AppHandle,
) -> Result<Value, String> {
    let channel = request.channel.trim().to_ascii_lowercase();
    match channel.as_str() {
        "telegram" => {
            let account = telegram::upsert_account(
                &app,
                telegram::TelegramAccountUpsertInput {
                    account_id: request.account_id,
                    enabled: request.enabled,
                    mode: request.mode,
                    bot_token: request.bot_token,
                    bot_token_ref: request.bot_token_ref,
                    webhook_secret: request.webhook_secret,
                    webhook_secret_ref: request.webhook_secret_ref,
                    webhook_path: request.webhook_path,
                },
            )?;
            Ok(json!({
                "updated": true,
                "channel": channel,
                "account": account,
            }))
        }
        _ => Err(format!(
            "CHANNEL_CONNECTOR_UNSUPPORTED: channel {} is not supported yet",
            request.channel
        )),
    }
}

#[tauri::command]
pub fn channel_connector_account_list(
    request: ChannelConnectorAccountListRequest,
    app: AppHandle,
) -> Result<Value, String> {
    let channel = request.channel.trim().to_ascii_lowercase();
    match channel.as_str() {
        "telegram" => {
            let accounts = telegram::list_accounts(&app)?;
            Ok(json!({
                "channel": channel,
                "accounts": accounts,
            }))
        }
        _ => Err(format!(
            "CHANNEL_CONNECTOR_UNSUPPORTED: channel {} is not supported yet",
            request.channel
        )),
    }
}

#[tauri::command]
pub async fn channel_connector_health(
    request: ChannelConnectorHealthRequest,
    app: AppHandle,
) -> Result<Value, String> {
    let channel = request.channel.trim().to_ascii_lowercase();
    match channel.as_str() {
        "telegram" => {
            let runtime_webhook = crate::channel_adapter_runtime::runtime_snapshot()
                .map(|runtime| runtime.telegram_webhook);
            let snapshot =
                telegram::health_check(&app, request.account_id.as_deref(), runtime_webhook)
                    .await?;
            let _ = app.emit("external/channel_connector_health_changed", &snapshot);
            Ok(json!({
                "channel": channel,
                "health": snapshot,
            }))
        }
        _ => Err(format!(
            "CHANNEL_CONNECTOR_UNSUPPORTED: channel {} is not supported yet",
            request.channel
        )),
    }
}

#[tauri::command]
pub async fn channel_connector_webhook_sync(
    request: ChannelConnectorWebhookSyncRequest,
    app: AppHandle,
) -> Result<Value, String> {
    let channel = request.channel.trim().to_ascii_lowercase();
    match channel.as_str() {
        "telegram" => {
            let runtime = crate::channel_adapter_runtime::runtime_snapshot().ok_or_else(|| {
                "CHANNEL_RUNTIME_NOT_READY: runtime webhook unavailable".to_string()
            })?;
            let webhook_url = request
                .webhook_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(runtime.telegram_webhook.as_str())
                .to_string();
            let snapshot =
                telegram::sync_runtime_webhook(&app, request.account_id.as_deref(), &webhook_url)
                    .await?;
            Ok(json!({
                "channel": channel,
                "result": snapshot,
            }))
        }
        _ => Err(format!(
            "CHANNEL_CONNECTOR_UNSUPPORTED: channel {} is not supported yet",
            request.channel
        )),
    }
}

#[tauri::command]
pub fn channel_adapter_status(state: State<'_, AppState>, app: AppHandle) -> Result<Value, String> {
    let runtime = crate::channel_adapter_runtime::runtime_snapshot();
    let running = runtime.is_some();
    let snapshot = state.task_service.doctor_external_snapshot();
    let telegram_accounts = telegram::list_accounts(&app).unwrap_or_default();
    Ok(json!({
        "running": running,
        "adapters": [
            {
                "id": "feishu",
                "mode": "webhook",
                "enabled": running,
                "accounts": []
            },
            {
                "id": "telegram",
                "mode": "webhook",
                "enabled": running,
                "accounts": telegram_accounts
            }
        ],
        "runtime": runtime,
        "snapshot": snapshot,
    }))
}

#[tauri::command]
pub async fn channel_binding_upsert(
    mut binding: ChannelRouteBinding,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if binding.workspace_id.trim().is_empty() {
        return Err("CHANNEL_BINDING_INVALID: workspaceId is required".to_string());
    }
    if binding.channel.trim().is_empty() {
        return Err("CHANNEL_BINDING_INVALID: channel is required".to_string());
    }
    if binding.target_agent_id.trim().is_empty() {
        return Err("CHANNEL_BINDING_INVALID: targetAgentId is required".to_string());
    }
    let needs_bot_name = binding
        .bot_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none();
    if needs_bot_name {
        if let Some(bot_name) = resolve_binding_bot_name(&app, &binding).await {
            binding.bot_name = Some(bot_name);
        }
    }
    let created = state.task_service.upsert_route_binding(binding.clone());
    persist_route_bindings(&app, state.inner())?;
    Ok(json!({
        "updated": true,
        "created": created,
        "binding": binding,
    }))
}

#[tauri::command]
pub fn channel_binding_list(
    request: ChannelBindingListRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let bindings = state
        .task_service
        .list_route_bindings(request.workspace_id.as_deref());
    Ok(json!({
        "bindings": bindings,
    }))
}

#[tauri::command]
pub fn channel_binding_delete(
    binding: ChannelRouteBinding,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if binding.workspace_id.trim().is_empty() {
        return Err("CHANNEL_BINDING_INVALID: workspaceId is required".to_string());
    }
    if binding.channel.trim().is_empty() {
        return Err("CHANNEL_BINDING_INVALID: channel is required".to_string());
    }
    if binding.target_agent_id.trim().is_empty() {
        return Err("CHANNEL_BINDING_INVALID: targetAgentId is required".to_string());
    }
    let deleted = state.task_service.delete_route_binding(binding.clone());
    persist_route_bindings(&app, state.inner())?;
    Ok(json!({
        "deleted": deleted,
        "binding": binding,
    }))
}

#[tauri::command]
pub fn channel_access_policy_set(
    request: ChannelAccessPolicySetRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if request.channel.trim().is_empty() {
        return Err("CHANNEL_ACCESS_POLICY_INVALID: channel is required".to_string());
    }
    let account_id = normalize_account_id(request.account_id.as_deref());
    state.task_service.set_external_access_policy(
        &request.channel,
        &account_id,
        request.mode.clone(),
    );
    persist_access_policy(&app, &request.channel, &account_id, request.mode)?;
    Ok(json!({
        "updated": true,
        "channel": request.channel,
        "accountId": account_id,
        "mode": request.mode,
    }))
}

#[tauri::command]
pub fn channel_access_approve(
    request: ChannelAccessApproveRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if request.channel.trim().is_empty() {
        return Err("CHANNEL_ACCESS_INVALID: channel is required".to_string());
    }
    if request.identity.trim().is_empty() {
        return Err("CHANNEL_ACCESS_INVALID: identity is required".to_string());
    }
    let account_id = normalize_account_id(request.account_id.as_deref());
    let approved = state.task_service.approve_external_access(
        &request.channel,
        &account_id,
        &request.identity,
    );
    if approved {
        persist_allow_entry(&app, &request.channel, &account_id, &request.identity)?;
    }
    Ok(json!({
        "approved": approved,
        "channel": request.channel,
        "accountId": account_id,
        "identity": request.identity,
    }))
}

#[tauri::command]
pub fn channel_access_list(
    request: ChannelAccessListRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if request.channel.trim().is_empty() {
        return Err("CHANNEL_ACCESS_INVALID: channel is required".to_string());
    }
    let entries = state
        .task_service
        .list_external_access(&request.channel, request.account_id.as_deref());
    Ok(json!({
        "channel": request.channel,
        "accountId": request.account_id,
        "entries": entries,
    }))
}

#[tauri::command]
pub fn channel_external_inbound(
    request: ExternalInboundRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let response = process_external_inbound_message(state.inner(), &app, request.message)?;
    into_value(response)
}

#[cfg(test)]
#[path = "../tests/channel_adapter_tests.rs"]
mod tests;
