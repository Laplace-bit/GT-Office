# Agent Quick Commands UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the provider quick-command settings UI into the approved `A1` fast-configuration layout with a top active rail and a flat command library below.

**Architecture:** Keep the existing quick-command preference model and behavior intact while restructuring the React component into a persistent header, active rail, compact detail strip, row-based preset/custom libraries, and an inline create/edit row. Scope stays local to the quick-command settings surface so the redesign can ship as a focused frontend refactor without backend changes.

**Tech Stack:** React, TypeScript, SCSS, existing GT Office i18n and UI preference state.

---

## File Map

### Core UI

- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx`
  - Replace the expandable summary-shell layout with a flat persistent surface.
  - Reorganize rendering into header strip, active rail, detail strip, preset rows, custom rows, and inline create/edit row.
  - Keep existing preference persistence and reorder logic unless a small helper extraction becomes necessary.

- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.scss`
  - Remove nested section styling that reinforces card-inside-card layout.
  - Add new styling for header strip, active rail, detail strip, dense list rows, inline create row, and responsive degradation.

### Copy / i18n

- Modify: `apps/desktop-web/src/shell/i18n/messages.ts`
  - Add any new copy required by the new layout, such as “Save and add”, “Save only”, “Add”, “Remove”, “Selected command”, or similar row/action wording.
  - Reuse existing keys where possible to keep changes minimal.

### Tests

- Modify: `apps/desktop-web/tests/quick-command-metadata.test.ts` only if metadata helpers need coverage updates.
- Create or modify: `apps/desktop-web/tests/command-capsule-preferences.test.ts`
  - Add state-level coverage if the UI refactor changes preference write patterns for custom create/save-and-add behavior.

### Context / Reference Only

- Reference: `docs/superpowers/specs/2026-04-10-agent-quick-commands-ui-redesign-design.md`
- Reference: `apps/desktop-web/src/shell/state/ui-preferences.ts`
- Reference: `apps/desktop-web/src/shell/state/quick-command-metadata.ts`

## Task 1: Lock the UI state model against the approved interaction flow

**Files:**
- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx`
- Reference: `apps/desktop-web/src/shell/state/ui-preferences.ts`
- Test: `apps/desktop-web/tests/command-capsule-preferences.test.ts`

- [ ] **Step 1: Read the current preference write paths and identify what must stay unchanged**

Check:

- `persistOrderedState(...)`
- preset toggle path
- custom save path
- custom delete path
- reorder path
- visibility toggle path

Write down the invariant list in comments or scratch notes before editing:

- pinned preset IDs remain the source of truth for preset enablement
- custom capsules remain persisted per provider
- ordered capsule IDs continue to reconcile against active presets and customs
- no backend shape changes

- [ ] **Step 2: Add a failing test if new “save and add” semantics require preference assertions**

Candidate test shape:

```ts
test('new custom command can be added and inserted into ordered rail state immediately', () => {
  // Arrange existing provider preferences
  // Apply the same update logic the UI will use
  // Assert custom item exists and its order id is included in enabled order
})
```

Run: `npm --workspace apps/desktop-web test -- command-capsule-preferences.test.ts`

Expected: failing assertion or missing behavior if the helper path needs to change.

- [ ] **Step 3: Implement the minimal state update changes inside `ProviderQuickCommands.tsx`**

Target behavior:

- keep `persistOrderedState(...)` as the single write path
- on “Save and add”, create/update custom capsule and ensure its order id is present in ordered state
- on “Save only”, create/update custom capsule without forcing it into active rail
- when editing an active custom capsule, preserve its enabled state

Minimal implementation sketch:

```ts
const customOrderId = buildCustomCommandCapsuleOrderId(capsule.id)
const nextOrdered = saveAndAdd
  ? reconcileOrderedCapsuleIds(
      [...normalizedOrderedCommandCapsuleIds, customOrderId],
      normalizedPinnedCommandIds,
      nextCustomCapsules,
    )
  : normalizedOrderedCommandCapsuleIds
