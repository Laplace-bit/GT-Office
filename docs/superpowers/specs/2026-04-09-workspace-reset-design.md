# Workspace Reset Design

## Summary

Add a destructive "Reset Current Workspace" action in Settings. The action restores the currently open workspace to GT Office's initial state while preserving the existing `workspace_id`, workspace root path, and user source files.

Reset scope includes:

- workspace-scoped GT Office config files under `<workspace>/.gtoffice/`
- workspace session snapshot data
- workspace-scoped SQLite records stored in app data
- in-memory caches derived from workspace-scoped state

Reset explicitly does not include:

- user source files in the workspace
- Git repository contents
- global user settings
- credentials or other non-workspace global secrets unless they are already modeled as workspace-scoped data

After reset, the workspace must be re-initialized to the same default state it would have after first open, using the same `workspace_id`.

## Goals

- Provide a clear destructive reset action from Settings.
- Require strong second confirmation before execution.
- Reset all GT Office state for the current workspace, including database data.
- Preserve workspace identity by keeping the same `workspace_id`.
- Re-seed default workspace state immediately after reset.

## Non-Goals

- Deleting the workspace from the app.
- Changing the workspace root path.
- Modifying user project files.
- Resetting global application settings or all workspaces at once.

## Existing State

Current relevant storage locations:

- workspace settings: `<workspace>/.gtoffice/config.json`
- workspace session snapshot: `<workspace>/.gtoffice/session.snapshot.json`
- workspace-scoped database data: app data SQLite database `gtoffice.db`

Current `settings_reset` only resets selected settings keys. It does not clear all workspace state and does not reset database records.

Agent and AI config persistence are both backed by the shared SQLite database in app data, so workspace reset needs repository-level deletion by `workspace_id` rather than deleting the entire database file.

## User Experience

### Settings Placement

Add a danger section to the Settings modal under the `general` tab. This keeps the action visible in a global configuration area without introducing a new top-level tab.

### Action Copy

Primary label:

- zh: `重置当前工作区`
- en: `Reset Current Workspace`

Description:

- zh: `这会清除当前工作区的 GT Office 本地状态与数据库数据，并重新初始化默认状态。不会修改你的源码文件。`
- en: `This clears GT Office local state and database data for the current workspace, then re-initializes default state. Your source files will not be modified.`

### Confirmation Flow

Use a destructive confirmation modal with:

- explicit irreversible warning
- summary of affected data
- text input requiring the exact string `RESET`
- disabled confirm button until input matches

Confirmation body should state that the workspace keeps the same `workspace_id`, but all GT Office workspace state is reset to defaults.

### Post-Reset Behavior

On success:

- keep Settings open or close based on existing modal patterns; default to keeping it open and showing a success toast/banner
- refresh workspace-derived settings and workspace UI state
- re-fetch AI config snapshot and any agent/role lists when their panes are revisited

On failure:

- show the backend error
- do not partially claim success

## Backend Design

### New Command

Add a Tauri command in `commands/workspace/`:

- `workspace_reset_state(workspace_id: String, confirmation_text: String) -> Result<Value, String>`

Validation:

- workspace must exist
- `confirmation_text` must equal `RESET`

Response shape:

- `workspaceId`
- `reset: true`
- optional metadata describing which reset steps ran

### Reset Steps

Run reset in this order:

1. Resolve the workspace root from `workspace_id`.
2. Remove workspace-scoped GT Office files under `.gtoffice/` that represent persisted state, at minimum:
   - `config.json`
   - `session.snapshot.json`
3. Delete workspace-scoped SQLite records for the given `workspace_id`.
4. Re-seed default workspace records for that same `workspace_id`.
5. Invalidate in-memory caches tied to workspace-scoped persisted data.
6. Reload workspace watcher and emit update events so the frontend refreshes.

### Database Cleanup

Repository interfaces need explicit workspace-reset helpers instead of direct SQL inside command handlers.

Agent repository:

- add a method that removes workspace-local agent data for a given `workspace_id`
- preserve global seeded roles
- re-seed workspace defaults after cleanup

AI config repository:

- add a method that removes workspace-scoped saved provider state, audit history, and any other rows keyed by workspace context

If other SQLite tables are keyed by workspace and represent GT Office local state, they should be included in the same reset pathway.

Cleanup should be transactional where possible so the database does not land in a half-reset state.

### Reinitialization

Reset should not leave the workspace blank if the product normally expects default seeded state. After cleanup:

- re-run agent default seeding for the workspace
- ensure any missing default workspace metadata is restored
- allow workspace-scoped config files to remain absent until lazily recreated, if absence already maps to built-in defaults

### AppState Impact

Add a workspace-scoped invalidation helper in `AppState` for reset-related runtime state, at minimum:

- invalidate AI config snapshot cache for the workspace
- drop any AI config preview entries tied to the workspace if such linkage exists
- reload workspace watcher

If the app keeps other workspace-derived caches outside repositories, include them in the same invalidation path.

### Events

After success emit events that existing frontend listeners can already react to when possible:

- `workspace/updated` with kind such as `reset`
- `settings/updated` for workspace-scoped settings refresh if needed
- `ai_config/changed` for workspace context

The goal is to minimize bespoke frontend refresh logic.

## Frontend Design

### Desktop API

Expose a new desktop API method for the reset command and keep the call site inside the settings feature.

### Settings UI

Add a workspace reset card component in `apps/desktop-web/src/features/settings/`.

Responsibilities:

- render warning copy
- open confirmation modal
- manage confirmation text
- submit reset request
- show loading and error states

Guard rails:

- disabled if `workspaceId` is null
- destructive styling consistent with existing settings modals

### Localization

All new user-facing strings must go through the existing i18n helper instead of inline hardcoded text.

## Error Handling

Backend errors should use specific prefixes, for example:

- `WORKSPACE_RESET_CONFIRMATION_INVALID`
- `WORKSPACE_RESET_STORAGE_FAILED`
- `WORKSPACE_RESET_RESEED_FAILED`

The command should fail closed. If reseeding fails after cleanup, return an error and leave the workspace in a known recoverable state. Prefer reseeding within the same database transaction where practical.

## Testing

### Backend

Add targeted tests for:

- reset rejects invalid confirmation text
- reset removes workspace config and session files
- reset deletes workspace-scoped database records
- reset preserves the same `workspace_id`
- reset reseeds default workspace data after cleanup
- reset does not affect data for a different workspace

### Frontend

Add focused UI tests for:

- reset action disabled without workspace
- confirm button disabled until `RESET` is entered
- destructive request sent with current `workspaceId`

### Verification Commands

Minimum verification for implementation:

- `npm run typecheck`
- `cargo check --workspace`
- targeted frontend build or test if the changed package already has a standard command

## Implementation Notes

- Keep reset orchestration in backend command and supporting service/repository helpers.
- Do not delete the whole SQLite database file because multiple workspaces share it.
- Do not remove the workspace from `workspace_service`; the same workspace remains open and active.
- Prefer deleting only known GT Office managed files under `.gtoffice/` instead of recursively deleting arbitrary workspace content.
