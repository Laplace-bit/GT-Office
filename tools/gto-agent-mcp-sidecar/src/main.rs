use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{self, BufRead, BufReader, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

const SERVER_NAME: &str = "gto-agent-mcp";
const SERVER_VERSION: &str = "0.1.0";
const JSONRPC_VERSION: &str = "2.0";
const BRIDGE_TIMEOUT_MS: u64 = 8_000;
const BRIDGE_DIRECTORY_RELATIVE_PATH: &str = ".gtoffice/mcp/directory.json";
const ENV_WORKSPACE_ID: &str = "GTO_WORKSPACE_ID";
const ENV_AGENT_ID: &str = "GTO_AGENT_ID";
const ENV_ROLE_KEY: &str = "GTO_ROLE_KEY";
const ENV_STATION_ID: &str = "GTO_STATION_ID";

static BRIDGE_REQ_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
struct RpcRequest {
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    #[serde(default = "default_host")]
    host: String,
    port: u16,
    token: String,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Debug, Clone)]
struct McpStateCandidate {
    key: String,
    runtime_path: PathBuf,
    directory_path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeEnvelope {
    ok: bool,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<BridgeErrorPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeErrorPayload {
    code: String,
    message: String,
    #[serde(default)]
    details: Option<Value>,
}

#[derive(Debug)]
struct ToolError {
    code: String,
    message: String,
    details: Option<Value>,
}

impl ToolError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    fn as_json(&self) -> Value {
        json!({
            "code": self.code,
            "message": self.message,
            "details": self.details,
        })
    }
}

#[derive(Debug, Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

#[derive(Debug, Clone, Copy)]
enum TransportMode {
    Headers,
    Ndjson,
}

#[derive(Debug, Deserialize)]
struct GetDirectoryArgs {
    #[serde(default)]
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
struct DispatchArgs {
    workspace_id: String,
    targets: Vec<String>,
    title: String,
    markdown: String,
    #[serde(default)]
    sender_agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReportStatusArgs {
    workspace_id: String,
    #[serde(default)]
    sender_agent_id: Option<String>,
    target_agent_ids: Vec<String>,
    status: String,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    detail: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HandoverArgs {
    workspace_id: String,
    #[serde(default)]
    sender_agent_id: Option<String>,
    target_agent_ids: Vec<String>,
    summary: String,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    blockers: Vec<String>,
    #[serde(default)]
    next_steps: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ListMessagesArgs {
    #[serde(default)]
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

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();

    while let Some((body, detected_transport)) = read_mcp_message(&mut reader)? {
        let request = match serde_json::from_str::<RpcRequest>(&body) {
            Ok(request) => request,
            Err(error) => {
                let response = json!({
                    "jsonrpc": JSONRPC_VERSION,
                    "id": Value::Null,
                    "error": {
                        "code": -32700,
                        "message": format!("invalid json payload: {error}"),
                    }
                });
                write_mcp_message(&mut writer, &response, detected_transport)?;
                continue;
            }
        };

        let maybe_response = handle_request(request);
        if let Some(response) = maybe_response {
            write_mcp_message(&mut writer, &response, detected_transport)?;
        }
    }

    Ok(())
}

fn handle_request(request: RpcRequest) -> Option<Value> {
    let request_id = request.id.unwrap_or(Value::Null);
    match request.method.as_str() {
        "initialize" => {
            let protocol_version = request
                .params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18");
            Some(json!({
                "jsonrpc": JSONRPC_VERSION,
                "id": request_id,
                "result": {
                    "protocolVersion": protocol_version,
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": SERVER_NAME,
                        "version": SERVER_VERSION,
                    }
                }
            }))
        }
        "ping" => Some(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_id,
            "result": {}
        })),
        "notifications/initialized" => None,
        "tools/list" => Some(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_id,
            "result": {
                "tools": tool_definitions()
            }
        })),
        "tools/call" => {
            let params = match serde_json::from_value::<ToolCallParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    return Some(tool_error_response(
                        request_id,
                        ToolError::new(
                            "MCP_INVALID_PARAMS",
                            format!("invalid tools/call params: {error}"),
                        ),
                    ));
                }
            };
            let result = call_tool(&params.name, params.arguments);
            Some(json!({
                "jsonrpc": JSONRPC_VERSION,
                "id": request_id,
                "result": match result {
                    Ok(value) => tool_text_result(value, false),
                    Err(error) => tool_text_result(error.as_json(), true),
                }
            }))
        }
        method => Some(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_id,
            "error": RpcError {
                code: -32601,
                message: format!("method not found: {method}")
            }
        })),
    }
}

fn tool_error_response(request_id: Value, error: ToolError) -> Value {
    json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "result": tool_text_result(error.as_json(), true)
    })
}

fn tool_text_result(value: Value, is_error: bool) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&value).unwrap_or_else(|_| value.to_string())
        }],
        "isError": is_error,
    })
}

