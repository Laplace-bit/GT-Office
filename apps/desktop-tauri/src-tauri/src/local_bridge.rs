use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
};
use tracing::{debug, info, warn};
use gt_abstractions::{
    AbstractionError, TerminalCreateRequest, TerminalCwdMode, TerminalProvider, WorkspaceId,
    WorkspaceService,
};
use gt_agent::{AgentRepository, GLOBAL_ROLE_WORKSPACE_ID};
use gt_storage::{SqliteAgentRepository, SqliteStorage};
use gt_task::{
    AgentRuntimeRegistration, AgentToolKind, ChannelAckEvent, ChannelMessageEvent,
    ChannelPublishRequest, TaskDispatchBatchRequest, TaskDispatchProgressEvent,
    TaskGetThreadRequest, TaskListThreadsRequest,
};

use crate::app_state::AppState;
use crate::commands::agent::{
    agent_create, agent_delete, agent_list, agent_prompt_read, agent_role_delete, agent_role_list,
    agent_role_save, agent_update, AgentCreateRequest, AgentDeleteRequest, AgentPromptReadRequest,
    AgentRoleDeleteRequest, AgentRoleSaveRequest, AgentUpdateRequest,
};
use crate::commands::settings::ai_config::augment_terminal_env_for_agent;
use crate::commands::task_center::write_terminal_with_submit;

const BRIDGE_HOST: &str = "127.0.0.1";
const BRIDGE_RUNTIME_RELATIVE_PATH: &str = ".gtoffice/mcp/runtime.json";
const BRIDGE_DIRECTORY_RELATIVE_PATH: &str = ".gtoffice/mcp/directory.json";
const BRIDGE_VERSION: &str = "0.1.0";
const MCP_SIDECAR_NAME: &str = "gto-agent-mcp-sidecar";

#[derive(Debug, Clone)]
struct McpCommandSpec {
    command: String,
    args: Vec<String>,
}

#[derive(Debug, Clone)]
struct LocalBridgeRuntimeState {
    addr: SocketAddr,
    token: String,
    mcp_command: Option<McpCommandSpec>,
}

