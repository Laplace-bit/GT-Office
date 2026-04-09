use super::{
    api::build_client,
    parse_payload_for_account, parse_webhook_payload,
    types::{FeishuConnectionMode, FeishuConnectorAccountRecord, FeishuDomain},
    webhook::runtime_callback_url,
};
use gt_task::ExternalPeerKind;

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
