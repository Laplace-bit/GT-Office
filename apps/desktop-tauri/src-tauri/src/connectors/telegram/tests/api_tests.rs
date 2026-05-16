use super::{
    answer_callback_query_body, api_base_url, chat_action_body, delete_message_body,
    edit_message_body, get_updates_form_fields, is_message_not_modified, json_to_string,
    parse_answer_callback_query_response, parse_chat_id, parse_delete_message_response,
    parse_edit_message_response, parse_envelope, parse_get_me_response, parse_required_message_id,
    parse_send_message_response, parse_updates_response, parse_webhook_info_response,
    provider_description, send_message_body, set_webhook_body, telegram_provider_error,
    telegram_provider_error_prefix, TelegramApiEnvelope,
};
use serde_json::Value;

#[test]
fn api_base_url_trims_bot_token() {
    assert_eq!(
        api_base_url(" 123:ABC "),
        "https://api.telegram.org/bot123:ABC"
    );
}

#[test]
fn parse_chat_id_preserves_numeric_and_username_ids() {
    assert_eq!(
        parse_chat_id("-1001234567890"),
        serde_json::json!(-1001234567890i64)
    );
    assert_eq!(parse_chat_id("12345"), serde_json::json!(12345i64));
    assert_eq!(parse_chat_id(" 12345 "), serde_json::json!(12345i64));
    assert_eq!(
        parse_chat_id(" @ops_channel "),
        serde_json::json!("@ops_channel")
    );
    assert_eq!(parse_chat_id("chat-abc"), serde_json::json!("chat-abc"));
}

