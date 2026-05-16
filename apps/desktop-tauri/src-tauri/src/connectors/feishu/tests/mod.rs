use super::{
    account_store,
    api::build_client,
    default_app_secret_ref, default_verification_token_ref, list_accounts, normalize_account_id,
    normalize_connection_mode, normalize_domain, normalize_webhook_path, parse_payload_for_account,
    parse_webhook_payload, send_text_reply,
    types::{
        FeishuAccountUpsertInput, FeishuConnectionMode, FeishuConnectorAccountRecord, FeishuDomain,
    },
    upsert_account, validate_send_text_input,
    webhook::{runtime_callback_url, sync_runtime_webhook},
};
use gt_task::ExternalPeerKind;
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::test::mock_app;
use uuid::Uuid;

static STORE_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn store_test_lock() -> MutexGuard<'static, ()> {
    STORE_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("store test lock poisoned")
}

fn sample_record(account_id: &str) -> FeishuConnectorAccountRecord {
    FeishuConnectorAccountRecord {
        account_id: account_id.to_string(),
        enabled: true,
        connection_mode: FeishuConnectionMode::Webhook,
        domain: FeishuDomain::Feishu,
        app_id: "cli_xxx".to_string(),
        app_secret_ref: "feishu/default/app_secret".to_string(),
        verification_token_ref: Some("feishu/default/verification_token".to_string()),
        webhook_path: None,
        webhook_host: None,
        webhook_port: None,
        updated_at_ms: 0,
    }
}

#[test]
fn account_mode_domain_and_secret_defaults_are_normalized() {
    assert_eq!(normalize_account_id(None), "default");
    assert_eq!(normalize_account_id(Some(" Team-A ")), "team-a");

    assert_eq!(
        normalize_connection_mode(None).expect("default mode"),
        FeishuConnectionMode::Websocket
    );
    assert_eq!(
        normalize_connection_mode(Some(" WEBHOOK ")).expect("webhook mode"),
        FeishuConnectionMode::Webhook
    );
    assert!(normalize_connection_mode(Some("polling"))
        .expect_err("invalid mode")
        .contains("CHANNEL_CONNECTOR_MODE_INVALID"));

    assert_eq!(
        normalize_domain(None).expect("default domain"),
        FeishuDomain::Feishu
    );
    assert_eq!(
        normalize_domain(Some(" LARK ")).expect("lark domain"),
        FeishuDomain::Lark
    );
    assert!(normalize_domain(Some("custom"))
        .expect_err("invalid domain")
        .contains("CHANNEL_CONNECTOR_DOMAIN_INVALID"));

    assert_eq!(
        default_app_secret_ref(" Team-A "),
        "feishu/team-a/app_secret"
    );
    assert_eq!(
        default_verification_token_ref(" Team-A "),
        "feishu/team-a/verification_token"
    );
}

#[test]
fn send_text_input_validation_trims_and_rejects_blank_values() {
    assert_eq!(
        validate_send_text_input(" chat-1 ", " hello ").expect("valid input"),
        ("chat-1", "hello")
    );
    assert_eq!(
        validate_send_text_input("   ", "hello").expect_err("blank peer"),
        "CHANNEL_CONNECTOR_SEND_INVALID: peer id is required"
    );
    assert_eq!(
        validate_send_text_input("chat-1", "   ").expect_err("blank text"),
        "CHANNEL_CONNECTOR_SEND_INVALID: text is required"
    );
}

#[test]
fn normalize_webhook_path_trims_and_adds_leading_slash() {
    assert_eq!(
        normalize_webhook_path(" /custom/events ").as_deref(),
        Some("/custom/events")
    );
    assert_eq!(
        normalize_webhook_path("custom/events").as_deref(),
        Some("/custom/events")
    );
    assert_eq!(normalize_webhook_path("   "), None);
}

#[tokio::test]
async fn send_text_reply_rejects_blank_peer_and_text_before_provider_lookup() {
    let app = mock_app();

    let blank_peer = send_text_reply(app.handle(), Some("missing"), "  ", "hello", None)
        .await
        .expect_err("blank peer rejected");
    assert_eq!(
        blank_peer,
        "CHANNEL_CONNECTOR_SEND_INVALID: peer id is required"
    );

    let blank_text = send_text_reply(app.handle(), Some("missing"), "oc_123", "  ", None)
        .await
        .expect_err("blank text rejected");
    assert_eq!(
        blank_text,
        "CHANNEL_CONNECTOR_SEND_INVALID: text is required"
    );
}

