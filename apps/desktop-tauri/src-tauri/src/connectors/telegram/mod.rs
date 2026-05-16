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
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::{sleep, Duration};
use tracing::{debug, warn};

use crate::{
    app_state::AppState,
    commands::tool_adapter::{needed_channel_accounts, process_external_inbound_message},
    connectors::backoff::BackoffPolicy,
};

use super::credential_store::{load_secret, store_secret};
use api::{
    telegram_answer_callback_query, telegram_delete_message, telegram_delete_webhook,
    telegram_edit_message, telegram_get_me, telegram_get_updates, telegram_get_webhook_info,
    telegram_send_chat_action, telegram_send_message, telegram_set_webhook,
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

#[derive(Debug, Clone)]
pub struct TelegramInlineKeyboardButton {
    pub text: String,
    pub callback_data: String,
}

pub type TelegramInlineKeyboard = Vec<Vec<TelegramInlineKeyboardButton>>;

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
    if value < 0 {
        return;
    }
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

fn extract_callback_query_id(metadata: &serde_json::Value) -> Option<String> {
    api::json_to_string(
        metadata
            .get("callback_query")
            .and_then(|value| value.get("id")),
    )
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

fn connector_store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    Ok(app_data.join("channel/telegram-connectors.json"))
}

fn load_store<R: Runtime>(app: &AppHandle<R>) -> Result<ConnectorStoreFile, String> {
    let new_path = connector_store_path(app)?;
    if new_path.exists() {
        let payload = fs::read(&new_path)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_READ_FAILED: {error}"))?;
        return serde_json::from_slice::<ConnectorStoreFile>(&payload)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_DECODE_FAILED: {error}"));
    }
    // Migration: read old shared file and extract telegram accounts
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    let old_path = app_data.join("channel/connectors.json");
    if old_path.exists() {
        let payload = fs::read(&old_path)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_READ_FAILED: {error}"))?;
        if let Ok(old_store) = serde_json::from_slice::<serde_json::Value>(&payload) {
            if let Some(telegram_val) = old_store.get("telegramAccounts") {
                if let Ok(accounts) = serde_json::from_value::<HashMap<String, TelegramAccountRecord>>(
                    telegram_val.clone(),
                ) {
                    let migrated = ConnectorStoreFile {
                        version: CONNECTOR_STORE_VERSION.to_string(),
                        telegram_accounts: accounts,
                    };
                    if let Err(e) = save_store(app, &migrated) {
                        warn!(error = %e, "failed to save migrated telegram store");
                    } else {
                        let backup = app_data.join("channel/connectors.json.bak");
                        let _ = fs::rename(&old_path, &backup);
                    }
                    return Ok(migrated);
                }
            }
        }
    }
    Ok(ConnectorStoreFile::default())
}

fn save_store<R: Runtime>(app: &AppHandle<R>, store: &ConnectorStoreFile) -> Result<(), String> {
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

pub fn account_id_for_webhook_secret(
    app: &AppHandle<impl Runtime>,
    webhook_secret: &str,
) -> Result<Option<String>, String> {
    let store = load_store(app)?;
    account_id_for_webhook_secret_in_store(&store, webhook_secret, load_secret)
}

fn account_id_for_webhook_secret_in_store<F, E>(
    store: &ConnectorStoreFile,
    webhook_secret: &str,
    load_secret_value: F,
) -> Result<Option<String>, String>
where
    F: Fn(&str) -> Result<String, E>,
    E: std::fmt::Display,
{
    let webhook_secret = webhook_secret.trim();
    if webhook_secret.is_empty() {
        return Ok(None);
    }

    for record in store.telegram_accounts.values() {
        if !record.enabled || record.mode != "webhook" {
            continue;
        }
        let Some(reference) = record.webhook_secret_ref.as_deref() else {
            continue;
        };
        let configured_secret = load_secret_value(reference)
            .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_LOAD_FAILED: {error}"))?;
        if configured_secret.trim().is_empty() {
            continue;
        }
        if configured_secret.trim() == webhook_secret {
            return Ok(Some(record.account_id.clone()));
        }
    }
    Ok(None)
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

pub fn list_accounts(
    app: &AppHandle<impl Runtime>,
) -> Result<Vec<TelegramConnectorAccountView>, String> {
    let store = load_store(app)?;
    let mut accounts: Vec<TelegramConnectorAccountView> =
        store.telegram_accounts.values().map(to_view).collect();
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    Ok(accounts)
}

pub fn upsert_account(
    app: &AppHandle<impl Runtime>,
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
    app: &AppHandle<impl Runtime>,
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
    let me = telegram_get_me(&token).await?;
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

    let webhook_info = telegram_get_webhook_info(&token).await?;
    let configured_webhook_url = webhook_info
        .url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let webhook_matched = runtime_webhook_url
        .as_deref()
        .map(|runtime_url| webhook_urls_match(configured_webhook_url.as_deref(), runtime_url));

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

fn webhook_urls_match(configured_webhook_url: Option<&str>, runtime_webhook_url: &str) -> bool {
    let Some(configured) = configured_webhook_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    configured == runtime_webhook_url.trim()
}

pub async fn sync_runtime_webhook(
    app: &AppHandle<impl Runtime>,
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

    telegram_set_webhook(&token, runtime_webhook_url, webhook_secret.as_deref()).await?;
    let webhook_info = telegram_get_webhook_info(&token).await?;
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
    app: &AppHandle<impl Runtime>,
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
    telegram_send_chat_action(&token, peer_id, "typing")
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;

    Ok(())
}

pub async fn send_text_reply(
    app: &AppHandle<impl Runtime>,
    account_id: Option<&str>,
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<TelegramSendSnapshot, String> {
    send_text_reply_with_inline_keyboard(app, account_id, peer_id, text, reply_to_message_id, None)
        .await
}

fn keyboard_to_reply_markup(
    keyboard: Option<&TelegramInlineKeyboard>,
) -> Option<serde_json::Value> {
    let keyboard = keyboard?;
    let rows = keyboard
        .iter()
        .map(|row| {
            row.iter()
                .filter_map(|button| {
                    let text = button.text.trim();
                    let callback_data = button.callback_data.trim();
                    if text.is_empty() || callback_data.is_empty() {
                        return None;
                    }
                    Some(serde_json::json!({
                        "text": text,
                        "callback_data": callback_data,
                    }))
                })
                .collect::<Vec<_>>()
        })
        .filter(|row| !row.is_empty())
        .collect::<Vec<_>>();
    if rows.is_empty() {
        return None;
    }
    Some(serde_json::json!({
        "inline_keyboard": rows,
    }))
}
pub async fn send_text_reply_with_inline_keyboard(
    app: &AppHandle<impl Runtime>,
    account_id: Option<&str>,
    peer_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
    keyboard: Option<&TelegramInlineKeyboard>,
) -> Result<TelegramSendSnapshot, String> {
    let (peer_id, text) = validate_send_input(peer_id, text)?;

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
    let reply_markup = keyboard_to_reply_markup(keyboard);
    let send_result =
        telegram_send_message(&token, peer_id, text, reply_to_message_id, reply_markup)
            .await
            .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;

    Ok(TelegramSendSnapshot {
        channel: "telegram".to_string(),
        account_id: record.account_id,
        peer_id: send_result.peer_id,
        message_id: send_result.message_id,
        delivered_at_ms: now_ms(),
    })
}

pub async fn edit_text_reply(
    app: &AppHandle<impl Runtime>,
    account_id: Option<&str>,
    peer_id: &str,
    message_id: &str,
    text: &str,
) -> Result<TelegramSendSnapshot, String> {
    edit_text_reply_with_inline_keyboard(app, account_id, peer_id, message_id, text, None).await
}

pub async fn edit_text_reply_with_inline_keyboard(
    app: &AppHandle<impl Runtime>,
    account_id: Option<&str>,
    peer_id: &str,
    message_id: &str,
    text: &str,
    keyboard: Option<&TelegramInlineKeyboard>,
) -> Result<TelegramSendSnapshot, String> {
    let (peer_id, message_id, text) = validate_edit_input(peer_id, message_id, text)?;

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
    let reply_markup = keyboard_to_reply_markup(keyboard);
    let edit_result = telegram_edit_message(&token, peer_id, message_id, text, reply_markup)
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;

    Ok(TelegramSendSnapshot {
        channel: "telegram".to_string(),
        account_id: record.account_id,
        peer_id: edit_result.peer_id,
        message_id: edit_result.message_id,
        delivered_at_ms: now_ms(),
    })
}

fn validate_send_input<'a>(peer_id: &'a str, text: &'a str) -> Result<(&'a str, &'a str), String> {
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

fn validate_edit_input<'a>(
    peer_id: &'a str,
    message_id: &'a str,
    text: &'a str,
) -> Result<(&'a str, &'a str, &'a str), String> {
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: peer id is required".to_string());
    }
    let message_id = message_id.trim();
    validate_message_id(message_id)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: text is required".to_string());
    }
    Ok((peer_id, message_id, text))
}

pub async fn delete_message(
    app: &AppHandle<impl Runtime>,
    account_id: Option<&str>,
    peer_id: &str,
    message_id: &str,
) -> Result<(), String> {
    let (peer_id, message_id) = validate_delete_input(peer_id, message_id)?;

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
    let delete_result = telegram_delete_message(&token, peer_id, message_id)
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    if !delete_result.ok {
        return Err(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: telegram deleteMessage failed".to_string(),
        );
    }
    Ok(())
}

pub async fn answer_callback_query(
    app: &AppHandle<impl Runtime>,
    account_id: Option<&str>,
    callback_query_id: &str,
    text: Option<&str>,
) -> Result<(), String> {
    let callback_query_id = validate_callback_query_input(callback_query_id)?;

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
    telegram_answer_callback_query(&token, callback_query_id, text)
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    Ok(())
}

fn validate_delete_input<'a>(
    peer_id: &'a str,
    message_id: &'a str,
) -> Result<(&'a str, &'a str), String> {
    let peer_id = peer_id.trim();
    if peer_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: peer id is required".to_string());
    }
    let message_id = message_id.trim();
    validate_message_id(message_id)?;
    Ok((peer_id, message_id))
}

