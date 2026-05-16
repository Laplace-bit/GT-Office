use super::{qr_poll_status_snapshot, sessions, svg_data_url, to_snapshot, AuthSessionState};
use crate::connectors::wechat::list_accounts;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
};

fn auth_provider_stub(status: &str, body: &'static str) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind auth provider stub");
    let addr = listener.local_addr().expect("auth provider stub address");
    let (tx, rx) = mpsc::channel();
    let status = status.to_string();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept auth provider request");
        let mut buffer = [0_u8; 8192];
        let read = stream
            .read(&mut buffer)
            .expect("read auth provider request");
        tx.send(String::from_utf8_lossy(&buffer[..read]).to_string())
            .expect("send captured auth request");
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("write auth provider response");
    });
    (format!("http://{addr}"), rx)
}

#[test]
fn svg_data_url_renders_base64_svg_payload() {
    let data_url = svg_data_url("wechat-auth-token").expect("qr render");

    assert!(data_url.starts_with("data:image/svg+xml;base64,"));
    let encoded = data_url
        .strip_prefix("data:image/svg+xml;base64,")
        .expect("prefix");
    let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .expect("base64 decode");
    let svg = String::from_utf8(decoded).expect("utf8 svg");
    assert!(svg.contains("<svg"));
}

#[test]
fn to_snapshot_preserves_auth_session_state_fields() {
    let state = AuthSessionState {
        auth_session_id: "session-1".to_string(),
        account_id: "default".to_string(),
        base_url: "https://example.test".to_string(),
        status: "awaiting_scan".to_string(),
        checked_at_ms: 123,
        qr_code_id: Some("qr-1".to_string()),
        qr_code_svg_data_url: Some("data:image/svg+xml;base64,abc".to_string()),
        expires_at_ms: Some(456),
        detail: Some("Scan the QR code with WeChat.".to_string()),
        bound_account_id: None,
    };

    let snapshot = to_snapshot(&state);

    assert_eq!(snapshot.auth_session_id, "session-1");
    assert_eq!(snapshot.account_id, "default");
    assert_eq!(snapshot.status, "awaiting_scan");
    assert_eq!(snapshot.checked_at_ms, 123);
    assert_eq!(snapshot.qr_code_id.as_deref(), Some("qr-1"));
    assert_eq!(snapshot.expires_at_ms, Some(456));
    assert_eq!(
        snapshot.detail.as_deref(),
        Some("Scan the QR code with WeChat.")
    );
    assert_eq!(snapshot.bound_account_id, None);
}

#[test]
fn qr_poll_status_snapshot_normalizes_provider_states() {
    assert_eq!(
        qr_poll_status_snapshot("wait"),
        ("awaiting_scan".to_string(), "Waiting for scan.".to_string())
    );
    assert_eq!(
        qr_poll_status_snapshot("scaned"),
        (
            "scanned".to_string(),
            "Scanned. Confirm on your phone.".to_string()
        )
    );
    assert_eq!(
        qr_poll_status_snapshot("scanned"),
        (
            "scanned".to_string(),
            "Scanned. Confirm on your phone.".to_string()
        )
    );
    assert_eq!(
        qr_poll_status_snapshot("expired"),
        (
            "expired".to_string(),
            "QR code expired. Refresh to try again.".to_string()
        )
    );
    assert_eq!(
        qr_poll_status_snapshot("mystery"),
        (
            "mystery".to_string(),
            "Unexpected QR status: mystery".to_string()
        )
    );
}

#[test]
fn cancel_auth_reports_missing_session() {
    let error = super::cancel_auth("missing-session").expect_err("missing session");
    assert!(error.contains("CHANNEL_CONNECTOR_AUTH_NOT_FOUND"));
}

