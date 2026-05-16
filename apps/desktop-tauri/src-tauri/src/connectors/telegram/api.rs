use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use std::sync::OnceLock;

use crate::connectors::http_client::{HttpClient, HttpRequest};

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

#[derive(Debug)]
pub(super) struct TelegramDeleteResult {
    pub ok: bool,
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

static HTTP_CLIENT: OnceLock<HttpClient> = OnceLock::new();

fn http_client() -> &'static HttpClient {
    HTTP_CLIENT.get_or_init(HttpClient::new)
}

/// Convert a peer_id string to the correct JSON type for chat_id.
/// Telegram's JSON API requires numeric IDs as JSON integers;
/// channel usernames (e.g. "@channelusername") remain as strings.
fn parse_chat_id(peer_id: &str) -> serde_json::Value {
    let peer_id = peer_id.trim();
    if let Ok(numeric_id) = peer_id.parse::<i64>() {
        serde_json::json!(numeric_id)
    } else {
        serde_json::json!(peer_id)
    }
}

fn parse_required_message_id(message_id: &str) -> Result<i64, String> {
    message_id
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric".to_string())
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

pub(super) async fn telegram_get_me(token: &str) -> Result<TelegramGetMeResponse, String> {
    let endpoint = format!("{}/getMe", api_base_url(token));
    let response = http_client()
        .execute(HttpRequest::get(&endpoint).timeout_secs(8).build())
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: getMe HTTP {}",
            telegram_provider_error_prefix(&response.text()),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_get_me_response(payload)
}

fn parse_get_me_response(payload: Value) -> Result<TelegramGetMeResponse, String> {
    let envelope: TelegramApiEnvelope<TelegramGetMeResult> = parse_envelope(payload)?;
    Ok(TelegramGetMeResponse {
        ok: envelope.ok,
        username: envelope.result.and_then(|result| result.username),
        description: envelope.description,
    })
}

pub(super) async fn telegram_get_webhook_info(
    token: &str,
) -> Result<TelegramWebhookInfoResponse, String> {
    let endpoint = format!("{}/getWebhookInfo", api_base_url(token));
    let response = http_client()
        .execute(HttpRequest::get(&endpoint).timeout_secs(8).build())
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: getWebhookInfo HTTP {}",
            telegram_provider_error_prefix(&response.text()),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_webhook_info_response(payload)
}

fn parse_webhook_info_response(payload: Value) -> Result<TelegramWebhookInfoResponse, String> {
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

pub(super) async fn telegram_set_webhook(
    token: &str,
    url: &str,
    secret: Option<&str>,
) -> Result<(), String> {
    let endpoint = format!("{}/setWebhook", api_base_url(token));
    let body = set_webhook_body(url, secret);
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .json_body(&body)
                .timeout_secs(8)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            provider_description(Some(response.text()), "telegram setWebhook failed")
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    let envelope: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !envelope.ok {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            provider_description(envelope.description, "telegram setWebhook failed")
        ));
    }
    Ok(())
}

fn set_webhook_body(url: &str, secret: Option<&str>) -> Value {
    let mut body = serde_json::json!({
        "url": url.trim(),
    });
    if let Some(secret) = secret.map(str::trim).filter(|value| !value.is_empty()) {
        body["secret_token"] = serde_json::json!(secret);
    }
    body
}

pub(super) async fn telegram_delete_webhook(token: &str) -> Result<(), String> {
    let endpoint = format!("{}/deleteWebhook", api_base_url(token));
    let fields = vec![("drop_pending_updates".to_string(), "false".to_string())];
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .form_body(&fields)
                .timeout_secs(8)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            provider_description(Some(response.text()), "telegram deleteWebhook failed")
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    let envelope: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !envelope.ok {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            provider_description(envelope.description, "telegram deleteWebhook failed")
        ));
    }
    Ok(())
}

