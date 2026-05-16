use super::{
    base_info, build_headers, build_send_message_body, fetch_qrcode_url, get_updates_url,
    normalize_base_url, poll_qr_status_url, send_message_url, GetUpdatesReq, GetUpdatesResp,
    MessageItem, QrCodeResp, QrStatusResp, TextItem, WeixinMessage,
};
use reqwest::Client;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
};

fn provider_stub(status: &str, body: &'static str) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind provider stub");
    let addr = listener.local_addr().expect("provider stub address");
    let (tx, rx) = mpsc::channel();
    let status = status.to_string();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept provider request");
        let mut buffer = [0_u8; 8192];
        let read = stream.read(&mut buffer).expect("read provider request");
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        tx.send(request).expect("send captured request");
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("write provider response");
    });
    (format!("http://{addr}"), rx)
}

#[test]
fn build_headers_sets_wechat_authorization_fields() {
    let headers = build_headers(" token-abc ").expect("headers");

    assert_eq!(
        headers
            .get("AuthorizationType")
            .and_then(|value| value.to_str().ok()),
        Some("ilink_bot_token")
    );
    assert_eq!(
        headers
            .get("Authorization")
            .and_then(|value| value.to_str().ok()),
        Some("Bearer token-abc")
    );
    assert!(headers
        .get("X-WECHAT-UIN")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .is_some());
}

#[test]
fn build_headers_rejects_invalid_authorization_values() {
    let error = build_headers("bad\r\nvalue").expect_err("invalid header");
    assert!(error.contains("CHANNEL_CONNECTOR_AUTH_INVALID"));

    let blank = build_headers("   ").expect_err("blank token");
    assert_eq!(blank, "CHANNEL_CONNECTOR_AUTH_INVALID: token is required");
}

