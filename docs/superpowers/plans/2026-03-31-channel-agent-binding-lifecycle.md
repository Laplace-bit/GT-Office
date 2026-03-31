# Channel Agent Binding Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make channel-to-agent bindings safe across agent deletion and editing by adding binding enable/disable state, direct-target validation, and a guided cleanup flow for deleting bound agents.

**Architecture:** Keep `ChannelRouteBinding` as the shared route model in `vb-task`, but extend it with an `enabled` flag and route-matching semantics that skip disabled bindings. Split Tauri command logic into focused helper modules: one for binding persistence and target validation under `commands/tool_adapter/`, and one for agent-delete cleanup policy under `commands/agent/`. On the frontend, extend the desktop API contract, add a pure cleanup-dialog model, and keep station deletion UI inside `workspace-hub` while channel binding toggles stay in `tool-adapter`.

**Tech Stack:** Rust, Tauri commands, existing SQLite agent repository, JSON channel state persistence, React 19, TypeScript, SCSS, existing `node:test` web test harness, existing Cargo test suite.

---

## File Structure

### Files to create

- `apps/desktop-tauri/src-tauri/src/commands/agent/binding_cleanup.rs`
  - Agent-delete dependency discovery and cleanup-policy execution for direct-agent channel bindings.
- `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_store.rs`
  - Channel binding persistence helpers, shared list/update/delete helpers, and route-binding filtering utilities.
- `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_target_validation.rs`
  - Validation helpers for direct agent targets and dispatch-time target availability checks.
- `apps/desktop-web/src/features/workspace-hub/station-delete-binding-cleanup-model.ts`
  - Pure helpers for delete-dialog strategy state, backend-error parsing, and confirm-button gating.
- `apps/desktop-web/src/features/workspace-hub/StationDeleteBindingCleanupDialog.tsx`
  - Modal for rebind/disable/delete cleanup strategies when a station delete is blocked by channel bindings.
- `apps/desktop-web/tests/station-delete-binding-cleanup-model.test.ts`
  - Pure tests for frontend cleanup-state logic.

### Files to modify

- `crates/vb-task/src/lib.rs`
  - Add `enabled` to `ChannelRouteBinding`, normalize it, skip disabled bindings during route matching, and expose any minimal helper needed by Tauri command code.
- `crates/vb-task/tests/lib_tests.rs`
  - Add route-matching tests for disabled bindings and direct-target behavior.
- `apps/desktop-tauri/src-tauri/src/commands/agent.rs`
  - Extend `AgentDeleteRequest`/response, delegate cleanup work to `binding_cleanup`, and keep entry-layer logic thin.
- `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs`
  - Delegate channel binding persistence/restore/write validation to the new helper modules and add dispatch-time target validation.
- `apps/desktop-tauri/src-tauri/src/mcp_bridge.rs`
  - Accept the expanded `AgentDeleteRequest` payload for MCP bridge deletes.
- `apps/desktop-tauri/src-tauri/src/tests/channel_adapter_tests.rs`
  - Add focused tests for stale direct-target validation and persisted-binding compatibility.
- `apps/desktop-web/src/shell/integration/desktop-api.ts`
  - Extend `ChannelRouteBinding`, `AgentDeleteRequest`, and `AgentDeleteResponse` contracts for `enabled` and cleanup metadata.
- `apps/desktop-web/src/features/tool-adapter/ChannelManagerPane.tsx`
  - Support enabled/disabled binding updates and refresh status messages.
- `apps/desktop-web/src/features/tool-adapter/ChannelBotCard.tsx`
  - Add a visible enable/disable action and status indicator for each binding.
- `apps/desktop-web/src/features/workspace-hub/StationManageModal.tsx`
  - Invoke the cleanup dialog when delete is blocked and complete the selected cleanup strategy.
- `apps/desktop-web/src/features/workspace-hub/index.ts`
  - Export the new delete-cleanup dialog if required by existing feature boundaries.
- `apps/desktop-web/src/shell/layout/ShellRoot.tsx`
  - Handle structured delete responses and wire station deletion through the cleanup dialog flow.
- `apps/desktop-web/src/shell/i18n/messages.ts`
  - Add copy for binding status, cleanup strategies, and structured delete errors.

### Testing and verification files

- `apps/desktop-tauri/src-tauri/src/tests/mod.rs`
  - Modify only if the new or moved test module requires registration.

---

### Task 1: Add failing shared-model tests for binding enable/disable behavior

**Files:**
- Modify: `crates/vb-task/tests/lib_tests.rs`
- Modify: `crates/vb-task/src/lib.rs`

- [ ] **Step 1: Write the failing Rust tests for disabled bindings**

