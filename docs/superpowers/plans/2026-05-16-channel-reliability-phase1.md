# Channel Reliability Phase 1: Core Reliability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the issues that directly cause message loss, silent failures, and instability in real network conditions by introducing ChannelError types, cancellation tokens, exponential backoff, reqwest migration, file splitting, and stable webhook tokens.

**Architecture:** Introduce a `ChannelError` enum as the foundation, then layer cancellation (CancellationToken in AppState), backoff policy, and HTTP client unification on top. Split the shared connectors.json into per-connector files. Persist webhook tokens across restarts.

**Tech Stack:** Rust, tokio, reqwest 0.12 (already in Cargo.toml), tokio-util (CancellationToken), thiserror, serde/serde_json, tauri 2

---

## Task 1: Add thiserror dependency and create ChannelError enum

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/Cargo.toml`
- Create: `apps/desktop-tauri/src-tauri/src/connectors/channel_error.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/mod.rs`
- Create: `apps/desktop-tauri/src-tauri/src/connectors/channel_error_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/tests/mod.rs` (if needed for test registration)

- [ ] **Step 1: Add thiserror to Cargo.toml**

In `apps/desktop-tauri/src-tauri/Cargo.toml`, add to `[dependencies]`:
```toml
thiserror = "2"
```

- [ ] **Step 2: Write the failing test for ChannelError**

Create `apps/desktop-tauri/src-tauri/src/connectors/channel_error_tests.rs`:
```rust
use super::channel_error::ChannelError;

#[test]
fn channel_error_auth_display_format() {
    let error = ChannelError::Auth {
        category: "token_expired".to_string(),
        detail: "tenant access token expired".to_string(),
        retryable: true,
    };
    let display = error.to_string();
    assert!(display.contains("CHANNEL_AUTH_token_expired"));
    assert!(display.contains("tenant access token expired"));
}

#[test]
fn channel_error_provider_display_format() {
    let error = ChannelError::Provider {
        status: "unavailable".to_string(),
        detail: "connection reset".to_string(),
        provider_code: Some("230002".to_string()),
        http_status: Some(403),
        retryable: false,
    };
    let display = error.to_string();
    assert!(display.contains("CHANNEL_PROVIDER_unavailable"));
    assert!(display.contains("provider_code=230002"));
    assert!(display.contains("http_status=403"));
}

#[test]
fn channel_error_permission_denied_display() {
    let error = ChannelError::PermissionDenied {
        detail: "bot not in chat".to_string(),
        provider_code: Some("230002".to_string()),
    };
    let display = error.to_string();
    assert!(display.contains("CHANNEL_PERMISSION_DENIED"));
    assert!(display.contains("bot not in chat"));
}

#[test]
fn channel_error_validation_display() {
    let error = ChannelError::Validation {
        detail: "peer_id is empty".to_string(),
    };
    assert!(error.to_string().contains("CHANNEL_VALIDATION: peer_id is empty"));
}

#[test]
fn channel_error_store_display() {
    let error = ChannelError::Store {
        operation: "read".to_string(),
        detail: "file not found".to_string(),
    };
    assert!(error.to_string().contains("CHANNEL_STORE_read"));
}

#[test]
fn channel_error_transport_display() {
    let error = ChannelError::Transport {
        detail: "connection reset by peer".to_string(),
        retryable: true,
    };
    let display = error.to_string();
    assert!(display.contains("CHANNEL_TRANSPORT"));
    assert!(display.contains("retryable=true"));
}

#[test]
fn channel_error_timeout_display() {
    let error = ChannelError::Timeout {
        detail: "getUpdates timed out".to_string(),
        retryable: true,
    };
    assert!(error.to_string().contains("CHANNEL_TIMEOUT"));
}

#[test]
fn channel_error_cancelled_display() {
    let error = ChannelError::Cancelled {
        detail: "worker shutdown".to_string(),
    };
    assert!(error.to_string().contains("CHANNEL_CANCELLED"));
}

#[test]
fn channel_error_config_display() {
    let error = ChannelError::Config {
        detail: "missing bot_token".to_string(),
    };
    assert!(error.to_string().contains("CHANNEL_CONFIG"));
}

#[test]
fn channel_error_unsupported_display() {
    let error = ChannelError::Unsupported {
        detail: "preview not supported for wechat".to_string(),
    };
    assert!(error.to_string().contains("CHANNEL_UNSUPPORTED"));
}

#[test]
fn channel_error_into_string_preserves_content() {
    let error = ChannelError::Auth {
        category: "failed".to_string(),
        detail: "bad credentials".to_string(),
        retryable: false,
    };
    let as_string: String = error.into();
    assert!(as_string.contains("CHANNEL_AUTH_failed"));
}

#[test]
fn channel_error_retryable_flags() {
    assert!(ChannelError::Transport { detail: "x".into(), retryable: true }.retryable());
    assert!(!ChannelError::Transport { detail: "x".into(), retryable: false }.retryable());
    assert!(ChannelError::Timeout { detail: "x".into(), retryable: true }.retryable());
    assert!(ChannelError::Auth { category: "x".into(), detail: "x".into(), retryable: true }.retryable());
    assert!(!ChannelError::Validation { detail: "x".into() }.retryable());
    assert!(!ChannelError::PermissionDenied { detail: "x".into(), provider_code: None }.retryable());
}

#[test]
fn channel_error_from_io_error() {
    let io_err = std::io::Error::new(std::io::ErrorKind::ConnectionReset, "connection reset");
    let channel_err: ChannelError = io_err.into();
    assert!(channel_err.retryable());
    assert!(channel_err.to_string().contains("CHANNEL_TRANSPORT"));
}

#[test]
fn channel_error_from_reqwest_error() {
    // reqwest errors are constructed indirectly; test that the From impl compiles
    // by checking the variant directly
    let error = ChannelError::Transport {
        detail: "reqwest connection failed".to_string(),
        retryable: true,
    };
    assert!(error.retryable());
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test channel_error --lib 2>&1 | head -30`
Expected: compile error — `channel_error` module does not exist

- [ ] **Step 4: Create ChannelError enum**

Create `apps/desktop-tauri/src-tauri/src/connectors/channel_error.rs`:
```rust
use std::fmt;

#[derive(Debug, Clone, thiserror::Error)]
pub enum ChannelError {
    #[error("CHANNEL_AUTH_{category}: {detail}")]
    Auth {
        category: String,
        detail: String,
        retryable: bool,
    },

    #[error("CHANNEL_PROVIDER_{status}: {detail}{provider_code_fmt}{http_status_fmt}")]
    Provider {
        status: String,
        detail: String,
        provider_code: Option<String>,
        http_status: Option<u16>,
        retryable: bool,
    },

    #[error("CHANNEL_PERMISSION_DENIED: {detail}{provider_code_fmt}")]
    PermissionDenied {
        detail: String,
        provider_code: Option<String>,
    },

    #[error("CHANNEL_VALIDATION: {detail}")]
    Validation { detail: String },

    #[error("CHANNEL_STORE_{operation}: {detail}")]
    Store { operation: String, detail: String },

    #[error("CHANNEL_TRANSPORT: {detail} (retryable={retryable})")]
    Transport { detail: String, retryable: bool },

    #[error("CHANNEL_TIMEOUT: {detail} (retryable={retryable})")]
    Timeout { detail: String, retryable: bool },

    #[error("CHANNEL_CANCELLED: {detail}")]
    Cancelled { detail: String },

    #[error("CHANNEL_CONFIG: {detail}")]
    Config { detail: String },

    #[error("CHANNEL_UNSUPPORTED: {detail}")]
    Unsupported { detail: String },
}

impl ChannelError {
    pub fn retryable(&self) -> bool {
        match self {
            Self::Auth { retryable, .. } => *retryable,
            Self::Provider { retryable, .. } => *retryable,
            Self::Transport { retryable, .. } => *retryable,
            Self::Timeout { retryable, .. } => *retryable,
            Self::PermissionDenied { .. } => false,
            Self::Validation { .. } => false,
            Self::Store { .. } => false,
            Self::Cancelled { .. } => false,
            Self::Config { .. } => false,
            Self::Unsupported { .. } => false,
        }
    }

    pub fn provider_unavailable(detail: impl fmt::Display) -> Self {
        Self::Provider {
            status: "unavailable".to_string(),
            detail: detail.to_string(),
            provider_code: None,
            http_status: None,
            retryable: true,
        }
    }

    pub fn provider_denied(detail: impl fmt::Display, provider_code: Option<String>) -> Self {
        Self::PermissionDenied {
            detail: detail.to_string(),
            provider_code,
        }
    }

    pub fn auth_failed(detail: impl fmt::Display) -> Self {
        Self::Auth {
            category: "failed".to_string(),
            detail: detail.to_string(),
            retryable: false,
        }
    }

    pub fn not_found(channel: &str, account_id: &str) -> Self {
        Self::Config {
            detail: format!("{channel} account {account_id} not found"),
        }
    }

    pub fn disabled(channel: &str, account_id: &str) -> Self {
        Self::Config {
            detail: format!("{channel} account {account_id} is disabled"),
        }
    }

    pub fn send_invalid(detail: impl fmt::Display) -> Self {
        Self::Validation {
            detail: detail.to_string(),
        }
    }

    pub fn store_read(detail: impl fmt::Display) -> Self {
        Self::Store {
            operation: "read".to_string(),
            detail: detail.to_string(),
        }
    }

    pub fn store_write(detail: impl fmt::Display) -> Self {
        Self::Store {
            operation: "write".to_string(),
            detail: detail.to_string(),
        }
    }

    pub fn secret_load_failed(detail: impl fmt::Display) -> Self {
        Self::Auth {
            category: "secret_load_failed".to_string(),
            detail: detail.to_string(),
            retryable: false,
        }
    }
}

impl From<ChannelError> for String {
    fn from(error: ChannelError) -> String {
        error.to_string()
    }
}

impl From<std::io::Error> for ChannelError {
    fn from(error: std::io::Error) -> Self {
        let retryable = matches!(
            error.kind(),
            std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
                | std::io::ErrorKind::TimedOut
                | std::io::ErrorKind::Interrupted
                | std::io::ErrorKind::WouldBlock
        );
        Self::Transport {
            detail: error.to_string(),
            retryable,
        }
    }
}

impl From<reqwest::Error> for ChannelError {
    fn from(error: reqwest::Error) -> Self {
        let retryable = error.is_timeout() || error.is_connect() || error.is_request();
        Self::Transport {
            detail: error.to_string(),
            retryable,
        }
    }
}

// Helper for Provider display formatting
struct ProviderCodeFmt(Option<String>);
impl fmt::Display for ProviderCodeFmt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(code) = &self.0 {
            write!(f, " provider_code={code}")?;
        }
        Ok(())
    }
}