#[tokio::test]
async fn send_text_reply_rejects_missing_and_disabled_accounts_before_provider_calls() {
    let _guard = store_test_lock();
    let app = mock_app();

    let missing = send_text_reply(app.handle(), Some("missing"), "oc_123", "hello", None)
        .await
        .expect_err("missing account");
    assert_eq!(
        missing,
        "CHANNEL_CONNECTOR_NOT_FOUND: feishu account missing"
    );

    let mut disabled_record = sample_record("disabled");
    disabled_record.enabled = false;
    account_store::upsert_record(app.handle(), "disabled".to_string(), disabled_record)
        .expect("store disabled account");

    let disabled = send_text_reply(app.handle(), Some("disabled"), "oc_123", "hello", None)
        .await
        .expect_err("disabled account");
    assert_eq!(
        disabled,
        "CHANNEL_CONNECTOR_DISABLED: feishu account is disabled"
    );
}

#[test]
fn parse_webhook_payload_returns_url_verification_challenge() {
    let payload = serde_json::json!({
        "type": "url_verification",
        "challenge": "challenge-token"
    });

    let parsed = parse_webhook_payload(&payload).expect("url verification parsed");
    assert_eq!(parsed.challenge.as_deref(), Some("challenge-token"));
    assert!(parsed.message.is_none());
}

#[test]
fn parse_webhook_payload_extracts_group_text_message() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "header": {
            "event_type": "im.message.receive_v1",
            "app_id": "cli_xxx"
        },
        "event": {
            "sender": {
                "sender_id": { "open_id": "ou_abc" },
                "name": "Alice"
            },
            "message": {
                "message_id": "om_123",
                "chat_id": "oc_777",
                "chat_type": "group",
                "content": "{\"text\":\"hello from feishu\"}"
            }
        }
    });

    let parsed = parse_webhook_payload(&payload).expect("feishu payload parsed");
    let inbound = parsed.message.expect("inbound message");
    assert_eq!(inbound.channel, "feishu");
    assert_eq!(inbound.account_id, "cli_xxx");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "oc_777");
    assert_eq!(inbound.sender_id, "ou_abc");
    assert_eq!(inbound.sender_name.as_deref(), Some("Alice"));
    assert_eq!(inbound.text, "hello from feishu");
}

#[test]
fn parse_webhook_payload_falls_back_to_sender_tenant_and_non_text_placeholder() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "event": {
            "sender": {
                "tenant_key": "tenant_cli",
                "sender_id": { "user_id": "u_123" }
            },
            "message": {
                "message_id": "om_non_text",
                "chat_type": "p2p"
            }
        }
    });

    let parsed = parse_webhook_payload(&payload).expect("non-text payload parsed");
    let inbound = parsed.message.expect("inbound message");
    assert_eq!(inbound.account_id, "tenant_cli");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.peer_id, "u_123");
    assert_eq!(inbound.sender_id, "u_123");
    assert_eq!(inbound.text, "[feishu non-text message]");
}

#[test]
fn parse_payload_for_account_prefers_configured_connector_account_id() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "header": {
            "event_type": "im.message.receive_v1",
            "app_id": "cli_real_app_id"
        },
        "event": {
            "sender": {
                "sender_id": { "open_id": "ou_abc" },
                "name": "Alice"
            },
            "message": {
                "message_id": "om_123",
                "chat_id": "oc_777",
                "chat_type": "group",
                "content": "{\"text\":\"hello from feishu\"}"
            }
        }
    });

    let parsed =
        parse_payload_for_account(&payload, Some("default")).expect("feishu payload parsed");
    let inbound = parsed.message.expect("inbound message");
    assert_eq!(inbound.account_id, "default");
    assert_eq!(inbound.peer_id, "oc_777");
    assert_eq!(inbound.sender_id, "ou_abc");
}

#[test]
fn parse_webhook_payload_extracts_direct_plain_text_message() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "header": {
            "tenant_key": "tenant_direct"
        },
        "event": {
            "sender": {
                "sender_id": { "union_id": "on_union" },
                "name": "Bob"
            },
            "message": {
                "message_id": "om_direct",
                "chat_type": "p2p",
                "content": "plain hello"
            }
        }
    });

    let parsed = parse_webhook_payload(&payload).expect("direct text payload parsed");
    let inbound = parsed.message.expect("inbound message");
    assert_eq!(inbound.account_id, "tenant_direct");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.peer_id, "on_union");
    assert_eq!(inbound.sender_id, "on_union");
    assert_eq!(inbound.sender_name.as_deref(), Some("Bob"));
    assert_eq!(inbound.message_id, "om_direct");
    assert_eq!(inbound.text, "plain hello");
}

