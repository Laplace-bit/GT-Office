# Agent Custom Launch Command — Design Spec

## Overview

Add a per-agent `launchCommand` field that lets users customize the terminal command used to start an agent (e.g. `claude --model sonnet` instead of just `claude`). When creating a new agent, previously used commands for the same provider are shown as tag chips for quick selection. Workspace reset cleans up both the persisted data and the UI history.

## 1. Data Model

### Rust — AgentProfile

```rust
// crates/gt-agent/src/models.rs
pub struct AgentProfile {
    // ... existing fields ...
    pub launch_command: Option<String>,  // NULL = use tool default
}
```

### Rust — CreateAgentInput / UpdateAgentInput

```rust
// crates/gt-agent/src/repository.rs
pub struct CreateAgentInput {
    // ... existing fields ...
    pub launch_command: Option<String>,
}

pub struct UpdateAgentInput {
    // ... existing fields ...
    pub launch_command: Option<String>,
}
```

### SQLite — Migration

Add nullable column `launch_command TEXT DEFAULT NULL` to `agents` table. NULL means "use the default command for this provider".

### TypeScript — AgentProfile

```typescript
// desktop-api.ts
export interface AgentProfile {
  // ... existing fields ...
  launchCommand?: string | null
}
```

### TypeScript — AgentStation / CreateStationInput

```typescript
// station-model.ts
export interface AgentStation {
  // ... existing fields ...
  launchCommand?: string | null
}

export interface CreateStationInput {
  // ... existing fields ...
  launchCommand?: string | null
}
```

### TypeScript — AgentCreateRequest / AgentUpdateRequest

```typescript
// desktop-api.ts
export interface AgentCreateRequest {
  // ... existing fields ...
  launchCommand?: string | null
}

export interface AgentUpdateRequest {
  // ... existing fields ...
  launchCommand?: string | null
}
```

## 2. UI — StationManageModal

### New form field

Position: between Provider selector and Work Directory.

- **Label**: "启动命令 / Launch Command"
- **Input**: text field, placeholder dynamically set to the current provider's default (e.g. `claude`)
- **Tag chips**: shown below the input, grouped by current provider, sourced from `LaunchCommandHistory`
- **Click behavior**: clicking a tag fills the input; the input is fully editable after fill
- **Empty behavior**: leaving blank means "use provider default"
- **Edit mode**: pre-fill with the agent's current `launchCommand`

### LaunchCommandHistory — UiPreferences

```typescript
// ui-preferences.ts
interface LaunchCommandHistory {
  [provider: string]: string[]  // e.g. { "claude": ["claude --model sonnet"] }
}
```

- On create/update: if `launchCommand` is non-empty and differs from provider default, append to the provider array (dedup, keep last 5)
- Stored under a dedicated key in `UiPreferences`
- Cleaned on workspace reset

### Copy — station-manage-copy.ts

Add localized strings for the new field label, placeholder, and any helper text.

## 3. Launch Flow

### resolveStationCliLaunchCommand (frontend)

```typescript
export function resolveStationCliLaunchCommand(
  toolKind: StationToolKind,
  launchCommand?: string | null,
): string {
  if (launchCommand?.trim()) {
    return launchCommand.trim()
  }
  return toolKind  // fallback: "claude" | "codex" | "gemini"
}
```

All call sites pass `station.launchCommand` as the second argument.

### tool_launch (backend — tool_profiles.rs)

When the request context includes a `stationId`, read the agent's `launch_command` from the repository. If present and non-empty, use it; otherwise fall back to `default_launch_command(tool_kind)`.

### Batch launch

Each agent reads its own `launchCommand` — no special handling needed.

## 4. Reset & Cleanup

### Workspace full reset

- `workspace_reset_state_with_storage` already clears the `agents` table (which includes `launch_command` column) — no extra backend work.
- Frontend: on receiving `workspace/updated` (kind: "reset"), clear the `launchCommandHistory` key from `UiPreferences` in localStorage.

### Granular settings reset (optional, future)

Can be added via `settings_reset` with key `launch_command_history` if needed. Not in scope for this iteration.

## 5. File Change Index

| Layer | File | Change |
|-------|------|--------|
| Rust model | `crates/gt-agent/src/models.rs` | Add `launch_command: Option<String>` to `AgentProfile` |
| Rust repo | `crates/gt-agent/src/repository.rs` | Add `launch_command` to `CreateAgentInput` / `UpdateAgentInput` |
| Rust storage | `crates/gt-storage/src/agent_repository.rs` | SQLite migration + read/write `launch_command` column |
| Rust command | `apps/desktop-tauri/src-tauri/src/commands/agent.rs` | Pass through `launchCommand` in create/update |
| Rust tool | `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/tool_profiles.rs` | Read agent `launch_command` in `tool_launch` |
| TS API | `apps/desktop-web/src/shell/integration/desktop-api.ts` | Add `launchCommand` to `AgentProfile`, `AgentCreateRequest`, `AgentUpdateRequest` |
| TS model | `apps/desktop-web/src/features/workspace-hub/station-model.ts` | Add `launchCommand` to `AgentStation`, `CreateStationInput`; update `mapAgentProfileToStation` |
| TS runtime | `apps/desktop-web/src/features/workspace-hub/station-agent-runtime-model.ts` | Update `resolveStationCliLaunchCommand` signature |
| TS UI pref | `apps/desktop-web/src/shell/state/ui-preferences.ts` | Add `LaunchCommandHistory` type + read/write helpers |
| TS modal | `apps/desktop-web/src/features/workspace-hub/StationManageModal.tsx` | New form field + tag chips |
| TS copy | `apps/desktop-web/src/features/workspace-hub/station-manage-copy.ts` | New i18n strings |
| TS reset | reset event handler or `WorkspaceResetSection.tsx` | Clear `launchCommandHistory` from localStorage |
| TS controller | `apps/desktop-web/src/shell/layout/useShellStationController.ts` | Pass `launchCommand` in add/update payload |

## 6. Coding Principles

- **Modularity**: extract launch command history logic into a dedicated module (`launch-command-model.ts`) rather than inline in the modal
- **Performance**: tag chip rendering should be memoized; history lookups use direct Map/Object access, not array scans
- **Single source of truth**: `resolveStationCliLaunchCommand` is the only function that resolves the final command string — no duplicate logic
- **Minimal diff**: add fields alongside existing ones following the same patterns; no unrelated refactoring