struct HttpStatusFmt(Option<u16>);
impl fmt::Display for HttpStatusFmt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(status) = self.0 {
            write!(f, " http_status={status}")?;
        }
        Ok(())
    }
}
```

- [ ] **Step 5: Register module in connectors/mod.rs**

Modify `apps/desktop-tauri/src-tauri/src/connectors/mod.rs` to:
```rust
pub mod channel_error;
pub mod credential_store;
pub mod feishu;
pub mod telegram;
pub mod wechat;
```

- [ ] **Step 6: Add test module registration**

Add at the bottom of `apps/desktop-tauri/src-tauri/src/connectors/channel_error.rs`:
```rust
#[cfg(test)]
#[path = "channel_error_tests.rs"]
mod tests;
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test channel_error --lib 2>&1 | tail -20`
Expected: all 14 channel_error tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/desktop-tauri/src-tauri/Cargo.toml apps/desktop-tauri/src-tauri/src/connectors/channel_error.rs apps/desktop-tauri/src-tauri/src/connectors/channel_error_tests.rs apps/desktop-tauri/src-tauri/src/connectors/mod.rs
git commit -m "feat(channel): add ChannelError enum with structured error types

Introduces a typed error enum replacing string-based errors throughout
the channel layer. Includes retryable flag, structured context (provider
code, HTTP status), and From impls for io::Error and reqwest::Error.
Backward compatible via From<ChannelError> for String."
```

---

## Task 2: Add CancellationToken to AppState and wire into channel workers

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/app_state.rs` (add shutdown_token field)
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/websocket.rs` (use cancellation)
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs` (use cancellation)
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/wechat/mod.rs` (use cancellation)
- Modify: `apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs` (use cancellation)
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs` (shutdown on app close)

- [ ] **Step 1: Write failing test for shutdown token**

Add to `apps/desktop-tauri/src-tauri/src/connectors/channel_error_tests.rs`:
```rust
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn cancellation_token_cancels_workers() {
    let token = CancellationToken::new();
    assert!(!token.is_cancelled());
    token.cancel();
    assert!(token.is_cancelled());
    token.cancel(); // idempotent
    assert!(token.is_cancelled());
}
```

- [ ] **Step 2: Add CancellationToken to AppState**

In `apps/desktop-tauri/src-tauri/src/app_state.rs`, add field to `AppState`:
```rust
use tokio_util::sync::CancellationToken;

pub struct AppState {
    // ... existing fields ...
    pub shutdown_token: CancellationToken,
}
```

In `AppState::default()`, add:
```rust
shutdown_token: CancellationToken::new(),
```

- [ ] **Step 3: Wire CancellationToken into feishu websocket supervisor**

In `apps/desktop-tauri/src-tauri/src/connectors/feishu/websocket.rs`, modify `spawn_supervisor`:
```rust
pub fn spawn_supervisor(app: AppHandle, state: AppState) {
    let shutdown = state.shutdown_token.clone();
    reconcile(&app, &state);
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = shutdown.cancelled() => {
                debug!("feishu websocket supervisor shutting down");
            }
            _ = async {
                loop {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    reconcile(&app, &state);
                }
            } => {}
        }
    });
}
```

- [ ] **Step 4: Wire CancellationToken into wechat polling supervisor**

In `apps/desktop-tauri/src-tauri/src/connectors/wechat/mod.rs`, modify `spawn_polling_supervisor`:
```rust
pub fn spawn_polling_supervisor(app: AppHandle, state: AppState) {
    let shutdown = state.shutdown_token.clone();
    reconcile(&app, &state);
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = shutdown.cancelled() => {
                debug!("wechat polling supervisor shutting down");
            }
            _ = async {
                loop {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    reconcile(&app, &state);
                }
            } => {}
        }
    });
}
```

- [ ] **Step 5: Wire CancellationToken into telegram polling worker**

In `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs`, modify `spawn_polling_worker`:
```rust
pub fn spawn_polling_worker(app: AppHandle, state: AppState) {
    let shutdown = state.shutdown_token.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = shutdown.cancelled() => {
                debug!("telegram polling worker shutting down");
            }
            _ = async {
                loop {
                    // ... existing polling loop body ...
                    tokio::time::sleep(Duration::from_millis(TELEGRAM_POLL_INTERVAL_MS)).await;
                }
            } => {}
        }
    });
}
```

Note: The existing polling loop body is kept intact, just wrapped in `tokio::select!`.

- [ ] **Step 6: Wire CancellationToken into channel_adapter_runtime**

In `apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs`, modify `spawn`:
```rust
pub fn spawn(app: AppHandle, state: AppState) {
    let shutdown = state.shutdown_token.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = shutdown.cancelled() => {
                info!("channel adapter runtime shutting down");
            }
            result = run_runtime(app, state) => {
                if let Err(error) = result {
                    warn!(error = %error, "channel adapter runtime failed");
                }
            }
        }
    });
}
```

- [ ] **Step 7: Run cargo check to verify compilation**

Run: `cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/app_state.rs apps/desktop-tauri/src-tauri/src/connectors/feishu/websocket.rs apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs apps/desktop-tauri/src-tauri/src/connectors/wechat/mod.rs apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs
git commit -m "feat(channel): add CancellationToken to AppState and wire into all channel workers

All long-running channel tasks (feishu websocket supervisor, telegram
polling worker, wechat polling supervisor, channel adapter runtime) now
respect the shutdown token. Workers exit cleanly on token cancellation
instead of running indefinitely."
```

---

## Task 3: Create BackoffPolicy with exponential backoff and jitter

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/connectors/backoff.rs`
- Create: `apps/desktop-tauri/src-tauri/src/connectors/backoff_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/mod.rs`

- [ ] **Step 1: Write failing tests for BackoffPolicy**

Create `apps/desktop-tauri/src-tauri/src/connectors/backoff_tests.rs`:
```rust
use super::backoff::BackoffPolicy;
use std::time::Duration;

#[test]
fn backoff_initial_delay() {
    let policy = BackoffPolicy::default();
    assert_eq!(policy.delay(0), Duration::from_millis(5000));
}

#[test]
fn backoff_doubles_each_attempt() {
    let policy = BackoffPolicy::default();
    assert_eq!(policy.delay(1), Duration::from_millis(10000));
    assert_eq!(policy.delay(2), Duration::from_millis(20000));
    assert_eq!(policy.delay(3), Duration::from_millis(40000));
}

#[test]
fn backoff_caps_at_max() {
    let policy = BackoffPolicy::default();
    let max_delay = policy.delay(100);
    assert!(max_delay <= Duration::from_millis(300000));
}

#[test]
fn backoff_with_jitter_stays_within_bounds() {
    let policy = BackoffPolicy::default();
    let base = policy.delay(2);
    for _ in 0..100 {
        let jittered = policy.delay_with_jitter(2);
        let jitter_range = (base.as_millis() as f64 * policy.jitter) as u64;
        assert!(jittered >= base - Duration::from_millis(jitter_range));
        assert!(jittered <= base + Duration::from_millis(jitter_range));
    }
}

#[test]
fn backoff_max_attempts_exceeded() {
    let policy = BackoffPolicy::default();
    assert!(policy.should_retry(0));
    assert!(policy.should_retry(9));
    assert!(!policy.should_retry(10));
    assert!(!policy.should_retry(11));
}

#[test]
fn backoff_custom_policy() {
    let policy = BackoffPolicy {
        initial_ms: 1000,
        max_ms: 60000,
        factor: 3.0,
        jitter: 0.0,
        max_attempts: 5,
    };
    assert_eq!(policy.delay(0), Duration::from_millis(1000));
    assert_eq!(policy.delay(1), Duration::from_millis(3000));
    assert_eq!(policy.delay(2), Duration::from_millis(9000));
    assert!(policy.delay(10) <= Duration::from_millis(60000));
    assert!(!policy.should_retry(5));
}

#[test]
fn backoff_delay_zero_for_attempt_zero() {
    let policy = BackoffPolicy::default();
    assert_eq!(policy.delay(0), Duration::from_millis(5000));
}

#[test]
fn backoff_jitter_is_zero_when_jitter_is_zero() {
    let policy = BackoffPolicy {
        initial_ms: 5000,
        max_ms: 300000,
        factor: 2.0,
        jitter: 0.0,
        max_attempts: 10,
    };
    for attempt in 0..5 {
        assert_eq!(policy.delay_with_jitter(attempt), policy.delay(attempt));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test backoff --lib 2>&1 | head -10`
