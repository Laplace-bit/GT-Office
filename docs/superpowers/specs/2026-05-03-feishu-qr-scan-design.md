# Feishu QR Scan Connection — Design Spec

**Date**: 2026-05-03
**Status**: Approved

## Goal

Replace the manual App ID/Secret entry flow for Feishu connection with a one-scan QR code flow that auto-creates a self-built app, matching the OpenClaw reference implementation.

## Decisions

- **QR scan only** — no manual App ID/Secret fallback. Remove `FeishuAccountForm.tsx`.
- **Auto-detect domain** — start with `feishu.cn`, switch to `larksuite.com` if `tenant_brand=lark` during poll.
- **Replace Step 1 only** — Step 2 (route binding config) stays unchanged.
- **Rust-first approach** — OAuth device-code flow runs entirely in the Rust backend; frontend calls Tauri commands and subscribes to events.

## Backend: Rust OAuth Device-Code Flow

### New module: `apps/desktop-tauri/src-tauri/src/connectors/feishu/app_registration.rs`

Three public functions:

1. **`init_app_registration(domain: FeishuDomain)`** — POST to `{accounts_base}/oauth/v1/app/registration` with `action=init`. Verifies `client_secret` auth method is supported. Returns error if unsupported.

2. **`begin_app_registration(domain: FeishuDomain) -> BeginResult`** — POST with `action=begin, archetype=PersonalAgent, auth_method=client_secret, request_user_info=open_id`. Returns:
   ```
   BeginResult {
     device_code: String,
     qr_url: String,      // with ?from=gtoffice&tp=ob_cli_app
     user_code: String,
     interval: u32,        // seconds, default 5
     expire_in: u32,       // seconds, default 600
   }
   ```

3. **`poll_app_registration(params: PollParams) -> PollOutcome`** — POST with `action=poll, device_code=...`. Polls every `interval` seconds until success, denial, expiry, or timeout. Auto-detects domain switch when `tenant_brand=lark` and re-polls against the Lark accounts URL. Returns:
   ```
   AppRegistrationResult {
     app_id: String,
     app_secret: String,
     domain: FeishuDomain,
     open_id: Option<String>,
   }
   ```

HTTP client: `reqwest` (already in project). Content-Type: `application/x-www-form-urlencoded`.

Accounts base URLs:
- `feishu` → `https://accounts.feishu.cn`
- `lark` → `https://accounts.larksuite.com`

### New Tauri commands (in `commands/tool_adapter/mod.rs`)

- **`feishu_qr_login_start`** — calls `init_app_registration` then `begin_app_registration`. Returns `{ qr_url, device_code, user_code, expire_in }` to frontend. Starts the polling loop in a background tokio task.
- **`feishu_qr_login_cancel`** — aborts an in-progress poll via `CancellationToken`.

### Tauri events emitted during polling

| Event | Payload | Meaning |
|---|---|---|
| `feishu-qr/polling` | `{ attempt: u32 }` | Still waiting for user to scan |
| `feishu-qr/success` | `{ app_id, domain, bot_name?, open_id? }` | User scanned and app was created |
| `feishu-qr/error` | `{ message: String }` | Poll encountered an error |
| `feishu-qr/expired` | `{}` | QR code expired |

On `feishu-qr/success`:
1. Auto-call `upsert_account()` with the received `app_id`/`app_secret`/`domain`, `connectionMode=websocket`.
2. Trigger `websocket::reconcile()` to start the WebSocket connection.
3. Optionally call the Feishu API to fetch bot info for the success event payload.

### Modified: `connectors/feishu/mod.rs`

- Add `mod app_registration;`
- Expose `qr_login_start()` and `qr_login_cancel()` that wrap `app_registration` functions and manage polling state (using `Arc<Mutex<Option<JoinHandle>>>` or `CancellationToken`).

## Frontend: QR Scan Wizard Step

### New component: `apps/desktop-web/src/features/tool-adapter/feishu/FeishuQrScan.tsx`

State machine:

| State | UI |
|---|---|
| `idle` | Button: "扫码连接飞书" / "Scan QR to Connect" |
| `loading` | Spinner + "正在生成二维码..." / "Generating QR code..." |
| `scanning` | QR code SVG, countdown timer, "请使用飞书/Lark 扫描二维码" / "Scan with Feishu/Lark" |
| `success` | Green checkmark + "连接成功!" / "Connected!" |
| `error` | Error message + retry button |

Props:
```tsx
interface FeishuQrScanProps {
  locale: Locale
  onSuccess: (result: { appId: string; domain: string }) => void
  onError: (message: string) => void
}
```

Flow:
1. Click "Scan QR" → calls `desktopApi.feishuQrLoginStart()`
2. Receives `qr_url` → renders QR code using `qrcode.react`
3. Subscribes to `feishu-qr/*` Tauri events
4. On `feishu-qr/success` → calls `onSuccess`, wizard advances
5. On `feishu-qr/error` or `feishu-qr/expired` → shows error, offers retry
6. Component unmount or cancel → calls `desktopApi.feishuQrLoginCancel()`

### Modified: `FeishuConnectorWizard.tsx`

Step 0 replaced:
- Remove `<FeishuAccountForm>` import and usage
- Add `<FeishuQrScan>` component
- On QR scan success, auto-set `form.appId` and `form.domain` from the result, mark `connectionTestPassed = true`
- Step 0 guide content updated: "打开飞书/Lark 扫一扫" instead of "创建应用与开启 Bot"

### Modified: `model.ts`

- `FeishuWizardForm` — keep `appId` and `domain` fields but mark them as auto-populated (no manual input)
- Remove `appSecret` from the form (handled entirely by backend)
- Add QR scan state types

### Deleted: `FeishuAccountForm.tsx`

No longer needed since credentials are obtained via QR scan, not manual entry.

### Modified: `desktop-api.ts`

Add:
```ts
feishuQrLoginStart(): Promise<{ qr_url: string; device_code: string; user_code: string; expire_in: number }>
feishuQrLoginCancel(): Promise<void>
```

Event types for `feishu-qr/polling`, `feishu-qr/success`, `feishu-qr/error`, `feishu-qr/expired`.

### Modified: `FeishuPlatformGuide.tsx`

Update Step 0 guide content to reflect QR scan flow instead of manual app creation:
- Title: "扫码连接飞书" / "Scan QR to Connect"
- Summary: Explain that scanning creates the app automatically
- Checklist: "打开飞书/Lark 扫一扫" instead of "创建应用与开启 Bot"

### Modified: `FeishuConnectorWizard.tsx` guide builder

Update `buildGuideState()` for step 0 to match the new QR scan flow.

## Dependencies

- **Add**: `qrcode.react` npm package to `apps/desktop-web/package.json`
- **No new Rust crate dependencies** — `reqwest` is already available

## Error Handling

| Scenario | Behavior |
|---|---|
| `init` fails (environment unsupported) | Show error, offer manual guidance |
| `begin` fails (network) | Show error, offer retry |
| User denies scan | Show "access_denied" message, offer retry |
| QR expires (10 min default) | Show "expired" message, offer restart |
| Domain auto-switch to Lark | Transparent to user, poll continues against Lark |
| WebSocket reconcile fails after success | Step 2 guide explains how to check subscription |

## Not Changed

- Step 1 (route binding) wizard — completely unchanged
- WebSocket runtime (`websocket.rs`) — unchanged
- Health check / probe (`probe.rs`) — unchanged
- Credential store — unchanged (still uses OS credential store)
- Channel binding, access policy, approval — unchanged