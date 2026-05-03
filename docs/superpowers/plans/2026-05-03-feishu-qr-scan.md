# Feishu QR Scan Connection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual App ID/Secret entry for Feishu connection with a one-scan QR code flow that auto-creates a self-built app via Feishu's OAuth Device Authorization Grant.

**Architecture:** Rust backend handles the OAuth device-code flow (init → begin → poll) and emits Tauri events for progress. Frontend renders the QR code and subscribes to events. On success, the backend auto-saves credentials and starts the WebSocket connection.

**Tech Stack:** Rust (reqwest, qrcode, tokio, serde), TypeScript/React (qrcode.react, @tauri-apps/api), Tauri events.

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `apps/desktop-tauri/src-tauri/src/connectors/feishu/app_registration.rs` | OAuth device-code flow: init, begin, poll; QR URL generation; domain auto-detect |
| `apps/desktop-web/src/features/tool-adapter/feishu/FeishuQrScan.tsx` | QR scan UI component with state machine (idle → loading → scanning → success/error) |

### Modified Files
| File | Change |
|---|---|
| `apps/desktop-tauri/src-tauri/src/connectors/feishu/mod.rs` | Add `mod app_registration;`, expose `qr_login_start`, `qr_login_cancel` |
| `apps/desktop-tauri/src-tauri/src/connectors/feishu/types.rs` | Add `FeishuQrLoginBeginResult`, `FeishuQrLoginSuccessResult` types |
| `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs` | Add request types and `feishu_qr_login_start`, `feishu_qr_login_cancel` commands |
| `apps/desktop-tauri/src-tauri/src/lib.rs` | Register 2 new commands in `generate_handler!` |
| `apps/desktop-web/src/shell/integration/desktop-api.ts` | Add `FeishuQrLoginBeginResult` type, `feishuQrLoginStart`, `feishuQrLoginCancel` methods |
| `apps/desktop-web/src/features/tool-adapter/feishu/FeishuConnectorWizard.tsx` | Replace Step 0 manual form with `FeishuQrScan`, update guide content |
| `apps/desktop-web/src/features/tool-adapter/feishu/model.ts` | Remove `appSecret` from form, update guide states for QR flow |
| `apps/desktop-web/src/features/tool-adapter/feishu/FeishuPlatformGuide.tsx` | No direct changes (receives guide state from wizard) |
| `apps/desktop-web/src/features/tool-adapter/feishu/index.ts` | Replace `FeishuAccountForm` export with `FeishuQrScan` export |

### Deleted Files
| File | Reason |
|---|---|
| `apps/desktop-web/src/features/tool-adapter/feishu/FeishuAccountForm.tsx` | Replaced by QR scan flow; no manual credential entry needed |

### New Dependency
| Package | Location | Purpose |
|---|---|---|
| `qrcode.react` | `apps/desktop-web/package.json` | Render QR code SVG in React component |

---

## Task 1: Add Rust types for QR login flow

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/types.rs`

- [ ] **Step 1: Add the new types to `types.rs`**

Append after the existing `FeishuSendSnapshot` struct (around line 133):

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuQrLoginBeginResult {
    pub device_code: String,
    pub qr_url: String,
    pub user_code: String,
    pub interval: u32,
    pub expire_in: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuQrLoginSuccessResult {
    pub app_id: String,
    pub domain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_id: Option<String>,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5`