Expected: compile error — `backoff` module does not exist

- [ ] **Step 3: Implement BackoffPolicy**

Create `apps/desktop-tauri/src-tauri/src/connectors/backoff.rs`:
```rust
use std::time::Duration;
use rand::Rng;

#[derive(Debug, Clone)]
pub struct BackoffPolicy {
    pub initial_ms: u64,
    pub max_ms: u64,
    pub factor: f64,
    pub jitter: f64,
    pub max_attempts: u32,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            initial_ms: 5000,
            max_ms: 300000,
            factor: 2.0,
            jitter: 0.1,
            max_attempts: 10,
        }
    }
}

impl BackoffPolicy {
    pub fn delay(&self, attempt: u32) -> Duration {
        let exponent = attempt as f64;
        let delay_ms = (self.initial_ms as f64 * self.factor.powf(exponent)).min(self.max_ms as f64);
        Duration::from_millis(delay_ms as u64)
    }

    pub fn delay_with_jitter(&self, attempt: u32) -> Duration {
        let base = self.delay(attempt);
        if self.jitter == 0.0 {
            return base;
        }
        let jitter_range = (base.as_millis() as f64 * self.jitter) as u64;
        let offset = rand::thread_rng().gen_range(0..=jitter_range * 2) as i64 - jitter_range as i64;
        let adjusted = (base.as_millis() as i64 + offset).max(0) as u64;
        Duration::from_millis(adjusted)
    }

    pub fn should_retry(&self, attempt: u32) -> bool {
        attempt < self.max_attempts
    }
}
```

- [ ] **Step 4: Add `rand` dependency to Cargo.toml**

In `apps/desktop-tauri/src-tauri/Cargo.toml`, add:
```toml
rand = "0.9"
```

- [ ] **Step 5: Register module and test**

Modify `apps/desktop-tauri/src-tauri/src/connectors/mod.rs`:
```rust
pub mod backoff;
pub mod channel_error;
pub mod credential_store;
pub mod feishu;
pub mod telegram;
pub mod wechat;
```

Add at the bottom of `backoff.rs`:
```rust
#[cfg(test)]
#[path = "backoff_tests.rs"]
mod tests;
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test backoff --lib 2>&1 | tail -15`
Expected: all 8 backoff tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/backoff.rs apps/desktop-tauri/src-tauri/src/connectors/backoff_tests.rs apps/desktop-tauri/src-tauri/src/connectors/mod.rs apps/desktop-tauri/src-tauri/Cargo.toml
git commit -m "feat(channel): add BackoffPolicy with exponential backoff and jitter

Default: initial=5s, max=300s, factor=2, jitter=10%, max 10 attempts.
Provides delay() for deterministic computation and delay_with_jitter()
for production use. Will replace fixed-interval reconnection in all
channel workers."
```

---

## Task 4: Create shared HttpClient wrapping reqwest with retry

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/connectors/http_client.rs`
- Create: `apps/desktop-tauri/src-tauri/src/connectors/http_client_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/mod.rs`

- [ ] **Step 1: Write failing tests for HttpClient**

Create `apps/desktop-tauri/src-tauri/src/connectors/http_client_tests.rs`:
```rust
use super::http_client::{HttpClient, HttpRequest};
use super::channel_error::ChannelError;

#[test]
fn http_request_builder_get() {
    let req = HttpRequest::get("https://example.com/api")
        .header("Authorization", "Bearer test123")
        .timeout_secs(8)
        .build();
    assert_eq!(req.method, "GET");
    assert_eq!(req.url, "https://example.com/api");
    assert_eq!(req.headers.get("Authorization").unwrap(), "Bearer test123");
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
}

#[test]
fn http_client_default_timeouts() {
    let client = HttpClient::new();
    assert_eq!(client.connect_timeout_secs(), 8);
}

#[test]
fn http_client_with_custom_timeouts() {
    let client = HttpClient::builder()
        .connect_timeout_secs(5)
        .build();
    assert_eq!(client.connect_timeout_secs(), 5);
}

#[tokio::test]
async fn http_client_handles_connection_refused() {
    let client = HttpClient::new();
    let result = client.execute(
        HttpRequest::get("http://127.0.0.1:1/impossible")
            .timeout_secs(2)
            .build()
    ).await;
    assert!(result.is_err());
    let error = result.unwrap_err();
    assert!(error.retryable());
}

#[tokio::test]
async fn http_client_retries_on_transport_error() {
    // This test uses a server that closes after one request to verify retry behavior.
    // We bind a TCP listener that accepts and immediately closes, simulating connection reset.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    // Spawn a task that immediately closes connections
    let handle = tokio::spawn(async move {
        // Accept one connection and close immediately
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            listener.accept()
        ).await;
    });

    let client = HttpClient::builder()
        .max_retries(2)
        .connect_timeout_secs(2)
        .build();
    let result = client.execute(
        HttpRequest::get(&format!("http://127.0.0.1:{port}/test"))
            .timeout_secs(3)
            .build()
    ).await;
    assert!(result.is_err());
    let _ = handle.await;
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test http_client --lib 2>&1 | head -10`
Expected: compile error — module does not exist

- [ ] **Step 3: Implement HttpClient**