fn validate_message_id(message_id: &str) -> Result<(), String> {
    if message_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: message id is required".to_string());
    }
    if message_id
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)
        .is_none()
    {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric".to_string());
    }
    Ok(())
}

fn validate_callback_query_input(callback_query_id: &str) -> Result<&str, String> {
    let callback_query_id = callback_query_id.trim();
    if callback_query_id.is_empty() {
        return Err("CHANNEL_CONNECTOR_SEND_INVALID: callback query id is required".to_string());
    }
    Ok(callback_query_id)
}

fn polling_accounts(app: &AppHandle, state: &AppState) -> Vec<TelegramAccountRecord> {
    let needed = needed_channel_accounts(state);
    let Ok(store) = load_store(app) else {
        return Vec::new();
    };
    let mut accounts: Vec<TelegramAccountRecord> = store
        .telegram_accounts
        .values()
        .filter(|record| {
            record.enabled
                && record.mode.eq_ignore_ascii_case("polling")
                && needed.contains(&(
                    "telegram".to_string(),
                    record.account_id.to_ascii_lowercase(),
                ))
        })
        .cloned()
        .collect();
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    accounts
}

fn update_id_from_item(item: &serde_json::Value) -> Option<i64> {
    let value = item.get("update_id")?;
    if let Some(update_id) = value.as_i64().filter(|value| *value >= 0) {
        return Some(update_id);
    }
    value.as_u64().and_then(|value| i64::try_from(value).ok())
}

