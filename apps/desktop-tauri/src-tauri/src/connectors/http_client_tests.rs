use super::{HttpClient, HttpRequest, HttpResponse};

#[test]
fn http_request_builder_get() {
    let req = HttpRequest::get("https://example.com/api")
        .header("Authorization", "Bearer test123")
        .timeout_secs(8)
        .build();
    assert_eq!(req.method, "GET");
    assert_eq!(req.url, "https://example.com/api");
    assert_eq!(req.headers.get(0).unwrap().0, "Authorization");
    assert_eq!(req.timeout_secs, 8);
    assert!(req.body.is_none());
}

#[test]
fn http_request_builder_post_json() {
    let req = HttpRequest::post("https://example.com/api")
        .json_body(&serde_json::json!({"key": "value"}))
        .timeout_secs(25)
        .build();
    assert_eq!(req.method, "POST");
    assert_eq!(req.timeout_secs, 25);
    assert!(req.body.is_some());
    assert_eq!(req.content_type.as_deref(), Some("application/json"));
}

#[tokio::test]
async fn http_client_handles_connection_refused() {
    let client = HttpClient::builder().max_retries(0).build();
    let result: Result<HttpResponse, super::super::channel_error::ChannelError> = client
        .execute(
            HttpRequest::get("http://127.0.0.1:1/impossible")
                .timeout_secs(2)
                .build(),
        )
        .await;
    assert!(result.is_err());
    let error = result.unwrap_err();
    assert!(error.retryable());
}

#[test]
fn http_request_timeout_presets() {
    let send_req = HttpRequest::post("https://api.telegram.org/bot123/sendMessage")
        .timeout_secs(25)
        .build();
    assert_eq!(send_req.timeout_secs, 25);

    let poll_req = HttpRequest::post("https://api.telegram.org/bot123/getUpdates")
        .timeout_secs(30)
        .build();
    assert_eq!(poll_req.timeout_secs, 30);

    let short_req = HttpRequest::get("https://api.telegram.org/bot123/getMe")
        .timeout_secs(8)
        .build();
    assert_eq!(short_req.timeout_secs, 8);
}

#[test]
fn http_response_helpers() {
    let response = HttpResponse {
        status: 200,
        body: br#"{"ok":true}"#.to_vec(),
    };
    assert!(response.is_success());
    assert_eq!(response.status, 200);
    let json = response.json_value().unwrap();
    assert_eq!(json["ok"], true);
}

#[test]
fn http_response_non_success() {
    let response = HttpResponse {
        status: 429,
        body: br#"{"ok":false,"error_code":429}"#.to_vec(),
    };
    assert!(!response.is_success());
    assert_eq!(response.status, 429);
}