fn bridge_runtime_state() -> &'static Mutex<Option<LocalBridgeRuntimeState>> {
    static STATE: OnceLock<Mutex<Option<LocalBridgeRuntimeState>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest {
    id: String,
    token: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponse {
    id: String,
    ok: bool,
    data: Option<Value>,
    error: Option<BridgeErrorPayload>,
    trace_id: String,
}

impl BridgeResponse {
    fn success(id: String, data: Value) -> Self {
        Self {
            id,
            ok: true,
            data: Some(data),
            error: None,
            trace_id: uuid::Uuid::new_v4().to_string(),
        }
    }

    fn failure(id: String, error: BridgeErrorPayload) -> Self {
        Self {
            id,
            ok: false,
            data: None,
            error: Some(error),
            trace_id: uuid::Uuid::new_v4().to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs};
    use uuid::Uuid;
    use gt_agent::{AgentProfile, AgentRole, AgentRoleScope, AgentState, RoleStatus};
    use gt_task::{DispatchSender, DispatchSenderType};

    #[test]
    fn bridge_response_serializes_stable_success_envelope() {
        let response = BridgeResponse::success("req-1".to_string(), json!({ "value": 1 }));
        let value = serde_json::to_value(response).expect("bridge response should serialize");

        assert_eq!(value["ok"], json!(true));
        assert_eq!(value["data"], json!({ "value": 1 }));
        assert_eq!(value["error"], Value::Null);
        assert!(value["traceId"]
            .as_str()
            .is_some_and(|trace_id| !trace_id.is_empty()));
    }

    #[test]
    fn bridge_response_serializes_stable_failure_envelope() {
        let response = BridgeResponse::failure(
            "req-1".to_string(),
            BridgeError::new("LOCAL_BRIDGE_AUTH_FAILED", "invalid bridge token").payload(),
        );
        let value = serde_json::to_value(response).expect("bridge response should serialize");

        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["data"], Value::Null);
        assert_eq!(value["error"]["code"], json!("LOCAL_BRIDGE_AUTH_FAILED"));
        assert_eq!(value["error"]["message"], json!("invalid bridge token"));
        assert!(value["traceId"]
            .as_str()
            .is_some_and(|trace_id| !trace_id.is_empty()));
    }

    #[test]
    fn resolve_bootstrap_role_key_prefers_agent_role_mapping() {
        let agents = vec![AgentProfile {
            id: "agent_alpha".to_string(),
            workspace_id: "ws-1".to_string(),
            name: "Alpha".to_string(),
            role_id: "role_product".to_string(),
            tool: "claude".to_string(),
            workdir: Some(".gtoffice/alpha".to_string()),
            custom_workdir: false,
            state: AgentState::Ready,
            employee_no: None,
            policy_snapshot_id: None,
            prompt_file_name: Some("CLAUDE.md".to_string()),
            prompt_file_relative_path: Some(".gtoffice/alpha/CLAUDE.md".to_string()),
            created_at_ms: 1,
            updated_at_ms: 1,
        }];
        let roles = vec![AgentRole {
            id: "role_analyst".to_string(),
            workspace_id: "ws-1".to_string(),
            role_key: "analyst".to_string(),
            role_name: "Analyst".to_string(),
            department_id: "dept_analysis".to_string(),
            scope: AgentRoleScope::Workspace,
            charter_path: None,
            policy_json: Some("{}".to_string()),
            version: 1,
            status: RoleStatus::Active,
            is_system: false,
            created_at_ms: 1,
            updated_at_ms: 1,
        }];

        assert_eq!(
            resolve_bootstrap_role_key("agent_alpha", &agents, &roles),
            Some("product".to_string())
        );
    }

    #[test]
    fn resolve_bootstrap_role_key_falls_back_to_matching_role_key() {
        let roles = vec![AgentRole {
            id: "role_generator".to_string(),
            workspace_id: "ws-1".to_string(),
            role_key: "generator".to_string(),
            role_name: "Generator".to_string(),
            department_id: "dept_generation".to_string(),
            scope: AgentRoleScope::Global,
            charter_path: None,
            policy_json: Some("{}".to_string()),
            version: 1,
            status: RoleStatus::Active,
            is_system: true,
            created_at_ms: 1,
            updated_at_ms: 1,
        }];

        assert_eq!(
            resolve_bootstrap_role_key("build", &[], &roles),
            Some("build".to_string())
        );
    }

    #[test]
    fn build_agent_terminal_env_includes_role_key_when_present() {
        let env = build_agent_terminal_env("ws-1", "agent_alpha", Some("product"), "station-1");

        assert_eq!(
            env.get("GTO_WORKSPACE_ID").map(String::as_str),
            Some("ws-1")
        );
        assert_eq!(
            env.get("GTO_AGENT_ID").map(String::as_str),
            Some("agent_alpha")
        );
        assert_eq!(env.get("GTO_ROLE_KEY").map(String::as_str), Some("product"));
        assert_eq!(
            env.get("GTO_STATION_ID").map(String::as_str),
            Some("station-1")
        );
    }

    #[test]
    fn require_bootstrap_role_key_rejects_missing_role_key() {
        let error = require_bootstrap_role_key("agent_unknown", None)
            .expect_err("missing role key should fail");

        assert_eq!(error.code, "LOCAL_BRIDGE_INVALID_PARAMS");
        assert_eq!(
            error.message,
            "bootstrap roleKey is required for target: agent_unknown"
        );
    }

    #[test]
    fn map_command_error_preserves_machine_readable_code() {
        let error = map_command_error("AGENT_NOT_FOUND: missing agent".to_string());
        let payload = error.payload();

        assert_eq!(payload.code, "AGENT_NOT_FOUND");
        assert_eq!(payload.message, "missing agent");
        assert_eq!(payload.details, None);
    }

    fn temp_workspace_root(label: &str) -> std::path::PathBuf {
        let root = env::temp_dir().join(format!("gto-mcp-bridge-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp workspace");
        root
    }

    #[test]
    fn list_task_threads_returns_task_summaries_from_task_service() {
        let state = AppState::default();
        state
            .task_service
            .register_runtime(AgentRuntimeRegistration {
                workspace_id: "ws-1".to_string(),
                agent_id: "manager".to_string(),
                station_id: "manager".to_string(),
                role_key: None,
                session_id: "ts-manager".to_string(),
                tool_kind: AgentToolKind::default(),
                resolved_cwd: None,
                submit_sequence: None,
                provider_session: None,
                online: true,
            });
        state
            .task_service
            .register_runtime(AgentRuntimeRegistration {
                workspace_id: "ws-1".to_string(),
                agent_id: "worker".to_string(),
                station_id: "worker".to_string(),
                role_key: None,
                session_id: "ts-worker".to_string(),
                tool_kind: AgentToolKind::default(),
                resolved_cwd: None,
                submit_sequence: None,
                provider_session: None,
                online: true,
            });

        let workspace_root = temp_workspace_root("threads");
        let outcome = state.task_service.dispatch_batch(
            &TaskDispatchBatchRequest {
                workspace_id: "ws-1".to_string(),
                sender: DispatchSender {
                    sender_type: DispatchSenderType::Agent,
                    agent_id: Some("manager".to_string()),
                },
                targets: vec!["worker".to_string()],
                title: "Review migration".to_string(),
                markdown: "Please review the migration.".to_string(),
                attachments: vec![],
                submit_sequences: BTreeMap::new().into_iter().collect(),
            },
            &workspace_root,
            |_, _, _| Ok(()),
        );

        let value = list_task_threads(
            &state,
            json!({
                "workspaceId": "ws-1",
                "agentId": "worker",
                "limit": 20
            }),
        )
        .expect("task threads should serialize");

        assert_eq!(
            value["threads"][0]["taskId"],
            json!(outcome.response.results[0].task_id)
        );
        assert_eq!(value["threads"][0]["title"], json!("Review migration"));
        assert_eq!(value["threads"][0]["state"], json!("open"));

        let _ = fs::remove_dir_all(workspace_root);
    }

    #[test]
    fn get_task_thread_returns_full_thread_payload() {
        let state = AppState::default();
        state
            .task_service
            .register_runtime(AgentRuntimeRegistration {
                workspace_id: "ws-1".to_string(),
                agent_id: "manager".to_string(),
                station_id: "manager".to_string(),
                role_key: None,
                session_id: "ts-manager".to_string(),
                tool_kind: AgentToolKind::default(),
                resolved_cwd: None,
                submit_sequence: None,
                provider_session: None,
                online: true,
            });
        state
            .task_service
            .register_runtime(AgentRuntimeRegistration {
                workspace_id: "ws-1".to_string(),
                agent_id: "worker".to_string(),
                station_id: "worker".to_string(),
                role_key: None,
                session_id: "ts-worker".to_string(),
                tool_kind: AgentToolKind::default(),
                resolved_cwd: None,
                submit_sequence: None,
                provider_session: None,
                online: true,
            });

        let workspace_root = temp_workspace_root("thread-detail");
        let outcome = state.task_service.dispatch_batch(
            &TaskDispatchBatchRequest {
                workspace_id: "ws-1".to_string(),
                sender: DispatchSender {
                    sender_type: DispatchSenderType::Agent,
                    agent_id: Some("manager".to_string()),
                },
                targets: vec!["worker".to_string()],
                title: "Need handover".to_string(),
                markdown: "Prepare a handover.".to_string(),
                attachments: vec![],
                submit_sequences: BTreeMap::new().into_iter().collect(),
            },
            &workspace_root,
            |_, _, _| Ok(()),
        );
        let task_id = outcome.response.results[0].task_id.clone();
        let _ = state.task_service.publish(&ChannelPublishRequest {
            workspace_id: "ws-1".to_string(),
            channel: gt_task::ChannelDescriptor {
                kind: gt_task::ChannelKind::Direct,
                id: "manager".to_string(),
            },
            sender_agent_id: Some("worker".to_string()),
            target_agent_ids: vec!["manager".to_string()],
            message_type: gt_task::ChannelMessageType::Status,
            payload: json!({
                "taskId": task_id,
                "detail": "handover in progress"
            }),
            idempotency_key: None,
        });

        let value = get_task_thread(
            &state,
            json!({
                "workspaceId": "ws-1",
                "taskId": task_id
            }),
        )
        .expect("thread should serialize");

        assert_eq!(value["thread"]["summary"]["state"], json!("replied"));
        assert_eq!(
            value["thread"]["messages"]
                .as_array()
                .map(|items| items.len()),
            Some(2)
        );

        let _ = fs::remove_dir_all(workspace_root);
    }

    #[test]
    fn map_command_error_falls_back_to_bridge_internal_for_unstructured_errors() {
        let error = map_command_error("database unavailable".to_string());
        let payload = error.payload();

        assert_eq!(payload.code, "LOCAL_BRIDGE_INTERNAL");
        assert_eq!(payload.message, "database unavailable");
        assert_eq!(payload.details, None);
    }

    #[test]
    fn seed_agent_defaults_makes_global_roles_visible_for_workspace_listing() {
        let db_path = std::env::temp_dir().join(format!(
            "mcp-bridge-seed-agent-defaults-{}.db",
            uuid::Uuid::new_v4()
        ));
        let storage = SqliteStorage::new(&db_path).expect("create sqlite storage");
        let repo = SqliteAgentRepository::new(storage);
        repo.ensure_schema().expect("ensure schema");

        let before = repo.list_roles("ws_alpha").expect("list roles before seed");
        assert!(
            !before.iter().any(|role| role.role_key == "build"),
            "fresh database should not expose built-in global roles before seeding"
        );

        seed_agent_defaults(&repo, "ws_alpha").expect("seed defaults");

        let after = repo.list_roles("ws_alpha").expect("list roles after seed");
        assert!(
            after.iter().any(|role| {
                role.workspace_id == GLOBAL_ROLE_WORKSPACE_ID && role.role_key == "build"
            }),
            "workspace role listing should include seeded global built-in roles"
        );
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeErrorPayload {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

#[derive(Debug, Clone)]
struct BridgeError {
    code: &'static str,
    message: String,
    details: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevBootstrapAgentsRequest {
    workspace_path: String,
    targets: Vec<String>,
    #[serde(default)]
    shell: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    cwd_mode: Option<String>,
    #[serde(default)]
    tool_kind: AgentToolKind,
    #[serde(default)]
    submit_sequence: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryGetRequest {
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelListMessagesRequest {
    workspace_id: String,
    #[serde(default)]
    target_agent_id: Option<String>,
    #[serde(default)]
    sender_agent_id: Option<String>,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    limit: Option<u32>,
}

impl BridgeError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    fn with_code(code: String, message: impl Into<String>) -> Self {
        Self {
            code: "LOCAL_BRIDGE_INTERNAL",
            message: message.into(),
            details: Some(json!({ "bridgeErrorCode": code })),
        }
    }

    fn payload(&self) -> BridgeErrorPayload {
        let code = self
            .details
            .as_ref()
            .and_then(|details| details.get("bridgeErrorCode"))
            .and_then(Value::as_str)
            .unwrap_or(self.code)
            .to_string();
        BridgeErrorPayload {
            code,
            message: self.message.clone(),
            details: self.details.clone().and_then(|details| {
                match details.get("bridgeErrorCode") {
                    Some(_) if details.as_object().is_some_and(|object| object.len() == 1) => None,
                    _ => Some(details),
                }
            }),
        }
    }
}

fn parse_command_error(error: &str) -> Option<(String, String)> {
    let trimmed = error.trim();
    let (code, message) = trimmed.split_once(':')?;
    let code = code.trim();
    let message = message.trim();
    if code.is_empty() || message.is_empty() {
        return None;
    }
    if !code
        .chars()
        .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
    {
        return None;
    }
    Some((code.to_string(), message.to_string()))
}

fn map_command_error(error: String) -> BridgeError {
    match parse_command_error(&error) {
        Some((code, message)) => BridgeError::with_code(code, message),
        None => BridgeError::new("LOCAL_BRIDGE_INTERNAL", error),
    }
}

fn seed_agent_defaults(
    repo: &SqliteAgentRepository,
    workspace_id: &str,
) -> Result<(), BridgeError> {
    repo.seed_defaults(GLOBAL_ROLE_WORKSPACE_ID)
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_INTERNAL", error.to_string()))?;
    repo.seed_defaults(workspace_id)
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_INTERNAL", error.to_string()))
}

pub fn spawn(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_bridge(app.clone(), state).await {
            warn!(error = %error, "failed to boot mcp bridge");
        }
    });
}

async fn run_bridge(app: AppHandle, state: AppState) -> Result<(), String> {
    let listener = TcpListener::bind((BRIDGE_HOST, 0))
        .await
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: bind failed: {error}"))?;
    let addr = listener
        .local_addr()
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: local_addr failed: {error}"))?;
    let token = uuid::Uuid::new_v4().to_string();
    let mcp_command = resolve_mcp_command(&app);
    if let Ok(mut runtime_state) = bridge_runtime_state().lock() {
        *runtime_state = Some(LocalBridgeRuntimeState {
            addr,
            token: token.clone(),
            mcp_command: mcp_command.clone(),
        });
    }

    write_runtime_file(&addr, &token, mcp_command.as_ref())
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: write runtime failed: {error}"))?;
    info!(addr = %addr, "mcp bridge listening");

    loop {
        let (stream, remote) = listener
            .accept()
            .await
            .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: accept failed: {error}"))?;

        if !remote.ip().is_loopback() {
            warn!(remote = %remote, "rejected non-loopback mcp bridge client");
            continue;
        }

        let app_handle = app.clone();
        let app_state = state.clone();
        let token_clone = token.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_client(stream, &app_handle, &app_state, &token_clone).await {
                debug!(error = %error, "mcp bridge client disconnected with error");
            }
        });
    }
}

async fn handle_client(
    stream: TcpStream,
    app: &AppHandle,
    state: &AppState,
    expected_token: &str,
) -> Result<(), String> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: read failed: {error}"))?
    {
        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<BridgeRequest>(&line) {
            Ok(request) => request,
            Err(error) => {
                let response = BridgeResponse::failure(
                    "unknown".to_string(),
                    BridgeError::new(
                        "LOCAL_BRIDGE_INVALID_REQUEST",
                        format!("invalid request json: {error}"),
                    )
                    .payload(),
                );
                write_response(&mut writer, &response).await?;
                continue;
            }
        };

        let response = if request.token != expected_token {
            BridgeResponse::failure(
                request.id,
                BridgeError::new("LOCAL_BRIDGE_AUTH_FAILED", "invalid bridge token").payload(),
            )
        } else {
            match handle_request(app, state, &request).await {
                Ok(data) => BridgeResponse::success(request.id, data),
                Err(error) => BridgeResponse::failure(request.id, error.payload()),
            }
        };

        write_response(&mut writer, &response).await?;
    }

    Ok(())
}

async fn write_response(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    response: &BridgeResponse,
) -> Result<(), String> {
    let mut payload = serde_json::to_vec(response)
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: encode failed: {error}"))?;
    payload.push(b'\n');
    writer
        .write_all(&payload)
        .await
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: write failed: {error}"))
}

async fn handle_request(
    app: &AppHandle,
    state: &AppState,
    request: &BridgeRequest,
) -> Result<Value, BridgeError> {
    match request.method.as_str() {
        "health" => Ok(json!({
            "bridgeVersion": BRIDGE_VERSION,
            "transport": "tcp-ndjson",
            "pid": std::process::id(),
            "directorySnapshotCount": count_directory_snapshots(state),
        })),
        "directory.get" => directory_get(app, state, request.params.clone()),
        "agent.role_list" => bridge_agent_role_list(app, state, request.params.clone()),
        "agent.role_save" => bridge_agent_role_save(app, state, request.params.clone()),
        "agent.role_delete" => bridge_agent_role_delete(app, state, request.params.clone()),
        "agent.list" => bridge_agent_list(app, state, request.params.clone()),
        "agent.create" => bridge_agent_create(app, state, request.params.clone()),
        "agent.update" => bridge_agent_update(app, state, request.params.clone()),
        "agent.delete" => bridge_agent_delete(app, state, request.params.clone()),
        "agent.prompt_read" => bridge_agent_prompt_read(app, state, request.params.clone()),
        "dev.bootstrap_agents" => dev_bootstrap_agents(app, state, request.params.clone()),
        "task.dispatch_batch" => dispatch_batch(app, state, request.params.clone()),
        "task.list_threads" => list_task_threads(state, request.params.clone()),
        "task.get_thread" => get_task_thread(state, request.params.clone()),
        "channel.publish" => publish_channel(app, state, request.params.clone()),
        "channel.list_messages" => list_channel_messages(state, request.params.clone()),
        method => Err(BridgeError::new(
            "LOCAL_BRIDGE_METHOD_UNSUPPORTED",
            format!("unsupported method: {method}"),
        )),
    }
}

fn bridge_agent_role_list(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct WorkspaceRequest {
        workspace_id: String,
    }

    let request: WorkspaceRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.role_list params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_role_list(request.workspace_id, state_guard, app.clone()).map_err(map_command_error)
}

fn bridge_agent_role_save(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    let request: AgentRoleSaveRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.role_save params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_role_save(request, state_guard, app.clone()).map_err(map_command_error)
}

fn bridge_agent_role_delete(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    let request: AgentRoleDeleteRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.role_delete params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_role_delete(request, state_guard, app.clone()).map_err(map_command_error)
}

fn bridge_agent_list(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct WorkspaceRequest {
        workspace_id: String,
    }

    let request: WorkspaceRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.list params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_list(request.workspace_id, state_guard, app.clone()).map_err(map_command_error)
}

fn bridge_agent_create(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    let request: AgentCreateRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.create params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_create(request, state_guard, app.clone()).map_err(map_command_error)
}

fn bridge_agent_update(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    let request: AgentUpdateRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.update params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_update(request, state_guard, app.clone()).map_err(map_command_error)
}

fn bridge_agent_delete(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    let request: AgentDeleteRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.delete params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_delete(request, state_guard, app.clone()).map_err(map_command_error)
}

fn bridge_agent_prompt_read(
    app: &AppHandle,
    _state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    let request: AgentPromptReadRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("agent.prompt_read params invalid: {error}"),
        )
    })?;

    let state_guard = app.state::<AppState>();
    agent_prompt_read(request, state_guard, app.clone()).map_err(map_command_error)
}