#[test]
fn get_updates_request_serializes_stable_contract() {
    let request = GetUpdatesReq {
        get_updates_buf: "cursor-1".to_string(),
        base_info: base_info(),
    };

    let payload = serde_json::to_value(&request).expect("serialize request");

    assert_eq!(
        payload
            .get("get_updates_buf")
            .and_then(|value| value.as_str()),
        Some("cursor-1")
    );
    assert!(payload
        .get("base_info")
        .and_then(|value| value.get("channel_version"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .is_some());
}

#[test]
fn wechat_endpoint_urls_trim_trailing_slashes() {
    assert_eq!(
        normalize_base_url(" https://wechat.example/// "),
        "https://wechat.example"
    );
    assert_eq!(
        get_updates_url(" https://wechat.example/// "),
        "https://wechat.example/ilink/bot/getupdates"
    );
    assert_eq!(
        send_message_url("https://wechat.example/"),
        "https://wechat.example/ilink/bot/sendmessage"
    );
    assert_eq!(
        fetch_qrcode_url("https://wechat.example/"),
        "https://wechat.example/ilink/bot/get_bot_qrcode?bot_type=3"
    );
    assert_eq!(
        poll_qr_status_url("https://wechat.example/", "qr+1&x=y"),
        "https://wechat.example/ilink/bot/get_qrcode_status?qrcode=qr%2B1%26x%3Dy"
    );
}

#[test]
fn send_message_request_serializes_text_item_contract() {
    let body = build_send_message_body("user-1", "ctx-1", "hello", "client-1".to_string());

    let payload = serde_json::to_value(&body).expect("serialize send body");

    assert_eq!(payload["msg"]["to_user_id"], "user-1");
    assert_eq!(payload["msg"]["client_id"], "client-1");
    assert_eq!(payload["msg"]["context_token"], "ctx-1");
    assert_eq!(payload["msg"]["message_type"], 2);
    assert_eq!(payload["msg"]["message_state"], 2);
    assert_eq!(payload["msg"]["item_list"][0]["type"], 1);
    assert_eq!(payload["msg"]["item_list"][0]["text_item"]["text"], "hello");
}

#[test]
fn get_updates_response_defaults_optional_provider_fields() {
    let response: GetUpdatesResp =
        serde_json::from_value(serde_json::json!({})).expect("default response should decode");

    assert_eq!(response.ret, 0);
    assert_eq!(response.errcode, None);
    assert!(response.msgs.is_empty());
    assert_eq!(response.get_updates_buf, None);
}

#[test]
fn weixin_message_defaults_and_text_item_decode() {
    let message: WeixinMessage = serde_json::from_value(serde_json::json!({
        "from_user_id": "user-1",
        "context_token": "ctx",
        "message_type": 1,
        "item_list": [
            { "type": 1, "text_item": { "text": "hello" } },
            { "type": 2 }
        ],
        "create_time_ms": 123
    }))
    .expect("decode message");

    assert_eq!(message.from_user_id, "user-1");
    assert_eq!(message.context_token.as_deref(), Some("ctx"));
    assert_eq!(message.message_type, 1);
    assert_eq!(message.create_time_ms, Some(123));
    assert_eq!(message.item_list.len(), 2);
    assert_eq!(message.item_list[0].type_, 1);
    assert_eq!(
        message.item_list[0]
            .text_item
            .as_ref()
            .and_then(|item| item.text.as_deref()),
        Some("hello")
    );

    let defaults: MessageItem =
        serde_json::from_value(serde_json::json!({})).expect("default item");
    assert_eq!(defaults.type_, 0);
    assert!(defaults.text_item.is_none());
    let default_text: TextItem =
        serde_json::from_value(serde_json::json!({})).expect("default text");
    assert_eq!(default_text.text, None);
}

#[test]
fn qrcode_responses_decode_optional_auth_fields() {
    let qrcode: QrCodeResp = serde_json::from_value(serde_json::json!({
        "qrcode": "qr-1",
        "qrcode_img_content": "https://wechat.example/qr"
    }))
    .expect("qrcode response");
    assert_eq!(qrcode.qrcode, "qr-1");
    assert_eq!(qrcode.qrcode_img_content, "https://wechat.example/qr");

    let pending: QrStatusResp = serde_json::from_value(serde_json::json!({
        "status": "wait"
    }))
    .expect("pending status response");
    assert_eq!(pending.status, "wait");
    assert_eq!(pending.bot_token, None);
    assert_eq!(pending.baseurl, None);

    let confirmed: QrStatusResp = serde_json::from_value(serde_json::json!({
        "status": "confirmed",
        "bot_token": "token-1",
        "baseurl": "https://wechat.example"
    }))
    .expect("confirmed status response");
    assert_eq!(confirmed.status, "confirmed");
    assert_eq!(confirmed.bot_token.as_deref(), Some("token-1"));
    assert_eq!(confirmed.baseurl.as_deref(), Some("https://wechat.example"));
}

#[tokio::test]
async fn provider_calls_send_stable_requests_and_parse_success_responses() {
    let client = Client::new();

    let (updates_base, updates_rx) = provider_stub(
        "200 OK",
        r#"{"ret":0,"msgs":[{"from_user_id":"user-1","context_token":"ctx","item_list":[{"type":1,"text_item":{"text":"hi"}}]}],"get_updates_buf":"next"}"#,
    );
    let updates = super::get_updates(&client, &updates_base, " token-1 ", "cursor-1")
        .await
        .expect("get updates");
    assert_eq!(updates.ret, 0);
    assert_eq!(updates.msgs.len(), 1);
    assert_eq!(updates.get_updates_buf.as_deref(), Some("next"));
    let updates_request = updates_rx.recv().expect("captured updates request");
    assert!(updates_request.starts_with("POST /ilink/bot/getupdates HTTP/1.1"));
    assert!(updates_request
        .to_ascii_lowercase()
        .contains("authorization: bearer token-1"));
    assert!(updates_request.contains(r#""get_updates_buf":"cursor-1""#));

    let (send_base, send_rx) = provider_stub("200 OK", r#"{"ret":0}"#);
    let delivered_id =
        super::send_message(&client, &send_base, "token-1", "user-1", "ctx-1", "hello")
            .await
            .expect("send message");
    assert!(!delivered_id.is_empty());
    let send_request = send_rx.recv().expect("captured send request");
    assert!(send_request.starts_with("POST /ilink/bot/sendmessage HTTP/1.1"));
    assert!(send_request.contains(r#""to_user_id":"user-1""#));
    assert!(send_request.contains(r#""context_token":"ctx-1""#));
    assert!(send_request.contains(r#""text":"hello""#));

    let (qr_base, qr_rx) = provider_stub(
        "200 OK",
        r#"{"qrcode":"qr-1","qrcode_img_content":"svg-content"}"#,
    );
    let qrcode = super::fetch_qrcode(&client, &qr_base)
        .await
        .expect("fetch qrcode");
    assert_eq!(qrcode.qrcode, "qr-1");
    assert_eq!(qrcode.qrcode_img_content, "svg-content");
    assert!(qr_rx
        .recv()
        .expect("captured qrcode request")
        .starts_with("GET /ilink/bot/get_bot_qrcode?bot_type=3 HTTP/1.1"));

    let (status_base, status_rx) = provider_stub(
        "200 OK",
        r#"{"status":"confirmed","bot_token":"token-2","baseurl":"https://wechat.example"}"#,
    );
    let status = super::poll_qr_status(&client, &status_base, "qr+1&x=y")
        .await
        .expect("poll qr status");
    assert_eq!(status.status, "confirmed");
    assert_eq!(status.bot_token.as_deref(), Some("token-2"));
    let status_request = status_rx.recv().expect("captured status request");
    assert!(status_request
        .starts_with("GET /ilink/bot/get_qrcode_status?qrcode=qr%2B1%26x%3Dy HTTP/1.1"));
    assert!(status_request
        .to_ascii_lowercase()
        .contains("ilink-app-clientversion: 1"));
}

#[tokio::test]
async fn provider_calls_surface_http_and_invalid_json_failures() {
    let client = Client::new();

    let (updates_base, _updates_rx) = provider_stub("503 Service Unavailable", r#"{}"#);
    let updates_error = super::probe_updates(&client, &updates_base, "token-1", "cursor-1")
        .await
        .expect_err("updates http failure");
    assert_eq!(
        updates_error,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: getupdates HTTP 503 Service Unavailable"
    );

    let (send_base, _send_rx) = provider_stub("400 Bad Request", "not allowed");
    let send_error = super::send_message(&client, &send_base, "token-1", "user-1", "ctx", "hello")
        .await
        .expect_err("send http failure");
    assert_eq!(
        send_error,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: sendmessage HTTP 400 Bad Request: not allowed"
    );

    let (qr_base, _qr_rx) = provider_stub("200 OK", "not json");
    let qr_error = super::fetch_qrcode(&client, &qr_base)
        .await
        .expect_err("invalid qrcode json");
    assert!(qr_error
        .starts_with("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: get_bot_qrcode invalid JSON:"));

    let (status_base, _status_rx) = provider_stub("500 Internal Server Error", r#"{}"#);
    let status_error = super::poll_qr_status(&client, &status_base, "qr-1")
        .await
        .expect_err("qr status http failure");
    assert_eq!(
        status_error,
        "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: get_qrcode_status HTTP 500 Internal Server Error"
    );
}
