use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const OFFSET_STORE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OffsetStateFile {
    version: u32,
    last_update_id: i64,
    #[serde(default)]
    bot_id: Option<String>,
}

fn normalize_account_id(account_id: &str) -> String {
    let trimmed = account_id.trim();
    if trimmed.is_empty() {
        return "default".to_string();
    }
    trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn extract_bot_id(token: &str) -> Option<String> {
    let raw = token.trim();
    if raw.is_empty() {
        return None;
    }
    let mut parts = raw.splitn(2, ':');
    let bot_id = parts.next().unwrap_or_default().trim();
    if bot_id.is_empty() || !bot_id.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(bot_id.to_string())
}

fn offset_store_path(app: &AppHandle, account_id: &str) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_OFFSET_PATH_FAILED: {error}"))?;
    Ok(app_data.join("channel").join("telegram").join(format!(
        "update-offset-{}.json",
        normalize_account_id(account_id)
    )))
}

pub(super) fn read_offset(
    app: &AppHandle,
    account_id: &str,
    token: &str,
) -> Result<Option<i64>, String> {
    let path = offset_store_path(app, account_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let payload = fs::read(&path)
        .map_err(|error| format!("CHANNEL_CONNECTOR_OFFSET_READ_FAILED: {error}"))?;
    let state: OffsetStateFile = serde_json::from_slice(&payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_OFFSET_DECODE_FAILED: {error}"))?;
    if state.version != OFFSET_STORE_VERSION {
        return Ok(None);
    }
    let expected_bot_id = extract_bot_id(token);
    if let (Some(expected), Some(stored)) = (expected_bot_id, state.bot_id) {
        if expected != stored {
            return Ok(None);
        }
    }
    Ok(Some(state.last_update_id))
}

pub(super) fn write_offset(
    app: &AppHandle,
    account_id: &str,
    token: &str,
    last_update_id: i64,
) -> Result<(), String> {
    let path = offset_store_path(app, account_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("CHANNEL_CONNECTOR_OFFSET_WRITE_FAILED: {error}"))?;
    }
    let state = OffsetStateFile {
        version: OFFSET_STORE_VERSION,
        last_update_id,
        bot_id: extract_bot_id(token),
    };
    let payload = serde_json::to_vec_pretty(&state)
        .map_err(|error| format!("CHANNEL_CONNECTOR_OFFSET_ENCODE_FAILED: {error}"))?;
    fs::write(path, payload)
        .map_err(|error| format!("CHANNEL_CONNECTOR_OFFSET_WRITE_FAILED: {error}"))
}
