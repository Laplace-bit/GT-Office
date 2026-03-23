use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Client,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;

const LONG_POLL_TIMEOUT: Duration = Duration::from_secs(35);
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const API_TIMEOUT: Duration = Duration::from_secs(15);

fn build_headers(token: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "AuthorizationType",
        HeaderValue::from_static("ilink_bot_token"),
    );
    headers.insert(
        "Authorization",
        HeaderValue::from_str(format!("Bearer {token}").as_str())
            .map_err(|error| format!("CHANNEL_CONNECTOR_AUTH_INVALID: {error}"))?,
    );
    let uin_b64 = BASE64.encode(Uuid::new_v4().simple().to_string());
    headers.insert(
        "X-WECHAT-UIN",
        HeaderValue::from_str(uin_b64.as_str())
            .map_err(|error| format!("CHANNEL_CONNECTOR_AUTH_INVALID: {error}"))?,
    );
    Ok(headers)
}

#[derive(Serialize)]
struct BaseInfo {
    channel_version: &'static str,
}

fn base_info() -> BaseInfo {
    BaseInfo {
        channel_version: env!("CARGO_PKG_VERSION"),
    }
}

#[derive(Serialize)]
struct GetUpdatesReq {
    get_updates_buf: String,
    base_info: BaseInfo,
}

#[derive(Debug, Deserialize)]
pub struct GetUpdatesResp {
    #[serde(default)]
    pub ret: i32,
    #[serde(default)]
    pub errcode: Option<i32>,
    #[serde(default)]
    pub errmsg: Option<String>,
    #[serde(default)]
    pub msgs: Vec<WeixinMessage>,
    #[serde(default)]
    pub get_updates_buf: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WeixinMessage {
    #[serde(default)]
    pub from_user_id: String,
    #[serde(default)]
    pub context_token: Option<String>,
    #[serde(default)]
    pub message_type: i32,
    #[serde(default)]
    pub item_list: Vec<MessageItem>,
    #[serde(default)]
    pub create_time_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct MessageItem {
    #[serde(rename = "type", default)]
    pub type_: i32,
    #[serde(default)]
    pub text_item: Option<TextItem>,
}

#[derive(Debug, Deserialize)]
pub struct TextItem {
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Serialize)]
struct SendMessageReqBody {
    msg: SendMessageMsg,
    base_info: BaseInfo,
}

#[derive(Serialize)]
struct SendMessageMsg {
    from_user_id: String,
    to_user_id: String,
    client_id: String,
    context_token: String,
    message_type: i32,
    message_state: i32,
    item_list: Vec<SendMessageItem>,
}

#[derive(Serialize)]
struct SendMessageItem {
    #[serde(rename = "type")]
    type_: i32,
    text_item: SendTextItem,
}

#[derive(Serialize)]
struct SendTextItem {
    text: String,
}

#[derive(Debug, Deserialize)]
pub struct QrCodeResp {
    pub qrcode: String,
    pub qrcode_img_content: String,
}

#[derive(Debug, Deserialize)]
pub struct QrStatusResp {
    pub status: String,
    #[serde(default)]
    pub bot_token: Option<String>,
    #[serde(default)]
    pub baseurl: Option<String>,
}

async fn perform_get_updates(
    client: &Client,
    base_url: &str,
    token: &str,
    buf: &str,
    timeout_duration: Duration,
    treat_timeout_as_empty: bool,
) -> Result<GetUpdatesResp, String> {
    let url = format!("{}/ilink/bot/getupdates", base_url.trim_end_matches('/'));
    let body = GetUpdatesReq {
        get_updates_buf: buf.to_string(),
        base_info: base_info(),
    };

    let response = client
        .post(&url)
        .headers(build_headers(token)?)
        .json(&body)
        .timeout(timeout_duration)
        .send()
        .await;

    match response {
        Ok(resp) => {
            if !resp.status().is_success() {
                return Err(format!(
                    "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: getupdates HTTP {}",
                    resp.status()
                ));
            }
            resp.json::<GetUpdatesResp>().await.map_err(|error| {
                format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: getupdates invalid JSON: {error}")
            })
        }
        Err(error) if error.is_timeout() && treat_timeout_as_empty => Ok(GetUpdatesResp {
            ret: 0,
            errcode: None,
            errmsg: None,
            msgs: Vec::new(),
            get_updates_buf: Some(buf.to_string()),
        }),
        Err(error) => Err(format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}")),
    }
}

pub async fn get_updates(
    client: &Client,
    base_url: &str,
    token: &str,
    buf: &str,
) -> Result<GetUpdatesResp, String> {
    perform_get_updates(client, base_url, token, buf, LONG_POLL_TIMEOUT, true).await
}

pub async fn probe_updates(
    client: &Client,
    base_url: &str,
    token: &str,
    buf: &str,
) -> Result<GetUpdatesResp, String> {
    perform_get_updates(client, base_url, token, buf, PROBE_TIMEOUT, true).await
}

pub async fn send_message(
    client: &Client,
    base_url: &str,
    token: &str,
    to_user_id: &str,
    context_token: &str,
    text: &str,
) -> Result<String, String> {
    let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
    let body = SendMessageReqBody {
        msg: SendMessageMsg {
            from_user_id: String::new(),
            to_user_id: to_user_id.to_string(),
            client_id: Uuid::new_v4().simple().to_string(),
            context_token: context_token.to_string(),
            message_type: 2,
            message_state: 2,
            item_list: vec![SendMessageItem {
                type_: 1,
                text_item: SendTextItem {
                    text: text.to_string(),
                },
            }],
        },
        base_info: base_info(),
    };

    let response = client
        .post(&url)
        .headers(build_headers(token)?)
        .json(&body)
        .timeout(API_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: sendmessage HTTP {}: {}",
            status, body
        ));
    }
    Ok(Uuid::new_v4().to_string())
}

pub async fn fetch_qrcode(client: &Client, base_url: &str) -> Result<QrCodeResp, String> {
    let url = format!(
        "{}/ilink/bot/get_bot_qrcode?bot_type=3",
        base_url.trim_end_matches('/')
    );
    let response = client
        .get(&url)
        .timeout(API_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: get_bot_qrcode HTTP {}",
            response.status()
        ));
    }
    response.json::<QrCodeResp>().await.map_err(|error| {
        format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: get_bot_qrcode invalid JSON: {error}")
    })
}

pub async fn poll_qr_status(
    client: &Client,
    base_url: &str,
    qrcode: &str,
) -> Result<QrStatusResp, String> {
    let url = format!(
        "{}/ilink/bot/get_qrcode_status?qrcode={}",
        base_url.trim_end_matches('/'),
        qrcode
    );
    let response = client
        .get(&url)
        .header("iLink-App-ClientVersion", "1")
        .timeout(LONG_POLL_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: get_qrcode_status HTTP {}",
            response.status()
        ));
    }
    response.json::<QrStatusResp>().await.map_err(|error| {
        format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: get_qrcode_status invalid JSON: {error}")
    })
}