Expected: Compilation succeeds (may have unused warnings, no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/feishu/types.rs
git commit -m "feat(feishu): add QR login result types for device-code flow"
```

---

## Task 2: Implement Rust app_registration module

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/connectors/feishu/app_registration.rs`

- [ ] **Step 1: Create `app_registration.rs`**

This module implements the OAuth Device Authorization Grant against Feishu's accounts API. It follows the same patterns as OpenClaw's `app-registration.ts` but in Rust using `reqwest`.

```rust
use reqwest::Client;
use serde::Deserialize;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::CancellationToken;
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
struct AppInfoResponse {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    data: Option<AppInfoData>,
}

#[derive(Debug, Deserialize)]
struct AppInfoData {
    #[serde(default)]
    app: Option<AppInfoApp>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct AppInfoApp {
    owner: Option<AppOwner>,
    creator_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AppOwner {
    owner_id: Option<String>,
    owner_type: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QrLoginEvent {
    Polling { attempt: u32 },
    Success { result: FeishuQrLoginSuccessResult },
    Error { message: String },
    Expired,
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

    if !status.is_success() && status.as_u16() != 400 {
        return Err(format!(
            "FEISHU_QR_NETWORK: HTTP {} - {}",
            status, text
        ));
    }

    serde_json::from_str::<T>(&text)
        .map_err(|e| format!("FEISHU_QR_PARSE: {e} - body: {}", &text[..text.len().min(200)]))
}

pub async fn init_app_registration(domain: FeishuDomain) -> Result<(), String> {
    let client = Client::new();
    let res: InitResponse = post_registration(&client, domain, &[("action", "init")]).await?;
    if !res.supported_auth_methods.contains(&"client_secret".to_string()) {
        return Err("FEISHU_QR_UNSUPPORTED: Current environment does not support client_secret auth method".to_string());
    }
    Ok(())
}

pub async fn begin_app_registration(domain: FeishuDomain) -> Result<FeishuQrLoginBeginResult, String> {
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

        if let Some(ref user_info) = poll_res.user_info {
            if let Some(ref brand) = user_info.tenant_brand {
                if brand == "lark" && !domain_switched {
                    current_domain = FeishuDomain::Lark;
                    domain_switched = true;
                    continue;
                }
            }
        }

        if let (Some(client_id), Some(client_secret)) = (&poll_res.client_id, &poll_res.client_secret) {
            let mut result = FeishuQrLoginSuccessResult {
                app_id: client_id.clone(),
                domain: if current_domain == FeishuDomain::Lark { "lark".to_string() } else { "feishu".to_string() },
                bot_name: None,
                open_id: poll_res.user_info.as_ref().and_then(|u| u.open_id.clone()),
            };

            // Try to fetch bot name
            if let Ok(bot_info) = fetch_bot_info(&client, current_domain, client_id, client_secret).await {
                result.bot_name = bot_info;
            }

            let _ = app.emit("feishu-qr/success", serde_json::to_string(&result).unwrap_or_default());
            return Ok(result);
        }

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
                    let msg = format!("FEISHU_QR_ERROR: {} - {}", other, poll_res.error_description.as_deref().unwrap_or("unknown"));
                    let _ = app.emit(
                        "feishu-qr/error",
                        serde_json::json!({ "message": msg }),
                    );
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

    let token_res: TenantAccessTokenResponse = client
        .post(format!("{}/open-apis/auth/v3/tenant_access_token/internal", base))
        .json(&serde_json::json!({ "app_id": app_id, "app_secret": app_secret }))
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

    let info_res: AppInfoResponse = client
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

    let app = match info_res.data.and_then(|d| d.app) {
        Some(a) => a,
        None => return Ok(None),
    };

    // Try owner name first, then bot name from Feishu SDK
    Ok(app.owner.and_then(|o| o.owner_id).or(app.creator_id))
}
```

- [ ] **Step 2: Add the module declaration and public wrappers in `mod.rs`**

In `apps/desktop-tauri/src-tauri/src/connectors/feishu/mod.rs`, add after line 6 (`pub mod websocket;`):

```rust
mod app_registration;
```

Then, add two public wrapper functions. After the existing public functions (around line 290, before the closing of the file), add:

```rust
pub fn qr_login_start(
    app: &AppHandle,
    domain: FeishuDomain,
) -> Result<FeishuQrLoginBeginResult, String> {
    let app_handle = app.clone();
    // We run init + begin synchronously (they are fast HTTP calls)
    // and spawn the polling task in background
    Ok(FeishuQrLoginBeginResult::default()) // placeholder — real impl in Task 3
}

pub fn qr_login_cancel() -> Result<(), String> {
    // Will be implemented in Task 3 with cancellation token
    Ok(())
}
```

**Note:** The actual implementations with background polling will be in Task 3. For now, just add the module import.

Actually, let me revise: we should only add the `mod app_registration;` line in this task. The public wrappers and command wiring come in Task 3 and 4.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5`

**Important:** If `urlencoding` is not already a dependency, add it to `Cargo.toml`. Check first:

Run: `cd /Users/dzlin/work/GT-Office && grep "urlencoding" apps/desktop-tauri/src-tauri/Cargo.toml`

If not found, add to `apps/desktop-tauri/src-tauri/Cargo.toml`:
```toml
urlencoding = "2"
```

Expected: Compilation succeeds (unused warnings OK, no errors)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/feishu/app_registration.rs apps/desktop-tauri/src-tauri/src/connectors/feishu/mod.rs apps/desktop-tauri/src-tauri/Cargo.toml
git commit -m "feat(feishu): add app_registration module for OAuth device-code flow"
```

---

## Task 3: Add QR login orchestration with background polling

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/mod.rs`

This task adds the state management for QR login sessions, including:
- A global `OnceLock<RwLock<Option<QrLoginSession>>>` to track the active session
- Background task spawning for the poll loop
- Cancellation token support

- [ ] **Step 1: Add QR login session state and wrappers to `mod.rs`**

In `apps/desktop-tauri/src-tauri/src/connectors/feishu/mod.rs`, add after the imports section (around line 22, after the existing `use` statements):

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::CancellationToken;
use tokio::task::JoinHandle;

struct QrLoginSession {
    cancel: CancellationToken,
    handle: JoinHandle<()>,
}

static QR_LOGIN_SESSION: OnceLock<Mutex<Option<QrLoginSession>>> = OnceLock::new();

fn qr_login_sessions() -> &'static Mutex<Option<QrLoginSession>> {
    QR_LOGIN_SESSION.get_or_init(|| Mutex::new(None))
}
```

Then add the two public wrapper functions. Find the `pub fn now_ms()` function (around line 23) and add before or after the module-level functions:

```rust
pub async fn qr_login_start(
    app: AppHandle,
    state: &AppState,
    domain: FeishuDomain,
) -> Result<FeishuQrLoginBeginResult, String> {
    // Cancel any existing session
    if let Ok(mut guard) = qr_login_sessions().lock() {
        if let Some(session) = guard.take() {
            session.cancel.cancel();
            let _ = session.handle.await;
        }
    }

    // Init: verify environment supports client_secret
    app_registration::init_app_registration(domain).await?;

    // Begin: get device code and QR URL
    let begin_result = app_registration::begin_app_registration(domain).await?;

    // Store for polling
    let device_code = begin_result.device_code.clone();
    let interval = begin_result.interval;
    let expire_in = begin_result.expire_in;
    let cancel = CancellationToken::new();
    let cancel_clone = cancel.clone();
    let app_clone = app.clone();

    let handle = tokio::spawn(async move {
        let result = app_registration::poll_app_registration(
            app_clone,
            domain,
            device_code,
            interval,
            expire_in,
            cancel_clone,
        )
        .await;

        match result {
            Ok(success) => {
                // Auto-save account and reconcile
                if let Err(e) = upsert_account(
                    &app,
                    FeishuAccountUpsertInput {
                        account_id: Some("default".to_string()),
                        enabled: Some(true),
                        connection_mode: Some(FeishuConnectionMode::Websocket),
                        domain: Some(domain),
                        app_id: Some(success.app_id.clone()),
                        app_secret: Some(success.app_secret().to_string()),
                        ..Default::default()
                    },
                ) {
                    let _ = app.emit(
                        "feishu-qr/error",
                        serde_json::json!({ "message": format!("Failed to save account: {e}") }),
                    );
                    return;
                }
                let state_inner = state.inner().clone();
                websocket::reconcile(&app, &state_inner);
            }
            Err(_) => {
                // Error already emitted inside poll_app_registration
            }
        }

        // Clear session
        if let Ok(mut guard) = qr_login_sessions().lock() {
            *guard = None;
        }
    });

    // Store session
    if let Ok(mut guard) = qr_login_sessions().lock() {
        *guard = Some(QrLoginSession { cancel, handle });
    }

    Ok(begin_result)
}

pub fn qr_login_cancel() -> Result<(), String> {
    if let Ok(mut guard) = qr_login_sessions().lock() {
        if let Some(session) = guard.take() {
            session.cancel.cancel();
            // Don't await — let the task clean up in background
        }
    }
    Ok(())
}
```

**Important:** The `FeishuAccountUpsertInput` needs `Default` derived. Check if it already has `Default`. If not, add `#[derive(Default)]` to it in `types.rs` and set all fields to `Option<T>` with `#[serde(default)]` (which they already are).

Also, the `upsert_account` function returns `Result<FeishuConnectorAccountView, String>` and takes `FeishuAccountUpsertInput`. The `app_secret` is not directly available from `FeishuQrLoginSuccessResult` — we need to add it. **Revise `FeishuQrLoginSuccessResult`** to include `app_secret`:

Update Task 1's type to:
```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuQrLoginSuccessResult {
    pub app_id: String,
    pub app_secret: String,
    pub domain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_id: Option<String>,
}
```

And in `app_registration.rs`, update the success path in `poll_app_registration` to include `app_secret`:

```rust
let result = FeishuQrLoginSuccessResult {
    app_id: client_id.clone(),
    app_secret: client_secret.clone(),
    domain: if current_domain == FeishuDomain::Lark { "lark".to_string() } else { "feishu".to_string() },
    bot_name: None,
    open_id: poll_res.user_info.as_ref().and_then(|u| u.open_id.clone()),
};
```

The Tauri event `feishu-qr/success` should NOT include `app_secret` in the payload sent to the frontend (security). Only `app_id`, `domain`, `bot_name`, `open_id`.

Update the emit in `poll_app_registration`:
```rust
let _ = app.emit("feishu-qr/success", serde_json::json!({
    "appId": result.app_id,
    "domain": result.domain,
    "botName": result.bot_name,
    "openId": result.open_id,
}));
```

In the `qr_login_start` function above, the `upsert_account` call should pass `app_secret: Some(success.app_secret.clone())` since the full result is available in the backend.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5`

Expected: Compilation succeeds (unused warnings OK)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/feishu/
git commit -m "feat(feishu): add QR login orchestration with background polling and cancellation"
```

---

## Task 4: Add Tauri commands and register them

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs`

- [ ] **Step 1: Add request types in `commands/tool_adapter/mod.rs`**

After the existing WeChat auth request types (around line 171), add:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuQrLoginStartRequest {
    #[serde(default)]
    pub domain: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuQrLoginCancelRequest {}
```

- [ ] **Step 2: Add command functions**

After the `channel_connector_wechat_auth_cancel` command (around line 3379), add:

```rust
#[tauri::command]
pub async fn feishu_qr_login_start(
    request: FeishuQrLoginStartRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let domain = match request.domain.as_deref() {
        Some("lark") => FeishuDomain::Lark,
        _ => FeishuDomain::Feishu,
    };
    let result = feishu::qr_login_start(app, state.inner(), domain).await?;
    Ok(json!({
        "channel": "feishu",
        "result": result,
    }))
}

#[tauri::command]
pub fn feishu_qr_login_cancel(
    _request: FeishuQrLoginCancelRequest,
) -> Result<Value, String> {
    feishu::qr_login_cancel()?;
    Ok(json!({ "channel": "feishu", "cancelled": true }))
}
```

Make sure the `use` statements at the top of the file include `FeishuDomain` (it should already be imported from the feishu types since the file uses `feishu::types::FeishuDomain` or similar).

- [ ] **Step 3: Register commands in `lib.rs`**

In `apps/desktop-tauri/src-tauri/src/lib.rs`, after the `channel_connector_wechat_auth_cancel` line (around line 227), add:

```rust
tool_adapter::feishu_qr_login_start,
tool_adapter::feishu_qr_login_cancel,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -5`

Expected: Compilation succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs apps/desktop-tauri/src-tauri/src/lib.rs
git commit -m "feat(feishu): add Tauri commands for QR login start and cancel"
```

---

## Task 5: Add frontend types and API methods

**Files:**
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`

- [ ] **Step 1: Add the `FeishuQrLoginBeginResult` type**

After the `WechatAuthSession` interface (around line 1925), add:

```typescript
export interface FeishuQrLoginBeginResult {
  deviceCode: string
  qrUrl: string
  userCode: string
  interval: number
  expireIn: number
}
```

- [ ] **Step 2: Add the API methods**

After the `channelConnectorWechatAuthCancel` method (around line 2843), add:

```typescript
feishuQrLoginStart(domain?: string | null) {
  return invokeCommand<{ channel: string; result: FeishuQrLoginBeginResult }>(
    'feishu_qr_login_start',
    {
      request: {
        domain: domain ?? null,
      },
    },
  )
},

feishuQrLoginCancel() {
  return invokeCommand<{ channel: string; cancelled: boolean }>(
    'feishu_qr_login_cancel',
    {
      request: {},
    },
  )
},
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-web && npx tsc --noEmit 2>&1 | tail -10`

Expected: No type errors related to the new types/methods

- [ ] **Step 4: Commit**

```bash
git add apps/desktop-web/src/shell/integration/desktop-api.ts
git commit -m "feat(feishu): add frontend types and API methods for QR login"
```

---

## Task 6: Create FeishuQrScan component

**Files:**
- Create: `apps/desktop-web/src/features/tool-adapter/feishu/FeishuQrScan.tsx`

This component implements the QR scan state machine: idle → loading → scanning → success/error.

- [ ] **Step 1: Install qrcode.react dependency**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-web && npm install qrcode.react`

- [ ] **Step 2: Create `FeishuQrScan.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { desktopApi } from '@shell/integration/desktop-api'

type QrScanState = 'idle' | 'loading' | 'scanning' | 'success' | 'error'

interface QrScanResult {
  appId: string
  domain: string
  botName?: string | null
  openId?: string | null
}

interface FeishuQrScanProps {
  locale: Locale
  onSuccess: (result: QrScanResult) => void
  onError: (message: string) => void
}

export function FeishuQrScan({ locale, onSuccess, onError }: FeishuQrScanProps) {
  const [scanState, setScanState] = useState<QrScanState>('idle')
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [expireIn, setExpireIn] = useState(0)
  const [remainingSec, setRemainingSec] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const timerRef = useRef<ReturnType<typeof window.setInterval> | null>(null)

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [])

  useEffect(() => {
    if (scanState === 'scanning' && expireIn > 0) {
      const start = Date.now()
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000)
        const remaining = Math.max(0, expireIn - elapsed)
        setRemainingSec(remaining)
        if (remaining <= 0) {
          setScanState('error')
          setErrorMessage(t(locale, '二维码已过期，请重新扫码。', 'QR code expired. Please try again.'))
          cleanup()
        }
      }, 1000)
      return () => {
        if (timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
      }
    }
  }, [scanState, expireIn, locale])

  function cleanup() {
    unlistenRef.current.forEach((fn) => fn())
    unlistenRef.current = []
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    desktopApi.feishuQrLoginCancel().catch(() => {})
  }

  async function handleStartScan() {
    setScanState('loading')
    setErrorMessage(null)
    setAttempt(0)

    try {
      const response = await desktopApi.feishuQrLoginStart()
      setQrUrl(response.result.qrUrl)
      setExpireIn(response.result.expireIn)
      setRemainingSec(response.result.expireIn)
      setScanState('scanning')

      // Subscribe to Tauri events
      const { listen } = await import('@tauri-apps/api/event')

      const unlistenPolling = await listen<{ attempt: number }>('feishu-qr/polling', (event) => {
        setAttempt(event.payload.attempt)
      })

      const unlistenSuccess = await listen<QrScanResult>('feishu-qr/success', (event) => {
        setScanState('success')
        onSuccess(event.payload)
        unlistenRef.current.forEach((fn) => fn())
        unlistenRef.current = []
        if (timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
      })

      const unlistenError = await listen<{ message: string }>('feishu-qr/error', (event) => {
        setScanState('error')
        setErrorMessage(event.payload.message)
        onError(event.payload.message)
      })

      const unlistenExpired = await listen('feishu-qr/expired', () => {
        setScanState('error')
        setErrorMessage(t(locale, '二维码已过期，请重新扫码。', 'QR code expired. Please try again.'))
      })

      unlistenRef.current = [unlistenPolling, unlistenSuccess, unlistenError, unlistenExpired]
    } catch (error) {
      setScanState('error')
      const msg = error instanceof Error ? error.message : String(error)
      setErrorMessage(msg)
      onError(msg)
    }
  }

  function handleRetry() {
    cleanup()
    handleStartScan()
  }

  const formatRemaining = (sec: number) => {
    const min = Math.floor(sec / 60)
    const s = sec % 60
    return `${min}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="feishu-qr-scan">
      {scanState === 'idle' && (
        <div className="feishu-qr-scan-idle">
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={handleStartScan}
          >
            {t(locale, '扫码连接飞书', 'Scan QR to Connect')}
          </button>
          <p className="feishu-qr-scan-hint">
            {t(
              locale,
              '使用飞书或 Lark 扫描二维码，自动创建应用并连接。',
              'Scan with Feishu or Lark to auto-create an app and connect.',
            )}
          </p>
        </div>
      )}

      {scanState === 'loading' && (
        <div className="feishu-qr-scan-loading">
          <div className="feishu-qr-scan-spinner" />
          <p>{t(locale, '正在生成二维码...', 'Generating QR code...')}</p>
        </div>
      )}

      {scanState === 'scanning' && qrUrl && (
        <div className="feishu-qr-scan-scanning">
          <div className="feishu-qr-code-wrapper">
            <QRCodeSVG
              value={qrUrl}
              size={240}
              level="M"
              bgColor="#ffffff"
              fgColor="#0f172a"
            />
          </div>
          <p className="feishu-qr-scan-instruction">
            {t(
              locale,
              '请使用飞书/Lark 扫描二维码',
              'Scan the QR code with Feishu/Lark',
            )}
          </p>
          {attempt > 0 && (
            <p className="feishu-qr-scan-attempt">
              {t(locale, '等待扫码... (尝试 {n})', 'Waiting for scan... (attempt {n})', { n: attempt })}
            </p>
          )}
          <p className="feishu-qr-scan-timer">
            {t(locale, '剩余 {time}', '{time} remaining', { time: formatRemaining(remainingSec) })}
          </p>
        </div>
      )}

      {scanState === 'success' && (
        <div className="feishu-qr-scan-success">
          <div className="feishu-qr-scan-check">✓</div>
          <p>{t(locale, '连接成功！', 'Connected!')}</p>
        </div>
      )}

      {scanState === 'error' && (
        <div className="feishu-qr-scan-error">
          <p className="settings-channel-error">
            {errorMessage || t(locale, '连接失败，请重试。', 'Connection failed. Please try again.')}
          </p>
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={handleRetry}
          >
            {t(locale, '重新扫码', 'Retry Scan')}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-web && npx tsc --noEmit 2>&1 | tail -10`

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop-web/src/features/tool-adapter/feishu/FeishuQrScan.tsx apps/desktop-web/package.json apps/desktop-web/package-lock.json
git commit -m "feat(feishu): add FeishuQrScan component with QR code display"
```

---

## Task 7: Update FeishuConnectorWizard to use QR scan

**Files:**
- Modify: `apps/desktop-web/src/features/tool-adapter/feishu/FeishuConnectorWizard.tsx`
- Modify: `apps/desktop-web/src/features/tool-adapter/feishu/model.ts`
- Modify: `apps/desktop-web/src/features/tool-adapter/feishu/index.ts`
- Delete: `apps/desktop-web/src/features/tool-adapter/feishu/FeishuAccountForm.tsx`

- [ ] **Step 1: Update `model.ts` — remove `appSecret` from form, update guide states**

Remove `appSecret` from `FeishuWizardForm` interface (line 17). The form should look like:

```typescript
export interface FeishuWizardForm {
  accountId: string
  domain: FeishuDomain
  appId: string
  peerKind: RoutePeerKind
  peerPattern: string
  targetBindingType: RouteTargetBindingType
  targetRoleKey: string
  targetAgentId: string
  priority: number
  policyMode: ExternalAccessPolicyMode
  approveIdentities: string
}
```

Remove `appSecret` from `buildFeishuDefaultForm` return values (both the `editingBinding` branch and the default branch). Remove `appSecret: ''` lines.

Update `buildGuideState` for step 0 to reflect QR scan flow:

```typescript
case 0:
  return {
    eyebrow: t(locale, 'Step 1', 'Step 1'),
    title: t(locale, '扫码连接飞书', 'Scan QR to Connect'),
    summary: t(
      locale,
      '使用飞书或 Lark 扫描二维码，GT Office 将自动创建应用并建立长连接。无需手动创建应用或填写凭据。',
      'Scan the QR code with Feishu or Lark. GT Office will auto-create the app and establish a long connection. No manual app creation or credential entry needed.',
    ),
    platformLabel: platform,
    platformUrl,
    note: t(
      locale,
      '扫码后请耐心等待，应用创建和连接建立是自动完成的。',
      'Please wait after scanning — app creation and connection are automatic.',
    ),
    checklist: [
      t(locale, '点击"扫码连接飞书"', 'Click "Scan QR to Connect"'),
      t(locale, '用飞书/Lark 扫描二维码', 'Scan the QR code with Feishu/Lark'),
      t(locale, '等待 GT Office 显示"已连接"', 'Wait for GT Office to show "Connected"'),
    ],
  }
```

- [ ] **Step 2: Update `FeishuConnectorWizard.tsx` — replace Step 0**

Remove the import of `FeishuAccountForm` (line 12). Add import of `FeishuQrScan`:

```typescript
import { FeishuQrScan } from './FeishuQrScan'
```

Add a `qrScanResult` state after the existing state declarations (around line 119):

```typescript
const [qrScanResult, setQrScanResult] = useState<{ appId: string; domain: string } | null>(null)
```

Add the QR scan success handler, after the `updateField` function (around line 167):

```typescript
const handleQrScanSuccess = (result: { appId: string; domain: string }) => {
  setForm((prev) => ({
    ...prev,
    appId: result.appId,
    domain: result.domain as FeishuDomain,
  }))
  setQrScanResult(result)
  setConnectionTestPassed(true)
  setStatusMessage(
    t(
      locale,
      '飞书长连接已建立。现在回到开放平台保存"使用长连接接收事件"。',
      'Feishu long connection is now established. Return to Open Platform and save "use long connection to receive events".',
    ),
  )
}

const handleQrScanError = (message: string) => {
  setErrorMessage(
    t(locale, '扫码连接失败：{detail}', 'QR scan connection failed: {detail}', {
      detail: message,
    }),
  )
}
```

Replace the Step 0 content (lines 337-358). Instead of the `FeishuAccountForm` and test connection button, use:

```tsx
{wizardStep === 0 && (
  <div className="settings-pane-section feishu-step-section">
    <p className="channel-wizard-step-label">{t(locale, 'Step 1 — 扫码连接', 'Step 1 — Scan QR to Connect')}</p>

    {connectionTestPassed && qrScanResult ? (
      <FeishuHealthCard locale={locale} health={healthSnapshot} />
    ) : (
      <FeishuQrScan
        locale={locale}
        onSuccess={handleQrScanSuccess}
        onError={handleQrScanError}
      />
    )}

    {statusMessage && <div className="settings-channel-message">{statusMessage}</div>}
    {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}
  </div>
)}
```

Remove the `testConnection` function (lines 195-246) since it's no longer needed — the QR scan auto-triggers connection.

Also remove the `persistConnectorAccount` function (lines 169-179) since the backend auto-saves credentials after QR scan success.

Update `canGoNext` for step 0:

```typescript
const canGoNext = useMemo(() => {
  switch (wizardStep) {
    case 0:
      return connectionTestPassed && !!qrScanResult
    default:
      return platformSubscriptionConfirmed
  }
}, [connectionTestPassed, qrScanResult, platformSubscriptionConfirmed, wizardStep])
```

In the `applyWizard` function (around line 248), remove the `persistConnectorAccount()` call since the account is already saved. The function should start directly with the workspace check and then the binding upsert.

- [ ] **Step 3: Update `index.ts` — replace FeishuAccountForm export with FeishuQrScan**

```typescript
export * from './FeishuQrScan'
export * from './FeishuConnectorWizard'
export * from './FeishuHealthCard'
export * from './FeishuPlatformGuide'
export * from './model'
```

- [ ] **Step 4: Delete `FeishuAccountForm.tsx`**

```bash
rm apps/desktop-web/src/features/tool-adapter/feishu/FeishuAccountForm.tsx
```

- [ ] **Step 5: Verify TypeScript compiles and fix any remaining references**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-web && npx tsc --noEmit 2>&1 | head -30`

Fix any import errors or references to `FeishuAccountForm` or `appSecret` that remain.

- [ ] **Step 6: Commit**

```bash
git add -A apps/desktop-web/src/features/tool-adapter/feishu/
git commit -m "feat(feishu): replace manual credential form with QR scan wizard step"
```

---

## Task 8: Add QR scan styles

**Files:**
- Modify: the existing feishu SCSS file or the relevant stylesheet

- [ ] **Step 1: Add QR scan component styles**

Find the existing feishu styles file (likely in the same directory or a shared styles directory) and add:

```scss
.feishu-qr-scan {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 0;
}

.feishu-qr-scan-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.feishu-qr-scan-hint {
  font-size: 0.875rem;
  color: var(--vb-text-secondary);
  text-align: center;
  max-width: 20rem;
}

.feishu-qr-scan-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;

  p {
    color: var(--vb-text-secondary);
  }
}

.feishu-qr-scan-spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--vb-border);
  border-top-color: var(--vb-primary);
  border-radius: 50%;
  animation: feishu-qr-spin 0.8s linear infinite;
}

@keyframes feishu-qr-spin {
  to { transform: rotate(360deg); }
}

.feishu-qr-scan-scanning {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.feishu-qr-code-wrapper {
  padding: 1rem;
  background: #ffffff;
  border-radius: 0.5rem;
  border: 1px solid var(--vb-border);
}

.feishu-qr-scan-instruction {
  font-size: 0.9375rem;
  font-weight: 500;
  text-align: center;
}

.feishu-qr-scan-attempt {
  font-size: 0.8125rem;
  color: var(--vb-text-secondary);
}

.feishu-qr-scan-timer {
  font-size: 0.8125rem;
  color: var(--vb-text-tertiary);
}

.feishu-qr-scan-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;

  .feishu-qr-scan-check {
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    background: var(--vb-success, #22c55e);
    color: #ffffff;
    font-size: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  p {
    font-weight: 500;
    color: var(--vb-success, #22c55e);
  }
}

.feishu-qr-scan-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "style(feishu): add QR scan component styles"
```

---

## Task 9: Update connection description in ChannelChooser

**Files:**
- Modify: `apps/desktop-web/src/features/tool-adapter/ChannelWizard.tsx`

- [ ] **Step 1: Update Feishu description text**

Find the Feishu entry in the `ChannelChooser` (around line 112-118) and update the description from "企业自建应用，分步引导完成 WebSocket 接入" to:

```typescript
description: t(
  locale,
  '扫码即可自动创建应用并连接，无需手动操作。',
  'Scan QR to auto-create app and connect. No manual setup needed.',
)
```

- [ ] **Step 2: Verify and commit**

```bash
git add apps/desktop-web/src/features/tool-adapter/ChannelWizard.tsx
git commit -m "feat(feishu): update channel description for QR scan flow"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Run Rust check**

Run: `cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 2: Run TypeScript check**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Run build check**

Run: `cd /Users/dzlin/work/GT-Office && npm run typecheck 2>&1 | tail -10`
Expected: Pass

- [ ] **Step 4: Manual testing checklist**

- [ ] Open the app, navigate to Channel Management
- [ ] Click "Add Channel" → Select "飞书 / Lark"
- [ ] Verify Step 0 shows "扫码连接飞书" button (no manual App ID/Secret fields)
- [ ] Click the button → verify QR code appears
- [ ] Verify the QR code is scannable and renders correctly
- [ ] Verify cancel works (navigate away or close modal)
- [ ] Verify Step 1 (route binding) is unchanged
- [ ] Verify Step 0 guide content reflects the QR flow

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(feishu): address e2e testing issues"
```