#[test]
fn parse_webhook_payload_rejects_missing_message_id() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "event": {
            "sender": {
                "sender_id": { "open_id": "ou_abc" }
            },
            "message": {
                "chat_id": "oc_777",
                "chat_type": "group",
                "content": "{\"text\":\"hello\"}"
            }
        }
    });

    let error = parse_webhook_payload(&payload).expect_err("missing message id should fail");
    assert!(error.contains("missing event.message.message_id"));
}

#[test]
fn parse_webhook_payload_preserves_invalid_json_content_as_text() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "header": {
            "app_id": "cli_invalid_json"
        },
        "event": {
            "sender": {
                "sender_id": { "open_id": "ou_abc" }
            },
            "message": {
                "message_id": "om_invalid_json",
                "chat_id": "oc_777",
                "chat_type": "group",
                "content": "{not json"
            }
        }
    });

    let parsed = parse_webhook_payload(&payload).expect("invalid json content parsed as text");
    let inbound = parsed.message.expect("inbound message");
    assert_eq!(inbound.account_id, "cli_invalid_json");
    assert_eq!(inbound.text, "{not json");
}

#[test]
fn parse_webhook_payload_handles_numeric_ids() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "header": {
            "tenant_key": 42
        },
        "event": {
            "sender": {
                "sender_id": { "user_id": 99 }
            },
            "message": {
                "message_id": 123456789,
                "chat_id": 777,
                "chat_type": "group",
                "content": "{\"text\":\"numeric ids\"}"
            }
        }
    });

    let parsed = parse_webhook_payload(&payload).expect("numeric payload parsed");
    let inbound = parsed.message.expect("inbound message");
    assert_eq!(inbound.account_id, "42");
    assert_eq!(inbound.peer_id, "777");
    assert_eq!(inbound.sender_id, "99");
    assert_eq!(inbound.message_id, "123456789");
    assert_eq!(inbound.text, "numeric ids");
}

#[test]
fn parse_webhook_payload_reports_missing_sender_identity() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "event": {
            "sender": {
                "sender_id": {}
            },
            "message": {
                "message_id": "om_missing_sender",
                "chat_id": "oc_777",
                "chat_type": "group",
                "content": "{\"text\":\"hello\"}"
            }
        }
    });

    let error = parse_webhook_payload(&payload).expect_err("missing sender identity should fail");
    assert!(error.contains("missing sender open_id/user_id/union_id"));
}

#[test]
fn parse_webhook_payload_reports_missing_event() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "header": { "event_id": "evt_missing" }
    });

    let error = parse_webhook_payload(&payload).expect_err("missing event should fail");
    assert!(error.contains("missing event"));
}

#[test]
fn parse_webhook_payload_defaults_account_and_peer_when_optional_ids_are_missing() {
    let payload = serde_json::json!({
        "schema": "2.0",
        "event": {
            "sender": {
                "sender_id": { "open_id": "ou_sender" }
            },
            "message": {
                "message_id": "om_default",
                "chat_type": "p2p",
                "content": "{\"text\":\"hello default\"}"
            }
        }
    });

    let inbound = parse_webhook_payload(&payload)
        .expect("payload should parse")
        .message
        .expect("message");

    assert_eq!(inbound.account_id, "default");
    assert_eq!(inbound.peer_id, "ou_sender");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.text, "hello default");
}

#[test]
fn runtime_callback_url_uses_custom_host_port_and_path() {
    let mut record = sample_record("default");
    record.webhook_host = Some(" 10.0.0.12 ".to_string());
    record.webhook_port = Some(9090);
    record.webhook_path = Some(" /custom/feishu/events ".to_string());

    let callback_url = runtime_callback_url(&record, None);
    assert_eq!(callback_url, "http://10.0.0.12:9090/custom/feishu/events");
}

#[test]
fn runtime_callback_url_normalizes_custom_path_with_missing_slash() {
    let mut record = sample_record("default");
    record.webhook_host = Some("127.0.0.1".to_string());
    record.webhook_port = Some(3000);
    record.webhook_path = Some("custom/feishu/events".to_string());

    let callback_url = runtime_callback_url(&record, None);
    assert_eq!(callback_url, "http://127.0.0.1:3000/custom/feishu/events");
}