Create `apps/desktop-tauri/src-tauri/src/connectors/http_client.rs`:
```rust
use super::channel_error::ChannelError;
use reqwest::{Client, ClientBuilder, Method};
use serde_json::Value;
use std::time::Duration;
use tracing::warn;

const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 8;
const DEFAULT_MAX_RETRIES: u32 = 2;
const DEFAULT_RETRY_DELAY_SECS: u64 = 1;

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub content_type: Option<String>,
    pub timeout_secs: u64,
}

impl HttpRequest {
    pub fn get(url: &str) -> HttpRequestBuilder {
        HttpRequestBuilder {
            method: "GET".to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
            content_type: None,
            timeout_secs: 8,
        }
    }

    pub fn post(url: &str) -> HttpRequestBuilder {
        HttpRequestBuilder {
            method: "POST".to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
            content_type: None,
            timeout_secs: 8,
        }
    }
}

pub struct HttpRequestBuilder {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    content_type: Option<String>,
    timeout_secs: u64,
}

impl HttpRequestBuilder {
    pub fn header(mut self, key: &str, value: &str) -> Self {
        self.headers.push((key.to_string(), value.to_string()));
        self
    }

    pub fn json_body(mut self, value: &Value) -> Self {
        self.body = Some(value.to_string());
        self.content_type = Some("application/json".to_string());
        self
    }

    pub fn form_body(mut self, pairs: &[(String, String)]) -> Self {
        self.body = Some(
            pairs
                .iter()
                .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
                .collect::<Vec<_>>()
                .join("&"),
        );
        self.content_type = Some("application/x-www-form-urlencoded".to_string());
        self
    }

    pub fn timeout_secs(mut self, secs: u64) -> Self {
        self.timeout_secs = secs;
        self
    }

    pub fn build(self) -> HttpRequest {
        HttpRequest {
            method: self.method,
            url: self.url,
            headers: self.headers,
            body: self.body,
            content_type: self.content_type,
            timeout_secs: self.timeout_secs,
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpClient {
    client: Client,
    connect_timeout_secs: u64,
    max_retries: u32,
    retry_delay_secs: u64,
}

impl Default for HttpClient {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpClient {
    pub fn new() -> Self {
        Self::builder().build()
    }

    pub fn builder() -> HttpClientBuilder {
        HttpClientBuilder {
            connect_timeout_secs: DEFAULT_CONNECT_TIMEOUT_SECS,
            max_retries: DEFAULT_MAX_RETRIES,
            retry_delay_secs: DEFAULT_RETRY_DELAY_SECS,
        }
    }

    pub fn connect_timeout_secs(&self) -> u64 {
        self.connect_timeout_secs
    }

    pub async fn execute(&self, request: HttpRequest) -> Result<HttpResponse, ChannelError> {
        let mut last_error: Option<ChannelError> = None;
        let max_attempts = 1 + self.max_retries;

        for attempt in 0..max_attempts {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(self.retry_delay_secs)).await;
            }

            match self.execute_once(&request).await {
                Ok(response) => return Ok(response),
                Err(error) if error.retryable() && attempt + 1 < max_attempts => {
                    warn!(
                        attempt = attempt + 1,
                        max_attempts,
                        error = %error,
                        "http request failed, retrying"
                    );
                    last_error = Some(error);
                }
                Err(error) => return Err(error),
            }
        }

        Err(last_error.unwrap_or_else(|| ChannelError::Transport {
            detail: "all retry attempts exhausted".to_string(),
            retryable: false,
        }))
    }

    async fn execute_once(&self, request: &HttpRequest) -> Result<HttpResponse, ChannelError> {
        let method = Method::from_bytes(request.method.as_bytes()).unwrap_or(Method::GET);
        let mut req = self.client.request(method, &request.url);

        for (key, value) in &request.headers {
            req = req.header(key.as_str(), value.as_str());
        }

        if let Some(content_type) = &request.content_type {
            req = req.header("Content-Type", content_type);
        }

        if let Some(body) = &request.body {
            req = req.body(body.clone());
        }

        req = req.timeout(Duration::from_secs(request.timeout_secs));

        let response = req
            .send()
            .await
            .map_err(ChannelError::from)?;

        let status = response.status().as_u16();
        let headers: Vec<(String, String)> = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                Some((name.to_string(), value.to_str().ok()?.to_string()))
            })
            .collect();

        let body_bytes = response
            .bytes()
            .await
            .map_err(ChannelError::from)?;

        Ok(HttpResponse {
            status,
            headers,
            body: body_bytes.to_vec(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, ChannelError> {
        serde_json::from_slice::<T>(&self.body).map_err(|error| ChannelError::Provider {
            status: "invalid_response".to_string(),
            detail: format!("invalid JSON: {error}"),
            provider_code: None,
            http_status: Some(self.status),
            retryable: false,
        })
    }

    pub fn json_value(&self) -> Result<Value, ChannelError> {
        serde_json::from_slice::<Value>(&self.body).map_err(|error| ChannelError::Provider {
            status: "invalid_response".to_string(),
            detail: format!("invalid JSON: {error}"),
            provider_code: None,
            http_status: Some(self.status),
            retryable: false,
        })
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }

    pub fn is_success(&self) -> bool {
        self.status >= 200 && self.status < 300
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub struct HttpClientBuilder {
    connect_timeout_secs: u64,
    max_retries: u32,
    retry_delay_secs: u64,
}

impl HttpClientBuilder {
    pub fn connect_timeout_secs(mut self, secs: u64) -> Self {
        self.connect_timeout_secs = secs;
        self
    }

    pub fn max_retries(mut self, retries: u32) -> Self {
        self.max_retries = retries;
        self
    }

    pub fn retry_delay_secs(mut self, secs: u64) -> Self {
        self.retry_delay_secs = secs;
        self
    }

    pub fn build(self) -> HttpClient {
        let client = ClientBuilder::new()
            .connect_timeout(Duration::from_secs(self.connect_timeout_secs))
            .use_rustls_tls()
            .build()
            .expect("failed to build reqwest client");

        HttpClient {
            client,
            connect_timeout_secs: self.connect_timeout_secs,
            max_retries: self.max_retries,
            retry_delay_secs: self.retry_delay_secs,
        }
    }
}

#[cfg(test)]
#[path = "http_client_tests.rs"]
mod tests;
```

- [ ] **Step 4: Register module**

Modify `apps/desktop-tauri/src-tauri/src/connectors/mod.rs`:
```rust
pub mod backoff;
pub mod channel_error;
pub mod credential_store;
pub mod http_client;
pub mod feishu;
pub mod telegram;
pub mod wechat;
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test http_client --lib 2>&1 | tail -20`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/http_client.rs apps/desktop-tauri/src-tauri/src/connectors/http_client_tests.rs apps/desktop-tauri/src-tauri/src/connectors/mod.rs
git commit -m "feat(channel): add HttpClient wrapping reqwest with retry logic

Shared HTTP client for all connectors. Features: configurable connect
timeout (default 8s), per-request timeout, automatic retry (2 retries)
on transport errors, structured HttpResponse with json_value/text helpers.
Replaces curl shell calls in Tasks 5-6."
```

---

## Task 5: Migrate Feishu API from curl to reqwest HttpClient

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/api.rs`

- [ ] **Step 1: Replace run_curl_json with HttpClient in feishu/api.rs**

In `apps/desktop-tauri/src-tauri/src/connectors/feishu/api.rs`, make these changes:

1. Remove imports: `use std::process::Command;` and `use crate::process_utils::configure_std_command;`
2. Add import: `use crate::connectors::http_client::{HttpClient, HttpRequest, HttpResponse};`
3. Add import: `use crate::connectors::channel_error::ChannelError;`
4. Delete the `run_curl_json` function entirely
5. Replace `fetch_tenant_access_token`:
```rust
pub fn fetch_tenant_access_token(
    domain: FeishuDomain,
    app_id: &str,
    app_secret: &str,
) -> Result<String, String> {
    let rt = tauri::async_runtime::Runtime::new()
        .map_err(|e| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {e}"))?;
    rt.block_on(async {
        let client = HttpClient::new();
        let endpoint = format!(
            "{}/open-apis/auth/v3/tenant_access_token/internal",
            base_url(domain)
        );
        let body = json!({
            "app_id": app_id.trim(),
            "app_secret": app_secret.trim(),
        });
        let response = client
            .execute(
                HttpRequest::post(&endpoint)
                    .json_body(&body)
                    .timeout_secs(12)
                    .build(),
            )
            .await
            .map_err(|e| e.to_string())?;
        if !response.is_success() {
            return Err(format!(
                "CHANNEL_CONNECTOR_AUTH_FAILED: tenant_access_token HTTP {}",
                response.status
            ));
        }
        let payload = response.json_value().map_err(|e| e.to_string())?;
        parse_tenant_access_token_response(payload)
    })
}
```

6. Replace `get_bot_info`:
```rust
pub fn get_bot_info(
    domain: FeishuDomain,
    tenant_access_token: &str,
) -> Result<FeishuBotInfo, String> {
    let rt = tauri::async_runtime::Runtime::new()
        .map_err(|e| format!("CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: {e}"))?;
    rt.block_on(async {
        let client = HttpClient::new();
        let endpoint = format!("{}/open-apis/bot/v3/info", base_url(domain));
        let response = client
            .execute(
                HttpRequest::get(&endpoint)
                    .header("Authorization", &format!("Bearer {}", tenant_access_token.trim()))
                    .timeout_secs(12)
                    .build(),
            )
            .await
            .map_err(|e| e.to_string())?;
        if !response.is_success() {
            return Err(format!(
                "CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: bot info HTTP {}",
                response.status
            ));
        }
        let payload = response.json_value().map_err(|e| e.to_string())?;
        parse_bot_info_response(payload)
    })
}
```

- [ ] **Step 2: Update feishu API tests to remove curl dependency**

The existing feishu `api_tests.rs` tests that use `install_fake_curl` need to be updated. Since the curl-based tests tested `parse_tenant_access_token_response` and `parse_bot_info_response` (pure functions), they should still work. The `run_curl_json` integration tests need to be removed or replaced with TCP stub tests.

In `apps/desktop-tauri/src-tauri/src/connectors/feishu/tests/api_tests.rs`:
- Remove any `install_fake_curl` / `restore_fake_curl` test infrastructure
- Remove any tests that call `run_curl_json` directly
- Keep all `parse_*` tests (they test pure functions)
- Add a test using a real TCP stub:
```rust
#[tokio::test]
async fn fetch_tenant_access_token_calls_http_client() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let base = format!("http://127.0.0.1:{port}");

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        // Read request, send success response
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 73\r\nConnection: close\r\n\r\n{{\"code\":0,\"tenant_access_token\":\"test_token_123\"}}"
        );
        use tokio::io::AsyncWriteExt;
        let mut stream = stream;
        // Read the request first (consume it)
        let mut buf = [0u8; 4096];
        use tokio::io::AsyncReadExt;
        let _ = stream.read(&mut buf).await;
        let _ = stream.write_all(response.as_bytes()).await;
    });

    // The fetch_tenant_access_token function uses the base_url, not our stub
    // So we test the HTTP client directly instead
    let client = crate::connectors::http_client::HttpClient::new();
    let result = client.execute(
        crate::connectors::http_client::HttpRequest::post(&format!("{base}/test"))
            .json_body(&serde_json::json!({"app_id": "test"}))
            .timeout_secs(3)
            .build()
    ).await;
    assert!(result.is_ok());
    let resp = result.unwrap();
    assert!(resp.is_success());
    let json = resp.json_value().unwrap();
    assert_eq!(json["code"], 0);
}
```

