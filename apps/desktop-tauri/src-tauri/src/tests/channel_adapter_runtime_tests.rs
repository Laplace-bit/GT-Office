use super::{
    apply_rate_limit, clear_runtime_snapshot, derive_telegram_sender_name, find_header_end,
    first_non_empty, is_json_content_type, json_to_string, mark_runtime_error,
    parse_telegram_payload, read_http_request, reject_invalid_token, runtime_file_path,
    runtime_snapshot, set_runtime_snapshot, status_for_http_read_error, user_home_dir,
    with_runtime_metrics_mut, write_http_json, write_runtime_file,
    ChannelAdapterRuntimeMetricsSnapshot, ChannelAdapterRuntimeSnapshot, MAX_BODY_BYTES,
    MAX_HEADER_BYTES, REQUEST_RATE_LIMIT_MAX_REQUESTS,
};
use gt_task::ExternalPeerKind;
use std::{env, fs};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

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
    let inbound = parse_telegram_payload(&payload, "default").expect("telegram payload parsed");
    assert_eq!(inbound.channel, "telegram");
    assert_eq!(inbound.account_id, "default");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "-100123");
    assert_eq!(inbound.sender_id, "3344");
    assert_eq!(inbound.text, "hello from telegram");
}

fn sample_runtime_snapshot() -> ChannelAdapterRuntimeSnapshot {
    ChannelAdapterRuntimeSnapshot {
        running: true,
        host: "127.0.0.1".to_string(),
        port: 37777,
        base_url: "http://127.0.0.1:37777".to_string(),
        feishu_webhook: "http://127.0.0.1:37777/webhook/feishu/token-a".to_string(),
        telegram_webhook: "http://127.0.0.1:37777/webhook/telegram/token-b".to_string(),
        started_at_ms: 123,
        metrics: ChannelAdapterRuntimeMetricsSnapshot::default(),
    }
}

#[test]
fn parse_telegram_payload_uses_runtime_resolved_account_id() {
    let payload = serde_json::json!({
        "update_id": 10013,
        "message": {
            "message_id": 94,
            "text": "hello account",
            "chat": { "id": 123, "type": "private" },
            "from": { "id": 456, "first_name": "Account" }
        }
    });

    let inbound = parse_telegram_payload(&payload, "ops-bot").expect("telegram payload parsed");
    assert_eq!(inbound.account_id, "ops-bot");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
}

#[test]
fn parse_telegram_payload_defaults_blank_account_and_reports_missing_chat_id() {
    let blank_account_payload = serde_json::json!({
        "update_id": 10014,
        "message": {
            "message_id": 95,
            "text": "hello default account",
            "chat": { "id": 123, "type": "private" }
        }
    });
    let inbound =
        parse_telegram_payload(&blank_account_payload, "   ").expect("blank account defaults");
    assert_eq!(inbound.account_id, "default");

    let missing_chat_id = serde_json::json!({
        "update_id": 10015,
        "message": {
            "message_id": 96,
            "text": "hello",
            "chat": { "type": "private" }
        }
    });
    assert_eq!(
        parse_telegram_payload(&missing_chat_id, "default").expect_err("missing chat id"),
        "missing chat.id"
    );

    let callback_missing_chat_id = serde_json::json!({
        "update_id": 10016,
        "callback_query": {
            "id": "cbq-missing-chat-id",
            "from": { "id": 1 },
            "message": {
                "message_id": 1,
                "chat": { "type": "private" }
            }
        }
    });
    assert_eq!(
        parse_telegram_payload(&callback_missing_chat_id, "default")
            .expect_err("missing callback chat id"),
        "missing chat.id"
    );
}

#[test]
fn runtime_snapshot_and_metrics_mutation_are_observable() {
    clear_runtime_snapshot();
    assert!(runtime_snapshot().is_none());

    set_runtime_snapshot(sample_runtime_snapshot());
    with_runtime_metrics_mut(|metrics| {
        metrics.total_requests = 2;
        metrics.webhook_requests = 1;
        mark_runtime_error(metrics, "CHANNEL_TEST_ERROR".to_string());
    });

    let snapshot = runtime_snapshot().expect("runtime snapshot");
    assert!(snapshot.running);
    assert_eq!(snapshot.port, 37777);
    assert_eq!(snapshot.metrics.total_requests, 2);
    assert_eq!(snapshot.metrics.webhook_requests, 1);
    assert_eq!(
        snapshot.metrics.last_error.as_deref(),
        Some("CHANNEL_TEST_ERROR")
    );
    assert!(snapshot.metrics.last_error_at_ms.is_some());

    clear_runtime_snapshot();
    assert!(runtime_snapshot().is_none());
}

