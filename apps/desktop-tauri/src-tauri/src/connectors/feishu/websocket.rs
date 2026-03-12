use feishu_sdk::{
    core::{noop_logger, Config, FEISHU_BASE_URL, LARK_BASE_URL},
    event::{Event, EventDispatcher, EventDispatcherConfig, EventHandler, EventResp},
    ws::{StreamClient, StreamConfig},
};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    pin::Pin,
    sync::{OnceLock, RwLock},
    time::Duration,
};
use tauri::{async_runtime::JoinHandle, AppHandle};
use tracing::{debug, warn};

use crate::{app_state::AppState, commands::tool_adapter::process_external_inbound_message};

use super::{
    account_store::list_records,
    types::{FeishuConnectionMode, FeishuDomain},
};

static WORKERS: OnceLock<RwLock<HashMap<String, JoinHandle<()>>>> = OnceLock::new();
static RUNTIME_STATUS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

fn workers() -> &'static RwLock<HashMap<String, JoinHandle<()>>> {
    WORKERS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn runtime_status() -> &'static RwLock<HashSet<String>> {
    RUNTIME_STATUS.get_or_init(|| RwLock::new(HashSet::new()))
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

struct MessageEventHandler {
    app: AppHandle,
    state: AppState,
    account_id: String,
}

impl EventHandler for MessageEventHandler {
    fn event_type(&self) -> &str {
        "im.message.receive_v1"
    }

    fn handle(
        &self,
        event: Event,
    ) -> Pin<Box<dyn Future<Output = Result<Option<EventResp>, feishu_sdk::core::Error>> + Send + '_>>
    {
        Box::pin(async move {
            let payload = match serde_json::to_value(&event) {
                Ok(value) => value,
                Err(error) => {
                    warn!(error = %error, "feishu websocket event encode failed");
                    return Ok(None);
                }
            };
            let parsed = match super::parse_payload_for_account(&payload, Some(&self.account_id)) {
                Ok(parsed) => parsed,
                Err(error) => {
                    warn!(error = %error, "feishu websocket payload parse failed");
                    return Ok(None);
                }
            };
            let Some(message) = parsed.message else {
                return Ok(None);
            };
            if let Err(error) = process_external_inbound_message(&self.state, &self.app, message) {
                warn!(error = %error, "feishu websocket dispatch failed");
            }
            Ok(None)
        })
    }
}

fn base_url(domain: FeishuDomain) -> &'static str {
    match domain {
        FeishuDomain::Feishu => FEISHU_BASE_URL,
        FeishuDomain::Lark => LARK_BASE_URL,
    }
}

async fn worker_loop(app: AppHandle, state: AppState, account_id: String) {
    let result = async {
        let Some(record) = super::account_store::get_record(&app, &account_id)? else {
            return Err(format!(
                "CHANNEL_CONNECTOR_NOT_FOUND: feishu account {}",
                account_id
            ));
        };
        if !record.enabled || record.connection_mode != FeishuConnectionMode::Websocket {
            return Ok(());
        }
        let app_secret = super::load_app_secret(&record)?;
        let config = Config::builder(record.app_id.clone(), app_secret)
            .base_url(base_url(record.domain))
            .request_timeout(Duration::from_secs(12))
            .build();
        let dispatcher = EventDispatcher::new(EventDispatcherConfig::new(), noop_logger());
        dispatcher
            .register_handler(Box::new(MessageEventHandler {
                app: app.clone(),
                state: state.clone(),
                account_id: record.account_id.clone(),
            }))
            .await;
        let stream_client = StreamClient::builder(config)
            .event_dispatcher(dispatcher)
            .stream_config(
                StreamConfig::new()
                    .locale("zh")
                    .reconnect_interval(Duration::from_secs(10))
                    .ping_interval(Duration::from_secs(30)),
            )
            .build()
            .map_err(|error| format!("CHANNEL_CONNECTOR_RUNTIME_START_FAILED: {error}"))?;

        mark_connected(&account_id, true);
        let result = stream_client.start().await;
        mark_connected(&account_id, false);
        result.map_err(|error| format!("CHANNEL_CONNECTOR_RUNTIME_FAILED: {error}"))
    }
    .await;

    if let Err(error) = result {
        warn!(account_id = %account_id, error = %error, "feishu websocket worker exited");
    } else {
        debug!(account_id = %account_id, "feishu websocket worker stopped");
    }
}

pub fn reconcile(app: &AppHandle, state: &AppState) {
    let desired: HashSet<String> = list_records(app)
        .unwrap_or_default()
        .into_iter()
        .filter(|record| {
            record.enabled && record.connection_mode == FeishuConnectionMode::Websocket
        })
        .map(|record| record.account_id.to_ascii_lowercase())
        .collect();

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
            let app = app.clone();
            let state = state.clone();
            let worker_account_id = account_id.clone();
            let handle = tauri::async_runtime::spawn(async move {
                worker_loop(app, state, worker_account_id).await;
            });
            guard.insert(account_id, handle);
        }
    }
}

pub fn spawn_supervisor(app: AppHandle, state: AppState) {
    reconcile(&app, &state);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            reconcile(&app, &state);
        }
    });
}
