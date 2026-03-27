# Workspace Hub Comet Activity Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inactive-card unread counts with a small comet-tail activity icon and update the auto layout preset button to display `A`.

**Architecture:** Keep the change local to `workspace-hub` UI, but extract activity-speed mapping into pure shared helpers so behavior stays consistent across station cards, focus rail items, and terminal pane headers. Reuse one visual comet icon component wired to unread deltas instead of accumulated count labels.

**Tech Stack:** React 19, TypeScript, SCSS, Node test runner, existing workspace-hub runtime model.

---

### Task 1: Lock Shared Activity Icon Semantics

**Files:**
- Create: `apps/desktop-web/src/features/workspace-hub/station-activity-signal-model.ts`
- Modify: `apps/desktop-web/tests/terminal-hardening.test.ts`

- [ ] **Step 1: Write the failing test**

Add focused tests for:
- unread delta `1-2` => `low`;
- unread delta `3-5` => `medium`;
- unread delta `>= 6` => `high`;
- decay timeout values remain stable per level.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm --workspace apps/desktop-web run test:unit -- --test-name-pattern "activity signal"`
Expected: FAIL because the helpers do not exist yet.

- [ ] **Step 3: Implement the minimal shared model helpers**

Export pure helpers for:
- activity speed resolution from unread delta;
- activity timeout resolution from speed level.

- [ ] **Step 4: Re-run the targeted test and verify GREEN**

Run: `npm --workspace apps/desktop-web run test:unit -- --test-name-pattern "activity signal"`
Expected: PASS.

### Task 2: Lock Layout Preset Visual Mapping

**Files:**
- Create: `apps/desktop-web/src/features/workspace-hub/workbench-layout-preset-visuals.ts`
- Modify: `apps/desktop-web/tests/terminal-hardening.test.ts`

- [ ] **Step 1: Write the failing test**

Add a focused test that `auto` resolves to the glyph `A`, while `focus` and `custom` retain icon-backed visual kinds.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm --workspace apps/desktop-web run test:unit -- --test-name-pattern "layout preset visual"`
Expected: FAIL because the mapping module does not exist yet.

- [ ] **Step 3: Implement the minimal visual mapping helper**

Return a small discriminated union that the header button renderer can consume without conditional sprawl.

- [ ] **Step 4: Re-run the targeted test and verify GREEN**

Run: `npm --workspace apps/desktop-web run test:unit -- --test-name-pattern "layout preset visual"`
Expected: PASS.

### Task 3: Replace Numeric Badges with Comet Icon UI

**Files:**
- Create: `apps/desktop-web/src/features/workspace-hub/StationActivityComet.tsx`
- Create: `apps/desktop-web/src/features/workspace-hub/StationActivityComet.scss`
- Create: `apps/desktop-web/src/features/workspace-hub/useStationActivitySignal.ts`
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.scss`
- Modify: `apps/desktop-web/src/features/workspace-hub/TerminalStationPane.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/TerminalStationPane.scss`
- Modify: `apps/desktop-web/src/features/workspace-hub/WorkbenchCanvasPanel.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/WorkbenchCanvas.scss`
- Modify: `apps/desktop-web/src/features/workspace-hub/workbench-layout-preset-visuals.ts`

- [ ] **Step 1: Implement the shared comet component**

Build a compact comet-tail icon with:
- one moving head point;
- two to three restrained tail segments;
- level-based motion speed and glow intensity;
- reduced-motion fallback.

- [ ] **Step 2: Replace inactive-surface unread badges**

Update:
- inactive station cards only;
- terminal station pane header;
- focus rail item secondary cards.

- [ ] **Step 3: Update the layout preset button renderer**

Render `A` for `auto`, keep icons for `focus` and `custom`, and preserve compact segmented-control behavior.

- [ ] **Step 4: Refresh SCSS**

Keep the comet inside the header signal zone, motion-safe, and consistent with the current glass system.

### Task 4: Verify the Feature

**Files:**
- Verify only

- [ ] **Step 1: Run targeted unit tests**

Run: `npm --workspace apps/desktop-web run test:unit -- --test-name-pattern "activity signal|layout preset visual"`
Expected: PASS.

- [ ] **Step 2: Run the desktop-web build**

Run: `npm --workspace apps/desktop-web run build`
Expected: PASS.
