use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use std::process::Command;

#[derive(Debug, Deserialize)]
struct TelegramApiEnvelope<T> {
    ok: bool,
    result: Option<T>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug)]
pub(super) struct TelegramGetMeResponse {
    pub ok: bool,
    pub username: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug)]
pub(super) struct TelegramWebhookInfoResponse {
    pub ok: bool,
    pub url: Option<String>,
    pub last_error_message: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug)]
pub(super) struct TelegramUpdatesResponse {
    pub ok: bool,
    pub items: Option<Vec<Value>>,
    pub description: Option<String>,
}

#[derive(Debug)]
pub(super) struct TelegramSendResult {
    pub message_id: String,
    pub peer_id: String,
}

#[derive(Debug)]
pub(super) struct TelegramEditResult {
    pub message_id: String,
    pub peer_id: String,
}

#[derive(Debug, Deserialize)]
struct TelegramGetMeResult {
    #[serde(default)]
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramWebhookInfoResult {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    last_error_message: Option<String>,
}

fn api_base_url(token: &str) -> String {
    format!("https://api.telegram.org/bot{}", token.trim())
}

/// Convert a peer_id string to the correct JSON type for chat_id.
/// Telegram's JSON API requires numeric IDs as JSON integers;
/// channel usernames (e.g. "@channelusername") remain as strings.
fn parse_chat_id(peer_id: &str) -> serde_json::Value {
    if let Ok(numeric_id) = peer_id.parse::<i64>() {
        serde_json::json!(numeric_id)
    } else {
        serde_json::json!(peer_id)
    }
}

#[cfg(target_os = "windows")]
fn looks_like_windows_schannel_error(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("schannel")
        || lower.contains("ssl/tls connection failed")
        || lower.contains("failed to receive handshake")
}

fn run_curl_json(args: &[&str]) -> Result<Value, String> {
    let output = Command::new("curl")
        .args(args)
        .output()
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    if !output.status.success() {
        let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();
        #[cfg(target_os = "windows")]
        if looks_like_windows_schannel_error(&stderr_text) {
            let mut retry_args = vec!["-4", "--http1.1", "--ssl-no-revoke"];
            retry_args.extend_from_slice(args);
            let retry_output = Command::new("curl")
                .args(retry_args)
                .output()
                .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
            if retry_output.status.success() {
                return serde_json::from_slice::<Value>(&retry_output.stdout).map_err(|error| {
                    format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}")
                });
            }
            return Err(format!(
                "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {}",
                String::from_utf8_lossy(&retry_output.stderr)
            ));
        }
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {}",
            stderr_text
        ));
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))
}

fn parse_envelope<T: DeserializeOwned>(payload: Value) -> Result<TelegramApiEnvelope<T>, String> {
    serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))
}

pub(super) fn json_to_string(value: Option<&Value>) -> Option<String> {
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

pub(super) fn telegram_get_me(token: &str) -> Result<TelegramGetMeResponse, String> {
    let endpoint = format!("{}/getMe", api_base_url(token));
    let payload = run_curl_json(&["-sS", "--max-time", "8", endpoint.as_str()])?;
    let envelope: TelegramApiEnvelope<TelegramGetMeResult> = parse_envelope(payload)?;
    Ok(TelegramGetMeResponse {
        ok: envelope.ok,
        username: envelope.result.and_then(|result| result.username),
        description: envelope.description,
    })
}

pub(super) fn telegram_get_webhook_info(
    token: &str,
) -> Result<TelegramWebhookInfoResponse, String> {
    let endpoint = format!("{}/getWebhookInfo", api_base_url(token));
    let payload = run_curl_json(&["-sS", "--max-time", "8", endpoint.as_str()])?;
    let envelope: TelegramApiEnvelope<TelegramWebhookInfoResult> = parse_envelope(payload)?;
    let (url, last_error_message) = if let Some(result) = envelope.result {
        (result.url, result.last_error_message)
    } else {
        (None, None)
    };
    Ok(TelegramWebhookInfoResponse {
        ok: envelope.ok,
        url,
        last_error_message,
        description: envelope.description,
    })
}

pub(super) fn telegram_set_webhook(
    token: &str,
    url: &str,
    secret: Option<&str>,
) -> Result<(), String> {
    let endpoint = format!("{}/setWebhook", api_base_url(token));
    let mut args = vec![
        "-sS",
        "--max-time",
        "8",
        "-X",
        "POST",
        endpoint.as_str(),
        "-d",
    ];
    let url_form = format!("url={}", url);
    args.push(url_form.as_str());

    let secret_form = secret
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("secret_token={value}"));
    if let Some(secret_form) = secret_form.as_deref() {
        args.push("-d");
        args.push(secret_form);
    }

    let payload = run_curl_json(&args)?;
    let response: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !response.ok {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            response
                .description
                .unwrap_or_else(|| "telegram setWebhook failed".to_string())
        ));
    }
    Ok(())
}

pub(super) fn telegram_delete_webhook(token: &str) -> Result<(), String> {
    let endpoint = format!("{}/deleteWebhook", api_base_url(token));
    let payload = run_curl_json(&[
        "-sS",
        "--max-time",
        "8",
        "-X",
        "POST",
        endpoint.as_str(),
        "-d",
        "drop_pending_updates=false",
    ])?;
    let response: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !response.ok {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            response
                .description
                .unwrap_or_else(|| "telegram deleteWebhook failed".to_string())
        ));
    }
    Ok(())
}

