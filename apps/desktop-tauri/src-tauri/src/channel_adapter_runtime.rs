use gt_task::{ExternalInboundMessage, ExternalInboundStatus, ExternalPeerKind};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs,
    path::PathBuf,
    sync::{OnceLock, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{timeout, Duration},
};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    commands::tool_adapter::process_external_inbound_message,
    connectors::{feishu, telegram},
};

const CHANNEL_RUNTIME_VERSION: &str = "0.1.0";
const CHANNEL_HOST: &str = "127.0.0.1";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const HTTP_REQUEST_TIMEOUT_MS: u64 = 30_000;
const REQUEST_RATE_LIMIT_WINDOW_MS: u64 = 60_000;
const REQUEST_RATE_LIMIT_MAX_REQUESTS: u32 = 120;
const REQUEST_RATE_LIMIT_MAX_TRACKED_KEYS: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAdapterRuntimeMetricsSnapshot {
    pub total_requests: u64,
    pub webhook_requests: u64,
    pub health_requests: u64,
    pub dispatched: u64,
    pub duplicate: u64,
    pub pairing_required: u64,
    pub denied: u64,
    pub route_not_found: u64,
    pub failed: u64,
    pub unauthorized: u64,
    pub invalid_requests: u64,
    pub rate_limited: u64,
    pub timeouts: u64,
    pub internal_errors: u64,
    pub rate_limit_tracked_keys: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAdapterRuntimeSnapshot {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub feishu_webhook: String,
    pub telegram_webhook: String,
    pub started_at_ms: u64,
    pub metrics: ChannelAdapterRuntimeMetricsSnapshot,
}

#[derive(Clone)]
struct RuntimeContext {
    app: AppHandle,
    state: AppState,
    feishu_token: String,
    telegram_token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelRuntimeFile {
    version: String,
    host: String,
    port: u16,
    base_url: String,
    feishu_webhook: String,
    telegram_webhook: String,
    started_at_ms: u64,
}

#[derive(Debug, Clone)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

static CHANNEL_RUNTIME: OnceLock<RwLock<Option<ChannelAdapterRuntimeSnapshot>>> = OnceLock::new();
static CHANNEL_RATE_LIMIT: OnceLock<RwLock<RateLimitState>> = OnceLock::new();

#[derive(Debug, Clone)]
struct RateLimitEntry {
    count: u32,
    window_started_at_ms: u64,
}

#[derive(Debug, Default)]
struct RateLimitState {
    entries: HashMap<String, RateLimitEntry>,
    last_cleanup_at_ms: u64,
}

pub fn spawn(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_runtime(app.clone(), state).await {
            clear_runtime_snapshot();
            warn!(error = %error, "failed to boot channel adapter runtime");
        }
    });
}

pub fn runtime_snapshot() -> Option<ChannelAdapterRuntimeSnapshot> {
    let lock = CHANNEL_RUNTIME.get_or_init(|| RwLock::new(None));
    lock.read().ok().and_then(|guard| guard.clone())
}

fn set_runtime_snapshot(snapshot: ChannelAdapterRuntimeSnapshot) {
    let lock = CHANNEL_RUNTIME.get_or_init(|| RwLock::new(None));
    if let Ok(mut guard) = lock.write() {
        *guard = Some(snapshot);
    }
}

fn clear_runtime_snapshot() {
    let lock = CHANNEL_RUNTIME.get_or_init(|| RwLock::new(None));
    if let Ok(mut guard) = lock.write() {
        *guard = None;
    }
}

fn with_runtime_metrics_mut<F>(mutator: F)
where
    F: FnOnce(&mut ChannelAdapterRuntimeMetricsSnapshot),
{
    let lock = CHANNEL_RUNTIME.get_or_init(|| RwLock::new(None));
    if let Ok(mut guard) = lock.write() {
        if let Some(runtime) = guard.as_mut() {
            mutator(&mut runtime.metrics);
        }
    }
}

