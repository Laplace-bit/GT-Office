use std::{
    collections::HashMap,
    sync::{OnceLock, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use qrcode::{render::svg, QrCode};
use reqwest::Client;
use uuid::Uuid;

use super::{api, types::WechatAuthSessionSnapshot, DEFAULT_BASE_URL};

#[derive(Debug, Clone)]
struct AuthSessionState {
    auth_session_id: String,
    account_id: String,
    base_url: String,
    status: String,
    checked_at_ms: u64,
    qr_code_id: Option<String>,
    qr_code_svg_data_url: Option<String>,
    expires_at_ms: Option<u64>,
    detail: Option<String>,
    bound_account_id: Option<String>,
}

static AUTH_SESSIONS: OnceLock<RwLock<HashMap<String, AuthSessionState>>> = OnceLock::new();

fn sessions() -> &'static RwLock<HashMap<String, AuthSessionState>> {
    AUTH_SESSIONS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn svg_data_url(content: &str) -> Result<String, String> {
    let qr = QrCode::new(content.as_bytes())
        .map_err(|error| format!("CHANNEL_CONNECTOR_QR_RENDER_FAILED: {error}"))?;
    let image = qr
        .render::<svg::Color<'_>>()
        .quiet_zone(false)
        .min_dimensions(320, 320)
        .dark_color(svg::Color("#0f172a"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        BASE64.encode(image)
    ))
}

fn to_snapshot(state: &AuthSessionState) -> WechatAuthSessionSnapshot {
    WechatAuthSessionSnapshot {
        auth_session_id: state.auth_session_id.clone(),
        account_id: state.account_id.clone(),
        status: state.status.clone(),
        checked_at_ms: state.checked_at_ms,
        qr_code_id: state.qr_code_id.clone(),
        qr_code_svg_data_url: state.qr_code_svg_data_url.clone(),
        expires_at_ms: state.expires_at_ms,
        detail: state.detail.clone(),
        bound_account_id: state.bound_account_id.clone(),
    }
}

pub async fn start_auth(account_id: Option<&str>) -> Result<WechatAuthSessionSnapshot, String> {
    let client = Client::new();
    let qr = api::fetch_qrcode(&client, DEFAULT_BASE_URL).await?;
    let checked_at_ms = now_ms();
    let state = AuthSessionState {
        auth_session_id: Uuid::new_v4().to_string(),
        account_id: super::normalize_account_id(account_id),
        base_url: DEFAULT_BASE_URL.to_string(),
        status: "awaiting_scan".to_string(),
        checked_at_ms,
        qr_code_id: Some(qr.qrcode),
        qr_code_svg_data_url: Some(svg_data_url(qr.qrcode_img_content.as_str())?),
        expires_at_ms: Some(checked_at_ms.saturating_add(5 * 60 * 1000)),
        detail: Some("Scan the QR code with WeChat.".to_string()),
        bound_account_id: None,
    };
    let snapshot = to_snapshot(&state);
    if let Ok(mut guard) = sessions().write() {
        guard.insert(state.auth_session_id.clone(), state);
    }
    Ok(snapshot)
}

pub async fn auth_status(
    app: &tauri::AppHandle,
    auth_session_id: &str,
) -> Result<WechatAuthSessionSnapshot, String> {
    let state = sessions()
        .read()
        .ok()
        .and_then(|guard| guard.get(auth_session_id).cloned())
        .ok_or_else(|| "CHANNEL_CONNECTOR_AUTH_NOT_FOUND: auth session not found".to_string())?;

    if state.status == "confirmed" || state.status == "expired" || state.status == "cancelled" {
        return Ok(to_snapshot(&state));
    }

    let client = Client::new();
    let qr_code_id = state
        .qr_code_id
        .as_deref()
        .ok_or_else(|| "CHANNEL_CONNECTOR_AUTH_NOT_FOUND: missing qr code id".to_string())?;
    let status = api::poll_qr_status(&client, &state.base_url, qr_code_id).await?;

    let mut next = state.clone();
    next.checked_at_ms = now_ms();
    next.detail = None;

    match status.status.as_str() {
        "wait" => {
            next.status = "awaiting_scan".to_string();
            next.detail = Some("Waiting for scan.".to_string());
        }
        "scaned" | "scanned" => {
            next.status = "scanned".to_string();
            next.detail = Some("Scanned. Confirm on your phone.".to_string());
        }
        "confirmed" => {
            let token = status
                .bot_token
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    "CHANNEL_CONNECTOR_AUTH_FAILED: QR confirmed but token missing".to_string()
                })?;
            super::save_bound_account(
                app,
                next.account_id.as_str(),
                token,
                status.baseurl.as_deref().unwrap_or(DEFAULT_BASE_URL),
            )?;
            next.status = "confirmed".to_string();
            next.detail = Some("WeChat account bound successfully.".to_string());
            next.bound_account_id = Some(next.account_id.clone());
        }
        "expired" => {
            next.status = "expired".to_string();
            next.detail = Some("QR code expired. Refresh to try again.".to_string());
        }
        other => {
            next.detail = Some(format!("Unexpected QR status: {other}"));
        }
    }

    let snapshot = to_snapshot(&next);
    if let Ok(mut guard) = sessions().write() {
        guard.insert(next.auth_session_id.clone(), next);
    }
    Ok(snapshot)
}

pub fn cancel_auth(auth_session_id: &str) -> Result<WechatAuthSessionSnapshot, String> {
    let mut guard = sessions()
        .write()
        .map_err(|_| "CHANNEL_CONNECTOR_AUTH_WRITE_FAILED".to_string())?;
    let state = guard
        .remove(auth_session_id)
        .ok_or_else(|| "CHANNEL_CONNECTOR_AUTH_NOT_FOUND: auth session not found".to_string())?;
    let cancelled = AuthSessionState {
        status: "cancelled".to_string(),
        detail: Some("Auth session cancelled.".to_string()),
        checked_at_ms: now_ms(),
        ..state
    };
    Ok(to_snapshot(&cancelled))
}