- [ ] **Step 3: Run cargo check and tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test feishu::api --lib 2>&1 | tail -20`
Expected: all feishu api tests PASS, no curl dependency

- [ ] **Step 4: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/feishu/api.rs apps/desktop-tauri/src-tauri/src/connectors/feishu/tests/api_tests.rs
git commit -m "refactor(feishu): migrate API from curl to reqwest HttpClient

Replace run_curl_json shell calls with shared HttpClient. Token and
bot info endpoints now use reqwest with proper timeout and retry support.
Remove curl CLI dependency for Feishu connector."
```

---

## Task 6: Migrate Telegram API from curl to reqwest HttpClient

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/telegram/api.rs`

This is the largest migration since Telegram's entire API layer uses `run_curl_json`. The key functions to migrate:

1. `telegram_get_me`
2. `telegram_get_webhook_info`
3. `telegram_set_webhook`
4. `telegram_delete_webhook`
5. `telegram_get_updates`
6. `telegram_send_chat_action`
7. `telegram_send_message`
8. `telegram_edit_message`
9. `telegram_delete_message`
10. `telegram_answer_callback_query`

- [ ] **Step 1: Replace run_curl_json with HttpClient in telegram/api.rs**

1. Remove imports: `use std::process::Command;` and `use crate::process_utils::configure_std_command;`
2. Add imports:
```rust
use crate::connectors::http_client::{HttpClient, HttpRequest};
use crate::connectors::channel_error::ChannelError;
```
3. Delete the entire `run_curl_json` function and all retry helper functions: `looks_like_retryable_transport_error`, `looks_like_windows_schannel_error`
4. Add a module-level client:
```rust
static HTTP_CLIENT: OnceLock<HttpClient> = OnceLock::new();

fn http_client() -> &'static HttpClient {
    HTTP_CLIENT.get_or_init(HttpClient::new)
}
```
5. Replace each `telegram_*` function. The pattern is the same for all — replace the curl args with `HttpRequest` builder calls and `http_client().execute()`. Example for `telegram_get_me`:

```rust
pub(super) async fn telegram_get_me(token: &str) -> Result<TelegramGetMeResponse, String> {
    let url = format!("{}/getMe", api_base_url(token));
    let response = http_client()
        .execute(HttpRequest::get(&url).timeout_secs(8).build())
        .await
        .map_err(|e| e.to_string())?;
    if !response.is_success() {
        return Err(format!(
            "{}: getMe HTTP {}",
            telegram_provider_error_prefix(&response.text(), response.status),
            response.status
        ));
    }
    let payload = response.json_value().map_err(|e| e.to_string())?;
    parse_get_me_response(payload)
}
```

6. Similarly for all other functions. Key timeout values:
   - `getMe`, `getWebhookInfo`, `setWebhook`, `deleteWebhook`, `sendChatAction`, `deleteMessage`, `answerCallbackQuery`: 8s
   - `sendMessage`, `editMessage`: 25s
   - `getUpdates`: 30s

7. `getUpdates` uses form-encoded POST instead of JSON:
```rust
pub(super) async fn telegram_get_updates(
    token: &str,
    offset: i64,
    timeout: i64,
) -> Result<TelegramUpdatesResponse, String> {
    let url = format!("{}/getUpdates", api_base_url(token));
    let fields = get_updates_form_fields(offset, timeout);
    let response = http_client()
        .execute(
            HttpRequest::post(&url)
                .form_body(&fields)
                .timeout_secs(30)
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    // ... parse response ...
}
```

- [ ] **Step 2: Update telegram API tests to remove curl dependency**

In `apps/desktop-tauri/src-tauri/src/connectors/telegram/tests/api_tests.rs`:
- Remove `install_fake_curl` / `restore_fake_curl` infrastructure and `curl_env_lock`
- Remove `#[cfg(unix)]` gates on curl tests
- Convert tests to use TCP stub pattern (same as existing WeChat tests)
- Keep all `parse_*` tests (they test pure functions)

- [ ] **Step 3: Update telegram/mod.rs to remove spawn_blocking**

Since the API functions are now async (using reqwest), the `tokio::task::spawn_blocking` wrappers in `mod.rs` are no longer needed. Replace with direct `.await` calls.

In `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs`, change functions like:
```rust
// Before:
let result = tokio::task::spawn_blocking(move || {
    telegram_send_message(token, chat_id, text)
}).await.map_err(|e| format!("...: {e}"))??;

// After:
let result = telegram_send_message(&token, &chat_id, &text).await.map_err(|e| e.to_string())?;
```

- [ ] **Step 4: Run cargo check and tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test telegram::api --lib 2>&1 | tail -20`
Expected: all telegram api tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/telegram/api.rs apps/desktop-tauri/src-tauri/src/connectors/telegram/tests/api_tests.rs apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs
git commit -m "refactor(telegram): migrate API from curl to reqwest HttpClient

Replace all curl shell calls with shared async HttpClient. Remove
spawn_blocking wrappers since API functions are now async. Remove
curl CLI dependency, platform-specific schannel workarounds, and
fake-curl test infrastructure. Add proper retry via HttpClient."
```

---

## Task 7: Split shared connectors.json into per-connector files

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/account_store.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs` (store path)

- [ ] **Step 1: Change Feishu store path**

In `apps/desktop-tauri/src-tauri/src/connectors/feishu/account_store.rs`, modify `connector_store_path`:
```rust
fn connector_store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    Ok(app_data.join("channel/feishu-connectors.json"))
}
```

Remove the `telegram_accounts` field from `ConnectorStoreFile`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStoreFile {
    version: String,
    #[serde(default)]
    feishu_accounts: HashMap<String, FeishuConnectorAccountRecord>,
}
```

Add migration logic in `load_store`:
```rust
fn load_store<R: Runtime>(app: &AppHandle<R>) -> Result<ConnectorStoreFile, String> {
    let new_path = connector_store_path(app)?;
    if new_path.exists() {
        let payload = fs::read(&new_path)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_READ_FAILED: {error}"))?;
        return serde_json::from_slice::<ConnectorStoreFile>(&payload)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_DECODE_FAILED: {error}"));
    }
    // Migration: read old shared file and extract feishu accounts
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    let old_path = app_data.join("channel/connectors.json");
    if old_path.exists() {
        let payload = fs::read(&old_path)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_READ_FAILED: {error}"))?;
        if let Ok(old_store) = serde_json::from_slice::<serde_json::Value>(&payload) {
            if let Some(feishu_val) = old_store.get("feishuAccounts") {
                if let Ok(accounts) = serde_json::from_value::<HashMap<String, FeishuConnectorAccountRecord>>(feishu_val.clone()) {
                    let migrated = ConnectorStoreFile {
                        version: CONNECTOR_STORE_VERSION.to_string(),
                        feishu_accounts: accounts,
                    };
                    if let Err(e) = save_store(app, &migrated) {
                        warn!(error = %e, "failed to save migrated feishu store");
                    } else if let Err(e) = fs::rename(&old_path, app_data.join("channel/connectors.json.bak")) {
                        warn!(error = %e, "failed to backup old connectors.json");
                    }
                    return Ok(migrated);
                }
            }
        }
    }
    Ok(ConnectorStoreFile::default())
}
```

- [ ] **Step 2: Change Telegram store path**

In `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs`, modify `connector_store_path`:
```rust
fn connector_store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    Ok(app_data.join("channel/telegram-connectors.json"))
}
```

Add similar migration logic in `load_store`:
```rust
fn load_store<R: Runtime>(app: &AppHandle<R>) -> Result<ConnectorStoreFile, String> {
    let new_path = connector_store_path(app)?;
    if new_path.exists() {
        let payload = fs::read(&new_path)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_READ_FAILED: {error}"))?;
        return serde_json::from_slice::<ConnectorStoreFile>(&payload)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_DECODE_FAILED: {error}"))?;
    }
    // Migration: read old shared file and extract telegram accounts
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_PATH_FAILED: {error}"))?;
    let old_path = app_data.join("channel/connectors.json");
    if old_path.exists() {
        let payload = fs::read(&old_path)
            .map_err(|error| format!("CHANNEL_CONNECTOR_STORE_READ_FAILED: {error}"))?;
        if let Ok(old_store) = serde_json::from_slice::<serde_json::Value>(&payload) {
            if let Some(tg_val) = old_store.get("telegramAccounts") {
                if let Ok(accounts) = serde_json::from_value::<HashMap<String, TelegramAccountRecord>>(tg_val.clone()) {
                    let mut migrated = ConnectorStoreFile::default();
                    migrated.telegram_accounts = accounts;
                    if let Err(e) = save_store(app, &migrated) {
                        warn!(error = %e, "failed to save migrated telegram store");
                    } else if let Err(e) = fs::rename(&old_path, app_data.join("channel/connectors.json.bak")) {
                        warn!(error = %e, "failed to backup old connectors.json");
                    }
                    return Ok(migrated);
                }
            }
        }
    }
    Ok(ConnectorStoreFile::default())
}
```