fn count_directory_snapshots(state: &AppState) -> usize {
    let workspaces = state.workspace_service.list().unwrap_or_default();
    workspaces
        .iter()
        .filter(|workspace| {
            state
                .mcp_directory_snapshot(workspace.workspace_id.as_str())
                .ok()
                .flatten()
                .is_some()
        })
        .count()
}

fn directory_get(app: &AppHandle, state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: DirectoryGetRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("directory.get params invalid: {error}"),
        )
    })?;

    let workspace_id = request.workspace_id.trim();
    if workspace_id.is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }

    if let Ok(Some(snapshot)) = state.mcp_directory_snapshot(workspace_id) {
        return Ok(snapshot);
    }

    refresh_directory_snapshot(app, state, workspace_id).map_err(map_command_error)
}

pub fn refresh_directory_snapshot(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> Result<Value, String> {
    let snapshot = build_directory_snapshot(app, state, workspace_id)?;
    state.set_mcp_directory_snapshot(workspace_id, snapshot.clone())?;
    write_directory_snapshot_file(workspace_id, &snapshot)?;
    Ok(snapshot)
}

pub fn spawn_refresh_directory_snapshot(app: AppHandle, state: AppState, workspace_id: String) {
    let _ = state.clear_mcp_directory_snapshot(&workspace_id);
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = refresh_directory_snapshot(&app, &state, &workspace_id) {
            tracing::warn!(
                workspace_id = %workspace_id,
                error = %error,
                "background refresh directory snapshot failed"
            );
        }
    });
}