```

- [ ] **Step 4: Run the targeted preference test**

Run: `npm --workspace apps/desktop-web test -- command-capsule-preferences.test.ts`

Expected: PASS

- [ ] **Step 5: Commit checkpoint**

```bash
git add apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx apps/desktop-web/tests/command-capsule-preferences.test.ts
git commit -m "test: lock quick command state transitions"
```

## Task 2: Rebuild the component structure into the approved A1 layout

**Files:**
- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx`
- Reference: `docs/superpowers/specs/2026-04-10-agent-quick-commands-ui-redesign-design.md`

- [ ] **Step 1: Write a failing UI-oriented assertion if a suitable existing test harness exists**

If an existing render test file is available, add a minimal assertion like:

```tsx
assert.match(renderedHtml, /Quick commands/)
assert.match(renderedHtml, /Preset commands/)
assert.match(renderedHtml, /Custom commands/)
```

If no practical render harness exists, record `未验证 + 原因` in the task notes and proceed with manual verification later.

- [ ] **Step 2: Replace the expandable summary shell with a persistent header**

Remove:

- `isExpanded` state
- expand/collapse button shell

Add:

- always-visible header strip
- title, helper copy, active count, visibility toggle

Implementation sketch:

```tsx
<section className="provider-quick-commands" aria-label={t(locale, providerCopy.titleKey)}>
  <header className="provider-quick-commands__header">
    <div className="provider-quick-commands__header-copy">...</div>
    <div className="provider-quick-commands__header-meta">...</div>
  </header>
  ...
</section>
```

- [ ] **Step 3: Promote enabled capsules into a persistent top active rail**

Render enabled items immediately below the header.

Requirements:

- horizontal rail
- drag reorder
- explicit move earlier / later buttons
- selected state
- empty state if nothing enabled

Implementation sketch:

```tsx
<section className="provider-quick-commands__rail-section">
  <div className="provider-quick-commands__rail" role="list">...</div>
</section>
```

- [ ] **Step 4: Add a compact selected-command detail strip under the rail**

Behavior:

- show selected command summary only when an active item exists
- preset shows remove action
- custom shows edit and delete actions

Implementation sketch:

```tsx
{activeCapsule ? (
  <div className="provider-quick-commands__detail-strip">
    <div className="provider-quick-commands__detail-copy">...</div>
    <div className="provider-quick-commands__detail-actions">...</div>
  </div>
) : null}
```

- [ ] **Step 5: Convert preset and custom sections into aligned dense row libraries**

For presets:

- row with label, short description, state, action

For customs:

- row with label, command preview, mode, add/remove, edit, delete

Implementation sketch:

```tsx
<div className="provider-quick-commands__library">
  <section className="provider-quick-commands__group">...</section>
  <section className="provider-quick-commands__group">...</section>
</div>
```

- [ ] **Step 6: Replace the large composer with an inline create/edit row**

Behavior:

- collapsed “Add custom command” trigger
- expanded inline fields
- primary `Save and add`
- secondary `Save only`
- cancel

Implementation sketch:

```tsx
const [composerMode, setComposerMode] = useState<'collapsed' | 'create' | 'edit'>('collapsed')
```

If reusing `editingCustomId`, avoid adding unnecessary state.

- [ ] **Step 7: Run a fast sanity pass in the browser or dev preview**

Verify:

- component renders without runtime errors
- no broken branches from removed `isExpanded`

- [ ] **Step 8: Commit checkpoint**

```bash
git add apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx
git commit -m "feat: redesign quick command settings layout"
```

## Task 3: Rebuild the styling to match the flat Apple-style control desk