#[test]
fn upsert_account_persists_webhook_configuration_and_sync_uses_runtime_url() {
    let _guard = store_test_lock();
    let app = mock_app();
    let account_id = format!("acct-{}", Uuid::new_v4());
    let view = upsert_account(
        app.handle(),
        FeishuAccountUpsertInput {
            account_id: Some(account_id.clone()),
            enabled: Some(true),
            connection_mode: Some(" webhook ".to_string()),
            domain: Some(" lark ".to_string()),
            app_id: Some(" cli_test ".to_string()),
            app_secret: Some(" secret ".to_string()),
            app_secret_ref: Some(format!("feishu/{account_id}/test_app_secret")),
            verification_token: Some(" verify ".to_string()),
            verification_token_ref: Some(format!("feishu/{account_id}/test_verify")),
            webhook_path: Some(" custom/events ".to_string()),
            webhook_host: Some(" 0.0.0.0 ".to_string()),
            webhook_port: Some(7878),
        },
    )
    .expect("upsert feishu account");

    assert_eq!(view.account_id, account_id);
    assert_eq!(view.mode, "webhook");
    assert_eq!(view.connection_mode, "webhook");
    assert_eq!(view.domain, "lark");
    assert_eq!(view.app_id, "cli_test");
    assert!(view.has_app_secret);
    assert!(view.has_verification_token);
    assert_eq!(view.webhook_path.as_deref(), Some("/custom/events"));
    assert_eq!(view.webhook_host.as_deref(), Some("0.0.0.0"));
    assert_eq!(view.webhook_port, Some(7878));

    let sync = sync_runtime_webhook(
        app.handle(),
        Some(&view.account_id),
        Some(" http://localhost:3001/webhook/feishu/token "),
    )
    .expect("sync webhook runtime");

    assert!(sync.ok);
    assert_eq!(sync.account_id, view.account_id);
    assert_eq!(
        sync.webhook_url,
        "http://localhost:3001/webhook/feishu/token"
    );
    assert!(sync.webhook_matched);
}

#[test]
fn upsert_account_rejects_missing_verification_token_for_webhook_mode() {
    let _guard = store_test_lock();
    let app = mock_app();
    let account_id = format!("acct-{}", Uuid::new_v4());
    let error = upsert_account(
        app.handle(),
        FeishuAccountUpsertInput {
            account_id: Some(account_id.clone()),
            enabled: Some(true),
            connection_mode: Some("webhook".to_string()),
            domain: Some("feishu".to_string()),
            app_id: Some("cli_test".to_string()),
            app_secret: Some("secret".to_string()),
            app_secret_ref: Some(format!("feishu/{account_id}/test_app_secret")),
            verification_token: None,
            verification_token_ref: None,
            webhook_path: None,
            webhook_host: None,
            webhook_port: None,
        },
    )
    .expect_err("webhook mode requires verification token");

    assert!(error.contains("verification token is required for webhook mode"));
}

#[test]
fn sync_runtime_webhook_reports_missing_disabled_and_invalid_mode_accounts() {
    let _guard = store_test_lock();
    let app = mock_app();

    let missing = sync_runtime_webhook(app.handle(), Some("missing"), None)
        .expect_err("missing account should fail");
    assert!(missing.contains("CHANNEL_CONNECTOR_NOT_FOUND"));

    let disabled_id = format!("acct-{}", Uuid::new_v4());
    upsert_account(
        app.handle(),
        FeishuAccountUpsertInput {
            account_id: Some(disabled_id.clone()),
            enabled: Some(false),
            connection_mode: Some("webhook".to_string()),
            domain: Some("feishu".to_string()),
            app_id: Some("cli_disabled".to_string()),
            app_secret: Some("secret".to_string()),
            app_secret_ref: Some(format!("feishu/{disabled_id}/test_app_secret")),
            verification_token: Some("verify".to_string()),
            verification_token_ref: Some(format!("feishu/{disabled_id}/test_verify")),
            webhook_path: None,
            webhook_host: None,
            webhook_port: None,
        },
    )
    .expect("upsert disabled account");
    let disabled = sync_runtime_webhook(app.handle(), Some(&disabled_id), None)
        .expect_err("disabled account should fail");
    assert!(disabled.contains("CHANNEL_CONNECTOR_DISABLED"));

    let websocket_id = format!("acct-{}", Uuid::new_v4());
    upsert_account(
        app.handle(),
        FeishuAccountUpsertInput {
            account_id: Some(websocket_id.clone()),
            enabled: Some(true),
            connection_mode: Some("websocket".to_string()),
            domain: Some("feishu".to_string()),
            app_id: Some("cli_websocket".to_string()),
            app_secret: Some("secret".to_string()),
            app_secret_ref: Some(format!("feishu/{websocket_id}/test_app_secret")),
            verification_token: None,
            verification_token_ref: None,
            webhook_path: None,
            webhook_host: None,
            webhook_port: None,
        },
    )
    .expect("upsert websocket account");
    let invalid_mode = sync_runtime_webhook(app.handle(), Some(&websocket_id), None)
        .expect_err("websocket mode should fail webhook sync");
    assert!(invalid_mode.contains("CHANNEL_CONNECTOR_MODE_INVALID"));
}

