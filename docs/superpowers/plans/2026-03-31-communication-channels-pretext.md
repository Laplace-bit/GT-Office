# Communication Channels Pretext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the communication channels message surface into the approved "Luminous Workbench" chat UI and use `pretext` to power tight bubble widths plus stable row-height prediction for long conversations.

**Architecture:** Keep existing channel event grouping and conversation tab behavior in `CommunicationChannelsPane`, but move message rendering into a virtualized list and a focused bubble component. Introduce a pure `channel-message-layout` module that owns `pretext` preparation, tight-width search, fallback handling for `system-ui`, and row-height prediction, while SCSS owns the new light/dark adaptive visual language and the single message entrance animation.

**Tech Stack:** React 19, TypeScript, SCSS, `@tanstack/react-virtual`, `@chenglou/pretext`, existing Node `node:test` unit test setup, Tauri/web workspace build scripts.

---

## File Structure

### Files to create

- `apps/desktop-web/src/features/tool-adapter/channel-message-layout.ts`
  - Pure layout helpers for `pretext` prepare/cache, tight-width calculation, row-height prediction, and fallback detection.
- `apps/desktop-web/src/features/tool-adapter/channel-message-list-model.ts`
  - Pure helpers for virtual row sizing and feed auto-scroll decisions so behavior stays unit-testable.
- `apps/desktop-web/src/features/tool-adapter/ChannelMessageBubble.tsx`
  - Presentational component for a single message row using precomputed layout metrics.
- `apps/desktop-web/src/features/tool-adapter/ChannelMessageList.tsx`
  - Virtualized active-conversation list that renders message rows and preserves near-bottom stickiness.
- `apps/desktop-web/tests/channel-message-layout.test.ts`
  - Unit tests for tight-width, height prediction, and `system-ui` fallback behavior.
- `apps/desktop-web/tests/channel-message-list-model.test.ts`
  - Unit tests for auto-scroll thresholds and row estimate helpers.

### Files to modify

- `apps/desktop-web/src/features/tool-adapter/CommunicationChannelsPane.tsx`
  - Keep conversation grouping/tab selection, hand off active events to the new list component, and invalidate layout on appearance changes.
- `apps/desktop-web/src/features/tool-adapter/CommunicationChannelsPane.scss`
  - Replace the old traditional bubble styling with the approved luminous workbench styling, remove hover affordances, and keep only the pop-in entrance animation.
- `apps/desktop-web/src/features/tool-adapter/index.ts`
  - Export any new internal surface modules only if needed by existing feature boundaries; otherwise leave internal-only files unexported.
- `apps/desktop-web/src/shell/layout/ShellRoot.tsx`
  - Pass appearance inputs needed to invalidate layout cache when theme/font settings change.
- `apps/desktop-web/package.json`
  - Add `@chenglou/pretext`.
- `package-lock.json`
  - Capture the dependency change.
- `docs/07_依赖选型与精简清单.md`
  - Record the new dependency, the reason, and why existing tooling is insufficient.

### Testing and verification files

- `apps/desktop-web/tsconfig.tests.json`
  - Modify only if the new test import graph requires explicit inclusion.

---

### Task 1: Add dependency documentation and a failing layout test seam

**Files:**
- Modify: `docs/07_依赖选型与精简清单.md`
- Modify: `apps/desktop-web/package.json`
- Modify: `package-lock.json`
- Create: `apps/desktop-web/tests/channel-message-layout.test.ts`

- [ ] **Step 1: Update dependency policy before adding the package**

Document `@chenglou/pretext` in `docs/07_依赖选型与精简清单.md` with:

- scope limited to communication channels message layout
- reason: tight multiline shrink-wrap + stable height prediction
- rejected alternative: CSS-only width + browser-measured row heights

- [ ] **Step 2: Install the dependency in the web workspace**

Run:

```bash
npm install @chenglou/pretext --workspace apps/desktop-web
```

Expected: `apps/desktop-web/package.json` and `package-lock.json` include the new package.

- [ ] **Step 3: Write a failing unit test for the pure layout API**

Create `apps/desktop-web/tests/channel-message-layout.test.ts` with coverage for:

- tight width keeps the same line count as max-width layout
- row height includes detail text spacing
- `system-ui` forces fallback mode

Skeleton:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeChannelMessageLayout,
} from '../src/features/tool-adapter/channel-message-layout.js'

