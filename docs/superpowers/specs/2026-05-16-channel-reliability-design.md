# Channel Reliability Refactoring Design

**Date:** 2026-05-16
**Status:** Approved
**Scope:** Message send/receive stability in real network environments

## Problem Statement

The Channel system has 12 major architectural issues that compromise message delivery reliability in production:

1. Three different HTTP stacks (curl shell, reqwest, feishu_sdk) with inconsistent reliability
2. Code duplication: Telegram inbound parser 3x, Feishu bot_info 2x, webhook URL matching re-implemented
3. All errors are `String` — no programmatic error matching
4. Shared file races on `connectors.json` with no locking
5. No cancellation tokens — runtime/supervisors run forever with no clean shutdown
6. In-memory state loss on restart (WeChat context tokens, QR sessions, idempotency cache)
7. No exponential backoff — all reconnection uses fixed intervals
8. Webhook tokens regenerated on every restart, invalidating configured URLs
9. Fire-and-forget outbound sends — no retry on transient failures
10. Telegram sequential polling — all accounts polled sequentially, not concurrently
11. Manual HTTP/1.1 parser — no chunked encoding, no pipelining
12. Structured relay (headless agent) gated to Telegram-only

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | 3-phase incremental | Each phase independently shippable with tests |
| HTTP client | reqwest everywhere | Cross-platform, consistent retry/timeout/TLS, already a dependency |
| Error types | `ChannelError` enum | Programmatic matching, structured context, backward compatible via `From<ChannelError> for String` |
| Webhook tokens | Stable persisted | URLs survive restarts, rotatable via UI |

## Phase 1: Core Reliability Foundation

**Goal:** Fix issues that directly cause message loss, silent failures, and instability.

### 1a. ChannelError enum

```rust
#[derive(Debug, Clone, thiserror::Error)]
pub enum ChannelError {
    #[error("CHANNEL_AUTH_{category}: {detail}")]
    Auth { category: String, detail: String, retryable: bool },

    #[error("CHANNEL_PROVIDER_{status}: {detail}")]
    Provider { status: String, detail: String, provider_code: Option<String>, http_status: Option<u16>, retryable: bool },

    #[error("CHANNEL_PERMISSION_DENIED: {detail}")]
    PermissionDenied { detail: String, provider_code: Option<String> },

    #[error("CHANNEL_VALIDATION: {detail}")]
    Validation { detail: String },

    #[error("CHANNEL_STORE_{operation}: {detail}")]
    Store { operation: String, detail: String },

    #[error("CHANNEL_TRANSPORT: {detail}")]
    Transport { detail: String, retryable: bool },

    #[error("CHANNEL_TIMEOUT: {detail}")]
    Timeout { detail: String, retryable: bool },

    #[error("CHANNEL_CANCELLED: {detail}")]
    Cancelled { detail: String },

    #[error("CHANNEL_CONFIG: {detail}")]
    Config { detail: String },

    #[error("CHANNEL_UNSUPPORTED: {detail}")]
    Unsupported { detail: String },
}
```

- `retryable` flag drives automatic retry decisions
- `From<ChannelError> for String` preserves backward compatibility
- **Phase 1 scope:** Migrate connector internal functions, runtime, and sinks to `Result<T, ChannelError>`. Command layer (`commands/tool_adapter/`) keeps `Result<T, String>` and uses `.to_string()` at the boundary until Phase 3.
- Existing error prefix conventions map directly to variants

**Files:** New `crates/channel-error/` or inline in `connectors/` with re-exports.

### 1b. Cancellation & Graceful Shutdown

- `AppShutdownToken` — single `CancellationToken` owned by `AppState`, cloned by all long-running workers
- Add to: `channel_adapter_runtime`, feishu websocket supervisor, wechat polling supervisor, telegram polling worker
- Workers use `tokio::select!` on token.cancelled() vs work
- `shutdown()` function: cancel token → await JoinHandles with 5s timeout → log warnings for hung workers
- Remove `OnceLock<RwLock<HashMap<String, JoinHandle<()>>>>` worker tracking — replace with structured `WorkerRegistry` that supports cancellation

### 1c. Exponential Backoff with Jitter

