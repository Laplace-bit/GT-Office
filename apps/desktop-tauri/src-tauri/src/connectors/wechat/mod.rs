mod api;
pub mod auth;
pub mod types;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
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
use gt_task::{ExternalInboundMessage, ExternalPeerKind};

use crate::{
    app_state::AppState,
    commands::tool_adapter::process_external_inbound_message,
    connectors::credential_store::{load_secret, store_secret},
};

use self::types::{
    WechatAccountUpsertInput, WechatConnectorAccountRecord, WechatConnectorAccountView,
    WechatHealthSnapshot, WechatSendSnapshot,
};

pub const DEFAULT_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const CONNECTOR_STORE_VERSION: &str = "1";
const SESSION_EXPIRED_ERRCODE: i32 = -14;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStoreFile {
    version: String,
    #[serde(default)]
    wechat_accounts: HashMap<String, WechatConnectorAccountRecord>,
}

impl Default for ConnectorStoreFile {
    fn default() -> Self {
        Self {
            version: CONNECTOR_STORE_VERSION.to_string(),
            wechat_accounts: HashMap::new(),
        }
    }
}

static WORKERS: OnceLock<RwLock<HashMap<String, tauri::async_runtime::JoinHandle<()>>>> =
    OnceLock::new();
static RUNTIME_STATUS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();
static CONTEXT_TOKENS: OnceLock<RwLock<HashMap<String, HashMap<String, String>>>> = OnceLock::new();

fn workers() -> &'static RwLock<HashMap<String, tauri::async_runtime::JoinHandle<()>>> {
    WORKERS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn runtime_status() -> &'static RwLock<HashSet<String>> {
    RUNTIME_STATUS.get_or_init(|| RwLock::new(HashSet::new()))
}

fn context_tokens() -> &'static RwLock<HashMap<String, HashMap<String, String>>> {
    CONTEXT_TOKENS.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn normalize_account_id(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn default_token_ref(account_id: &str) -> String {
    format!("wechat/{}/token", account_id.trim().to_ascii_lowercase())
}

fn connector_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    Ok(app_data.join("channel/wechat-connectors.json"))
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

fn get_record(
    app: &AppHandle,
    account_id: &str,
) -> Result<Option<WechatConnectorAccountRecord>, String> {
    let store = load_store(app)?;
    Ok(store.wechat_accounts.get(account_id).cloned())
}

fn upsert_record(
    app: &AppHandle,
    account_key: String,
    record: WechatConnectorAccountRecord,
) -> Result<(), String> {
    let mut store = load_store(app)?;
    store.wechat_accounts.insert(account_key, record);
    save_store(app, &store)
}

fn sync_buf_path(app: &AppHandle, account_id: &str) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    Ok(app_data.join(format!("channel/wechat-sync-{}.txt", account_id)))
}

fn load_sync_buf(app: &AppHandle, account_id: &str) -> Result<String, String> {
    let path = sync_buf_path(app, account_id)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|error| format!("CHANNEL_CONNECTOR_STATE_READ_FAILED: {error}"))
}

fn save_sync_buf(app: &AppHandle, account_id: &str, value: &str) -> Result<(), String> {
    let path = sync_buf_path(app, account_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STATE_WRITE_FAILED: {error}"))?;
    }
    fs::write(path, value).map_err(|error| format!("CHANNEL_CONNECTOR_STATE_WRITE_FAILED: {error}"))
}

