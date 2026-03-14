use feishu_sdk::{
    core::{Config, FEISHU_BASE_URL, LARK_BASE_URL},
    Client,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command;
use uuid::Uuid;

use crate::process_utils::configure_std_command;

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

fn run_curl_json(args: &[&str]) -> Result<Value, String> {
    let mut command = Command::new("curl");
    configure_std_command(&mut command);
    let output = command
        .args(args)
        .output()
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))
}

pub fn fetch_tenant_access_token(
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
    })
    .to_string();
    let payload = run_curl_json(&[
        "-sS",
        "--max-time",
        "12",
        "-X",
        "POST",
        "-H",
        "Content-Type: application/json; charset=utf-8",
        "-d",
        body.as_str(),
        endpoint.as_str(),
    ])?;
    let response: TenantAccessTokenResponse = serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
    if response.code != 0 {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            response
                .msg
                .unwrap_or_else(|| "tenant_access_token request failed".to_string())
        ));
    }
    response
        .tenant_access_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "CHANNEL_CONNECTOR_AUTH_FAILED: missing tenant access token".to_string())
}

pub fn get_bot_info(
    domain: FeishuDomain,
    tenant_access_token: &str,
) -> Result<FeishuBotInfo, String> {
    let endpoint = format!("{}/open-apis/bot/v3/info", base_url(domain));
    let auth_header = format!("Authorization: Bearer {}", tenant_access_token.trim());
    let payload = run_curl_json(&[
        "-sS",
        "--max-time",
        "12",
        "-H",
        auth_header.as_str(),
        endpoint.as_str(),
    ])?;
    let response: BotInfoEnvelope = serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
    if response.code != 0 {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {}",
            response
                .msg
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

fn extract_message_id(payload: Value, error_prefix: &str) -> Result<String, String> {
    let response: MessageSendEnvelope = serde_json::from_value(payload.clone())
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
    if response.code != 0 {
        return Err(format!(
            "{}: {}",
            error_prefix,
            response
                .msg
                .unwrap_or_else(|| "message request failed".to_string())
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
    let payload = json!({
        "receive_id": peer_id.trim(),
        "msg_type": "text",
        "content": message_content(text.trim()),
        "uuid": Uuid::new_v4().to_string(),
    });
    let response = client
        .operation("im.v1.message.create")
        .path_param("receive_id_type", "chat_id")
        .body_json(&payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?
        .send()
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    if response.status != 200 {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: status={} body={}",
            response.status,
            String::from_utf8_lossy(&response.body)
        ));
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
    let payload = json!({
        "msg_type": "text",
        "content": message_content(text.trim()),
        "uuid": Uuid::new_v4().to_string(),
    });
    let response = client
        .operation("im.v1.message.reply")
        .path_param("message_id", inbound_message_id.trim())
        .body_json(&payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?
        .send()
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    if response.status != 200 {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: status={} body={}",
            response.status,
            String::from_utf8_lossy(&response.body)
        ));
    }
    extract_message_id(
        response
            .json_value()
            .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
}
