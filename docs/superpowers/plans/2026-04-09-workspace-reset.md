# Workspace Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a destructive reset action in Settings that clears all GT Office workspace-scoped state, preserves the current `workspace_id`, and re-initializes default workspace data.

**Architecture:** Add a backend workspace reset command that orchestrates file cleanup, workspace-scoped SQLite cleanup, reseeding, cache invalidation, and event emission. Expose it through `desktopApi`, then add a settings danger section with a confirmation modal that requires typing `RESET` before dispatching the command.

**Tech Stack:** Tauri commands, Rust repositories/services, React, TypeScript, SCSS, existing GT Office settings/i18n infrastructure

---

### Task 1: Map Reset Surface And Add Failing Backend Tests

**Files:**
- Modify: `crates/gt-agent/src/repository.rs`
- Modify: `crates/gt-storage/src/agent_repository.rs`
- Modify: `crates/gt-storage/src/ai_config_repository.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/tests/workspace_tests.rs`

- [ ] **Step 1: Add repository interfaces needed for workspace reset**

Add explicit workspace reset methods so command handlers do not embed raw SQL:

```rust
fn reset_workspace_state(&self, workspace_id: &str) -> AgentResult<()>;
```

and an equivalent method on the AI config repository implementation:

```rust
pub fn reset_workspace_state(&self, workspace_id: &str) -> Result<(), AiConfigRepositoryError>;
```

- [ ] **Step 2: Write backend tests for reset behavior**

Add tests that cover:

```rust
#[test]
fn workspace_reset_rejects_invalid_confirmation() {}

#[test]
fn workspace_reset_removes_workspace_files_and_reseeds_defaults() {}

#[test]
fn workspace_reset_does_not_touch_other_workspaces() {}
```

Include assertions for:

- same `workspace_id` before and after reset
- `.gtoffice/config.json` removed
- `.gtoffice/session.snapshot.json` removed
- workspace DB rows removed and default agent roles reseeded
- second workspace records unaffected

- [ ] **Step 3: Run targeted Rust tests to confirm they fail**

Run: `cargo test -p gtoffice-desktop-tauri workspace_reset -- --nocapture`

Expected: FAIL because reset command and repository methods do not exist yet.

- [ ] **Step 4: Commit the failing-test checkpoint**

```bash
git add crates/gt-agent/src/repository.rs crates/gt-storage/src/agent_repository.rs crates/gt-storage/src/ai_config_repository.rs apps/desktop-tauri/src-tauri/src/commands/tests/workspace_tests.rs
git commit -m "test: add workspace reset coverage"
```

### Task 2: Implement Workspace-Scoped Storage Reset And Reseed

**Files:**
- Modify: `crates/gt-storage/src/agent_repository.rs`
- Modify: `crates/gt-storage/src/ai_config_repository.rs`
- Test: `apps/desktop-tauri/src-tauri/src/commands/tests/workspace_tests.rs`

- [ ] **Step 1: Implement agent repository workspace reset**

Add a transactional delete path for rows keyed by the workspace:

```rust
tx.execute("DELETE FROM agents WHERE workspace_id = ?1", params![workspace_id])?;
tx.execute("DELETE FROM agent_roles WHERE workspace_id = ?1", params![workspace_id])?;
tx.execute("DELETE FROM org_departments WHERE workspace_id = ?1", params![workspace_id])?;
tx.execute("DELETE FROM deleted_system_role_seeds WHERE workspace_id = ?1", params![workspace_id])?;
```

Do not delete global rows. After commit, call `seed_defaults(workspace_id)` to restore default workspace state.

- [ ] **Step 2: Implement AI config repository workspace reset**

Delete all workspace-scoped AI config rows:

```rust
tx.execute("DELETE FROM ai_config_audit_logs WHERE workspace_id = ?1", params![workspace_id])?;
tx.execute("DELETE FROM ai_config_saved_claude_providers WHERE workspace_id = ?1", params![workspace_id])?;
```

Also cover any additional AI config tables keyed by workspace if present in schema.

- [ ] **Step 3: Run targeted tests**

Run: `cargo test -p gtoffice-desktop-tauri workspace_reset -- --nocapture`

Expected: backend repository-related assertions now pass or advance to the missing command failures.

- [ ] **Step 4: Commit storage reset implementation**

```bash
git add crates/gt-storage/src/agent_repository.rs crates/gt-storage/src/ai_config_repository.rs
git commit -m "feat: add workspace-scoped storage reset"
```

