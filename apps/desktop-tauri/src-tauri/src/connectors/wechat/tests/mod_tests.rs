use super::{
    cache_context_token, default_token_ref, desired_wechat_accounts, extract_text, health_check,
    is_connected, list_accounts, list_accounts_with_uninitialized_policy, load_context_token,
    load_required_context_token, load_store, load_sync_buf, mark_access_policy_initialized,
    mark_connected, normalize_account_id, parse_inbound_message, runtime_error_from_update,
    save_store, save_sync_buf, send_text_reply, sync_buf_file_key, sync_buf_path,
    update_error_code, update_error_detail, upsert_account, upsert_record, validate_send_input,
    ConnectorStoreFile, CONNECTOR_STORE_VERSION, DEFAULT_BASE_URL, SESSION_EXPIRED_ERRCODE,
};
use crate::connectors::wechat::api::{MessageItem, TextItem, WeixinMessage};
use crate::connectors::wechat::types::{WechatAccountUpsertInput, WechatConnectorAccountRecord};
use gt_task::ExternalPeerKind;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};

fn wechat_store_test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[test]
fn normalize_account_id_defaults_and_trims() {
    assert_eq!(normalize_account_id(None), "default");
    assert_eq!(normalize_account_id(Some("  ")), "default");
    assert_eq!(normalize_account_id(Some(" work-wechat ")), "work-wechat");
}

#[test]
fn default_token_ref_uses_lowercase_account_key() {
    assert_eq!(default_token_ref(" OpsBot "), "wechat/opsbot/token");
}

#[test]
fn sync_buf_file_key_replaces_unsafe_path_characters() {
    assert_eq!(sync_buf_file_key("  "), "default");
    assert_eq!(sync_buf_file_key("ops"), "ops");
    assert_eq!(sync_buf_file_key("ops/bot:prod"), "ops_bot_prod");
}

#[test]
fn send_input_validation_trims_and_rejects_blank_values() {
    assert_eq!(
        validate_send_input(" user-1 ", " hello ").expect("valid input"),
        ("user-1", "hello")
    );
    assert_eq!(
        validate_send_input("   ", "hello").expect_err("blank peer"),
        "CHANNEL_CONNECTOR_SEND_INVALID: peer id is required"
    );
    assert_eq!(
        validate_send_input("user-1", "   ").expect_err("blank text"),
        "CHANNEL_CONNECTOR_SEND_INVALID: text is required"
    );
}

#[test]
fn connector_store_default_preserves_schema_version() {
    let store = ConnectorStoreFile::default();
    let payload = serde_json::to_value(&store).expect("serialize store");

    assert_eq!(store.version, CONNECTOR_STORE_VERSION);
    assert_eq!(
        payload,
        serde_json::json!({
            "version": "1",
            "wechatAccounts": {}
        })
    );
}

#[test]
fn connector_store_and_sync_buf_round_trip_with_safe_paths() {
    let _guard = wechat_store_test_lock()
        .lock()
        .expect("wechat store test lock");
    let app = tauri::test::mock_app();
    let account_id = format!("ops/bot:{}", uuid::Uuid::new_v4().simple());
    let mut store = ConnectorStoreFile::default();
    store.wechat_accounts.insert(
        account_id.clone(),
        WechatConnectorAccountRecord {
            account_id: account_id.clone(),
            enabled: true,
            token_ref: "wechat/ops/token".to_string(),
            base_url: DEFAULT_BASE_URL.to_string(),
            updated_at_ms: 1,
            access_policy_initialized_at_ms: None,
            last_bound_at_ms: Some(2),
            last_sync_at_ms: Some(3),
            last_error: Some("last error".to_string()),
            last_error_at_ms: Some(4),
        },
    );

    save_store(app.handle(), &store).expect("store writes");
    let restored = load_store(app.handle()).expect("store reads");
    assert_eq!(
        restored.wechat_accounts[account_id.as_str()].base_url,
        DEFAULT_BASE_URL
    );

    assert_eq!(
        load_sync_buf(app.handle(), &account_id).expect("missing sync buf defaults empty"),
        ""
    );
    save_sync_buf(app.handle(), &account_id, "cursor-1").expect("sync buf writes");
    assert_eq!(
        load_sync_buf(app.handle(), &account_id).as_deref(),
        Ok("cursor-1")
    );
    let path = sync_buf_path(app.handle(), &account_id).expect("sync buf path");
    assert!(path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.starts_with("wechat-sync-ops_bot_")));
}