fn build_directory_snapshot(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("workspaceId is required".to_string());
    }

    let _ = state
        .workspace_service
        .get_context(&WorkspaceId::new(workspace_id))
        .map_err(|error| error.to_string())?;

    let repo = resolve_agent_repository(app)?;
    repo.ensure_schema().map_err(|error| error.to_string())?;
    seed_agent_defaults(&repo, workspace_id).map_err(|error| error.message)?;

    let departments = repo
        .list_departments(workspace_id)
        .map_err(|error| error.to_string())?;
    let roles = repo
        .list_roles(workspace_id)
        .map_err(|error| error.to_string())?;
    let agents = repo
        .list_agents(workspace_id)
        .map_err(|error| error.to_string())?;
    let runtimes = state.task_service.list_runtimes(Some(workspace_id));

    let updated_at_ms = chrono_like_now_ms();
    let mut agent_entries = agents
        .into_iter()
        .map(|agent| {
            let runtime = runtimes.iter().find(|runtime| runtime.agent_id == agent.id);
            let role = roles.iter().find(|role| role.id == agent.role_id);
            json!({
                "agentId": agent.id,
                "name": agent.name,
                "roleId": agent.role_id,
                "roleKey": runtime
                    .and_then(|item| item.role_key.clone())
                    .or_else(|| role.map(|role| role.role_key.clone())),
                "departmentId": role.map(|role| role.department_id.clone()),
                "state": agent.state,
                "online": runtime.is_some_and(|item| item.online),
                "sessionId": runtime.map(|item| item.session_id.clone()),
                "toolKind": runtime.map(|item| item.tool_kind),
                "resolvedCwd": runtime.and_then(|item| item.resolved_cwd.clone()),
            })
        })
        .collect::<Vec<_>>();

    for runtime in &runtimes {
        if agent_entries.iter().any(|agent| {
            agent
                .get("agentId")
                .and_then(Value::as_str)
                .is_some_and(|agent_id| agent_id == runtime.agent_id)
        }) {
            continue;
        }

        let role = runtime
            .role_key
            .as_ref()
            .and_then(|role_key| roles.iter().find(|role| role.role_key == *role_key));
        agent_entries.push(json!({
            "agentId": runtime.agent_id,
            "name": runtime.agent_id,
            "roleId": role.map(|item| item.id.clone()),
            "roleKey": runtime.role_key,
            "departmentId": role.map(|item| item.department_id.clone()),
            "state": "ready",
            "online": runtime.online,
            "sessionId": runtime.session_id,
            "toolKind": runtime.tool_kind,
            "resolvedCwd": runtime.resolved_cwd,
        }));
    }

    Ok(json!({
        "workspaceId": workspace_id,
        "directoryVersion": updated_at_ms.to_string(),
        "updatedAtMs": updated_at_ms,
        "departments": departments,
        "roles": roles,
        "agents": agent_entries,
        "runtimes": runtimes,
    }))
}

