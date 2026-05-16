use super::{
    base_url, extract_message_id, message_content, parse_bot_info_response,
    parse_tenant_access_token_response, reply_text_message_body, reply_text_message_query,
    sdk_base_url, send_text_message_body, send_text_message_query,
};
use crate::connectors::feishu::types::FeishuDomain;
use feishu_sdk::core::{FEISHU_BASE_URL, LARK_BASE_URL};

#[test]
fn base_url_tracks_feishu_and_lark_domains() {
    assert_eq!(base_url(FeishuDomain::Feishu), "https://open.feishu.cn");
    assert_eq!(base_url(FeishuDomain::Lark), "https://open.larksuite.com");
    assert_eq!(sdk_base_url(FeishuDomain::Feishu), FEISHU_BASE_URL);
    assert_eq!(sdk_base_url(FeishuDomain::Lark), LARK_BASE_URL);
}

#[test]
fn send_text_message_query_uses_chat_receive_id_type() {
    assert_eq!(
        send_text_message_query(),
        vec![("receive_id_type", "chat_id")]
    );
}

#[test]
fn reply_text_message_query_carries_msg_type() {
    assert!(reply_text_message_query().is_empty());
}

#[test]
fn tenant_access_token_response_trims_and_reports_auth_failures() {
    let token = parse_tenant_access_token_response(serde_json::json!({
        "code": 0,
        "tenant_access_token": " token-1 "
    }))
    .expect("tenant token");
    assert_eq!(token, "token-1");

    let provider_error = parse_tenant_access_token_response(serde_json::json!({
        "code": 99991663,
        "msg": " app_secret invalid "
    }))
    .expect_err("auth failure");
    assert_eq!(
        provider_error.to_string(),
        "CHANNEL_CONNECTOR_AUTH_FAILED: app_secret invalid"
    );

    let blank_provider_error = parse_tenant_access_token_response(serde_json::json!({
        "code": 99991663,
        "msg": "   "
    }))
    .expect_err("blank auth failure");
    assert_eq!(
        blank_provider_error.to_string(),
        "CHANNEL_CONNECTOR_AUTH_FAILED: tenant_access_token request failed"
    );

    let missing = parse_tenant_access_token_response(serde_json::json!({
        "code": 0,
        "tenant_access_token": "   "
    }))
    .expect_err("missing token");
    assert_eq!(
        missing.to_string(),
        "CHANNEL_CONNECTOR_AUTH_FAILED: missing tenant access token"
    );

    let invalid = parse_tenant_access_token_response(serde_json::json!("bad shape"))
        .expect_err("invalid token shape");
    assert!(invalid.starts_with("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE:"));
}

#[test]
fn bot_info_response_normalizes_names_and_rejects_inactive_bots() {
    let named = parse_bot_info_response(serde_json::json!({
        "code": 0,
        "bot": {
            "activate_status": 1,
            "name": " Bot Name ",
            "app_name": " App Name ",
            "open_id": "   "
        }
    }))
    .expect("named bot info");
    assert_eq!(named.bot_name.as_deref(), Some("Bot Name"));
    assert_eq!(named.bot_open_id, None);

    let info = parse_bot_info_response(serde_json::json!({
        "code": 0,
        "bot": {
            "activate_status": 1,
            "name": "   ",
            "app_name": " Ops Bot ",
            "open_id": " ou_1 "
        }
    }))
    .expect("bot info");
    assert_eq!(info.bot_name.as_deref(), Some("Ops Bot"));
    assert_eq!(info.bot_open_id.as_deref(), Some("ou_1"));

    let inactive = parse_bot_info_response(serde_json::json!({
        "code": 0,
        "bot": {
            "activate_status": 0,
            "name": "Ops Bot"
        }
    }))
    .expect_err("inactive bot");
    assert_eq!(
        inactive.to_string(),
        "CHANNEL_CONNECTOR_AUTH_FAILED: bot capability is not activated"
    );

    let missing_bot = parse_bot_info_response(serde_json::json!({
        "code": 0
    }))
    .expect_err("missing bot");
    assert_eq!(
        missing_bot.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: missing bot payload"
    );

    let provider_error = parse_bot_info_response(serde_json::json!({
        "code": 19001,
        "msg": " bad token "
    }))
    .expect_err("provider error");
    assert_eq!(
        provider_error.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: bad token"
    );

    let blank_provider_error = parse_bot_info_response(serde_json::json!({
        "code": 19001,
        "msg": "   "
    }))
    .expect_err("blank provider error");
    assert_eq!(
        blank_provider_error.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: bot info request failed"
    );

    let default_provider_error = parse_bot_info_response(serde_json::json!({
        "code": 19001
    }))
    .expect_err("default provider error");
    assert_eq!(
        default_provider_error.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: bot info request failed"
    );

    let invalid =
        parse_bot_info_response(serde_json::json!("bad shape")).expect_err("invalid bot shape");
    assert!(invalid.starts_with("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE:"));
}