#[test]
fn cancel_auth_removes_existing_session_and_returns_cancelled_snapshot() {
    let auth_session_id = format!("session-{}", uuid::Uuid::new_v4());
    let state = AuthSessionState {
        auth_session_id: auth_session_id.clone(),
        account_id: "default".to_string(),
        base_url: "https://example.test".to_string(),
        status: "awaiting_scan".to_string(),
        checked_at_ms: 123,
        qr_code_id: Some("qr-1".to_string()),
        qr_code_svg_data_url: None,
        expires_at_ms: Some(456),
        detail: Some("Scan".to_string()),
        bound_account_id: None,
    };

    sessions()
        .write()
        .expect("auth sessions lock")
        .insert(auth_session_id.clone(), state);

    let snapshot = super::cancel_auth(&auth_session_id).expect("cancel session");

    assert_eq!(snapshot.auth_session_id, auth_session_id);
    assert_eq!(snapshot.status, "cancelled");
    assert_eq!(snapshot.detail.as_deref(), Some("Auth session cancelled."));
    assert!(!sessions()
        .read()
        .expect("auth sessions lock")
        .contains_key(&snapshot.auth_session_id));
}

#[tokio::test]
async fn auth_status_returns_terminal_sessions_without_provider_polling() {
    let app = tauri::test::mock_app();

    for status in ["confirmed", "expired", "cancelled"] {
        let auth_session_id = format!("session-{status}-{}", uuid::Uuid::new_v4());
        let state = AuthSessionState {
            auth_session_id: auth_session_id.clone(),
            account_id: "default".to_string(),
            base_url: "http://127.0.0.1:1".to_string(),
            status: status.to_string(),
            checked_at_ms: 123,
            qr_code_id: None,
            qr_code_svg_data_url: None,
            expires_at_ms: Some(456),
            detail: Some(format!("{status} detail")),
            bound_account_id: (status == "confirmed").then(|| "default".to_string()),
        };
        sessions()
            .write()
            .expect("auth sessions lock")
            .insert(auth_session_id.clone(), state);

        let snapshot = super::auth_status(app.handle(), &auth_session_id)
            .await
            .expect("terminal auth status");

        assert_eq!(snapshot.auth_session_id, auth_session_id);
        assert_eq!(snapshot.status, status);
        assert_eq!(snapshot.checked_at_ms, 123);
        assert_eq!(
            snapshot.detail.as_deref(),
            Some(format!("{status} detail").as_str())
        );
    }
}

#[tokio::test]
async fn auth_status_reports_missing_session_and_missing_qr_id_locally() {
    let app = tauri::test::mock_app();

    let missing = super::auth_status(app.handle(), "missing-session")
        .await
        .expect_err("missing session");
    assert_eq!(
        missing,
        "CHANNEL_CONNECTOR_AUTH_NOT_FOUND: auth session not found"
    );

    let auth_session_id = format!("session-missing-qr-{}", uuid::Uuid::new_v4());
    let state = AuthSessionState {
        auth_session_id: auth_session_id.clone(),
        account_id: "default".to_string(),
        base_url: "http://127.0.0.1:1".to_string(),
        status: "awaiting_scan".to_string(),
        checked_at_ms: 123,
        qr_code_id: None,
        qr_code_svg_data_url: None,
        expires_at_ms: Some(456),
        detail: Some("waiting".to_string()),
        bound_account_id: None,
    };
    sessions()
        .write()
        .expect("auth sessions lock")
        .insert(auth_session_id.clone(), state);

    let error = super::auth_status(app.handle(), &auth_session_id)
        .await
        .expect_err("missing qr id");
    assert_eq!(
        error,
        "CHANNEL_CONNECTOR_AUTH_NOT_FOUND: missing qr code id"
    );
}

