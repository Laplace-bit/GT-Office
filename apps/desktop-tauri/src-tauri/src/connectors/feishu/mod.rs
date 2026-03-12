mod account_store;
mod api;
pub mod inbound;
mod probe;
pub mod webhook;
pub mod websocket;

pub mod types;

use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tracing::warn;

use super::credential_store::{load_secret, store_secret};
use account_store::{list_records, upsert_record};
use types::{
    FeishuAccountUpsertInput, FeishuConnectionMode, FeishuConnectorAccountRecord,
    FeishuConnectorAccountView, FeishuDomain, FeishuHealthSnapshot, FeishuSendSnapshot,
    FeishuWebhookSyncSnapshot,
};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub fn normalize_account_id(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("default")
        .to_ascii_lowercase()
}

fn default_app_secret_ref(account_id: &str) -> String {
    format!(
        "feishu/{}/app_secret",
        account_id.trim().to_ascii_lowercase()
    )
}

fn default_verification_token_ref(account_id: &str) -> String {
    format!(
        "feishu/{}/verification_token",
        account_id.trim().to_ascii_lowercase()
    )
}

fn normalize_connection_mode(value: Option<&str>) -> Result<FeishuConnectionMode, String> {
    match value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("websocket")
        .to_ascii_lowercase()
        .as_str()
    {
        "websocket" => Ok(FeishuConnectionMode::Websocket),
        "webhook" => Ok(FeishuConnectionMode::Webhook),
        _ => Err(
            "CHANNEL_CONNECTOR_MODE_INVALID: feishu connection mode must be websocket|webhook"
                .to_string(),
        ),
    }
}

fn normalize_domain(value: Option<&str>) -> Result<FeishuDomain, String> {
    match value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("feishu")
        .to_ascii_lowercase()
        .as_str()
    {
        "feishu" => Ok(FeishuDomain::Feishu),
        "lark" => Ok(FeishuDomain::Lark),
        _ => Err("CHANNEL_CONNECTOR_DOMAIN_INVALID: feishu domain must be feishu|lark".to_string()),
    }
}

pub fn load_app_secret(record: &FeishuConnectorAccountRecord) -> Result<String, String> {
    load_secret(&record.app_secret_ref)
        .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_LOAD_FAILED: {error}"))
}

fn has_secret(reference: Option<&str>) -> bool {
    reference
        .filter(|value| !value.trim().is_empty())
        .and_then(|value| load_secret(value).ok())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn to_view(record: &FeishuConnectorAccountRecord) -> FeishuConnectorAccountView {
    FeishuConnectorAccountView {
        channel: "feishu".to_string(),
        account_id: record.account_id.clone(),
        enabled: record.enabled,
        mode: record.connection_mode.as_str().to_string(),
        connection_mode: record.connection_mode.as_str().to_string(),
        domain: record.domain.as_str().to_string(),
        app_id: record.app_id.clone(),
        app_secret_ref: record.app_secret_ref.clone(),
        verification_token_ref: record.verification_token_ref.clone(),
        has_app_secret: has_secret(Some(&record.app_secret_ref)),
        has_verification_token: has_secret(record.verification_token_ref.as_deref()),
        webhook_path: record.webhook_path.clone(),
        webhook_host: record.webhook_host.clone(),
        webhook_port: record.webhook_port,
        updated_at_ms: record.updated_at_ms,
    }
}

pub fn list_accounts(app: &AppHandle) -> Result<Vec<FeishuConnectorAccountView>, String> {
    Ok(list_records(app)?
        .into_iter()
        .map(|record| to_view(&record))
        .collect())
}

pub fn upsert_account(
    app: &AppHandle,
    input: FeishuAccountUpsertInput,
) -> Result<FeishuConnectorAccountView, String> {
    let account_id = normalize_account_id(input.account_id.as_deref());
    let existing = account_store::get_record(app, &account_id)?;

    let connection_mode = normalize_connection_mode(
        input
            .connection_mode
            .as_deref()
            .or_else(|| existing.as_ref().map(|item| item.connection_mode.as_str())),
    )?;
    let domain = normalize_domain(
        input
            .domain
            .as_deref()
            .or_else(|| existing.as_ref().map(|item| item.domain.as_str())),
    )?;
    let enabled = input
        .enabled
        .unwrap_or_else(|| existing.as_ref().map(|item| item.enabled).unwrap_or(true));
    let app_id = input
        .app_id
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .or_else(|| existing.as_ref().map(|item| item.app_id.clone()))
        .ok_or_else(|| "CHANNEL_CONNECTOR_UNCONFIGURED: feishu app id is required".to_string())?;

    let mut app_secret_ref = input
        .app_secret_ref
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .or_else(|| existing.as_ref().map(|item| item.app_secret_ref.clone()))
        .unwrap_or_else(|| default_app_secret_ref(&account_id));

    if let Some(secret) = input
        .app_secret
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if app_secret_ref.trim().is_empty() {
            app_secret_ref = default_app_secret_ref(&account_id);
        }
        store_secret(&app_secret_ref, secret)
            .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_STORE_FAILED: {error}"))?;
    }

    if !has_secret(Some(&app_secret_ref)) {
        return Err("CHANNEL_CONNECTOR_UNCONFIGURED: feishu app secret is required".to_string());
    }

    let mut verification_token_ref = input
        .verification_token_ref
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            existing
                .as_ref()
                .and_then(|item| item.verification_token_ref.clone())
        });

    if let Some(token) = input
        .verification_token
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if verification_token_ref
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .is_none()
        {
            verification_token_ref = Some(default_verification_token_ref(&account_id));
        }
        let Some(reference) = verification_token_ref.as_deref() else {
            return Err(
                "CHANNEL_CONNECTOR_UNCONFIGURED: missing verification token reference".to_string(),
            );
        };
        store_secret(reference, token)
            .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_STORE_FAILED: {error}"))?;
    }

    if connection_mode == FeishuConnectionMode::Webhook
        && !has_secret(verification_token_ref.as_deref())
    {
        return Err(
            "CHANNEL_CONNECTOR_UNCONFIGURED: feishu verification token is required for webhook mode"
                .to_string(),
        );
    }

    let record = FeishuConnectorAccountRecord {
        account_id: account_id.clone(),
        enabled,
        connection_mode,
        domain,
        app_id,
        app_secret_ref,
        verification_token_ref,
        webhook_path: input
            .webhook_path
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .or_else(|| existing.as_ref().and_then(|item| item.webhook_path.clone())),
        webhook_host: input
            .webhook_host
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .or_else(|| existing.as_ref().and_then(|item| item.webhook_host.clone())),
        webhook_port: input
            .webhook_port
            .or_else(|| existing.as_ref().and_then(|item| item.webhook_port)),
        updated_at_ms: now_ms(),
    };

    upsert_record(app, account_id, record.clone())?;
    Ok(to_view(&record))
}

