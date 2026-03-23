use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatAccountUpsertInput {
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub token_ref: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatConnectorAccountView {
    pub channel: String,
    pub account_id: String,
    pub enabled: bool,
    pub mode: String,
    pub token_ref: String,
    pub has_token: bool,
    pub base_url: String,
    pub updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_bound_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatHealthSnapshot {
    pub channel: String,
    pub account_id: String,
    pub ok: bool,
    pub status: String,
    pub detail: String,
    pub mode: String,
    pub runtime_connected: bool,
    pub checked_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatSendSnapshot {
    pub channel: String,
    pub account_id: String,
    pub peer_id: String,
    pub message_id: String,
    pub delivered_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatAuthSessionSnapshot {
    pub auth_session_id: String,
    pub account_id: String,
    pub status: String,
    pub checked_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_code_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_code_svg_data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatConnectorAccountRecord {
    pub account_id: String,
    pub enabled: bool,
    pub token_ref: String,
    pub base_url: String,
    pub updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_policy_initialized_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_bound_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error_at_ms: Option<u64>,
}
