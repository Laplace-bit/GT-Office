use super::{
    bot_info_error_status, health_check, normalize_runtime_webhook_url, success_detail,
    webhook_urls_match,
};
use crate::connectors::feishu::{
    account_store::upsert_record,
    types::{FeishuConnectionMode, FeishuConnectorAccountRecord, FeishuDomain},
};

#[test]
fn runtime_webhook_url_is_trimmed_and_blank_is_absent() {
    assert_eq!(
        normalize_runtime_webhook_url(Some("  https://callback.example/feishu  ")).as_deref(),
        Some("https://callback.example/feishu")
    );
    assert_eq!(normalize_runtime_webhook_url(Some("   ")), None);
    assert_eq!(normalize_runtime_webhook_url(None), None);
}

#[test]
fn webhook_url_matching_trims_both_sides_and_requires_both_urls() {
    assert!(webhook_urls_match(
        Some(" https://callback.example/feishu "),
        Some("https://callback.example/feishu")
    ));
    assert!(!webhook_urls_match(
        Some("https://callback.example/feishu"),
        Some("https://callback.example/other")
    ));
    assert!(!webhook_urls_match(
        Some("https://callback.example/feishu"),
        None
    ));
    assert!(!webhook_urls_match(
        None,
        Some("https://callback.example/feishu")
    ));
}

#[test]
fn bot_info_errors_are_split_between_auth_and_provider_failures() {
    assert_eq!(
        bot_info_error_status("CHANNEL_CONNECTOR_AUTH_FAILED: token expired"),
        "auth_failed"
    );
    assert_eq!(
        bot_info_error_status("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: timeout"),
        "provider_unavailable"
    );
    assert_eq!(
        bot_info_error_status("provider returned malformed payload"),
        "provider_unavailable"
    );
}

#[test]
fn success_detail_mentions_actionable_runtime_state() {
    assert_eq!(
        success_detail(FeishuConnectionMode::Webhook, Some(true), false),
        "feishu bot credential probe passed; webhook callback matches runtime"
    );
    assert_eq!(
        success_detail(FeishuConnectionMode::Webhook, Some(false), false),
        "feishu bot credential probe passed; configure the callback URL shown by GT Office in Feishu Open Platform"
    );
    assert_eq!(
        success_detail(FeishuConnectionMode::Webhook, None, false),
        "feishu bot credential probe passed; configure the callback URL shown by GT Office in Feishu Open Platform"
    );
    assert_eq!(
        success_detail(FeishuConnectionMode::Websocket, None, true),
        "feishu bot credential probe passed; websocket runtime is active"
    );
    assert_eq!(
        success_detail(FeishuConnectionMode::Websocket, None, false),
        "feishu bot credential probe passed; websocket runtime is starting or reconnecting"
    );
}

#[tokio::test]
async fn health_check_reports_not_found_without_provider_calls() {
    let app = tauri::test::mock_app();

    let error = health_check(app.handle(), Some("missing"), None, false)
        .await
        .expect_err("missing account");

    assert_eq!(error, "CHANNEL_CONNECTOR_NOT_FOUND: feishu account missing");
}

#[tokio::test]
async fn health_check_reports_disabled_account_without_provider_calls() {
    let app = tauri::test::mock_app();
    upsert_record(
        app.handle(),
        "ops".to_string(),
        FeishuConnectorAccountRecord {
            account_id: "ops".to_string(),
            enabled: false,
            connection_mode: FeishuConnectionMode::Webhook,
            domain: FeishuDomain::Lark,
            app_id: "cli_a".to_string(),
            app_secret_ref: "feishu/ops/app_secret".to_string(),
            verification_token_ref: None,
            webhook_path: Some("/custom".to_string()),
            webhook_host: None,
            webhook_port: None,
            updated_at_ms: 1,
        },
    )
    .expect("store disabled account");

    let snapshot = health_check(
        app.handle(),
        Some(" OPS "),
        Some(" https://callback.example/feishu ".to_string()),
        false,
    )
    .await
    .expect("disabled health check");

    assert_eq!(snapshot.channel, "feishu");
    assert_eq!(snapshot.account_id, "ops");
    assert!(!snapshot.ok);
    assert_eq!(snapshot.status, "disabled");
    assert_eq!(snapshot.connection_mode, "webhook");
    assert_eq!(snapshot.domain, "lark");
    assert_eq!(
        snapshot.runtime_webhook_url.as_deref(),
        Some("https://callback.example/feishu")
    );
    assert_eq!(snapshot.webhook_matched, None);
}
