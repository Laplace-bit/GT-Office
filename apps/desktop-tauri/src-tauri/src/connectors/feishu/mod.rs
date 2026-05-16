mod account_store;
mod api;
mod app_registration;
pub mod inbound;
mod probe;
mod send_policy;
pub mod webhook;
pub mod websocket;

pub mod types;

use serde_json::Value;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use super::credential_store::{load_secret, store_secret};
use crate::app_state::AppState;
use account_store::{list_records, upsert_record};
use types::{
    FeishuAccountUpsertInput, FeishuConnectionMode, FeishuConnectorAccountRecord,
    FeishuConnectorAccountView, FeishuDomain, FeishuHealthSnapshot, FeishuQrLoginBeginResult,
    FeishuSendSnapshot, FeishuWebhookSyncSnapshot,
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

struct QrLoginSession {
    cancel: CancellationToken,
    handle: JoinHandle<()>,
}

static QR_LOGIN_SESSION: OnceLock<Mutex<Option<QrLoginSession>>> = OnceLock::new();

fn qr_login_sessions() -> &'static Mutex<Option<QrLoginSession>> {
    QR_LOGIN_SESSION.get_or_init(|| Mutex::new(None))
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

fn normalize_webhook_path(value: &str) -> Option<String> {
    let path = value.trim();
    if path.is_empty() {
        return None;
    }
    Some(if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    })
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

pub fn list_accounts<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<FeishuConnectorAccountView>, String> {
    Ok(list_records(app)?
        .into_iter()
        .map(|record| to_view(&record))
        .collect())
}

pub fn upsert_account(
    app: &AppHandle<impl Runtime>,
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
            .and_then(normalize_webhook_path)
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

pub async fn send_text_reply<R: Runtime>(
    app: &AppHandle<R>,
    account_id: Option<&str>,
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<FeishuSendSnapshot, String> {
    let (peer_id, text) = validate_send_text_input(peer_id, text)?;

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
            Err(error) if send_policy::should_fallback_to_direct_send(&error.to_string()) => {
                warn!(
                    account_id = %record.account_id,
                    peer_id = %peer_id,
                    reply_to_message_id = %inbound_message_id,
                    error = %error,
                    "feishu reply target unavailable, falling back to direct chat send"
                );
                api::send_text_message(&client, peer_id, text).await?
            }
            Err(error) => return Err(error.to_string()),
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

fn validate_send_text_input<'a>(
    peer_id: &'a str,
    text: &'a str,
) -> Result<(&'a str, &'a str), String> {
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: peer id is required".to_string());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: text is required".to_string());
    }
    Ok((peer_id, text))
}

pub async fn qr_login_start(
    app: AppHandle,
    state: &AppState,
    domain: FeishuDomain,
) -> Result<FeishuQrLoginBeginResult, String> {
    // Cancel any existing session
    let existing_handle = {
        if let Ok(mut guard) = qr_login_sessions().lock() {
            guard.take().map(|session| {
                session.cancel.cancel();
                session.handle
            })
        } else {
            None
        }
    };
    if let Some(handle) = existing_handle {
        let _ = handle.await;
    }

    // Init: verify environment supports client_secret
    app_registration::init_app_registration(domain).await?;

    // Begin: get device code and QR URL
    let begin_result = app_registration::begin_app_registration(domain).await?;

    // Prepare for polling
    let device_code = begin_result.device_code.clone();
    let interval = begin_result.interval;
    let expire_in = begin_result.expire_in;
    let cancel = CancellationToken::new();
    let cancel_clone = cancel.clone();
    let app_clone = app.clone();
    let state_clone = state.clone();

    let handle = tokio::spawn(async move {
        let result = app_registration::poll_app_registration(
            app_clone.clone(),
            domain,
            device_code,
            interval,
            expire_in,
            cancel_clone,
        )
        .await;

        if let Ok(success) = result {
            // Parse domain string back to FeishuDomain for upsert
            let feishu_domain = match success.domain.as_str() {
                "lark" => FeishuDomain::Lark,
                _ => FeishuDomain::Feishu,
            };

            // Auto-save account
            let upsert_input = FeishuAccountUpsertInput {
                account_id: Some("default".to_string()),
                enabled: Some(true),
                connection_mode: Some("websocket".to_string()),
                domain: Some(feishu_domain.as_str().to_string()),
                app_id: Some(success.app_id.clone()),
                app_secret: Some(success.app_secret.clone()),
                app_secret_ref: None,
                verification_token: None,
                verification_token_ref: None,
                webhook_path: None,
                webhook_host: None,
                webhook_port: None,
            };

            if let Err(e) = upsert_account(&app_clone, upsert_input) {
                let _ = app_clone.emit(
                    "feishu-qr/error",
                    serde_json::json!({ "message": format!("Failed to save account: {e}") }),
                );
                return;
            }

            // Start websocket connection
            websocket::reconcile(&app_clone, &state_clone);
        }
        // Error already emitted inside poll_app_registration

        // Clear session
        if let Ok(mut guard) = qr_login_sessions().lock() {
            *guard = None;
        }
    });

    // Store session
    if let Ok(mut guard) = qr_login_sessions().lock() {
        *guard = Some(QrLoginSession { cancel, handle });
    }

    Ok(begin_result)
}

pub fn qr_login_cancel() -> Result<(), String> {
    if let Ok(mut guard) = qr_login_sessions().lock() {
        if let Some(session) = guard.take() {
            session.cancel.cancel();
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