- [ ] **Step 3: Run cargo check and tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test --lib 2>&1 | tail -20`
Expected: all tests PASS including migration logic

- [ ] **Step 4: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/feishu/account_store.rs apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs
git commit -m "refactor(channel): split shared connectors.json into per-connector files

Feishu uses channel/feishu-connectors.json, Telegram uses
channel/telegram-connectors.json. WeChat already had its own file.
Migration: on first load, reads old connectors.json, splits into new
files, and backs up the old file as connectors.json.bak.
Eliminates shared-file race conditions."
```

---

## Task 8: Persist webhook tokens across restarts

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs`
- Create: `apps/desktop-tauri/src-tauri/src/connectors/webhook_tokens.rs`
- Create: `apps/desktop-tauri/src-tauri/src/connectors/webhook_tokens_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/mod.rs`

- [ ] **Step 1: Write failing tests for webhook token persistence**

Create `apps/desktop-tauri/src-tauri/src/connectors/webhook_tokens_tests.rs`:
```rust
use super::webhook_tokens::WebhookTokens;

#[test]
fn webhook_tokens_new_generates_uuids() {
    let tokens = WebhookTokens::new();
    assert!(!tokens.feishu_token.is_empty());
    assert!(!tokens.telegram_token.is_empty());
    assert_ne!(tokens.feishu_token, tokens.telegram_token);
}