#[test]
fn upsert_and_list_accounts_preserve_existing_configuration_defaults() {
    let _guard = wechat_store_test_lock()
        .lock()
        .expect("wechat store test lock");
    let app = tauri::test::mock_app();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let ops_id = format!("Ops-{suffix}");
    let alpha_id = format!("Alpha-{suffix}");
    let token_ref = format!("wechat/test-{suffix}/token");

    let created = upsert_account(
        app.handle(),
        WechatAccountUpsertInput {
            account_id: Some(format!(" {ops_id} ")),
            enabled: Some(true),
            token: Some(" token-1 ".to_string()),
            token_ref: Some(format!(" {token_ref} ")),
            base_url: Some(" https://wechat.example ".to_string()),
        },
    )
    .expect("create account");
    assert_eq!(created.account_id, ops_id);
    assert!(created.enabled);
    assert_eq!(created.token_ref, token_ref);
    assert!(created.has_token);
    assert_eq!(created.base_url, "https://wechat.example");
    assert_eq!(created.last_bound_at_ms, created.updated_at_ms.into());

    let updated = upsert_account(
        app.handle(),
        WechatAccountUpsertInput {
            account_id: Some(ops_id.clone()),
            enabled: Some(false),
            token: None,
            token_ref: None,
            base_url: Some("   ".to_string()),
        },
    )
    .expect("update account");
    assert!(!updated.enabled);
    assert_eq!(updated.token_ref, token_ref);
    assert_eq!(updated.base_url, "https://wechat.example");
    assert_eq!(updated.last_bound_at_ms, created.last_bound_at_ms);

    upsert_account(
        app.handle(),
        WechatAccountUpsertInput {
            account_id: Some(alpha_id.clone()),
            enabled: Some(true),
            token: Some("token-2".to_string()),
            token_ref: Some(format!("wechat/test-{suffix}/alpha-token")),
            base_url: None,
        },
    )
    .expect("create alpha account");

    let listed = list_accounts(app.handle()).expect("list accounts");
    let account_ids = listed
        .iter()
        .map(|account| account.account_id.as_str())
        .collect::<Vec<_>>();
    assert!(account_ids.windows(2).all(|pair| pair[0] <= pair[1]));
    let alpha = listed
        .iter()
        .find(|account| account.account_id == alpha_id)
        .expect("alpha listed");
    let ops = listed
        .iter()
        .find(|account| account.account_id == ops_id)
        .expect("ops listed");
    assert_eq!(alpha.base_url, DEFAULT_BASE_URL);
    assert_eq!(ops.base_url, "https://wechat.example");
}

#[test]
fn access_policy_initialization_lists_marks_and_ignores_missing_accounts() {
    let _guard = wechat_store_test_lock()
        .lock()
        .expect("wechat store test lock");
    let app = tauri::test::mock_app();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let ops_id = format!("policy-ops-{suffix}");
    let ready_id = format!("policy-ready-{suffix}");

    upsert_record(
        app.handle(),
        ops_id.clone(),
        WechatConnectorAccountRecord {
            access_policy_initialized_at_ms: None,
            ..test_record(&ops_id, true)
        },
    )
    .expect("store ops account");
    upsert_record(
        app.handle(),
        ready_id.clone(),
        WechatConnectorAccountRecord {
            access_policy_initialized_at_ms: Some(10),
            ..test_record(&ready_id, true)
        },
    )
    .expect("store ready account");

    let before =
        list_accounts_with_uninitialized_policy(app.handle()).expect("uninitialized policies");
    assert!(before.contains(&ops_id));
    assert!(!before.contains(&ready_id));

    mark_access_policy_initialized(app.handle(), &format!(" {ops_id} "))
        .expect("mark policy initialized");
    assert!(list_accounts_with_uninitialized_policy(app.handle())
        .expect("policies after mark")
        .iter()
        .all(|account_id| account_id != &ops_id));

    mark_access_policy_initialized(app.handle(), "missing").expect("missing mark is no-op");
}

#[test]
fn context_token_cache_is_scoped_by_account_and_user() {
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());
    cache_context_token(&account_id, "user-1", "ctx-1");
    cache_context_token(&account_id, "user-2", "ctx-2");
    cache_context_token(&account_id, " user-3 ", " ctx-3 ");

    assert_eq!(
        load_context_token(&account_id, "user-1").as_deref(),
        Some("ctx-1")
    );
    assert_eq!(
        load_context_token(&account_id, "user-2").as_deref(),
        Some("ctx-2")
    );
    assert_eq!(
        load_context_token(&account_id, " user-3 ").as_deref(),
        Some("ctx-3")
    );
    assert_eq!(load_context_token("different-account", "user-1"), None);
}

#[test]
fn context_token_cache_ignores_blank_user_or_token() {
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());

    cache_context_token(&account_id, "   ", "ctx-1");
    cache_context_token(&account_id, "user-1", "   ");

    assert_eq!(load_context_token(&account_id, "user-1"), None);
    assert_eq!(load_context_token(&account_id, "   "), None);
}

