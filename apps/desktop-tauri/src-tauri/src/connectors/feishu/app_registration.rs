use reqwest::Client;
use serde::Deserialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use tracing::warn;

use super::types::{FeishuDomain, FeishuQrLoginBeginResult, FeishuQrLoginSuccessResult};

const FEISHU_ACCOUNTS_URL: &str = "https://accounts.feishu.cn";
const LARK_ACCOUNTS_URL: &str = "https://accounts.larksuite.com";
const REGISTRATION_PATH: &str = "/oauth/v1/app/registration";
const REQUEST_TIMEOUT_SECS: u64 = 10;

fn accounts_base_url(domain: FeishuDomain) -> &'static str {
    match domain {
        FeishuDomain::Feishu => FEISHU_ACCOUNTS_URL,
        FeishuDomain::Lark => LARK_ACCOUNTS_URL,
    }
}

#[derive(Debug, Deserialize)]
struct InitResponse {
    #[serde(default)]
    nonce: Option<String>,
    #[serde(default, rename = "supported_auth_methods")]
    supported_auth_methods: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RawBeginResponse {
    device_code: String,
    verification_uri: String,
    user_code: String,
    verification_uri_complete: String,
    #[serde(default)]
    interval: Option<u32>,
    #[serde(default, rename = "expire_in")]
    expire_in: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PollResponse {
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    client_secret: Option<String>,
    #[serde(default)]
    user_info: Option<PollUserInfo>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PollUserInfo {
    open_id: Option<String>,
    tenant_brand: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TenantAccessTokenResponse {
    #[serde(default)]
    tenant_access_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BotInfoEnvelope {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    bot: Option<BotInfoPayload>,
}

#[derive(Debug, Deserialize)]
struct BotInfoPayload {
    #[serde(default)]
    activate_status: Option<i64>,
    #[serde(default)]
    app_name: Option<String>,
    #[serde(default)]
    open_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

async fn post_registration<T: serde::de::DeserializeOwned>(
    client: &Client,
    domain: FeishuDomain,
    params: &[(&str, &str)],
) -> Result<T, String> {
    let base_url = accounts_base_url(domain);
    let url = format!("{}{}", base_url, REGISTRATION_PATH);
    let body = params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let response = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("FEISHU_QR_NETWORK: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("FEISHU_QR_NETWORK: {e}"))?;

    // Feishu returns 400 for pending/error states with JSON body — still valid
    if !status.is_success() && status.as_u16() != 400 {
        return Err(format!(
            "FEISHU_QR_NETWORK: HTTP {} - {}",
            status,
            &text[..text.len().min(200)]
        ));
    }

    serde_json::from_str::<T>(&text).map_err(|e| {
        format!(
            "FEISHU_QR_PARSE: {e} - body: {}",
            &text[..text.len().min(200)]
        )
    })
}

pub async fn init_app_registration(domain: FeishuDomain) -> Result<(), String> {
    let client = Client::new();
    let res: InitResponse = post_registration(&client, domain, &[("action", "init")]).await?;
    if !res
        .supported_auth_methods
        .contains(&"client_secret".to_string())
    {
        return Err(
            "FEISHU_QR_UNSUPPORTED: Current environment does not support client_secret auth method"
                .to_string(),
        );
    }
    Ok(())
}

pub async fn begin_app_registration(
    domain: FeishuDomain,
) -> Result<FeishuQrLoginBeginResult, String> {
    let client = Client::new();
    let res: RawBeginResponse = post_registration(&client, domain, &[
        ("action", "begin"),
        ("archetype", "PersonalAgent"),
        ("auth_method", "client_secret"),
        ("request_user_info", "open_id"),
    ])
    .await?;

    let mut qr_url = res.verification_uri_complete;
    if !qr_url.contains("from=") {
        let separator = if qr_url.contains('?') { '&' } else { '?' };
        qr_url = format!("{}{}from=gtoffice&tp=ob_cli_app", qr_url, separator);
    }

    Ok(FeishuQrLoginBeginResult {
        device_code: res.device_code,
        qr_url,
        user_code: res.user_code,
        interval: res.interval.unwrap_or(5),
        expire_in: res.expire_in.unwrap_or(600),
    })
}

pub async fn poll_app_registration(
    app: AppHandle,
    domain: FeishuDomain,
    device_code: String,
    interval_secs: u32,
    expire_in_secs: u32,
    cancel: CancellationToken,
) -> Result<FeishuQrLoginSuccessResult, String> {
    let client = Client::new();
    let deadline = Instant::now() + Duration::from_secs(expire_in_secs as u64);
    let mut current_interval = interval_secs;
    let mut current_domain = domain;
    let mut domain_switched = false;
    let mut attempt: u32 = 0;

    while Instant::now() < deadline {
        if cancel.is_cancelled() {
            let _ = app.emit("feishu-qr/expired", serde_json::json!({}));
            return Err("FEISHU_QR_CANCELLED: Login cancelled".to_string());
        }

        attempt += 1;
        let _ = app.emit(
            "feishu-qr/polling",
            serde_json::json!({ "attempt": attempt }),
        );

        let poll_res: PollResponse = match post_registration(&client, current_domain, &[
            ("action", "poll"),
            ("device_code", &device_code),
            ("tp", "ob_app"),
        ])
        .await
        {
            Ok(res) => res,
            Err(e) => {
                warn!("Feishu QR poll network error: {e}");
                tokio::time::sleep(Duration::from_secs(current_interval as u64)).await;
                continue;
            }
        };

        // Domain auto-detection: switch to lark if tenant_brand says so
        if let Some(ref user_info) = poll_res.user_info {
            if let Some(ref brand) = user_info.tenant_brand {
                if brand == "lark" && !domain_switched {
                    current_domain = FeishuDomain::Lark;
                    domain_switched = true;
                    continue;
                }
            }
        }

        // Success
        if let (Some(client_id), Some(client_secret)) =
            (&poll_res.client_id, &poll_res.client_secret)
        {
            let mut result = FeishuQrLoginSuccessResult {
                app_id: client_id.clone(),
                app_secret: client_secret.clone(),
                domain: if current_domain == FeishuDomain::Lark {
                    "lark".to_string()
                } else {
                    "feishu".to_string()
                },
                bot_name: None,
                open_id: poll_res.user_info.as_ref().and_then(|u| u.open_id.clone()),
            };

            // Try to fetch bot info
            if let Ok(Some(bot_name)) =
                fetch_bot_info(&client, current_domain, client_id, client_secret).await
            {
                result.bot_name = Some(bot_name);
            }

            // Emit success event WITHOUT app_secret (security)
            let _ = app.emit(
                "feishu-qr/success",
                serde_json::json!({
                    "appId": result.app_id,
                    "domain": result.domain,
                    "botName": result.bot_name,
                    "openId": result.open_id,
                }),
            );
            return Ok(result);
        }

        // Error handling
        if let Some(ref error) = poll_res.error {
            match error.as_str() {
                "authorization_pending" => {}
                "slow_down" => {
                    current_interval += 5;
                }
                "access_denied" => {
                    let _ = app.emit(
                        "feishu-qr/error",
                        serde_json::json!({ "message": "FEISHU_QR_DENIED: User denied authorization" }),
                    );
                    return Err("FEISHU_QR_DENIED: User denied authorization".to_string());
                }
                "expired_token" => {
                    let _ = app.emit("feishu-qr/expired", serde_json::json!({}));
                    return Err("FEISHU_QR_EXPIRED: QR code expired".to_string());
                }
                other => {
                    let msg = format!(
                        "FEISHU_QR_ERROR: {} - {}",
                        other,
                        poll_res.error_description.as_deref().unwrap_or("unknown")
                    );
                    let _ = app.emit("feishu-qr/error", serde_json::json!({ "message": &msg }));
                    return Err(msg);
                }
            }
        }

        tokio::time::sleep(Duration::from_secs(current_interval as u64)).await;
    }

    let _ = app.emit("feishu-qr/expired", serde_json::json!({}));
    Err("FEISHU_QR_EXPIRED: QR code timed out".to_string())
}

async fn fetch_bot_info(
    client: &Client,
    domain: FeishuDomain,
    app_id: &str,
    app_secret: &str,
) -> Result<Option<String>, String> {
    let base = match domain {
        FeishuDomain::Feishu => "https://open.feishu.cn",
        FeishuDomain::Lark => "https://open.larksuite.com",
    };

    // Get tenant access token
    let token_res: TenantAccessTokenResponse = client
        .post(format!(
            "{}/open-apis/auth/v3/tenant_access_token/internal",
            base
        ))
        .json(&serde_json::json!({
            "app_id": app_id,
            "app_secret": app_secret,
        }))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("FEISHU_QR_NETWORK: {e}"))?
        .json()
        .await
        .map_err(|e| format!("FEISHU_QR_PARSE: {e}"))?;

    let token = match token_res.tenant_access_token {
        Some(t) => t,
        None => return Ok(None),
    };

    // Get bot info
    let info_res: BotInfoEnvelope = client
        .get(format!("{}/open-apis/bot/v3/info", base))
        .header("Authorization", format!("Bearer {}", token))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("FEISHU_QR_NETWORK: {e}"))?
        .json()
        .await
        .map_err(|e| format!("FEISHU_QR_PARSE: {e}"))?;

    if info_res.code != 0 {
        return Ok(None);
    }

    let bot = match info_res.bot {
        Some(b) => b,
        None => return Ok(None),
    };

    // Prefer bot name over app_name
    let bot_name = bot
        .name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| {
            bot.app_name
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        });

    Ok(bot_name)
}