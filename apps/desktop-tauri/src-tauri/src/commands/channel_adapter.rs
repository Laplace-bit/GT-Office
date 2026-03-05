use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::{sleep, Duration};
use tracing::{debug, warn};
use vb_abstractions::WorkspaceService;
use vb_agent::{AgentRepository, AgentState, RoleStatus};
use vb_storage::{SqliteAgentRepository, SqliteStorage};
use vb_task::{
    ChannelAckEvent, ChannelRouteBinding, ExternalAccessPolicyMode, ExternalInboundMessage,
    ExternalInboundResponse, ExternalInboundStatus, ExternalRouteResolution,
    TaskDispatchBatchRequest, TaskDispatchProgressEvent, TaskDispatchStatus,
};

use crate::{
    app_state::{AppState, ExternalReplyDispatchPhase, ExternalReplyRelayTarget},
    connectors::telegram,
};

const EXTERNAL_REPLY_FLUSH_LOOP_MS: u64 = 700;
const EXTERNAL_REPLY_IDLE_FLUSH_MS: u64 = 8_000;
const EXTERNAL_REPLY_MAX_WAIT_MS: u64 = 15 * 60 * 1000;
const EXTERNAL_REPLY_STREAM_THROTTLE_MS: u64 = 1_000;
const EXTERNAL_REPLY_STREAM_MIN_INITIAL_CHARS: usize = 24;
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

    let runtime_by_agent: HashMap<String, String> = state
        .task_service
        .list_runtimes(Some(workspace_id))
        .into_iter()
        .map(|runtime| (runtime.agent_id, runtime.session_id))
        .collect();

    for result in results {
        if result.status != TaskDispatchStatus::Sent {
            continue;
        }
        let Some(session_id) = runtime_by_agent.get(&result.target_agent_id) else {
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
        }
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
    for candidate in candidates {
        let text = truncate_text_for_channel(&candidate.text, EXTERNAL_REPLY_MAX_TEXT_CHARS);
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
                                } else {
                                    "reply finalized"
                                },
                                "tsMs": send_result.delivered_at_ms,
                            }),
                        );
                    }
                    Err(error) => {
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
pub fn channel_binding_upsert(
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
