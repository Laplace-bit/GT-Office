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
    pub session_id: String,
    #[serde(default = "default_true")]
    pub online: bool,
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

            let submit_sequence = resolve_submit_sequence(request, &target_agent_id);
            let command = build_task_dispatch_command(&task_id, &task_file_path);
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
}

fn runtime_key(workspace_id: &str, agent_id: &str) -> String {
    format!("{workspace_id}:{agent_id}")
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
        "\r" | "\n" | "\r\n" | "\x1bOM" => Some(raw.to_string()),
        _ if is_csi_u_enter_sequence(raw) => Some(raw.to_string()),
        _ if is_csi_tilde_enter_sequence(raw) => Some(raw.to_string()),
        _ if is_modify_other_keys_enter_sequence(raw) => Some(raw.to_string()),
        _ => None,
    }
}

fn resolve_submit_sequence(request: &TaskDispatchBatchRequest, target_agent_id: &str) -> String {
    request
        .submit_sequences
        .get(target_agent_id)
        .and_then(|value| normalize_submit_sequence(value))
        .unwrap_or_else(|| "\r\n".to_string())
}

fn build_task_dispatch_command(task_id: &str, task_file_path: &str) -> String {
    let escaped = task_file_path.replace('\'', "'\\''");
    format!("echo '[vb-task] assigned {task_id} from {escaped}'")
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

    let markdown_body = if request.markdown.trim().is_empty() {
        "(empty)".to_string()
    } else {
        request.markdown.trim().to_string()
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

#[cfg(test)]
mod tests {
    use super::{
        AgentRuntimeRegistration, ChannelDescriptor, ChannelKind, ChannelMessageType,
        ChannelPublishRequest, DispatchSender, DispatchSenderType, TaskDispatchBatchRequest,
        TaskDispatchStatus, TaskService,
    };
    use serde_json::json;
    use std::{
        collections::HashMap,
        env, fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    static WORKSPACE_TEST_SEQ: AtomicU64 = AtomicU64::new(0);

    fn new_workspace_root() -> std::path::PathBuf {
        let seq = WORKSPACE_TEST_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
        let path = env::temp_dir().join(format!("vb-task-test-{}-{seq}", super::now_ms()));
        fs::create_dir_all(&path).expect("create temp workspace");
        path
    }

    #[test]
    fn publish_offline_target_returns_failed_ack() {
        let service = TaskService::default();
        let outcome = service.publish(&ChannelPublishRequest {
            workspace_id: "ws-1".to_string(),
            channel: ChannelDescriptor {
                kind: ChannelKind::Direct,
                id: "agent-1".to_string(),
            },
            sender_agent_id: Some("agent-0".to_string()),
            target_agent_ids: vec![],
            message_type: ChannelMessageType::Status,
            payload: json!({ "hello": "world" }),
            idempotency_key: None,
        });

        assert!(outcome.response.accepted_targets.is_empty());
        assert_eq!(outcome.response.failed_targets.len(), 1);
        assert_eq!(outcome.ack_events.len(), 1);
    }

    #[test]
    fn publish_online_target_produces_sequential_messages() {
        let service = TaskService::default();
        service.register_runtime(AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "agent-1".to_string(),
            station_id: "agent-1".to_string(),
            session_id: "ts-1".to_string(),
            online: true,
        });

        let first = service.publish(&ChannelPublishRequest {
            workspace_id: "ws-1".to_string(),
            channel: ChannelDescriptor {
                kind: ChannelKind::Direct,
                id: "agent-1".to_string(),
            },
            sender_agent_id: None,
            target_agent_ids: vec![],
            message_type: ChannelMessageType::Status,
            payload: json!({}),
            idempotency_key: None,
        });
        let second = service.publish(&ChannelPublishRequest {
            workspace_id: "ws-1".to_string(),
            channel: ChannelDescriptor {
                kind: ChannelKind::Direct,
                id: "agent-1".to_string(),
            },
            sender_agent_id: None,
            target_agent_ids: vec![],
            message_type: ChannelMessageType::Status,
            payload: json!({}),
            idempotency_key: None,
        });

        assert_eq!(
            first.message_events[0].seq + 1,
            second.message_events[0].seq
        );
    }

    #[test]
    fn dispatch_batch_writes_files_and_emits_events() {
        let service = TaskService::default();
        service.register_runtime(AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "agent-1".to_string(),
            station_id: "agent-1".to_string(),
            session_id: "ts-1".to_string(),
            online: true,
        });
        let workspace_root = new_workspace_root();

        let outcome = service.dispatch_batch(
            &TaskDispatchBatchRequest {
                workspace_id: "ws-1".to_string(),
                sender: DispatchSender {
                    sender_type: DispatchSenderType::Human,
                    agent_id: None,
                },
                targets: vec!["agent-1".to_string()],
                title: "Batch Task".to_string(),
                markdown: "- [ ] do it".to_string(),
                attachments: vec![],
                submit_sequences: HashMap::new(),
            },
            &workspace_root,
            |session_id, _command, _submit_sequence| {
                assert_eq!(session_id, "ts-1");
                Ok(())
            },
        );

        assert_eq!(outcome.response.results.len(), 1);
        assert_eq!(outcome.response.results[0].status, TaskDispatchStatus::Sent);
        assert_eq!(outcome.message_events.len(), 1);
        assert_eq!(outcome.ack_events.len(), 1);

        let task_file_path = outcome.response.results[0]
            .task_file_path
            .as_ref()
            .expect("task file path");
        let abs_path = workspace_root.join(task_file_path);
        assert!(abs_path.exists());

        let _ = fs::remove_dir_all(workspace_root);
    }

    #[test]
    fn dispatch_batch_terminal_command_appends_real_crlf_enter() {
        let service = TaskService::default();
        service.register_runtime(AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "agent-1".to_string(),
            station_id: "agent-1".to_string(),
            session_id: "ts-1".to_string(),
            online: true,
        });
        let workspace_root = new_workspace_root();
        let mut written_commands: Vec<String> = Vec::new();
        let mut written_submit_sequences: Vec<String> = Vec::new();

        let _outcome = service.dispatch_batch(
            &TaskDispatchBatchRequest {
                workspace_id: "ws-1".to_string(),
                sender: DispatchSender {
                    sender_type: DispatchSenderType::Human,
                    agent_id: None,
                },
                targets: vec!["agent-1".to_string()],
                title: "Newline".to_string(),
                markdown: "- [ ] check newline".to_string(),
                attachments: vec![],
                submit_sequences: HashMap::new(),
            },
            &workspace_root,
            |_session_id, command, submit_sequence| {
                written_commands.push(command.to_string());
                written_submit_sequences.push(submit_sequence.to_string());
                Ok(())
            },
        );

        assert_eq!(written_commands.len(), 1);
        assert_eq!(written_submit_sequences.len(), 1);
        assert!(
            !written_commands[0].ends_with('\r') && !written_commands[0].ends_with('\n'),
            "dispatch command should not contain submit control characters"
        );
        assert!(
            !written_commands[0].contains("\\r"),
            "dispatch command must not include literal backslash-r"
        );
        assert!(
            !written_commands[0].contains("\\n"),
            "dispatch command must not include literal backslash-n"
        );
        assert_eq!(written_submit_sequences[0], "\r\n");

        let _ = fs::remove_dir_all(workspace_root);
    }

    #[test]
    fn dispatch_batch_honors_target_submit_sequence_override() {
        let service = TaskService::default();
        service.register_runtime(AgentRuntimeRegistration {
            workspace_id: "ws-1".to_string(),
            agent_id: "agent-1".to_string(),
            station_id: "agent-1".to_string(),
            session_id: "ts-1".to_string(),
            online: true,
        });
        let workspace_root = new_workspace_root();
        let mut written_submit_sequences: Vec<String> = Vec::new();
        let mut submit_sequences = HashMap::new();
        submit_sequences.insert("agent-1".to_string(), "\r".to_string());

        let _outcome = service.dispatch_batch(
            &TaskDispatchBatchRequest {
                workspace_id: "ws-1".to_string(),
                sender: DispatchSender {
                    sender_type: DispatchSenderType::Human,
                    agent_id: None,
                },
                targets: vec!["agent-1".to_string()],
                title: "Submit override".to_string(),
                markdown: "- [ ] check submit override".to_string(),
                attachments: vec![],
                submit_sequences,
            },
            &workspace_root,
            |_session_id, _command, submit_sequence| {
                written_submit_sequences.push(submit_sequence.to_string());
                Ok(())
            },
        );

        assert_eq!(written_submit_sequences.len(), 1);
        assert_eq!(written_submit_sequences[0], "\r");

        let _ = fs::remove_dir_all(workspace_root);
    }
}