fn has_secret(reference: &str) -> bool {
    load_secret(reference)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn to_view(record: &WechatConnectorAccountRecord) -> WechatConnectorAccountView {
    WechatConnectorAccountView {
        channel: "wechat".to_string(),
        account_id: record.account_id.clone(),
        enabled: record.enabled,
        mode: "polling".to_string(),
        token_ref: record.token_ref.clone(),
        has_token: has_secret(&record.token_ref),
        base_url: record.base_url.clone(),
        updated_at_ms: record.updated_at_ms,
        last_bound_at_ms: record.last_bound_at_ms,
        last_sync_at_ms: record.last_sync_at_ms,
    }
}

fn load_token(record: &WechatConnectorAccountRecord) -> Result<String, String> {
    load_secret(&record.token_ref)
        .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_LOAD_FAILED: {error}"))
}

pub fn list_accounts(app: &AppHandle) -> Result<Vec<WechatConnectorAccountView>, String> {
    let store = load_store(app)?;
    let mut accounts: Vec<_> = store.wechat_accounts.into_values().collect();
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    Ok(accounts.iter().map(to_view).collect())
}

pub fn upsert_account(
    app: &AppHandle,
    input: WechatAccountUpsertInput,
) -> Result<WechatConnectorAccountView, String> {
    let account_id = normalize_account_id(input.account_id.as_deref());
    let existing = get_record(app, &account_id)?;
    let enabled = input
        .enabled
        .unwrap_or_else(|| existing.as_ref().map(|item| item.enabled).unwrap_or(true));
    let base_url = input
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| existing.as_ref().map(|item| item.base_url.clone()))
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

    let token_ref = input
        .token_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| existing.as_ref().map(|item| item.token_ref.clone()))
        .unwrap_or_else(|| default_token_ref(&account_id));

    if let Some(token) = input
        .token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        store_secret(&token_ref, token)
            .map_err(|error| format!("CHANNEL_CONNECTOR_SECRET_STORE_FAILED: {error}"))?;
    }

    if !has_secret(&token_ref) {
        return Err("CHANNEL_CONNECTOR_UNCONFIGURED: wechat token is required".to_string());
    }

    let now = now_ms();
    let record = WechatConnectorAccountRecord {
        account_id: account_id.clone(),
        enabled,
        token_ref,
        base_url,
        updated_at_ms: now,
        access_policy_initialized_at_ms: existing
            .as_ref()
            .and_then(|item| item.access_policy_initialized_at_ms),
        last_bound_at_ms: existing
            .as_ref()
            .and_then(|item| item.last_bound_at_ms)
            .or(Some(now)),
        last_sync_at_ms: existing.as_ref().and_then(|item| item.last_sync_at_ms),
        last_error: existing.as_ref().and_then(|item| item.last_error.clone()),
        last_error_at_ms: existing.as_ref().and_then(|item| item.last_error_at_ms),
    };
    upsert_record(app, account_id, record.clone())?;
    Ok(to_view(&record))
}

pub fn list_accounts_with_uninitialized_policy(app: &AppHandle) -> Result<Vec<String>, String> {
    let store = load_store(app)?;
    let mut accounts: Vec<_> = store
        .wechat_accounts
        .values()
        .filter(|record| record.access_policy_initialized_at_ms.is_none())
        .map(|record| record.account_id.clone())
        .collect();
    accounts.sort();
    accounts.dedup();
    Ok(accounts)
}

pub fn mark_access_policy_initialized(app: &AppHandle, account_id: &str) -> Result<(), String> {
    let store = load_store(app)?;
    let Some((account_key, mut record)) = store
        .wechat_accounts
        .into_iter()
        .find(|(key, _)| key.trim().eq_ignore_ascii_case(account_id))
    else {
        return Ok(());
    };
    record.access_policy_initialized_at_ms = Some(now_ms());
    upsert_record(app, account_key, record)
}

pub(crate) fn save_bound_account(
    app: &AppHandle,
    account_id: &str,
    token: &str,
    base_url: &str,
) -> Result<(), String> {
    let _ = upsert_account(
        app,
        WechatAccountUpsertInput {
            account_id: Some(account_id.to_string()),
            enabled: Some(true),
            token: Some(token.to_string()),
            token_ref: None,
            base_url: Some(base_url.to_string()),
        },
    )?;
    Ok(())
}

fn update_account_runtime_state(
    app: &AppHandle,
    account_id: &str,
    last_sync_at_ms: Option<u64>,
    last_error: Option<String>,
) {
    let Ok(Some(mut record)) = get_record(app, account_id) else {
        return;
    };
    record.updated_at_ms = now_ms();
    if let Some(sync_at) = last_sync_at_ms {
        record.last_sync_at_ms = Some(sync_at);
    }
    record.last_error = last_error.clone();
    record.last_error_at_ms = last_error.as_ref().map(|_| now_ms());
    let _ = upsert_record(app, account_id.to_string(), record);
}

fn mark_connected(account_id: &str, connected: bool) {
    if let Ok(mut guard) = runtime_status().write() {
        if connected {
            guard.insert(account_id.to_string());
        } else {
            guard.remove(account_id);
        }
    }
}

pub fn is_connected(account_id: &str) -> bool {
    runtime_status()
        .read()
        .map(|guard| guard.contains(account_id))
        .unwrap_or(false)
}

fn cache_context_token(account_id: &str, user_id: &str, context_token: &str) {
    if let Ok(mut guard) = context_tokens().write() {
        let account_cache = guard.entry(account_id.to_string()).or_default();
        account_cache.insert(user_id.to_string(), context_token.to_string());
    }
}

