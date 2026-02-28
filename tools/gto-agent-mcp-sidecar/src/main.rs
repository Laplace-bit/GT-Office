use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{self, BufRead, BufReader, Write},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

const SERVER_NAME: &str = "gto-agent-mcp";
const SERVER_VERSION: &str = "0.1.0";
const JSONRPC_VERSION: &str = "2.0";
const BRIDGE_TIMEOUT_MS: u64 = 8_000;

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
    sender_agent_id: String,
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
    sender_agent_id: String,
    target_agent_ids: Vec<String>,
    summary: String,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    blockers: Vec<String>,
    #[serde(default)]
    next_steps: Vec<String>,
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
            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
        }],
        "isError": is_error,
    })
}

fn tool_definitions() -> Value {
    json!([
      {
        "name": "gto_dispatch_task",
        "description": "通过 GT Office 任务中心批量派发任务给目标 Agent（manager -> workers）。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "required": ["workspace_id", "targets", "title", "markdown"],
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
        "description": "执行 Agent 向 manager 或其他 Agent 汇报状态进展（status）。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "required": ["workspace_id", "sender_agent_id", "target_agent_ids", "status"],
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
        "description": "执行 Agent 完成后发送结构化交接（handover）给 manager。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "required": ["workspace_id", "sender_agent_id", "target_agent_ids", "summary"],
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
        "description": "检查本地 GT Office MCP bridge 健康状态与运行时配置。",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {}
        }
      }
    ])
}

fn call_tool(name: &str, arguments: Value) -> Result<Value, ToolError> {
    match name {
        "gto_dispatch_task" => gto_dispatch_task(arguments),
        "gto_report_status" => gto_report_status(arguments),
        "gto_handover" => gto_handover(arguments),
        "gto_health" => gto_health(),
        _ => Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("unsupported tool: {name}"),
        )),
    }
}

fn gto_dispatch_task(arguments: Value) -> Result<Value, ToolError> {
    let args: DispatchArgs = serde_json::from_value(arguments).map_err(|error| {
        ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("gto_dispatch_task invalid args: {error}"),
        )
    })?;

    if args.workspace_id.trim().is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "workspace_id is required",
        ));
    }
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

    let response = call_bridge(
        "task.dispatch_batch",
        json!({
            "workspaceId": args.workspace_id,
            "sender": {
                "type": if args.sender_agent_id.as_deref().is_some_and(|v| !v.trim().is_empty()) { "agent" } else { "human" },
                "agentId": args.sender_agent_id,
            },
            "targets": args.targets,
            "title": args.title,
            "markdown": args.markdown,
            "attachments": [],
            "submitSequences": {},
        }),
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
    }))
}

fn gto_report_status(arguments: Value) -> Result<Value, ToolError> {
    let args: ReportStatusArgs = serde_json::from_value(arguments).map_err(|error| {
        ToolError::new(
            "MCP_INVALID_PARAMS",
            format!("gto_report_status invalid args: {error}"),
        )
    })?;
    if args.workspace_id.trim().is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "workspace_id is required",
        ));
    }
    if args.sender_agent_id.trim().is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "sender_agent_id is required",
        ));
    }
    if args.target_agent_ids.is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "target_agent_ids must contain at least one agent id",
        ));
    }
    if args.status.trim().is_empty() {
        return Err(ToolError::new("MCP_INVALID_PARAMS", "status is required"));
    }

    let direct = args.target_agent_ids.len() == 1;
    let response = call_bridge(
        "channel.publish",
        json!({
            "workspaceId": args.workspace_id,
            "channel": {
                "kind": if direct { "direct" } else { "group" },
                "id": if direct { args.target_agent_ids[0].clone() } else { "manager-status".to_string() },
            },
            "senderAgentId": args.sender_agent_id,
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
    )?;

    Ok(json!({
        "summary": format!(
            "message={} accepted={} failed={}",
            response.get("messageId").and_then(Value::as_str).unwrap_or("unknown"),
            response.get("acceptedTargets").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
            response.get("failedTargets").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        ),
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

    if args.workspace_id.trim().is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "workspace_id is required",
        ));
    }
    if args.sender_agent_id.trim().is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "sender_agent_id is required",
        ));
    }
    if args.target_agent_ids.is_empty() {
        return Err(ToolError::new(
            "MCP_INVALID_PARAMS",
            "target_agent_ids must contain at least one agent id",
        ));
    }
    if args.summary.trim().is_empty() {
        return Err(ToolError::new("MCP_INVALID_PARAMS", "summary is required"));
    }

    let direct = args.target_agent_ids.len() == 1;
    let response = call_bridge(
        "channel.publish",
        json!({
            "workspaceId": args.workspace_id,
            "channel": {
                "kind": if direct { "direct" } else { "group" },
                "id": if direct { args.target_agent_ids[0].clone() } else { "manager-handover".to_string() },
            },
            "senderAgentId": args.sender_agent_id,
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
    )?;

    Ok(json!({
        "summary": format!(
            "handover message={}",
            response.get("messageId").and_then(Value::as_str).unwrap_or("unknown")
        ),
        "response": response,
    }))
}

fn gto_health() -> Result<Value, ToolError> {
    let runtime_path = resolve_runtime_path();
    let runtime = load_runtime_config()?;
    let bridge = call_bridge("health", json!({}))?;
    Ok(json!({
        "runtime": {
            "runtimePath": runtime_path,
            "host": runtime.host,
            "port": runtime.port,
            "version": runtime.version,
        },
        "bridge": bridge,
    }))
}

fn call_bridge(method: &str, params: Value) -> Result<Value, ToolError> {
    let runtime = load_runtime_config()?;
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

fn load_runtime_config() -> Result<RuntimeConfig, ToolError> {
    let runtime_path = resolve_runtime_path();
    let raw = fs::read_to_string(&runtime_path).map_err(|error| {
        ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            format!("runtime file not found: {}", runtime_path.display()),
        )
        .with_details(json!({
            "runtimePath": runtime_path,
            "cause": error.to_string(),
        }))
    })?;

    let runtime: RuntimeConfig = serde_json::from_str(&raw).map_err(|error| {
        ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            format!("runtime file invalid: {}", runtime_path.display()),
        )
        .with_details(json!({
            "runtimePath": runtime_path,
            "cause": error.to_string(),
        }))
    })?;

    if runtime.token.trim().is_empty() || runtime.port == 0 {
        return Err(ToolError::new(
            "MCP_BRIDGE_UNAVAILABLE",
            "runtime missing token/port",
        ));
    }

    Ok(runtime)
}

fn resolve_runtime_path() -> PathBuf {
    if let Some(path) = env::var_os("GTO_MCP_RUNTIME_FILE") {
        return PathBuf::from(path);
    }

    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join(".gtoffice/mcp/runtime.json");
    }
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        return PathBuf::from(user_profile).join(".gtoffice/mcp/runtime.json");
    }

    env::temp_dir().join("gtoffice/mcp/runtime.json")
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
