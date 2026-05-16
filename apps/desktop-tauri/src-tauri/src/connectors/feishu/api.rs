use feishu_sdk::{
    core::{Config, FEISHU_BASE_URL, LARK_BASE_URL},
    Client,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::connectors::http_client::{HttpClient, HttpRequest};

use super::send_policy;
use super::types::FeishuDomain;

#[derive(Debug, Clone)]
pub struct FeishuBotInfo {
    pub bot_name: Option<String>,
    pub bot_open_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TenantAccessTokenResponse {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    tenant_access_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BotInfoEnvelope {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    bot: Option<BotInfoPayload>,
}

#[derive(Debug, Deserialize)]
struct BotInfoPayload {
    #[serde(default)]
    activate_status: Option<i64>,
    #[serde(default)]
    app_name: Option<String>,
    #[serde(default)]
    open_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageSendEnvelope {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    http_status: Option<i64>,
    #[serde(default)]
    data: Option<MessageSendData>,
}

#[derive(Debug, Deserialize)]
struct MessageSendData {
    #[serde(default)]
    message_id: Option<String>,
}

fn base_url(domain: FeishuDomain) -> &'static str {
    match domain {
        FeishuDomain::Feishu => "https://open.feishu.cn",
        FeishuDomain::Lark => "https://open.larksuite.com",
    }
}

fn sdk_base_url(domain: FeishuDomain) -> &'static str {
    match domain {
        FeishuDomain::Feishu => FEISHU_BASE_URL,
        FeishuDomain::Lark => LARK_BASE_URL,
    }
}

pub fn build_client(
    domain: FeishuDomain,
    app_id: &str,
    app_secret: &str,
) -> Result<Client, String> {
    let config = Config::builder(app_id.trim(), app_secret.trim())
        .base_url(sdk_base_url(domain))
        .build();
    Client::new(config).map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))
}

pub async fn fetch_tenant_access_token(
    domain: FeishuDomain,
    app_id: &str,
    app_secret: &str,
) -> Result<String, String> {
    let endpoint = format!(
        "{}/open-apis/auth/v3/tenant_access_token/internal",
        base_url(domain)
    );
    let body = json!({
        "app_id": app_id.trim(),
        "app_secret": app_secret.trim(),
    });

    let client = HttpClient::new();
    let request = HttpRequest::post(&endpoint)
        .json_body(&body)
        .timeout_secs(12)
        .build();

    let response = client
        .execute(request)
        .await
        .map_err(|e| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {e}"))?;

    if !response.is_success() {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: HTTP {}",
            response.status
        ));
    }

    let payload = response
        .json_value()
        .map_err(|e| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {e}"))?;
    parse_tenant_access_token_response(payload)
}

fn parse_tenant_access_token_response(payload: Value) -> Result<String, String> {
    let response: TenantAccessTokenResponse = serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
    if response.code != 0 {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            response
                .msg
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| "tenant_access_token request failed".to_string())
        ));
    }
    response
        .tenant_access_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "CHANNEL_CONNECTOR_AUTH_FAILED: missing tenant access token".to_string())
}

pub async fn get_bot_info(
    domain: FeishuDomain,
    tenant_access_token: &str,
) -> Result<FeishuBotInfo, String> {
    let endpoint = format!("{}/open-apis/bot/v3/info", base_url(domain));

    let client = HttpClient::new();
    let request = HttpRequest::get(&endpoint)
        .header(
            "Authorization",
            &format!("Bearer {}", tenant_access_token.trim()),
        )
        .timeout_secs(12)
        .build();

    let response = client
        .execute(request)
        .await
        .map_err(|e| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {e}"))?;

    if !response.is_success() {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: HTTP {}",
            response.status
        ));
    }

    let payload = response
        .json_value()
        .map_err(|e| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {e}"))?;
    parse_bot_info_response(payload)
}