fn tool_definitions() -> Value {
    json!([
      {
        "name": "gto_get_agent_directory",
        "description": "列出当前 workspace 的 agent。GT Office agent 间通信默认走本 MCP；后续发送复用返回里的 workspaceId 和 agents[].agentId。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "workspace_id": { "type": "string" }
          }
        }
      },
      {
        "name": "gto_dispatch_task",
        "description": "向目标 agent 写入并执行任务文本。需要让其他 GT Office agent 执行或回复时使用它；workspace_id 可省略并自动解析。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "required": ["targets", "title", "markdown"],
          "properties": {
            "workspace_id": { "type": "string" },
            "targets": { "type": "array", "minItems": 1, "items": { "type": "string" } },
            "title": { "type": "string" },
            "markdown": { "type": "string" },
            "sender_agent_id": { "type": "string" }
          }
        }
      },
      {
        "name": "gto_report_status",
        "description": "向其他 GT Office agent 回报状态。agent 间普通回复、进展同步默认用它；workspace_id 可省略并自动解析。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "required": ["target_agent_ids", "status"],
          "properties": {
            "workspace_id": { "type": "string" },
            "sender_agent_id": { "type": "string" },
            "target_agent_ids": { "type": "array", "minItems": 1, "items": { "type": "string" } },
            "status": { "type": "string" },
            "task_id": { "type": "string" },
            "detail": { "type": "string" }
          }
        }
      },
      {
        "name": "gto_handover",
        "description": "向其他 GT Office agent 发送结构化交接。任务完成后的总结、阻塞、下一步默认用它；workspace_id 可省略并自动解析。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "required": ["target_agent_ids", "summary"],
          "properties": {
            "workspace_id": { "type": "string" },
            "sender_agent_id": { "type": "string" },
            "target_agent_ids": { "type": "array", "minItems": 1, "items": { "type": "string" } },
            "summary": { "type": "string" },
            "task_id": { "type": "string" },
            "blockers": { "type": "array", "items": { "type": "string" } },
            "next_steps": { "type": "array", "items": { "type": "string" } }
          }
        }
      },
      {
        "name": "gto_health",
        "description": "检查本地 GT Office bridge 是否可发送。bridgeAvailable=false 时只能查目录快照，不能发送。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {}
        }
      },
      {
        "name": "gto_list_messages",
        "description": "读取当前 agent 最近收到的 GT Office MCP 消息。默认读取当前 agent 的 inbox，可按 task_id 过滤。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "workspace_id": { "type": "string" },
            "target_agent_id": { "type": "string" },
            "sender_agent_id": { "type": "string" },
            "task_id": { "type": "string" },
            "limit": { "type": "number" }
          }
        }
      }
    ])
}

fn call_tool(name: &str, arguments: Value) -> Result<Value, ToolError> {
    match name {
        "gto_get_agent_directory" => gto_get_agent_directory(arguments),
        "gto_dispatch_task" => gto_dispatch_task(arguments),
        "gto_report_status" => gto_report_status(arguments),
        "gto_handover" => gto_handover(arguments),
        "gto_health" => gto_health(),
        "gto_list_messages" => gto_list_messages(arguments),
        _ => Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("unsupported tool: {name}"),
        )),
    }
}

fn current_agent_context() -> Value {
    let workspace_id = env::var(ENV_WORKSPACE_ID).ok().filter(|value| !value.trim().is_empty());
    let agent_id = env::var(ENV_AGENT_ID).ok().filter(|value| !value.trim().is_empty());
    let role_key = env::var(ENV_ROLE_KEY).ok().filter(|value| !value.trim().is_empty());
    let station_id = env::var(ENV_STATION_ID).ok().filter(|value| !value.trim().is_empty());

    if workspace_id.is_none() && agent_id.is_none() && role_key.is_none() && station_id.is_none() {
        return Value::Null;
    }

    json!({
        "workspaceId": workspace_id,
        "agentId": agent_id,
        "roleKey": role_key,
        "stationId": station_id,
        "sessionId": Value::Null,
        "toolKind": Value::Null,
    })
}

