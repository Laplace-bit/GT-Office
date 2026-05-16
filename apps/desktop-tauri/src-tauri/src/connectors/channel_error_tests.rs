use crate::connectors::channel_error::ChannelError;

#[test]
fn test_auth_display_format() {
    let err = ChannelError::auth_failed("Invalid token");
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_CONNECTOR_AUTH_FAILED"));
    assert!(msg.contains("Invalid token"));
}

#[test]
fn test_provider_unavailable_display() {
    let err = ChannelError::provider_unavailable("API failure");
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE"));
    assert!(msg.contains("API failure"));
}

#[test]
fn test_provider_unavailable_with_code_display() {
    let err = ChannelError::provider_unavailable_with_code("API failure", "E123".to_string(), Some(500));
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE"));
    assert!(msg.contains("API failure"));
    assert!(msg.contains("provider_code=E123"));
    assert!(msg.contains("http_status=500"));
}

#[test]
fn test_permission_denied_display() {
    let err = ChannelError::provider_denied("Access denied", Some("P001".to_string()));
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_CONNECTOR_PERMISSION_DENIED"));
    assert!(msg.contains("Access denied"));
    assert!(msg.contains("provider_code=P001"));
}

#[test]
fn test_validation_display() {
    let err = ChannelError::Validation {
        detail: "Invalid format".to_string(),
    };
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_VALIDATION"));
    assert!(msg.contains("Invalid format"));
}

#[test]
fn test_store_display() {
    let err = ChannelError::Store {
        operation: "READ".to_string(),
        detail: "File not found".to_string(),
    };
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_STORE_READ"));
    assert!(msg.contains("File not found"));
}

#[test]
fn test_transport_display() {
    let err = ChannelError::Transport {
        detail: "Connection lost".to_string(),
        retryable: true,
    };
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_TRANSPORT"));
    assert!(msg.contains("Connection lost"));
    assert!(msg.contains("retryable=true"));
}

#[test]
fn test_timeout_display() {
    let err = ChannelError::Timeout {
        detail: "Request timed out".to_string(),
        retryable: true,
    };
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_TIMEOUT"));
    assert!(msg.contains("Request timed out"));
    assert!(msg.contains("retryable=true"));
}

#[test]
fn test_cancelled_display() {
    let err = ChannelError::Cancelled {
        detail: "User cancelled".to_string(),
    };
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_CANCELLED"));
    assert!(msg.contains("User cancelled"));
}

#[test]
fn test_config_display() {
    let err = ChannelError::Config {
        detail: "Missing API key".to_string(),
    };
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_CONFIG"));
    assert!(msg.contains("Missing API key"));
}

#[test]
fn test_unsupported_display() {
    let err = ChannelError::Unsupported {
        detail: "Feature not supported".to_string(),
    };
    let msg = err.to_string();
    assert!(msg.contains("CHANNEL_UNSUPPORTED"));
    assert!(msg.contains("Feature not supported"));
}

#[test]
fn test_into_string_preserves_content() {
    let err = ChannelError::Config {
        detail: "Test error".to_string(),
    };
    let s: String = err.into();
    assert!(s.contains("CHANNEL_CONFIG"));
    assert!(s.contains("Test error"));
}

#[test]
fn test_retryable_flags() {
    let auth_retryable = ChannelError::Auth {
        category: "FAILED".to_string(),
        detail: "test".to_string(),
        retryable: true,
    };
    assert!(auth_retryable.retryable());

    let auth_not_retryable = ChannelError::Auth {
        category: "FAILED".to_string(),
        detail: "test".to_string(),
        retryable: false,
    };
    assert!(!auth_not_retryable.retryable());

    let validation = ChannelError::Validation {
        detail: "test".to_string(),
    };
    assert!(!validation.retryable());

    let cancelled = ChannelError::Cancelled {
        detail: "test".to_string(),
    };
    assert!(!cancelled.retryable());

    let transport_retryable = ChannelError::Transport {
        detail: "test".to_string(),
        retryable: true,
    };
    assert!(transport_retryable.retryable());

    let permission = ChannelError::provider_denied("test", None);
    assert!(!permission.retryable());
}

#[test]
fn test_from_io_error_connection_reset() {
    use std::io;

    let io_err = io::Error::new(io::ErrorKind::ConnectionReset, "connection reset");
    let channel_err: ChannelError = io_err.into();

    match channel_err {
        ChannelError::Transport { detail, retryable } => {
            assert!(detail.contains("connection reset"));
            assert!(retryable);
        }
        _ => panic!("Expected Transport error"),
    }
}

#[test]
fn test_convenience_constructors() {
    let not_found = ChannelError::not_found("feishu", "default");
    assert!(not_found.to_string().contains("feishu"));

    let disabled = ChannelError::disabled("telegram", "ops");
    assert!(disabled.to_string().contains("telegram"));

    let send_invalid = ChannelError::send_invalid("peer_id is empty");
    assert!(send_invalid.to_string().contains("CHANNEL_VALIDATION"));

    let store_read = ChannelError::store_read("file error");
    assert!(store_read.to_string().contains("CHANNEL_STORE_READ"));

    let secret_load = ChannelError::secret_load_failed("keychain error");
    assert!(secret_load.to_string().contains("CHANNEL_CONNECTOR_AUTH"));

    let invalid_resp = ChannelError::invalid_response("bad json", Some(502));
    assert!(invalid_resp.to_string().contains("CHANNEL_CONNECTOR_PROVIDER"));
    assert!(invalid_resp.to_string().contains("http_status=502"));
}