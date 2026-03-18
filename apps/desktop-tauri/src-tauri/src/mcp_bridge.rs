use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
};
use tracing::{debug, info, warn};
use vb_abstractions::{
    AbstractionError, TerminalCreateRequest, TerminalCwdMode, TerminalProvider, WorkspaceId,
    WorkspaceService,
};
use vb_agent::AgentRepository;
use vb_storage::{SqliteAgentRepository, SqliteStorage};
use vb_task::{
    AgentRuntimeRegistration, AgentToolKind, ChannelAckEvent, ChannelMessageEvent,
    ChannelPublishRequest, TaskDispatchBatchRequest, TaskDispatchProgressEvent,
};

use crate::app_state::AppState;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<BridgeErrorPayload>,
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

    fn payload(&self) -> BridgeErrorPayload {
        BridgeErrorPayload {
            code: self.code.to_string(),
            message: self.message.clone(),
            details: self.details.clone(),
        }
    }
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
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: bind failed: {error}"))?;
    let addr = listener
        .local_addr()
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: local_addr failed: {error}"))?;
    let token = uuid::Uuid::new_v4().to_string();
    let mcp_command = resolve_mcp_command(&app);

    write_runtime_file(&addr, &token, mcp_command.as_ref())
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: write runtime failed: {error}"))?;
    info!(addr = %addr, "mcp bridge listening");

    loop {
        let (stream, remote) = listener
            .accept()
            .await
            .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: accept failed: {error}"))?;

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
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: read failed: {error}"))?
    {
        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<BridgeRequest>(&line) {
            Ok(request) => request,
            Err(error) => {
                let response = BridgeResponse {
                    id: "unknown".to_string(),
                    ok: false,
                    data: None,
                    error: Some(
                        BridgeError::new(
                            "MCP_BRIDGE_INVALID_REQUEST",
                            format!("invalid request json: {error}"),
                        )
                        .payload(),
                    ),
                };
                write_response(&mut writer, &response).await?;
                continue;
            }
        };

        let response = if request.token != expected_token {
            BridgeResponse {
                id: request.id,
                ok: false,
                data: None,
                error: Some(
                    BridgeError::new("MCP_BRIDGE_AUTH_FAILED", "invalid bridge token").payload(),
                ),
            }
        } else {
            match handle_request(app, state, &request).await {
                Ok(data) => BridgeResponse {
                    id: request.id,
                    ok: true,
                    data: Some(data),
                    error: None,
                },
                Err(error) => BridgeResponse {
                    id: request.id,
                    ok: false,
                    data: None,
                    error: Some(error.payload()),
                },
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
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: encode failed: {error}"))?;
    payload.push(b'\n');
    writer
        .write_all(&payload)
        .await
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: write failed: {error}"))
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
        "dev.bootstrap_agents" => dev_bootstrap_agents(app, state, request.params.clone()),
        "task.dispatch_batch" => dispatch_batch(app, state, request.params.clone()),
        "channel.publish" => publish_channel(app, state, request.params.clone()),
        "channel.list_messages" => list_channel_messages(state, request.params.clone()),
        method => Err(BridgeError::new(
            "MCP_BRIDGE_METHOD_UNSUPPORTED",
            format!("unsupported method: {method}"),
        )),
    }
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
            "MCP_BRIDGE_INVALID_PARAMS",
            format!("directory.get params invalid: {error}"),
        )
    })?;

    let workspace_id = request.workspace_id.trim();
    if workspace_id.is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }

    if let Ok(Some(snapshot)) = state.mcp_directory_snapshot(workspace_id) {
        return Ok(snapshot);
    }

    refresh_directory_snapshot(app, state, workspace_id)
        .map_err(|error| BridgeError::new("MCP_BRIDGE_INTERNAL", error))
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
    repo.seed_defaults(workspace_id)
        .map_err(|error| error.to_string())?;

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
            "MCP_BRIDGE_INVALID_PARAMS",
            format!("task.dispatch_batch params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }
    if request.targets.is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            "targets must not be empty",
        ));
    }
    if request.markdown.trim().is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            "markdown must not be empty",
        ));
    }

    let workspace_root = state
        .workspace_root_path(&request.workspace_id)
        .map_err(|error| BridgeError::new("MCP_BRIDGE_WORKSPACE_INVALID", error))?;

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
        .map_err(|error| BridgeError::new("MCP_BRIDGE_INTERNAL", error.to_string()))
}