fn load_context_token(account_id: &str, user_id: &str) -> Option<String> {
    context_tokens().read().ok().and_then(|guard| {
        guard
            .get(account_id)
            .and_then(|cache| cache.get(user_id))
            .cloned()
    })
}

fn extract_text(msg: &api::WeixinMessage) -> String {
    msg.item_list
        .iter()
        .filter(|item| item.type_ == 1)
        .filter_map(|item| item.text_item.as_ref()?.text.as_deref())
        .collect::<Vec<_>>()
        .join("")
}

fn parse_inbound_message(
    account_id: &str,
    msg: &api::WeixinMessage,
) -> Option<ExternalInboundMessage> {
    if msg.message_type == 2 {
        return None;
    }
    let text = extract_text(msg);
    if text.trim().is_empty() {
        return None;
    }
    let sender_id = msg.from_user_id.trim();
    if sender_id.is_empty() {
        return None;
    }
    if let Some(context_token) = msg.context_token.as_deref() {
        if !context_token.trim().is_empty() {
            cache_context_token(account_id, sender_id, context_token);
        }
    }
    let created_at = msg.create_time_ms.unwrap_or_else(now_ms);
    let message_id = format!("{sender_id}-{created_at}");
    Some(ExternalInboundMessage {
        channel: "wechat".to_string(),
        account_id: account_id.to_string(),
        peer_kind: ExternalPeerKind::Direct,
        peer_id: sender_id.to_string(),
        sender_id: sender_id.to_string(),
        sender_name: Some(sender_id.to_string()),
        message_id: message_id.clone(),
        text,
        idempotency_key: Some(format!("wechat-{account_id}-{message_id}")),
        workspace_id_hint: None,
        target_agent_id_hint: None,
        metadata: json!({
            "source": "wechat",
            "fromUserId": sender_id,
            "createTimeMs": created_at,
        }),
    })
}

async fn worker_loop(app: AppHandle, state: AppState, account_id: String) {
    let client = Client::new();
    mark_connected(&account_id, true);

    loop {
        let Some(record) = get_record(&app, &account_id).ok().flatten() else {
            break;
        };
        if !record.enabled {
            break;
        }

        let token = match load_token(&record) {
            Ok(token) => token,
            Err(error) => {
                update_account_runtime_state(&app, &account_id, None, Some(error));
                sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        let buf = load_sync_buf(&app, &account_id).unwrap_or_default();
        match api::get_updates(&client, &record.base_url, &token, &buf).await {
            Ok(resp) => {
                let errcode = resp.errcode.unwrap_or(0);
                let ret = resp.ret;
                if errcode != 0 || ret != 0 {
                    let code = if errcode != 0 { errcode } else { ret };
                    let detail = resp
                        .errmsg
                        .unwrap_or_else(|| format!("wechat getupdates error {code}"));
                    update_account_runtime_state(
                        &app,
                        &account_id,
                        None,
                        Some(if code == SESSION_EXPIRED_ERRCODE {
                            "CHANNEL_CONNECTOR_AUTH_EXPIRED: wechat token expired".to_string()
                        } else {
                            format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {detail}")
                        }),
                    );
                    if code == SESSION_EXPIRED_ERRCODE {
                        let _ = save_sync_buf(&app, &account_id, "");
                        sleep(Duration::from_secs(10)).await;
                    } else {
                        sleep(Duration::from_secs(3)).await;
                    }
                    continue;
                }

                for msg in &resp.msgs {
                    let Some(inbound) = parse_inbound_message(&account_id, msg) else {
                        continue;
                    };
                    if let Err(error) = process_external_inbound_message(&state, &app, inbound) {
                        warn!(
                            account_id = %account_id,
                            error = %error,
                            "wechat polling dispatch failed"
                        );
                    }
                }

                if let Some(new_buf) = resp.get_updates_buf {
                    if new_buf != buf {
                        let _ = save_sync_buf(&app, &account_id, &new_buf);
                    }
                }
                update_account_runtime_state(&app, &account_id, Some(now_ms()), None);
            }
            Err(error) => {
                update_account_runtime_state(&app, &account_id, None, Some(error.clone()));
                debug!(account_id = %account_id, error = %error, "wechat polling cycle failed");
                sleep(Duration::from_secs(3)).await;
            }
        }
    }

    mark_connected(&account_id, false);
}

fn desired_accounts(app: &AppHandle) -> Vec<String> {
    let Ok(store) = load_store(app) else {
        return Vec::new();
    };
    let mut items: Vec<String> = store
        .wechat_accounts
        .values()
        .filter(|record| record.enabled)
        .map(|record| record.account_id.clone())
        .collect();
    items.sort();
    items
}

pub fn reconcile(app: &AppHandle, state: &AppState) {
    let desired: HashSet<String> = desired_accounts(app).into_iter().collect();
    if let Ok(mut guard) = workers().write() {
        let existing: Vec<String> = guard.keys().cloned().collect();
        for account_id in existing {
            let finished = guard
                .get(&account_id)
                .map(|handle| handle.inner().is_finished())
                .unwrap_or(false);
            if finished {
                guard.remove(&account_id);
                mark_connected(&account_id, false);
            }
            if desired.contains(&account_id) {
                continue;
            }
            if let Some(handle) = guard.remove(&account_id) {
                handle.abort();
            }
            mark_connected(&account_id, false);
        }

        for account_id in desired {
            if guard.contains_key(&account_id) {
                continue;
            }
            let handle = tauri::async_runtime::spawn(worker_loop(
                app.clone(),
                state.clone(),
                account_id.clone(),
            ));
            guard.insert(account_id, handle);
        }
    }
}

pub fn spawn_polling_supervisor(app: AppHandle, state: AppState) {
    reconcile(&app, &state);
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(10)).await;
            reconcile(&app, &state);
        }
    });
}

