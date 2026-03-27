# Workspace Hub Station Surface Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the workspace hub station and container surfaces so the station cards communicate agent role and runtime activity more clearly, while fixing the container layout mode regression and improving layout switching smoothness.

**Architecture:** Keep feature ownership inside `apps/desktop-web/src/features/workspace-hub/`. Split work into three narrow changesets: station-card presentation, container header presentation, and layout-state/controller fixes. Add pure regression coverage under `apps/desktop-web/tests/` for the layout-state bug so the fix is verified without UI flakiness.

**Tech Stack:** React 19, TypeScript, SCSS, lucide-react, Node test runner, existing workspace-hub models/controllers.

---

### Task 1: Lock Down Layout-State Regression

**Files:**
- Modify: `apps/desktop-web/src/shell/layout/useShellWorkbenchController.ts`
- Modify: `apps/desktop-web/src/features/workspace-hub/workbench-container-model.ts`
- Create: `apps/desktop-web/tests/workbench-layout-state.test.ts`

- [ ] **Step 1: Write the failing regression test**

Create a focused test that proves container-specific `layoutMode` and `customLayout` do not snap back to stale defaults when the controller updates global defaults or when containers are reconciled.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm --workspace apps/desktop-web run test:unit -- --test-name-pattern "workbench layout state"`  
Expected: FAIL because the current controller/model behavior does not preserve the intended layout state contract.

- [ ] **Step 3: Implement the minimal root-cause fix**

Adjust the controller/model flow so:
- changing a container layout updates that container deterministically;
- global canvas defaults remain “new container defaults”, not a source that reverts existing containers;
- reconciliation keeps container-local layout state stable.

- [ ] **Step 4: Re-run the targeted test and verify GREEN**

Run: `npm --workspace apps/desktop-web run test:unit -- --test-name-pattern "workbench layout state"`  
Expected: PASS.

- [ ] **Step 5: Run the broader desktop-web unit suite**

Run: `npm --workspace apps/desktop-web run test:unit`  
Expected: PASS with no regressions in existing tests.


### Task 2: Refresh Station Card Information Architecture

**Files:**
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.scss`

- [ ] **Step 1: Define the new station-card semantic model**

Represent:
- station identity;
- merged role + work status;
- tool/workdir as secondary metadata;
- throughput as motion-based activity telemetry instead of a numeric unread badge.

- [ ] **Step 2: Implement the header/action changes**

Required behaviors:
- merge agent role and working state into a single compact semantic unit;
- replace terminal launch icon with a play-style launch affordance;
- remove the redundant terminal-launch icon treatment from the header;
- convert unread-count presentation into a readable activity-speed monitor;
- respect reduced motion and keep hover/focus stable.

- [ ] **Step 3: Update SCSS for the new visual system**

Use the existing glass / Apple-style language, reduce clutter, keep responsive units, and maintain compact-mode behavior.

- [ ] **Step 4: Verify the feature builds**

Run: `npm --workspace apps/desktop-web run build`  
Expected: PASS.


### Task 3: Refresh Container Header and Integrate the Layout Fix

**Files:**
- Modify: `apps/desktop-web/src/features/workspace-hub/WorkbenchCanvasPanel.tsx`
- Modify: `apps/desktop-web/src/features/workspace-hub/WorkbenchCanvas.scss`
- Modify: `apps/desktop-web/src/features/workspace-hub/WorkbenchUtilityActions.tsx`
- Modify: `apps/desktop-web/src/shell/i18n/messages.ts`

- [ ] **Step 1: Simplify header information density**

Required changes:
- remove the online/live-count badge from the container header;
- keep only the information that helps navigation and control;
- preserve container title readability in narrow widths.

- [ ] **Step 2: Eliminate icon duplication between right-dock pinning and topmost/persisted floating state**

Redesign the action language so:
- “pin to right dock” and “always on top” no longer share the same mental model or icon;
- docked/floating/detached modes expose only context-valid actions;
- destructive actions remain visually separated.

- [ ] **Step 3: Smooth the layout-switch interaction**

Integrate the layout-state fix with the header controls so switching between `auto`, `focus`, and `custom` feels immediate and does not bounce back.

- [ ] **Step 4: Run final verification**

Run:
- `npm run typecheck`
- `npm run build:web`
- `cargo check --workspace`

Expected: all PASS.