async fn poll_account_once(
    app: &AppHandle,
    state: &AppState,
    record: TelegramAccountRecord,
) -> Result<(), String> {
    let account_id = record.account_id.clone();
    let token = load_bot_token(&record)?;

    if !is_poll_primed(&account_id) {
        if let Err(error) = telegram_delete_webhook(&token).await {
            debug!(
                account_id = %account_id,
                error = %error,
                "telegram polling deleteWebhook failed (continuing)"
            );
        }
        mark_poll_primed(&account_id);
    }

    let offset = resolve_poll_offset(app, &account_id, &token);
    let updates = telegram_get_updates(&token, offset)
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
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
        if let Some(update_id) = update_id_from_item(&item) {
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
        let callback_query_id = extract_callback_query_id(&inbound.metadata);
        let dispatch_result = process_external_inbound_message(state, app, inbound);
        if let Some(callback_query_id) = callback_query_id {
            let _ = answer_callback_query(app, Some(&account_id), &callback_query_id, None).await;
        }
        if let Err(error) = dispatch_result {
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
    let shutdown = state.shutdown_token.clone();
    tauri::async_runtime::spawn(async move {
        let mut error_attempts: HashMap<String, u32> = HashMap::new();
        tokio::select! {
            _ = shutdown.cancelled() => {
                debug!("telegram polling worker shutting down");
            }
            _ = async {
                loop {
                    let accounts = polling_accounts(&app, &state);
                    for record in accounts {
                        let account_id = record.account_id.clone();
                        match poll_account_once(&app, &state, record).await {
                            Ok(()) => { error_attempts.remove(&account_id); }
                            Err(error) => {
                                let attempt = error_attempts.entry(account_id.clone()).or_insert(0);
                                let policy = BackoffPolicy::default();
                                if policy.should_retry(*attempt) {
                                    let delay = policy.delay_with_jitter(*attempt);
                                    warn!(account_id = %account_id, attempt = *attempt, delay_ms = delay.as_millis(), error = %error, "telegram poll error, backing off");
                                    *attempt += 1;
                                    tokio::time::sleep(delay).await;
                                } else {
                                    warn!(account_id = %account_id, "telegram poll max attempts reached, skipping");
                                }
                            }
                        }
                    }
                    sleep(Duration::from_millis(TELEGRAM_POLL_INTERVAL_MS)).await;
                }
            } => {}
        }
    });
}

#[cfg(test)]
#[path = "tests/mod_tests.rs"]
mod tests;