pub(super) fn telegram_get_updates(
    token: &str,
    offset: Option<i64>,
) -> Result<TelegramUpdatesResponse, String> {
    let endpoint = format!("{}/getUpdates", api_base_url(token));
    let timeout_form = "timeout=20".to_string();
    let mut args = vec![
        "-sS",
        "--max-time",
        "30",
        "-X",
        "POST",
        endpoint.as_str(),
        "-d",
        timeout_form.as_str(),
    ];
    let offset_form = offset.map(|value| format!("offset={value}"));
    if let Some(offset_form) = offset_form.as_deref() {
        args.push("-d");
        args.push(offset_form);
    }
    let payload = run_curl_json(&args)?;
    let response: TelegramApiEnvelope<Vec<Value>> = parse_envelope(payload)?;
    Ok(TelegramUpdatesResponse {
        ok: response.ok,
        items: response.result,
        description: response.description,
    })
}

/// Send a chat action (e.g. "typing") to indicate the bot is processing.
///
/// This is a fire-and-forget API call — errors are non-fatal and should be
/// handled gracefully by callers. The typing indicator automatically expires
/// after ~5 seconds or when a message is sent.
pub(super) fn telegram_send_chat_action(
    token: &str,
    peer_id: &str,
    action: &str,
) -> Result<(), String> {
    let endpoint = format!("{}/sendChatAction", api_base_url(token));
    let body = serde_json::json!({
        "chat_id": parse_chat_id(peer_id),
        "action": action,
    });
    let body_str = serde_json::to_string(&body)
        .map_err(|error| format!("CHANNEL_CONNECTOR_ENCODE_FAILED: {error}"))?;

    let args = vec![
        "-sS",
        "--max-time",
        "5",
        "-X",
        "POST",
        endpoint.as_str(),
        "-H",
        "Content-Type: application/json",
        "-d",
        body_str.as_str(),
    ];

    let _ = run_curl_json(&args)?;
    Ok(())
}

pub(super) fn telegram_send_message(
    token: &str,
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<TelegramSendResult, String> {
    let endpoint = format!("{}/sendMessage", api_base_url(token));
    let mut body = serde_json::json!({
        "chat_id": parse_chat_id(peer_id),
        "text": text,
    });
    if let Some(reply_id) = reply_to_message_id
        .map(str::trim)
        .filter(|value| value.parse::<i64>().is_ok())
    {
        body["reply_to_message_id"] = serde_json::json!(reply_id.parse::<i64>().unwrap_or(0));
    }
    let body_str = serde_json::to_string(&body)
        .map_err(|error| format!("CHANNEL_CONNECTOR_ENCODE_FAILED: {error}"))?;

    let args = vec![
        "-sS",
        "--max-time",
        "15",
        "-X",
        "POST",
        endpoint.as_str(),
        "-H",
        "Content-Type: application/json",
        "-d",
        body_str.as_str(),
    ];

    let payload = run_curl_json(&args)?;
    let response: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !response.ok {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {}",
            response
                .description
                .unwrap_or_else(|| "telegram sendMessage failed".to_string())
        ));
    }
    let result = response.result.ok_or_else(|| {
        "CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: telegram result missing".to_string()
    })?;
    let message_id =
        json_to_string(result.get("message_id")).unwrap_or_else(|| "unknown".to_string());
    let delivered_peer = result
        .get("chat")
        .and_then(|chat| json_to_string(chat.get("id")))
        .unwrap_or_else(|| peer_id.to_string());
    Ok(TelegramSendResult {
        message_id,
        peer_id: delivered_peer,
    })
}

fn is_message_not_modified(description: Option<&str>) -> bool {
    description
        .map(|text| {
            text.to_ascii_lowercase()
                .contains("message is not modified")
        })
        .unwrap_or(false)
}

pub(super) fn telegram_edit_message(
    token: &str,
    peer_id: &str,
    message_id: &str,
    text: &str,
) -> Result<TelegramEditResult, String> {
    let endpoint = format!("{}/editMessageText", api_base_url(token));
    let body = serde_json::json!({
        "chat_id": parse_chat_id(peer_id),
        "message_id": message_id.parse::<i64>().unwrap_or(0),
        "text": text,
    });
    let body_str = serde_json::to_string(&body)
        .map_err(|error| format!("CHANNEL_CONNECTOR_ENCODE_FAILED: {error}"))?;

    let args = vec![
        "-sS",
        "--max-time",
        "15",
        "-X",
        "POST",
        endpoint.as_str(),
        "-H",
        "Content-Type: application/json",
        "-d",
        body_str.as_str(),
    ];

    let payload = run_curl_json(&args)?;
    let response: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !response.ok {
        if is_message_not_modified(response.description.as_deref()) {
            return Ok(TelegramEditResult {
                message_id: message_id.to_string(),
                peer_id: peer_id.to_string(),
            });
        }
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {}",
            response
                .description
                .unwrap_or_else(|| "telegram editMessageText failed".to_string())
        ));
    }
    let result = response.result.ok_or_else(|| {
        "CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: telegram edit result missing".to_string()
    })?;
    let resolved_message_id =
        json_to_string(result.get("message_id")).unwrap_or_else(|| message_id.to_string());
    let delivered_peer = result
        .get("chat")
        .and_then(|chat| json_to_string(chat.get("id")))
        .unwrap_or_else(|| peer_id.to_string());
    Ok(TelegramEditResult {
        message_id: resolved_message_id,
        peer_id: delivered_peer,
    })
}