Add tests in `crates/vb-task/tests/lib_tests.rs` covering:

- route resolution skips a disabled binding and falls back to an enabled match
- route resolution returns `None` when the only matching binding is disabled
- binding updates preserve matching semantics after toggling `enabled`

Test shape:

```rust
#[test]
fn resolve_external_route_skips_disabled_bindings() {
    let service = TaskService::default();
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-1".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-disabled".to_string(),
        priority: 200,
        created_at_ms: None,
        bot_name: None,
        enabled: false,
    });
    service.upsert_route_binding(ChannelRouteBinding {
        workspace_id: "ws-1".to_string(),
        channel: "telegram".to_string(),
        account_id: Some("default".to_string()),
        peer_kind: Some(ExternalPeerKind::Direct),
        peer_pattern: None,
        target_agent_id: "agent-live".to_string(),
        priority: 100,
        created_at_ms: None,
        bot_name: None,
        enabled: true,
    });

    let route = service.resolve_external_route(&sample_inbound());
    assert_eq!(route.expect("route").target_agent_id, "agent-live");
}
```

- [ ] **Step 2: Run the targeted Rust tests to verify failure**

Run:

```bash
cargo test -p vb-task resolve_external_route_skips_disabled_bindings -- --nocapture
```

Expected: FAIL because `ChannelRouteBinding` does not yet have an `enabled` field and matching still includes all bindings.

- [ ] **Step 3: Implement the minimal shared-model change**

Update `crates/vb-task/src/lib.rs`:

- add `enabled: bool` to `ChannelRouteBinding` with serde default
- normalize missing values to `true`
- skip disabled bindings in route matching

Minimal implementation target:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRouteBinding {
    pub workspace_id: String,
    pub channel: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub peer_kind: Option<ExternalPeerKind>,
    #[serde(default)]
    pub peer_pattern: Option<String>,
    pub target_agent_id: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub created_at_ms: Option<u64>,
    #[serde(default)]
    pub bot_name: Option<String>,
    #[serde(default = "default_binding_enabled")]
    pub enabled: bool,
}
```

And in matching:

```rust
if !binding.enabled {
    continue;
}
```

- [ ] **Step 4: Run the targeted Rust tests to verify they pass**

Run:

```bash
cargo test -p vb-task resolve_external_route_skips_disabled_bindings -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Run the broader `vb-task` binding-related tests**

Run:

```bash
cargo test -p vb-task -- --nocapture
```

Expected: PASS with no regressions in existing route-binding behavior.

- [ ] **Step 6: Commit the shared-model change**

Run:

```bash
git add crates/vb-task/src/lib.rs crates/vb-task/tests/lib_tests.rs
git commit -m "feat: add channel binding enabled state"
```

