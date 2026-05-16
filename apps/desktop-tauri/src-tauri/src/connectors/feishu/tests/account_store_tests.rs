use super::{ConnectorStoreFile, CONNECTOR_STORE_VERSION};
use crate::connectors::feishu::types::{
    FeishuConnectionMode, FeishuConnectorAccountRecord, FeishuDomain,
};

fn record(account_id: &str) -> FeishuConnectorAccountRecord {
    FeishuConnectorAccountRecord {
        account_id: account_id.to_string(),
        enabled: true,
        connection_mode: FeishuConnectionMode::Webhook,
        domain: FeishuDomain::Lark,
        app_id: "cli_a".to_string(),
        app_secret_ref: "feishu/acct/app_secret".to_string(),
        verification_token_ref: Some("feishu/acct/verification_token".to_string()),
        webhook_path: Some("/webhook/feishu".to_string()),
        webhook_host: Some("127.0.0.1".to_string()),
        webhook_port: Some(35791),
        updated_at_ms: 123,
    }
}

#[test]
fn connector_store_default_preserves_schema_fields() {
    let store = ConnectorStoreFile::default();
    let payload = serde_json::to_value(&store).expect("serialize store");

    assert_eq!(store.version, CONNECTOR_STORE_VERSION);
    assert_eq!(
        payload,
        serde_json::json!({
            "version": "1",
            "feishuAccounts": {}
        })
    );
}

#[test]
fn connector_store_round_trips_feishu_records() {
    let mut store = ConnectorStoreFile::default();
    store
        .feishu_accounts
        .insert("ops".to_string(), record("ops"));

    let payload = serde_json::to_value(&store).expect("serialize store");
    assert_eq!(
        payload["feishuAccounts"]["ops"]["connectionMode"],
        "webhook"
    );
    assert_eq!(payload["feishuAccounts"]["ops"]["domain"], "lark");

    let decoded: ConnectorStoreFile = serde_json::from_value(payload).expect("decode store");
    let decoded_record = decoded.feishu_accounts.get("ops").expect("decoded feishu");
    assert_eq!(decoded_record.account_id, "ops");
    assert_eq!(
        decoded_record.connection_mode,
        FeishuConnectionMode::Webhook
    );
    assert_eq!(decoded_record.domain, FeishuDomain::Lark);
    assert_eq!(decoded_record.webhook_port, Some(35791));
}

#[test]
fn connector_store_decodes_missing_account_maps_as_empty() {
    let payload = serde_json::json!({
        "version": "1"
    });
    let decoded: ConnectorStoreFile = serde_json::from_value(payload).expect("decode store");

    assert!(decoded.feishu_accounts.is_empty());
}