fn normalize_path(value: &str) -> Option<PathBuf> {
    if value.trim().is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

fn compact_agent(agent: &Value) -> Value {
    json!({
        "agentId": agent.get("agentId").cloned().unwrap_or(Value::Null),
        "name": agent.get("name").cloned().unwrap_or(Value::Null),
        "roleKey": agent.get("roleKey").cloned().unwrap_or(Value::Null),
        "online": agent.get("online").and_then(Value::as_bool).unwrap_or(false),
        "state": agent.get("state").cloned().unwrap_or(Value::Null),
        "resolvedCwd": agent.get("resolvedCwd").cloned().unwrap_or(Value::Null),
    })
}

fn match_agent_by_cwd(agents: &[Value]) -> Option<Value> {
    let cwd = env::current_dir().ok()?;
    let cwd_text = cwd.to_string_lossy().to_string();
    let mut matched: Option<(usize, Value)> = None;

    for agent in agents {
        let Some(agent_cwd) = agent.get("resolvedCwd").and_then(Value::as_str) else {
            continue;
        };
        let Some(agent_path) = normalize_path(agent_cwd) else {
            continue;
        };

        let score = if cwd == agent_path {
            agent_cwd.len() + 1000
        } else if cwd_text.starts_with(&format!("{}{}", agent_cwd, std::path::MAIN_SEPARATOR)) {
            agent_cwd.len()
        } else {
            continue;
        };

        match &matched {
            Some((best_score, _)) if *best_score >= score => {}
            _ => matched = Some((score, agent.clone())),
        }
    }

    matched.map(|(_, agent)| agent)
}

fn compact_directory(directory: &Value) -> Value {
    let context = current_agent_context();
    let inferred_by_cwd = directory
        .get("agents")
        .and_then(Value::as_array)
        .and_then(|agents| match_agent_by_cwd(agents));

    let inferred_agent_id = inferred_by_cwd
        .as_ref()
        .and_then(|agent| agent.get("agentId"))
        .cloned()
        .unwrap_or(Value::Null);
    let inferred_role_key = inferred_by_cwd
        .as_ref()
        .and_then(|agent| agent.get("roleKey"))
        .cloned()
        .unwrap_or(Value::Null);

    let self_payload = if context.is_null() && inferred_agent_id.is_null() {
        Value::Null
    } else {
        json!({
            "agentId": context.get("agentId").cloned().filter(|value| !value.is_null()).unwrap_or(inferred_agent_id.clone()),
            "roleKey": context.get("roleKey").cloned().filter(|value| !value.is_null()).unwrap_or(inferred_role_key),
            "stationId": context.get("stationId").cloned().filter(|value| !value.is_null()).unwrap_or(inferred_agent_id),
            "sessionId": Value::Null,
            "toolKind": Value::Null,
        })
    };

    json!({
        "workspaceId": directory.get("workspaceId").cloned().unwrap_or(Value::Null),
        "directoryVersion": directory.get("directoryVersion").cloned().unwrap_or(Value::Null),
        "updatedAtMs": directory.get("updatedAtMs").cloned().unwrap_or(Value::Null),
        "agents": directory
            .get("agents")
            .and_then(Value::as_array)
            .map(|agents| agents.iter().map(compact_agent).collect::<Vec<_>>())
            .unwrap_or_default(),
        "self": self_payload,
    })
}

fn load_agent_directory(workspace_id: &str) -> Result<Value, ToolError> {
    match call_bridge(
        "directory.get",
        json!({
            "workspaceId": workspace_id,
        }),
        Some(workspace_id),
    ) {
        Ok(directory) => Ok(directory),
        Err(error) if error.code == "WORKSPACE_NOT_FOUND" => Err(
            ToolError::new(
                "MCP_WORKSPACE_NOT_AVAILABLE",
                format!("workspace '{workspace_id}' is not active; refresh directory and retry."),
            )
            .with_details(json!({
                "requestedWorkspaceId": workspace_id,
                "suggestedWorkspaceId": resolve_directory_workspace_id(None).ok().map(|(workspace_id, _)| workspace_id),
                "hint": "Call gto_get_agent_directory({}) again and reuse the returned workspaceId.",
            })),
        ),
        Err(error) if error.code == "MCP_BRIDGE_UNAVAILABLE" => load_directory_snapshot(workspace_id),
        Err(error) => Err(error),
    }
}

fn infer_sender_agent_id_from_directory(
    preferred_workspace_id: Option<&str>,
) -> Result<(String, &'static str), ToolError> {
    let workspace_id = preferred_workspace_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| resolve_directory_workspace_id(None).ok().map(|(workspace_id, _)| workspace_id))
        .ok_or_else(|| {
            ToolError::new(
                "MCP_INVALID_PARAMS",
                "sender agent could not be inferred from current terminal context",
            )
        })?;
    let directory = load_agent_directory(&workspace_id)?;
    let compact = compact_directory(&directory);
    let agent_id = compact
        .get("self")
        .and_then(Value::as_object)
        .and_then(|self_value| self_value.get("agentId"))
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .ok_or_else(|| {
            ToolError::new(
                "MCP_INVALID_PARAMS",
                "sender agent could not be inferred from current terminal context",
            )
        })?;
    Ok((agent_id, "directory"))
}

fn resolve_sender_agent_id(
    explicit: Option<String>,
    preferred_workspace_id: Option<&str>,
) -> Result<(String, &'static str), ToolError> {
    if let Some(agent_id) = explicit.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        return Ok((agent_id, "explicit"));
    }

    if let Some(agent_id) = env::var(ENV_AGENT_ID)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok((agent_id, "env"));
    }

    infer_sender_agent_id_from_directory(preferred_workspace_id)
}

fn validate_workspace_id(
    explicit: Option<&str>,
    allow_auto_resolve: bool,
) -> Result<Option<String>, ToolError> {
    let value = explicit.map(str::trim).unwrap_or_default();
    if value.is_empty() {
        if allow_auto_resolve {
            return Ok(None);
        }
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "workspace_id is required and must look like ws:...",
        ));
    }
    if !value.starts_with("ws:") {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "workspace_id must look like ws:..., not an agent id",
        ));
    }
    Ok(Some(value.to_string()))
}