fn dispatch_batch(app: &AppHandle, state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: TaskDispatchBatchRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("task.dispatch_batch params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }
    if request.targets.is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "targets must not be empty",
        ));
    }
    if request.markdown.trim().is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "markdown must not be empty",
        ));
    }

    let workspace_root = state
        .workspace_root_path(&request.workspace_id)
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_WORKSPACE_INVALID", error))?;

    let outcome = state.task_service.dispatch_batch(
        &request,
        &workspace_root,
        |session_id, command, submit_sequence| {
            write_terminal_with_submit(state, session_id, command, submit_sequence)
        },
    );

    emit_dispatch_progress_events(app, &outcome.progress_events);
    emit_channel_events(app, &outcome.message_events, &outcome.ack_events);

    serde_json::to_value(outcome.response)
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_INTERNAL", error.to_string()))
}

fn publish_channel(app: &AppHandle, state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: ChannelPublishRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("channel.publish params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }

    let outcome = state.task_service.publish(&request);
    emit_channel_events(app, &outcome.message_events, &outcome.ack_events);
    serde_json::to_value(outcome.response)
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_INTERNAL", error.to_string()))
}

fn list_task_threads(state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: TaskListThreadsRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("task.list_threads params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }

    let threads = state.task_service.list_task_threads(
        &request.workspace_id,
        request.agent_id.as_deref(),
        request.limit.unwrap_or(20) as usize,
    );
    Ok(json!({ "threads": threads }))
}

fn get_task_thread(state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: TaskGetThreadRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("task.get_thread params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }
    if request.task_id.trim().is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "taskId is required",
        ));
    }

    let thread = state
        .task_service
        .get_task_thread(&request.workspace_id, &request.task_id);
    Ok(json!({ "thread": thread }))
}