#[test]
fn parse_required_message_id_rejects_invalid_or_nonpositive_values() {
    assert_eq!(parse_required_message_id(" 42 "), Ok(42));
    assert_eq!(
        parse_required_message_id("abc").expect_err("nonnumeric"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric"
    );
    assert_eq!(
        parse_required_message_id("0").expect_err("zero"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric"
    );
    assert_eq!(
        parse_required_message_id("-1").expect_err("negative"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric"
    );
}

#[test]
fn json_to_string_normalizes_supported_telegram_values() {
    assert_eq!(
        json_to_string(Some(&serde_json::json!("  abc "))).as_deref(),
        Some("abc")
    );
    assert_eq!(json_to_string(Some(&serde_json::json!("  "))), None);
    assert_eq!(
        json_to_string(Some(&serde_json::json!(-7))).as_deref(),
        Some("-7")
    );
    assert_eq!(
        json_to_string(Some(&serde_json::json!(7))).as_deref(),
        Some("7")
    );
    assert_eq!(json_to_string(Some(&serde_json::json!(true))), None);
    assert_eq!(json_to_string(None), None);
}

#[test]
fn parse_envelope_accepts_success_and_provider_error_payloads() {
    let success: TelegramApiEnvelope<Value> = parse_envelope(serde_json::json!({
        "ok": true,
        "result": { "message_id": 42 }
    }))
    .expect("success envelope");
    assert!(success.ok);
    assert_eq!(
        success
            .result
            .and_then(|result| result.get("message_id").cloned()),
        Some(serde_json::json!(42))
    );

    let failure: TelegramApiEnvelope<Value> = parse_envelope(serde_json::json!({
        "ok": false,
        "description": "Forbidden: bot was blocked by the user"
    }))
    .expect("failure envelope");
    assert!(!failure.ok);
    assert_eq!(
        failure.description.as_deref(),
        Some("Forbidden: bot was blocked by the user")
    );
}

#[test]
fn parse_envelope_rejects_invalid_shapes() {
    let error = parse_envelope::<Value>(serde_json::json!({
        "ok": "yes"
    }))
    .expect_err("invalid ok type should fail");

    assert!(error.contains("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE"));
}

#[test]
fn set_webhook_body_preserves_urls_and_secrets_as_json_values() {
    assert_eq!(
        set_webhook_body(
            " https://callback.example/webhook?token=a&next=b ",
            Some(" secret&with=chars ")
        ),
        serde_json::json!({
            "url": "https://callback.example/webhook?token=a&next=b",
            "secret_token": "secret&with=chars"
        })
    );
    assert_eq!(
        set_webhook_body("https://callback.example/webhook", Some("   ")),
        serde_json::json!({
            "url": "https://callback.example/webhook"
        })
    );
    assert_eq!(
        set_webhook_body("https://callback.example/webhook", None),
        serde_json::json!({
            "url": "https://callback.example/webhook"
        })
    );
}

#[test]
fn get_updates_form_fields_omit_negative_offsets() {
    assert_eq!(get_updates_form_fields(None), vec!["timeout=20"]);
    assert_eq!(
        get_updates_form_fields(Some(0)),
        vec!["timeout=20", "offset=0"]
    );
    assert_eq!(
        get_updates_form_fields(Some(42)),
        vec!["timeout=20", "offset=42"]
    );
    assert_eq!(get_updates_form_fields(Some(-1)), vec!["timeout=20"]);
}

#[test]
fn provider_read_responses_normalize_success_failure_and_optional_fields() {
    let me = parse_get_me_response(serde_json::json!({
        "ok": true,
        "result": { "username": "OpsBot" }
    }))
    .expect("getMe success");
    assert!(me.ok);
    assert_eq!(me.username.as_deref(), Some("OpsBot"));
    assert_eq!(me.description, None);

    let auth_failure = parse_get_me_response(serde_json::json!({
        "ok": false,
        "description": "Unauthorized"
    }))
    .expect("getMe provider failure envelope");
    assert!(!auth_failure.ok);
    assert_eq!(auth_failure.username, None);
    assert_eq!(auth_failure.description.as_deref(), Some("Unauthorized"));

    let webhook = parse_webhook_info_response(serde_json::json!({
        "ok": true,
        "result": {
            "url": " https://callback.example/tg ",
            "last_error_message": "last delivery failed"
        }
    }))
    .expect("webhook info success");
    assert!(webhook.ok);
    assert_eq!(
        webhook.url.as_deref(),
        Some(" https://callback.example/tg ")
    );
    assert_eq!(
        webhook.last_error_message.as_deref(),
        Some("last delivery failed")
    );

    let webhook_without_result = parse_webhook_info_response(serde_json::json!({
        "ok": false,
        "description": "Bad webhook"
    }))
    .expect("webhook info failure envelope");
    assert!(!webhook_without_result.ok);
    assert_eq!(webhook_without_result.url, None);
    assert_eq!(webhook_without_result.last_error_message, None);
    assert_eq!(
        webhook_without_result.description.as_deref(),
        Some("Bad webhook")
    );

    let updates = parse_updates_response(serde_json::json!({
        "ok": true,
        "result": [
            { "update_id": 1 },
            { "update_id": 2 }
        ]
    }))
    .expect("updates success");
    assert!(updates.ok);
    assert_eq!(updates.items.as_ref().map(Vec::len), Some(2));

    let updates_failure = parse_updates_response(serde_json::json!({
        "ok": false,
        "description": "Conflict: terminated by other getUpdates request"
    }))
    .expect("updates failure envelope");
    assert!(!updates_failure.ok);
    assert_eq!(updates_failure.items, None);
    assert_eq!(
        updates_failure.description.as_deref(),
        Some("Conflict: terminated by other getUpdates request")
    );
}

#[test]
fn outbound_request_bodies_use_json_and_validate_optional_reply_targets() {
    let reply_markup = serde_json::json!({
        "inline_keyboard": [[{ "text": "Ok", "callback_data": "gto:ok" }]]
    });
    assert_eq!(
        send_message_body("-100123", "hello", Some(" 42 "), Some(reply_markup.clone())),
        serde_json::json!({
            "chat_id": -100123,
            "text": "hello",
            "reply_to_message_id": 42,
            "reply_markup": reply_markup
        })
    );
    assert_eq!(
        send_message_body("chat-1", "hello", Some("0"), None),
        serde_json::json!({
            "chat_id": "chat-1",
            "text": "hello"
        })
    );
    assert_eq!(
        send_message_body("chat-1", "hello", Some("-1"), None),
        serde_json::json!({
            "chat_id": "chat-1",
            "text": "hello"
        })
    );
    assert_eq!(
        send_message_body("chat-1", "hello", Some("not-a-number"), None),
        serde_json::json!({
            "chat_id": "chat-1",
            "text": "hello"
        })
    );

    assert_eq!(
        edit_message_body("chat-1", 77, "updated", Some(reply_markup.clone())),
        serde_json::json!({
            "chat_id": "chat-1",
            "message_id": 77,
            "text": "updated",
            "reply_markup": reply_markup
        })
    );
    assert_eq!(
        delete_message_body("@ops_channel", 78),
        serde_json::json!({
            "chat_id": "@ops_channel",
            "message_id": 78
        })
    );
    assert_eq!(
        chat_action_body("123", "typing"),
        serde_json::json!({
            "chat_id": 123,
            "action": "typing"
        })
    );
    assert_eq!(
        answer_callback_query_body("cbq-1", Some(" done ")),
        serde_json::json!({
            "callback_query_id": "cbq-1",
            "text": "done"
        })
    );
    assert_eq!(
        answer_callback_query_body("cbq-1", Some("   ")),
        serde_json::json!({
            "callback_query_id": "cbq-1"
        })
    );
}

#[test]
fn message_not_modified_detection_is_case_insensitive() {
    assert!(is_message_not_modified(Some(
        "Bad Request: message is not modified"
    )));
    assert!(is_message_not_modified(Some(
        "MESSAGE IS NOT MODIFIED: specified new message content"
    )));
    assert!(!is_message_not_modified(Some(
        "Bad Request: chat not found"
    )));
    assert!(!is_message_not_modified(None));
}

#[test]
fn telegram_provider_errors_classify_peer_and_permission_failures() {
    assert_eq!(
        telegram_provider_error_prefix("Forbidden: bot was kicked from the supergroup"),
        "CHANNEL_CONNECTOR_PERMISSION_DENIED"
    );
    assert_eq!(
        telegram_provider_error_prefix("Bad Request: not enough rights to send text messages"),
        "CHANNEL_CONNECTOR_PERMISSION_DENIED"
    );
    assert_eq!(
        telegram_provider_error_prefix("Too Many Requests: retry after 30"),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE"
    );
    assert_eq!(
        telegram_provider_error("Bad Request: chat not found".to_string()),
        "CHANNEL_CONNECTOR_PERMISSION_DENIED: Bad Request: chat not found"
    );
}

#[test]
fn provider_description_trims_and_defaults_blank_values() {
    assert_eq!(
        provider_description(Some(" Forbidden ".to_string()), "fallback"),
        "Forbidden"
    );
    assert_eq!(
        provider_description(Some("   ".to_string()), "fallback"),
        "fallback"
    );
    assert_eq!(provider_description(None, "fallback"), "fallback");
}

#[test]
fn send_message_response_extracts_ids_and_reports_provider_failures() {
    let success = parse_send_message_response(
        serde_json::json!({
            "ok": true,
            "result": {
                "message_id": 42,
                "chat": { "id": -100123 }
            }
        }),
        "fallback-chat",
    )
    .expect("send response");
    assert_eq!(success.message_id, "42");
    assert_eq!(success.peer_id, "-100123");

    let fallback = parse_send_message_response(
        serde_json::json!({
            "ok": true,
            "result": { "message_id": "abc" }
        }),
        "fallback-chat",
    )
    .expect("send fallback");
    assert_eq!(fallback.message_id, "abc");
    assert_eq!(fallback.peer_id, "fallback-chat");

    let missing = parse_send_message_response(
        serde_json::json!({
            "ok": true
        }),
        "fallback-chat",
    )
    .expect_err("missing result");
    assert_eq!(
        missing,
        "CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: telegram result missing"
    );

    let failure = parse_send_message_response(
        serde_json::json!({
            "ok": false,
            "description": "Forbidden: bot was blocked"
        }),
        "fallback-chat",
    )
    .expect_err("provider failure");
    assert_eq!(
        failure,
        "CHANNEL_CONNECTOR_PERMISSION_DENIED: Forbidden: bot was blocked"
    );

    let default_failure = parse_send_message_response(
        serde_json::json!({
            "ok": false,
            "description": "   "
        }),
        "fallback-chat",
    )
    .expect_err("provider failure with blank description");
    assert_eq!(
        default_failure,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: telegram sendMessage failed"
    );
}

#[test]
fn edit_delete_and_callback_responses_preserve_stable_error_contracts() {
    let unchanged = parse_edit_message_response(
        serde_json::json!({
            "ok": false,
            "description": "Bad Request: message is not modified"
        }),
        "chat-1",
        "77",
    )
    .expect("message not modified is success");
    assert_eq!(unchanged.message_id, "77");
    assert_eq!(unchanged.peer_id, "chat-1");

    let edited = parse_edit_message_response(
        serde_json::json!({
            "ok": true,
            "result": {
                "message_id": 78,
                "chat": { "id": "chat-2" }
            }
        }),
        "chat-1",
        "77",
    )
    .expect("edit response");
    assert_eq!(edited.message_id, "78");
    assert_eq!(edited.peer_id, "chat-2");

    let edit_fallback = parse_edit_message_response(
        serde_json::json!({
            "ok": true,
            "result": {}
        }),
        "chat-fallback",
        "79",
    )
    .expect("edit fallback response");
    assert_eq!(edit_fallback.message_id, "79");
    assert_eq!(edit_fallback.peer_id, "chat-fallback");

    let edit_missing = parse_edit_message_response(
        serde_json::json!({
            "ok": true
        }),
        "chat-1",
        "77",
    )
    .expect_err("missing edit result");
    assert_eq!(
        edit_missing,
        "CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: telegram edit result missing"
    );

    let edit_failure = parse_edit_message_response(
        serde_json::json!({
            "ok": false,
            "description": "Bad Request: chat not found"
        }),
        "chat-1",
        "77",
    )
    .expect_err("edit provider failure");
    assert_eq!(
        edit_failure,
        "CHANNEL_CONNECTOR_PERMISSION_DENIED: Bad Request: chat not found"
    );

    let edit_default_failure = parse_edit_message_response(
        serde_json::json!({
            "ok": false
        }),
        "chat-1",
        "77",
    )
    .expect_err("edit provider failure without description");
    assert_eq!(
        edit_default_failure,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: telegram editMessageText failed"
    );

    let delete = parse_delete_message_response(serde_json::json!({
        "ok": true,
        "result": false
    }))
    .expect("delete response");
    assert!(!delete.ok);

    let delete_default = parse_delete_message_response(serde_json::json!({
        "ok": true
    }))
    .expect("delete default response");
    assert!(delete_default.ok);

    let delete_failure = parse_delete_message_response(serde_json::json!({
        "ok": false,
        "description": "Bad Request: message to delete not found"
    }))
    .expect_err("delete provider failure");
    assert_eq!(
        delete_failure,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: Bad Request: message to delete not found"
    );

    let delete_default_failure = parse_delete_message_response(serde_json::json!({
        "ok": false
    }))
    .expect_err("delete provider failure without description");
    assert_eq!(
        delete_default_failure,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: telegram deleteMessage failed"
    );

    parse_answer_callback_query_response(serde_json::json!({
        "ok": true,
        "result": true
    }))
    .expect("callback answer success");

    let callback_invalid = parse_answer_callback_query_response(serde_json::json!({
        "ok": "true"
    }))
    .expect_err("callback invalid response");
    assert!(callback_invalid.starts_with("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE:"));

    let callback_failure = parse_answer_callback_query_response(serde_json::json!({
        "ok": false
    }))
    .expect_err("callback provider failure");
    assert_eq!(
        callback_failure,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: telegram answerCallbackQuery failed"
    );
}