test('tight width preserves wrapped line count', () => {
  const layout = computeChannelMessageLayout({
    content: 'Preview updated. Final reply will only append the delta once validation passes.',
    detail: null,
    uiFont: 'sf-pro',
    maxContentWidth: 280,
    contentFont: '500 12px "Helvetica Neue"',
    detailFont: '500 11px "Helvetica Neue"',
    contentLineHeight: 17.4,
    detailLineHeight: 14.85,
    bubblePaddingX: 12,
    bubblePaddingY: 10,
    bubbleBorderWidth: 1,
    direction: 'inbound',
    status: 'received',
  })

  assert.equal(layout.usedFallback, false)
  assert.equal(layout.tightLineCount, layout.maxWidthLineCount)
  assert.ok(layout.bubbleWidth <= layout.maxBubbleWidth)
})

test('system-ui forces fallback sizing', () => {
  const layout = computeChannelMessageLayout({
    content: 'hello',
    detail: null,
    uiFont: 'system-ui',
    maxContentWidth: 280,
    contentFont: '500 12px system-ui',
    detailFont: '500 11px system-ui',
    contentLineHeight: 17.4,
    detailLineHeight: 14.85,
    bubblePaddingX: 12,
    bubblePaddingY: 10,
    bubbleBorderWidth: 1,
    direction: 'outbound',
    status: 'sent',
  })

  assert.equal(layout.usedFallback, true)
  assert.equal(layout.bubbleWidth, layout.maxBubbleWidth)
})
```

- [ ] **Step 4: Run the targeted unit test to verify failure**

Run:

```bash
cd apps/desktop-web && npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/channel-message-layout.test.js
```

Expected: FAIL because `channel-message-layout.js` does not exist yet.

- [ ] **Step 5: Commit the dependency + failing-test scaffold**

Run:

```bash
git add docs/07_依赖选型与精简清单.md apps/desktop-web/package.json package-lock.json apps/desktop-web/tests/channel-message-layout.test.ts
git commit -m "test: add communication channels layout scaffolding"
```

### Task 2: Implement the pure `pretext` layout engine with fallback support

**Files:**
- Create: `apps/desktop-web/src/features/tool-adapter/channel-message-layout.ts`
- Create: `apps/desktop-web/tests/channel-message-layout.test.ts` (complete coverage from Task 1)
- Modify: `apps/desktop-web/tsconfig.tests.json` only if needed for compilation

- [ ] **Step 1: Implement the layout input/output types and fallback gate**

Add a pure API in `channel-message-layout.ts`:

```ts
export interface ChannelMessageLayoutInput {
  content: string
  detail: string | null
  uiFont: 'sf-pro' | 'ibm-plex' | 'system-ui'
  maxContentWidth: number
  contentFont: string
  detailFont: string
  contentLineHeight: number
  detailLineHeight: number
  bubblePaddingX: number
  bubblePaddingY: number
  bubbleBorderWidth: number
  direction: 'inbound' | 'outbound'
  status: 'received' | 'sent' | 'failed'
}

