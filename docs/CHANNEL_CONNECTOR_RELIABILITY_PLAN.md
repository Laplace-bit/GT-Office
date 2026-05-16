# Channel Connector Reliability Plan

## Scope

This plan covers the external channel connector path used by Telegram, Feishu, and WeChat, with extra detail on Feishu because the observed production error is:

```text
CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE: api error: code=230002, msg=Bot/User can NOT be out of the chat.
```

## Configuration Model

Channel configuration is persisted through the tool adapter command surface and consumed by connector modules.

Key entry points:

- `channel_connector_account_upsert`: validates and stores connector account settings.
- `channel_connector_account_list`: returns sanitized account views.
- `channel_connector_health`: probes credentials and runtime state.
- `channel_connector_webhook_sync`: shows the callback URL that must be configured in provider consoles.
- `channel_binding_upsert`: binds a channel/account/peer selector to a workspace agent or role.
- `channel_external_inbound`: accepts already-normalized inbound messages from local or provider runtimes.

Feishu account fields:

- `account_id`: local connector account key, defaulting to `default`.
- `enabled`: hard gate for health checks and outbound sends.
- `connection_mode`: `websocket` or `webhook`.
- `domain`: `feishu` or `lark`.
- `app_id` and `app_secret_ref`: app credentials used for tenant access tokens and outbound API calls.
- `verification_token_ref`: required for webhook mode configuration.
- `webhook_host`, `webhook_port`, `webhook_path`: fallback callback construction when runtime callback URL is unavailable.

## Receive Chain

Webhook mode:

1. `channel_adapter_runtime::spawn` starts a local loopback HTTP runtime.
2. The runtime publishes per-boot callback URLs in `.gtoffice/runtime/channel-adapter.json`.
3. Feishu/Telegram provider webhook calls hit `/webhook/{provider}/{runtime_token}`.
4. `route_request` enforces token, JSON content type, body size, timeouts, and rate limits.
5. Provider payload parsing converts raw JSON into `ExternalInboundMessage`.
6. `process_external_inbound_message` handles idempotency, access policy, route binding, and dispatch to the target agent terminal.
7. Runtime metrics record dispatched, duplicate, denied, route-not-found, invalid, timeout, and failed cases.

Feishu websocket mode:

1. `connectors::feishu::websocket::spawn_supervisor` runs at Tauri startup.
2. `websocket::reconcile` starts/stops worker tasks for enabled Feishu websocket accounts that are currently needed by channel bindings.
3. The Feishu SDK event handler serializes incoming events to JSON.
4. `parse_payload_for_account` normalizes the payload into `ExternalInboundMessage`.
5. `process_external_inbound_message` performs the same routing and dispatch logic as webhook mode.

Worker selection rules:

- The account must be enabled.
- The account `connection_mode` must be `websocket`.
- A current binding must require `("feishu", account_id)`; account ids are normalized to lowercase.
- Finished or no-longer-needed workers are removed and marked disconnected.

## Send Chain

Agent replies are sent through `tool_adapter::spawn_external_reply_flush_worker`:

1. `AppState` binds an external reply session to a terminal session.
2. Terminal output and rendered screen snapshots are ingested.
3. `take_external_reply_dispatch_candidates` decides preview/finalize dispatches.
4. `channel_sinks::deliver_reply_text` selects the provider sink.
5. Feishu calls `connectors::feishu::send_text_reply`.
6. If `reply_to_message_id` is present, Feishu first calls `im.v1.message.reply`.
7. If the reply target was withdrawn or is missing, it falls back to `im.v1.message.create` with `receive_id_type=chat_id`.
8. Other provider errors, including `230002 Bot/User can NOT be out of the chat`, are returned without fallback because they indicate membership/permission/configuration problems.
9. Channels without preview-edit support, including Feishu and WeChat, reject preview delivery before calling provider send APIs to avoid duplicate preview/finalize messages.
10. Telegram, Feishu, and WeChat reject blank peer ids and blank text before account lookup, context lookup, or provider send APIs. This keeps invalid input from being misreported as connector-not-found, context-missing, or provider-unavailable.

## Known Failure Classes