fn mark_runtime_error(metrics: &mut ChannelAdapterRuntimeMetricsSnapshot, detail: String) {
    metrics.last_error = Some(detail);
    metrics.last_error_at_ms = Some(now_ms());
}

fn status_for_http_read_error(error: &str) -> u16 {
    if error.contains("BODY_TOO_LARGE") || error.contains("HEADER_TOO_LARGE") {
        return 413;
    }
    if error.contains("REQUEST_TIMEOUT") {
        return 408;
    }
    400
}

fn update_rate_limit_tracked_keys_metrics(count: usize) {
    with_runtime_metrics_mut(|metrics| {
        metrics.rate_limit_tracked_keys = count;
    });
}

fn apply_rate_limit(account_key: &str) -> bool {
    let now = now_ms();
    let lock = CHANNEL_RATE_LIMIT.get_or_init(|| RwLock::new(RateLimitState::default()));
    let mut limited = false;
    let mut tracked_keys = 0usize;

    if let Ok(mut guard) = lock.write() {
        if !guard.entries.is_empty()
            && now.saturating_sub(guard.last_cleanup_at_ms) >= REQUEST_RATE_LIMIT_WINDOW_MS
        {
            guard.last_cleanup_at_ms = now;
            guard.entries.retain(|_, entry| {
                now.saturating_sub(entry.window_started_at_ms) < REQUEST_RATE_LIMIT_WINDOW_MS
            });
        }

        let entry = guard
            .entries
            .entry(account_key.to_string())
            .or_insert(RateLimitEntry {
                count: 0,
                window_started_at_ms: now,
            });
        if now.saturating_sub(entry.window_started_at_ms) >= REQUEST_RATE_LIMIT_WINDOW_MS {
            entry.count = 0;
            entry.window_started_at_ms = now;
        }
        entry.count = entry.count.saturating_add(1);
        limited = entry.count > REQUEST_RATE_LIMIT_MAX_REQUESTS;

        while guard.entries.len() > REQUEST_RATE_LIMIT_MAX_TRACKED_KEYS {
            let Some(oldest_key) = guard.entries.keys().next().cloned() else {
                break;
            };
            guard.entries.remove(&oldest_key);
        }
        tracked_keys = guard.entries.len();
    }

    update_rate_limit_tracked_keys_metrics(tracked_keys);
    limited
}

async fn run_runtime(app: AppHandle, state: AppState) -> Result<(), String> {
    let listener = TcpListener::bind((CHANNEL_HOST, 0))
        .await
        .map_err(|error| format!("CHANNEL_RUNTIME_BIND_FAILED: {error}"))?;
    let addr = listener
        .local_addr()
        .map_err(|error| format!("CHANNEL_RUNTIME_ADDR_FAILED: {error}"))?;

    let feishu_token = Uuid::new_v4().simple().to_string();
    let telegram_token = Uuid::new_v4().simple().to_string();
    let started_at_ms = now_ms();
    let base_url = format!("http://{}:{}", addr.ip(), addr.port());

    let snapshot = ChannelAdapterRuntimeSnapshot {
        running: true,
        host: addr.ip().to_string(),
        port: addr.port(),
        base_url: base_url.clone(),
        feishu_webhook: format!("{base_url}/webhook/feishu/{feishu_token}"),
        telegram_webhook: format!("{base_url}/webhook/telegram/{telegram_token}"),
        started_at_ms,
        metrics: ChannelAdapterRuntimeMetricsSnapshot::default(),
    };
    write_runtime_file(&snapshot)?;
    set_runtime_snapshot(snapshot.clone());

    info!(
        host = %snapshot.host,
        port = snapshot.port,
        "channel adapter runtime listening"
    );

    let ctx = RuntimeContext {
        app,
        state,
        feishu_token,
        telegram_token,
    };

    loop {
        let (stream, remote) = listener
            .accept()
            .await
            .map_err(|error| format!("CHANNEL_RUNTIME_ACCEPT_FAILED: {error}"))?;
        if !remote.ip().is_loopback() {
            debug!(remote = %remote, "rejected non-loopback webhook client");
            continue;
        }
        let ctx_clone = ctx.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_connection(stream, &ctx_clone).await {
                debug!(error = %error, "channel webhook client dropped");
            }
        });
    }
}

