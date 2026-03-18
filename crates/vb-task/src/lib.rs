use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DispatchSenderType {
    Human,
    Agent,
}

impl Default for DispatchSenderType {
    fn default() -> Self {
        Self::Human
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DispatchSender {
    #[serde(rename = "type", default)]
    pub sender_type: DispatchSenderType,
    #[serde(default)]
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttachment {
    pub path: String,
    pub name: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDispatchBatchRequest {
    pub workspace_id: String,
    #[serde(default)]
    pub sender: DispatchSender,
    pub targets: Vec<String>,
    pub title: String,
    pub markdown: String,
    #[serde(default)]
    pub attachments: Vec<TaskAttachment>,
    #[serde(default)]
    pub submit_sequences: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskDispatchStatus {
    Sent,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskDispatchProgressStatus {
    Sending,
    Sent,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDispatchTargetResult {
    pub target_agent_id: String,
    pub task_id: String,
    pub status: TaskDispatchStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDispatchBatchResponse {
    pub batch_id: String,
    pub results: Vec<TaskDispatchTargetResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    Direct,
    Group,
    Broadcast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelMessageType {
    TaskInstruction,
    Status,
    Handover,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDescriptor {
    pub kind: ChannelKind,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPublishRequest {
    pub workspace_id: String,
    pub channel: ChannelDescriptor,
    #[serde(default)]
    pub sender_agent_id: Option<String>,
    #[serde(default)]
    pub target_agent_ids: Vec<String>,
    #[serde(rename = "type")]
    pub message_type: ChannelMessageType,
    pub payload: Value,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExternalPeerKind {
    Direct,
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInboundMessage {
    pub channel: String,
    #[serde(default)]
    pub account_id: String,
    pub peer_kind: ExternalPeerKind,
    pub peer_id: String,
    pub sender_id: String,
    #[serde(default)]
    pub sender_name: Option<String>,
    pub message_id: String,
    pub text: String,
    #[serde(default)]
    pub idempotency_key: Option<String>,
    #[serde(default)]
    pub workspace_id_hint: Option<String>,
    #[serde(default)]
    pub target_agent_id_hint: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExternalAccessPolicyMode {
    Pairing,
    Allowlist,
    Open,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRouteBinding {
    pub workspace_id: String,
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub peer_kind: Option<ExternalPeerKind>,
    #[serde(default)]
    pub peer_pattern: Option<String>,
    pub target_agent_id: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub created_at_ms: Option<u64>,
    #[serde(default)]
    pub bot_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRouteResolution {
    pub workspace_id: String,
    pub target_agent_id: String,
    pub matched_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAccessEntry {
    pub channel: String,
    pub account_id: String,
    pub identity: String,
    pub approved: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalInboundStatus {
    Dispatched,
    Duplicate,
    PairingRequired,
    Denied,
    RouteNotFound,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInboundResponse {
    pub trace_id: String,
    pub status: ExternalInboundStatus,
    #[serde(default)]
    pub idempotent_hit: bool,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub target_agent_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub pairing_code: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFailedTarget {
    pub agent_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPublishResponse {
    pub message_id: String,
    pub accepted_targets: Vec<String>,
    pub failed_targets: Vec<ChannelFailedTarget>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChannelAckStatus {
    Delivered,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageEvent {
    pub workspace_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub seq: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_agent_id: Option<String>,
    pub target_agent_id: String,
    #[serde(rename = "type")]
    pub message_type: ChannelMessageType,
    pub payload: Value,
    pub ts_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAckEvent {
    pub workspace_id: String,
    pub message_id: String,
    pub target_agent_id: String,
    pub status: ChannelAckStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub ts_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDispatchProgressEvent {
    pub batch_id: String,
    pub workspace_id: String,
    pub target_agent_id: String,
    pub task_id: String,
    pub status: TaskDispatchProgressStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeRegistration {
    pub workspace_id: String,
    pub agent_id: String,
    pub station_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_key: Option<String>,
    pub session_id: String,
    #[serde(default)]
    pub tool_kind: AgentToolKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submit_sequence: Option<String>,
    #[serde(default = "default_true")]
    pub online: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolKind {
    Claude,
    Codex,
    Gemini,
    Shell,
    #[default]
    Unknown,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPublishOutcome {
    pub response: ChannelPublishResponse,
    pub message_events: Vec<ChannelMessageEvent>,
    pub ack_events: Vec<ChannelAckEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelListMessagesResponse {
    pub messages: Vec<ChannelMessageEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDispatchBatchOutcome {
    pub response: TaskDispatchBatchResponse,
    pub progress_events: Vec<TaskDispatchProgressEvent>,
    pub message_events: Vec<ChannelMessageEvent>,
    pub ack_events: Vec<ChannelAckEvent>,
}

#[derive(Default)]
struct TaskServiceState {
    runtimes: HashMap<String, AgentRuntimeRegistration>,
    channel_seq: HashMap<String, u64>,
    channel_messages: Vec<ChannelMessageEvent>,
    route_bindings: Vec<ChannelRouteBinding>,
    access_policies: HashMap<String, ExternalAccessPolicyMode>,
    allowlist_entries: HashSet<String>,
    pairing_requests: HashMap<String, PairingRequestRecord>,
    idempotency_cache: HashMap<String, ExternalInboundResponse>,
}

#[derive(Clone)]
pub struct TaskService {
    state: Arc<RwLock<TaskServiceState>>,
    id_counter: Arc<AtomicU64>,
}

impl Default for TaskService {
    fn default() -> Self {
        Self {
            state: Arc::new(RwLock::new(TaskServiceState::default())),
            id_counter: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl TaskService {
    pub fn list_messages(
        &self,
        workspace_id: &str,
        target_agent_id: Option<&str>,
        sender_agent_id: Option<&str>,
        task_id: Option<&str>,
        limit: usize,
    ) -> Vec<ChannelMessageEvent> {
        let guard = match self.state.read() {
            Ok(guard) => guard,
            Err(_) => return Vec::new(),
        };
        let target_agent_id = target_agent_id.map(str::trim).filter(|value| !value.is_empty());
        let sender_agent_id = sender_agent_id.map(str::trim).filter(|value| !value.is_empty());
        let task_id = task_id.map(str::trim).filter(|value| !value.is_empty());
        let limit = limit.max(1);

        let mut messages: Vec<ChannelMessageEvent> = guard
            .channel_messages
            .iter()
            .filter(|message| message.workspace_id == workspace_id)
            .filter(|message| {
                target_agent_id
                    .map(|agent_id| message.target_agent_id == agent_id)
                    .unwrap_or(true)
            })
            .filter(|message| {
                sender_agent_id
                    .map(|agent_id| message.sender_agent_id.as_deref() == Some(agent_id))
                    .unwrap_or(true)
            })
            .filter(|message| {
                task_id
                    .map(|task_id| message.payload.get("taskId").and_then(Value::as_str) == Some(task_id))
                    .unwrap_or(true)
            })
            .cloned()
            .collect();

        messages.sort_by(|left, right| right.ts_ms.cmp(&left.ts_ms));
        messages.truncate(limit);
        messages
    }

    pub fn register_runtime(&self, registration: AgentRuntimeRegistration) -> bool {
        let key = runtime_key(&registration.workspace_id, &registration.agent_id);
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        if !registration.online {
            guard.runtimes.remove(&key);
            return false;
        }
        debug!(
            workspace_id = %registration.workspace_id,
            agent_id = %registration.agent_id,
            station_id = %registration.station_id,
            session_id = %registration.session_id,
            tool_kind = ?registration.tool_kind,
            resolved_cwd = ?registration.resolved_cwd,
            "registered agent runtime"
        );
        guard.runtimes.insert(key, registration);
        true
    }

    pub fn unregister_runtime(&self, workspace_id: &str, agent_id: &str) -> bool {
        let key = runtime_key(workspace_id, agent_id);
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        guard.runtimes.remove(&key).is_some()
    }

    pub fn list_runtimes(&self, workspace_id: Option<&str>) -> Vec<AgentRuntimeRegistration> {
        let guard = match self.state.read() {
            Ok(guard) => guard,
            Err(_) => return Vec::new(),
        };
        let mut runtimes: Vec<AgentRuntimeRegistration> =
            guard.runtimes.values().cloned().collect();
        if let Some(workspace_id) = workspace_id {
            runtimes.retain(|runtime| runtime.workspace_id == workspace_id);
        }
        runtimes
    }

    pub fn upsert_route_binding(&self, binding: ChannelRouteBinding) -> bool {
        let mut normalized = normalize_binding(binding);
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => return false,
        };

        if let Some(existing) = guard.route_bindings.iter_mut().find(|entry| {
            entry.workspace_id == normalized.workspace_id
                && normalize_token(&entry.channel) == normalize_token(&normalized.channel)
                && normalize_optional_token(&entry.account_id)
                    == normalize_optional_token(&normalized.account_id)
                && entry.peer_kind == normalized.peer_kind
                && normalize_optional_token(&entry.peer_pattern)
                    == normalize_optional_token(&normalized.peer_pattern)
        }) {
            normalized.created_at_ms = existing
                .created_at_ms
                .or(normalized.created_at_ms)
                .or(Some(now_ms()));
            normalized.bot_name = normalized.bot_name.or_else(|| existing.bot_name.clone());
            *existing = normalized;
            return false;
        }

        if normalized.created_at_ms.is_none() {
            normalized.created_at_ms = Some(now_ms());
        }
        guard.route_bindings.push(normalized);
        true
    }

    pub fn delete_route_binding(&self, binding: ChannelRouteBinding) -> bool {
        let normalized = normalize_binding(binding);
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => return false,
        };

        let initial_len = guard.route_bindings.len();
        guard.route_bindings.retain(|entry| {
            !(entry.workspace_id == normalized.workspace_id
                && normalize_token(&entry.channel) == normalize_token(&normalized.channel)
                && normalize_optional_token(&entry.account_id)
                    == normalize_optional_token(&normalized.account_id)
                && entry.peer_kind == normalized.peer_kind
                && normalize_optional_token(&entry.peer_pattern)
                    == normalize_optional_token(&normalized.peer_pattern))
        });

        guard.route_bindings.len() < initial_len
    }

    pub fn list_route_bindings(&self, workspace_id: Option<&str>) -> Vec<ChannelRouteBinding> {
        let guard = match self.state.read() {
            Ok(guard) => guard,
            Err(_) => return Vec::new(),
        };
        guard
            .route_bindings
            .iter()
            .filter(|binding| {
                workspace_id
                    .map(|workspace| binding.workspace_id == workspace)
                    .unwrap_or(true)
            })
            .cloned()
            .collect()
    }

    pub fn set_external_access_policy(
        &self,
        channel: &str,
        account_id: &str,
        mode: ExternalAccessPolicyMode,
    ) {
        let key = access_policy_key(channel, account_id);
        if let Ok(mut guard) = self.state.write() {
            guard.access_policies.insert(key, mode);
        }
    }

    pub fn get_external_access_policy(
        &self,
        channel: &str,
        account_id: &str,
    ) -> ExternalAccessPolicyMode {
        let key = access_policy_key(channel, account_id);
        let guard = match self.state.read() {
            Ok(guard) => guard,
            Err(_) => return ExternalAccessPolicyMode::Pairing,
        };
        guard
            .access_policies
            .get(&key)
            .copied()
            .unwrap_or(ExternalAccessPolicyMode::Pairing)
    }

    pub fn approve_external_access(&self, channel: &str, account_id: &str, identity: &str) -> bool {
        let key = allowlist_key(channel, account_id, identity);
        let pairing_key = pairing_key(channel, account_id, identity);
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        guard.pairing_requests.remove(&pairing_key);
        guard.allowlist_entries.insert(key)
    }

    pub fn list_external_access(
        &self,
        channel: &str,
        account_id: Option<&str>,
    ) -> Vec<ExternalAccessEntry> {
        let channel_key = normalize_token(channel);
        let scoped_account = account_id
            .map(normalize_account_id)
            .unwrap_or_else(|| "default".to_string());
        let guard = match self.state.read() {
            Ok(guard) => guard,
            Err(_) => return Vec::new(),
        };
        guard
            .allowlist_entries
            .iter()
            .filter_map(|entry| parse_allowlist_key(entry))
            .filter(|(entry_channel, entry_account, _)| {
                if entry_channel.as_str() != channel_key.as_str() {
                    return false;
                }
                account_id.is_none() || entry_account.as_str() == scoped_account.as_str()
            })
            .map(
                |(entry_channel, entry_account, identity)| ExternalAccessEntry {
                    channel: entry_channel,
                    account_id: entry_account,
                    identity,
                    approved: true,
                },
            )
            .collect()
    }

    pub fn resolve_external_route(
        &self,
        inbound: &ExternalInboundMessage,
    ) -> Option<ExternalRouteResolution> {
        self.resolve_external_route_matching(inbound, |_| true)
    }

    pub fn resolve_external_route_in_workspace(
        &self,
        workspace_id: &str,
        inbound: &ExternalInboundMessage,
    ) -> Option<ExternalRouteResolution> {
        let workspace_id = workspace_id.trim();
        if workspace_id.is_empty() {
            return None;
        }
        self.resolve_external_route_matching(inbound, |binding| {
            binding.workspace_id == workspace_id
        })
    }

    fn resolve_external_route_matching<F>(
        &self,
        inbound: &ExternalInboundMessage,
        workspace_filter: F,
    ) -> Option<ExternalRouteResolution>
    where
        F: Fn(&ChannelRouteBinding) -> bool,
    {
        let channel = normalize_token(&inbound.channel);
        let account_id = normalize_account_id(&inbound.account_id);
        let peer_id = inbound.peer_id.trim();
        if peer_id.is_empty() {
            return None;
        }

        let guard = self.state.read().ok()?;
        let mut candidates: Vec<(i32, &ChannelRouteBinding, String)> = Vec::new();
        for binding in &guard.route_bindings {
            if !workspace_filter(binding) {
                continue;
            }
            if normalize_token(&binding.channel) != channel {
                continue;
            }
            if !binding_account_matches(binding, &account_id) {
                continue;
            }
            if let Some(kind) = binding.peer_kind {
                if kind != inbound.peer_kind {
                    continue;
                }
            }
            if let Some(pattern) = binding.peer_pattern.as_deref() {
                if !wildcard_matches(pattern, peer_id) {
                    continue;
                }
            }
            let score = route_score(binding);
            let matched_by = resolve_matched_by(binding);
            candidates.push((score, binding, matched_by));
        }
        candidates.sort_by(|a, b| b.0.cmp(&a.0));
        let (_, selected, matched_by) = candidates.first()?;
        Some(ExternalRouteResolution {
            workspace_id: selected.workspace_id.clone(),
            target_agent_id: selected.target_agent_id.clone(),
            matched_by: matched_by.clone(),
        })
    }

    pub fn ensure_external_pairing(
        &self,
        channel: &str,
        account_id: &str,
        identity: &str,
    ) -> (String, bool, u64) {
        const PAIRING_TTL_MS: u64 = 60 * 60 * 1000;
        let key = pairing_key(channel, account_id, identity);
        let now = now_ms();
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => {
                return ("PAIRING_ERR".to_string(), false, now + PAIRING_TTL_MS);
            }
        };
        if let Some(existing) = guard.pairing_requests.get_mut(&key) {
            if existing.expires_at_ms > now {
                existing.last_seen_at_ms = now;
                return (existing.code.clone(), false, existing.expires_at_ms);
            }
        }
        let code = generate_pairing_code(self.id_counter.fetch_add(1, Ordering::Relaxed) + 1);
        let expires_at_ms = now + PAIRING_TTL_MS;
        guard.pairing_requests.insert(
            key,
            PairingRequestRecord {
                code: code.clone(),
                expires_at_ms,
                last_seen_at_ms: now,
            },
        );
        (code, true, expires_at_ms)
    }

    pub fn is_external_allowed(&self, channel: &str, account_id: &str, identity: &str) -> bool {
        let key = allowlist_key(channel, account_id, identity);
        let guard = match self.state.read() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        guard.allowlist_entries.contains(&key)
    }

    pub fn check_external_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Option<ExternalInboundResponse> {
        let guard = self.state.read().ok()?;
        guard.idempotency_cache.get(idempotency_key).cloned()
    }

    pub fn store_external_idempotency(
        &self,
        idempotency_key: String,
        response: ExternalInboundResponse,
    ) {
        if let Ok(mut guard) = self.state.write() {
            guard.idempotency_cache.insert(idempotency_key, response);
        }
    }

    pub fn clear_external_idempotency_cache(&self) {
        if let Ok(mut guard) = self.state.write() {
            guard.idempotency_cache.clear();
        }
    }

    pub fn doctor_external_snapshot(&self) -> Value {
        let guard = match self.state.read() {
            Ok(guard) => guard,
            Err(_) => {
                return json!({
                    "ok": false,
                    "error": "TASK_STATE_LOCK_POISONED",
                });
            }
        };
        let now = now_ms();
        let pending_pairing = guard
            .pairing_requests
            .values()
            .filter(|entry| entry.expires_at_ms > now)
            .count();
        json!({
            "ok": true,
            "routeBindings": guard.route_bindings.len(),
            "allowlistEntries": guard.allowlist_entries.len(),
            "pairingPending": pending_pairing,
            "idempotencyEntries": guard.idempotency_cache.len(),
        })
    }

    pub fn publish(&self, request: &ChannelPublishRequest) -> ChannelPublishOutcome {
        let now = now_ms();
        let base_message_id = self.next_id("msg");
        let mut message_events = Vec::new();
        let mut ack_events = Vec::new();
        let mut accepted_targets = Vec::new();
        let mut failed_targets = Vec::new();

        let targets = resolve_publish_targets(request);
        for (index, target_agent_id) in targets.iter().enumerate() {
            let runtime = self.runtime_for(&request.workspace_id, target_agent_id);
            if runtime.is_none() {
                failed_targets.push(ChannelFailedTarget {
                    agent_id: target_agent_id.clone(),
                    reason: "AGENT_OFFLINE".to_string(),
                });
                ack_events.push(ChannelAckEvent {
                    workspace_id: request.workspace_id.clone(),
                    message_id: format!("{base_message_id}-{index}"),
                    target_agent_id: target_agent_id.clone(),
                    status: ChannelAckStatus::Failed,
                    reason: Some("AGENT_OFFLINE".to_string()),
                    ts_ms: now,
                });
                continue;
            }

            let message_id = format!("{base_message_id}-{index}");
            let channel_id = display_channel_id(
                &request.channel.kind,
                &request.channel.id,
                Some(target_agent_id),
            );
            let seq = self.next_channel_seq(&channel_id);
            message_events.push(ChannelMessageEvent {
                workspace_id: request.workspace_id.clone(),
                channel_id,
                message_id: message_id.clone(),
                seq,
                sender_agent_id: request.sender_agent_id.clone(),
                target_agent_id: target_agent_id.clone(),
                message_type: request.message_type.clone(),
                payload: request.payload.clone(),
                ts_ms: now,
            });
            ack_events.push(ChannelAckEvent {
                workspace_id: request.workspace_id.clone(),
                message_id,
                target_agent_id: target_agent_id.clone(),
                status: ChannelAckStatus::Delivered,
                reason: None,
                ts_ms: now,
            });
            accepted_targets.push(target_agent_id.clone());
        }

        self.store_channel_messages(&message_events);

        ChannelPublishOutcome {
            response: ChannelPublishResponse {
                message_id: base_message_id,
                accepted_targets,
                failed_targets,
            },
            message_events,
            ack_events,
        }
    }

    pub fn dispatch_batch<F>(
        &self,
        request: &TaskDispatchBatchRequest,
        workspace_root: &Path,
        mut write_terminal: F,
    ) -> TaskDispatchBatchOutcome
    where
        F: FnMut(&str, &str, &str) -> Result<(), String>,
    {
        let batch_id = self.next_id("batch");
        let created_at_ms = now_ms();
        let title = sanitize_title(&request.title);
        let sender = request.sender.clone();
        let mut results = Vec::new();
        let mut progress_events = Vec::new();
        let mut message_events = Vec::new();
        let mut ack_events = Vec::new();

        for target_agent_id in normalize_agent_ids(&request.targets) {
            let task_id = self.next_id("task");
            progress_events.push(TaskDispatchProgressEvent {
                batch_id: batch_id.clone(),
                workspace_id: request.workspace_id.clone(),
                target_agent_id: target_agent_id.clone(),
                task_id: task_id.clone(),
                status: TaskDispatchProgressStatus::Sending,
                detail: None,
            });

            let runtime = self.runtime_for(&request.workspace_id, &target_agent_id);
            let Some(runtime) = runtime else {
                let detail = "AGENT_OFFLINE".to_string();
                results.push(TaskDispatchTargetResult {
                    target_agent_id: target_agent_id.clone(),
                    task_id: task_id.clone(),
                    status: TaskDispatchStatus::Failed,
                    detail: Some(detail.clone()),
                    task_file_path: None,
                });
                progress_events.push(TaskDispatchProgressEvent {
                    batch_id: batch_id.clone(),
                    workspace_id: request.workspace_id.clone(),
                    target_agent_id,
                    task_id,
                    status: TaskDispatchProgressStatus::Failed,
                    detail: Some(detail),
                });
                continue;
            };

            let write_outcome = write_task_bundle(
                workspace_root,
                &task_id,
                &title,
                request,
                &target_agent_id,
                created_at_ms,
            );
            let (task_file_path, _manifest_path) = match write_outcome {
                Ok(paths) => paths,
                Err(error) => {
                    results.push(TaskDispatchTargetResult {
                        target_agent_id: target_agent_id.clone(),
                        task_id: task_id.clone(),
                        status: TaskDispatchStatus::Failed,
                        detail: Some(error.clone()),
                        task_file_path: None,
                    });
                    progress_events.push(TaskDispatchProgressEvent {
                        batch_id: batch_id.clone(),
                        workspace_id: request.workspace_id.clone(),
                        target_agent_id,
                        task_id,
                        status: TaskDispatchProgressStatus::Failed,
                        detail: Some(error),
                    });
                    continue;
                }
            };

            let message_id = self.next_id("msg");
            let channel_id = display_channel_id(&ChannelKind::Direct, &target_agent_id, None);
            let seq = self.next_channel_seq(&channel_id);
            let payload = json!({
                "batchId": batch_id,
                "taskId": task_id,
                "title": title,
                "taskFilePath": task_file_path,
                "attachments": request.attachments,
                "sender": {
                    "type": match sender.sender_type {
                        DispatchSenderType::Human => "human",
                        DispatchSenderType::Agent => "agent",
                    },
                    "agentId": sender.agent_id,
                },
            });

            let submit_sequence = resolve_submit_sequence(request, &target_agent_id, &runtime);
            let command = build_task_dispatch_command(
                &enrich_dispatch_markdown(&request.markdown, request, &task_id),
                &task_id,
                &task_file_path,
            );
            if let Err(error) = write_terminal(&runtime.session_id, &command, &submit_sequence) {
                warn!(
                    workspace_id = %request.workspace_id,
                    agent_id = %target_agent_id,
                    session_id = %runtime.session_id,
                    error = %error,
                    "task dispatch terminal write failed"
                );
                ack_events.push(ChannelAckEvent {
                    workspace_id: request.workspace_id.clone(),
                    message_id,
                    target_agent_id: target_agent_id.clone(),
                    status: ChannelAckStatus::Failed,
                    reason: Some(error.clone()),
                    ts_ms: now_ms(),
                });
                results.push(TaskDispatchTargetResult {
                    target_agent_id: target_agent_id.clone(),
                    task_id: task_id.clone(),
                    status: TaskDispatchStatus::Failed,
                    detail: Some(error.clone()),
                    task_file_path: Some(task_file_path.clone()),
                });
                progress_events.push(TaskDispatchProgressEvent {
                    batch_id: batch_id.clone(),
                    workspace_id: request.workspace_id.clone(),
                    target_agent_id,
                    task_id,
                    status: TaskDispatchProgressStatus::Failed,
                    detail: Some(error),
                });
                continue;
            }

            message_events.push(ChannelMessageEvent {
                workspace_id: request.workspace_id.clone(),
                channel_id,
                message_id: message_id.clone(),
                seq,
                sender_agent_id: sender.agent_id.clone(),
                target_agent_id: target_agent_id.clone(),
                message_type: ChannelMessageType::TaskInstruction,
                payload,
                ts_ms: now_ms(),
            });
            ack_events.push(ChannelAckEvent {
                workspace_id: request.workspace_id.clone(),
                message_id,
                target_agent_id: target_agent_id.clone(),
                status: ChannelAckStatus::Delivered,
                reason: None,
                ts_ms: now_ms(),
            });
            results.push(TaskDispatchTargetResult {
                target_agent_id: target_agent_id.clone(),
                task_id: task_id.clone(),
                status: TaskDispatchStatus::Sent,
                detail: None,
                task_file_path: Some(task_file_path),
            });
            progress_events.push(TaskDispatchProgressEvent {
                batch_id: batch_id.clone(),
                workspace_id: request.workspace_id.clone(),
                target_agent_id,
                task_id,
                status: TaskDispatchProgressStatus::Sent,
                detail: None,
            });
        }

        self.store_channel_messages(&message_events);

        TaskDispatchBatchOutcome {
            response: TaskDispatchBatchResponse { batch_id, results },
            progress_events,
            message_events,
            ack_events,
        }
    }

    fn runtime_for(&self, workspace_id: &str, agent_id: &str) -> Option<AgentRuntimeRegistration> {
        let guard = self.state.read().ok()?;
        guard
            .runtimes
            .get(&runtime_key(workspace_id, agent_id))
            .cloned()
    }

    fn next_channel_seq(&self, channel_id: &str) -> u64 {
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => return 1,
        };
        let next = guard.channel_seq.get(channel_id).copied().unwrap_or(0) + 1;
        guard.channel_seq.insert(channel_id.to_string(), next);
        next
    }

    fn next_id(&self, prefix: &str) -> String {
        let seq = self.id_counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("{prefix}_{:x}_{:x}", now_ms(), seq)
    }

    fn store_channel_messages(&self, messages: &[ChannelMessageEvent]) {
        const MAX_CHANNEL_MESSAGES: usize = 512;

        if messages.is_empty() {
            return;
        }
        let mut guard = match self.state.write() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        guard.channel_messages.extend(messages.iter().cloned());
        if guard.channel_messages.len() > MAX_CHANNEL_MESSAGES {
            let remove_count = guard.channel_messages.len() - MAX_CHANNEL_MESSAGES;
            guard.channel_messages.drain(0..remove_count);
        }
    }
}

fn runtime_key(workspace_id: &str, agent_id: &str) -> String {
    format!("{workspace_id}:{agent_id}")
}

fn normalize_token(value: &str) -> String {
    value.trim().to_lowercase()
}

fn normalize_optional_token(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(normalize_token)
        .filter(|value| !value.is_empty())
}

fn normalize_optional_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_account_id(value: &str) -> String {
    let normalized = normalize_token(value);
    if normalized.is_empty() {
        "default".to_string()
    } else {
        normalized
    }
}

fn normalize_binding(mut binding: ChannelRouteBinding) -> ChannelRouteBinding {
    binding.channel = normalize_token(&binding.channel);
    binding.workspace_id = binding.workspace_id.trim().to_string();
    binding.target_agent_id = binding.target_agent_id.trim().to_string();
    binding.account_id = normalize_optional_token(&binding.account_id);
    binding.peer_pattern = binding
        .peer_pattern
        .as_deref()
        .map(str::trim)
        .map(str::to_string)
        .filter(|value| !value.is_empty());
    binding.bot_name = normalize_optional_text(&binding.bot_name);
    binding
}

fn route_score(binding: &ChannelRouteBinding) -> i32 {
    let mut score = binding.priority.saturating_mul(1000);
    if binding.account_id.is_some() {
        score += 100;
    }
    if binding.peer_kind.is_some() {
        score += 50;
    }
    if binding.peer_pattern.is_some() {
        score += 30;
    }
    score
}

fn resolve_matched_by(binding: &ChannelRouteBinding) -> String {
    if binding.peer_pattern.is_some() {
        return "binding.peer".to_string();
    }
    if binding.account_id.is_some() {
        return "binding.account".to_string();
    }
    "binding.channel".to_string()
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern == "*" {
        return true;
    }
    if !pattern.contains('*') {
        return pattern.eq_ignore_ascii_case(value.trim());
    }
    let mut remaining = value.to_lowercase();
    for segment in pattern
        .to_lowercase()
        .split('*')
        .filter(|segment| !segment.is_empty())
    {
        if let Some(pos) = remaining.find(segment) {
            remaining = remaining[(pos + segment.len())..].to_string();
        } else {
            return false;
        }
    }
    true
}

fn binding_account_matches(binding: &ChannelRouteBinding, account_id: &str) -> bool {
    match binding.account_id.as_deref() {
        None => true,
        Some("*") => true,
        Some(value) => normalize_token(value) == account_id,
    }
}

fn access_policy_key(channel: &str, account_id: &str) -> String {
    format!(
        "{}:{}",
        normalize_token(channel),
        normalize_account_id(account_id)
    )
}

fn allowlist_key(channel: &str, account_id: &str, identity: &str) -> String {
    format!(
        "{}:{}:{}",
        normalize_token(channel),
        normalize_account_id(account_id),
        normalize_token(identity)
    )
}

fn pairing_key(channel: &str, account_id: &str, identity: &str) -> String {
    allowlist_key(channel, account_id, identity)
}

fn parse_allowlist_key(value: &str) -> Option<(String, String, String)> {
    let mut segments = value.splitn(3, ':');
    let channel = segments.next()?.to_string();
    let account_id = segments.next()?.to_string();
    let identity = segments.next()?.to_string();
    Some((channel, account_id, identity))
}

fn generate_pairing_code(seed: u64) -> String {
    let value = (seed ^ now_ms()) & 0xFFFF_FFFF;
    format!("{value:08X}")
}

#[derive(Debug, Clone)]
struct PairingRequestRecord {
    code: String,
    expires_at_ms: u64,
    last_seen_at_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_agent_ids(raw: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in raw {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.to_string()) {
            result.push(normalized.to_string());
        }
    }
    result
}

fn resolve_publish_targets(request: &ChannelPublishRequest) -> Vec<String> {
    let targets = normalize_agent_ids(&request.target_agent_ids);
    if !targets.is_empty() {
        return targets;
    }
    match request.channel.kind {
        ChannelKind::Direct => normalize_agent_ids(&[request.channel.id.clone()]),
        ChannelKind::Group | ChannelKind::Broadcast => Vec::new(),
    }
}

fn display_channel_id(kind: &ChannelKind, id: &str, direct_target: Option<&str>) -> String {
    match kind {
        ChannelKind::Direct => {
            let target = direct_target.unwrap_or(id);
            format!("direct://{target}")
        }
        ChannelKind::Group => format!("group://{id}"),
        ChannelKind::Broadcast => format!("broadcast://{id}"),
    }
}

fn sanitize_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return "未命名任务".to_string();
    }
    trimmed.to_string()
}

fn is_digits_only(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_csi_u_enter_sequence(raw: &str) -> bool {
    if raw == "\x1b[13u" {
        return true;
    }
    raw.strip_prefix("\x1b[13;")
        .and_then(|tail| tail.strip_suffix('u'))
        .is_some_and(is_digits_only)
}

fn is_csi_tilde_enter_sequence(raw: &str) -> bool {
    if raw == "\x1b[13~" {
        return true;
    }
    raw.strip_prefix("\x1b[13;")
        .and_then(|tail| tail.strip_suffix('~'))
        .is_some_and(is_digits_only)
}

fn is_modify_other_keys_enter_sequence(raw: &str) -> bool {
    raw.strip_prefix("\x1b[27;13;")
        .and_then(|tail| tail.strip_suffix('~'))
        .is_some_and(is_digits_only)
}

fn normalize_submit_sequence(raw: &str) -> Option<String> {
    match raw {
        "\r" | "\n" | "\r\n" => Some("\r".to_string()),
        "\x1bOM" => Some(raw.to_string()),
        _ if is_csi_u_enter_sequence(raw) => Some(raw.to_string()),
        _ if is_csi_tilde_enter_sequence(raw) => Some(raw.to_string()),
        _ if is_modify_other_keys_enter_sequence(raw) => Some(raw.to_string()),
        _ => None,
    }
}

fn resolve_submit_sequence(
    request: &TaskDispatchBatchRequest,
    target_agent_id: &str,
    runtime: &AgentRuntimeRegistration,
) -> String {
    if let Some(sequence) = runtime
        .submit_sequence
        .as_deref()
        .and_then(normalize_submit_sequence)
    {
        return sequence;
    }
    request
        .submit_sequences
        .get(target_agent_id)
        .and_then(|value| normalize_submit_sequence(value))
        .unwrap_or_else(|| "\r".to_string())
}

fn build_task_dispatch_command(markdown: &str, task_id: &str, task_file_path: &str) -> String {
    let command = markdown.trim();
    if !command.is_empty() {
        return command.to_string();
    }
    let escaped = task_file_path.replace('\'', "'\\''");
    format!("echo '[vb-task] assigned {task_id} from {escaped}'")
}

fn build_managed_agent_reply_instruction(
    request: &TaskDispatchBatchRequest,
    task_id: &str,
) -> Option<String> {
    if request.sender.sender_type != DispatchSenderType::Agent {
        return None;
    }
    let sender_agent_id = request
        .sender
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(format!(
        "## GT Office MCP Reply\n\n收到后不要只在你自己的终端里打印回复。\n\n如果你要回复当前发送方，请直接使用 GT Office MCP：\n- tool: `gto_report_status`\n- workspace_id: `{workspace_id}`\n- target_agent_ids: `[\"{sender_agent_id}\"]`\n- task_id: `{task_id}`\n- status: `reply`\n- detail: 写入你真正想回复给发送方的正文\n\n如果你是在汇总完成情况、阻塞和下一步，请改用 `gto_handover`，并把同一个 `task_id` 带回去。\n",
        workspace_id = request.workspace_id,
        sender_agent_id = sender_agent_id,
        task_id = task_id,
    ))
}

fn enrich_dispatch_markdown(markdown: &str, request: &TaskDispatchBatchRequest, task_id: &str) -> String {
    let mut sections = Vec::new();
    let body = markdown.trim();
    if !body.is_empty() {
        sections.push(body.to_string());
    }
    if let Some(reply_instruction) = build_managed_agent_reply_instruction(request, task_id) {
        sections.push(reply_instruction.trim().to_string());
    }
    sections.join("\n\n")
}

fn write_task_bundle(
    workspace_root: &Path,
    task_id: &str,
    title: &str,
    request: &TaskDispatchBatchRequest,
    target_agent_id: &str,
    created_at_ms: u64,
) -> Result<(String, String), String> {
    let task_file_path = format!(".gtoffice/tasks/{task_id}/task.md");
    let manifest_path = format!(".gtoffice/tasks/{task_id}/manifest.json");
    let task_dir = workspace_root.join(".gtoffice").join("tasks").join(task_id);

    fs::create_dir_all(&task_dir)
        .map_err(|error| format!("TASK_PERSIST_FAILED: create task dir failed: {error}"))?;

    let attachment_section = if request.attachments.is_empty() {
        "- 无附件".to_string()
    } else {
        request
            .attachments
            .iter()
            .map(|attachment| {
                let reference = if attachment.category == "image" {
                    format!("![{}]({})", attachment.name, attachment.path)
                } else {
                    format!("[{}]({})", attachment.name, attachment.path)
                };
                format!("- {reference} ({})", attachment.category)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let enriched_markdown = enrich_dispatch_markdown(&request.markdown, request, task_id);
    let markdown_body = if enriched_markdown.trim().is_empty() {
        "(empty)".to_string()
    } else {
        enriched_markdown.trim().to_string()
    };

    let markdown = format!(
        "# {title}\n\n## 元信息\n\n- task_id: {task_id}\n- created_at_ms: {created_at_ms}\n- target_agent_id: {target_agent_id}\n- target_workspace_id: {}\n\n## 任务内容\n\n{markdown_body}\n\n## 附件\n\n{attachment_section}\n",
        request.workspace_id
    );

    let manifest = json!({
        "taskId": task_id,
        "title": title,
        "createdAtMs": created_at_ms,
        "target": {
            "agentId": target_agent_id,
            "workspaceId": request.workspace_id,
        },
        "attachments": request.attachments,
        "taskFilePath": task_file_path,
    });

    fs::write(task_dir.join("task.md"), markdown)
        .map_err(|error| format!("TASK_PERSIST_FAILED: write task.md failed: {error}"))?;
    fs::write(
        task_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("TASK_PERSIST_FAILED: serialize manifest failed: {error}"))?,
    )
    .map_err(|error| format!("TASK_PERSIST_FAILED: write manifest.json failed: {error}"))?;

    Ok((task_file_path, manifest_path))
}

pub fn module_name() -> &'static str {
    "vb-task"
}