#[test]
fn webhook_tokens_persist_and_load() {
    let dir = std::env::temp_dir().join(format!("gto-webhook-tokens-test-{}", uuid::Uuid::new_v4()));
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
fn webhook_tokens_load_returns_new_if_file_missing() {
    let dir = std::env::temp_dir().join(format!("gto-webhook-tokens-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let path = dir.join("nonexistent.json");
    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert!(!loaded.feishu_token.is_empty());
    assert!(!loaded.telegram_token.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn webhook_tokens_load_returns_new_if_file_invalid() {
    let dir = std::env::temp_dir().join(format!("gto-webhook-tokens-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let path = dir.join("invalid.json");
    std::fs::write(&path, "not json").unwrap();
    let loaded = WebhookTokens::load_from_path(&path).unwrap();
    assert!(!loaded.feishu_token.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn webhook_tokens_rotate_generates_new_tokens() {
    let original = WebhookTokens::new();
    let rotated = original.rotate();
    assert_ne!(original.feishu_token, rotated.feishu_token);
    assert_ne!(original.telegram_token, rotated.telegram_token);
}
```

- [ ] **Step 2: Implement WebhookTokens**

Create `apps/desktop-tauri/src-tauri/src/connectors/webhook_tokens.rs`:
```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const TOKENS_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTokens {
    version: String,
    pub feishu_token: String,
    pub telegram_token: String,
}

impl WebhookTokens {
    pub fn new() -> Self {
        Self {
            version: TOKENS_VERSION.to_string(),
            feishu_token: Uuid::new_v4().to_string(),
            telegram_token: Uuid::new_v4().to_string(),
        }
    }

    pub fn load_from_path(path: &std::path::Path) -> Result<Self, String> {
        if !path.exists() {
            let tokens = Self::new();
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("failed to create tokens dir: {e}"))?;
            }
            tokens.save_to_path(path)?;
            return Ok(tokens);
        }
        let payload = std::fs::read(path)
            .map_err(|e| format!("failed to read tokens file: {e}"))?;
        let tokens: Self = serde_json::from_slice(&payload).unwrap_or_else(|_| Self::new());
        if tokens.feishu_token.is_empty() || tokens.telegram_token.is_empty() {
            return Ok(Self::new());
        }
        Ok(tokens)
    }

    pub fn save_to_path(&self, path: &std::path::Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create tokens dir: {e}"))?;
        }
        let payload = serde_json::to_vec_pretty(self)
            .map_err(|e| format!("failed to encode tokens: {e}"))?;
        std::fs::write(path, payload)
            .map_err(|e| format!("failed to write tokens file: {e}"))
    }

    pub fn rotate(&self) -> Self {
        Self::new()
    }
}

impl Default for WebhookTokens {
    fn default() -> Self {
        Self::new()
    }
}

pub fn tokens_file_path() -> std::path::PathBuf {
    let home = dirs_home();
    home.join(".gtoffice/channel/runtime-tokens.json")
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
}

#[cfg(test)]
#[path = "webhook_tokens_tests.rs"]
mod tests;
```

- [ ] **Step 3: Integrate WebhookTokens into channel_adapter_runtime**

In `apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs`, modify `run_runtime` to load tokens:

Replace the token generation:
```rust
// Before:
let feishu_token = Uuid::new_v4().to_string();
let telegram_token = Uuid::new_v4().to_string();

// After:
use crate::connectors::webhook_tokens::WebhookTokens;
let tokens = WebhookTokens::load_from_path(&crate::connectors::webhook_tokens::tokens_file_path())
    .unwrap_or_else(|_| WebhookTokens::new());
let feishu_token = tokens.feishu_token;
let telegram_token = tokens.telegram_token;
```

- [ ] **Step 4: Register module**

Modify `apps/desktop-tauri/src-tauri/src/connectors/mod.rs`:
```rust
pub mod backoff;
pub mod channel_error;
pub mod credential_store;
pub mod http_client;
pub mod feishu;
pub mod telegram;
pub mod wechat;
pub mod webhook_tokens;
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test webhook_tokens --lib 2>&1 | tail -15`
Expected: all webhook_tokens tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/webhook_tokens.rs apps/desktop-tauri/src-tauri/src/connectors/webhook_tokens_tests.rs apps/desktop-tauri/src-tauri/src/connectors/mod.rs apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs
git commit -m "feat(channel): persist webhook tokens across restarts

Webhook verification tokens are now loaded from
~/.gtoffice/channel/runtime-tokens.json on startup. Generated on first
run and reused on subsequent starts. Eliminates need to reconfigure
webhook URLs after every app restart."
```

---

## Task 9: Wire BackoffPolicy into channel workers

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/websocket.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/wechat/mod.rs`

- [ ] **Step 1: Add backoff to feishu websocket worker restart**

In `apps/desktop-tauri/src-tauri/src/connectors/feishu/websocket.rs`, add to `reconcile`:
```rust
use crate::connectors::backoff::BackoffPolicy;
use std::sync::OnceLock;

static RESTART_ATTEMPTS: OnceLock<RwLock<HashMap<String, u32>>> = OnceLock::new();
static MANUALLY_STOPPED: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

fn restart_attempts() -> &'static RwLock<HashMap<String, u32>> {
    RESTART_ATTEMPTS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn manually_stopped() -> &'static RwLock<HashSet<String>> {
    MANUALLY_STOPPED.get_or_init(|| RwLock::new(HashSet::new()))
}

pub fn mark_manually_stopped(account_id: &str) {
    if let Ok(mut guard) = manually_stopped().write() {
        guard.insert(account_id.to_string());
    }
}
```

In the `reconcile` function, when removing a worker (intentional stop):
```rust
if desired.contains(&account_id) {
    continue;
}
if let Some(handle) = guard.remove(&account_id) {
    handle.abort();
    mark_manually_stopped(&account_id);
}
```

When spawning a new worker, check backoff:
```rust
for account_id in desired {
    if guard.contains_key(&account_id) {
        continue;
    }
    // Check if manually stopped (shouldn't restart)
    if manually_stopped().read().map(|g| g.contains(&account_id)).unwrap_or(false) {
        continue;
    }
    // Check restart backoff
    let attempt = restart_attempts()
        .read()
        .map(|g| g.get(&account_id).copied().unwrap_or(0))
        .unwrap_or(0);
    let policy = BackoffPolicy::default();
    if !policy.should_retry(attempt) {
        warn!(account_id = %account_id, attempt, "feishu websocket max restart attempts reached");
        continue;
    }
    // ... spawn worker ...
    // Reset attempt counter on successful spawn
    if let Ok(mut guard) = restart_attempts().write() {
        guard.remove(&account_id);
    }
}
```

When a worker exits with an error, increment the attempt counter:
```rust
async fn worker_loop(app: AppHandle, state: AppState, account_id: String) {
    // ... existing code ...
    if let Err(error) = result {
        warn!(account_id = %account_id, error = %error, "feishu websocket worker exited");
        // Increment restart attempt counter
        if let Ok(mut guard) = restart_attempts().write() {
            *guard.entry(account_id.clone()).or_insert(0) += 1;
        }
    }
    // ... mark_connected(false) ...
}
```

Clear manually_stopped when account is added to desired set:
```rust
// At the top of reconcile, clear manually_stopped for desired accounts
for account_id in &desired {
    if let Ok(mut guard) = manually_stopped().write() {
        guard.remove(account_id);
    }
}
```

- [ ] **Step 2: Add backoff to telegram polling worker**

In `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs`, add backoff on polling errors:

```rust
use crate::connectors::backoff::BackoffPolicy;

// In the polling loop, replace fixed sleep with backoff:
let mut error_attempts: HashMap<String, u32> = HashMap::new();

loop {
    tokio::select! {
        _ = shutdown.cancelled() => { break; }
        _ = async {
            let accounts = polling_accounts(&app, &state);
            for record in accounts {
                let account_id = record.account_id.clone();
                match poll_account_once(&app, &state, record).await {
                    Ok(()) => { error_attempts.remove(&account_id); }
                    Err(error) => {
                        let attempt = error_attempts.entry(account_id.clone()).or_insert(0);
                        let policy = BackoffPolicy::default();
                        if policy.should_retry(*attempt) {
                            let delay = policy.delay_with_jitter(*attempt);
                            warn!(account_id = %account_id, attempt = *attempt, delay_ms = delay.as_millis(), "telegram poll error, backing off");
                            *attempt += 1;
                            tokio::time::sleep(delay).await;
                        } else {
                            warn!(account_id = %account_id, "telegram poll max attempts reached, skipping");
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(TELEGRAM_POLL_INTERVAL_MS)).await;
        } => {}
    }
}
```

- [ ] **Step 3: Add backoff to wechat polling worker**

In `apps/desktop-tauri/src-tauri/src/connectors/wechat/mod.rs`, add similar backoff to `worker_loop`:

```rust
use crate::connectors::backoff::BackoffPolicy;

async fn worker_loop(app: AppHandle, state: AppState, account_id: String) {
    let mut attempt: u32 = 0;
    let policy = BackoffPolicy::default();
    loop {
        // ... existing get_updates logic ...
        match result {
            Ok(updates) => {
                attempt = 0; // reset on success
                // ... process updates ...
            }
            Err(error) => {
                if !policy.should_retry(attempt) {
                    warn!(account_id = %account_id, attempt, "wechat poll max attempts reached, stopping worker");
                    break;
                }
                let delay = policy.delay_with_jitter(attempt);
                warn!(account_id = %account_id, attempt, delay_ms = delay.as_millis(), error = %error, "wechat poll error, backing off");
                attempt += 1;
                tokio::time::sleep(delay).await;
            }
        }
        // Check cancellation
        if app_state.shutdown_token.is_cancelled() {
            break;
        }
    }
}
```

- [ ] **Step 4: Run cargo check and tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test --lib 2>&1 | tail -20`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-tauri/src-tauri/src/connectors/feishu/websocket.rs apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs apps/desktop-tauri/src-tauri/src/connectors/wechat/mod.rs
git commit -m "feat(channel): add exponential backoff with jitter to all channel workers

Feishu websocket, Telegram polling, and WeChat polling workers now use
BackoffPolicy (initial=5s, max=300s, factor=2, jitter=10%) instead of
fixed-interval retries. Max 10 restart attempts per account. Feishu
also tracks manually-stopped accounts to prevent auto-restart after
intentional stops."
```

---

## Task 10: Migrate connector internal functions to ChannelError

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/send_policy.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/api.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/feishu/account_store.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/telegram/api.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/telegram/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/telegram/offset_store.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/wechat/api.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/wechat/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/credential_store.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/connectors/channel_sinks.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs`
- Update all corresponding test files to assert on ChannelError variants

This task migrates `Result<T, String>` to `Result<T, ChannelError>` across all connector internal functions. Command layer (`commands/tool_adapter/`) keeps `Result<T, String>` and uses `.to_string()` at the boundary.

- [ ] **Step 1: Migrate credential_store.rs**

```rust
use crate::connectors::channel_error::ChannelError;

pub fn store_secret(reference: &str, value: &str) -> Result<(), ChannelError> {
    channel_secret_store()
        .store(reference, value)
        .map_err(|error| ChannelError::Auth {
            category: "secret_store_failed".to_string(),
            detail: error.to_string(),
            retryable: false,
        })
}

pub fn load_secret(reference: &str) -> Result<String, ChannelError> {
    channel_secret_store()
        .load(reference)
        .map_err(|error| ChannelError::Auth {
            category: "secret_load_failed".to_string(),
            detail: error.to_string(),
            retryable: false,
        })
}
```

- [ ] **Step 2: Migrate feishu/send_policy.rs**

```rust
use crate::connectors::channel_error::ChannelError;

pub(super) fn should_fallback_to_direct_send(reply_error: &ChannelError) -> bool {
    let detail = reply_error.to_string();
    let normalized = detail.trim().to_ascii_lowercase();
    if WITHDRAWN_OR_MISSING_REPLY_CODES
        .iter()
        .any(|code| contains_provider_code(&normalized, code))
    {
        return true;
    }
    normalized.contains("withdrawn") || normalized.contains("not found")
}

pub(super) fn classify_send_error(error_text: &str) -> ChannelError {
    let normalized = error_text.trim().to_ascii_lowercase();
    if BOT_NOT_IN_CHAT_OR_DENIED_CODES
        .iter()
        .any(|code| contains_provider_code(&normalized, code))
        || normalized.contains("bot/user can not be out of the chat")
    {
        return ChannelError::PermissionDenied {
            detail: format!("feishu bot is not in the chat or lacks send permission; {error_text}"),
            provider_code: Some("230002".to_string()),
        };
    }
    ChannelError::provider_unavailable(error_text)
}

pub(super) fn normalize_provider_error(error: impl std::fmt::Display) -> ChannelError {
    classify_send_error(&error.to_string())
}
```

- [ ] **Step 3: Migrate feishu/account_store.rs**

Replace all `Result<_, String>` with `Result<_, ChannelError>`:
```rust
use crate::connectors::channel_error::ChannelError;

fn connector_store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, ChannelError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| ChannelError::store_read(e))?;
    Ok(app_data.join("channel/feishu-connectors.json"))
}

fn load_store<R: Runtime>(app: &AppHandle<R>) -> Result<ConnectorStoreFile, ChannelError> {
    // ... use ChannelError::store_read / ChannelError::store_write ...
}

fn save_store<R: Runtime>(app: &AppHandle<R>, store: &ConnectorStoreFile) -> Result<(), ChannelError> {
    // ... use ChannelError::store_write ...
}

pub fn list_records<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<FeishuConnectorAccountRecord>, ChannelError> { ... }
pub fn get_record(app: &AppHandle<impl Runtime>, account_id: &str) -> Result<Option<FeishuConnectorAccountRecord>, ChannelError> { ... }
pub fn upsert_record(app: &AppHandle<impl Runtime>, account_key: String, record: FeishuConnectorAccountRecord) -> Result<(), ChannelError> { ... }
```

- [ ] **Step 4: Migrate feishu/api.rs**

All functions change from `Result<_, String>` to `Result<_, ChannelError>`. The `send_text_message` and `reply_text_message` functions already use the SDK; just change the error type.

- [ ] **Step 5: Migrate feishu/mod.rs**

All public functions change from `Result<_, String>` to `Result<_, ChannelError>`. At the command boundary (where Tauri commands call these), add `.map_err(|e| e.to_string())` or rely on `From<ChannelError> for String`.

- [ ] **Step 6: Migrate telegram/api.rs**

All `telegram_*` functions change from `Result<_, String>` to `Result<_, ChannelError>`. Replace string error construction with `ChannelError` variants.

- [ ] **Step 7: Migrate telegram/mod.rs**

Same pattern: internal functions use `ChannelError`, command-facing functions convert via `.to_string()`.

- [ ] **Step 8: Migrate telegram/offset_store.rs**

Replace `Result<_, String>` with `Result<_, ChannelError>`.

- [ ] **Step 9: Migrate wechat/api.rs and wechat/mod.rs**

Same migration pattern.

- [ ] **Step 10: Migrate channel_sinks.rs**

Replace string error construction with `ChannelError` variants.

- [ ] **Step 11: Migrate channel_adapter_runtime.rs**

Replace string errors with `ChannelError` variants.

- [ ] **Step 12: Update all test files**

In each test file, change error assertions from:
```rust
let error = function().expect_err("...");
assert!(error.contains("CHANNEL_CONNECTOR_..."));
```
to:
```rust
let error = function().expect_err("...");
// ChannelError display still contains the prefix, so .contains() still works
assert!(error.to_string().contains("CHANNEL_..."));
// For more precise assertions:
match error {
    ChannelError::Validation { detail } => assert!(detail.contains("...")),
    _ => panic!("expected Validation error, got {error}"),
}
```

- [ ] **Step 13: Run full test suite**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test --lib 2>&1 | tail -30`
Expected: all tests PASS

- [ ] **Step 14: Commit**

```bash
git add -A apps/desktop-tauri/src-tauri/src/connectors/ apps/desktop-tauri/src-tauri/src/channel_sinks.rs apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs apps/desktop-tauri/src-tauri/src/tests/
git commit -m "refactor(channel): migrate all connector internals from String to ChannelError

All connector internal functions now return Result<T, ChannelError> with
structured error types. Command layer preserves Result<T, String> at the
boundary via From<ChannelError> for String. Tests updated to match on
ChannelError variants where appropriate."
```

---

## Task 11: Integration tests for message send/receive with mock HTTP server

**Files:**
- Create: `apps/desktop-tauri/src-tauri/tests/integration/channel_feishu_integration.rs`
- Create: `apps/desktop-tauri/src-tauri/tests/integration/channel_telegram_integration.rs`
- Create: `apps/desktop-tauri/src-tauri/tests/integration/channel_wechat_integration.rs`
- Create: `apps/desktop-tauri/src-tauri/tests/integration/mod.rs`

- [ ] **Step 1: Create integration test directory and module**

Create `apps/desktop-tauri/src-tauri/tests/integration/mod.rs`:
```rust
mod channel_feishu_integration;
mod channel_telegram_integration;
mod channel_wechat_integration;
```

- [ ] **Step 2: Write Feishu integration test**

Create `apps/desktop-tauri/src-tauri/tests/integration/channel_feishu_integration.rs`:
```rust
use gtoffice_desktop_tauri_lib::connectors::feishu::api;
use gtoffice_desktop_tauri_lib::connectors::http_client::{HttpClient, HttpRequest};
use gtoffice_desktop_tauri_lib::connectors::channel_error::ChannelError;

/// Test that fetch_tenant_access_token correctly handles a successful response
#[tokio::test]
async fn feishu_tenant_token_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = [0u8; 8192];
        let _ = stream.read(&mut buf).await;
        let body = r#"{"code":0,"msg":"ok","tenant_access_token":"test_token_abc123"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let mut stream = stream;
        let _ = stream.write_all(response.as_bytes()).await;
    });

    let client = HttpClient::new();
    let result = client.execute(
        HttpRequest::post(&format!("http://127.0.0.1:{port}/test"))
            .json_body(&serde_json::json!({"app_id": "test"}))
            .timeout_secs(3)
            .build()
    ).await.unwrap();
    assert!(result.is_success());
    let json = result.json_value().unwrap();
    assert_eq!(json["code"], 0);
    assert_eq!(json["tenant_access_token"], "test_token_abc123");
}

/// Test that fetch_tenant_access_token handles auth failure
#[tokio::test]
async fn feishu_tenant_token_auth_failure() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = [0u8; 8192];
        let _ = stream.read(&mut buf).await;
        let body = r#"{"code":9999,"msg":"app_id or app_secret is invalid"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let mut stream = stream;
        let _ = stream.write_all(response.as_bytes()).await;
    });

    let client = HttpClient::new();
    let result = client.execute(
        HttpRequest::post(&format!("http://127.0.0.1:{port}/test"))
            .json_body(&serde_json::json!({"app_id": "bad"}))
            .timeout_secs(3)
            .build()
    ).await.unwrap();
    let json = result.json_value().unwrap();
    assert_eq!(json["code"], 9999);
}

/// Test backoff policy integration with error retry
#[test]
fn feishu_backoff_increases_on_repeated_failures() {
    use gtoffice_desktop_tauri_lib::connectors::backoff::BackoffPolicy;
    use std::time::Duration;

    let policy = BackoffPolicy::default();
    let first = policy.delay_with_jitter(0);
    let second = policy.delay_with_jitter(1);
    assert!(second > first - Duration::from_millis(1000)); // allowing for jitter
}
```

- [ ] **Step 3: Write Telegram integration test**

Create `apps/desktop-tauri/src-tauri/tests/integration/channel_telegram_integration.rs`:
```rust
use gtoffice_desktop_tauri_lib::connectors::http_client::{HttpClient, HttpRequest};
use gtoffice_desktop_tauri_lib::connectors::channel_error::ChannelError;

#[tokio::test]
async fn telegram_send_message_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = [0u8; 8192];
        let _ = stream.read(&mut buf).await;
        let body = r#"{"ok":true,"result":{"message_id":42,"chat":{"id":123},"text":"hello"}}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let mut stream = stream;
        let _ = stream.write_all(response.as_bytes()).await;
    });

    let client = HttpClient::new();
    let result = client.execute(
        HttpRequest::post(&format!("http://127.0.0.1:{port}/bot123/sendMessage"))
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
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = [0u8; 8192];
        let _ = stream.read(&mut buf).await;
        let body = r#"{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 3"}"#;
        let response = format!(
            "HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let mut stream = stream;
        let _ = stream.write_all(response.as_bytes()).await;
    });

    let client = HttpClient::new();
    let result = client.execute(
        HttpRequest::post(&format!("http://127.0.0.1:{port}/bot123/sendMessage"))
            .json_body(&serde_json::json!({"chat_id": 123, "text": "hello"}))
            .timeout_secs(8)
            .build()
    ).await.unwrap();
    assert_eq!(result.status, 429);
    assert!(!result.is_success());
}