pub async fn health_check(
    app: &AppHandle,
    account_id: Option<&str>,
    runtime_webhook_url: Option<String>,
) -> Result<FeishuHealthSnapshot, String> {
    let normalized = normalize_account_id(account_id);
    let runtime_connected = websocket::is_connected(&normalized);
    probe::health_check(
        app,
        Some(&normalized),
        runtime_webhook_url,
        runtime_connected,
    )
    .await
}

pub async fn sync_runtime_webhook(
    app: &AppHandle,
    account_id: Option<&str>,
    runtime_webhook_url: Option<&str>,
) -> Result<FeishuWebhookSyncSnapshot, String> {
    webhook::sync_runtime_webhook(app, account_id, runtime_webhook_url)
}

pub fn parse_webhook_payload(payload: &Value) -> Result<inbound::ParsedFeishuMessage, String> {
    inbound::parse_payload(payload)
}

pub fn parse_payload_for_account(
    payload: &Value,
    account_id: Option<&str>,
) -> Result<inbound::ParsedFeishuMessage, String> {
    inbound::parse_payload_for_account(payload, account_id)
}

pub async fn send_text_reply(
    app: &AppHandle,
    account_id: Option<&str>,
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<FeishuSendSnapshot, String> {
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: peer id is required".to_string());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: text is required".to_string());
    }

    let account_id = normalize_account_id(account_id);
    let Some(record) = account_store::get_record(app, &account_id)? else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: feishu account {}",
            account_id
        ));
    };
    if !record.enabled {
        return Err("CHANNEL_CONNECTOR_DISABLED: feishu account is disabled".to_string());
    }

    let app_secret = load_app_secret(&record)?;
    let client = api::build_client(record.domain, &record.app_id, &app_secret)?;
    let message_id = if let Some(inbound_message_id) = reply_to_message_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match api::reply_text_message(&client, inbound_message_id, text).await {
            Ok(message_id) => message_id,
            Err(error) => {
                warn!(
                    account_id = %record.account_id,
                    peer_id = %peer_id,
                    reply_to_message_id = %inbound_message_id,
                    error = %error,
                    "feishu reply send failed, falling back to direct chat send"
                );
                api::send_text_message(&client, peer_id, text).await?
            }
        }
    } else {
        api::send_text_message(&client, peer_id, text).await?
    };

    Ok(FeishuSendSnapshot {
        channel: "feishu".to_string(),
        account_id: record.account_id,
        peer_id: peer_id.to_string(),
        message_id,
        delivered_at_ms: now_ms(),
    })
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