### Task 3: Add Tauri Workspace Reset Command And Runtime Invalidation

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/workspace/mod.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/settings/ai_config.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/commands/agent.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/app_state.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/lib.rs`
- Test: `apps/desktop-tauri/src-tauri/src/commands/tests/workspace_tests.rs`

- [ ] **Step 1: Extract repository resolvers if needed for reuse**

If `resolve_agent_repository` and `resolve_ai_config_repository` are private to their modules, factor them into reusable helpers or duplicate minimal local helpers in `commands/workspace/mod.rs`.

- [ ] **Step 2: Add AppState helper for workspace reset invalidation**

Implement a method like:

```rust
pub fn invalidate_workspace_reset_state(&self, workspace_id: &str) -> Result<(), String> {
    self.invalidate_ai_config_snapshot_cache(workspace_id)?;
    self.reload_workspace_watcher(app, workspace_id)?;
    Ok(())
}
```

If preview caches cannot be removed by workspace, document that and leave them untouched or add keyed cleanup if practical.

- [ ] **Step 3: Implement `workspace_reset_state` command**

Shape:

```rust
#[tauri::command]
pub fn workspace_reset_state(
    workspace_id: String,
    confirmation_text: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> { ... }
```

Behavior:

- require `confirmation_text == "RESET"`
- resolve workspace root
- remove `<workspace>/.gtoffice/config.json`
- remove `<workspace>/.gtoffice/session.snapshot.json`
- call repository reset methods by `workspace_id`
- invalidate caches and reload watcher
- emit `workspace/updated` with kind `reset`
- emit `settings/updated` and `ai_config/changed` if existing frontend listeners depend on them
- return `{ workspaceId, reset: true }`

- [ ] **Step 4: Register the command**

Expose the new command in the Tauri invoke handler list in `apps/desktop-tauri/src-tauri/src/lib.rs`.

- [ ] **Step 5: Run targeted Rust tests again**

Run: `cargo test -p gtoffice-desktop-tauri workspace_reset -- --nocapture`

Expected: PASS for reset command coverage.

- [ ] **Step 6: Commit command implementation**

```bash
git add apps/desktop-tauri/src-tauri/src/commands/workspace/mod.rs apps/desktop-tauri/src-tauri/src/commands/settings/ai_config.rs apps/desktop-tauri/src-tauri/src/commands/agent.rs apps/desktop-tauri/src-tauri/src/app_state.rs apps/desktop-tauri/src-tauri/src/lib.rs apps/desktop-tauri/src-tauri/src/commands/tests/workspace_tests.rs
git commit -m "feat: add workspace reset command"
```

### Task 4: Expose Reset Through Desktop API

**Files:**
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`

- [ ] **Step 1: Add response type**

Add a typed response:

```ts
export interface WorkspaceResetResponse {
  workspaceId: string
  reset: boolean
}
```

- [ ] **Step 2: Add desktop API method**

Expose:

```ts
workspaceResetState(workspaceId: string, confirmationText: string) {
  return invokeCommand<WorkspaceResetResponse>('workspace_reset_state', {
    workspaceId,
    confirmationText,
  })
}
```

- [ ] **Step 3: Typecheck the API surface**

Run: `npm run typecheck`

Expected: PASS or fail only because UI call sites are not wired yet.

- [ ] **Step 4: Commit API exposure**

```bash
git add apps/desktop-web/src/shell/integration/desktop-api.ts
git commit -m "feat: expose workspace reset desktop api"
```

### Task 5: Add Settings Danger Section And Confirmation Modal

**Files:**
- Modify: `apps/desktop-web/src/features/settings/SettingsModal.tsx`
- Modify: `apps/desktop-web/src/features/settings/SettingsModal.scss`
- Modify: `apps/desktop-web/src/features/settings/settings-modal-model.ts`
- Create: `apps/desktop-web/src/features/settings/WorkspaceResetSection.tsx`
- Create: `apps/desktop-web/src/features/settings/WorkspaceResetSection.scss`

- [ ] **Step 1: Create `WorkspaceResetSection` component**

Component state should include:

```ts
const [confirmOpen, setConfirmOpen] = useState(false)
const [confirmationText, setConfirmationText] = useState('')
const [submitting, setSubmitting] = useState(false)
const [error, setError] = useState<string | null>(null)
const canSubmit = workspaceId && confirmationText === 'RESET' && !submitting
```

- [ ] **Step 2: Render the destructive UI**

Render:

- section title
- warning description
- destructive action button
- modal with irreversible warning
- text input that requires `RESET`
- disabled confirm button until exact match

- [ ] **Step 3: Wire the reset request**

On confirm:

```ts
await desktopApi.workspaceResetState(workspaceId, confirmationText)
```

Then clear local state, show success feedback, and trigger any supplied callback to refresh workspace-scoped data.

- [ ] **Step 4: Mount the section in `SettingsModal`**

Place it at the bottom of the `general` tab and only enable the button when `workspaceId` exists.

- [ ] **Step 5: Add styles**

Follow existing settings modal tokens and use clear destructive affordances without introducing unrelated visual patterns.

- [ ] **Step 6: Run frontend typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the settings UI**

```bash
git add apps/desktop-web/src/features/settings/SettingsModal.tsx apps/desktop-web/src/features/settings/SettingsModal.scss apps/desktop-web/src/features/settings/settings-modal-model.ts apps/desktop-web/src/features/settings/WorkspaceResetSection.tsx apps/desktop-web/src/features/settings/WorkspaceResetSection.scss
git commit -m "feat: add workspace reset settings flow"
```

### Task 6: Refresh Wiring And Final Verification

**Files:**
- Modify: any affected listeners discovered during implementation, likely under `apps/desktop-web/src/shell/layout/`
- Test: `apps/desktop-tauri/src-tauri/src/commands/tests/workspace_tests.rs`

- [ ] **Step 1: Refresh workspace-derived UI after reset**

If existing event listeners are insufficient, add minimal refresh wiring so active workspace settings and AI/provider views do not show stale data after reset.

- [ ] **Step 2: Run Rust verification**

Run: `cargo check --workspace`

Expected: PASS.

- [ ] **Step 3: Run frontend verification**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Run targeted desktop build check if available**

Run: `npm run build:tauri`

Expected: PASS, or document if too expensive/unavailable in this session.

- [ ] **Step 5: Manual verification checklist**

Verify in app:

- open settings with a workspace
- open reset modal
- confirm button stays disabled until `RESET`
- perform reset
- workspace remains open with same `workspace_id`
- agent defaults reappear
- AI config workspace state is cleared
- `.gtoffice/config.json` and `session.snapshot.json` are gone unless recreated lazily
- source files in the repo remain untouched

- [ ] **Step 6: Final commit**

```bash
git add apps/desktop-web/src apps/desktop-tauri/src-tauri/src crates
git commit -m "feat: reset workspace state from settings"
```
