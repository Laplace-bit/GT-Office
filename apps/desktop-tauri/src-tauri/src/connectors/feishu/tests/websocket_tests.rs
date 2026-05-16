use super::{base_url, desired_websocket_accounts, is_connected, mark_connected};
use crate::connectors::feishu::types::{
    FeishuConnectionMode, FeishuConnectorAccountRecord, FeishuDomain,
};
use std::collections::HashSet;

fn record(
    account_id: &str,
    enabled: bool,
    connection_mode: FeishuConnectionMode,
) -> FeishuConnectorAccountRecord {
    FeishuConnectorAccountRecord {
        account_id: account_id.to_string(),
        enabled,
        connection_mode,
        domain: FeishuDomain::Feishu,
        app_id: format!("app-{account_id}"),
        app_secret_ref: format!("secret-{account_id}"),
        verification_token_ref: None,
        webhook_path: None,
        webhook_host: None,
        webhook_port: None,
        updated_at_ms: 1,
    }
}

#[test]
fn base_url_tracks_feishu_and_lark_domains() {
    assert_eq!(
        base_url(FeishuDomain::Feishu),
        feishu_sdk::core::FEISHU_BASE_URL
    );
    assert_eq!(
        base_url(FeishuDomain::Lark),
        feishu_sdk::core::LARK_BASE_URL
    );
}

#[test]
fn desired_websocket_accounts_filters_enabled_bound_websocket_records() {
    let records = vec![
        record("Default", true, FeishuConnectionMode::Websocket),
        record("disabled", false, FeishuConnectionMode::Websocket),
        record("webhook", true, FeishuConnectionMode::Webhook),
        record("unbound", true, FeishuConnectionMode::Websocket),
    ];
    let needed = HashSet::from([
        ("feishu".to_string(), "default".to_string()),
        ("feishu".to_string(), "disabled".to_string()),
        ("feishu".to_string(), "webhook".to_string()),
        ("telegram".to_string(), "unbound".to_string()),
    ]);

    let desired = desired_websocket_accounts(records, &needed);

    assert_eq!(desired, HashSet::from(["default".to_string()]));
}

#[test]
fn desired_websocket_accounts_normalizes_case_and_deduplicates_records() {
    let records = vec![
        record("Ops", true, FeishuConnectionMode::Websocket),
        record("ops", true, FeishuConnectionMode::Websocket),
        record("OPS", true, FeishuConnectionMode::Websocket),
    ];
    let needed = HashSet::from([("feishu".to_string(), "ops".to_string())]);

    let desired = desired_websocket_accounts(records, &needed);

    assert_eq!(desired, HashSet::from(["ops".to_string()]));
}

#[test]
fn runtime_connected_status_tracks_account_ids() {
    let account_id = format!("test-ws-{}", uuid::Uuid::new_v4());
    assert!(!is_connected(&account_id));

    mark_connected(&account_id, true);
    assert!(is_connected(&account_id));

    mark_connected(&account_id, false);
    assert!(!is_connected(&account_id));
}