pub async fn health_check(
    app: &AppHandle,
    account_id: Option<&str>,
) -> Result<WechatHealthSnapshot, String> {
    let account_id = normalize_account_id(account_id);
    let Some(record) = get_record(app, &account_id)? else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: wechat account {}",
            account_id
        ));
    };

    if !record.enabled {
        return Ok(WechatHealthSnapshot {
            channel: "wechat".to_string(),
            account_id: record.account_id,
            ok: false,
            status: "disabled".to_string(),
            detail: "connector account is disabled".to_string(),
            mode: "polling".to_string(),
            runtime_connected: false,
            checked_at_ms: now_ms(),
            last_sync_at_ms: record.last_sync_at_ms,
            bot_display_name: Some("WeChat Bot".to_string()),
        });
    }

    let token = load_token(&record)?;
    let client = Client::new();
    let sync_buf = load_sync_buf(app, &record.account_id).unwrap_or_default();
    let probe = api::probe_updates(&client, &record.base_url, &token, &sync_buf).await?;
    let code = probe.errcode.unwrap_or(0);
    let ok = code == 0 && probe.ret == 0;
    let (status, detail) = if ok {
        ("ok".to_string(), "wechat token probe passed".to_string())
    } else if code == SESSION_EXPIRED_ERRCODE {
        (
            "auth_failed".to_string(),
            "wechat token expired; rebind is required".to_string(),
        )
    } else {
        (
            "provider_unavailable".to_string(),
            probe
                .errmsg
                .unwrap_or_else(|| format!("wechat getupdates error {}", probe.ret)),
        )
    };

    Ok(WechatHealthSnapshot {
        channel: "wechat".to_string(),
        account_id: record.account_id,
        ok,
        status,
        detail,
        mode: "polling".to_string(),
        runtime_connected: is_connected(&account_id),
        checked_at_ms: now_ms(),
        last_sync_at_ms: record.last_sync_at_ms,
        bot_display_name: Some("WeChat Bot".to_string()),
    })
}

pub async fn send_text_reply(
    app: &AppHandle,
    account_id: Option<&str>,
    peer_id: &str,
    text: &str,
    _reply_to_message_id: Option<&str>,
) -> Result<WechatSendSnapshot, String> {
    let account_id = normalize_account_id(account_id);
    let Some(record) = get_record(app, &account_id)? else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: wechat account {}",
            account_id
        ));
    };
    if !record.enabled {
        return Err("CHANNEL_CONNECTOR_DISABLED: wechat account is disabled".to_string());
    }
    let context_token = load_context_token(&account_id, peer_id).ok_or_else(|| {
        "CHANNEL_CONNECTOR_CONTEXT_MISSING: no reply context for this user".to_string()
    })?;
    let token = load_token(&record)?;
    let client = Client::new();
    let message_id = api::send_message(
        &client,
        &record.base_url,
        &token,
        peer_id,
        &context_token,
        text,
    )
    .await?;
    Ok(WechatSendSnapshot {
        channel: "wechat".to_string(),
        account_id,
        peer_id: peer_id.to_string(),
        message_id,
        delivered_at_ms: now_ms(),
    })
}
