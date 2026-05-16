use super::{decode_callback_data, parse_telegram_update, parse_update_id};
use gt_task::ExternalPeerKind;

#[test]
fn parse_text_update_extracts_group_sender_and_offset() {
    let update = serde_json::json!({
        "update_id": 101,
        "message": {
            "message_id": 77,
            "text": "hello",
            "chat": { "id": -100123, "type": "supergroup" },
            "from": { "id": 55, "username": " alice " }
        }
    });

    let (inbound, update_id) =
        parse_telegram_update(&update, "ops").expect("telegram message parsed");

    assert_eq!(update_id, 101);
    assert_eq!(inbound.channel, "telegram");
    assert_eq!(inbound.account_id, "ops");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "-100123");
    assert_eq!(inbound.sender_id, "55");
    assert_eq!(inbound.sender_name.as_deref(), Some("alice"));
    assert_eq!(inbound.message_id, "77");
    assert_eq!(inbound.text, "hello");
    assert_eq!(inbound.idempotency_key, None);
}

#[test]
fn parse_edited_direct_update_uses_caption_and_update_message_id_fallback() {
    let update = serde_json::json!({
        "update_id": 102,
        "edited_message": {
            "caption": "photo caption",
            "chat": { "id": 12345, "type": "private" },
            "from": { "id": 77, "first_name": " Ada ", "last_name": " Lovelace " }
        }
    });

    let (inbound, update_id) =
        parse_telegram_update(&update, "default").expect("edited message parsed");

    assert_eq!(update_id, 102);
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.peer_id, "12345");
    assert_eq!(inbound.sender_id, "77");
    assert_eq!(inbound.sender_name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(inbound.message_id, "update-102");
    assert_eq!(inbound.text, "photo caption");
}

#[test]
fn parse_channel_post_falls_back_to_chat_sender_and_non_text_placeholder() {
    let update = serde_json::json!({
        "update_id": 103,
        "channel_post": {
            "message_id": 88,
            "photo": [{ "file_id": "abc" }],
            "chat": { "id": -100999, "type": "channel" }
        }
    });

    let (inbound, _) = parse_telegram_update(&update, "news").expect("channel post parsed");

    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "-100999");
    assert_eq!(inbound.sender_id, "-100999");
    assert_eq!(inbound.text, "[telegram non-text message]");
}

#[test]
fn parse_callback_query_decodes_gto_payload_and_idempotency_key() {
    let update = serde_json::json!({
        "update_id": 104,
        "callback_query": {
            "id": "cbq-1",
            "data": "gto:2",
            "from": { "id": 99, "first_name": "Grace" },
            "message": {
                "chat": { "id": -100123, "type": "group" }
            }
        }
    });

    let (inbound, update_id) = parse_telegram_update(&update, "ops").expect("callback parsed");

    assert_eq!(update_id, 104);
    assert_eq!(inbound.message_id, "callback-cbq-1");
    assert_eq!(inbound.text, "2");
    assert_eq!(
        inbound.idempotency_key.as_deref(),
        Some("telegram-callback-cbq-1")
    );
}

#[test]
fn parse_callback_query_preserves_non_gto_payload_and_fallback_id() {
    let update = serde_json::json!({
        "update_id": 105,
        "callback_query": {
            "data": "gto-key:down",
            "from": { "id": 99 },
            "message": {
                "chat": { "id": "direct-chat", "type": "private" }
            }
        }
    });

    let (inbound, _) = parse_telegram_update(&update, "ops").expect("callback fallback parsed");

    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.message_id, "callback-callback-update-105");
    assert_eq!(inbound.text, "gto-key:down");
}

#[test]
fn parse_telegram_update_reports_missing_required_fields() {
    let missing_update_id = serde_json::json!({ "message": {} });
    assert!(parse_telegram_update(&missing_update_id, "ops")
        .expect_err("missing update_id")
        .contains("missing update_id"));

    let missing_message = serde_json::json!({ "update_id": 1 });
    assert!(parse_telegram_update(&missing_message, "ops")
        .expect_err("missing message")
        .contains("missing message/edited_message/channel_post/callback_query"));

    let missing_chat = serde_json::json!({
        "update_id": 1,
        "message": { "message_id": 1, "text": "hello" }
    });
    assert!(parse_telegram_update(&missing_chat, "ops")
        .expect_err("missing chat")
        .contains("missing message.chat"));

    let missing_callback_from = serde_json::json!({
        "update_id": 1,
        "callback_query": {
            "message": { "chat": { "id": 1 } }
        }
    });
    assert!(parse_telegram_update(&missing_callback_from, "ops")
        .expect_err("missing callback from")
        .contains("missing callback_query.from"));
}

#[test]
fn parse_update_id_rejects_negative_and_overflow_values() {
    assert_eq!(
        parse_update_id(&serde_json::json!({ "update_id": 123 })),
        Some(123)
    );
    assert_eq!(
        parse_update_id(&serde_json::json!({ "update_id": -1 })),
        None
    );
    assert_eq!(
        parse_update_id(&serde_json::json!({ "update_id": u64::MAX })),
        None
    );
    assert_eq!(parse_update_id(&serde_json::json!({})), None);
}

#[test]
fn callback_data_only_decodes_gto_prefix() {
    assert_eq!(decode_callback_data("gto:1"), "1");
    assert_eq!(decode_callback_data("gto-key:down"), "gto-key:down");
}