async fn handle_connection(mut stream: TcpStream, ctx: &RuntimeContext) -> Result<(), String> {
    with_runtime_metrics_mut(|metrics| {
        metrics.total_requests = metrics.total_requests.saturating_add(1);
    });

    let request = match timeout(
        Duration::from_millis(HTTP_REQUEST_TIMEOUT_MS),
        read_http_request(&mut stream),
    )
    .await
    {
        Ok(Ok(request)) => request,
        Ok(Err(error)) => {
            let status_code = status_for_http_read_error(&error);
            with_runtime_metrics_mut(|metrics| {
                metrics.invalid_requests = metrics.invalid_requests.saturating_add(1);
                mark_runtime_error(metrics, error.clone());
            });
            write_http_json(
                &mut stream,
                status_code,
                &json!({
                    "ok": false,
                    "error": "CHANNEL_HTTP_BAD_REQUEST",
                    "detail": error,
                }),
            )
            .await?;
            return Ok(());
        }
        Err(_) => {
            with_runtime_metrics_mut(|metrics| {
                metrics.timeouts = metrics.timeouts.saturating_add(1);
                mark_runtime_error(metrics, "CHANNEL_HTTP_READ_TIMEOUT".to_string());
            });
            write_http_json(
                &mut stream,
                408,
                &json!({
                    "ok": false,
                    "error": "CHANNEL_HTTP_READ_TIMEOUT",
                }),
            )
            .await?;
            return Ok(());
        }
    };
    let (status_code, payload) = route_request(ctx, request);
    write_http_json(&mut stream, status_code, &payload).await
}

fn route_request(ctx: &RuntimeContext, request: HttpRequest) -> (u16, Value) {
    let path = request
        .path
        .split('?')
        .next()
        .unwrap_or_default()
        .to_string();
    if request.method.eq_ignore_ascii_case("GET") && path == "/health" {
        with_runtime_metrics_mut(|metrics| {
            metrics.health_requests = metrics.health_requests.saturating_add(1);
        });
        if let Some(snapshot) = runtime_snapshot() {
            return (200, json!({ "ok": true, "runtime": snapshot }));
        }
        return (
            503,
            json!({ "ok": false, "error": "CHANNEL_RUNTIME_NOT_READY" }),
        );
    }

    if request.method.eq_ignore_ascii_case("POST") {
        with_runtime_metrics_mut(|metrics| {
            metrics.webhook_requests = metrics.webhook_requests.saturating_add(1);
        });
        if let Some(token) = path.strip_prefix("/webhook/feishu/") {
            if apply_rate_limit("feishu") {
                with_runtime_metrics_mut(|metrics| {
                    metrics.rate_limited = metrics.rate_limited.saturating_add(1);
                });
                return (
                    429,
                    json!({
                        "ok": false,
                        "error": "CHANNEL_RATE_LIMITED",
                    }),
                );
            }
            return handle_feishu_request(ctx, token, &request.headers, &request.body);
        }
        if let Some(token) = path.strip_prefix("/webhook/telegram/") {
            if apply_rate_limit("telegram") {
                with_runtime_metrics_mut(|metrics| {
                    metrics.rate_limited = metrics.rate_limited.saturating_add(1);
                });
                return (
                    429,
                    json!({
                        "ok": false,
                        "error": "CHANNEL_RATE_LIMITED",
                    }),
                );
            }
            return handle_telegram_request(ctx, token, &request.headers, &request.body);
        }
    }

    (
        404,
        json!({ "ok": false, "error": "CHANNEL_ROUTE_NOT_FOUND" }),
    )
}

