use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FeishuConnectionMode {
    Websocket,
    Webhook,
}

impl FeishuConnectionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Websocket => "websocket",
            Self::Webhook => "webhook",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FeishuDomain {
    Feishu,
    Lark,
}

impl FeishuDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Feishu => "feishu",
            Self::Lark => "lark",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuAccountUpsertInput {
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub connection_mode: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub app_secret: Option<String>,
    #[serde(default)]
    pub app_secret_ref: Option<String>,
    #[serde(default)]
    pub verification_token: Option<String>,
    #[serde(default)]
    pub verification_token_ref: Option<String>,
    #[serde(default)]
    pub webhook_path: Option<String>,
    #[serde(default)]
    pub webhook_host: Option<String>,
    #[serde(default)]
    pub webhook_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConnectorAccountView {
    pub channel: String,
    pub account_id: String,
    pub enabled: bool,
    pub mode: String,
    pub connection_mode: String,
    pub domain: String,
    pub app_id: String,
    pub app_secret_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_token_ref: Option<String>,
    pub has_app_secret: bool,
    pub has_verification_token: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_port: Option<u16>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuHealthSnapshot {
    pub channel: String,
    pub account_id: String,
    pub ok: bool,
    pub status: String,
    pub detail: String,
    pub mode: String,
    pub connection_mode: String,
    pub domain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_open_id: Option<String>,
    pub runtime_connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_webhook_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_webhook_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_matched: Option<bool>,
    pub checked_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuWebhookSyncSnapshot {
    pub channel: String,
    pub account_id: String,
    pub ok: bool,
    pub webhook_url: String,
    pub webhook_matched: bool,
    pub detail: String,
    pub checked_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuSendSnapshot {
    pub channel: String,
    pub account_id: String,
    pub peer_id: String,
    pub message_id: String,
    pub delivered_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConnectorAccountRecord {
    pub account_id: String,
    pub enabled: bool,
    pub connection_mode: FeishuConnectionMode,
    pub domain: FeishuDomain,
    pub app_id: String,
    pub app_secret_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_token_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_port: Option<u16>,
    pub updated_at_ms: u64,
}
