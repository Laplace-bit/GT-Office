use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    process::Command,
    sync::{OnceLock, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::time::{sleep, Duration};
use tracing::{debug, warn};
use vb_task::{ExternalInboundMessage, ExternalPeerKind};

use crate::{app_state::AppState, commands::channel_adapter::process_external_inbound_message};

use super::credential_store::{load_secret, store_secret};

const CONNECTOR_STORE_VERSION: &str = "1";
const TELEGRAM_POLL_INTERVAL_MS: u64 = 1_500;

static TELEGRAM_POLL_OFFSETS: OnceLock<RwLock<HashMap<String, i64>>> = OnceLock::new();
static TELEGRAM_POLL_PRIMED: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramAccountUpsertInput {
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub bot_token: Option<String>,
    #[serde(default)]
    pub bot_token_ref: Option<String>,
    #[serde(default)]
    pub webhook_secret: Option<String>,
    #[serde(default)]
    pub webhook_secret_ref: Option<String>,
    #[serde(default)]
    pub webhook_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConnectorAccountView {
    pub channel: String,
    pub account_id: String,
    pub enabled: bool,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_path: Option<String>,
    pub bot_token_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret_ref: Option<String>,
    pub has_bot_token: bool,
    pub has_webhook_secret: bool,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramHealthSnapshot {
    pub channel: String,
    pub account_id: String,
    pub ok: bool,
    pub status: String,
    pub detail: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_username: Option<String>,
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
pub struct TelegramWebhookSyncSnapshot {
    pub channel: String,
    pub account_id: String,
    pub ok: bool,
    pub webhook_url: String,
    pub webhook_matched: bool,
    pub detail: String,
    pub checked_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStoreFile {
    version: String,
    #[serde(default)]
    telegram_accounts: HashMap<String, TelegramAccountRecord>,
}

impl Default for ConnectorStoreFile {
    fn default() -> Self {
        Self {
            version: CONNECTOR_STORE_VERSION.to_string(),
            telegram_accounts: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramAccountRecord {
    account_id: String,
    enabled: bool,
    mode: String,
    bot_token_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    webhook_secret_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    webhook_path: Option<String>,
    updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
struct TelegramApiEnvelope<T> {
    ok: bool,
    result: Option<T>,
    #[serde(default)]
    description: Option<String>,
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_account_id(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string()
}

fn normalize_mode(value: Option<&str>) -> Result<String, String> {
    let mode = value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("polling")
        .to_ascii_lowercase();
    match mode.as_str() {
        "webhook" | "polling" => Ok(mode),
        _ => {
            Err("CHANNEL_CONNECTOR_MODE_INVALID: telegram mode must be webhook|polling".to_string())
        }
    }
}

fn read_poll_offset(account_id: &str) -> Option<i64> {
    let lock = TELEGRAM_POLL_OFFSETS.get_or_init(|| RwLock::new(HashMap::new()));
    lock.read()
        .ok()
        .and_then(|guard| guard.get(account_id).copied())
}

fn write_poll_offset(account_id: &str, value: i64) {
    let lock = TELEGRAM_POLL_OFFSETS.get_or_init(|| RwLock::new(HashMap::new()));
    if let Ok(mut guard) = lock.write() {
        guard.insert(account_id.to_string(), value);
    }
}

fn is_poll_primed(account_id: &str) -> bool {
    let lock = TELEGRAM_POLL_PRIMED.get_or_init(|| RwLock::new(HashSet::new()));
    lock.read()
        .map(|guard| guard.contains(account_id))
        .unwrap_or(false)
}

fn mark_poll_primed(account_id: &str) {
    let lock = TELEGRAM_POLL_PRIMED.get_or_init(|| RwLock::new(HashSet::new()));
    if let Ok(mut guard) = lock.write() {
        guard.insert(account_id.to_string());
    }
}

fn connector_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    Ok(app_data.join("channel/connectors.json"))
}

fn load_store(app: &AppHandle) -> Result<ConnectorStoreFile, String> {
    let path = connector_store_path(app)?;
    if !path.exists() {
        return Ok(ConnectorStoreFile::default());
    }
    let payload =
        fs::read(&path).map_err(|error| format!("CHANNEL_CONNECTOR_STORE_READ_FAILED: {error}"))?;
    serde_json::from_slice::<ConnectorStoreFile>(&payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_DECODE_FAILED: {error}"))
}

fn save_store(app: &AppHandle, store: &ConnectorStoreFile) -> Result<(), String> {
    let path = connector_store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_WRITE_FAILED: {error}"))?;
    }
    let payload = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_ENCODE_FAILED: {error}"))?;
    fs::write(path, payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_WRITE_FAILED: {error}"))
}

fn default_token_ref(account_id: &str) -> String {
    format!(
        "telegram/{}/bot_token",
        account_id.trim().to_ascii_lowercase()
    )
}

fn default_webhook_secret_ref(account_id: &str) -> String {
    format!(
        "telegram/{}/webhook_secret",
        account_id.trim().to_ascii_lowercase()
    )
}

fn load_bot_token(record: &TelegramAccountRecord) -> Result<String, String> {
    load_secret(&record.bot_token_ref)
        .map_err(|error| format!("CHANNEL_CONNECTOR_TOKEN_LOAD_FAILED: {error}"))
}

fn load_webhook_secret(record: &TelegramAccountRecord) -> Result<Option<String>, String> {
    let Some(reference) = record.webhook_secret_ref.as_deref() else {
        return Ok(None);
    };
    let secret = load_secret(reference)
        .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_LOAD_FAILED: {error}"))?;
    if secret.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(secret))
}

fn api_base_url(token: &str) -> String {
    format!("https://api.telegram.org/bot{}", token.trim())
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
                return serde_json::from_slice::<Value>(&retry_output.stdout)
                    .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"));
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

fn telegram_get_me(token: &str) -> Result<TelegramApiEnvelope<TelegramGetMeResult>, String> {
    let endpoint = format!("{}/getMe", api_base_url(token));
    let payload = run_curl_json(&["-sS", "--max-time", "8", endpoint.as_str()])?;
    serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))
}

fn telegram_get_webhook_info(
    token: &str,
) -> Result<TelegramApiEnvelope<TelegramWebhookInfoResult>, String> {
    let endpoint = format!("{}/getWebhookInfo", api_base_url(token));
    let payload = run_curl_json(&["-sS", "--max-time", "8", endpoint.as_str()])?;
    serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))
}

fn telegram_set_webhook(token: &str, url: &str, secret: Option<&str>) -> Result<(), String> {
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
    let response: TelegramApiEnvelope<Value> = serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
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

fn telegram_delete_webhook(token: &str) -> Result<(), String> {
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
    let response: TelegramApiEnvelope<Value> = serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))?;
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

fn telegram_get_updates(token: &str, offset: Option<i64>) -> Result<TelegramApiEnvelope<Vec<Value>>, String> {
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
    serde_json::from_value(payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: {error}"))
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

fn parse_telegram_update(
    update: &Value,
    account_id: &str,
) -> Result<(ExternalInboundMessage, i64), String> {
    let update_id = update
        .get("update_id")
        .and_then(Value::as_i64)
        .or_else(|| update.get("update_id").and_then(Value::as_u64).map(|value| value as i64))
        .ok_or_else(|| "missing update_id".to_string())?;
    let message = update
        .get("message")
        .or_else(|| update.get("edited_message"))
        .or_else(|| update.get("channel_post"))
        .ok_or_else(|| "missing message/edited_message/channel_post".to_string())?;
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
    let message_id = json_to_string(message.get("message_id"))
        .unwrap_or_else(|| format!("update-{update_id}"));
    let text = json_to_string(message.get("text"))
        .or_else(|| json_to_string(message.get("caption")))
        .unwrap_or_else(|| "[telegram non-text message]".to_string());

    Ok((
        ExternalInboundMessage {
            channel: "telegram".to_string(),
            account_id: account_id.to_string(),
            peer_kind,
            peer_id,
            sender_id,
            sender_name,
            message_id,
            text,
            idempotency_key: None,
            workspace_id_hint: None,
            target_agent_id_hint: None,
            metadata: update.clone(),
        },
        update_id,
    ))
}

fn to_view(record: &TelegramAccountRecord) -> TelegramConnectorAccountView {
    let has_bot_token = load_secret(&record.bot_token_ref)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_webhook_secret = record
        .webhook_secret_ref
        .as_deref()
        .and_then(|reference| load_secret(reference).ok())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    TelegramConnectorAccountView {
        channel: "telegram".to_string(),
        account_id: record.account_id.clone(),
        enabled: record.enabled,
        mode: record.mode.clone(),
        webhook_path: record.webhook_path.clone(),
        bot_token_ref: record.bot_token_ref.clone(),
        webhook_secret_ref: record.webhook_secret_ref.clone(),
        has_bot_token,
        has_webhook_secret,
        updated_at_ms: record.updated_at_ms,
    }
}

pub fn list_accounts(app: &AppHandle) -> Result<Vec<TelegramConnectorAccountView>, String> {
    let store = load_store(app)?;
    let mut accounts: Vec<TelegramConnectorAccountView> =
        store.telegram_accounts.values().map(to_view).collect();
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    Ok(accounts)
}

pub fn upsert_account(
    app: &AppHandle,
    input: TelegramAccountUpsertInput,
) -> Result<TelegramConnectorAccountView, String> {
    let account_id = normalize_account_id(input.account_id.as_deref());
    let account_key = account_id.to_ascii_lowercase();

    let mut store = load_store(app)?;
    let existing = store.telegram_accounts.get(&account_key).cloned();

    let mode = normalize_mode(
        input
            .mode
            .as_deref()
            .or_else(|| existing.as_ref().map(|item| item.mode.as_str())),
    )?;
    let enabled = input
        .enabled
        .unwrap_or_else(|| existing.as_ref().map(|item| item.enabled).unwrap_or(true));

    let mut bot_token_ref = input
        .bot_token_ref
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .or_else(|| existing.as_ref().map(|item| item.bot_token_ref.clone()))
        .unwrap_or_else(|| default_token_ref(&account_id));

    if let Some(token) = input
        .bot_token
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if bot_token_ref.trim().is_empty() {
            bot_token_ref = default_token_ref(&account_id);
        }
        store_secret(&bot_token_ref, token)
            .map_err(|error| format!("CHANNEL_CONNECTOR_TOKEN_STORE_FAILED: {error}"))?;
    }

    if load_secret(&bot_token_ref)
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        return Err("CHANNEL_CONNECTOR_UNCONFIGURED: telegram bot token is required".to_string());
    }

    let mut webhook_secret_ref = input
        .webhook_secret_ref
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            existing
                .as_ref()
                .and_then(|item| item.webhook_secret_ref.clone())
        });

    if let Some(secret) = input
        .webhook_secret
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if webhook_secret_ref
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .is_none()
        {
            webhook_secret_ref = Some(default_webhook_secret_ref(&account_id));
        }
        let Some(reference) = webhook_secret_ref.as_deref() else {
            return Err(
                "CHANNEL_CONNECTOR_UNCONFIGURED: missing webhook secret reference".to_string(),
            );
        };
        store_secret(reference, secret)
            .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_STORE_FAILED: {error}"))?;
    }

    let webhook_path = input
        .webhook_path
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .or_else(|| existing.as_ref().and_then(|item| item.webhook_path.clone()));

    let record = TelegramAccountRecord {
        account_id: account_id.clone(),
        enabled,
        mode,
        bot_token_ref,
        webhook_secret_ref,
        webhook_path,
        updated_at_ms: now_ms(),
    };

    store.telegram_accounts.insert(account_key, record.clone());
    save_store(app, &store)?;

    Ok(to_view(&record))
}

pub async fn health_check(
    app: &AppHandle,
    account_id: Option<&str>,
    runtime_webhook_url: Option<String>,
) -> Result<TelegramHealthSnapshot, String> {
    let account_id = normalize_account_id(account_id);
    let key = account_id.to_ascii_lowercase();
    let store = load_store(app)?;
    let Some(record) = store.telegram_accounts.get(&key) else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: telegram account {}",
            account_id
        ));
    };

    if !record.enabled {
        return Ok(TelegramHealthSnapshot {
            channel: "telegram".to_string(),
            account_id: record.account_id.clone(),
            ok: false,
            status: "disabled".to_string(),
            detail: "connector account is disabled".to_string(),
            mode: record.mode.clone(),
            bot_username: None,
            configured_webhook_url: None,
            runtime_webhook_url,
            webhook_matched: None,
            checked_at_ms: now_ms(),
        });
    }

    let token = load_bot_token(record)?;
    let me = telegram_get_me(&token)?;
    if !me.ok {
        return Ok(TelegramHealthSnapshot {
            channel: "telegram".to_string(),
            account_id: record.account_id.clone(),
            ok: false,
            status: "auth_failed".to_string(),
            detail: me
                .description
                .unwrap_or_else(|| "telegram getMe failed".to_string()),
            mode: record.mode.clone(),
            bot_username: None,
            configured_webhook_url: None,
            runtime_webhook_url,
            webhook_matched: None,
            checked_at_ms: now_ms(),
        });
    }

    let webhook_info = telegram_get_webhook_info(&token)?;
    let (configured_webhook_url, webhook_last_error) = if let Some(result) = webhook_info.result {
        let url = result
            .url
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        (url, result.last_error_message)
    } else {
        (None, None)
    };

    let webhook_matched = runtime_webhook_url.as_ref().map(|runtime_url| {
        configured_webhook_url
            .as_deref()
            .map(|configured| configured == runtime_url)
            .unwrap_or(false)
    });

    let detail = if let Some(last_error) = webhook_last_error.filter(|item| !item.trim().is_empty())
    {
        format!("telegram webhook reports error: {last_error}")
    } else {
        "telegram account health check passed".to_string()
    };

    Ok(TelegramHealthSnapshot {
        channel: "telegram".to_string(),
        account_id: record.account_id.clone(),
        ok: true,
        status: "ok".to_string(),
        detail,
        mode: record.mode.clone(),
        bot_username: me.result.and_then(|item| item.username),
        configured_webhook_url,
        runtime_webhook_url,
        webhook_matched,
        checked_at_ms: now_ms(),
    })
}