pub(super) async fn telegram_get_updates(
    token: &str,
    offset: Option<i64>,
) -> Result<TelegramUpdatesResponse, String> {
    let endpoint = format!("{}/getUpdates", api_base_url(token));
    let form_fields = get_updates_form_fields(offset);
    let fields: Vec<(String, String)> = form_fields
        .into_iter()
        .map(|s| {
            let parts: Vec<&str> = s.splitn(2, '=').collect();
            (
                parts[0].to_string(),
                parts.get(1).unwrap_or(&"").to_string(),
            )
        })
        .collect();
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .form_body(&fields)
                .timeout_secs(30)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: getUpdates HTTP {}",
            telegram_provider_error_prefix(&response.text()),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_updates_response(payload)
}

fn parse_updates_response(payload: Value) -> Result<TelegramUpdatesResponse, String> {
    let response: TelegramApiEnvelope<Vec<Value>> = parse_envelope(payload)?;
    Ok(TelegramUpdatesResponse {
        ok: response.ok,
        items: response.result,
        description: response.description,
    })
}

fn get_updates_form_fields(offset: Option<i64>) -> Vec<String> {
    let mut fields = vec!["timeout=20".to_string()];
    if let Some(offset) = offset.filter(|value| *value >= 0) {
        fields.push(format!("offset={offset}"));
    }
    fields
}

/// Send a chat action (e.g. "typing") to indicate the bot is processing.
///
/// This is a fire-and-forget API call — errors are non-fatal and should be
/// handled gracefully by callers. The typing indicator automatically expires
/// after ~5 seconds or when a message is sent.
pub(super) async fn telegram_send_chat_action(
    token: &str,
    peer_id: &str,
    action: &str,
) -> Result<(), String> {
    let endpoint = format!("{}/sendChatAction", api_base_url(token));
    let body = chat_action_body(peer_id, action);
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .json_body(&body)
                .timeout_secs(8)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    // Fire-and-forget: we don't check is_success() to stay consistent with original behavior
    let _payload = response.json_value().map_err(|e| e.to_string())?;
    Ok(())
}

fn chat_action_body(peer_id: &str, action: &str) -> Value {
    serde_json::json!({
        "chat_id": parse_chat_id(peer_id),
        "action": action,
    })
}

pub(super) async fn telegram_send_message(
    token: &str,
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
    reply_markup: Option<Value>,
) -> Result<TelegramSendResult, String> {
    let endpoint = format!("{}/sendMessage", api_base_url(token));
    let body = send_message_body(peer_id, text, reply_to_message_id, reply_markup);
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .json_body(&body)
                .timeout_secs(25)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: sendMessage HTTP {}",
            telegram_provider_error_prefix(&response.text()),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_send_message_response(payload, peer_id)
}

fn send_message_body(
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
    reply_markup: Option<Value>,
) -> Value {
    let mut body = serde_json::json!({
        "chat_id": parse_chat_id(peer_id),
        "text": text,
    });
    if let Some(reply_id) = reply_to_message_id
        .map(str::trim)
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
    {
        body["reply_to_message_id"] = serde_json::json!(reply_id);
    }
    if let Some(reply_markup) = reply_markup {
        body["reply_markup"] = reply_markup;
    }
    body
}

fn parse_send_message_response(
    payload: Value,
    peer_id: &str,
) -> Result<TelegramSendResult, String> {
    let response: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !response.ok {
        return Err(telegram_provider_error(provider_description(
            response.description,
            "telegram sendMessage failed",
        )));
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

fn telegram_provider_error(description: String) -> String {
    format!(
        "{}: {description}",
        telegram_provider_error_prefix(&description)
    )
}

fn provider_description(description: Option<String>, default: &str) -> String {
    description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| default.to_string())
}

fn telegram_provider_error_prefix(description: &str) -> &'static str {
    let lower = description.to_ascii_lowercase();
    let permission_or_peer_error = [
        "bot was blocked",
        "chat not found",
        "user is deactivated",
        "bot is not a member",
        "not enough rights",
        "have no rights",
        "bot was kicked",
        "forbidden",
    ]
    .iter()
    .any(|needle| lower.contains(needle));
    if permission_or_peer_error {
        "CHANNEL_CONNECTOR_PERMISSION_DENIED"
    } else {
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE"
    }
}