### Task 2: Add failing backend tests for delete cleanup and stale-target validation

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/tests/channel_adapter_tests.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/agent.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/mcp_bridge.rs`
- Create: `apps/desktop-tauri/src-tauri/src/commands/agent/binding_cleanup.rs`
- Create: `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_store.rs`
- Create: `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_target_validation.rs`

- [ ] **Step 1: Write failing tests for stale direct targets and cleanup policy**

Add tests in `apps/desktop-tauri/src-tauri/src/tests/channel_adapter_tests.rs` covering:

- persisted binding missing `enabled` restores as enabled
- dispatch-time validation rejects a direct-agent target that no longer exists
- agent delete without cleanup mode returns blocking bindings
- agent delete with `disable` turns dependent bindings off
- agent delete with `delete` removes dependent bindings
- agent delete with `rebind` updates dependent bindings to the replacement agent

Suggested test skeleton for cleanup:

```rust
#[test]
fn agent_delete_reports_blocking_channel_bindings() {
    let state = AppState::default();
    // create workspace, seed agent repo, create binding -> target agent-1
    let response = agent_delete(
        AgentDeleteRequest {
            workspace_id: workspace_id.clone(),
            agent_id: "agent-1".to_string(),
            cleanup_mode: None,
            replacement_agent_id: None,
        },
        tauri_state,
        app,
    )
    .expect_err("delete should be blocked");

    assert!(response.contains("AGENT_DELETE_BLOCKED_BY_CHANNEL_BINDINGS"));
}
```

- [ ] **Step 2: Run the targeted Tauri tests to verify failure**

Run:

```bash
cargo test -p gtoffice-desktop-tauri agent_delete_reports_blocking_channel_bindings -- --nocapture
```

Expected: FAIL because delete does not inspect bindings and no cleanup helpers exist.

- [ ] **Step 3: Implement binding persistence and target-validation helpers**

In `binding_store.rs` add focused helpers for:

- reading/writing `channel/state.json`
- listing all bindings
- listing bindings by workspace and direct target agent
- upserting/deleting/persisting bindings

In `binding_target_validation.rs` add focused helpers for:

- `validate_binding_target_selector(...)`
- `validate_dispatch_target_selector(...)`
- direct-agent existence checks within a workspace

Keep these modules pure enough that `commands/tool_adapter/mod.rs` only orchestrates command I/O and event emission.

- [ ] **Step 4: Implement agent delete cleanup policy**

In `binding_cleanup.rs` add:

- request/response enums or helper structs for `reject`, `rebind`, `disable`, `delete`
- dependency discovery for direct-agent targets in one workspace
- cleanup execution that mutates bindings before agent deletion

Then update `agent.rs` and `mcp_bridge.rs`:

- extend `AgentDeleteRequest`
- return structured JSON with `deleted`, `blockingBindings`, and `bindingCleanup`
- keep delete behavior unchanged for unbound agents

- [ ] **Step 5: Implement dispatch-time stale-target validation**

Update `commands/tool_adapter/mod.rs` to:

- validate target selectors on binding upsert for direct-agent targets
- validate the selected route target before terminal dispatch
- surface explicit errors such as `CHANNEL_TARGET_NOT_AVAILABLE`

- [ ] **Step 6: Run the targeted Tauri tests to verify they pass**

Run:

```bash
cargo test -p gtoffice-desktop-tauri agent_delete_reports_blocking_channel_bindings -- --nocapture
cargo test -p gtoffice-desktop-tauri --test-threads=1 channel_adapter -- --nocapture
```

Expected: PASS for new and existing targeted channel tests.

- [ ] **Step 7: Run the focused backend verification set**

Run:

```bash
cargo test -p vb-task -- --nocapture
cargo test -p gtoffice-desktop-tauri -- --nocapture
```

Expected: PASS

- [ ] **Step 8: Commit the backend lifecycle changes**

Run:

```bash
git add crates/vb-task/src/lib.rs crates/vb-task/tests/lib_tests.rs apps/desktop-tauri/src-tauri/src/commands/agent.rs apps/desktop-tauri/src-tauri/src/commands/agent/binding_cleanup.rs apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_store.rs apps/desktop-tauri/src-tauri/src/commands/tool_adapter/binding_target_validation.rs apps/desktop-tauri/src-tauri/src/mcp_bridge.rs apps/desktop-tauri/src-tauri/src/tests/channel_adapter_tests.rs
git commit -m "feat: protect channel bindings during agent deletion"
```

### Task 3: Add failing frontend tests for cleanup dialog state and binding enabled state

**Files:**
- Create: `apps/desktop-web/src/features/workspace-hub/station-delete-binding-cleanup-model.ts`
- Create: `apps/desktop-web/tests/station-delete-binding-cleanup-model.test.ts`
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`
- Modify: `apps/desktop-web/src/features/tool-adapter/ChannelManagerPane.tsx`
- Modify: `apps/desktop-web/src/features/tool-adapter/ChannelBotCard.tsx`

- [ ] **Step 1: Write failing frontend model tests**

Create `apps/desktop-web/tests/station-delete-binding-cleanup-model.test.ts` covering:

- backend blocked-delete payload parses into cleanup dialog state
- `rebind` requires a replacement agent id before confirm is enabled
- `disable` and `delete` allow confirm without replacement
- binding toggle payload preserves the rest of the binding fields

Skeleton:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStationDeleteCleanupState,
  canConfirmStationDeleteCleanup,
} from '../src/features/workspace-hub/station-delete-binding-cleanup-model.js'