#[test]
fn sync_runtime_webhook_uses_stored_url_when_runtime_url_is_missing() {
    let _guard = store_test_lock();
    let app = mock_app();
    let account_id = format!("acct-{}", Uuid::new_v4());
    upsert_account(
        app.handle(),
        FeishuAccountUpsertInput {
            account_id: Some(account_id.clone()),
            enabled: Some(true),
            connection_mode: Some("webhook".to_string()),
            domain: Some("feishu".to_string()),
            app_id: Some("cli_test".to_string()),
            app_secret: Some("secret".to_string()),
            app_secret_ref: Some(format!("feishu/{account_id}/test_app_secret")),
            verification_token: Some("verify".to_string()),
            verification_token_ref: Some(format!("feishu/{account_id}/test_verify")),
            webhook_path: Some("/configured/events".to_string()),
            webhook_host: Some("127.0.0.2".to_string()),
            webhook_port: Some(8088),
        },
    )
    .expect("upsert webhook account");

    let sync = sync_runtime_webhook(app.handle(), Some(&account_id), None)
        .expect("sync without runtime url");

    assert_eq!(sync.webhook_url, "http://127.0.0.2:8088/configured/events");
    assert!(!sync.webhook_matched);
    assert!(sync.detail.contains("differs"));
}

#[test]
fn list_accounts_sorts_feishu_accounts_by_account_id() {
    let _guard = store_test_lock();
    let app = mock_app();
    for account_id in ["zeta", "alpha"] {
        upsert_account(
            app.handle(),
            FeishuAccountUpsertInput {
                account_id: Some(format!("{}-{}", account_id, Uuid::new_v4())),
                enabled: Some(true),
                connection_mode: Some("websocket".to_string()),
                domain: Some("feishu".to_string()),
                app_id: Some(format!("cli_{account_id}")),
                app_secret: Some("secret".to_string()),
                app_secret_ref: Some(format!("feishu/{account_id}/test_app_secret")),
                verification_token: None,
                verification_token_ref: None,
                webhook_path: None,
                webhook_host: None,
                webhook_port: None,
            },
        )
        .expect("upsert account");
    }

    let accounts = list_accounts(app.handle()).expect("list accounts");
    let ids = accounts
        .iter()
        .map(|account| account.account_id.as_str())
        .collect::<Vec<_>>();
    assert!(ids.windows(2).all(|window| window[0] <= window[1]));
}

#[test]
fn runtime_callback_url_prefers_runtime_value() {
    let mut record = sample_record("default");
    record.webhook_host = Some("192.168.1.10".to_string());
    record.webhook_port = Some(8080);
    record.webhook_path = Some("/custom/feishu".to_string());

    let callback_url = runtime_callback_url(&record, Some(" https://runtime.example/webhook "));
    assert_eq!(callback_url, "https://runtime.example/webhook");
}

#[test]
fn runtime_callback_url_builds_default_path_from_account_id() {
    let record = sample_record("AlphaBot");
    let callback_url = runtime_callback_url(&record, None);
    assert_eq!(callback_url, "http://127.0.0.1:3000/feishu/alphabot/events");
}

#[test]
fn sdk_operation_ids_use_singular_message_resource_names() {
    let client = build_client(FeishuDomain::Feishu, "cli_xxx", "secret")
        .expect("feishu client should build without network");

    assert!(client.endpoint("im.v1.message.create").is_some());
    assert!(client.endpoint("im.v1.message.reply").is_some());
    assert!(client.endpoint("im.v1.messages.create").is_none());
    assert!(client.endpoint("im.v1.messages.reply").is_none());
}
