use super::{
    contains_provider_code, normalize_provider_error, provider_error_prefix,
    should_fallback_to_direct_send,
};

#[test]
fn falls_back_for_withdrawn_or_missing_reply_targets() {
    assert!(should_fallback_to_direct_send(
        "Feishu reply failed: code=230011 msg=The message was withdrawn."
    ));
    assert!(should_fallback_to_direct_send(
        "Feishu reply failed: code=231003 msg=The message is not found"
    ));
    assert!(should_fallback_to_direct_send(
        "Feishu reply failed: code : 230011 msg=The message was withdrawn."
    ));
}

#[test]
fn does_not_fallback_for_membership_or_unknown_provider_errors() {
    assert!(!should_fallback_to_direct_send(
        "Feishu reply failed: code=230002 msg=Bot/User can NOT be out of the chat"
    ));
    assert!(!should_fallback_to_direct_send(
        "Feishu reply failed: code=999999 msg=unknown failure"
    ));
}

#[test]
fn classifies_membership_errors_as_permission_denied() {
    let raw = "api error: code=230002, msg=Bot/User can NOT be out of the chat., request_id=req-1, http_status=400";
    assert_eq!(
        provider_error_prefix(raw),
        "CHANNEL_CONNECTOR_PERMISSION_DENIED"
    );

    let normalized = normalize_provider_error(raw);
    assert!(normalized.starts_with("CHANNEL_CONNECTOR_PERMISSION_DENIED:"));
    assert!(normalized.contains("feishu bot is not in the chat"));
    assert!(normalized.contains("code=230002"));
    assert!(normalized.contains("request_id=req-1"));
    assert_eq!(
        provider_error_prefix("api error: code = 230002, msg=permission denied"),
        "CHANNEL_CONNECTOR_PERMISSION_DENIED"
    );
    assert_eq!(
        provider_error_prefix(r#"status=400 body={"code":230002,"msg":"denied"}"#),
        "CHANNEL_CONNECTOR_PERMISSION_DENIED"
    );
}

#[test]
fn provider_code_matching_tolerates_common_separator_formats() {
    assert!(contains_provider_code("api error: code=230002", "230002"));
    assert!(contains_provider_code("api error: code = 230002", "230002"));
    assert!(contains_provider_code("api error: code:230002", "230002"));
    assert!(contains_provider_code("api error: code : 230002", "230002"));
    assert!(contains_provider_code(
        r#"status=400 body={"code": 230002}"#,
        "230002"
    ));
    assert!(contains_provider_code(
        "status=400 body={'code':230002}",
        "230002"
    ));
    assert!(!contains_provider_code(
        "api error: error_code=230002",
        "230002"
    ));
    assert!(!contains_provider_code(
        r#"status=400 body={"error_code":230002}"#,
        "230002"
    ));
    assert!(!contains_provider_code("api error: code=230003", "230002"));
}

#[test]
fn keeps_unknown_provider_errors_unavailable() {
    let normalized = normalize_provider_error("transport timeout");

    assert_eq!(
        provider_error_prefix("code=999999 msg=unknown failure"),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE"
    );
    assert_eq!(
        normalized.to_string(),
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: transport timeout"
    );
}