test('rebind cleanup requires replacement agent', () => {
  const state = buildStationDeleteCleanupState({
    blockingBindings: [sampleBinding()],
    availableAgents: [sampleAgent('agent-2')],
  })

  assert.equal(canConfirmStationDeleteCleanup({
    ...state,
    strategy: 'rebind',
    replacementAgentId: '',
  }), false)
})
```

- [ ] **Step 2: Run the targeted frontend tests to verify failure**

Run:

```bash
cd apps/desktop-web && npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/station-delete-binding-cleanup-model.test.js
```

Expected: FAIL because the cleanup model file does not exist and the desktop API types do not yet expose the new payloads.

- [ ] **Step 3: Extend the desktop API contracts**

Update `desktop-api.ts`:

- add `enabled?: boolean` to `ChannelRouteBinding`
- extend `AgentDeleteRequest` with `cleanupMode` and `replacementAgentId`
- extend `AgentDeleteResponse` with `blockingBindings` and `bindingCleanup`

- [ ] **Step 4: Implement the pure cleanup model**

In `station-delete-binding-cleanup-model.ts` add:

- strategy type: `rebind | disable | delete`
- helpers to derive UI state from backend response
- confirm gating logic
- helper to build the final delete request payload

- [ ] **Step 5: Add binding toggle support in channel-management components**

Update:

- `ChannelBotCard.tsx` to render enabled/disabled state and toggle action
- `ChannelManagerPane.tsx` to submit an updated binding via `channelBindingUpsert({ ...binding, enabled: nextEnabled })`

- [ ] **Step 6: Run the targeted frontend tests to verify they pass**

Run:

```bash
cd apps/desktop-web && npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/station-delete-binding-cleanup-model.test.js
```

Expected: PASS

- [ ] **Step 7: Commit the frontend model and contract changes**

Run:

```bash
git add apps/desktop-web/src/shell/integration/desktop-api.ts apps/desktop-web/src/features/workspace-hub/station-delete-binding-cleanup-model.ts apps/desktop-web/src/features/tool-adapter/ChannelManagerPane.tsx apps/desktop-web/src/features/tool-adapter/ChannelBotCard.tsx apps/desktop-web/tests/station-delete-binding-cleanup-model.test.ts
git commit -m "feat: add channel binding cleanup dialog state"
```

### Task 4: Wire the station delete cleanup dialog and user-facing copy

**Files:**
- Create: `apps/desktop-web/src/features/workspace-hub/StationDeleteBindingCleanupDialog.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/StationManageModal.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/index.ts`
- Modify: `apps/desktop-web/src/shell/layout/ShellRoot.tsx`
- Modify: `apps/desktop-web/src/shell/i18n/messages.ts`

- [ ] **Step 1: Write the UI wiring with minimal new state**

In `ShellRoot.tsx` add state for:

- blocked delete payload
- whether the cleanup dialog is open
- candidate replacement agents from current workspace

When `desktopApi.agentDelete(...)` returns a blocked payload:

- stop the normal delete flow
- open the cleanup dialog
- preserve the current editing station context

- [ ] **Step 2: Implement the cleanup dialog component**

In `StationDeleteBindingCleanupDialog.tsx`:

- list affected bindings
- expose strategies: rebind, disable, delete
- require replacement-agent selection only for rebind
- call back with the final cleanup request

Follow existing modal patterns from `StationManageModal.tsx` and `requestStandardModalClose`.

- [ ] **Step 3: Integrate the dialog into station management**

Update `StationManageModal.tsx` and `index.ts`:

- open the cleanup dialog during delete
- keep the station modal stable while the cleanup modal is active
- surface error/status feedback cleanly after cleanup delete completes

- [ ] **Step 4: Add all required i18n copy**

Update `messages.ts` with copy for:

- binding enabled/disabled labels
- blocked delete explanation
- strategy labels and descriptions
- rebind form field
- cleanup success states

- [ ] **Step 5: Run frontend verification**

Run:

```bash
npm --workspace apps/desktop-web run build
```

Expected: PASS

- [ ] **Step 6: Run backend verification for the integrated contract**

Run:

```bash
cargo check -p gtoffice-desktop-tauri
```

Expected: PASS

- [ ] **Step 7: Commit the UI integration**

Run:

```bash
git add apps/desktop-web/src/features/workspace-hub/StationDeleteBindingCleanupDialog.tsx apps/desktop-web/src/features/workspace-hub/StationManageModal.tsx apps/desktop-web/src/features/workspace-hub/index.ts apps/desktop-web/src/shell/layout/ShellRoot.tsx apps/desktop-web/src/shell/i18n/messages.ts
git commit -m "feat: guide agent deletion through channel binding cleanup"
```

### Task 5: Final integrated verification

**Files:**
- Verify only; no new code expected

- [ ] **Step 1: Run the required minimum project verification**

Run:

```bash
npm run typecheck
npm run build:tauri
cargo check --workspace
```

Expected: PASS

- [ ] **Step 2: Run the most relevant targeted suites again**

Run:

```bash
cargo test -p vb-task -- --nocapture
cargo test -p gtoffice-desktop-tauri -- --nocapture
cd apps/desktop-web && npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/station-delete-binding-cleanup-model.test.js
```

Expected: PASS

- [ ] **Step 3: Perform manual smoke checks**

Manual checks:

- create a binding to an agent, delete the agent, verify the cleanup dialog appears
- choose `rebind`, confirm the binding now targets the replacement agent
- choose `disable`, confirm the binding stays visible and inactive
- choose `delete`, confirm the binding is removed
- toggle a binding back to enabled and verify it can route again

- [ ] **Step 4: Commit any final verification-only adjustments**

Run:

```bash
git add -A
git commit -m "test: verify channel agent binding lifecycle"
```