#[test]
fn runtime_file_path_uses_explicit_env_override_and_write_runtime_file_persists_snapshot() {
    let previous = env::var("GTO_CHANNEL_RUNTIME_FILE").ok();
    let path = env::temp_dir().join(format!(
        "gtoffice-channel-runtime-{}.json",
        uuid::Uuid::new_v4()
    ));
    env::set_var("GTO_CHANNEL_RUNTIME_FILE", &path);

    assert_eq!(runtime_file_path(), path);

    let snapshot = sample_runtime_snapshot();
    write_runtime_file(&snapshot).expect("write runtime file");

    let payload = fs::read_to_string(&path).expect("read runtime file");
    let decoded: serde_json::Value = serde_json::from_str(&payload).expect("runtime json");
    assert_eq!(decoded["version"], "0.1.0");
    assert_eq!(decoded["host"], "127.0.0.1");
    assert_eq!(decoded["port"], 37777);
    assert_eq!(decoded["feishuWebhook"], snapshot.feishu_webhook);
    assert_eq!(decoded["telegramWebhook"], snapshot.telegram_webhook);

    let _ = fs::remove_file(&path);
    if let Some(previous) = previous {
        env::set_var("GTO_CHANNEL_RUNTIME_FILE", previous);
    } else {
        env::remove_var("GTO_CHANNEL_RUNTIME_FILE");
    }
}

#[test]
fn user_home_dir_prefers_home_then_userprofile_and_runtime_path_uses_home_default() {
    let previous_runtime_file = env::var("GTO_CHANNEL_RUNTIME_FILE").ok();
    let previous_home = env::var("HOME").ok();
    let previous_userprofile = env::var("USERPROFILE").ok();

    env::remove_var("GTO_CHANNEL_RUNTIME_FILE");
    env::set_var("HOME", "/tmp/gto-home-a");
    env::set_var("USERPROFILE", "/tmp/gto-profile-b");
    assert_eq!(
        user_home_dir(),
        Some(std::path::PathBuf::from("/tmp/gto-home-a"))
    );
    assert_eq!(
        runtime_file_path(),
        std::path::PathBuf::from("/tmp/gto-home-a/.gtoffice/channel/runtime.json")
    );

    env::set_var("HOME", "   ");
    assert_eq!(
        user_home_dir(),
        Some(std::path::PathBuf::from("/tmp/gto-profile-b"))
    );

    if let Some(value) = previous_runtime_file {
        env::set_var("GTO_CHANNEL_RUNTIME_FILE", value);
    } else {
        env::remove_var("GTO_CHANNEL_RUNTIME_FILE");
    }
    if let Some(value) = previous_home {
        env::set_var("HOME", value);
    } else {
        env::remove_var("HOME");
    }
    if let Some(value) = previous_userprofile {
        env::set_var("USERPROFILE", value);
    } else {
        env::remove_var("USERPROFILE");
    }
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
    let inbound = parse_telegram_payload(&payload, "default").expect("telegram callback parsed");
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
    let inbound =
        parse_telegram_payload(&payload, "default").expect("telegram key callback parsed");
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

#[test]
fn parse_telegram_channel_post_uses_caption_and_chat_as_sender() {
    let payload = serde_json::json!({
        "update_id": 10004,
        "channel_post": {
            "message_id": 91,
            "caption": "caption text",
            "chat": {
                "id": -100987,
                "type": "channel",
                "title": "Ops Channel"
            }
        }
    });

    let inbound =
        parse_telegram_payload(&payload, "default").expect("telegram channel post parsed");
    assert_eq!(inbound.channel, "telegram");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Group);
    assert_eq!(inbound.peer_id, "-100987");
    assert_eq!(inbound.sender_id, "-100987");
    assert_eq!(inbound.message_id, "91");
    assert_eq!(inbound.text, "caption text");
}

#[test]
fn parse_telegram_payload_reports_missing_chat() {
    let payload = serde_json::json!({
        "update_id": 10005,
        "message": {
            "message_id": 92,
            "text": "hello"
        }
    });

    let error = parse_telegram_payload(&payload, "default").expect_err("missing chat should fail");
    assert!(error.contains("missing message.chat"));
}

