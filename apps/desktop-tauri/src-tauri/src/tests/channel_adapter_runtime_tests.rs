use super::parse_telegram_payload;
use gt_task::ExternalPeerKind;

#[test]
fn parse_telegram_text_message() {
    let payload = serde_json::json!({
        "update_id": 10001,
        "message": {
            "message_id": 88,
            "text": "hello from telegram",
            "chat": { "id": -100123, "type": "supergroup" },
            "from": { "id": 3344, "username": "alice" }
        }
    });
    let inbound = parse_telegram_payload(&payload).expect("telegram payload parsed");
    assert_eq!(inbound.channel, "telegram");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "-100123");
    assert_eq!(inbound.sender_id, "3344");
    assert_eq!(inbound.text, "hello from telegram");
}

#[test]
fn parse_telegram_callback_query() {
    let payload = serde_json::json!({
        "update_id": 10002,
        "callback_query": {
            "id": "cbq_123",
            "data": "gto:2",
            "from": { "id": 5566, "username": "alice" },
            "message": {
                "message_id": 89,
                "chat": { "id": -100123, "type": "supergroup" }
            }
        }
    });
    let inbound = parse_telegram_payload(&payload).expect("telegram callback parsed");
    assert_eq!(inbound.channel, "telegram");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "-100123");
    assert_eq!(inbound.sender_id, "5566");
    assert_eq!(inbound.text, "2");
    assert_eq!(
        inbound.idempotency_key.as_deref(),
        Some("telegram-callback-cbq_123")
    );
}

#[test]
fn parse_telegram_key_callback_query_preserves_key_payload() {
    let payload = serde_json::json!({
        "update_id": 10003,
        "callback_query": {
            "id": "cbq_key_123",
            "data": "gto-key:down",
            "from": { "id": 5566, "username": "alice" },
            "message": {
                "message_id": 90,
                "chat": { "id": -100123, "type": "supergroup" }
            }
        }
    });
    let inbound = parse_telegram_payload(&payload).expect("telegram key callback parsed");
    assert_eq!(inbound.channel, "telegram");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "-100123");
    assert_eq!(inbound.sender_id, "5566");
    assert_eq!(inbound.text, "gto-key:down");
    assert_eq!(
        inbound.idempotency_key.as_deref(),
        Some("telegram-callback-cbq_key_123")
    );
}