#[test]
fn send_text_message_body_matches_feishu_create_contract() {
    let body = send_text_message_body(" oc_123 ", " hello ", "uuid-1");

    assert_eq!(
        body.get("receive_id").and_then(|value| value.as_str()),
        Some("oc_123")
    );
    assert_eq!(
        body.get("msg_type").and_then(|value| value.as_str()),
        Some("text")
    );
    assert_eq!(
        body.get("content").and_then(|value| value.as_str()),
        Some("{\"text\":\"hello\"}")
    );
    assert_eq!(
        body.get("uuid").and_then(|value| value.as_str()),
        Some("uuid-1")
    );
}

#[test]
fn reply_text_message_body_matches_feishu_reply_contract() {
    let body = reply_text_message_body(" hello ", "uuid-2");

    assert_eq!(
        body.get("msg_type").and_then(|value| value.as_str()),
        Some("text")
    );
    assert_eq!(
        body.get("content").and_then(|value| value.as_str()),
        Some("{\"text\":\"hello\"}")
    );
    assert_eq!(
        body.get("uuid").and_then(|value| value.as_str()),
        Some("uuid-2")
    );
}

#[test]
fn message_content_escapes_text_as_nested_json_string() {
    assert_eq!(
        message_content("hello \"ops\"\nnext"),
        "{\"text\":\"hello \\\"ops\\\"\\nnext\"}"
    );
}

#[test]
fn extract_message_id_trims_success_and_reports_missing_data() {
    let message_id = extract_message_id(
        serde_json::json!({
            "code": 0,
            "data": { "message_id": " om_123 " }
        }),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
    .expect("message id");
    assert_eq!(message_id, "om_123");

    let missing = extract_message_id(
        serde_json::json!({
            "code": 0,
            "data": { "message_id": "   " }
        }),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
    .expect_err("missing message id");
    assert!(missing.starts_with("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE: missing message_id"));

    let invalid = extract_message_id(
        serde_json::json!("bad shape"),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
    .expect_err("invalid message shape");
    assert!(invalid.starts_with("CHANNEL_CONNECTOR_PROVIDER_INVALID_RESPONSE:"));
}

#[test]
fn extract_message_id_preserves_feishu_error_code() {
    let payload = serde_json::json!({
        "code": 230002,
        "msg": "Bot/User can NOT be out of the chat"
    });

    let error = extract_message_id(payload, "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE")
        .expect_err("non-zero Feishu code should fail");

    assert!(error.contains("code=230002"));
    assert!(error.contains("Bot/User can NOT be out of the chat"));
}

#[test]
fn extract_message_id_preserves_provider_request_diagnostics() {
    let payload = serde_json::json!({
        "code": 230002,
        "msg": "Bot/User can NOT be out of the chat",
        "request_id": "20260515203538BDC9DDC7A496E680150A",
        "http_status": 400
    });

    let error = extract_message_id(payload, "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE")
        .expect_err("provider diagnostic fields should be preserved");

    assert!(error.starts_with("CHANNEL_CONNECTOR_PERMISSION_DENIED:"));
    assert!(error.contains("code=230002"));
    assert!(error.contains("msg=Bot/User can NOT be out of the chat"));
    assert!(error.contains("request_id=20260515203538BDC9DDC7A496E680150A"));
    assert!(error.contains("http_status=400"));
}

#[test]
fn extract_message_id_omits_blank_request_diagnostics() {
    let payload = serde_json::json!({
        "code": 9999,
        "msg": "failed",
        "request_id": "   "
    });

    let error = extract_message_id(payload, "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE")
        .expect_err("blank request id should be omitted");

    assert_eq!(
        error.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: code=9999 msg=failed"
    );
}

#[test]
fn extract_message_id_classifies_membership_error_as_permission_denied() {
    let payload = serde_json::json!({
        "code": 230002,
        "msg": "Bot/User can NOT be out of the chat"
    });

    let error = extract_message_id(payload, "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE")
        .expect_err("membership Feishu code should fail");

    assert!(error.starts_with("CHANNEL_CONNECTOR_PERMISSION_DENIED:"));
}

#[test]
fn extract_message_id_classifies_non_permission_errors_as_provider_unavailable() {
    let error = extract_message_id(
        serde_json::json!({
            "code": 9999
        }),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
    .expect_err("non-permission provider error");

    assert_eq!(
        error.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: code=9999 msg=message request failed"
    );

    let blank_message = extract_message_id(
        serde_json::json!({
            "code": 9999,
            "msg": "   "
        }),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE",
    )
    .expect_err("blank provider message should fallback");

    assert_eq!(
        blank_message.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: code=9999 msg=message request failed"
    );
}