#[test]
fn parse_telegram_callback_query_reports_missing_required_fields() {
    let missing_message = serde_json::json!({
        "update_id": 10010,
        "callback_query": {
            "id": "cbq_1",
            "from": { "id": 1 }
        }
    });
    assert_eq!(
        parse_telegram_payload(&missing_message, "default").expect_err("missing callback message"),
        "missing callback_query.message"
    );

    let missing_chat = serde_json::json!({
        "update_id": 10011,
        "callback_query": {
            "id": "cbq_2",
            "from": { "id": 1 },
            "message": { "message_id": 1 }
        }
    });
    assert_eq!(
        parse_telegram_payload(&missing_chat, "default").expect_err("missing callback chat"),
        "missing callback_query.message.chat"
    );

    let missing_from = serde_json::json!({
        "update_id": 10012,
        "callback_query": {
            "id": "cbq_3",
            "message": {
                "message_id": 1,
                "chat": { "id": 123, "type": "private" }
            }
        }
    });
    assert_eq!(
        parse_telegram_payload(&missing_from, "default").expect_err("missing callback sender"),
        "missing callback_query.from"
    );
}

#[test]
fn parse_telegram_edited_message_falls_back_to_update_id_for_message_id() {
    let payload = serde_json::json!({
        "update_id": 10006,
        "edited_message": {
            "text": "edited body",
            "chat": { "id": 12345, "type": "private" },
            "from": { "id": 777, "first_name": " Ada ", "last_name": " Lovelace " }
        }
    });

    let inbound = parse_telegram_payload(&payload, "default").expect("edited message parsed");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.peer_id, "12345");
    assert_eq!(inbound.sender_id, "777");
    assert_eq!(inbound.sender_name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(inbound.message_id, "update-10006");
    assert_eq!(inbound.text, "edited body");
}

#[test]
fn parse_telegram_non_text_message_uses_placeholder() {
    let payload = serde_json::json!({
        "update_id": 10007,
        "message": {
            "message_id": 93,
            "photo": [{ "file_id": "abc" }],
            "chat": { "id": 12345, "type": "private" }
        }
    });

    let inbound = parse_telegram_payload(&payload, "default").expect("non-text message parsed");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.sender_id, "12345");
    assert_eq!(inbound.text, "[telegram non-text message]");
}

#[test]
fn parse_telegram_callback_query_uses_fallback_id_and_data_placeholder() {
    let payload = serde_json::json!({
        "update_id": 10008,
        "callback_query": {
            "from": { "id": 5566, "first_name": "Grace" },
            "message": {
                "chat": { "id": "private-chat", "type": "private" }
            }
        }
    });

    let inbound = parse_telegram_payload(&payload, "default").expect("callback fallback parsed");
    assert_eq!(inbound.peer_kind, ExternalPeerKind::Direct);
    assert_eq!(inbound.peer_id, "private-chat");
    assert_eq!(inbound.sender_name.as_deref(), Some("Grace"));
    assert_eq!(inbound.message_id, "callback-callback-update-10008");
    assert_eq!(inbound.text, "[telegram callback without data]");
    assert_eq!(
        inbound.idempotency_key.as_deref(),
        Some("telegram-callback-callback-update-10008")
    );
}

#[test]
fn parse_telegram_payload_reports_missing_root_message() {
    let payload = serde_json::json!({ "update_id": 10009 });

    let error =
        parse_telegram_payload(&payload, "default").expect_err("missing root message should fail");
    assert!(error.contains("missing message/edited_message/channel_post/callback_query"));
}

#[test]
fn telegram_sender_name_prefers_username_then_full_name() {
    let username = serde_json::json!({
        "username": " ada ",
        "first_name": "Ignored"
    });
    assert_eq!(
        derive_telegram_sender_name(&username).as_deref(),
        Some("ada")
    );

    let full_name = serde_json::json!({
        "first_name": " Alan ",
        "last_name": " Turing "
    });
    assert_eq!(
        derive_telegram_sender_name(&full_name).as_deref(),
        Some("Alan Turing")
    );

    let empty = serde_json::json!({
        "first_name": " ",
        "last_name": ""
    });
    assert_eq!(derive_telegram_sender_name(&empty), None);
}