#[test]
fn extract_text_concatenates_only_text_items() {
    let msg = WeixinMessage {
        from_user_id: "user-1".to_string(),
        context_token: None,
        message_type: 1,
        item_list: vec![
            MessageItem {
                type_: 1,
                text_item: Some(TextItem {
                    text: Some("hello".to_string()),
                }),
            },
            MessageItem {
                type_: 2,
                text_item: Some(TextItem {
                    text: Some("ignored".to_string()),
                }),
            },
            MessageItem {
                type_: 1,
                text_item: Some(TextItem {
                    text: Some(" world".to_string()),
                }),
            },
        ],
        create_time_ms: Some(42),
    };

    assert_eq!(extract_text(&msg), "hello world");
}

#[test]
fn update_error_helpers_prefer_errcode_and_classify_expired_sessions() {
    assert_eq!(update_error_code(0, None), 0);
    assert_eq!(update_error_code(9, None), 9);
    assert_eq!(update_error_code(9, Some(7)), 7);

    assert_eq!(update_error_detail(0, None, None), None);
    assert_eq!(
        update_error_detail(9, None, None).as_deref(),
        Some("wechat getupdates error 9")
    );
    assert_eq!(
        update_error_detail(0, Some(7), Some("provider down".to_string())).as_deref(),
        Some("provider down")
    );
    assert_eq!(
        update_error_detail(0, Some(7), Some("   ".to_string())).as_deref(),
        Some("wechat getupdates error 7")
    );

    assert_eq!(
        runtime_error_from_update(0, Some(SESSION_EXPIRED_ERRCODE), None).as_deref(),
        Some("CHANNEL_CONNECTOR_AUTH_EXPIRED: wechat token expired")
    );
    assert_eq!(
        runtime_error_from_update(9, None, Some("try later".to_string())).as_deref(),
        Some("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: try later")
    );
    assert_eq!(runtime_error_from_update(0, None, None), None);
}

#[test]
fn parse_inbound_message_builds_direct_message_and_caches_context() {
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());
    let msg = WeixinMessage {
        from_user_id: " user-1 ".to_string(),
        context_token: Some(" ctx-1 ".to_string()),
        message_type: 1,
        item_list: vec![MessageItem {
            type_: 1,
            text_item: Some(TextItem {
                text: Some("hello".to_string()),
            }),
        }],
        create_time_ms: Some(123),
    };

    let inbound = parse_inbound_message(&account_id, &msg).expect("inbound");

    assert_eq!(inbound.channel, "wechat");
    assert_eq!(inbound.account_id, account_id);
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.peer_id, "user-1");
    assert_eq!(inbound.sender_id, "user-1");
    assert_eq!(inbound.message_id, "user-1-123");
    assert_eq!(inbound.text, "hello");
    assert_eq!(
        inbound.idempotency_key.as_deref(),
        Some(format!("wechat-{}-user-1-123", account_id).as_str())
    );
    assert_eq!(
        load_context_token(&account_id, "user-1").as_deref(),
        Some("ctx-1")
    );
}

#[test]
fn parse_inbound_message_skips_outbound_empty_or_senderless_messages() {
    let outbound = WeixinMessage {
        from_user_id: "user-1".to_string(),
        context_token: None,
        message_type: 2,
        item_list: vec![MessageItem {
            type_: 1,
            text_item: Some(TextItem {
                text: Some("self message".to_string()),
            }),
        }],
        create_time_ms: Some(1),
    };
    assert!(parse_inbound_message("acct", &outbound).is_none());

    let empty_text = WeixinMessage {
        from_user_id: "user-1".to_string(),
        context_token: None,
        message_type: 1,
        item_list: vec![MessageItem {
            type_: 1,
            text_item: Some(TextItem {
                text: Some("   ".to_string()),
            }),
        }],
        create_time_ms: Some(1),
    };
    assert!(parse_inbound_message("acct", &empty_text).is_none());

    let missing_sender = WeixinMessage {
        from_user_id: " ".to_string(),
        context_token: None,
        message_type: 1,
        item_list: vec![MessageItem {
            type_: 1,
            text_item: Some(TextItem {
                text: Some("hello".to_string()),
            }),
        }],
        create_time_ms: Some(1),
    };
    assert!(parse_inbound_message("acct", &missing_sender).is_none());
}

#[test]
fn runtime_connected_status_tracks_account_ids() {
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());
    assert!(!is_connected(&account_id));
    mark_connected(&account_id, true);
    assert!(is_connected(&account_id));
    mark_connected(&account_id, false);
    assert!(!is_connected(&account_id));
}

