# Claude Command Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocking station dock with a non-overlapping, provider-aware command rail that exposes real Claude Code commands, supports per-user visibility preferences, and ships with sensible defaults.

**Architecture:** Keep the Tauri command catalog as the single source of truth for provider/native command metadata, but widen it to reflect the real Claude Code command surface and visibility constraints. In the web app, replace the existing multi-group dock with a compact single-row rail rendered below the terminal shell, and persist rail visibility plus pinned-command preferences in user UI preferences so detached windows inherit the same behavior.

**Tech Stack:** React, TypeScript, SCSS, Tauri Rust commands, existing `desktopApi.toolListCommands`, localStorage-backed UI preferences.

---

### Task 1: Expand Command Catalog To Real Claude Command Surface

**Files:**
- Modify: `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/command_catalog.rs`
- Modify: `apps/desktop-web/src/shell/integration/desktop-api.ts`
- Test: `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/command_catalog.rs`

- [ ] Audit the current hard-coded command list against the official Claude Code built-in commands and bundled skills reference.
- [ ] Split catalog items into:
  - provider-native Claude built-ins
  - Claude bundled skills
  - GT Office common workspace actions
  - provider-nonparity fallback entries for non-Claude tools
- [ ] Ensure labels and `shortLabel` values use the real slash commands where applicable, for example `/help`, `/diff`, `/context`, `/plan`, `/status`, `/agents`, `/mcp`, `/loop`, `/batch`, `/simplify`.
- [ ] Add enough metadata for the rail and settings UI:
  - stable command id
  - slash command text
  - command family (`built_in`, `bundled_skill`, `workspace_action`)
  - default pinned state per provider
  - visibility eligibility by provider/platform/runtime
- [ ] Keep runtime disable reasons explicit, especially for no live session, detached readonly, unsupported platform, and commands hidden by environment.
- [ ] Update Rust tests so the Claude catalog verifies:
  - core commands exist
  - bundled skills exist
  - dangerous/parameterized commands still route through sheet flow where needed
  - non-Claude providers do not receive fake Claude slash commands

**Run:**
- `cargo test -p gtoffice-desktop-tauri command_catalog --quiet`

### Task 2: Add Settings-Backed Command Rail Preferences

**Files:**
- Modify: `apps/desktop-web/src/shell/state/ui-preferences.ts`
- Modify: `apps/desktop-web/src/features/settings/SettingsModal.tsx`
- Modify: `apps/desktop-web/src/features/settings/DisplayPreferences.tsx`
- Modify: `apps/desktop-web/src/features/settings/DisplayPreferences.scss`
- Modify: `apps/desktop-web/src/shell/layout/ShellRoot.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/DetachedWorkbenchWindow.tsx`

- [ ] Extend `UiPreferences` with command rail preference fields:
  - `showCommandRail`
  - `showWorkspaceActionsInRail`
  - `pinnedCommandIdsByProvider`
- [ ] Define sane defaults:
  - rail visible by default
  - GT Office common actions visible by default
  - Claude pinned defaults: `/help`, `/diff`, `/context`, `/plan`, `/status`, `/agents`, `/mcp`, `/simplify`
- [ ] Add a new settings group in display/general settings for the command rail:
  - master show/hide switch
  - provider-specific pinned-command editor for Claude
  - reset-to-default action
- [ ] Keep the preference format backward-compatible with existing `gtoffice.ui.preferences.v1` storage loading.
- [ ] Ensure detached windows reload the same preferences via existing storage synchronization.

**Run:**
- `npm run typecheck`

### Task 3: Replace The Blocking Dock With A Slim Rail

**Files:**
- Modify: `apps/desktop-web/src/features/workspace-hub/StationActionDock.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/StationActionDock.scss`
- Modify: `apps/desktop-web/src/features/workspace-hub/station-action-registry.ts`
- Modify: `apps/desktop-web/src/features/workspace-hub/station-action-model.ts`
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.scss`
- Modify: `apps/desktop-web/src/features/workspace-hub/TerminalStationPane.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/TerminalStationPane.scss`

- [ ] Rebuild the dock into a command rail with these constraints:
  - single row only
  - low visual height
  - horizontal scroll for overflow
  - never visually cover terminal content
  - exact slash command labels for Claude commands
  - subtle Apple-style glass treatment, but restrained
- [ ] Remove the current vertical section labels and oversized grouped-shell layout.
- [ ] Show only pinned commands in the primary rail plus a compact `All Commands` affordance.
- [ ] Keep parameterized commands routed through the existing command sheet until a smaller inline variant is justified.
- [ ] Preserve keyboard navigation, reduced-motion fallback, and disabled reasons.
- [ ] Ensure both station card and detached terminal pane render the same rail behavior.

**Run:**
- `npm run typecheck`

### Task 4: Integrate Rail Filtering With Real Provider Behavior

**Files:**
- Modify: `apps/desktop-web/src/features/workspace-hub/station-action-registry.ts`
- Modify: `apps/desktop-web/src/shell/layout/ShellRoot.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/DetachedWorkbenchWindow.tsx`

- [ ] Filter visible commands using:
  - provider kind
  - current pinned preference
  - GT Office common-action toggle
  - runtime enabled/disabled status from catalog
- [ ] Make the `All Commands` list show the full provider-valid set, not just the pinned subset.
- [ ] Keep action execution paths unchanged where already correct:
  - insert and submit
  - open command sheet
  - open settings modal
  - launch profile
- [ ] Verify idle stations still expose useful launch/setup commands without pretending a live Claude session exists.

**Run:**
- `npm run typecheck`

### Task 5: Final Integration, Review, And Verification

**Files:**
- Review: `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/command_catalog.rs`
- Review: `apps/desktop-web/src/features/workspace-hub/StationActionDock.tsx`
- Review: `apps/desktop-web/src/features/settings/DisplayPreferences.tsx`
- Review: `apps/desktop-web/src/shell/layout/ShellRoot.tsx`

- [ ] Run backend verification.
- [ ] Run frontend typecheck and app build verification.
- [ ] Review the resulting UI for:
  - no overlap with terminal input area
  - command labels match real Claude slash commands
  - settings toggles affect main window and detached window
  - Codex/Gemini do not show fake Claude parity
- [ ] Summarize residual risks if there are commands that still depend on platform/account availability.

**Run:**
- `cargo check --workspace`
- `cargo test -p gtoffice-desktop-tauri command_catalog --quiet`
- `npm run typecheck`
- `npm run build:tauri`