#[test]
fn json_to_string_and_first_non_empty_normalize_supported_values() {
    assert_eq!(
        json_to_string(Some(&serde_json::json!("  value "))).as_deref(),
        Some("value")
    );
    assert_eq!(json_to_string(Some(&serde_json::json!("   "))), None);
    assert_eq!(
        json_to_string(Some(&serde_json::json!(-42))).as_deref(),
        Some("-42")
    );
    assert_eq!(
        json_to_string(Some(&serde_json::json!(42))).as_deref(),
        Some("42")
    );
    assert_eq!(json_to_string(Some(&serde_json::json!(true))), None);
    assert_eq!(
        first_non_empty([None, Some(" "), Some(" second "), Some("third")]).as_deref(),
        Some("second")
    );
    assert_eq!(first_non_empty([None, Some(" "), Some("")]), None);
}

#[test]
fn json_content_type_accepts_absent_json_and_vendor_json() {
    assert!(is_json_content_type(None));
    assert!(is_json_content_type(Some("application/json")));
    assert!(is_json_content_type(Some(
        "Application/JSON; charset=utf-8"
    )));
    assert!(is_json_content_type(Some("application/vnd.feishu+json")));
    assert!(!is_json_content_type(Some("text/plain")));
}

#[test]
fn http_read_error_status_codes_map_to_client_failures() {
    assert_eq!(
        status_for_http_read_error("CHANNEL_HTTP_HEADER_TOO_LARGE"),
        413
    );
    assert_eq!(
        status_for_http_read_error("CHANNEL_HTTP_BODY_TOO_LARGE"),
        413
    );
    assert_eq!(status_for_http_read_error("CHANNEL_HTTP_EOF"), 400);
    assert_eq!(
        status_for_http_read_error("CHANNEL_HTTP_HEADER_UTF8_INVALID"),
        400
    );
    assert_eq!(
        status_for_http_read_error("CHANNEL_HTTP_CONTENT_LENGTH_INVALID"),
        400
    );
    assert_eq!(
        status_for_http_read_error("CHANNEL_HTTP_REQUEST_TIMEOUT"),
        408
    );
}

#[test]
fn find_header_end_detects_crlf_boundary() {
    assert_eq!(
        find_header_end(b"GET / HTTP/1.1\r\nHost: test\r\n\r\nbody"),
        Some(30)
    );
    assert_eq!(find_header_end(b"GET / HTTP/1.1\n\n"), None);
}

#[test]
fn rate_limit_trips_after_window_budget_for_account_key() {
    let account_key = format!("test-account-{}", uuid::Uuid::new_v4());
    for _ in 0..REQUEST_RATE_LIMIT_MAX_REQUESTS {
        assert!(!apply_rate_limit(&account_key));
    }
    assert!(apply_rate_limit(&account_key));
}

#[test]
fn invalid_token_rejection_does_not_require_request_body_parsing() {
    assert!(reject_invalid_token("expected-token", "expected-token").is_none());

    let (status, payload) =
        reject_invalid_token("expected-token", "wrong-token").expect("token should be rejected");

    assert_eq!(status, 401);
    assert_eq!(payload["ok"], false);
    assert_eq!(payload["error"], "CHANNEL_TOKEN_INVALID");
}

#[tokio::test]
async fn read_http_request_parses_headers_query_and_body() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(
                b"POST /webhook/telegram/token?debug=true HTTP/1.1\r\nHost: local\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 15\r\n\r\n{\"ok\":true}extra",
            )
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let request = read_http_request(&mut stream)
        .await
        .expect("parse http request");
    client.await.expect("client task");

    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/webhook/telegram/token?debug=true");
    assert_eq!(
        request.headers.get("content-type").map(String::as_str),
        Some("application/json; charset=utf-8")
    );
    assert_eq!(request.body, br#"{"ok":true}extr"#);
}

#[tokio::test]
async fn read_http_request_parses_get_without_body() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: local\r\n\r\n")
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let request = read_http_request(&mut stream)
        .await
        .expect("parse http request");
    client.await.expect("client task");

    assert_eq!(request.method, "GET");
    assert_eq!(request.path, "/health");
    assert_eq!(
        request.headers.get("host").map(String::as_str),
        Some("local")
    );
    assert!(request.body.is_empty());
}

#[tokio::test]
async fn read_http_request_ignores_malformed_header_lines() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: local\r\nBrokenHeader\r\n\r\n")
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let request = read_http_request(&mut stream)
        .await
        .expect("parse http request");
    client.await.expect("client task");

    assert_eq!(request.path, "/health");
    assert_eq!(
        request.headers.get("host").map(String::as_str),
        Some("local")
    );
    assert!(!request.headers.contains_key("brokenheader"));
}