fn handle_feishu_request(
    ctx: &RuntimeContext,
    token: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
) -> (u16, Value) {
    if token != ctx.feishu_token {
        with_runtime_metrics_mut(|metrics| {
            metrics.unauthorized = metrics.unauthorized.saturating_add(1);
        });
        return (
            401,
            json!({ "ok": false, "error": "CHANNEL_TOKEN_INVALID" }),
        );
    }
    if !is_json_content_type(headers.get("content-type").map(String::as_str)) {
        with_runtime_metrics_mut(|metrics| {
            metrics.invalid_requests = metrics.invalid_requests.saturating_add(1);
        });
        return (
            415,
            json!({
                "ok": false,
                "error": "CHANNEL_FEISHU_CONTENT_TYPE_INVALID",
            }),
        );
    }
    let payload: Value = match serde_json::from_slice(body) {
        Ok(payload) => payload,
        Err(error) => {
            with_runtime_metrics_mut(|metrics| {
                metrics.invalid_requests = metrics.invalid_requests.saturating_add(1);
                mark_runtime_error(metrics, format!("CHANNEL_FEISHU_INVALID_JSON: {}", error));
            });
            return (
                400,
                json!({
                    "ok": false,
                    "error": "CHANNEL_FEISHU_INVALID_JSON",
                    "detail": error.to_string(),
                }),
            );
        }
    };

    let parsed = match feishu::parse_webhook_payload(&payload) {
        Ok(parsed) => parsed,
        Err(error) => {
            with_runtime_metrics_mut(|metrics| {
                metrics.invalid_requests = metrics.invalid_requests.saturating_add(1);
                mark_runtime_error(
                    metrics,
                    format!("CHANNEL_FEISHU_INVALID_PAYLOAD: {}", error),
                );
            });
            return (
                400,
                json!({
                    "ok": false,
                    "error": "CHANNEL_FEISHU_INVALID_PAYLOAD",
                    "detail": error,
                }),
            );
        }
    };
    if let Some(challenge) = parsed.challenge {
        return (200, json!({ "challenge": challenge }));
    }
    let Some(inbound) = parsed.message else {
        return (
            202,
            json!({
                "ok": true,
                "accepted": false,
                "detail": "CHANNEL_FEISHU_EVENT_IGNORED",
            }),
        );
    };
    dispatch_inbound(ctx, inbound)
}

fn handle_telegram_request(
    ctx: &RuntimeContext,
    token: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
) -> (u16, Value) {
    if token != ctx.telegram_token {
        with_runtime_metrics_mut(|metrics| {
            metrics.unauthorized = metrics.unauthorized.saturating_add(1);
        });
        return (
            401,
            json!({ "ok": false, "error": "CHANNEL_TOKEN_INVALID" }),
        );
    }
    if !is_json_content_type(headers.get("content-type").map(String::as_str)) {
        with_runtime_metrics_mut(|metrics| {
            metrics.invalid_requests = metrics.invalid_requests.saturating_add(1);
        });
        return (
            415,
            json!({
                "ok": false,
                "error": "CHANNEL_TELEGRAM_CONTENT_TYPE_INVALID",
            }),
        );
    }
    let payload: Value = match serde_json::from_slice(body) {
        Ok(payload) => payload,
        Err(error) => {
            with_runtime_metrics_mut(|metrics| {
                metrics.invalid_requests = metrics.invalid_requests.saturating_add(1);
                mark_runtime_error(metrics, format!("CHANNEL_TELEGRAM_INVALID_JSON: {}", error));
            });
            return (
                400,
                json!({
                    "ok": false,
                    "error": "CHANNEL_TELEGRAM_INVALID_JSON",
                    "detail": error.to_string(),
                }),
            );
        }
    };
    let inbound = match parse_telegram_payload(&payload) {
        Ok(message) => message,
        Err(error) => {
            with_runtime_metrics_mut(|metrics| {
                metrics.invalid_requests = metrics.invalid_requests.saturating_add(1);
                mark_runtime_error(
                    metrics,
                    format!("CHANNEL_TELEGRAM_INVALID_PAYLOAD: {}", error),
                );
            });
            return (
                400,
                json!({
                    "ok": false,
                    "error": "CHANNEL_TELEGRAM_INVALID_PAYLOAD",
                    "detail": error,
                }),
            );
        }
    };
    dispatch_inbound(ctx, inbound)
}

