mod api;
mod inbound;
mod offset_store;

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{OnceLock, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::time::{sleep, Duration};
use tracing::{debug, warn};

use crate::{app_state::AppState, commands::channel_adapter::process_external_inbound_message};

use super::credential_store::{load_secret, store_secret};
use api::{
    telegram_delete_webhook, telegram_edit_message, telegram_get_me, telegram_get_updates,
    telegram_get_webhook_info, telegram_send_chat_action, telegram_send_message,
    telegram_set_webhook,
};
use inbound::parse_telegram_update;
use offset_store::{read_offset, write_offset};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramSendSnapshot {
    pub channel: String,
    pub account_id: String,
    pub peer_id: String,
    pub message_id: String,
    pub delivered_at_ms: u64,
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

fn resolve_poll_offset(app: &AppHandle, account_id: &str, token: &str) -> Option<i64> {
    if let Some(value) = read_poll_offset(account_id) {
        return Some(value);
    }
    let persisted = read_offset(app, account_id, token).ok().flatten();
    if let Some(value) = persisted {
        write_poll_offset(account_id, value);
    }
    persisted
}

fn persist_poll_offset(app: &AppHandle, account_id: &str, token: &str, value: i64) {
    write_poll_offset(account_id, value);
    if let Err(error) = write_offset(app, account_id, token, value) {
        warn!(
            account_id = %account_id,
            error = %error,
            "telegram polling offset persistence failed"
        );
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
    let configured_webhook_url = webhook_info
        .url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let webhook_matched = runtime_webhook_url.as_ref().map(|runtime_url| {
        configured_webhook_url
            .as_deref()
            .map(|configured| configured == runtime_url)
            .unwrap_or(false)
    });

    let detail = if let Some(last_error) = webhook_info
        .last_error_message
        .filter(|item| !item.trim().is_empty())
    {
        format!("telegram webhook reports error: {last_error}")
    } else if !webhook_info.ok {
        webhook_info
            .description
            .unwrap_or_else(|| "telegram getWebhookInfo failed".to_string())
    } else {
        "telegram account health check passed".to_string()
    };

    Ok(TelegramHealthSnapshot {
        channel: "telegram".to_string(),
        account_id: record.account_id.clone(),
        ok: me.ok,
        status: if me.ok {
            "ok".to_string()
        } else {
            "auth_failed".to_string()
        },
        detail,
        mode: record.mode.clone(),
        bot_username: me.username,
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
        .url
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

/// Send a "typing" chat action to the Telegram chat to indicate the bot is
/// composing a reply. This should be called before the first preview message
/// is sent. The indicator automatically expires after ~5s or when a message
/// is delivered.
pub async fn send_typing_action(
    app: &AppHandle,
    account_id: Option<&str>,
    peer_id: &str,
) -> Result<(), String> {
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: peer id is required".to_string());
    }

    let account_id = normalize_account_id(account_id);
    let key = account_id.to_ascii_lowercase();
    let store = load_store(app)?;
    let Some(record) = store.telegram_accounts.get(&key).cloned() else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: telegram account {}",
            account_id
        ));
    };
    if !record.enabled {
        return Err("CHANNEL_CONNECTOR_DISABLED: telegram account is disabled".to_string());
    }

    let token = load_bot_token(&record)?;
    let peer_owned = peer_id.to_string();
    tokio::task::spawn_blocking(move || telegram_send_chat_action(&token, &peer_owned, "typing"))
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))??;

    Ok(())
}

pub async fn send_text_reply(
    app: &AppHandle,
    account_id: Option<&str>,
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<TelegramSendSnapshot, String> {
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: peer id is required".to_string());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: text is required".to_string());
    }

    let account_id = normalize_account_id(account_id);
    let key = account_id.to_ascii_lowercase();
    let store = load_store(app)?;
    let Some(record) = store.telegram_accounts.get(&key).cloned() else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: telegram account {}",
            account_id
        ));
    };
    if !record.enabled {
        return Err("CHANNEL_CONNECTOR_DISABLED: telegram account is disabled".to_string());
    }

    let token = load_bot_token(&record)?;
    let peer_owned = peer_id.to_string();
    let text_owned = text.to_string();
    let reply_to_owned = reply_to_message_id.map(ToString::to_string);
    let send_result = tokio::task::spawn_blocking(move || {
        telegram_send_message(&token, &peer_owned, &text_owned, reply_to_owned.as_deref())
    })
    .await
    .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))??;

    Ok(TelegramSendSnapshot {
        channel: "telegram".to_string(),
        account_id: record.account_id,
        peer_id: send_result.peer_id,
        message_id: send_result.message_id,
        delivered_at_ms: now_ms(),
    })
}

pub async fn edit_text_reply(
    app: &AppHandle,
    account_id: Option<&str>,
    peer_id: &str,
    message_id: &str,
    text: &str,
) -> Result<TelegramSendSnapshot, String> {
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: peer id is required".to_string());
    }
    let message_id = message_id.trim();
    if message_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: message id is required".to_string());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: text is required".to_string());
    }

    let account_id = normalize_account_id(account_id);
    let key = account_id.to_ascii_lowercase();
    let store = load_store(app)?;
    let Some(record) = store.telegram_accounts.get(&key).cloned() else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: telegram account {}",
            account_id
        ));
    };
    if !record.enabled {
        return Err("CHANNEL_CONNECTOR_DISABLED: telegram account is disabled".to_string());
    }

    let token = load_bot_token(&record)?;
    let peer_owned = peer_id.to_string();
    let message_id_owned = message_id.to_string();
    let text_owned = text.to_string();
    let edit_result = tokio::task::spawn_blocking(move || {
        telegram_edit_message(&token, &peer_owned, &message_id_owned, &text_owned)
    })
    .await
    .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))??;

    Ok(TelegramSendSnapshot {
        channel: "telegram".to_string(),
        account_id: record.account_id,
        peer_id: edit_result.peer_id,
        message_id: edit_result.message_id,
        delivered_at_ms: now_ms(),
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
        if let Err(error) =
            tokio::task::spawn_blocking(move || telegram_delete_webhook(&token_for_delete))
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

    let offset = resolve_poll_offset(app, &account_id, &token);
    let token_for_updates = token.clone();
    let updates =
        tokio::task::spawn_blocking(move || telegram_get_updates(&token_for_updates, offset))
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
    let Some(items) = updates.items else {
        return Ok(());
    };

    let mut max_update_id: Option<i64> = None;
    for item in items {
        if let Some(update_id) = item
            .get("update_id")
            .and_then(serde_json::Value::as_i64)
            .or_else(|| {
                item.get("update_id")
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value as i64)
            })
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
        persist_poll_offset(app, &account_id, &token, max_update_id.saturating_add(1));
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
