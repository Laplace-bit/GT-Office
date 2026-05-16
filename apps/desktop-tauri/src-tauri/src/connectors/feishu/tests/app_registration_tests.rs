use super::{
    accounts_base_url, append_qr_tracking_params, begin_result_from_response,
    bot_name_from_payload, domain_id, fetch_bot_info_with_base, poll_error_action,
    post_registration_with_base, query_has_param, should_switch_to_lark,
    validate_supported_auth_methods, BotInfoEnvelope, BotInfoPayload, InitResponse,
    PollErrorAction, PollResponse, RawBeginResponse, TenantAccessTokenResponse,
};
use crate::connectors::feishu::types::FeishuDomain;
use reqwest::Client;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
};

fn registration_stub(status: &str, body: &'static str) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind registration stub");
    let addr = listener.local_addr().expect("registration stub address");
    let (tx, rx) = mpsc::channel();
    let status = status.to_string();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept registration request");
        let mut buffer = [0_u8; 8192];
        let read = stream.read(&mut buffer).expect("read registration request");
        tx.send(String::from_utf8_lossy(&buffer[..read]).to_string())
            .expect("send captured request");
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("write registration response");
    });
    (format!("http://{addr}"), rx)
}

fn multi_response_stub(
    responses: Vec<(&'static str, &'static str)>,
) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind multi response stub");
    let addr = listener.local_addr().expect("multi response stub address");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().expect("accept multi request");
            let mut buffer = [0_u8; 8192];
            let read = stream.read(&mut buffer).expect("read multi request");
            tx.send(String::from_utf8_lossy(&buffer[..read]).to_string())
                .expect("send captured multi request");
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write multi response");
        }
    });
    (format!("http://{addr}"), rx)
}

#[test]
fn accounts_base_url_tracks_feishu_and_lark_domains() {
    assert_eq!(
        accounts_base_url(FeishuDomain::Feishu),
        "https://accounts.feishu.cn"
    );
    assert_eq!(
        accounts_base_url(FeishuDomain::Lark),
        "https://accounts.larksuite.com"
    );
    assert_eq!(domain_id(FeishuDomain::Feishu), "feishu");
    assert_eq!(domain_id(FeishuDomain::Lark), "lark");
}

#[test]
fn qr_tracking_params_are_added_without_duplicate_from_marker() {
    assert_eq!(
        append_qr_tracking_params("https://login.example/qr".to_string()),
        "https://login.example/qr?from=gtoffice&tp=ob_cli_app"
    );
    assert_eq!(
        append_qr_tracking_params("https://login.example/qr?foo=bar".to_string()),
        "https://login.example/qr?foo=bar&from=gtoffice&tp=ob_cli_app"
    );
    assert_eq!(
        append_qr_tracking_params("https://login.example/qr?from=provider".to_string()),
        "https://login.example/qr?from=provider"
    );
    assert_eq!(
        append_qr_tracking_params("https://login.example/from=path#section".to_string()),
        "https://login.example/from=path?from=gtoffice&tp=ob_cli_app#section"
    );
    assert!(query_has_param(
        "https://login.example/qr?foo=bar&from=provider#section",
        "from"
    ));
    assert!(!query_has_param(
        "https://login.example/from=path?platform=from%3Dprovider",
        "from"
    ));
}

#[test]
fn bot_name_prefers_trimmed_name_and_falls_back_to_app_name() {
    let named_bot = BotInfoPayload {
        activate_status: Some(1),
        app_name: Some(" App Bot ".to_string()),
        open_id: Some("open-id".to_string()),
        name: Some(" Bot Name ".to_string()),
    };
    assert_eq!(
        bot_name_from_payload(&named_bot).as_deref(),
        Some("Bot Name")
    );

    let app_named_bot = BotInfoPayload {
        activate_status: Some(1),
        app_name: Some(" App Bot ".to_string()),
        open_id: None,
        name: Some("   ".to_string()),
    };
    assert_eq!(
        bot_name_from_payload(&app_named_bot).as_deref(),
        Some("App Bot")
    );

    let unnamed_bot = BotInfoPayload {
        activate_status: None,
        app_name: Some(" ".to_string()),
        open_id: None,
        name: None,
    };
    assert_eq!(bot_name_from_payload(&unnamed_bot), None);
}