pub async fn sync_runtime_webhook(
    app: &AppHandle,
    account_id: Option<&str>,
    runtime_webhook_url: &str,
) -> Result<TelegramWebhookSyncSnapshot, String> {
    let runtime_webhook_url = runtime_webhook_url.trim();
    if runtime_webhook_url.is_empty() {
        return Err("CHANNEL_CONNECTOR_WEBHOOK_MISSING: runtime webhook url is empty".to_string());
    }
    if !runtime_webhook_url
        .to_ascii_lowercase()
        .starts_with("https://")
    {
        return Err(
            "CHANNEL_CONNECTOR_WEBHOOK_INVALID: telegram setWebhook requires an HTTPS URL"
                .to_string(),
        );
    }

    let account_id = normalize_account_id(account_id);
    let key = account_id.to_ascii_lowercase();
    let store = load_store(app)?;
    let Some(record) = store.telegram_accounts.get(&key) else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: telegram account {}",
            account_id
        ));
    };
    if !record.enabled {
        return Err("CHANNEL_CONNECTOR_DISABLED: telegram account is disabled".to_string());
    }

    let token = load_bot_token(record)?;
    let webhook_secret = load_webhook_secret(record)?;

    telegram_set_webhook(&token, runtime_webhook_url, webhook_secret.as_deref())?;
    let webhook_info = telegram_get_webhook_info(&token)?;
    let configured_webhook_url = webhook_info
        .result
        .and_then(|item| item.url)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let matched = configured_webhook_url == runtime_webhook_url;

    Ok(TelegramWebhookSyncSnapshot {
        channel: "telegram".to_string(),
        account_id: record.account_id.clone(),
        ok: matched,
        webhook_url: configured_webhook_url,
        webhook_matched: matched,
        detail: if matched {
            "telegram webhook synced".to_string()
        } else {
            "telegram webhook mismatch after setWebhook".to_string()
        },
        checked_at_ms: now_ms(),
    })
}