fn list_channel_messages(state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: ChannelListMessagesRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("channel.list_messages params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }

    let messages = state.task_service.list_messages(
        &request.workspace_id,
        request.target_agent_id.as_deref(),
        request.sender_agent_id.as_deref(),
        request.task_id.as_deref(),
        request.limit.unwrap_or(20) as usize,
    );
    Ok(json!({ "messages": messages }))
}

fn dev_bootstrap_agents(
    app: &AppHandle,
    state: &AppState,
    params: Value,
) -> Result<Value, BridgeError> {
    let request: DevBootstrapAgentsRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("dev.bootstrap_agents params invalid: {error}"),
        )
    })?;

    let workspace_path = request.workspace_path.trim();
    if workspace_path.is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "workspacePath is required",
        ));
    }

    let targets = normalize_target_ids(&request.targets);
    if targets.is_empty() {
        return Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            "targets must contain at least one agent id",
        ));
    }

    let workspace = state
        .workspace_service
        .open(Path::new(workspace_path))
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_WORKSPACE_INVALID", error.to_string()))?;

    let repo = resolve_agent_repository(app).map_err(map_command_error)?;
    repo.ensure_schema()
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_INTERNAL", error.to_string()))?;
    seed_agent_defaults(&repo, workspace.workspace_id.as_str())?;
    let roles = repo
        .list_roles(workspace.workspace_id.as_str())
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_INTERNAL", error.to_string()))?;
    let agents = repo
        .list_agents(workspace.workspace_id.as_str())
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_INTERNAL", error.to_string()))?;

    let cwd_mode = parse_bootstrap_cwd_mode(request.cwd_mode.as_deref())?;
    let shell_name = request
        .shell
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "auto".to_string());
    let tool_kind = if request.tool_kind == AgentToolKind::Unknown {
        AgentToolKind::Shell
    } else {
        request.tool_kind
    };
    let submit_sequence = request.submit_sequence.unwrap_or_else(|| "\r".to_string());

    let mut bootstrapped_agents = Vec::with_capacity(targets.len());
    for agent_id in targets {
        let role_key = require_bootstrap_role_key(
            &agent_id,
            resolve_bootstrap_role_key(&agent_id, &agents, &roles),
        )?;
        let terminal_env = build_agent_terminal_env(
            workspace.workspace_id.as_str(),
            &agent_id,
            Some(role_key.as_str()),
            &agent_id,
        );
        let terminal_env = augment_terminal_env_for_agent(
            app,
            state,
            workspace.workspace_id.as_str(),
            tool_kind,
            true,
            terminal_env,
        )
        .map_err(|error| BridgeError::new("LOCAL_BRIDGE_TERMINAL_INVALID", error))?;
        let session = state
            .terminal_provider
            .create_session(TerminalCreateRequest {
                workspace_id: WorkspaceId::new(workspace.workspace_id.to_string()),
                shell: Some(shell_name.clone()),
                cwd: request.cwd.clone(),
                cwd_mode: cwd_mode.clone(),
                env: terminal_env,
                agent_tool_kind: Some(format!("{tool_kind:?}").to_ascii_lowercase()),
            })
            .map_err(|error| {
                BridgeError::new(
                    "LOCAL_BRIDGE_TERMINAL_INVALID",
                    format!(
                        "bootstrap terminal create failed for '{agent_id}': {}",
                        to_terminal_error(error)
                    ),
                )
            })?;

        state
            .task_service
            .register_runtime(AgentRuntimeRegistration {
                workspace_id: workspace.workspace_id.to_string(),
                agent_id: agent_id.clone(),
                station_id: agent_id.clone(),
                role_key: Some(role_key.clone()),
                session_id: session.session_id.clone(),
                tool_kind,
                resolved_cwd: Some(session.resolved_cwd.clone()),
                submit_sequence: Some(submit_sequence.clone()),
                provider_session: None,
                online: true,
            });

        bootstrapped_agents.push(json!({
            "agentId": agent_id,
            "stationId": agent_id,
            "roleKey": role_key,
            "sessionId": session.session_id,
            "toolKind": tool_kind,
            "resolvedCwd": session.resolved_cwd,
            "submitSequence": submit_sequence.clone(),
            "providerSession": serde_json::Value::Null,
        }));
    }

    Ok(json!({
        "workspaceId": workspace.workspace_id,
        "name": workspace.name,
        "root": workspace.root,
        "shell": shell_name,
        "cwdMode": bootstrap_cwd_mode_label(&cwd_mode),
        "agents": bootstrapped_agents,
    }))
}