fn publish_channel(app: &AppHandle, state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: ChannelPublishRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            format!("channel.publish params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            "workspaceId is required",
        ));
    }

    let outcome = state.task_service.publish(&request);
    emit_channel_events(app, &outcome.message_events, &outcome.ack_events);
    serde_json::to_value(outcome.response)
        .map_err(|error| BridgeError::new("MCP_BRIDGE_INTERNAL", error.to_string()))
}

fn list_channel_messages(state: &AppState, params: Value) -> Result<Value, BridgeError> {
    let request: ChannelListMessagesRequest = serde_json::from_value(params).map_err(|error| {
        BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            format!("channel.list_messages params invalid: {error}"),
        )
    })?;

    if request.workspace_id.trim().is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
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
            "MCP_BRIDGE_INVALID_PARAMS",
            format!("dev.bootstrap_agents params invalid: {error}"),
        )
    })?;

    let workspace_path = request.workspace_path.trim();
    if workspace_path.is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            "workspacePath is required",
        ));
    }

    let targets = normalize_target_ids(&request.targets);
    if targets.is_empty() {
        return Err(BridgeError::new(
            "MCP_BRIDGE_INVALID_PARAMS",
            "targets must contain at least one agent id",
        ));
    }

    let workspace = state
        .workspace_service
        .open(Path::new(workspace_path))
        .map_err(|error| BridgeError::new("MCP_BRIDGE_WORKSPACE_INVALID", error.to_string()))?;

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
        let terminal_env =
            build_agent_terminal_env(workspace.workspace_id.as_str(), &agent_id, None, &agent_id);
        let terminal_env = augment_terminal_env_for_agent(
            app,
            state,
            workspace.workspace_id.as_str(),
            tool_kind,
            terminal_env,
        )
        .map_err(|error| BridgeError::new("MCP_BRIDGE_TERMINAL_INVALID", error))?;
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
                    "MCP_BRIDGE_TERMINAL_INVALID",
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
                role_key: None,
                session_id: session.session_id.clone(),
                tool_kind,
                resolved_cwd: Some(session.resolved_cwd.clone()),
                submit_sequence: Some(submit_sequence.clone()),
                online: true,
            });

        bootstrapped_agents.push(json!({
            "agentId": agent_id,
            "stationId": agent_id,
            "sessionId": session.session_id,
            "toolKind": tool_kind,
            "resolvedCwd": session.resolved_cwd,
            "submitSequence": submit_sequence.clone(),
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
            "MCP_BRIDGE_INVALID_PARAMS",
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
        "MCP_BRIDGE_UNAVAILABLE: directory path does not have parent directory".to_string()
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: create dir failed: {error}"))?;

    let mut workspaces = fs::read_to_string(&directory_path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|value| value.get("workspaces").cloned())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    workspaces.insert(workspace_id.to_string(), snapshot.clone());

    let payload = json!({
        "version": BRIDGE_VERSION,
        "updatedAtMs": chrono_like_now_ms(),
        "workspaces": workspaces,
    });

    fs::write(
        &directory_path,
        serde_json::to_vec_pretty(&payload).map_err(|error| {
            format!("MCP_BRIDGE_UNAVAILABLE: serialize directory failed: {error}")
        })?,
    )
    .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: write directory failed: {error}"))?;
    Ok(())
}

fn write_runtime_file(
    addr: &SocketAddr,
    token: &str,
    mcp_command: Option<&McpCommandSpec>,
) -> Result<(), String> {
    let runtime_path = runtime_file_path();
    let parent = runtime_path.parent().ok_or_else(|| {
        "MCP_BRIDGE_UNAVAILABLE: runtime path does not have parent directory".to_string()
    })?;

    fs::create_dir_all(parent)
        .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: create dir failed: {error}"))?;
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
            format!("MCP_BRIDGE_UNAVAILABLE: serialize runtime failed: {error}")
        })?,
    )
    .map_err(|error| format!("MCP_BRIDGE_UNAVAILABLE: write runtime failed: {error}"))?;
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

    if let Ok(cwd) = env::current_dir() {
        let script = cwd.join("tools/gto-agent-mcp/bin/gto-agent-mcp.mjs");
        if script.exists() && script.is_file() {
            let node = env::var("GTO_MCP_NODE").unwrap_or_else(|_| "node".to_string());
            return Some(McpCommandSpec {
                command: node,
                args: vec![script.to_string_lossy().to_string(), "serve".to_string()],
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