#[test]
fn registration_response_deserializers_tolerate_optional_provider_fields() {
    let init: InitResponse =
        serde_json::from_value(serde_json::json!({})).expect("default init response");
    assert_eq!(init.nonce, None);
    assert!(init.supported_auth_methods.is_empty());

    let begin: RawBeginResponse = serde_json::from_value(serde_json::json!({
        "device_code": "device-1",
        "verification_uri": "https://verify.example",
        "user_code": "ABCD",
        "verification_uri_complete": "https://verify.example/complete"
    }))
    .expect("begin response");
    assert_eq!(begin.device_code, "device-1");
    assert_eq!(begin.interval, None);
    assert_eq!(begin.expire_in, None);

    let poll: PollResponse = serde_json::from_value(serde_json::json!({
        "error": "slow_down",
        "error_description": "wait longer",
        "user_info": {
            "open_id": "ou_1",
            "tenant_brand": "lark"
        }
    }))
    .expect("poll response");
    assert_eq!(poll.client_id, None);
    assert_eq!(poll.error.as_deref(), Some("slow_down"));
    assert_eq!(poll.error_description.as_deref(), Some("wait longer"));
    let user_info = poll.user_info.expect("poll user info");
    assert_eq!(user_info.open_id.as_deref(), Some("ou_1"));
    assert_eq!(user_info.tenant_brand.as_deref(), Some("lark"));

    let token: TenantAccessTokenResponse =
        serde_json::from_value(serde_json::json!({})).expect("token response");
    assert_eq!(token.tenant_access_token, None);

    let bot_info: BotInfoEnvelope =
        serde_json::from_value(serde_json::json!({})).expect("bot info response");
    assert_eq!(bot_info.code, 0);
    assert!(bot_info.bot.is_none());
}

#[test]
fn init_supported_auth_methods_accept_trimmed_client_secret_only() {
    let supported = InitResponse {
        nonce: Some("nonce-1".to_string()),
        supported_auth_methods: vec![" qr ".to_string(), " CLIENT_SECRET ".to_string()],
    };
    assert!(validate_supported_auth_methods(&supported).is_ok());

    let unsupported = InitResponse {
        nonce: None,
        supported_auth_methods: vec!["qr".to_string()],
    };
    assert_eq!(
        validate_supported_auth_methods(&unsupported).expect_err("client_secret missing"),
        "FEISHU_QR_UNSUPPORTED: Current environment does not support client_secret auth method"
    );
}

#[test]
fn begin_result_from_response_applies_defaults_and_tracking_params() {
    let result = begin_result_from_response(RawBeginResponse {
        device_code: "device-1".to_string(),
        verification_uri: "https://verify.example".to_string(),
        user_code: "ABCD".to_string(),
        verification_uri_complete: "https://verify.example/complete?foo=bar".to_string(),
        interval: None,
        expire_in: None,
    });

    assert_eq!(result.device_code, "device-1");
    assert_eq!(result.user_code, "ABCD");
    assert_eq!(
        result.qr_url,
        "https://verify.example/complete?foo=bar&from=gtoffice&tp=ob_cli_app"
    );
    assert_eq!(result.interval, 5);
    assert_eq!(result.expire_in, 600);

    let explicit = begin_result_from_response(RawBeginResponse {
        device_code: "device-2".to_string(),
        verification_uri: "https://verify.example".to_string(),
        user_code: "EFGH".to_string(),
        verification_uri_complete: "https://verify.example/complete".to_string(),
        interval: Some(2),
        expire_in: Some(30),
    });
    assert_eq!(explicit.interval, 2);
    assert_eq!(explicit.expire_in, 30);
}

#[test]
fn poll_error_action_maps_qr_provider_states() {
    assert_eq!(poll_error_action(None, None), None);
    assert_eq!(poll_error_action(Some("   "), None), None);
    assert_eq!(
        poll_error_action(Some(" Authorization_Pending "), None),
        Some(PollErrorAction::Pending)
    );
    assert_eq!(
        poll_error_action(Some("SLOW_DOWN"), None),
        Some(PollErrorAction::SlowDown)
    );
    assert_eq!(
        poll_error_action(Some("access_denied"), None),
        Some(PollErrorAction::Denied)
    );
    assert_eq!(
        poll_error_action(Some("expired_token"), None),
        Some(PollErrorAction::Expired)
    );
    assert_eq!(
        poll_error_action(Some("invalid_request"), Some("bad device code")),
        Some(PollErrorAction::Failed(
            "FEISHU_QR_ERROR: invalid_request - bad device code".to_string()
        ))
    );
    assert_eq!(
        poll_error_action(Some(" temporarily_unavailable "), Some("   ")),
        Some(PollErrorAction::Failed(
            "FEISHU_QR_ERROR: temporarily_unavailable - unknown".to_string()
        ))
    );
}

#[test]
fn tenant_brand_switch_to_lark_is_trimmed_case_insensitive_and_one_shot() {
    assert!(should_switch_to_lark(" lArK ", false));
    assert!(!should_switch_to_lark("feishu", false));
    assert!(!should_switch_to_lark("lark", true));
}

#[tokio::test]
async fn post_registration_encodes_form_and_accepts_provider_400_json() {
    let client = Client::new();
    let (base_url, rx) = registration_stub(
        "200 OK",
        r#"{"device_code":"device-1","verification_uri":"https://verify.example","user_code":"ABCD","verification_uri_complete":"https://verify.example/complete","interval":3,"expire_in":30}"#,
    );

    let begin: RawBeginResponse = post_registration_with_base(
        &client,
        &base_url,
        &[
            ("action", "begin"),
            ("auth_method", "client_secret"),
            ("request_user_info", "open_id"),
        ],
    )
    .await
    .expect("begin response");
    assert_eq!(begin.device_code, "device-1");
    assert_eq!(begin.interval, Some(3));

    let request = rx.recv().expect("captured request");
    assert!(request.starts_with("POST /oauth/v1/app/registration HTTP/1.1"));
    assert!(request
        .to_ascii_lowercase()
        .contains("content-type: application/x-www-form-urlencoded"));
    assert!(request.contains("action=begin&auth_method=client_secret&request_user_info=open_id"));

    let (base_url, _rx) = registration_stub(
        "400 Bad Request",
        r#"{"error":"authorization_pending","error_description":"wait"}"#,
    );
    let pending: PollResponse = post_registration_with_base(
        &client,
        &base_url,
        &[("action", "poll"), ("device_code", "device-1")],
    )
    .await
    .expect("400 provider state parses");
    assert_eq!(pending.error.as_deref(), Some("authorization_pending"));
}