fn resolve_directory_workspace_id(explicit: Option<&str>) -> Result<(String, &'static str), ToolError> {
    if let Some(workspace_id) = validate_workspace_id(explicit, true)? {
        return Ok((workspace_id, "explicit"));
    }

    if let Some(workspace_id) = env::var(ENV_WORKSPACE_ID)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok((workspace_id, "env"));
    }

    let workspaces = load_directory_workspaces()?;
    let workspace_id = workspaces
        .iter()
        .max_by_key(|(_, snapshot)| {
            snapshot
                .get("updatedAtMs")
                .and_then(Value::as_u64)
                .unwrap_or(0)
        })
        .map(|(workspace_id, _)| workspace_id.clone())
        .ok_or_else(|| {
            ToolError::new(
                "MCP_INVALID_PARAMS",
                "workspace_id is missing and no directory snapshot workspace could be inferred",
            )
        })?;
    Ok((workspace_id, "snapshot"))
}

fn call_bridge_for_send(
    method: &str,
    params: Value,
    workspace_id: &str,
) -> Result<Value, ToolError> {
    match call_bridge(method, params, Some(workspace_id)) {
        Err(error) if error.code == "MCP_BRIDGE_UNAVAILABLE" => Err(ToolError::new(
            "MCP_BRIDGE_SEND_UNAVAILABLE",
            "send requires a live GT Office bridge; directory snapshot alone is not enough.",
        )
        .with_details(json!({
            "originalCode": error.code,
            "details": error.details,
        }))),
        other => other,
    }
}

fn gto_get_agent_directory(arguments: Value) -> Result<Value, ToolError> {
    let args: GetDirectoryArgs = serde_json::from_value(arguments).map_err(|error| {
        ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("gto_get_agent_directory invalid args: {error}"),
        )
    })?;
    let (workspace_id, workspace_resolved_from) =
        resolve_directory_workspace_id(Some(args.workspace_id.as_str()))?;

    let mut directory = compact_directory(&load_agent_directory(&workspace_id)?);
    if let Some(object) = directory.as_object_mut() {
        object.insert(
            "workspaceResolvedFrom".to_string(),
            Value::String(workspace_resolved_from.to_string()),
        );
    }
    Ok(directory)
}

fn gto_dispatch_task(arguments: Value) -> Result<Value, ToolError> {
    let args: DispatchArgs = serde_json::from_value(arguments).map_err(|error| {
        ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("gto_dispatch_task invalid args: {error}"),
        )
    })?;
    let (workspace_id, _) = resolve_directory_workspace_id(Some(args.workspace_id.as_str()))?;
    let (sender_agent_id, sender_resolved_from) = match resolve_sender_agent_id(
        args.sender_agent_id.clone(),
        Some(workspace_id.as_str()),
    ) {
        Ok(resolved) => (Some(resolved.0), resolved.1),
        Err(_) => (None, "human"),
    };

    if args.targets.is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "targets must contain at least one agent id",
        ));
    }
    if args.title.trim().is_empty() {
        return Err(ToolError::new("MCP_INVALID_PARAMS", "title is required"));
    }
    if args.markdown.trim().is_empty() {
        return Err(ToolError::new("MCP_INVALID_PARAMS", "markdown is required"));
    }

    let response = call_bridge_for_send(
        "task.dispatch_batch",
        json!({
            "workspaceId": workspace_id,
            "sender": {
                "type": if sender_agent_id.is_some() { "agent" } else { "human" },
                "agentId": sender_agent_id,
            },
            "targets": args.targets,
            "title": args.title,
            "markdown": args.markdown,
            "attachments": [],
            "submitSequences": {},
        }),
        workspace_id.as_str(),
    )?;

    let sent = response
        .get("results")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|item| item.get("status").and_then(Value::as_str) == Some("sent"))
                .count()
        })
        .unwrap_or(0);
    let failed = response
        .get("results")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|item| item.get("status").and_then(Value::as_str) == Some("failed"))
                .count()
        })
        .unwrap_or(0);

    Ok(json!({
        "summary": format!("batch={} sent={} failed={}", response.get("batchId").and_then(Value::as_str).unwrap_or("unknown"), sent, failed),
        "response": response,
        "senderResolvedFrom": if sender_resolved_from == "human" { Value::Null } else { Value::String(sender_resolved_from.to_string()) },
    }))
}