pub(super) async fn telegram_edit_message(
    token: &str,
    peer_id: &str,
    message_id: &str,
    text: &str,
    reply_markup: Option<Value>,
) -> Result<TelegramEditResult, String> {
    let endpoint = format!("{}/editMessageText", api_base_url(token));
    let message_id_value = parse_required_message_id(message_id)?;
    let body = edit_message_body(peer_id, message_id_value, text, reply_markup);
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .json_body(&body)
                .timeout_secs(25)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: editMessageText HTTP {}",
            telegram_provider_error_prefix(&response.text()),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_edit_message_response(payload, peer_id, message_id)
}

fn edit_message_body(
    peer_id: &str,
    message_id: i64,
    text: &str,
    reply_markup: Option<Value>,
) -> Value {
    let mut body = serde_json::json!({
        "chat_id": parse_chat_id(peer_id),
        "message_id": message_id,
        "text": text,
    });
    if let Some(reply_markup) = reply_markup {
        body["reply_markup"] = reply_markup;
    }
    body
}

fn parse_edit_message_response(
    payload: Value,
    peer_id: &str,
    message_id: &str,
) -> Result<TelegramEditResult, String> {
    let response: TelegramApiEnvelope<Value> = parse_envelope(payload)?;
    if !response.ok {
        if is_message_not_modified(response.description.as_deref()) {
            return Ok(TelegramEditResult {
                message_id: message_id.to_string(),
                peer_id: peer_id.to_string(),
            });
        }
        return Err(telegram_provider_error(provider_description(
            response.description,
            "telegram editMessageText failed",
        )));
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

pub(super) async fn telegram_delete_message(
    token: &str,
    peer_id: &str,
    message_id: &str,
) -> Result<TelegramDeleteResult, String> {
    let endpoint = format!("{}/deleteMessage", api_base_url(token));
    let message_id_value = parse_required_message_id(message_id)?;
    let body = delete_message_body(peer_id, message_id_value);
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .json_body(&body)
                .timeout_secs(8)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: deleteMessage HTTP {}",
            telegram_provider_error_prefix(&response.text()),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_delete_message_response(payload)
}

fn delete_message_body(peer_id: &str, message_id: i64) -> Value {
    serde_json::json!({
        "chat_id": parse_chat_id(peer_id),
        "message_id": message_id,
    })
}

fn parse_delete_message_response(payload: Value) -> Result<TelegramDeleteResult, String> {
    let response: TelegramApiEnvelope<bool> = parse_envelope(payload)?;
    if !response.ok {
        return Err(telegram_provider_error(provider_description(
            response.description,
            "telegram deleteMessage failed",
        )));
    }
    Ok(TelegramDeleteResult {
        ok: response.result.unwrap_or(true),
    })
}

pub(super) async fn telegram_answer_callback_query(
    token: &str,
    callback_query_id: &str,
    text: Option<&str>,
) -> Result<(), String> {
    let endpoint = format!("{}/answerCallbackQuery", api_base_url(token));
    let body = answer_callback_query_body(callback_query_id, text);
    let response = http_client()
        .execute(
            HttpRequest::post(&endpoint)
                .json_body(&body)
                .timeout_secs(8)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: answerCallbackQuery HTTP {}",
            telegram_provider_error_prefix(&response.text()),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_answer_callback_query_response(payload)
}

fn answer_callback_query_body(callback_query_id: &str, text: Option<&str>) -> Value {
    let mut body = serde_json::json!({
        "callback_query_id": callback_query_id,
    });
    if let Some(text) = text.map(str::trim).filter(|value| !value.is_empty()) {
        body["text"] = serde_json::json!(text);
    }
    body
}

fn parse_answer_callback_query_response(payload: Value) -> Result<(), String> {
    let response: TelegramApiEnvelope<bool> = parse_envelope(payload)?;
    if !response.ok {
        return Err(telegram_provider_error(provider_description(
            response.description,
            "telegram answerCallbackQuery failed",
        )));
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/api_tests.rs"]
mod tests;
