use tauri::AppHandle;

use super::account_store::get_record;
use super::types::{FeishuConnectionMode, FeishuConnectorAccountRecord, FeishuWebhookSyncSnapshot};

fn normalize_host(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

fn normalize_path(account_id: &str, value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("/feishu/{}/events", account_id.trim().to_ascii_lowercase()))
}

pub fn runtime_callback_url(
    record: &FeishuConnectorAccountRecord,
    runtime_webhook_url: Option<&str>,
) -> String {
    if let Some(runtime_url) = runtime_webhook_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return runtime_url.to_string();
    }

    let host =
        normalize_host(record.webhook_host.as_deref()).unwrap_or_else(|| "127.0.0.1".to_string());
    let port = record.webhook_port.unwrap_or(3000);
    let path = normalize_path(&record.account_id, record.webhook_path.as_deref());
    format!("http://{host}:{port}{path}")
}

pub fn sync_runtime_webhook(
    app: &AppHandle,
    account_id: Option<&str>,
    runtime_webhook_url: Option<&str>,
) -> Result<FeishuWebhookSyncSnapshot, String> {
    let account_id = super::normalize_account_id(account_id);
    let account_key = account_id.to_ascii_lowercase();
    let Some(record) = get_record(app, &account_key)? else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: feishu account {}",
            account_id
        ));
    };
    if !record.enabled {
        return Err("CHANNEL_CONNECTOR_DISABLED: feishu account is disabled".to_string());
    }
    if record.connection_mode != FeishuConnectionMode::Webhook {
        return Err(
            "CHANNEL_CONNECTOR_MODE_INVALID: webhook sync requires feishu webhook mode".to_string(),
        );
    }
    let webhook_url = runtime_callback_url(&record, runtime_webhook_url)
        .trim()
        .to_string();
    let matched = runtime_webhook_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value == webhook_url)
        .unwrap_or(false);

    Ok(FeishuWebhookSyncSnapshot {
        channel: "feishu".to_string(),
        account_id: record.account_id,
        ok: true,
        webhook_url,
        webhook_matched: matched,
        detail: if matched {
            "use this callback URL in Feishu event subscription settings".to_string()
        } else {
            "runtime webhook differs from stored Feishu callback settings".to_string()
        },
        checked_at_ms: super::now_ms(),
    })
}
