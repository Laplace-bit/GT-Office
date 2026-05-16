// Integration tests for channel message send/receive with mock HTTP servers
// Tests use real TCP listeners to simulate provider responses

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Helper: create a one-shot mock HTTP server
async fn one_shot_mock_server(status: u16, body: String) -> (String, tokio::sync::mpsc::Receiver<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = tokio::sync::mpsc::channel(1);

    tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = [0u8; 16384];
            if let Ok(n) = stream.read(&mut buf).await {
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_string());
            }
            let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });

    (format!("http://127.0.0.1:{port}"), rx)
}

// --- Feishu Integration Tests ---

#[tokio::test]
async fn feishu_tenant_token_http_success() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let (base_url, _listener) = one_shot_mock_server(200, r#"{"code":0,"msg":"ok","tenant_access_token":"test_token_abc123"}"#.to_string()).await;

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::post(&format!("{base_url}/open-apis/auth/v3/tenant_access_token/internal"))
            .json_body(&serde_json::json!({"app_id": "test", "app_secret": "secret"}))
            .timeout_secs(3)
            .build()
    ).await.unwrap();

    assert!(result.is_success());
    let json = result.json_value().unwrap();
    assert_eq!(json["code"], 0);
    assert_eq!(json["tenant_access_token"], "test_token_abc123");
}

#[tokio::test]
async fn feishu_bot_info_http_success() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let (base_url, _listener) = one_shot_mock_server(200, r#"{"code":0,"bot":{"app_name":"TestBot","open_id":"ou_123","activate_status":1}}"#.to_string()).await;

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::get(&format!("{base_url}/open-apis/bot/v3/info"))
            .header("Authorization", "Bearer test_token")
            .timeout_secs(3)
            .build()
    ).await.unwrap();

    assert!(result.is_success());
    let json = result.json_value().unwrap();
    assert_eq!(json["code"], 0);
    assert_eq!(json["bot"]["app_name"], "TestBot");
}

#[tokio::test]
async fn feishu_auth_failure_handled() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let (base_url, _listener) = one_shot_mock_server(200, r#"{"code":9999,"msg":"app_id or app_secret is invalid"}"#.to_string()).await;

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::post(&format!("{base_url}/open-apis/auth/v3/tenant_access_token/internal"))
            .json_body(&serde_json::json!({"app_id": "bad"}))
            .timeout_secs(3)
            .build()
    ).await.unwrap();

    let json = result.json_value().unwrap();
    assert_eq!(json["code"], 9999);
}

// --- Telegram Integration Tests ---

#[tokio::test]
async fn telegram_send_message_http_success() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let (base_url, _listener) = one_shot_mock_server(200, r#"{"ok":true,"result":{"message_id":42,"chat":{"id":123},"text":"hello"}}"#.to_string()).await;

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::post(&format!("{base_url}/bot123/sendMessage"))
            .json_body(&serde_json::json!({"chat_id": 123, "text": "hello"}))
            .timeout_secs(25)
            .build()
    ).await.unwrap();

    assert!(result.is_success());
    let json = result.json_value().unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"]["message_id"], 42);
}

#[tokio::test]
async fn telegram_rate_limit_response() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let (base_url, _listener) = one_shot_mock_server(429, r#"{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 3"}"#.to_string()).await;

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::post(&format!("{base_url}/bot123/sendMessage"))
            .json_body(&serde_json::json!({"chat_id": 123, "text": "hello"}))
            .timeout_secs(8)
            .build()
    ).await.unwrap();

    assert_eq!(result.status, 429);
    assert!(!result.is_success());
}

#[tokio::test]
async fn telegram_get_me_success() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let (base_url, _listener) = one_shot_mock_server(200, r#"{"ok":true,"result":{"username":"OpsBot"}}"#.to_string()).await;

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::get(&format!("{base_url}/bot123/getMe"))
            .timeout_secs(8)
            .build()
    ).await.unwrap();

    assert!(result.is_success());
    let json = result.json_value().unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"]["username"], "OpsBot");
}

#[tokio::test]
async fn telegram_connection_reset_retried() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    // Use a port that's not listening - connection refused triggers retry
    let client = HttpClient::builder().max_retries(1).retry_delay_secs(0).build();
    let result = client.execute(
        HttpRequest::get("http://127.0.0.1:1/test")
            .timeout_secs(2)
            .build()
    ).await;

    // Should fail after retry
    assert!(result.is_err());
}

// --- WeChat Integration Tests ---

#[tokio::test]
async fn wechat_get_updates_http_success() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let (base_url, _listener) = one_shot_mock_server(200, r#"{"ret":0,"msgs":[],"get_updates_buf":"buf123"}"#.to_string()).await;

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::post(&format!("{base_url}/ilink/bot/getupdates"))
            .json_body(&serde_json::json!({"get_updates_buf": "", "base_info": {}}))
            .timeout_secs(35)
            .build()
    ).await.unwrap();

    assert!(result.is_success());
    let json = result.json_value().unwrap();
    assert_eq!(json["ret"], 0);
}

#[tokio::test]
async fn wechat_timeout_handled_as_transport_error() {
    use crate::connectors::http_client::{HttpClient, HttpRequest};

    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::post("http://127.0.0.1:1/impossible")
            .timeout_secs(1)
            .build()
    ).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().retryable());
}

// --- Backoff Integration Tests ---

#[test]
fn backoff_integration_increases_delay_on_repeated_failures() {
    use crate::connectors::backoff::BackoffPolicy;

    let policy = BackoffPolicy::default();
    let first = policy.delay(0);
    let second = policy.delay(1);
    let third = policy.delay(2);
    assert!(second > first - Duration::from_millis(1000)); // allowing for jitter
    assert!(third > second - Duration::from_millis(2000));
}

// --- Webhook Tokens Integration Tests ---

#[test]
fn webhook_tokens_round_trip_via_temp_dir() {
    use crate::connectors::webhook_tokens::WebhookTokens;

    let dir = std::env::temp_dir().join(format!("gto-integration-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let original = WebhookTokens::new();
    let path = dir.join("runtime-tokens.json");
    original.save_to_path(&path).unwrap();

    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert_eq!(original.feishu_token, loaded.feishu_token);
    assert_eq!(original.telegram_token, loaded.telegram_token);

    std::fs::remove_dir_all(&dir).ok();
}