**Files:**
- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.scss`

- [ ] **Step 1: Remove styles tied to the old expandable summary/section shell**

Delete or replace styles for:

- `__summary`
- `__panel`
- heavy nested `__section` blocks
- oversized composer panel styling

- [ ] **Step 2: Add the new header and active rail styling**

Requirements:

- subtle elevation for rail zone only
- large-radius capsule tokens
- crisp selected and drop-target states
- no large hover scaling

Implementation sketch:

```scss
.provider-quick-commands__header { ... }
.provider-quick-commands__rail-section { ... }
.provider-quick-commands__rail-item { ... }
```

- [ ] **Step 3: Add dense row-based library styling**

Requirements:

- row layout over card layout
- aligned columns for action area
- readable spacing without excess vertical padding

Implementation sketch:

```scss
.provider-quick-commands__row { ... }
.provider-quick-commands__row-main { ... }
.provider-quick-commands__row-actions { ... }
```

- [ ] **Step 4: Add inline create/edit row styling**

Requirements:

- compact collapsed trigger
- expanded form feels integrated with the list
- focus, error, and disabled states remain clear

- [ ] **Step 5: Add responsive rules for narrower widths**

Requirements:

- rail wraps or scrolls cleanly
- row actions stack without breaking hierarchy
- inline form collapses to a vertical layout

- [ ] **Step 6: Run visual verification**

Manual checks:

- desktop width
- narrow settings modal width
- light theme
- dark theme

- [ ] **Step 7: Commit checkpoint**

```bash
git add apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.scss
git commit -m "style: rebuild quick command settings surface"
```

## Task 4: Update localization and action wording for the new UX

**Files:**
- Modify: `apps/desktop-web/src/shell/i18n/messages.ts`
- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx`

- [ ] **Step 1: Identify missing copy for the new layout**

Likely additions:

- `quickCommands.custom.saveAndAdd`
- `quickCommands.custom.saveOnly`
- `quickCommands.row.add`
- `quickCommands.row.remove`
- `quickCommands.detail.selected`

Only add keys that are truly needed after the JSX rewrite.

- [ ] **Step 2: Add the new messages**

Example:

```ts
'quickCommands.custom.saveAndAdd': { 'zh-CN': '保存并加入', 'en-US': 'Save and add' },
'quickCommands.custom.saveOnly': { 'zh-CN': '仅保存', 'en-US': 'Save only' },
```

- [ ] **Step 3: Wire the new copy into the component**

Replace ambiguous old wording where necessary so the new row-based UX reads naturally.

- [ ] **Step 4: Run a typecheck to catch missing message keys**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 5: Commit checkpoint**

```bash
git add apps/desktop-web/src/shell/i18n/messages.ts apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx
git commit -m "feat: update quick command settings copy"
```

## Task 5: Verify behavior end-to-end for the redesigned surface

**Files:**
- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx` only if fixes are needed
- Modify: `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.scss` only if fixes are needed

- [ ] **Step 1: Run automated checks**

Run:

```bash
npm run typecheck
npm --workspace apps/desktop-web test -- quick-command-metadata.test.ts
npm --workspace apps/desktop-web test -- command-capsule-preferences.test.ts
```

Expected:

- typecheck passes
- targeted tests pass

- [ ] **Step 2: Run manual UI verification**

Check in settings UI:

- visibility toggle still persists by provider
- enabled rail appears immediately without expand/collapse
- preset add/remove updates the rail
- custom “Save and add” inserts item and activates it
- custom “Save only” stores item without forcing active state
- edit updates existing custom item
- delete removes custom item and its active instance if enabled
- drag reorder persists
- arrow reorder persists
- selected detail strip shows correct actions
- keyboard focus remains visible

- [ ] **Step 3: Fix any regressions found and rerun the affected checks**

Re-run only the commands necessary to prove the fix, then rerun the full targeted suite.

- [ ] **Step 4: Final commit**

```bash
git add apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.scss apps/desktop-web/src/shell/i18n/messages.ts apps/desktop-web/tests/command-capsule-preferences.test.ts apps/desktop-web/tests/quick-command-metadata.test.ts
git commit -m "feat: redesign agent quick command settings ui"
```

## Notes

- The worktree is already dirty; do not revert unrelated user changes.
- Keep this refactor local to quick-command settings unless a tiny supporting helper extraction is clearly justified.
- The plan-review subagent loop described by the skill is not executed here because this session is not authorized for subagent delegation by default; use human review or explicit user authorization if a separate reviewer is required.