fn gto_report_status(arguments: Value) -> Result<Value, ToolError> {
    let args: ReportStatusArgs = serde_json::from_value(arguments).map_err(|error| {
        ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("gto_report_status invalid args: {error}"),
        )
    })?;
    let (workspace_id, _) = resolve_directory_workspace_id(Some(args.workspace_id.as_str()))?;
    if args.target_agent_ids.is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "target_agent_ids must contain at least one agent id",
        ));
    }
    if args.status.trim().is_empty() {
        return Err(ToolError::new("MCP_INVALID_PARAMS", "status is required"));
    }

    let (sender_agent_id, sender_resolved_from) =
        resolve_sender_agent_id(args.sender_agent_id, Some(workspace_id.as_str()))?;
    let direct = args.target_agent_ids.len() == 1;
    let response = call_bridge_for_send(
        "channel.publish",
        json!({
            "workspaceId": workspace_id,
            "channel": {
                "kind": if direct { "direct" } else { "group" },
                "id": if direct { args.target_agent_ids[0].clone() } else { "manager-status".to_string() },
            },
            "senderAgentId": sender_agent_id,
            "targetAgentIds": args.target_agent_ids,
            "type": "status",
            "payload": {
                "taskId": args.task_id,
                "status": args.status,
                "detail": args.detail,
                "source": "gto-agent-mcp-sidecar",
            },
            "idempotencyKey": Value::Null,
        }),
        workspace_id.as_str(),
    )?;

    Ok(json!({
        "summary": format!(
            "message={} accepted={} failed={}",
            response.get("messageId").and_then(Value::as_str).unwrap_or("unknown"),
            response.get("acceptedTargets").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
            response.get("failedTargets").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        ),
        "senderResolvedFrom": sender_resolved_from,
        "response": response,
    }))
}

fn gto_handover(arguments: Value) -> Result<Value, ToolError> {
    let args: HandoverArgs = serde_json::from_value(arguments).map_err(|error| {
        ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("gto_handover invalid args: {error}"),
        )
    })?;

    let (workspace_id, _) = resolve_directory_workspace_id(Some(args.workspace_id.as_str()))?;
    if args.target_agent_ids.is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "target_agent_ids must contain at least one agent id",
        ));
    }
    if args.summary.trim().is_empty() {
        return Err(ToolError::new("MCP_INVALID_PARAMS", "summary is required"));
    }

    let (sender_agent_id, sender_resolved_from) =
        resolve_sender_agent_id(args.sender_agent_id, Some(workspace_id.as_str()))?;
    let direct = args.target_agent_ids.len() == 1;
    let response = call_bridge_for_send(
        "channel.publish",
        json!({
            "workspaceId": workspace_id,
            "channel": {
                "kind": if direct { "direct" } else { "group" },
                "id": if direct { args.target_agent_ids[0].clone() } else { "manager-handover".to_string() },
            },
            "senderAgentId": sender_agent_id,
            "targetAgentIds": args.target_agent_ids,
            "type": "handover",
            "payload": {
                "taskId": args.task_id,
                "summary": args.summary,
                "blockers": args.blockers,
                "nextSteps": args.next_steps,
                "source": "gto-agent-mcp-sidecar",
            },
            "idempotencyKey": Value::Null,
        }),
        workspace_id.as_str(),
    )?;

    Ok(json!({
        "summary": format!(
            "handover message={}",
            response.get("messageId").and_then(Value::as_str).unwrap_or("unknown")
        ),
        "senderResolvedFrom": sender_resolved_from,
        "response": response,
    }))
}

fn gto_health() -> Result<Value, ToolError> {
    let self_context = current_agent_context();
    let preferred_workspace_id = self_context
        .get("workspaceId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| resolve_directory_workspace_id(None).ok().map(|(workspace_id, _)| workspace_id));
    let runtime = match load_runtime_config_with_path(preferred_workspace_id.as_deref()) {
        Ok((runtime_path, runtime)) => json!({
            "runtimePath": runtime_path,
            "host": runtime.host,
            "port": runtime.port,
            "version": runtime.version,
        }),
        Err(error) => error.as_json(),
    };
    let (bridge, bridge_available) = match call_bridge("health", json!({}), preferred_workspace_id.as_deref()) {
        Ok(bridge) => (bridge, true),
        Err(error) => (error.as_json(), false),
    };
    let directory_args = self_context
        .get("workspaceId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|workspace_id| json!({ "workspace_id": workspace_id }))
        .unwrap_or_else(|| json!({}));
    let directory = gto_get_agent_directory(directory_args).ok().map(|snapshot| {
        json!({
            "workspaceId": snapshot.get("workspaceId").cloned().unwrap_or(Value::Null),
            "directoryVersion": snapshot.get("directoryVersion").cloned().unwrap_or(Value::Null),
            "updatedAtMs": snapshot.get("updatedAtMs").cloned().unwrap_or(Value::Null),
            "agentCount": snapshot.get("agents").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
            "workspaceResolvedFrom": snapshot.get("workspaceResolvedFrom").cloned().unwrap_or(Value::Null),
        })
    });
    Ok(json!({
        "bridgeAvailable": bridge_available,
        "self": self_context,
        "directory": directory,
        "runtime": if bridge_available { Value::Null } else { runtime },
        "bridge": if bridge_available { Value::Null } else { bridge },
    }))
}

fn gto_list_messages(arguments: Value) -> Result<Value, ToolError> {
    let args: ListMessagesArgs = serde_json::from_value(arguments).map_err(|error| {
        ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("gto_list_messages invalid args: {error}"),
        )
    })?;
    let (workspace_id, _) = resolve_directory_workspace_id(Some(args.workspace_id.as_str()))?;
    let target_agent_id = args
        .target_agent_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| {
            resolve_sender_agent_id(None, Some(workspace_id.as_str()))
                .map(|resolved| resolved.0)
                .unwrap_or_default()
        });
    if target_agent_id.trim().is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "target_agent_id could not be inferred from current terminal context",
        ));
    }
    let response = call_bridge_for_send(
        "channel.list_messages",
        json!({
            "workspaceId": workspace_id,
            "targetAgentId": target_agent_id,
            "senderAgentId": args.sender_agent_id,
            "taskId": args.task_id,
            "limit": args.limit.unwrap_or(20),
        }),
        workspace_id.as_str(),
    )?;
    Ok(json!({
        "targetAgentId": target_agent_id,
        "messages": response.get("messages").cloned().unwrap_or_else(|| json!([])),
    }))
}