export interface ChannelMessageLayoutResult {
  bubbleWidth: number
  bubbleHeight: number
  maxBubbleWidth: number
  maxWidthLineCount: number
  tightLineCount: number
  usedFallback: boolean
}
```

Rules:

- `uiFont === 'system-ui'` returns fallback sizing immediately
- fallback width uses max content width + chrome
- fallback height still uses conservative line-height math so rows remain stable

- [ ] **Step 2: Add `pretext`-backed content measurement and tight-width search**

Implement:

- cached `prepareWithSegments` by text + font
- first pass at max width using `layout()`
- binary search over width to preserve line count
- content/detail height accumulation

Suggested helper signatures:

```ts
function prepareCached(text: string, font: string): PreparedTextWithSegments
function findTightWidth(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): number
function estimateBlockHeight(prepared: PreparedTextWithSegments, width: number, lineHeight: number): { lineCount: number, height: number }
```

- [ ] **Step 3: Add cache invalidation hooks**

Expose a small utility:

```ts
export function clearChannelMessageLayoutCache(): void
```

Use it for theme/font invalidation later.

- [ ] **Step 4: Re-run the targeted test until it passes**

Run:

```bash
cd apps/desktop-web && npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/channel-message-layout.test.js
```

Expected: PASS for the new layout tests.

- [ ] **Step 5: Add one more regression test for detail-height inclusion**

Extend `apps/desktop-web/tests/channel-message-layout.test.ts`:

```ts
test('detail text increases bubble height in failed rows', () => {
  const withoutDetail = computeChannelMessageLayout({ ...baseInput, detail: null, status: 'failed' })
  const withDetail = computeChannelMessageLayout({ ...baseInput, detail: 'Webhook rejected preview update.', status: 'failed' })

  assert.ok(withDetail.bubbleHeight > withoutDetail.bubbleHeight)
})
```

- [ ] **Step 6: Commit the pure layout engine**

Run:

```bash
git add apps/desktop-web/src/features/tool-adapter/channel-message-layout.ts apps/desktop-web/tests/channel-message-layout.test.ts apps/desktop-web/tsconfig.tests.json
git commit -m "feat: add communication channels pretext layout engine"
```

### Task 3: Extract scroll/virtualization behavior into testable helpers

**Files:**
- Create: `apps/desktop-web/src/features/tool-adapter/channel-message-list-model.ts`
- Create: `apps/desktop-web/tests/channel-message-list-model.test.ts`

- [ ] **Step 1: Write failing tests for auto-scroll and row estimate helpers**

Create tests covering:

- initial load scrolls to bottom
- later updates only auto-scroll when distance from bottom is within threshold
- row estimate helper returns layout-driven height

Skeleton:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldAutoScrollChannelFeed,
  resolveChannelRowEstimate,
} from '../src/features/tool-adapter/channel-message-list-model.js'

test('auto-scroll sticks when near the bottom', () => {
  assert.equal(
    shouldAutoScrollChannelFeed({ hasInitialAutoScroll: true, scrollHeight: 1000, scrollTop: 820, clientHeight: 120, threshold: 96 }),
    true,
  )
})

test('auto-scroll does not snap when user is far from bottom', () => {
  assert.equal(
    shouldAutoScrollChannelFeed({ hasInitialAutoScroll: true, scrollHeight: 1000, scrollTop: 300, clientHeight: 120, threshold: 96 }),
    false,
  )
})
```

- [ ] **Step 2: Run the targeted test to verify failure**

Run:

```bash
cd apps/desktop-web && npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/channel-message-list-model.test.js
```

Expected: FAIL because the new model file does not exist yet.

- [ ] **Step 3: Implement the pure helper module**

Suggested signatures:

```ts
export function shouldAutoScrollChannelFeed(input: {
  hasInitialAutoScroll: boolean
  scrollHeight: number
  scrollTop: number
  clientHeight: number
  threshold: number
}): boolean

export function resolveChannelRowEstimate(layoutHeight: number, minRowHeight: number): number
```

- [ ] **Step 4: Re-run the targeted tests to verify pass**

Run:

```bash
cd apps/desktop-web && npx tsc -p tsconfig.tests.json && node --test .test-dist/tests/channel-message-list-model.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the list-model helpers**

Run:

```bash
git add apps/desktop-web/src/features/tool-adapter/channel-message-list-model.ts apps/desktop-web/tests/channel-message-list-model.test.ts
git commit -m "test: add communication channels list behavior helpers"
```

### Task 4: Build the virtualized message list and bubble components

**Files:**
- Create: `apps/desktop-web/src/features/tool-adapter/ChannelMessageBubble.tsx`
- Create: `apps/desktop-web/src/features/tool-adapter/ChannelMessageList.tsx`
- Modify: `apps/desktop-web/src/features/tool-adapter/CommunicationChannelsPane.tsx`
- Modify: `apps/desktop-web/src/shell/layout/ShellRoot.tsx`

- [ ] **Step 1: Thread appearance inputs into the pane**

Modify `ShellRoot.tsx` and `CommunicationChannelsPane.tsx` props to pass:

- `appearanceVersion`
- `uiFont`

Use these to invalidate layout cache when theme/font settings change.

Suggested prop shape:

```ts
appearanceVersion: string
uiFont: UiFont
```

- [ ] **Step 2: Add `ChannelMessageBubble.tsx`**

The bubble component should:

- receive precomputed layout metrics
- render the main content and optional error detail
- set width via inline style or CSS variable from the computed layout
- set row/bubble classes for direction and failed state only
- avoid hover interactions entirely

- [ ] **Step 3: Add `ChannelMessageList.tsx`**

The list component should:

- accept active conversation events
- measure available lane width from the list host
- compute per-row layout using `channel-message-layout.ts`
- use `useVirtualizer` with row estimates from layout results
- preserve bottom-stick behavior via `channel-message-list-model.ts`

Suggested shape:

```ts
function ChannelMessageList({
  events,
  uiFont,
  appearanceVersion,
}: Props) {
  // host width -> max content width
  // layout cache -> row estimates
  // virtual rows -> ChannelMessageBubble
}
```

- [ ] **Step 4: Replace inline message rendering in `CommunicationChannelsPane.tsx`**

Remove:

- direct `<ol>{activeEvents.map(...)}</ol>` rendering

Replace with:

```tsx
<ChannelMessageList
  events={activeEvents}
  uiFont={uiFont}
  appearanceVersion={appearanceVersion}