#[tokio::test]
async fn read_http_request_rejects_invalid_header_utf8() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(b"GET /\xff HTTP/1.1\r\nHost: local\r\n\r\n")
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let error = read_http_request(&mut stream)
        .await
        .expect_err("invalid utf8 header should fail");
    client.await.expect("client task");

    assert!(error.starts_with("CHANNEL_HTTP_HEADER_UTF8_INVALID"));
}

#[tokio::test]
async fn read_http_request_rejects_oversized_headers() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        let oversized_header = format!(
            "GET /health HTTP/1.1\r\nX-Large: {}\r\n",
            "x".repeat(MAX_HEADER_BYTES + 1)
        );
        stream
            .write_all(oversized_header.as_bytes())
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let error = read_http_request(&mut stream)
        .await
        .expect_err("oversized header should fail");
    client.await.expect("client task");

    assert_eq!(error, "CHANNEL_HTTP_HEADER_TOO_LARGE");
}

#[tokio::test]
async fn read_http_request_rejects_missing_path() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(b"GET\r\nHost: local\r\n\r\n")
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let error = read_http_request(&mut stream)
        .await
        .expect_err("missing path should fail");
    client.await.expect("client task");

    assert_eq!(error, "CHANNEL_HTTP_PATH_MISSING");
}

#[tokio::test]
async fn read_http_request_rejects_invalid_content_length() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(
                b"POST /webhook/telegram/token HTTP/1.1\r\nHost: local\r\nContent-Length: nope\r\n\r\n{\"ok\":true}",
            )
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let error = read_http_request(&mut stream)
        .await
        .expect_err("invalid content-length should fail");
    client.await.expect("client task");

    assert_eq!(error, "CHANNEL_HTTP_CONTENT_LENGTH_INVALID");
}

#[tokio::test]
async fn read_http_request_rejects_body_eof() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(
                b"POST /webhook/telegram/token HTTP/1.1\r\nHost: local\r\nContent-Length: 20\r\n\r\n{\"partial\":true}",
            )
            .await
            .expect("write partial request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let error = read_http_request(&mut stream)
        .await
        .expect_err("short body should fail");
    client.await.expect("client task");

    assert_eq!(error, "CHANNEL_HTTP_BODY_EOF");
}

#[tokio::test]
async fn read_http_request_rejects_oversized_body_before_reading_payload() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        stream
            .write_all(
                b"POST /webhook/feishu/token HTTP/1.1\r\nHost: local\r\nContent-Length: 2097153\r\n\r\n",
            )
            .await
            .expect("write request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let error = read_http_request(&mut stream)
        .await
        .expect_err("oversized body should fail");
    client.await.expect("client task");

    assert_eq!(error, "CHANNEL_HTTP_BODY_TOO_LARGE");
}

#[tokio::test]
async fn read_http_request_rejects_oversized_body_while_reading_payload() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        let request = format!(
            "POST /webhook/feishu/token HTTP/1.1\r\nHost: local\r\nContent-Length: {}\r\n\r\n{}",
            MAX_BODY_BYTES,
            "x".repeat(MAX_BODY_BYTES + 1)
        );
        stream
            .write_all(request.as_bytes())
            .await
            .expect("write oversized body request");
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    let error = read_http_request(&mut stream)
        .await
        .expect_err("oversized body read should fail");
    client.await.expect("client task");

    assert_eq!(error, "CHANNEL_HTTP_BODY_TOO_LARGE");
}

#[tokio::test]
async fn write_http_json_emits_status_headers_and_body() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");

    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.expect("connect client");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("read response");
        response
    });

    let (mut stream, _) = listener.accept().await.expect("accept client");
    write_http_json(
        &mut stream,
        415,
        &serde_json::json!({
            "ok": false,
            "error": "CHANNEL_CONTENT_TYPE_INVALID"
        }),
    )
    .await
    .expect("write response");
    drop(stream);

    let response = String::from_utf8(client.await.expect("client task")).expect("utf8 response");
    assert!(response.starts_with("HTTP/1.1 415 Unsupported Media Type\r\n"));
    assert!(response.contains("Content-Type: application/json\r\n"));
    assert!(response.contains(r#""error":"CHANNEL_CONTENT_TYPE_INVALID""#));
}