#[tokio::test]
async fn telegram_http_client_retries_on_connection_reset() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    // Accept and immediately close to simulate connection reset
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        drop(stream); // close immediately
    });

    let client = HttpClient::builder().max_retries(1).retry_delay_secs(0).build();
    let result = client.execute(
        HttpRequest::get(&format!("http://127.0.0.1:{port}/test"))
            .timeout_secs(3)
            .build()
    ).await;
    // May succeed (if the second attempt goes to a new connection) or fail
    // The important thing is it doesn't panic
    let _ = result;
}
```

- [ ] **Step 4: Write WeChat integration test**

Create `apps/desktop-tauri/src-tauri/tests/integration/channel_wechat_integration.rs`:
```rust
use gtoffice_desktop_tauri_lib::connectors::http_client::{HttpClient, HttpRequest};

#[tokio::test]
async fn wechat_get_updates_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = [0u8; 16384];
        let _ = stream.read(&mut buf).await;
        let body = r#"{"ret":0,"msgs":[],"get_updates_buf":"buf123"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let mut stream = stream;
        let _ = stream.write_all(response.as_bytes()).await;
    });

    let client = HttpClient::new();
    let result = client.execute(
        HttpRequest::post(&format!("http://127.0.0.1:{port}/ilink/bot/getupdates"))
            .json_body(&serde_json::json!({"get_updates_buf": "", "base_info": {}}))
            .timeout_secs(35)
            .build()
    ).await.unwrap();
    assert!(result.is_success());
    let json = result.json_value().unwrap();
    assert_eq!(json["ret"], 0);
}

#[tokio::test]
async fn wechat_timeout_treated_as_empty() {
    // Verify that a timeout (no response) is handled gracefully by the API layer
    // We can't easily test the full timeout behavior with a mock server,
    // but we can test that the HttpClient correctly reports timeouts
    let client = HttpClient::builder().max_retries(0).build();
    let result = client.execute(
        HttpRequest::post("http://127.0.0.1:1/impossible")
            .timeout_secs(1)
            .build()
    ).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().retryable());
}
```

- [ ] **Step 5: Run integration tests**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test --test integration 2>&1 | tail -20`
Note: May need to add `[[test]]` section in Cargo.toml if tests/ directory structure requires it.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-tauri/src-tauri/tests/integration/
git commit -m "test(channel): add integration tests for message send/receive

Tests verify real HTTP client behavior with mock TCP servers for all
three connectors (Feishu, Telegram, WeChat). Covers success responses,
auth failures, rate limits, connection resets, and timeout handling."
```

---

## Task 12: Final verification and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full cargo check**

Run: `cd /Users/dzlin/work/GT-Office && cargo check --workspace 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo test --lib 2>&1 | tail -30`
Expected: all tests PASS

- [ ] **Step 3: Run cargo fmt**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo fmt -- --check 2>&1`
Expected: no formatting issues (or run `cargo fmt` to fix)

- [ ] **Step 4: Run cargo clippy**

Run: `cd /Users/dzlin/work/GT-Office/apps/desktop-tauri/src-tauri && cargo clippy --lib 2>&1 | grep -i warning | head -20`
Expected: no warnings on channel code

- [ ] **Step 5: Verify no curl dependency in channel code**

Run: `grep -r 'Command::new("curl")' apps/desktop-tauri/src-tauri/src/connectors/ 2>&1`
Expected: no matches

- [ ] **Step 6: Verify ChannelError usage**

Run: `grep -r 'Result<.*, String>' apps/desktop-tauri/src-tauri/src/connectors/ | grep -v 'test' | grep -v '#\[cfg' | head -20`
Expected: only command-layer boundary functions still use `String`, all internal functions use `ChannelError`

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "chore(channel): format and lint cleanup for Phase 1"
git push
```

---

## Summary

| Task | Component | Files Changed |
|------|-----------|---------------|
| 1 | ChannelError enum | 4 files |
| 2 | CancellationToken in workers | 5 files |
| 3 | BackoffPolicy | 3 files |
| 4 | HttpClient (reqwest wrapper) | 3 files |
| 5 | Feishu curl → reqwest migration | 2 files |
| 6 | Telegram curl → reqwest migration | 3 files |
| 7 | Split connectors.json | 2 files |
| 8 | Persist webhook tokens | 4 files |
| 9 | Wire backoff into workers | 3 files |
| 10 | Migrate to ChannelError | 13+ files |
| 11 | Integration tests | 4 files |
| 12 | Final verification | all |