fn polling_accounts(app: &AppHandle) -> Vec<TelegramAccountRecord> {
    let Ok(store) = load_store(app) else {
        return Vec::new();
    };
    let mut accounts: Vec<TelegramAccountRecord> = store
        .telegram_accounts
        .values()
        .filter(|record| record.enabled && record.mode.eq_ignore_ascii_case("polling"))
        .cloned()
        .collect();
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    accounts
}

async fn poll_account_once(
    app: &AppHandle,
    state: &AppState,
    record: TelegramAccountRecord,
) -> Result<(), String> {
    let account_id = record.account_id.clone();
    let token = load_bot_token(&record)?;

    if !is_poll_primed(&account_id) {
        let token_for_delete = token.clone();
        if let Err(error) = tokio::task::spawn_blocking(move || telegram_delete_webhook(&token_for_delete))
            .await
            .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?
        {
            debug!(
                account_id = %account_id,
                error = %error,
                "telegram polling deleteWebhook failed (continuing)"
            );
        }
        mark_poll_primed(&account_id);
    }

    let offset = read_poll_offset(&account_id);
    let token_for_updates = token.clone();
    let updates = tokio::task::spawn_blocking(move || telegram_get_updates(&token_for_updates, offset))
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))??;
    if !updates.ok {
        return Err(format!(
            "CHANNEL_CONNECTOR_AUTH_FAILED: {}",
            updates
                .description
                .unwrap_or_else(|| "telegram getUpdates failed".to_string())
        ));
    }
    let Some(items) = updates.result else {
        return Ok(());
    };

    let mut max_update_id: Option<i64> = None;
    for item in items {
        if let Some(update_id) = item
            .get("update_id")
            .and_then(Value::as_i64)
            .or_else(|| item.get("update_id").and_then(Value::as_u64).map(|value| value as i64))
        {
            max_update_id = Some(max_update_id.map_or(update_id, |value| value.max(update_id)));
        }
        let inbound = match parse_telegram_update(&item, &account_id) {
            Ok((inbound, _)) => inbound,
            Err(error) => {
                debug!(
                    account_id = %account_id,
                    error = %error,
                    "telegram polling ignored unsupported update"
                );
                continue;
            }
        };
        if let Err(error) = process_external_inbound_message(state, app, inbound) {
            warn!(
                account_id = %account_id,
                error = %error,
                "telegram polling dispatch failed"
            );
        }
    }

    if let Some(max_update_id) = max_update_id {
        write_poll_offset(&account_id, max_update_id.saturating_add(1));
    }
    Ok(())
}

pub fn spawn_polling_worker(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        loop {
            let accounts = polling_accounts(&app);
            for record in accounts {
                if let Err(error) = poll_account_once(&app, &state, record.clone()).await {
                    warn!(
                        account_id = %record.account_id,
                        error = %error,
                        "telegram polling cycle failed"
                    );
                }
            }
            sleep(Duration::from_millis(TELEGRAM_POLL_INTERVAL_MS)).await;
        }
    });
}
