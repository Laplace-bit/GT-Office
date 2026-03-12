use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

use super::types::FeishuConnectorAccountRecord;

const CONNECTOR_STORE_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStoreFile {
    version: String,
    #[serde(default)]
    telegram_accounts: HashMap<String, Value>,
    #[serde(default)]
    feishu_accounts: HashMap<String, FeishuConnectorAccountRecord>,
}

impl Default for ConnectorStoreFile {
    fn default() -> Self {
        Self {
            version: CONNECTOR_STORE_VERSION.to_string(),
            telegram_accounts: HashMap::new(),
            feishu_accounts: HashMap::new(),
        }
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

pub fn list_records(app: &AppHandle) -> Result<Vec<FeishuConnectorAccountRecord>, String> {
    let store = load_store(app)?;
    let mut accounts: Vec<_> = store.feishu_accounts.into_values().collect();
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    Ok(accounts)
}

pub fn get_record(
    app: &AppHandle,
    account_id: &str,
) -> Result<Option<FeishuConnectorAccountRecord>, String> {
    let store = load_store(app)?;
    Ok(store.feishu_accounts.get(account_id).cloned())
}

pub fn upsert_record(
    app: &AppHandle,
    account_key: String,
    record: FeishuConnectorAccountRecord,
) -> Result<(), String> {
    let mut store = load_store(app)?;
    store.feishu_accounts.insert(account_key, record);
    save_store(app, &store)
}