fn resolve_bootstrap_role_key(
    agent_id: &str,
    agents: &[gt_agent::AgentProfile],
    roles: &[gt_agent::AgentRole],
) -> Option<String> {
    agents
        .iter()
        .find(|agent| agent.id == agent_id)
        .and_then(|agent| roles.iter().find(|role| role.id == agent.role_id))
        .map(|role| role.role_key.clone())
        .or_else(|| {
            roles
                .iter()
                .find(|role| role.role_key == agent_id)
                .map(|role| role.role_key.clone())
        })
}

fn require_bootstrap_role_key(
    agent_id: &str,
    role_key: Option<String>,
) -> Result<String, BridgeError> {
    role_key.ok_or_else(|| {
        BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("bootstrap roleKey is required for target: {agent_id}"),
        )
    })
}

fn build_agent_terminal_env(
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

fn normalize_target_ids(values: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        let candidate = value.trim();
        if candidate.is_empty() {
            continue;
        }
        if normalized.iter().any(|existing| existing == candidate) {
            continue;
        }
        normalized.push(candidate.to_string());
    }
    normalized
}

fn parse_bootstrap_cwd_mode(raw: Option<&str>) -> Result<TerminalCwdMode, BridgeError> {
    match raw.unwrap_or("workspace_root") {
        "workspace_root" => Ok(TerminalCwdMode::WorkspaceRoot),
        "custom" => Ok(TerminalCwdMode::Custom),
        invalid => Err(BridgeError::new(
            "LOCAL_BRIDGE_INVALID_PARAMS",
            format!("unsupported cwdMode: {invalid}"),
        )),
    }
}

fn bootstrap_cwd_mode_label(mode: &TerminalCwdMode) -> &'static str {
    match mode {
        TerminalCwdMode::WorkspaceRoot => "workspace_root",
        TerminalCwdMode::Custom => "custom",
    }
}

fn emit_channel_events(
    app: &AppHandle,
    message_events: &[ChannelMessageEvent],
    ack_events: &[ChannelAckEvent],
) {
    for event in message_events {
        let _ = app.emit("channel/message", event);
    }
    for event in ack_events {
        let _ = app.emit("channel/ack", event);
    }
}

fn emit_dispatch_progress_events(app: &AppHandle, events: &[TaskDispatchProgressEvent]) {
    for event in events {
        let _ = app.emit("task/dispatch_progress", event);
    }
}

fn resolve_agent_repository(app: &AppHandle) -> Result<SqliteAgentRepository, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("AGENT_STORAGE_PATH_FAILED: {error}"))?;
    fs::create_dir_all(&base_dir).map_err(|error| format!("AGENT_STORAGE_PATH_FAILED: {error}"))?;
    let db_path = base_dir.join("gtoffice.db");
    let storage = SqliteStorage::new(db_path).map_err(|error| error.to_string())?;
    Ok(SqliteAgentRepository::new(storage))
}

fn runtime_file_path() -> PathBuf {
    if let Some(home) = user_home_dir() {
        return home.join(BRIDGE_RUNTIME_RELATIVE_PATH);
    }
    env::temp_dir().join("gtoffice/mcp/runtime.json")
}