fn dispatch_inbound(ctx: &RuntimeContext, inbound: ExternalInboundMessage) -> (u16, Value) {
    let callback_query_id = json_to_string(
        inbound
            .metadata
            .get("callback_query")
            .and_then(|value| value.get("id")),
    );
    let callback_account_id = inbound.account_id.clone();
    let result = process_external_inbound_message(&ctx.state, &ctx.app, inbound);
    if let Some(callback_query_id) = callback_query_id {
        let app = ctx.app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = telegram::answer_callback_query(
                &app,
                Some(&callback_account_id),
                &callback_query_id,
                None,
            )
            .await;
        });
    }
    match result {
        Ok(response) => {
            let status = match response.status {
                ExternalInboundStatus::Failed => 500,
                _ => 200,
            };
            with_runtime_metrics_mut(|metrics| match response.status {
                ExternalInboundStatus::Dispatched => {
                    metrics.dispatched = metrics.dispatched.saturating_add(1)
                }
                ExternalInboundStatus::Duplicate => {
                    metrics.duplicate = metrics.duplicate.saturating_add(1)
                }
                ExternalInboundStatus::PairingRequired => {
                    metrics.pairing_required = metrics.pairing_required.saturating_add(1)
                }
                ExternalInboundStatus::Denied => metrics.denied = metrics.denied.saturating_add(1),
                ExternalInboundStatus::RouteNotFound => {
                    metrics.route_not_found = metrics.route_not_found.saturating_add(1)
                }
                ExternalInboundStatus::Failed => {
                    metrics.failed = metrics.failed.saturating_add(1);
                    metrics.internal_errors = metrics.internal_errors.saturating_add(1);
                    mark_runtime_error(
                        metrics,
                        response
                            .detail
                            .clone()
                            .unwrap_or_else(|| "CHANNEL_DISPATCH_FAILED".to_string()),
                    );
                }
            });
            (status, json!(response))
        }
        Err(error) => {
            with_runtime_metrics_mut(|metrics| {
                metrics.failed = metrics.failed.saturating_add(1);
                metrics.internal_errors = metrics.internal_errors.saturating_add(1);
                mark_runtime_error(metrics, error.clone());
            });
            (
                500,
                json!({
                    "ok": false,
                    "error": "CHANNEL_INTERNAL_ERROR",
                    "detail": error,
                }),
            )
        }
    }
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut temp = [0u8; 4096];
    let mut header_end = None;

    while header_end.is_none() {
        let read = stream
            .read(&mut temp)
            .await
            .map_err(|error| format!("CHANNEL_HTTP_READ_FAILED: {error}"))?;
        if read == 0 {
            return Err("CHANNEL_HTTP_EOF".to_string());
        }
        buffer.extend_from_slice(&temp[..read]);
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("CHANNEL_HTTP_HEADER_TOO_LARGE".to_string());
        }
        header_end = find_header_end(&buffer);
    }

    let header_end = header_end.ok_or_else(|| "CHANNEL_HTTP_HEADER_INVALID".to_string())?;
    let header_bytes = &buffer[..header_end];
    let header_text = std::str::from_utf8(header_bytes)
        .map_err(|error| format!("CHANNEL_HTTP_HEADER_UTF8_INVALID: {error}"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "CHANNEL_HTTP_REQUEST_LINE_MISSING".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "CHANNEL_HTTP_METHOD_MISSING".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "CHANNEL_HTTP_PATH_MISSING".to_string())?
        .to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let expected_body = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if expected_body > MAX_BODY_BYTES {
        return Err("CHANNEL_HTTP_BODY_TOO_LARGE".to_string());
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < expected_body {
        let read = stream
            .read(&mut temp)
            .await
            .map_err(|error| format!("CHANNEL_HTTP_BODY_READ_FAILED: {error}"))?;
        if read == 0 {
            return Err("CHANNEL_HTTP_BODY_EOF".to_string());
        }
        body.extend_from_slice(&temp[..read]);
        if body.len() > MAX_BODY_BYTES {
            return Err("CHANNEL_HTTP_BODY_TOO_LARGE".to_string());
        }
    }
    body.truncate(expected_body);

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

async fn write_http_json(
    stream: &mut TcpStream,
    status_code: u16,
    body: &Value,
) -> Result<(), String> {
    let payload =
        serde_json::to_vec(body).map_err(|error| format!("CHANNEL_HTTP_ENCODE_FAILED: {error}"))?;
    let status_text = match status_code {
        200 => "OK",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        429 => "Too Many Requests",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {status_code} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(header.as_bytes())
        .await
        .map_err(|error| format!("CHANNEL_HTTP_WRITE_FAILED: {error}"))?;
    stream
        .write_all(&payload)
        .await
        .map_err(|error| format!("CHANNEL_HTTP_WRITE_FAILED: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("CHANNEL_HTTP_FLUSH_FAILED: {error}"))
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|pos| pos + 4)
}

fn is_json_content_type(value: Option<&str>) -> bool {
    let Some(raw) = value else {
        return true;
    };
    let media_type = raw
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    media_type == "application/json" || media_type.ends_with("+json")
}

fn parse_telegram_payload(payload: &Value) -> Result<ExternalInboundMessage, String> {
    if let Some(callback) = payload.get("callback_query") {
        let message = callback
            .get("message")
            .ok_or_else(|| "missing callback_query.message".to_string())?;
        let chat = message
            .get("chat")
            .ok_or_else(|| "missing callback_query.message.chat".to_string())?;

        let peer_id =
            json_to_string(chat.get("id")).ok_or_else(|| "missing chat.id".to_string())?;
        let chat_type = json_to_string(chat.get("type")).unwrap_or_else(|| "private".to_string());
        let peer_kind = if chat_type.eq_ignore_ascii_case("group")
            || chat_type.eq_ignore_ascii_case("supergroup")
            || chat_type.eq_ignore_ascii_case("channel")
        {
            ExternalPeerKind::Group
        } else {
            ExternalPeerKind::Direct
        };

        let sender = callback
            .get("from")
            .ok_or_else(|| "missing callback_query.from".to_string())?;
        let sender_id = json_to_string(sender.get("id")).unwrap_or_else(|| peer_id.clone());
        let sender_name = derive_telegram_sender_name(sender);
        let callback_id = json_to_string(callback.get("id")).unwrap_or_else(|| {
            format!(
                "callback-update-{}",
                json_to_string(payload.get("update_id")).unwrap_or_else(|| "0".to_string())
            )
        });
        let data = json_to_string(callback.get("data"))
            .unwrap_or_else(|| "[telegram callback without data]".to_string());
        let text = data
            .strip_prefix("gto:")
            .map(str::to_string)
            .unwrap_or(data);

        return Ok(ExternalInboundMessage {
            channel: "telegram".to_string(),
            account_id: "default".to_string(),
            peer_kind,
            peer_id,
            sender_id,
            sender_name,
            message_id: format!("callback-{callback_id}"),
            text,
            idempotency_key: Some(format!("telegram-callback-{callback_id}")),
            workspace_id_hint: None,
            target_agent_id_hint: None,
            metadata: payload.clone(),
        });
    }

    let message = payload
        .get("message")
        .or_else(|| payload.get("edited_message"))
        .or_else(|| payload.get("channel_post"))
        .ok_or_else(|| "missing message/edited_message/channel_post/callback_query".to_string())?;
    let chat = message
        .get("chat")
        .ok_or_else(|| "missing message.chat".to_string())?;

    let peer_id = json_to_string(chat.get("id")).ok_or_else(|| "missing chat.id".to_string())?;
    let chat_type = json_to_string(chat.get("type")).unwrap_or_else(|| "private".to_string());
    let peer_kind = if chat_type.eq_ignore_ascii_case("group")
        || chat_type.eq_ignore_ascii_case("supergroup")
        || chat_type.eq_ignore_ascii_case("channel")
    {
        ExternalPeerKind::Group
    } else {
        ExternalPeerKind::Direct
    };

    let sender = message.get("from");
    let sender_id = sender
        .and_then(|value| json_to_string(value.get("id")))
        .unwrap_or_else(|| peer_id.clone());
    let sender_name = sender.and_then(derive_telegram_sender_name);
    let message_id = json_to_string(message.get("message_id")).unwrap_or_else(|| {
        format!(
            "update-{}",
            json_to_string(payload.get("update_id")).unwrap_or_else(|| "0".to_string())
        )
    });
    let text = first_non_empty([
        json_to_string(message.get("text")).as_deref(),
        json_to_string(message.get("caption")).as_deref(),
    ])
    .unwrap_or_else(|| "[telegram non-text message]".to_string());

    Ok(ExternalInboundMessage {
        channel: "telegram".to_string(),
        account_id: "default".to_string(),
        peer_kind,
        peer_id,
        sender_id,
        sender_name,
        message_id,
        text,
        idempotency_key: None,
        workspace_id_hint: None,
        target_agent_id_hint: None,
        metadata: payload.clone(),
    })
}

fn derive_telegram_sender_name(from: &Value) -> Option<String> {
    if let Some(username) = from.get("username").and_then(Value::as_str) {
        let trimmed = username.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let first = from
        .get("first_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let last = from
        .get("last_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let full = format!("{first} {last}").trim().to_string();
    if full.is_empty() {
        None
    } else {
        Some(full)
    }
}

fn json_to_string(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(raw) = value.as_str() {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(raw) = value.as_i64() {
        return Some(raw.to_string());
    }
    if let Some(raw) = value.as_u64() {
        return Some(raw.to_string());
    }
    None
}

fn first_non_empty<'a, I>(values: I) -> Option<String>
where
    I: IntoIterator<Item = Option<&'a str>>,
{
    for value in values {
        if let Some(candidate) = value.map(str::trim).filter(|item| !item.is_empty()) {
            return Some(candidate.to_string());
        }
    }
    None
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn write_runtime_file(snapshot: &ChannelAdapterRuntimeSnapshot) -> Result<(), String> {
    let runtime = ChannelRuntimeFile {
        version: CHANNEL_RUNTIME_VERSION.to_string(),
        host: snapshot.host.clone(),
        port: snapshot.port,
        base_url: snapshot.base_url.clone(),
        feishu_webhook: snapshot.feishu_webhook.clone(),
        telegram_webhook: snapshot.telegram_webhook.clone(),
        started_at_ms: snapshot.started_at_ms,
    };
    let path = runtime_file_path();
    let parent = path
        .parent()
        .ok_or_else(|| "CHANNEL_RUNTIME_PATH_INVALID".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("CHANNEL_RUNTIME_WRITE_FAILED: {error}"))?;
    let payload = serde_json::to_vec_pretty(&runtime)
        .map_err(|error| format!("CHANNEL_RUNTIME_ENCODE_FAILED: {error}"))?;
    fs::write(&path, payload).map_err(|error| format!("CHANNEL_RUNTIME_WRITE_FAILED: {error}"))
}

fn runtime_file_path() -> PathBuf {
    if let Ok(value) = env::var("GTO_CHANNEL_RUNTIME_FILE") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Some(home) = user_home_dir() {
        return home.join(".gtoffice/channel/runtime.json");
    }
    env::temp_dir().join("gtoffice/channel/runtime.json")
}

fn user_home_dir() -> Option<PathBuf> {
    if let Ok(home) = env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    if let Ok(home) = env::var("USERPROFILE") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

#[cfg(test)]
#[path = "tests/channel_adapter_runtime_tests.rs"]
mod tests;