```rust
struct BackoffPolicy {
    initial_ms: u64,    // 5000
    max_ms: u64,        // 300000
    factor: f64,        // 2.0
    jitter: f64,        // 0.1
    max_attempts: u32,  // 10
}
```

- Replace all fixed intervals:
  - Feishu websocket: SDK `reconnect_interval(10s)` → keep SDK setting, add backoff for worker restart
  - Telegram polling: 1.5s → backoff on error, immediate on success
  - WeChat polling: 3s/10s → backoff on error, immediate on success
  - HTTP retries: `run_curl_json` retry logic → reqwest retry middleware
- Per-account restart tracking in `WorkerRegistry`
- `manually_stopped: HashSet<String>` prevents auto-restart after intentional stops

### 1d. reqwest Migration

- Create shared `HttpClient` wrapper in `connectors/`:
  ```rust
  struct HttpClient {
      client: reqwest::Client,
      connect_timeout: Duration,
      request_timeout: Duration,
  }
  ```
- Timeouts: connect=8s, getUpdates=30s, sendMessage=25s, others=8s
- Retry: max 2 retries on transport errors (timeout, connection reset, TLS)
- Replace `run_curl_json` in Feishu `api.rs` and Telegram `api.rs`
- Keep `feishu_sdk::Client` for message send (it manages tenant tokens internally)
- Remove `Command::new("curl")` dependency entirely

### 1e. File Locking for Shared Store

**Decision: Split into per-connector files**
- `channel/feishu-connectors.json`
- `channel/telegram-connectors.json`
- `channel/wechat-connectors.json` (already separate)
- Eliminates shared-file races entirely
- Migration: on first load, read old `connectors.json`, split into new files, keep old as `connectors.json.bak`

### 1f. Stable Persisted Webhook Tokens

- `channel/runtime-tokens.json`: `{ "feishu_token": "...", "telegram_token": "..." }`
- Generate on first run, persist, load on subsequent starts
- Rotation via `channel_rotate_webhook_tokens` command
- On token change: emit event to frontend, auto-trigger `sync_runtime_webhook` for affected connectors

**Phase 1 Test Coverage:**
- Unit: ChannelError variants, backoff computation, token persistence, HttpClient retry behavior
- Integration: send/receive with mock HTTP server (mockito or wiremock-rs)
- Existing 464 tests must continue passing

---

## Phase 2: State Persistence & Deduplication

**Goal:** No message loss or duplicate processing across restarts and race conditions.

### 2a. Context Token Persistence (WeChat)

- Persist `CONTEXT_TOKENS` map to `channel/wechat-context-tokens.json`
- Load on startup, write-through on token update
- TTL: expire tokens older than 24h (WeChat session validity)

### 2b. Idempotency Cache Persistence

- Persist recent message_ids to `channel/idempotency-cache.json`
- LRU with max 10,000 entries
- Expire entries older than 1 hour
- Load on startup

### 2c. Telegram Offset Store Hardening

- Atomic writes: write to temp file + rename
- `should_accept_offset_state` validation already done (from current uncommitted work)

### 2d. Start-Gate Pattern

- Per-account `startGate` promise prevents concurrent startups
- If account A is starting, a second `reconcile` call for A awaits the existing gate
- Eliminates race between supervisor reconcile and manual account operations

### 2e. Task-Scoped Resource Tracking

- `WorkerContext` struct tracks resources allocated per account worker
- On worker exit: auto-cleanup context tokens, runtime status markers, rate limit entries
- Prevents resource leaks from crashed workers

**Phase 2 Test Coverage:**
- Unit: token persistence round-trip, idempotency cache eviction, atomic file writes
- Integration: restart simulation (persist → kill → reload → verify state)
- Concurrency: start-gate race condition test, concurrent file access test

---

## Phase 3: Architecture Cleanup & Extensibility

**Goal:** Reduce duplication, generalize relay, improve maintainability.

### 3a. Deduplicate Telegram Inbound Parser

- Single canonical implementation in `connectors/telegram/inbound.rs`
- `channel_adapter_runtime.rs` imports and delegates
- `mod.rs` callback handling imports and delegates
- ~200 lines of duplicated code removed