#[tokio::test]
async fn post_registration_reports_http_and_parse_failures_with_bounded_body() {
    let client = Client::new();

    let long_body = "x".repeat(240);
    let leaked_body: &'static str = Box::leak(long_body.into_boxed_str());
    let (base_url, _rx) = registration_stub("503 Service Unavailable", leaked_body);
    let error: String =
        post_registration_with_base::<PollResponse>(&client, &base_url, &[("action", "poll")])
            .await
            .expect_err("non-400 http error");
    assert!(error.starts_with("FEISHU_QR_NETWORK: HTTP 503 Service Unavailable - "));
    assert!(error.len() < 260);

    let (base_url, _rx) = registration_stub("200 OK", "not json");
    let parse_error: String =
        post_registration_with_base::<PollResponse>(&client, &base_url, &[("action", "poll")])
            .await
            .expect_err("invalid json");
    assert!(parse_error.starts_with("FEISHU_QR_PARSE:"));
    assert!(parse_error.contains("body: not json"));
}

#[tokio::test]
async fn fetch_bot_info_with_base_fetches_token_then_bot_name() {
    let client = Client::new();
    let (base_url, rx) = multi_response_stub(vec![
        ("200 OK", r#"{"tenant_access_token":"token-1"}"#),
        (
            "200 OK",
            r#"{"code":0,"bot":{"name":" Ops Bot ","app_name":"Fallback"}}"#,
        ),
    ]);

    let bot_name = fetch_bot_info_with_base(&client, &base_url, "app-1", "secret-1")
        .await
        .expect("fetch bot info");

    assert_eq!(bot_name.as_deref(), Some("Ops Bot"));
    let token_request = rx.recv().expect("captured token request");
    assert!(
        token_request.starts_with("POST /open-apis/auth/v3/tenant_access_token/internal HTTP/1.1")
    );
    assert!(token_request.contains(r#""app_id":"app-1""#));
    assert!(token_request.contains(r#""app_secret":"secret-1""#));
    let bot_request = rx.recv().expect("captured bot request");
    assert!(bot_request.starts_with("GET /open-apis/bot/v3/info HTTP/1.1"));
    assert!(bot_request
        .to_ascii_lowercase()
        .contains("authorization: bearer token-1"));
}

#[tokio::test]
async fn fetch_bot_info_with_base_returns_none_for_incomplete_or_provider_error_payloads() {
    let client = Client::new();

    let (missing_token_base, _rx) = multi_response_stub(vec![("200 OK", r#"{}"#)]);
    let missing_token = fetch_bot_info_with_base(&client, &missing_token_base, "app-1", "secret-1")
        .await
        .expect("missing token is non-fatal");
    assert_eq!(missing_token, None);

    let (provider_error_base, _rx) = multi_response_stub(vec![
        ("200 OK", r#"{"tenant_access_token":"token-1"}"#),
        ("200 OK", r#"{"code":19001}"#),
    ]);
    let provider_error =
        fetch_bot_info_with_base(&client, &provider_error_base, "app-1", "secret-1")
            .await
            .expect("bot provider error is non-fatal");
    assert_eq!(provider_error, None);

    let (missing_bot_base, _rx) = multi_response_stub(vec![
        ("200 OK", r#"{"tenant_access_token":"token-1"}"#),
        ("200 OK", r#"{"code":0}"#),
    ]);
    let missing_bot = fetch_bot_info_with_base(&client, &missing_bot_base, "app-1", "secret-1")
        .await
        .expect("missing bot is non-fatal");
    assert_eq!(missing_bot, None);
}

#[tokio::test]
async fn fetch_bot_info_with_base_reports_network_and_parse_failures() {
    let client = Client::new();

    let (invalid_token_base, _rx) = multi_response_stub(vec![("200 OK", "not json")]);
    let invalid_token = fetch_bot_info_with_base(&client, &invalid_token_base, "app-1", "secret-1")
        .await
        .expect_err("invalid token json");
    assert!(invalid_token.starts_with("FEISHU_QR_PARSE:"));

    let (invalid_bot_base, _rx) = multi_response_stub(vec![
        ("200 OK", r#"{"tenant_access_token":"token-1"}"#),
        ("200 OK", "not json"),
    ]);
    let invalid_bot = fetch_bot_info_with_base(&client, &invalid_bot_base, "app-1", "secret-1")
        .await
        .expect_err("invalid bot json");
    assert!(invalid_bot.starts_with("FEISHU_QR_PARSE:"));
}
