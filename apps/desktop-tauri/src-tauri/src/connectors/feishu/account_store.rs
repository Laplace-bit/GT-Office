use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use super::types::FeishuConnectorAccountRecord;
use crate::connectors::channel_error::ChannelError;

const CONNECTOR_STORE_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStoreFile {
    version: String,
    #[serde(default)]
    feishu_accounts: HashMap<String, FeishuConnectorAccountRecord>,
}

impl Default for ConnectorStoreFile {
    fn default() -> Self {
        Self {
            version: CONNECTOR_STORE_VERSION.to_string(),
            feishu_accounts: HashMap::new(),
        }
    }
}

fn connector_store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, ChannelError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| ChannelError::Store {
            operation: "path".to_string(),
            detail: error.to_string(),
        })?;
    Ok(app_data.join("channel/feishu-connectors.json"))
}

fn load_store<R: Runtime>(app: &AppHandle<R>) -> Result<ConnectorStoreFile, ChannelError> {
    let new_path = connector_store_path(app)?;
    if new_path.exists() {
        let payload = fs::read(&new_path).map_err(|e| ChannelError::store_read(e.to_string()))?;
        return serde_json::from_slice::<ConnectorStoreFile>(&payload).map_err(|e| {
            ChannelError::Store {
                operation: "decode".to_string(),
                detail: e.to_string(),
            }
        });
    }
    // Migration: read old shared file and extract feishu accounts
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| ChannelError::Store {
            operation: "path".to_string(),
            detail: error.to_string(),
        })?;
    let old_path = app_data.join("channel/connectors.json");
    if old_path.exists() {
        let payload = fs::read(&old_path).map_err(|e| ChannelError::store_read(e.to_string()))?;
        if let Ok(old_store) = serde_json::from_slice::<serde_json::Value>(&payload) {
            if let Some(feishu_val) = old_store.get("feishuAccounts") {
                if let Ok(accounts) = serde_json::from_value::<
                    HashMap<String, FeishuConnectorAccountRecord>,
                >(feishu_val.clone())
                {
                    let migrated = ConnectorStoreFile {
                        version: CONNECTOR_STORE_VERSION.to_string(),
                        feishu_accounts: accounts,
                    };
                    if let Err(e) = save_store(app, &migrated) {
                        tracing::warn!(error = %e, "failed to save migrated feishu store");
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

fn save_store<R: Runtime>(
    app: &AppHandle<R>,
    store: &ConnectorStoreFile,
) -> Result<(), ChannelError> {
    let path = connector_store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ChannelError::store_write(e.to_string()))?;
    }
    let payload = serde_json::to_vec_pretty(store).map_err(|e| ChannelError::Store {
        operation: "encode".to_string(),
        detail: e.to_string(),
    })?;
    fs::write(path, payload).map_err(|e| ChannelError::store_write(e.to_string()))
}

pub fn list_records<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<FeishuConnectorAccountRecord>, String> {
    let store = load_store(app).map_err(|e| e.to_string())?;
    let mut accounts: Vec<_> = store.feishu_accounts.into_values().collect();
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    Ok(accounts)
}

pub fn get_record(
    app: &AppHandle<impl Runtime>,
    account_id: &str,
) -> Result<Option<FeishuConnectorAccountRecord>, String> {
    let store = load_store(app).map_err(|e| e.to_string())?;
    Ok(store.feishu_accounts.get(account_id).cloned())
}

pub fn upsert_record(
    app: &AppHandle<impl Runtime>,
    account_key: String,
    record: FeishuConnectorAccountRecord,
) -> Result<(), String> {
    let mut store = load_store(app).map_err(|e| e.to_string())?;
    store.feishu_accounts.insert(account_key, record);
    save_store(app, &store).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "tests/account_store_tests.rs"]
mod tests;