#[test]
fn default_base_url_is_ilink_endpoint() {
    assert_eq!(DEFAULT_BASE_URL, "https://ilinkai.weixin.qq.com");
}

#[test]
fn desired_wechat_accounts_filters_enabled_bound_records() {
    let records = vec![
        test_record("Default", true),
        test_record("disabled", false),
        test_record("unbound", true),
        test_record("ops", true),
        test_record("ops", true),
    ];
    let needed = HashSet::from([
        ("wechat".to_string(), "default".to_string()),
        ("wechat".to_string(), "disabled".to_string()),
        ("telegram".to_string(), "unbound".to_string()),
        ("wechat".to_string(), "ops".to_string()),
    ]);

    let desired = desired_wechat_accounts(records, &needed);

    assert_eq!(desired, vec!["Default".to_string(), "ops".to_string()]);
}

fn test_record(account_id: &str, enabled: bool) -> WechatConnectorAccountRecord {
    WechatConnectorAccountRecord {
        account_id: account_id.to_string(),
        enabled,
        token_ref: format!("wechat/{account_id}/token"),
        base_url: DEFAULT_BASE_URL.to_string(),
        updated_at_ms: 1,
        access_policy_initialized_at_ms: None,
        last_bound_at_ms: None,
        last_sync_at_ms: None,
        last_error: None,
        last_error_at_ms: None,
    }
}

#[test]
fn required_context_token_reports_missing_context_before_provider_send() {
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());
    let error = load_required_context_token(&account_id, "user-without-context")
        .expect_err("missing context should fail before provider call");

    assert_eq!(
        error,
        "CHANNEL_CONNECTOR_CONTEXT_MISSING: no reply context for this user"
    );

    cache_context_token(&account_id, "user-with-context", "ctx-1");
    assert_eq!(
        load_required_context_token(&account_id, "user-with-context").as_deref(),
        Ok("ctx-1")
    );
}

#[tokio::test]
async fn health_check_reports_missing_and_disabled_accounts_without_provider_calls() {
    let _guard = wechat_store_test_lock()
        .lock()
        .expect("wechat store test lock");
    let app = tauri::test::mock_app();

    let missing = health_check(app.handle(), Some("missing"))
        .await
        .expect_err("missing account");
    assert_eq!(
        missing,
        "CHANNEL_CONNECTOR_NOT_FOUND: wechat account missing"
    );

    upsert_record(
        app.handle(),
        "ops".to_string(),
        WechatConnectorAccountRecord {
            account_id: "ops".to_string(),
            enabled: false,
            token_ref: "wechat/ops/token".to_string(),
            base_url: DEFAULT_BASE_URL.to_string(),
            updated_at_ms: 1,
            access_policy_initialized_at_ms: None,
            last_bound_at_ms: Some(2),
            last_sync_at_ms: Some(3),
            last_error: None,
            last_error_at_ms: None,
        },
    )
    .expect("store disabled account");

    let snapshot = health_check(app.handle(), Some("ops"))
        .await
        .expect("disabled health");

    assert_eq!(snapshot.channel, "wechat");
    assert_eq!(snapshot.account_id, "ops");
    assert!(!snapshot.ok);
    assert_eq!(snapshot.status, "disabled");
    assert_eq!(snapshot.detail, "connector account is disabled");
    assert_eq!(snapshot.mode, "polling");
    assert_eq!(snapshot.last_sync_at_ms, Some(3));
}

#[tokio::test]
async fn send_text_reply_rejects_local_failures_before_provider_calls() {
    let _guard = wechat_store_test_lock()
        .lock()
        .expect("wechat store test lock");
    let app = tauri::test::mock_app();

    let missing = send_text_reply(app.handle(), Some("missing"), "user-1", "hello", None)
        .await
        .expect_err("missing account");
    assert_eq!(
        missing,
        "CHANNEL_CONNECTOR_NOT_FOUND: wechat account missing"
    );

    upsert_record(
        app.handle(),
        "disabled".to_string(),
        test_record("disabled", false),
    )
    .expect("store disabled account");
    let disabled = send_text_reply(app.handle(), Some("disabled"), "user-1", "hello", None)
        .await
        .expect_err("disabled account");
    assert_eq!(
        disabled,
        "CHANNEL_CONNECTOR_DISABLED: wechat account is disabled"
    );

    upsert_record(
        app.handle(),
        "enabled".to_string(),
        test_record("enabled", true),
    )
    .expect("store enabled account");
    let missing_context = send_text_reply(app.handle(), Some("enabled"), "user-1", "hello", None)
        .await
        .expect_err("missing context");
    assert_eq!(
        missing_context,
        "CHANNEL_CONNECTOR_CONTEXT_MISSING: no reply context for this user"
    );
}