/>
```

Keep:

- conversation tab logic
- active conversation selection
- empty state

- [ ] **Step 5: Run focused build verification**

Run:

```bash
npm run typecheck
```

Expected: PASS or actionable TypeScript errors only in the touched files.

- [ ] **Step 6: Commit the structural React integration**

Run:

```bash
git add apps/desktop-web/src/features/tool-adapter/ChannelMessageBubble.tsx apps/desktop-web/src/features/tool-adapter/ChannelMessageList.tsx apps/desktop-web/src/features/tool-adapter/CommunicationChannelsPane.tsx apps/desktop-web/src/shell/layout/ShellRoot.tsx
git commit -m "feat: virtualize communication channels message list"
```

### Task 5: Apply the approved luminous workbench visual system

**Files:**
- Modify: `apps/desktop-web/src/features/tool-adapter/CommunicationChannelsPane.scss`

- [ ] **Step 1: Remove legacy hover-based bubble polish**

Delete or replace:

- hover-only box-shadow transitions
- old generic rounded-bubble look
- any styles that depend on hover for perceived quality

- [ ] **Step 2: Restyle the message surface for the approved direction**

Update SCSS so the message area uses:

- lighter, workbench-like surfaces
- adaptive inbound/outbound contrast
- dark mode softening instead of neon saturation
- visibly stronger but still integrated failed-state treatment

Keep CSS variables localized to this feature.

- [ ] **Step 3: Tighten message widths and preserve the single entrance motion**

Update styles to support:

- inline or variable-driven bubble widths from layout results
- static calm resting state
- only one message entrance animation: slight pop-up + fade
- `prefers-reduced-motion` fallback with no dramatic movement

- [ ] **Step 4: Verify visually in both themes**

Manual checks:

- graphite light normal conversation
- graphite dark normal conversation
- short inbound/outbound rows
- long inbound/outbound rows
- failed row with detail text
- narrow pane resize

Expected: no hover dependency, no horizontal scroll, no harsh dark-mode glare.

- [ ] **Step 5: Commit the visual redesign**

Run:

```bash
git add apps/desktop-web/src/features/tool-adapter/CommunicationChannelsPane.scss
git commit -m "feat: refresh communication channels message visuals"
```

### Task 6: Final verification and cleanup

**Files:**
- Review touched files from Tasks 1-5

- [ ] **Step 1: Run the full web unit suite**

Run:

```bash
npm --workspace apps/desktop-web run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run dependency-change minimum verification**

Run:

```bash
npm run typecheck
npm run build:tauri
cargo check --workspace
```

Expected: all three commands PASS.

- [ ] **Step 3: Perform manual product verification**

Manual checklist:

- open channels pane with a populated conversation
- confirm tab switching still works
- confirm initial load scrolls to bottom
- confirm new messages only auto-stick when already near bottom
- confirm light and dark themes both look correct
- confirm `system-ui` preference falls back without broken widths
- confirm failed messages are noticeably clearer than normal ones

- [ ] **Step 4: Inspect final diff for scope control**

Confirm:

- no terminal feature files changed
- no backend channel contract files changed
- no unrelated settings screens were restyled

- [ ] **Step 5: Create the final implementation commit**

Run:

```bash
git add docs/07_依赖选型与精简清单.md apps/desktop-web/package.json package-lock.json apps/desktop-web/src/features/tool-adapter apps/desktop-web/src/shell/layout/ShellRoot.tsx apps/desktop-web/tests
git commit -m "feat: redesign communication channels with pretext layout"
```
