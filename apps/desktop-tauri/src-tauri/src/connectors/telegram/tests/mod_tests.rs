use super::{
    account_id_for_webhook_secret_in_store, default_token_ref, default_webhook_secret_ref,
    extract_callback_query_id, is_poll_primed, keyboard_to_reply_markup, mark_poll_primed,
    normalize_account_id, normalize_mode, read_poll_offset, save_store, send_text_reply,
    update_id_from_item, validate_callback_query_input, validate_delete_input, validate_edit_input,
    validate_message_id, validate_send_input, webhook_urls_match, write_poll_offset,
    ConnectorStoreFile, TelegramAccountRecord, TelegramInlineKeyboardButton,
};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

fn telegram_store_test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[test]
fn normalize_account_id_defaults_and_trims() {
    assert_eq!(normalize_account_id(None), "default");
    assert_eq!(normalize_account_id(Some("  ")), "default");
    assert_eq!(normalize_account_id(Some(" OpsBot ")), "OpsBot");
}

#[test]
fn normalize_mode_defaults_and_rejects_unknown_values() {
    assert_eq!(normalize_mode(None).as_deref(), Ok("polling"));
    assert_eq!(normalize_mode(Some(" WEBHOOK ")).as_deref(), Ok("webhook"));
    assert_eq!(normalize_mode(Some("polling")).as_deref(), Ok("polling"));

    let error = normalize_mode(Some("socket")).expect_err("unsupported mode");
    assert!(error.contains("CHANNEL_CONNECTOR_MODE_INVALID"));
}

#[test]
fn default_secret_refs_use_lowercase_account_key() {
    assert_eq!(default_token_ref(" OpsBot "), "telegram/opsbot/bot_token");
    assert_eq!(
        default_webhook_secret_ref(" OpsBot "),
        "telegram/opsbot/webhook_secret"
    );
}

#[test]
fn upsert_account_persists_and_lists_normalized_configuration() {
    let _guard = telegram_store_test_lock()
        .lock()
        .expect("telegram store test lock");
    let app = tauri::test::mock_app();
    let suffix = uuid::Uuid::new_v4();
    save_store(app.handle(), &ConnectorStoreFile::default()).expect("clear telegram store");

    let view = super::upsert_account(
        app.handle(),
        super::TelegramAccountUpsertInput {
            account_id: Some(" OpsBot ".to_string()),
            enabled: Some(true),
            mode: Some(" WEBHOOK ".to_string()),
            bot_token: Some(" token-1 ".to_string()),
            bot_token_ref: Some(format!("telegram/test-{suffix}/bot_token")),
            webhook_secret: Some(" secret-1 ".to_string()),
            webhook_secret_ref: Some(format!("telegram/test-{suffix}/webhook_secret")),
            webhook_path: Some(" /telegram/custom ".to_string()),
        },
    )
    .expect("upsert telegram account");

    assert_eq!(view.channel, "telegram");
    assert_eq!(view.account_id, "OpsBot");
    assert_eq!(view.mode, "webhook");
    assert_eq!(view.webhook_path.as_deref(), Some("/telegram/custom"));
    assert!(view.has_bot_token);
    assert!(view.has_webhook_secret);

    let listed = super::list_accounts(app.handle()).expect("list accounts");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].account_id, "OpsBot");

    let updated = super::upsert_account(
        app.handle(),
        super::TelegramAccountUpsertInput {
            account_id: Some("opsbot".to_string()),
            enabled: Some(false),
            mode: None,
            bot_token: None,
            bot_token_ref: None,
            webhook_secret: None,
            webhook_secret_ref: None,
            webhook_path: None,
        },
    )
    .expect("update telegram account");

    assert_eq!(updated.account_id, "opsbot");
    assert!(!updated.enabled);
    assert_eq!(updated.mode, "webhook");
    assert_eq!(updated.webhook_path.as_deref(), Some("/telegram/custom"));
    assert!(updated.has_bot_token);
    assert!(updated.has_webhook_secret);
}

