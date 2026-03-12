use tauri::AppHandle;

use super::api::{fetch_tenant_access_token, get_bot_info};
use super::types::{FeishuConnectionMode, FeishuHealthSnapshot};

pub async fn health_check(
    app: &AppHandle,
    account_id: Option<&str>,
    runtime_webhook_url: Option<String>,
    runtime_connected: bool,
) -> Result<FeishuHealthSnapshot, String> {
    let account_id = super::normalize_account_id(account_id);
    let account_key = account_id.to_ascii_lowercase();
    let Some(record) = super::account_store::get_record(app, &account_key)? else {
        return Err(format!(
            "CHANNEL_CONNECTOR_NOT_FOUND: feishu account {}",
            account_id
        ));
    };

    let mode = record.connection_mode.as_str().to_string();
    let domain = record.domain.as_str().to_string();
    let runtime_webhook = runtime_webhook_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if !record.enabled {
        return Ok(FeishuHealthSnapshot {
            channel: "feishu".to_string(),
            account_id: record.account_id,
            ok: false,
            status: "disabled".to_string(),
            detail: "connector account is disabled".to_string(),
            mode: mode.clone(),
            connection_mode: mode,
            domain,
            bot_name: None,
            bot_open_id: None,
            runtime_connected,
            configured_webhook_url: None,
            runtime_webhook_url: runtime_webhook,
            webhook_matched: None,
            checked_at_ms: super::now_ms(),
        });
    }

    let app_secret = super::load_app_secret(&record)?;
    let tenant_access_token =
        match fetch_tenant_access_token(record.domain, &record.app_id, &app_secret) {
            Ok(token) => token,
            Err(error) => {
                return Ok(FeishuHealthSnapshot {
                    channel: "feishu".to_string(),
                    account_id: record.account_id,
                    ok: false,
                    status: "auth_failed".to_string(),
                    detail: error,
                    mode: mode.clone(),
                    connection_mode: mode,
                    domain,
                    bot_name: None,
                    bot_open_id: None,
                    runtime_connected,
                    configured_webhook_url: None,
                    runtime_webhook_url: runtime_webhook,
                    webhook_matched: None,
                    checked_at_ms: super::now_ms(),
                });
            }
        };

    let bot_info = match get_bot_info(record.domain, &tenant_access_token) {
        Ok(info) => info,
        Err(error) => {
            let status = if error.starts_with("CHANNEL_CONNECTOR_AUTH_FAILED:") {
                "auth_failed"
            } else {
                "provider_unavailable"
            };
            return Ok(FeishuHealthSnapshot {
                channel: "feishu".to_string(),
                account_id: record.account_id,
                ok: false,
                status: status.to_string(),
                detail: error,
                mode: mode.clone(),
                connection_mode: mode,
                domain,
                bot_name: None,
                bot_open_id: None,
                runtime_connected,
                configured_webhook_url: None,
                runtime_webhook_url: runtime_webhook,
                webhook_matched: None,
                checked_at_ms: super::now_ms(),
            });
        }
    };

    let configured_webhook_url = if record.connection_mode == FeishuConnectionMode::Webhook {
        Some(super::webhook::runtime_callback_url(
            &record,
            runtime_webhook_url.as_deref(),
        ))
    } else {
        None
    };
    let webhook_matched = if record.connection_mode == FeishuConnectionMode::Webhook {
        Some(
            configured_webhook_url
                .as_deref()
                .zip(runtime_webhook_url.as_deref())
                .map(|(configured, runtime)| configured.trim() == runtime.trim())
                .unwrap_or(false),
        )
    } else {
        None
    };

    Ok(FeishuHealthSnapshot {
        channel: "feishu".to_string(),
        account_id: record.account_id,
        ok: true,
        status: "ok".to_string(),
        detail: if record.connection_mode == FeishuConnectionMode::Webhook {
            if webhook_matched == Some(true) {
                "feishu bot credential probe passed; webhook callback matches runtime".to_string()
            } else {
                "feishu bot credential probe passed; configure the callback URL shown by GT Office in Feishu Open Platform".to_string()
            }
        } else if runtime_connected {
            "feishu bot credential probe passed; websocket runtime is active".to_string()
        } else {
            "feishu bot credential probe passed; websocket runtime is starting or reconnecting"
                .to_string()
        },
        mode: mode.clone(),
        connection_mode: mode,
        domain,
        bot_name: bot_info.bot_name,
        bot_open_id: bot_info.bot_open_id,
        runtime_connected,
        configured_webhook_url,
        runtime_webhook_url: runtime_webhook,
        webhook_matched,
        checked_at_ms: super::now_ms(),
    })
}