### 3b. Deduplicate Feishu Bot Info Fetch

- `api::get_bot_info` is the canonical implementation
- `app_registration.rs` delegates to it instead of re-implementing

### 3c. Generalize Structured Relay

- Remove Telegram-only gate in `process_external_inbound_message`
- Each channel declares relay capability in `ChannelSinkCapabilities`
- Feishu and WeChat get relay support based on their capabilities

### 3d. Replace Manual HTTP Parser

- Replace hand-rolled HTTP/1.1 parser in `channel_adapter_runtime.rs` with `hyper`
- Supports chunked encoding, proper keep-alive, content negotiation
- Reduces ~300 lines of manual parsing code

### 3e. Shared Channel Trait

```rust
trait ChannelConnector {
    fn list_accounts(&self, app: &AppHandle) -> Result<Vec<AccountView>, ChannelError>;
    fn upsert_account(&self, app: &AppHandle, input: AccountInput) -> Result<AccountView, ChannelError>;
    fn health_check(&self, app: &AppHandle, account_id: &str) -> Result<HealthSnapshot, ChannelError>;
    fn send_text(&self, app: &AppHandle, account_id: &str, peer_id: &str, text: &str, reply_to: Option<&str>) -> Result<SendSnapshot, ChannelError>;
    fn reconcile_workers(&self, app: &AppHandle, state: &AppState);
    fn shutdown(&self);
}
```

- Feishu, Telegram, WeChat implement the trait
- Command layer dispatches through trait instead of per-connector function calls
- Enables adding new channels without touching the command layer

### 3f. Admin/Debug UI Improvements

- Channel health dashboard: per-account status, last error, reconnect count
- Webhook token rotation button
- Account error detail view (structured, not just "provider unavailable")
- Connection mode indicator (websocket connected / polling active / webhook registered)

**Phase 3 Test Coverage:**
- Contract tests: verify trait implementation compliance for each connector
- E2E: send message through mock provider → verify receipt in agent
- UI: component tests for health dashboard

---

## Cross-Cutting Concerns

### Logging & Observability
- `tracing` spans for: account lifecycle, message send, message receive, worker restart
- Structured metrics in `ChannelAdapterRuntimeMetricsSnapshot` extended with per-channel counters
- Health evaluation inspired by OpenClaw: busy-aware, lifecycle-aware, connect grace period

### Test Infrastructure
- Unit tests: `tests/unit/` directory, pure function tests, mock-based
- Integration tests: `tests/integration/` directory, mock HTTP server, file system temp dirs
- E2E tests: `tests/e2e/` directory, full stack with mock providers
- No file > 500 lines
- Coverage target: >= 90% for channel-specific logic

### File Size Limits
- `channel_adapter_runtime.rs` (1037 lines) → split into: runtime server, HTTP handler, rate limiter, runtime file
- `channel_sinks.rs` (611 lines) → split into: sink dispatch, telegram keyboard, text formatting
- `commands/tool_adapter/mod.rs` (3671 lines) → not in scope for this refactoring (separate effort)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| reqwest migration breaks Telegram retry logic | Port retry logic to reqwest middleware, test thoroughly with mock server |
| ChannelError migration causes compile errors across codebase | `From<ChannelError> for String` backward compat, incremental migration |
| File splitting causes data loss on upgrade | Migration: read old `connectors.json`, write to new files, keep old file as backup |
| Stable tokens create security surface | Tokens are UUIDs in URL path (not headers), loopback-only server, rotation command available |
| Backoff delays make debugging feel slow | Log backoff state, provide `reset_backoff` debug command |

## Success Criteria

- [ ] All Phase 1 items implemented with tests
- [ ] `cargo check --workspace` passes
- [ ] `cargo test --workspace` passes with >= 90% coverage on channel logic
- [ ] No `unwrap()` on fallible paths in channel code
- [ ] No silent `let _ = ...` on error-returning operations
- [ ] No curl dependency in channel code
- [ ] Channel workers cleanly shutdown on app exit
- [ ] Webhook URLs survive app restart
- [ ] Message send/receive works end-to-end with mock providers