fn call_bridge(
    method: &str,
    params: Value,
    preferred_workspace_id: Option<&str>,
) -> Result<Value, ToolError> {
    let runtime = load_runtime_config(preferred_workspace_id)?;
    let request_id = format!("bridge_{}", BRIDGE_REQ_SEQ.fetch_add(1, Ordering::Relaxed));

    let mut addrs = (runtime.host.as_str(), runtime.port)
        .to_socket_addrs()
        .map_err(|error| {
            ToolError::new(
                "MCP_BRIDGE_UNAVAILABLE",
                format!("resolve bridge address failed: {error}"),
            )
        })?;
    let addr = addrs.next().ok_or_else(|| {
        ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            "bridge address resolution returned empty set",
        )
    })?;

    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(BRIDGE_TIMEOUT_MS))
        .map_err(|error| {
            ToolError::new(
                "MCP_BRIDGE_UNAVAILABLE",
                format!("bridge connection failed: {error}"),
            )
            .with_details(json!({ "host": runtime.host, "port": runtime.port }))
        })?;
    stream
        .set_read_timeout(Some(Duration::from_millis(BRIDGE_TIMEOUT_MS)))
        .map_err(|error| {
            ToolError::new(
                "MCP_BRIDGE_UNAVAILABLE",
                format!("set read timeout failed: {error}"),
            )
        })?;
    stream
        .set_write_timeout(Some(Duration::from_millis(BRIDGE_TIMEOUT_MS)))
        .map_err(|error| {
            ToolError::new(
                "MCP_BRIDGE_UNAVAILABLE",
                format!("set write timeout failed: {error}"),
            )
        })?;

    let request_payload = json!({
        "id": request_id,
        "token": runtime.token,
        "method": method,
        "params": params,
    });

    let request_line = format!(
        "{}\n",
        serde_json::to_string(&request_payload).map_err(|error| {
            ToolError::new(
                "MCP_BRIDGE_INTERNAL",
                format!("serialize bridge request failed: {error}"),
            )
        })?
    );

    stream.write_all(request_line.as_bytes()).map_err(|error| {
        ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            format!("bridge write failed: {error}"),
        )
    })?;

    let mut line = String::new();
    let mut reader = BufReader::new(stream);
    reader.read_line(&mut line).map_err(|error| {
        ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            format!("bridge read failed: {error}"),
        )
    })?;

    if line.trim().is_empty() {
        return Err(ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            "bridge returned empty response",
        ));
    }

    let envelope: BridgeEnvelope = serde_json::from_str(line.trim()).map_err(|error| {
        ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            format!("bridge returned invalid JSON: {error}"),
        )
    })?;

    if envelope.ok {
        return Ok(envelope.data.unwrap_or_else(|| json!({})));
    }

    if let Some(error) = envelope.error {
        return Err(ToolError {
            code: error.code,
            message: error.message,
            details: error.details,
        });
    }

    Err(ToolError::new(
        "MCP_BRIDGE_UNAVAILABLE",
        "bridge returned failure without error payload",
    ))
}

fn load_runtime_config(preferred_workspace_id: Option<&str>) -> Result<RuntimeConfig, ToolError> {
    load_runtime_config_with_path(preferred_workspace_id).map(|(_, runtime)| runtime)
}

fn load_runtime_config_with_path(
    preferred_workspace_id: Option<&str>,
) -> Result<(PathBuf, RuntimeConfig), ToolError> {
    let candidates = resolve_runtime_candidates(preferred_workspace_id)?;
    let mut failures = Vec::new();

    for candidate in &candidates {
        let runtime_path = &candidate.runtime_path;
        let raw = match fs::read_to_string(runtime_path) {
            Ok(raw) => raw,
            Err(error) => {
                failures.push(json!({
                    "runtimePath": runtime_path,
                    "cause": error.to_string(),
                }));
                continue;
            }
        };

        let runtime: RuntimeConfig = match serde_json::from_str(&raw) {
            Ok(runtime) => runtime,
            Err(error) => {
                failures.push(json!({
                    "runtimePath": runtime_path,
                    "cause": error.to_string(),
                }));
                continue;
            }
        };

        if runtime.token.trim().is_empty() || runtime.port == 0 {
            failures.push(json!({
                "runtimePath": runtime_path,
                "cause": "runtime missing token/port",
            }));
            continue;
        }

        return Ok((runtime_path.clone(), runtime));
    }

    let runtime_path = candidates
        .first()
        .map(|candidate| candidate.runtime_path.clone())
        .unwrap_or_else(fallback_runtime_path);
    Err(ToolError::new(
        "MCP_BRIDGE_UNAVAILABLE",
        format!("runtime file not found: {}", runtime_path.display()),
    )
    .with_details(json!({
        "runtimePath": runtime_path,
        "candidates": candidates.iter().map(|candidate| candidate.runtime_path.clone()).collect::<Vec<_>>(),
        "failures": failures,
        "preferredWorkspaceId": preferred_workspace_id,
    })))
}

