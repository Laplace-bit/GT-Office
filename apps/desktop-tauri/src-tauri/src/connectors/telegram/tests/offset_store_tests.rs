use super::{
    extract_bot_id, normalize_account_id, offset_store_path, read_offset,
    should_accept_offset_state, write_offset, OffsetStateFile, OFFSET_STORE_VERSION,
};
use tauri::{test::mock_app, Manager};

#[test]
fn normalize_account_id_replaces_unsafe_path_characters() {
    assert_eq!(normalize_account_id(""), "default");
    assert_eq!(normalize_account_id("  "), "default");
    assert_eq!(normalize_account_id("ops.bot_1-prod"), "ops.bot_1-prod");
    assert_eq!(normalize_account_id("ops/bot:prod 中文"), "ops_bot_prod___");
}

#[test]
fn extract_bot_id_reads_numeric_prefix_before_token_separator() {
    assert_eq!(extract_bot_id("123456:ABCDEF").as_deref(), Some("123456"));
    assert_eq!(extract_bot_id(" 98765 : token ").as_deref(), Some("98765"));
    assert_eq!(extract_bot_id("not-a-token"), None);
    assert_eq!(extract_bot_id(":missing"), None);
    assert_eq!(extract_bot_id(""), None);
}

#[test]
fn offset_state_file_round_trips_stable_schema() {
    let state = OffsetStateFile {
        version: OFFSET_STORE_VERSION,
        last_update_id: 7788,
        bot_id: Some("123456".to_string()),
    };

    let payload = serde_json::to_value(&state).expect("serialize offset state");

    assert_eq!(
        payload,
        serde_json::json!({
            "version": 1,
            "lastUpdateId": 7788,
            "botId": "123456"
        })
    );
    let decoded: OffsetStateFile = serde_json::from_value(payload).expect("decode state");
    assert_eq!(decoded.version, OFFSET_STORE_VERSION);
    assert_eq!(decoded.last_update_id, 7788);
    assert_eq!(decoded.bot_id.as_deref(), Some("123456"));

    let legacy_without_bot_id: OffsetStateFile = serde_json::from_value(serde_json::json!({
        "version": 1,
        "lastUpdateId": 99
    }))
    .expect("decode legacy offset state");
    assert_eq!(legacy_without_bot_id.version, OFFSET_STORE_VERSION);
    assert_eq!(legacy_without_bot_id.last_update_id, 99);
    assert_eq!(legacy_without_bot_id.bot_id, None);
}

#[test]
fn offset_state_acceptance_rejects_version_and_bot_mismatches() {
    let state = OffsetStateFile {
        version: OFFSET_STORE_VERSION,
        last_update_id: 7788,
        bot_id: Some("123456".to_string()),
    };

    assert!(should_accept_offset_state(&state, "123456:token"));
    assert!(!should_accept_offset_state(&state, "654321:token"));
    assert!(should_accept_offset_state(&state, "not-a-bot-token"));
    assert!(should_accept_offset_state(&state, "   "));

    let legacy_state = OffsetStateFile {
        version: OFFSET_STORE_VERSION + 1,
        last_update_id: 7788,
        bot_id: Some("123456".to_string()),
    };
    assert!(!should_accept_offset_state(&legacy_state, "123456:token"));

    let negative_offset_state = OffsetStateFile {
        version: OFFSET_STORE_VERSION,
        last_update_id: -1,
        bot_id: Some("123456".to_string()),
    };
    assert!(!should_accept_offset_state(
        &negative_offset_state,
        "123456:token"
    ));

    let state_without_bot = OffsetStateFile {
        version: OFFSET_STORE_VERSION,
        last_update_id: 7788,
        bot_id: None,
    };
    assert!(should_accept_offset_state(
        &state_without_bot,
        "123456:token"
    ));
}

#[test]
fn offset_store_file_round_trips_and_rejects_invalid_writes() {
    let app = mock_app();
    let account_id = format!("ops/{}", uuid::Uuid::new_v4());
    let token = "123456:token";

    assert_eq!(
        read_offset(app.app_handle(), &account_id, token).expect("missing offset"),
        None
    );

    let invalid = write_offset(app.app_handle(), &account_id, token, -1)
        .expect_err("negative offset should fail");
    assert_eq!(
        invalid,
        "CHANNEL_CONNECTOR_OFFSET_INVALID: last update id must be non-negative"
    );

    write_offset(app.app_handle(), &account_id, token, 99).expect("write offset");
    assert_eq!(
        read_offset(app.app_handle(), &account_id, token).expect("read offset"),
        Some(99)
    );
    assert_eq!(
        read_offset(app.app_handle(), &account_id, "654321:token").expect("bot mismatch ignored"),
        None
    );

    let path = offset_store_path(app.app_handle(), &account_id).expect("offset path");
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .expect("file name");
    assert!(file_name.starts_with("update-offset-ops_"));
}
