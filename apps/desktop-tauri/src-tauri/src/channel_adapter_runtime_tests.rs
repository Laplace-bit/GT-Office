use super::{parse_feishu_payload, parse_telegram_payload};
    use vb_task::ExternalPeerKind;

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
    fn parse_feishu_receive_message() {
        let payload = serde_json::json!({
            "schema": "2.0",
            "header": { "event_type": "im.message.receive_v1", "app_id": "cli_xxx" },
            "event": {
                "sender": {
                    "sender_id": { "open_id": "ou_abc" }
                },
                "message": {
                    "message_id": "om_123",
                    "chat_id": "oc_777",
                    "chat_type": "group",
                    "content": "{\"text\":\"hello from feishu\"}"
                }
            }
        });
        let inbound = parse_feishu_payload(&payload).expect("feishu payload parsed");
        assert_eq!(inbound.channel, "feishu");
        assert_eq!(inbound.account_id, "cli_xxx");
        assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
        assert_eq!(inbound.peer_id, "oc_777");
        assert_eq!(inbound.sender_id, "ou_abc");
        assert_eq!(inbound.text, "hello from feishu");
    }