pub fn directory_snapshot_file_path() -> PathBuf {
    if let Some(home) = user_home_dir() {
        return home.join(BRIDGE_DIRECTORY_RELATIVE_PATH);
    }
    env::temp_dir().join("gtoffice/mcp/directory.json")
}

fn user_home_dir() -> Option<PathBuf> {
    if let Some(value) = env::var_os("HOME") {
        return Some(PathBuf::from(value));
    }
    env::var_os("USERPROFILE").map(PathBuf::from)
}

fn write_directory_snapshot_file(workspace_id: &str, snapshot: &Value) -> Result<(), String> {
    let directory_path = directory_snapshot_file_path();
    let parent = directory_path.parent().ok_or_else(|| {
        "LOCAL_BRIDGE_UNAVAILABLE: directory path does not have parent directory".to_string()
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: create dir failed: {error}"))?;

    let mut workspaces = fs::read_to_string(&directory_path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|value| value.get("workspaces").cloned())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    workspaces.insert(workspace_id.to_string(), snapshot.clone());

    let bridge = bridge_runtime_state()
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .map(|runtime| {
            json!({
                "version": BRIDGE_VERSION,
                "transport": "tcp-ndjson",
                "host": runtime.addr.ip().to_string(),
                "port": runtime.addr.port(),
                "token": runtime.token,
                "mcpCommand": runtime.mcp_command.as_ref().map(|command| {
                    json!({
                        "command": command.command,
                        "args": command.args,
                    })
                }),
                "updatedAtMs": chrono_like_now_ms(),
            })
        })
        .unwrap_or(Value::Null);

    let payload = json!({
        "version": BRIDGE_VERSION,
        "updatedAtMs": chrono_like_now_ms(),
        "bridge": bridge,
        "workspaces": workspaces,
    });

    fs::write(
        &directory_path,
        serde_json::to_vec_pretty(&payload).map_err(|error| {
            format!("LOCAL_BRIDGE_UNAVAILABLE: serialize directory failed: {error}")
        })?,
    )
    .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: write directory failed: {error}"))?;
    if let Some(runtime) = bridge_runtime_state()
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
    {
        write_runtime_file(&runtime.addr, &runtime.token, runtime.mcp_command.as_ref())?;
    }
    Ok(())
}

fn write_runtime_file(
    addr: &SocketAddr,
    token: &str,
    mcp_command: Option<&McpCommandSpec>,
) -> Result<(), String> {
    let runtime_path = runtime_file_path();
    let parent = runtime_path.parent().ok_or_else(|| {
        "LOCAL_BRIDGE_UNAVAILABLE: runtime path does not have parent directory".to_string()
    })?;

    fs::create_dir_all(parent)
        .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: create dir failed: {error}"))?;
    let payload = json!({
        "version": BRIDGE_VERSION,
        "transport": "tcp-ndjson",
        "host": addr.ip().to_string(),
        "port": addr.port(),
        "token": token,
        "mcpCommand": mcp_command.map(|command| {
            json!({
                "command": command.command,
                "args": command.args,
            })
        }),
        "updatedAtMs": chrono_like_now_ms(),
    });

    fs::write(
        &runtime_path,
        serde_json::to_vec_pretty(&payload).map_err(|error| {
            format!("LOCAL_BRIDGE_UNAVAILABLE: serialize runtime failed: {error}")
        })?,
    )
    .map_err(|error| format!("LOCAL_BRIDGE_UNAVAILABLE: write runtime failed: {error}"))?;
    Ok(())
}

fn chrono_like_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn resolve_mcp_command(app: &AppHandle) -> Option<McpCommandSpec> {
    if let Ok(command) = env::var("GTO_MCP_COMMAND") {
        let trimmed = command.trim();
        if !trimmed.is_empty() {
            return Some(McpCommandSpec {
                command: trimmed.to_string(),
                args: vec!["serve".to_string()],
            });
        }
    }

    let mut candidate_dirs = Vec::new();
    if let Ok(path) = app.path().resource_dir() {
        candidate_dirs.push(path);
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidate_dirs.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = env::current_dir() {
        candidate_dirs.push(cwd.join("apps/desktop-tauri/src-tauri/binaries"));
    }

    for dir in candidate_dirs {
        if let Some(candidate) = find_sidecar_binary(&dir) {
            return Some(McpCommandSpec {
                command: candidate.to_string_lossy().to_string(),
                args: vec!["serve".to_string()],
            });
        }
    }

    None
}

fn find_sidecar_binary(dir: &Path) -> Option<PathBuf> {
    let exact_name = if cfg!(target_os = "windows") {
        format!("{MCP_SIDECAR_NAME}.exe")
    } else {
        MCP_SIDECAR_NAME.to_string()
    };
    let exact_path = dir.join(exact_name);
    if exact_path.is_file() {
        return Some(exact_path);
    }

    let prefix = format!("{MCP_SIDECAR_NAME}-");
    let expected_suffix = if cfg!(target_os = "windows") {
        Some(".exe")
    } else {
        None
    };
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with(&prefix) {
            continue;
        }
        if let Some(suffix) = expected_suffix {
            if !name.ends_with(suffix) {
                continue;
            }
        }
        return Some(path);
    }

    None
}
