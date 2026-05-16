use super::backoff::BackoffPolicy;
use super::channel_error::ChannelError;
use super::http_client::{HttpClient, HttpRequest, HttpResponse};
use super::webhook_tokens::WebhookTokens;

#[test]
fn channel_error_from_io_error_maps_transport() {
    let io_err = std::io::Error::new(std::io::ErrorKind::TimedOut, "connection timed out");
    let channel_err: ChannelError = io_err.into();
    assert!(channel_err.retryable());
    assert!(channel_err.starts_with("CHANNEL_TRANSPORT"));
    assert!(channel_err.contains("connection timed out"));
}

#[test]
fn channel_error_from_io_error_connection_reset_is_retryable() {
    let io_err = std::io::Error::new(std::io::ErrorKind::ConnectionReset, "reset");
    let channel_err: ChannelError = io_err.into();
    assert!(channel_err.retryable());
}

#[test]
fn channel_error_from_io_error_not_connected_is_not_retryable() {
    let io_err = std::io::Error::new(std::io::ErrorKind::NotConnected, "not connected");
    let channel_err: ChannelError = io_err.into();
    assert!(!channel_err.retryable());
}

#[test]
fn channel_error_convenience_constructors_cover_all_variants() {
    let auth = ChannelError::auth_failed("bad token");
    assert!(!auth.retryable());
    assert!(auth.starts_with("CHANNEL_CONNECTOR_AUTH_FAILED:"));

    let secret = ChannelError::secret_load_failed("keychain error");
    assert!(!secret.retryable());
    assert!(secret.starts_with("CHANNEL_CONNECTOR_AUTH_SECRET_LOAD_FAILED:"));

    let provider = ChannelError::provider_unavailable("api down");
    assert!(provider.retryable());
    assert!(provider.starts_with("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE:"));

    let provider_code =
        ChannelError::provider_unavailable_with_code("api down", "E123".to_string(), Some(503));
    assert!(provider_code.retryable());
    assert!(provider_code.contains("provider_code=E123"));
    assert!(provider_code.contains("http_status=503"));

    let denied = ChannelError::provider_denied("no access", Some("P001".to_string()));
    assert!(!denied.retryable());
    assert!(denied.starts_with("CHANNEL_CONNECTOR_PERMISSION_DENIED:"));

    let validation = ChannelError::send_invalid("empty peer id");
    assert!(!validation.retryable());

    let store_read = ChannelError::store_read("file error");
    assert!(!store_read.retryable());

    let store_write = ChannelError::store_write("disk full");
    assert!(!store_write.retryable());

    let not_found = ChannelError::not_found("feishu", "default");
    assert!(!not_found.retryable());

    let disabled = ChannelError::disabled("telegram", "ops");
    assert!(!disabled.retryable());

    let invalid = ChannelError::invalid_response("bad json", Some(502));
    assert!(!invalid.retryable());
    assert!(invalid.contains("http_status=502"));
}

#[test]
fn channel_error_into_string_preserves_content() {
    let err = ChannelError::Transport {
        detail: "connection reset".to_string(),
        retryable: true,
    };
    let s: String = err.into();
    assert!(s.contains("CHANNEL_TRANSPORT"));
    assert!(s.contains("connection reset"));
}

#[test]
fn backoff_policy_integration_with_channel_error_retryable_check() {
    let policy = BackoffPolicy::default();

    let retryable_err = ChannelError::Transport {
        detail: "timeout".to_string(),
        retryable: true,
    };
    assert!(retryable_err.retryable());
    assert!(policy.should_retry(0));

    let non_retryable_err = ChannelError::Validation {
        detail: "bad input".to_string(),
    };
    assert!(!non_retryable_err.retryable());
}

#[test]
fn backoff_delays_stay_within_reasonable_bounds() {
    let policy = BackoffPolicy::default();
    let mut total_delay = std::time::Duration::ZERO;
    for attempt in 0..policy.max_attempts {
        total_delay += policy.delay_with_jitter(attempt);
    }
    // Total delay for all 10 attempts should be less than 30 minutes
    assert!(total_delay < std::time::Duration::from_secs(1800));
}

#[test]
fn http_client_builder_creates_functional_client() {
    let _client = HttpClient::new();
    let _custom = HttpClient::builder()
        .max_retries(3)
        .retry_delay_secs(2)
        .build();
}

#[test]
fn http_request_builder_constructs_valid_requests() {
    let req = HttpRequest::post("https://api.example.com/v1/messages")
        .header("Authorization", "Bearer test-token")
        .json_body(&serde_json::json!({"text": "hello"}))
        .timeout_secs(30)
        .build();

    assert_eq!(req.method, "POST");
    assert_eq!(req.url, "https://api.example.com/v1/messages");
    assert!(req
        .headers
        .iter()
        .any(|(k, v)| k == "Authorization" && v == "Bearer test-token"));
    assert!(req.content_type.as_deref() == Some("application/json"));
    assert_eq!(req.timeout_secs, 30);
    assert!(req.body.is_some());
}

#[test]
fn http_response_helpers_work_correctly() {
    let response = HttpResponse {
        status: 200,
        body: br#"{"ok":true,"result":42}"#.to_vec(),
    };
    assert!(response.is_success());
    assert_eq!(response.status, 200);
    let json = response.json_value().unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"], 42);

    let error_response = HttpResponse {
        status: 400,
        body: br#"{"error":"bad request"}"#.to_vec(),
    };
    assert!(!error_response.is_success());
    assert_eq!(error_response.status, 400);
    assert_eq!(error_response.text(), r#"{"error":"bad request"}"#);
}

#[test]
fn webhook_tokens_round_trip_preserves_values() {
    let dir = std::env::temp_dir().join(format!("gto-integration-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let original = WebhookTokens::new();
    let path = dir.join("tokens.json");
    original.save_to_path(&path).unwrap();

    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert_eq!(original.feishu_token, loaded.feishu_token);
    assert_eq!(original.telegram_token, loaded.telegram_token);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn webhook_tokens_recover_from_corrupt_file() {
    let dir = std::env::temp_dir().join(format!("gto-integration-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let path = dir.join("corrupt.json");
    std::fs::write(&path, "not valid json {{{").unwrap();

    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert!(!loaded.feishu_token.is_empty());
    assert!(!loaded.telegram_token.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}