- Bot is not in the chat or cannot speak: Feishu `230002`. This is classified as `CHANNEL_CONNECTOR_PERMISSION_DENIED` while preserving the original code, request id, and HTTP status. Fix by adding the bot to the group or checking group send permission.
- Stale or withdrawn reply target: Feishu `230011` or `231003`. The code falls back to direct chat send.
- Webhook callback mismatch: health check reports `webhook_matched=false`; copy the runtime callback URL from GT Office into Feishu Open Platform.
- Runtime not reachable: local runtime has no snapshot or provider cannot reach the callback endpoint.
- Websocket worker not started: account is disabled, configured for webhook mode, not referenced by a binding, or account id casing does not normalize to the binding key.
- Invalid webhook token: rejected before rate limiting so unauthorized traffic cannot consume the valid provider budget.
- Invalid HTTP `Content-Length`: rejected with `CHANNEL_HTTP_CONTENT_LENGTH_INVALID` instead of silently treating the request as bodyless.
- Wrong account id mapping: inbound `account_id` must match stored connector/binding account id; websocket parsing uses the configured account id hint.
- Missing route binding or access approval: inbound message is accepted but not dispatched.
- Provider rate limiting or transient HTTP failure: surfaced as provider unavailable with the provider code/request id preserved.
- WeChat QR ids containing query-significant characters (`+`, `&`, `=`) must be URL-encoded before QR status polling.
- Telegram webhook sync uses JSON request bodies so callback URLs and secret tokens containing query-significant characters are not split as form fields.
- Telegram edit/delete rejects non-numeric, zero, or negative message ids before account lookup, token load, or provider calls so bad input is reported as validation failure instead of provider instability.
- Telegram outbound JSON builders now omit invalid `reply_to_message_id` values unless they are positive numeric ids, preventing avoidable provider-side send failures.
- Telegram outbound `chat_id` normalization trims peer ids before deciding numeric versus string JSON encoding, avoiding malformed string chat ids from whitespace-padded account data.
- Telegram outbound provider errors now map obvious peer and permission failures such as blocked bot, missing chat, kicked bot, and missing rights to `CHANNEL_CONNECTOR_PERMISSION_DENIED` instead of transient provider unavailability.
- Telegram runtime webhook inbound uses `X-Telegram-Bot-Api-Secret-Token` to resolve the configured webhook account instead of assigning every webhook message to `default`; unmatched non-empty secrets are rejected as invalid.
- Telegram inbound update parsing rejects negative and `i64`-overflowing `update_id` values instead of wrapping them into invalid polling cursors or fallback message ids.
- Telegram polling offset state now rejects negative `lastUpdateId` values from corrupted state files, ignores negative in-memory offset writes, and rejects negative offset persistence before touching disk.
- Telegram polling getUpdates form construction ignores negative offsets defensively instead of passing Telegram's special negative offset semantics through to production polling.
- Telegram polling update id parsing now ignores negative and `i64`-overflowing provider values instead of wrapping them into invalid cursors.
- Telegram preview delivery result no longer reports continuation chunks that were not actually sent; continuation count is recorded only on finalize.
- Feishu custom webhook paths are normalized at account upsert and runtime callback construction to include a leading slash, preventing malformed callback URLs such as `http://host:3000custom/events`.
- Feishu outbound send input validation is isolated and covered so blank peer/text failures return local `CHANNEL_CONNECTOR_SEND_INVALID` errors before credential or provider calls.
- Feishu provider error classification recognizes `230002` in JSON HTTP bodies such as `{"code":230002}` so bot-not-in-chat failures are reported as `CHANNEL_CONNECTOR_PERMISSION_DENIED`, not generic provider outage.
- Feishu QR registration tracking parameters now inspect the query string precisely and preserve URL fragments instead of skipping valid URLs whose path merely contains `from=`.
- WeChat bot token headers trim stored token values and reject blank tokens locally with `CHANNEL_CONNECTOR_AUTH_INVALID`.
- WeChat reply context tokens are trimmed, blank context values are ignored, and missing reply context fails locally with `CHANNEL_CONNECTOR_CONTEXT_MISSING` before provider send.
- WeChat polling sync cursor filenames now normalize unsafe account-id path characters instead of writing nested or malformed paths.