fn parse_bot_info_response(payload: Value) -> Result<FeishuBotInfo, String> {
    let response: BotInfoEnvelope = serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
    if response.code != 0 {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {}",
            response
                .msg
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| "bot info request failed".to_string())
        ));
    }
    let bot = response.bot.ok_or_else(|| {
        "CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: missing bot payload".to_string()
    })?;
    let bot_name = bot
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            bot.app_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });
    if bot.activate_status == Some(0) {
        return Err("CHANNEL_CONNECTOR_AUTH_FAILED: bot capability is not activated".to_string());
    }
    Ok(FeishuBotInfo {
        bot_name,
        bot_open_id: bot
            .open_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

fn message_content(text: &str) -> String {
    json!({ "text": text }).to_string()
}

fn send_text_message_query() -> Vec<(&'static str, &'static str)> {
    vec![("receive_id_type", "chat_id")]
}

fn reply_text_message_query() -> Vec<(&'static str, &'static str)> {
    Vec::new()
}

fn send_text_message_body(peer_id: &str, text: &str, uuid: &str) -> Value {
    json!({
        "receive_id": peer_id.trim(),
        "msg_type": "text",
        "content": message_content(text.trim()),
        "uuid": uuid,
    })
}

fn reply_text_message_body(text: &str, uuid: &str) -> Value {
    json!({
        "msg_type": "text",
        "content": message_content(text.trim()),
        "uuid": uuid,
    })
}

fn extract_message_id(payload: Value, error_prefix: &str) -> Result<String, String> {
    let response: MessageSendEnvelope = serde_json::from_value(payload.clone())
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
    if response.code != 0 {
        let code = response.code;
        let message = response
            .msg
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| "message request failed".to_string());
        let prefix = send_policy::provider_error_prefix(&format!("code={code} msg={message}"));
        let mut detail = format!("code={code} msg={message}");
        if let Some(request_id) = response
            .request_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            detail.push_str(&format!(" request_id={request_id}"));
        }
        if let Some(http_status) = response.http_status {
            detail.push_str(&format!(" http_status={http_status}"));
        }
        return Err(format!(
            "{}: {}",
            if prefix == "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE" {
                error_prefix
            } else {
                prefix
            },
            detail
        ));
    }
    response
        .data
        .and_then(|value| value.message_id)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: missing message_id in {}",
                payload
            )
        })
}

pub async fn send_text_message(
    client: &Client,
    peer_id: &str,
    text: &str,
) -> Result<String, String> {
    let payload = send_text_message_body(peer_id, text, &Uuid::new_v4().to_string());
    let mut operation = client.operation("im.v1.message.create");
    for (key, value) in send_text_message_query() {
        operation = operation.query_param(key, value);
    }
    let response = operation
        .body_json(&payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?
        .send()
        .await
        .map_err(send_policy::normalize_provider_error)?;
    if response.status != 200 {
        return Err(send_policy::normalize_provider_error(format!(
            "status={} body={}",
            response.status,
            String::from_utf8_lossy(&response.body)
        )));
    }
    extract_message_id(
        response
            .json_value()
            .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
}

pub async fn reply_text_message(
    client: &Client,
    inbound_message_id: &str,
    text: &str,
) -> Result<String, String> {
    let payload = reply_text_message_body(text, &Uuid::new_v4().to_string());
    let mut operation = client
        .operation("im.v1.message.reply")
        .path_param("message_id", inbound_message_id.trim());
    for (key, value) in reply_text_message_query() {
        operation = operation.query_param(key, value);
    }
    let response = operation
        .body_json(&payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?
        .send()
        .await
        .map_err(send_policy::normalize_provider_error)?;
    if response.status != 200 {
        return Err(send_policy::normalize_provider_error(format!(
            "status={} body={}",
            response.status,
            String::from_utf8_lossy(&response.body)
        )));
    }
    extract_message_id(
        response
            .json_value()
            .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
}

#[cfg(test)]
#[path = "tests/api_tests.rs"]
mod tests;