fn load_directory_snapshot(workspace_id: &str) -> Result<Value, ToolError> {
    let workspaces = load_directory_workspaces()?;
    workspaces.get(workspace_id).cloned().ok_or_else(|| {
        ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            format!("directory snapshot for workspace '{}' was not found", workspace_id),
        )
    })
}

fn load_directory_workspaces() -> Result<std::collections::BTreeMap<String, Value>, ToolError> {
    let candidates = resolve_directory_candidates();
    let mut failures = Vec::new();
    let mut merged_workspaces = std::collections::BTreeMap::new();

    for file_path in &candidates {
        let raw = match fs::read_to_string(file_path) {
            Ok(raw) => raw,
            Err(error) => {
                failures.push(json!({
                    "directoryPath": file_path,
                    "cause": error.to_string(),
                }));
                continue;
            }
        };
        let parsed: Value = match serde_json::from_str(&raw) {
            Ok(parsed) => parsed,
            Err(error) => {
                failures.push(json!({
                    "directoryPath": file_path,
                    "cause": error.to_string(),
                }));
                continue;
            }
        };
        let workspaces = match parsed.get("workspaces").and_then(Value::as_object) {
            Some(workspaces) if !workspaces.is_empty() => workspaces,
            _ => {
                failures.push(json!({
                    "directoryPath": file_path,
                    "cause": "workspaces missing or empty",
                }));
                continue;
            }
        };
        for (workspace_id, snapshot) in workspaces {
            merged_workspaces
                .entry(workspace_id.clone())
                .or_insert_with(|| snapshot.clone());
        }
    }

    if !merged_workspaces.is_empty() {
        return Ok(merged_workspaces);
    }

    let directory_path = candidates
        .first()
        .cloned()
        .unwrap_or_else(fallback_directory_path);
    Err(ToolError::new(
        "MCP_BRIDGE_UNAVAILABLE",
        format!("directory snapshot file not found: {}", directory_path.display()),
    )
    .with_details(json!({
        "directoryPath": directory_path,
        "candidates": candidates,
        "failures": failures,
    })))
}

fn resolve_directory_candidates() -> Vec<PathBuf> {
    if let Some(path) = env::var_os("GTO_MCP_DIRECTORY_FILE") {
        return vec![PathBuf::from(path)];
    }

    let mut candidates = Vec::new();
    push_runtime_candidate(
        &mut candidates,
        user_home_dir().map(|home| home.join(BRIDGE_DIRECTORY_RELATIVE_PATH)),
    );

    if is_wsl() {
        let windows_home = windows_home_dir_from_wsl();
        push_runtime_candidate(
            &mut candidates,
            windows_home.map(|home| home.join(BRIDGE_DIRECTORY_RELATIVE_PATH)),
        );
    }

    if let Some(user_profile) = env::var_os("USERPROFILE") {
        push_runtime_candidate(
            &mut candidates,
            Some(PathBuf::from(user_profile).join(BRIDGE_DIRECTORY_RELATIVE_PATH)),
        );
    }

    candidates.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| std::cmp::Reverse(duration.as_millis()))
            .unwrap_or_else(|| std::cmp::Reverse(0))
    });

    if candidates.is_empty() {
        candidates.push(fallback_directory_path());
    }
    candidates
}

fn resolve_runtime_candidates(
    preferred_workspace_id: Option<&str>,
) -> Result<Vec<McpStateCandidate>, ToolError> {
    let mut candidates = resolve_state_candidates();
    candidates.sort_by(|left, right| {
        let left_match = candidate_matches_workspace(left, preferred_workspace_id);
        let right_match = candidate_matches_workspace(right, preferred_workspace_id);
        right_match
            .cmp(&left_match)
            .then_with(|| state_candidate_freshness(right).cmp(&state_candidate_freshness(left)))
    });

    if candidates.is_empty() {
        candidates.push(McpStateCandidate {
            key: "fallback".to_string(),
            runtime_path: fallback_runtime_path(),
            directory_path: fallback_directory_path(),
        });
    }

    Ok(candidates)
}