## Stability And Reliability Checks

Manual configuration checks:

1. Account exists, enabled, and has valid secret references.
2. Feishu websocket mode shows runtime connected after startup.
3. Feishu webhook mode health shows matching runtime callback URL.
4. Route binding exists for the account/channel/peer and points to an available target agent or role.
5. For group replies, the bot is in the group and has permission to send messages.
6. Provider errors preserve code, message, request id, and HTTP status in logs/UI.

Automated gates:

1. `cargo fmt --check --package gtoffice-desktop-tauri`
2. `cargo test -p gtoffice-desktop-tauri feishu --lib`
3. `cargo test -p gtoffice-desktop-tauri telegram --lib`
4. `cargo test -p gtoffice-desktop-tauri wechat --lib`
5. `cargo test -p gtoffice-desktop-tauri channel_adapter --lib`
6. `cargo test -p gtoffice-desktop-tauri channel_sinks --lib`
7. `cargo test -p gtoffice-desktop-tauri --lib`
8. `cargo llvm-cov --package gtoffice-desktop-tauri --lib --summary-only --ignore-filename-regex '/tests/'`

Coverage target:

- The current full desktop Tauri library baseline from `cargo llvm-cov --package gtoffice-desktop-tauri --lib --summary-only --ignore-filename-regex '/tests/'` is 42.67% line coverage. Repository-wide 90% requires a separate large hardening effort across commands, git, settings, bridges, and all connectors.
- For this channel reliability pass, the immediate gate is at least 90% line coverage for the narrow logic that is safe to unit-test without real provider credentials: payload normalization, provider request body contracts, webhook URL construction, send fallback policy, content-type parsing, and HTTP error classification.
- Real provider E2E is required before claiming live stability: one Feishu websocket account, one Feishu webhook account, one group chat with the bot present, and one direct chat target.

Current verified unit-test status:

- `cargo test -p gtoffice-desktop-tauri feishu --lib`: 62 passed.
- `cargo test -p gtoffice-desktop-tauri telegram --lib`: 54 passed.
- `cargo test -p gtoffice-desktop-tauri wechat --lib`: 29 passed.
- `cargo test -p gtoffice-desktop-tauri channel_sinks --lib`: 16 passed.
- `cargo test -p gtoffice-desktop-tauri channel_adapter_runtime --lib`: 29 passed.
- `cargo test -p gtoffice-desktop-tauri file_explorer::preview --lib`: 5 passed.
- `cargo test -p gtoffice-desktop-tauri status_coordinator --lib`: 4 passed.
- `cargo test -p gtoffice-desktop-tauri --lib`: 464 passed.

## Test Matrix

Unit tests:

- Feishu URL verification payload.
- Feishu group text payload.
- Feishu direct/non-text payload.
- Feishu account-id hint precedence.
- Feishu malformed payload errors.
- Feishu create API request contract.
- Feishu reply API request contract.
- Feishu tenant token response parsing, missing-token handling, and auth failure classification.
- Feishu bot info parsing, inactive bot classification, and bot name/open id normalization.
- Feishu provider error code preservation.
- Feishu fallback only for withdrawn/missing reply targets.
- Telegram text payload.
- Telegram callback payload.
- Telegram channel post/caption fallback.
- Telegram send/edit input validation.
- Telegram send/edit/delete/callback provider response parsing and error classification.
- WeChat send input validation.
- WeChat endpoint URL construction.
- WeChat send body contract including context token and client id.
- Runtime JSON content type acceptance and rejection.
- Runtime HTTP read error to status mapping.
- Runtime rate-limit accounting.
- Runtime HTTP parser no-body GET handling.
- Runtime HTTP parser short-body EOF handling.
- Feishu app registration QR tracking parameter, account-domain URL, and bot name normalization helpers.
- Feishu shared account-store schema round-trip with Telegram sidecar preservation.
- Feishu API base URLs, nested message content escaping, successful message ID trimming, and missing message ID errors.
- WeChat QR polling state normalization for `wait`, `scaned`, `scanned`, `expired`, and unexpected provider statuses.
- Channel sink finalize preflight for Feishu/WeChat and Telegram semantic-button keyboard grouping.
- Channel sink interaction prompt delivery now covers local no-prompt, no-button, and clear-without-message branches before provider access.
- Channel sink interaction prompt preflight rejects unsupported channels before provider calls.
- Channel adapter runtime snapshot and metrics mutation for health/diagnostic visibility.
- Tool adapter external inbound title, preview, account normalization, truncation, and summary helpers.
- File preview metadata, MIME/binary detection, image thumbnail generation, and invalid input errors.
- Git status coordinator snapshot payload, fingerprint, and not-a-git-repository error classification.
- Keybinding and security health command response contracts.
- Workspace surface window label/title/url/payload construction contracts.
- Daemon bridge address parsing and daemon search event frontend payload conversion.
- Terminal debug log entry construction and build-mode write gates.
- Terminal debug human reply de-duplication, incremental merge, punctuation completion, clear, and retained log limit behavior.
- Process command configuration wrappers.
- AI provider live config import parsing for Claude, Codex, and Gemini official/custom local config files.
- External tool terminal screen profile IDs, prompt prefixes, and assistant markers.
- AI config model endpoint candidate derivation, endpoint validation preflight, and updater error categorization.
- Channel sink preflight, WeChat/Feishu preview rejection, Telegram interaction keyboard grouping, and plain-channel prompt text.
- Channel sink continuation count semantics for preview versus finalize phases.
- Channel adapter runtime file persistence for webhook URLs and runtime metadata.
- Feishu provider response parsing for bot info, message IDs, membership-denied code 230002, and default provider error messages.
- Feishu auth and bot-info provider errors now trim blank `msg` values before falling back to stable defaults.
- Feishu provider error diagnostics preservation for `request_id` and `http_status`.
- Feishu message-send provider errors now trim blank `msg` values and fall back to a stable default message.
- Feishu health check local branches now cover missing and disabled accounts without provider calls.
- Feishu send-policy matching for `code=`, `code =`, `code:`, and `code :` without false positives on `error_code`.
- Feishu send-policy matching for JSON `"code":230002` and `'code':230002` without false positives on `error_code`.
- Feishu outbound send input validation before credential or provider access.
- Feishu send-reply local failures now cover missing and disabled accounts before credential or provider access.
- Feishu webhook path normalization at account upsert and callback URL construction when custom paths omit the leading slash.
- Feishu websocket worker selection for enabled/bound websocket accounts.
- Feishu websocket runtime connected status tracking.
- Feishu QR registration URL tracking parameter insertion for existing query parameters, existing `from` query parameter, path-only `from=` text, and fragments.
- Feishu QR poll provider error states now trim and case-normalize before action mapping.
- Feishu QR registration init now trims and case-normalizes supported auth methods before requiring `client_secret`.
- Feishu QR registration begin response conversion applies stable interval/expiry defaults and tracking parameters.
- Feishu QR registration tenant-brand domain switching now trims and case-normalizes `lark`, and remains one-shot after switching.
- Telegram offset-store legacy compatibility plus version, bot-id, persisted negative cursor rejection, in-memory negative cursor rejection, and real file read/write round trips via Tauri mock app.
- Telegram polling offset cache, priming state, and callback-query metadata extraction.
- Telegram getUpdates form fields for absent, zero, positive, and negative offsets.
- Telegram polling max update id extraction for valid, negative, missing, and overflowing update ids.
- Telegram runtime webhook account routing from provider secret header.
- Telegram health webhook URL matching now trims configured and runtime URLs before comparison.
- Telegram setWebhook JSON body construction for URL and secret-token safety.
- Telegram outbound JSON body construction for send/edit/delete/chat-action/callback-answer calls.
- Telegram inline keyboards now trim button fields, drop invalid empty buttons/rows, and omit empty markup before provider calls.
- Telegram outbound chat id trimming before numeric/string JSON encoding.
- Telegram provider error classification for peer/permission failures versus retryable provider failures.
- Telegram outbound provider descriptions now trim blank values and fall back to stable per-operation defaults.
- Telegram provider read responses for getMe, getWebhookInfo, and getUpdates now have pure response parsers covered for success, provider failure, and optional fields.
- Telegram send-reply local failures now cover missing and disabled accounts before credential or provider access.
- Telegram health check local branches now cover missing and disabled accounts without provider calls.
- Telegram account upsert/list now covers token persistence, webhook-secret persistence, normalized config updates, and missing-token rejection.
- Telegram webhook sync, typing action, edit, delete, and callback answer now cover validation, missing-account, and disabled-account failures before provider access.
- Telegram inbound webhook update id extraction for valid, negative, missing, and overflowing update ids.
- Telegram edit/delete message id validation before provider calls.
- Channel runtime HTTP parser malformed-header, invalid UTF-8, missing-path, and invalid Content-Length rejection.
- Channel runtime HTTP parser oversized-header, oversized declared body, and oversized streaming body rejection.
- WeChat auth cancellation cleanup and QR status response parsing.
- WeChat bot token header trimming and blank-token rejection.
- WeChat QR status URL encoding for provider QR ids with query-significant characters.
- WeChat provider API base URLs now trim surrounding whitespace as well as trailing slashes before building endpoint URLs.
- WeChat polling sync cursor filename normalization for blank, simple, and path-unsafe account ids.
- WeChat connector store and polling sync cursor round-trip tests against a Tauri mock app data directory.
- WeChat health check local branches now cover missing and disabled accounts without provider calls.
- WeChat polling worker account selection now has pure coverage for enabled/bound account filtering, case normalization, sorting, and deduplication.
- WeChat send-reply local failures now cover missing accounts, disabled accounts, and missing reply context before provider calls.
- WeChat store-backed tests use an in-module lock to avoid shared mock-app data directory races.
- WeChat reply context token trimming, blank-token rejection, and missing-context local failure.
- WeChat `getupdates` provider error details now trim blank `errmsg` values and fall back to a stable error-code detail.
- WeChat provider API calls now have local HTTP stub tests covering request headers/bodies/URLs plus HTTP and invalid JSON failures.
- WeChat auth status now covers terminal sessions returning locally without provider polling plus missing-session and missing-QR local errors.
- Channel adapter runtime parsing now covers blank Telegram account fallback, missing chat ids, and HOME/USERPROFILE runtime-file fallback behavior.
- Feishu QR app-registration provider POST now has local HTTP stub coverage for form encoding, provider 400 pending JSON, non-400 HTTP failures, invalid JSON, and bounded diagnostic bodies.
- Telegram provider curl wrapper now has fake-curl coverage for successful JSON, invalid JSON, non-retry provider failures, and retryable timeout recovery.
- Telegram provider endpoint wrappers now have fake-curl coverage for getMe, webhook info, set/delete webhook, getUpdates, chat action, send, edit, delete, and callback answer calls.
- WeChat connector account lifecycle now covers upsert/list default preservation, access-policy initialization listing/marking, and fixes trimming of account ids in `mark_access_policy_initialized`.
- Feishu provider curl-backed token and bot-info wrappers now have fake-curl coverage for success, transport failure, and invalid JSON paths.
- WeChat auth status polling now has local provider-stub coverage for awaiting scan, scanned, expired, and confirmed-without-token failure states.
- WeChat auth confirmed success now has local provider-stub coverage that verifies account binding, token persistence, and connector config visibility.
- Feishu QR app-registration bot-info enrichment now has local HTTP stub coverage for tenant-token lookup, bot-name lookup, non-fatal missing/provider-error payloads, and parse failures.

Integration tests with mock providers:

- Webhook request with invalid token returns 401.
- Invalid JSON returns 400 and increments invalid metrics.
- URL verification returns challenge without dispatch.
- Valid inbound dispatch maps to route and target agent.
- Duplicate inbound message is ignored.
- Denied access policy is surfaced without terminal dispatch.
- Reply finalize dispatch sends once and retries only after failed delivery.

Live E2E checks:

- Feishu websocket receives group message and dispatches to bound agent.
- Feishu webhook receives URL verification and group message.
- Feishu group reply succeeds when bot is present.
- Feishu `230002` is reported as `CHANNEL_CONNECTOR_PERMISSION_DENIED` configuration/membership failure, not hidden by fallback.
- Feishu stale reply target falls back to direct group send.
- Runtime restart updates webhook URL file and health snapshot.
