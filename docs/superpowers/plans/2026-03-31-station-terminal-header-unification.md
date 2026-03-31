# Station Terminal Header Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the station terminal card header identity into one grouped element and make the header background transparent without disturbing existing terminal actions.

**Architecture:** Keep the change local to the workspace hub station card. Move the identity grouping logic into the existing header model, render one identity capsule in `StationCard.tsx`, and restyle the header plus the new capsule in SCSS.

**Tech Stack:** React 19, TypeScript, SCSS, Node test runner

---

### Task 1: Update Header Identity Model

**Files:**
- Modify: `apps/desktop-web/src/features/workspace-hub/station-card-header-model.ts`
- Test: `apps/desktop-web/tests/station-card-header-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
assert.deepEqual(buildStationCardIdentityMeta('Alpha', '产品角色', 'codex cli'), [
  { kind: 'name', label: 'Alpha' },
  { kind: 'role', label: '产品角色' },
  { kind: 'tool', label: 'codex cli' },
])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop-web && npm run test:unit -- station-card-header-model.test.ts`
Expected: FAIL because `buildStationCardIdentityMeta` does not yet return the unified three-part identity shape.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface StationCardIdentityMetaItem {
  kind: 'name' | 'role' | 'tool'
  label: string
}

export function buildStationCardIdentityMeta(nameText: string, roleText: string, toolText: string) {
  return [
    { kind: 'name', label: nameText },
    { kind: 'role', label: roleText },
    { kind: 'tool', label: toolText },
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop-web && npm run test:unit -- station-card-header-model.test.ts`
Expected: PASS

### Task 2: Render the Unified Header Capsule

**Files:**
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.tsx`

- [ ] **Step 1: Replace the split title/pill rendering with one grouped identity element**

```tsx
<div className="station-window-identity-pill">
  {identityMeta.map(...)}
</div>
```

- [ ] **Step 2: Keep existing drag behavior and action buttons unchanged**

Run: no command
Expected: JSX structure changes only on the left identity area.

### Task 3: Restyle the Header

**Files:**
- Modify: `apps/desktop-web/src/features/workspace-hub/StationCard.scss`

- [ ] **Step 1: Make the header background transparent and keep a subtle divider**

```scss
.station-window-header {
  background: transparent;
}
```

- [ ] **Step 2: Add styles for the unified identity pill and segment hierarchy**

```scss
.station-window-identity-pill { ... }
.station-window-identity-segment.is-name { ... }
```

- [ ] **Step 3: Ensure compact width behavior truncates the name first**

Run: no command
Expected: the identity stays on one grouped line and the name segment shrinks before role/tool disappear.

### Task 4: Verify Integration

**Files:**
- Test: `apps/desktop-web/tests/station-card-header-model.test.ts`

- [ ] **Step 1: Run focused unit tests**

Run: `cd apps/desktop-web && npm run test:unit`
Expected: PASS including `station-card-header-model.test.ts`

- [ ] **Step 2: Run the desktop web build**

Run: `cd apps/desktop-web && npm run build`
Expected: PASS
