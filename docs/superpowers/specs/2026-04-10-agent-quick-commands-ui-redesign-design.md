# Agent Quick Commands Settings UI Redesign — Design Spec

## Overview

Redesign the quick-command settings UI for each CLI agent provider (`claude`, `codex`, `gemini`) into a cleaner, higher-efficiency configuration surface.

The new direction is:

- Apple-style desktop UI
- high space efficiency without feeling cramped
- single-plane layout, avoiding heavy nested cards
- optimized for fast configuration rather than deep form editing

Confirmed design choices:

- Primary direction: `A. Single-page high-density configuration desk`
- Detailed variant: `A1. Top active rail + command library below`
- Product intent: `fast configuration desk`

This redesign targets the existing frontend quick-command settings surface, primarily:

- `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx`
- `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.scss`

## Goals

1. Let users understand the currently effective quick-command set immediately.
2. Reduce configuration friction for enable, disable, reorder, and create-custom flows.
3. Improve space utilization on desktop without creating visual crowding.
4. Remove the current feeling of stacked sections nested inside another settings block.
5. Keep the interaction model consistent across all providers.

## Non-Goals

- No backend or data model changes.
- No change to quick-command execution semantics.
- No redesign of the full provider workspace modal outside the quick-command area.
- No expansion into advanced command metadata or multi-step editors.

## Current Problems

The current quick-command settings surface is functionally complete, but the UI/UX has several issues:

1. **Too many layers**
   The layout uses an outer summary block, then multiple inner sections, then sub-panels inside those sections. This creates an over-nested feeling and weakens scan speed.

2. **Result is not visually primary**
   Users must mentally parse the structure before seeing what is actually enabled. The active command set should be the first thing visible.

3. **Interaction focus is fragmented**
   Reordering, preset toggling, custom editing, and visibility are distributed across separate clusters. The user shifts attention between multiple local interaction models.

4. **Custom editing consumes too much visual weight**
   The custom command composer looks like a standalone panel instead of a quick inline action.

5. **Density is inconsistent**
   Some areas are pill-based and compact; others are panel-based and spacious. The page does not feel intentionally dense.

## Primary UX Strategy

The new quick-command UI becomes a **single-page control desk** with one dominant mental model:

- **Top**: current active result
- **Bottom**: source library and quick creation

Users should move through one fast loop:

1. inspect active rail
2. reorder or select an active command
3. add/remove commands in the library below
4. optionally create a custom command inline

This keeps the page flat, direct, and high-throughput.

## Information Architecture

### Overall Structure

The new layout is a single continuous surface with light sectional separation rather than nested cards:

1. **Header strip**
   - section title
   - short description
   - visibility toggle
   - active count

2. **Top Active Rail**
   - horizontally arranged active command capsules
   - drag reorder
   - left/right move buttons
   - active selection state
   - compact details strip for the selected command

3. **Command Library**
   - `Official preset commands`
   - `Custom commands`

4. **Inline Create Row**
   - compact “Add custom command” entry
   - expands in place when invoked

### Hierarchy Rules

- Only the active rail receives elevated visual emphasis.
- Library sections do not become standalone floating cards.
- Section differences are conveyed by spacing, thin separators, subtle background tone shifts, and typography.
- Details are progressive and appear inline, not in extra nested containers.

## Layout Specification

### Header Strip

The top header remains compact and always visible within the quick-command settings area.

Contents:

- title: `Quick Commands`
- one-line helper description
- active count badge
- visibility toggle

Rules:

- avoid collapsible summary behavior
- no separate expand/collapse shell
- keep interaction cost near zero

### Top Active Rail

This is the main “current output” zone.

Behavior:

- shows enabled preset and custom commands in current order
- supports drag-and-drop reordering
- also supports explicit move-left / move-right controls for precision and accessibility
- supports keyboard focus and logical tab order
- supports selected state for one capsule at a time

Capsule contents:

- primary text: command label
- secondary token: one short state only
  - either `Preset` / `Custom`
  - or custom submit mode

Do not show multiple tags inside a single capsule by default.

### Selected Command Detail Strip

When a capsule is selected, show a lightweight inline detail strip directly under the rail.

Contents:

- full command description or actual command text
- minimal actions depending on type
  - custom: edit, delete
  - preset: remove

Rules:

- this is not a separate modal
- this is not a large embedded card
- keep height low and copy concise

### Command Library

The library sits below the active rail and uses dense row-based items.

#### Official Preset Commands

Each row contains:

- label
- one-line description
- current state indicator
- single primary action: `Add` or `Remove`

State must not rely on color alone. Use:

- icon
- text
- subtle tone change

#### Custom Commands

Each row contains:

- custom label
- command preview in mono or subdued text
- submit mode tag if needed
- actions: `Add/Remove`, `Edit`, `Delete`

The row structure should visually align with preset rows to avoid creating a second design language.

### Inline Create Row

The create flow is optimized for speed.

Collapsed state:

- one compact row/button: `Add custom command`