#[tokio::test]
async fn auth_status_polls_provider_and_normalizes_non_terminal_states() {
    let app = tauri::test::mock_app();

    for (provider_status, expected_status, expected_detail) in [
        ("wait", "awaiting_scan", "Waiting for scan."),
        ("scaned", "scanned", "Scanned. Confirm on your phone."),
        (
            "expired",
            "expired",
            "QR code expired. Refresh to try again.",
        ),
    ] {
        let (base_url, rx) = auth_provider_stub(
            "200 OK",
            Box::leak(format!(r#"{{"status":"{provider_status}"}}"#).into_boxed_str()),
        );
        let auth_session_id = format!("session-{provider_status}-{}", uuid::Uuid::new_v4());
        sessions().write().expect("auth sessions lock").insert(
            auth_session_id.clone(),
            AuthSessionState {
                auth_session_id: auth_session_id.clone(),
                account_id: "default".to_string(),
                base_url,
                status: "awaiting_scan".to_string(),
                checked_at_ms: 123,
                qr_code_id: Some("qr+1".to_string()),
                qr_code_svg_data_url: None,
                expires_at_ms: Some(456),
                detail: Some("waiting".to_string()),
                bound_account_id: None,
            },
        );

        let snapshot = super::auth_status(app.handle(), &auth_session_id)
            .await
            .expect("auth status poll");
        assert_eq!(snapshot.status, expected_status);
        assert_eq!(snapshot.detail.as_deref(), Some(expected_detail));
        assert_eq!(snapshot.bound_account_id, None);
        let request = rx.recv().expect("captured auth status request");
        assert!(request.starts_with("GET /ilink/bot/get_qrcode_status?qrcode=qr%2B1 HTTP/1.1"));
    }
}

#[tokio::test]
async fn auth_status_confirmed_without_token_reports_local_auth_failure() {
    let app = tauri::test::mock_app();
    let (base_url, _rx) = auth_provider_stub("200 OK", r#"{"status":"confirmed"}"#);
    let auth_session_id = format!("session-confirmed-missing-token-{}", uuid::Uuid::new_v4());
    sessions().write().expect("auth sessions lock").insert(
        auth_session_id.clone(),
        AuthSessionState {
            auth_session_id: auth_session_id.clone(),
            account_id: "default".to_string(),
            base_url,
            status: "awaiting_scan".to_string(),
            checked_at_ms: 123,
            qr_code_id: Some("qr-1".to_string()),
            qr_code_svg_data_url: None,
            expires_at_ms: Some(456),
            detail: Some("waiting".to_string()),
            bound_account_id: None,
        },
    );

    let error = super::auth_status(app.handle(), &auth_session_id)
        .await
        .expect_err("confirmed without token");
    assert_eq!(
        error,
        "CHANNEL_CONNECTOR_AUTH_FAILED: QR confirmed but token missing"
    );
}

#[tokio::test]
async fn auth_status_confirmed_binds_account_and_persists_connector_config() {
    let app = tauri::test::mock_app();
    let (base_url, _rx) = auth_provider_stub(
        "200 OK",
        r#"{"status":"confirmed","bot_token":"token-1","baseurl":"https://wechat.bound.example"}"#,
    );
    let account_id = format!("auth-bound-{}", uuid::Uuid::new_v4().simple());
    let auth_session_id = format!("session-confirmed-{}", uuid::Uuid::new_v4());
    sessions().write().expect("auth sessions lock").insert(
        auth_session_id.clone(),
        AuthSessionState {
            auth_session_id: auth_session_id.clone(),
            account_id: account_id.clone(),
            base_url,
            status: "awaiting_scan".to_string(),
            checked_at_ms: 123,
            qr_code_id: Some("qr-1".to_string()),
            qr_code_svg_data_url: None,
            expires_at_ms: Some(456),
            detail: Some("waiting".to_string()),
            bound_account_id: None,
        },
    );

    let snapshot = super::auth_status(app.handle(), &auth_session_id)
        .await
        .expect("confirmed auth status");

    assert_eq!(snapshot.status, "confirmed");
    assert_eq!(
        snapshot.detail.as_deref(),
        Some("WeChat account bound successfully.")
    );
    assert_eq!(
        snapshot.bound_account_id.as_deref(),
        Some(account_id.as_str())
    );

    let accounts = list_accounts(app.handle()).expect("list accounts after auth");
    let bound = accounts
        .iter()
        .find(|account| account.account_id == account_id)
        .expect("bound account listed");
    assert!(bound.enabled);
    assert!(bound.has_token);
    assert_eq!(bound.base_url, "https://wechat.bound.example");
}