#[test]
fn upsert_account_rejects_missing_token_before_persisting_account() {
    let _guard = telegram_store_test_lock()
        .lock()
        .expect("telegram store test lock");
    let app = tauri::test::mock_app();
    let suffix = uuid::Uuid::new_v4();
    save_store(app.handle(), &ConnectorStoreFile::default()).expect("clear telegram store");

    let error = super::upsert_account(
        app.handle(),
        super::TelegramAccountUpsertInput {
            account_id: Some("missing-token".to_string()),
            enabled: Some(true),
            mode: Some("polling".to_string()),
            bot_token: None,
            bot_token_ref: Some(format!("telegram/test-{suffix}/missing_token")),
            webhook_secret: None,
            webhook_secret_ref: None,
            webhook_path: None,
        },
    )
    .expect_err("missing token rejected");

    assert_eq!(
        error,
        "CHANNEL_CONNECTOR_UNCONFIGURED: telegram bot token is required"
    );
    assert!(super::list_accounts(app.handle())
        .expect("list accounts")
        .is_empty());
}

#[test]
fn send_and_edit_input_validation_trim_and_reject_blank_values() {
    assert_eq!(
        validate_send_input(" chat-1 ", " hello ").expect("valid send"),
        ("chat-1", "hello")
    );
    assert_eq!(
        validate_send_input("   ", "hello").expect_err("blank peer"),
        "CHANNEL_CONNECTOR_SEND_INVALID: peer id is required"
    );
    assert_eq!(
        validate_send_input("chat-1", "   ").expect_err("blank text"),
        "CHANNEL_CONNECTOR_SEND_INVALID: text is required"
    );

    assert_eq!(
        validate_edit_input(" chat-1 ", " 42 ", " updated ").expect("valid edit"),
        ("chat-1", "42", "updated")
    );
    assert_eq!(
        validate_edit_input("chat-1", "   ", "updated").expect_err("blank message id"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id is required"
    );
    assert_eq!(
        validate_edit_input("chat-1", "msg-1", "updated").expect_err("nonnumeric message id"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric"
    );
}

#[tokio::test]
async fn outbound_runtime_commands_reject_local_failures_before_provider_calls() {
    let _guard = telegram_store_test_lock()
        .lock()
        .expect("telegram store test lock");
    let app = tauri::test::mock_app();

    assert_eq!(
        super::sync_runtime_webhook(app.handle(), Some("missing"), " ")
            .await
            .expect_err("blank runtime webhook url"),
        "CHANNEL_CONNECTOR_WEBHOOK_MISSING: runtime webhook url is empty"
    );
    assert_eq!(
        super::sync_runtime_webhook(app.handle(), Some("missing"), "http://example.test/hook")
            .await
            .expect_err("non-https runtime webhook url"),
        "CHANNEL_CONNECTOR_WEBHOOK_INVALID: telegram setWebhook requires an HTTPS URL"
    );
    assert_eq!(
        super::sync_runtime_webhook(app.handle(), Some("missing"), "https://example.test/hook")
            .await
            .expect_err("missing sync account"),
        "CHANNEL_CONNECTOR_NOT_FOUND: telegram account missing"
    );
    assert_eq!(
        super::send_typing_action(app.handle(), Some("missing"), " ")
            .await
            .expect_err("blank typing peer"),
        "CHANNEL_CONNECTOR_SEND_INVALID: peer id is required"
    );
    assert_eq!(
        super::send_typing_action(app.handle(), Some("missing"), "chat-1")
            .await
            .expect_err("missing typing account"),
        "CHANNEL_CONNECTOR_NOT_FOUND: telegram account missing"
    );
    assert_eq!(
        super::edit_text_reply(app.handle(), Some("missing"), "chat-1", "1", "hello")
            .await
            .expect_err("missing edit account"),
        "CHANNEL_CONNECTOR_NOT_FOUND: telegram account missing"
    );
    assert_eq!(
        super::delete_message(app.handle(), Some("missing"), "chat-1", "1")
            .await
            .expect_err("missing delete account"),
        "CHANNEL_CONNECTOR_NOT_FOUND: telegram account missing"
    );
    assert_eq!(
        super::answer_callback_query(app.handle(), Some("missing"), "cbq-1", None)
            .await
            .expect_err("missing callback account"),
        "CHANNEL_CONNECTOR_NOT_FOUND: telegram account missing"
    );

    let mut store = ConnectorStoreFile::default();
    store.telegram_accounts.insert(
        "disabled".to_string(),
        test_account_record("disabled", false),
    );
    save_store(app.handle(), &store).expect("store disabled account");

    assert_eq!(
        super::sync_runtime_webhook(app.handle(), Some("disabled"), "https://example.test/hook")
            .await
            .expect_err("disabled sync account"),
        "CHANNEL_CONNECTOR_DISABLED: telegram account is disabled"
    );
    assert_eq!(
        super::send_typing_action(app.handle(), Some("disabled"), "chat-1")
            .await
            .expect_err("disabled typing account"),
        "CHANNEL_CONNECTOR_DISABLED: telegram account is disabled"
    );
    assert_eq!(
        super::edit_text_reply(app.handle(), Some("disabled"), "chat-1", "1", "hello")
            .await
            .expect_err("disabled edit account"),
        "CHANNEL_CONNECTOR_DISABLED: telegram account is disabled"
    );
    assert_eq!(
        super::delete_message(app.handle(), Some("disabled"), "chat-1", "1")
            .await
            .expect_err("disabled delete account"),
        "CHANNEL_CONNECTOR_DISABLED: telegram account is disabled"
    );
    assert_eq!(
        super::answer_callback_query(app.handle(), Some("disabled"), "cbq-1", None)
            .await
            .expect_err("disabled callback account"),
        "CHANNEL_CONNECTOR_DISABLED: telegram account is disabled"
    );
}

#[tokio::test]
async fn health_check_reports_missing_and_disabled_accounts_without_provider_calls() {
    let _guard = telegram_store_test_lock()
        .lock()
        .expect("telegram store test lock");
    let app = tauri::test::mock_app();

    let missing = super::health_check(app.handle(), Some("missing"), None)
        .await
        .expect_err("missing account");
    assert_eq!(
        missing,
        "CHANNEL_CONNECTOR_NOT_FOUND: telegram account missing"
    );

    let mut store = ConnectorStoreFile::default();
    store.telegram_accounts.insert(
        "disabled".to_string(),
        test_account_record("disabled", false),
    );
    save_store(app.handle(), &store).expect("store disabled account");

    let snapshot = super::health_check(
        app.handle(),
        Some("disabled"),
        Some("https://runtime.example/hook".to_string()),
    )
    .await
    .expect("disabled health");

    assert_eq!(snapshot.channel, "telegram");
    assert_eq!(snapshot.account_id, "disabled");
    assert!(!snapshot.ok);
    assert_eq!(snapshot.status, "disabled");
    assert_eq!(snapshot.detail, "connector account is disabled");
    assert_eq!(snapshot.mode, "polling");
    assert_eq!(
        snapshot.runtime_webhook_url.as_deref(),
        Some("https://runtime.example/hook")
    );
    assert_eq!(snapshot.webhook_matched, None);
}

#[tokio::test]
async fn send_text_reply_rejects_missing_and_disabled_accounts_before_provider_calls() {
    let _guard = telegram_store_test_lock()
        .lock()
        .expect("telegram store test lock");
    let app = tauri::test::mock_app();

    let missing = send_text_reply(app.handle(), Some("missing"), "chat-1", "hello", None)
        .await
        .expect_err("missing account");
    assert_eq!(
        missing,
        "CHANNEL_CONNECTOR_NOT_FOUND: telegram account missing"
    );

    let mut store = ConnectorStoreFile::default();
    store.telegram_accounts.insert(
        "disabled".to_string(),
        test_account_record("disabled", false),
    );
    save_store(app.handle(), &store).expect("store disabled account");

    let disabled = send_text_reply(app.handle(), Some("disabled"), "chat-1", "hello", None)
        .await
        .expect_err("disabled account");
    assert_eq!(
        disabled,
        "CHANNEL_CONNECTOR_DISABLED: telegram account is disabled"
    );
}

fn test_account_record(account_id: &str, enabled: bool) -> TelegramAccountRecord {
    TelegramAccountRecord {
        account_id: account_id.to_string(),
        enabled,
        mode: "polling".to_string(),
        bot_token_ref: format!("telegram/{account_id}/bot_token"),
        webhook_secret_ref: None,
        webhook_path: None,
        updated_at_ms: 1,
    }
}

#[test]
fn delete_and_callback_input_validation_trim_and_reject_blank_values() {
    assert_eq!(
        validate_delete_input(" chat-1 ", " 42 ").expect("valid delete"),
        ("chat-1", "42")
    );
    assert_eq!(
        validate_delete_input("   ", "msg-1").expect_err("blank peer"),
        "CHANNEL_CONNECTOR_SEND_INVALID: peer id is required"
    );
    assert_eq!(
        validate_delete_input("chat-1", "   ").expect_err("blank message id"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id is required"
    );
    assert_eq!(
        validate_delete_input("chat-1", "0").expect_err("zero message id"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric"
    );

    assert_eq!(
        validate_callback_query_input(" callback-1 ").expect("valid callback"),
        "callback-1"
    );
    assert_eq!(
        validate_callback_query_input("   ").expect_err("blank callback"),
        "CHANNEL_CONNECTOR_SEND_INVALID: callback query id is required"
    );
}

#[test]
fn validate_message_id_rejects_nonpositive_and_nonnumeric_values() {
    assert_eq!(validate_message_id("42"), Ok(()));
    assert_eq!(
        validate_message_id("").expect_err("blank"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id is required"
    );
    assert_eq!(
        validate_message_id("-1").expect_err("negative"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric"
    );
    assert_eq!(
        validate_message_id("abc").expect_err("nonnumeric"),
        "CHANNEL_CONNECTOR_SEND_INVALID: message id must be numeric"
    );
}

#[test]
fn keyboard_to_reply_markup_serializes_inline_rows() {
    let keyboard = vec![
        vec![
            TelegramInlineKeyboardButton {
                text: " Approve ".to_string(),
                callback_data: " gto:1 ".to_string(),
            },
            TelegramInlineKeyboardButton {
                text: "Reject".to_string(),
                callback_data: "gto:2".to_string(),
            },
        ],
        vec![TelegramInlineKeyboardButton {
            text: "Down".to_string(),
            callback_data: "gto-key:down".to_string(),
        }],
    ];

    let markup = keyboard_to_reply_markup(Some(&keyboard)).expect("reply markup");

    assert_eq!(
        markup,
        serde_json::json!({
            "inline_keyboard": [
                [
                    { "text": "Approve", "callback_data": "gto:1" },
                    { "text": "Reject", "callback_data": "gto:2" }
                ],
                [
                    { "text": "Down", "callback_data": "gto-key:down" }
                ]
            ]
        })
    );
    assert_eq!(keyboard_to_reply_markup(None), None);

    let invalid_only = vec![
        vec![TelegramInlineKeyboardButton {
            text: " ".to_string(),
            callback_data: "gto:empty-text".to_string(),
        }],
        vec![TelegramInlineKeyboardButton {
            text: "Missing callback".to_string(),
            callback_data: " ".to_string(),
        }],
        Vec::new(),
    ];
    assert_eq!(keyboard_to_reply_markup(Some(&invalid_only)), None);

    let mixed = vec![
        invalid_only[0].clone(),
        vec![TelegramInlineKeyboardButton {
            text: "Ok".to_string(),
            callback_data: "gto:ok".to_string(),
        }],
    ];
    assert_eq!(
        keyboard_to_reply_markup(Some(&mixed)),
        Some(serde_json::json!({
            "inline_keyboard": [[{ "text": "Ok", "callback_data": "gto:ok" }]]
        }))
    );
}

#[test]
fn polling_offset_memory_cache_tracks_account_offsets() {
    let account_id = format!("poll-{}", uuid::Uuid::new_v4());
    assert_eq!(read_poll_offset(&account_id), None);

    write_poll_offset(&account_id, -1);
    assert_eq!(read_poll_offset(&account_id), None);

    write_poll_offset(&account_id, 41);
    assert_eq!(read_poll_offset(&account_id), Some(41));

    write_poll_offset(&account_id, -1);
    assert_eq!(read_poll_offset(&account_id), Some(41));

    write_poll_offset(&account_id, 42);
    assert_eq!(read_poll_offset(&account_id), Some(42));
}

#[test]
fn poll_primed_status_tracks_accounts_independently() {
    let account_id = format!("primed-{}", uuid::Uuid::new_v4());
    let other = format!("primed-{}", uuid::Uuid::new_v4());

    assert!(!is_poll_primed(&account_id));
    assert!(!is_poll_primed(&other));

    mark_poll_primed(&account_id);

    assert!(is_poll_primed(&account_id));
    assert!(!is_poll_primed(&other));
}

#[test]
fn callback_query_id_is_extracted_from_metadata_when_present() {
    let metadata = serde_json::json!({
        "callback_query": {
            "id": " cbq-1 "
        }
    });
    assert_eq!(
        extract_callback_query_id(&metadata).as_deref(),
        Some("cbq-1")
    );

    let missing = serde_json::json!({
        "message": {
            "message_id": 1
        }
    });
    assert_eq!(extract_callback_query_id(&missing), None);
}

#[test]
fn update_id_from_item_rejects_negative_and_overflow_values() {
    assert_eq!(
        update_id_from_item(&serde_json::json!({ "update_id": 42 })),
        Some(42)
    );
    assert_eq!(
        update_id_from_item(&serde_json::json!({ "update_id": -1 })),
        None
    );
    assert_eq!(
        update_id_from_item(&serde_json::json!({ "update_id": u64::MAX })),
        None
    );
    assert_eq!(
        update_id_from_item(&serde_json::json!({ "message": {} })),
        None
    );
}

#[test]
fn account_id_for_webhook_secret_matches_enabled_webhook_accounts_only() {
    let mut store = ConnectorStoreFile::default();
    store.telegram_accounts = HashMap::from([
        (
            "ops".to_string(),
            TelegramAccountRecord {
                account_id: "ops".to_string(),
                enabled: true,
                mode: "webhook".to_string(),
                bot_token_ref: "telegram/ops/bot_token".to_string(),
                webhook_secret_ref: Some("telegram/ops/webhook_secret".to_string()),
                webhook_path: None,
                updated_at_ms: 1,
            },
        ),
        (
            "disabled".to_string(),
            TelegramAccountRecord {
                account_id: "disabled".to_string(),
                enabled: false,
                mode: "webhook".to_string(),
                bot_token_ref: "telegram/disabled/bot_token".to_string(),
                webhook_secret_ref: Some("telegram/disabled/webhook_secret".to_string()),
                webhook_path: None,
                updated_at_ms: 1,
            },
        ),
        (
            "polling".to_string(),
            TelegramAccountRecord {
                account_id: "polling".to_string(),
                enabled: true,
                mode: "polling".to_string(),
                bot_token_ref: "telegram/polling/bot_token".to_string(),
                webhook_secret_ref: Some("telegram/polling/webhook_secret".to_string()),
                webhook_path: None,
                updated_at_ms: 1,
            },
        ),
    ]);

    let loader = |reference: &str| match reference {
        "telegram/ops/webhook_secret" => Ok(" secret-ops ".to_string()),
        "telegram/disabled/webhook_secret" => Ok("secret-disabled".to_string()),
        "telegram/polling/webhook_secret" => Ok("secret-polling".to_string()),
        other => Err(format!("unexpected secret ref {other}")),
    };

    assert_eq!(
        account_id_for_webhook_secret_in_store(&store, "secret-ops", loader)
            .expect("secret lookup"),
        Some("ops".to_string())
    );
    assert_eq!(
        account_id_for_webhook_secret_in_store(&store, "secret-disabled", loader)
            .expect("disabled ignored"),
        None
    );
    assert_eq!(
        account_id_for_webhook_secret_in_store(&store, "secret-polling", loader)
            .expect("polling ignored"),
        None
    );
    assert_eq!(
        account_id_for_webhook_secret_in_store(&store, "   ", loader).expect("blank ignored"),
        None
    );
}

#[test]
fn account_id_for_webhook_secret_handles_missing_blank_and_failed_secret_refs() {
    let mut store = ConnectorStoreFile::default();
    store.telegram_accounts = HashMap::from([
        (
            "missing-ref".to_string(),
            TelegramAccountRecord {
                account_id: "missing-ref".to_string(),
                enabled: true,
                mode: "webhook".to_string(),
                bot_token_ref: "telegram/missing-ref/bot_token".to_string(),
                webhook_secret_ref: None,
                webhook_path: None,
                updated_at_ms: 1,
            },
        ),
        (
            "blank-secret".to_string(),
            TelegramAccountRecord {
                account_id: "blank-secret".to_string(),
                enabled: true,
                mode: "webhook".to_string(),
                bot_token_ref: "telegram/blank-secret/bot_token".to_string(),
                webhook_secret_ref: Some("telegram/blank-secret/webhook_secret".to_string()),
                webhook_path: None,
                updated_at_ms: 1,
            },
        ),
    ]);

    let loader = |reference: &str| match reference {
        "telegram/blank-secret/webhook_secret" => Ok("   ".to_string()),
        other => Err(format!("unexpected secret ref {other}")),
    };
    assert_eq!(
        account_id_for_webhook_secret_in_store(&store, "target", loader)
            .expect("blank configured secret ignored"),
        None
    );

    store.telegram_accounts.insert(
        "broken".to_string(),
        TelegramAccountRecord {
            account_id: "broken".to_string(),
            enabled: true,
            mode: "webhook".to_string(),
            bot_token_ref: "telegram/broken/bot_token".to_string(),
            webhook_secret_ref: Some("telegram/broken/webhook_secret".to_string()),
            webhook_path: None,
            updated_at_ms: 1,
        },
    );

    let error = account_id_for_webhook_secret_in_store(&store, "target", |reference| {
        Err(format!("load failed for {reference}"))
    })
    .expect_err("secret load failure should be surfaced");
    assert!(error.contains("CHANNEL_CONNECTOR_SECRET_LOAD_FAILED"));
}

#[test]
fn webhook_urls_match_trims_runtime_and_configured_values() {
    assert!(webhook_urls_match(
        Some(" https://example.test/telegram/default "),
        " https://example.test/telegram/default "
    ));
    assert!(!webhook_urls_match(
        None,
        "https://example.test/telegram/default"
    ));
    assert!(!webhook_urls_match(
        Some("   "),
        "https://example.test/telegram/default"
    ));
    assert!(!webhook_urls_match(
        Some("https://example.test/telegram/other"),
        "https://example.test/telegram/default"
    ));
}