Expanded state:

- label input
- command input
- submit mode switch/segmented control
- primary action: `Save and add`
- secondary action: `Save only`
- cancel action

Rules:

- expand inline within the custom section
- no modal
- no detached composer block competing with the rest of the page
- use the minimum number of fields needed for first success

## Interaction Design

### Core User Flow

Primary loop:

1. user scans active rail
2. user adjusts order if needed
3. user adds/removes preset commands below
4. user creates a custom command inline if preset options are insufficient
5. saved custom commands become immediately available and can join the active rail

### Save Behavior

For a fast configuration desk, default custom creation behavior should be:

- **primary**: `Save and add`

Rationale:

- most users create a custom command because they intend to use it immediately
- this removes one extra step after save

Secondary action:

- `Save only`

### Editing Behavior

Editing a custom command should reuse the inline create row area instead of opening a separate editor surface.

Rules:

- entering edit mode replaces the create row state
- save updates the existing item in place
- cancel returns to collapsed mode

### Reordering Behavior

Reordering should support both:

- drag-and-drop
- discrete arrow movement

This serves:

- speed for pointer users
- precision for dense layouts
- accessibility and keyboard-friendly workflows

### Visibility Toggle

The visibility toggle remains available in the header strip, not buried elsewhere.

Rationale:

- rail visibility is a global preference for this provider
- global preference belongs in the top utility area

## Visual Design Direction

### Style

Target style:

- Apple-inspired desktop utility UI
- calm, neutral, refined
- subtle depth
- minimal chrome
- no excessive glass or decorative motion

### Layering

Use a **single surface with light sectional definition**:

- page/base surface
- slightly elevated active rail zone
- flat row-based library below

Avoid:

- card inside card inside card
- thick borders around every subsection
- oversized container shadows

### Spacing

Principle:

- comfortable breathing room horizontally
- compact but readable vertical rhythm

Desired outcome:

- one screen shows several active commands and a substantial portion of the library
- controls do not feel cramped
- whitespace is used intentionally, not expansively

### Typography

Rules:

- strong but restrained section headers
- short helper copy
- command previews may use monospace selectively
- body copy remains highly legible in both light and dark themes

### Color

Use a neutral-first system:

- primary emphasis through existing accent token
- very limited colored backgrounds
- active, selected, drop-target, and primary-action states may use accent tint

Do not:

- color large sections aggressively
- encode state by color alone

### Motion

Use only subtle micro-interactions:

- short hover feedback
- restrained press feedback
- crisp drag target highlighting

Avoid:

- bouncy scale animations
- large spring transitions
- decorative motion unrelated to task feedback

## Accessibility Requirements

1. All icon-only controls require accessible labels.
2. Error and validation messages must be announced with `role="alert"` or equivalent.
3. All functionality must remain keyboard accessible.
4. Tab order must follow visual order.
5. State cannot be communicated by color alone.
6. Inputs must have explicit labels, not placeholder-only labeling.
7. Focus states must remain visible in light and dark themes.

## Responsive Behavior

Primary target is desktop, but the layout must degrade cleanly.

### Desktop

- active rail remains horizontal
- library stays in a single-column stacked section layout

### Narrow widths

- active rail can wrap or become horizontally scrollable
- detail strip should remain directly below the rail
- library rows may stack secondary actions without losing clarity
- inline create row may collapse into a taller vertical layout

## Implementation Guidance

### Scope

Frontend-only redesign of the existing quick-command settings surface.

Expected files:

- `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.tsx`
- `apps/desktop-web/src/features/settings/ai-providers/shared/ProviderQuickCommands.scss`

Possible supporting touch points if needed:

- i18n copy keys currently used by quick-command settings
- small helper extraction only if it reduces complexity locally

### Structural Changes

1. Remove the current expandable summary-shell mental model.
2. Replace multi-panel inner sections with a flat top-to-bottom layout.
3. Promote enabled capsules into a persistent top active rail.
4. Convert preset and custom areas into aligned dense list rows.
5. Replace large custom composer panel with inline quick-create/edit row.

### Constraints

- keep existing persistence model and preference wiring
- do not change command IDs or ordering semantics
- do not introduce unrelated refactors outside quick-command settings
- preserve localization structure

## Validation Plan

Minimum validation after implementation:

1. `npm run typecheck`
2. targeted frontend tests for quick-command preferences/model if affected
3. manual verification in settings UI for:
   - toggle visibility
   - enable preset command
   - remove preset command
   - create custom command
   - edit custom command
   - delete custom command
   - drag reorder
   - keyboard focus behavior
   - light and dark theme pass

## Open Questions

1. Whether the active rail should wrap or horizontally scroll first on narrower widths.
2. Whether custom row editing should fully replace the create row or allow inline row expansion.
3. Whether the selected detail strip should show the full command text by default or only on demand for long commands.

## Recommendation

Proceed with the redesign as a focused frontend UI/UX refactor within the existing quick-command settings component, using the confirmed `A1` structure as the source of truth.