fn resolve_state_candidates() -> Vec<McpStateCandidate> {
    let runtime_override = env::var_os("GTO_MCP_RUNTIME_FILE").map(PathBuf::from);
    let directory_override = env::var_os("GTO_MCP_DIRECTORY_FILE").map(PathBuf::from);
    if runtime_override.is_some() || directory_override.is_some() {
        let runtime_path = runtime_override.unwrap_or_else(|| {
            directory_override
                .as_ref()
                .and_then(|path| path.parent().map(|parent| parent.join("runtime.json")))
                .unwrap_or_else(fallback_runtime_path)
        });
        let directory_path = directory_override.unwrap_or_else(|| {
            runtime_path
                .parent()
                .map(|parent| parent.join("directory.json"))
                .unwrap_or_else(fallback_directory_path)
        });
        return vec![McpStateCandidate {
            key: runtime_path
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_string_lossy()
                .to_string(),
            runtime_path,
            directory_path,
        }];
    }

    let mut candidates = Vec::new();
    push_state_candidate(
        &mut candidates,
        user_home_dir().map(|home| home.join(".gtoffice/mcp")),
    );

    if is_wsl() {
        let windows_home = windows_home_dir_from_wsl();
        push_state_candidate(
            &mut candidates,
            windows_home.map(|home| home.join(".gtoffice/mcp")),
        );
    }

    if let Some(user_profile) = env::var_os("USERPROFILE") {
        push_state_candidate(
            &mut candidates,
            Some(PathBuf::from(user_profile).join(".gtoffice/mcp")),
        );
    }

    candidates
}

fn candidate_matches_workspace(
    candidate: &McpStateCandidate,
    preferred_workspace_id: Option<&str>,
) -> bool {
    let Some(workspace_id) = preferred_workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };

    let raw = match fs::read_to_string(&candidate.directory_path) {
        Ok(raw) => raw,
        Err(_) => return false,
    };
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };
    parsed
        .get("workspaces")
        .and_then(Value::as_object)
        .is_some_and(|workspaces| workspaces.contains_key(workspace_id))
}

fn state_candidate_freshness(candidate: &McpStateCandidate) -> u128 {
    path_mtime_ms(&candidate.runtime_path).max(path_mtime_ms(&candidate.directory_path))
}

fn path_mtime_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn push_state_candidate(candidates: &mut Vec<McpStateCandidate>, base_path: Option<PathBuf>) {
    let Some(base_path) = base_path else {
        return;
    };
    let key = base_path.to_string_lossy().to_string();
    if candidates.iter().any(|existing| existing.key == key) {
        return;
    }
    candidates.push(McpStateCandidate {
        key,
        runtime_path: base_path.join("runtime.json"),
        directory_path: base_path.join("directory.json"),
    });
}

fn push_runtime_candidate(candidates: &mut Vec<PathBuf>, path: Option<PathBuf>) {
    let Some(path) = path else {
        return;
    };
    if !candidates.iter().any(|existing| existing == &path) {
        candidates.push(path);
    }
}

fn fallback_runtime_path() -> PathBuf {
    env::temp_dir().join("gtoffice/mcp/runtime.json")
}

fn fallback_directory_path() -> PathBuf {
    env::temp_dir().join("gtoffice/mcp/directory.json")
}

fn user_home_dir() -> Option<PathBuf> {
    if let Some(value) = env::var_os("HOME") {
        return Some(PathBuf::from(value));
    }
    env::var_os("USERPROFILE").map(PathBuf::from)
}

fn is_wsl() -> bool {
    env::var_os("WSL_DISTRO_NAME").is_some()
        || fs::read_to_string("/proc/version")
            .map(|content| content.to_ascii_lowercase().contains("microsoft"))
            .unwrap_or(false)
}

fn windows_home_dir_from_wsl() -> Option<PathBuf> {
    let user = env::var_os("USER")?;
    Some(PathBuf::from("/mnt/c/Users").join(user))
}

fn read_mcp_message<R: BufRead>(reader: &mut R) -> io::Result<Option<(String, TransportMode)>> {
    let mut line = String::new();
    let mut content_length: Option<usize> = None;

    loop {
        line.clear();
        let bytes = reader.read_line(&mut line)?;
        if bytes == 0 {
            return Ok(None);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }

        if content_length.is_none() && (trimmed.starts_with('{') || trimmed.starts_with('[')) {
            return Ok(Some((trimmed.to_string(), TransportMode::Ndjson)));
        }

        let lower = trimmed.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            let len = value.trim().parse::<usize>().map_err(|error| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("invalid content-length header: {error}"),
                )
            })?;
            content_length = Some(len);
        }
    }

    let length = content_length.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "missing Content-Length header in MCP message",
        )
    })?;

    let mut body_bytes = vec![0_u8; length];
    reader.read_exact(&mut body_bytes)?;
    let body = String::from_utf8(body_bytes).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid utf-8 body: {error}"),
        )
    })?;

    Ok(Some((body, TransportMode::Headers)))
}

fn write_mcp_message<W: Write>(
    writer: &mut W,
    payload: &Value,
    transport: TransportMode,
) -> io::Result<()> {
    let body = serde_json::to_vec(payload).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("serialize MCP payload failed: {error}"),
        )
    })?;
    match transport {
        TransportMode::Headers => {
            writer.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())?;
            writer.write_all(&body)?;
        }
        TransportMode::Ndjson => {
            writer.write_all(&body)?;
            writer.write_all(b"\n")?;
        }
    }
    writer.flush()?;
    Ok(())
}
