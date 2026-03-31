# Station Terminal Header Unification Design

**Date:** 2026-03-31

## Goal

Adjust the workspace hub station terminal card header so the left-side identity metadata reads as one unified element instead of separate pills, and make the header background transparent.

## Approved Direction

- Keep the current header layout and right-side action buttons.
- Replace the split `name / role / tool` presentation with one combined identity block.
- Inside the identity block, keep hierarchy:
  - `name` is the strongest text.
  - `role` and `tool` remain visible but visually secondary.
  - Segments are separated with centered dots.
- Keep the tool/provider label dynamic rather than replacing it with a generic `agent`.
- Make the header container background transparent.
- Keep a light bottom divider so the top edge still reads cleanly against the terminal body.
- Use a lightly translucent fill and border on the combined identity block so it stays readable over the terminal shell and still matches the existing Apple-like glass language.

## Affected Files

- `apps/desktop-web/src/features/workspace-hub/StationCard.tsx`
- `apps/desktop-web/src/features/workspace-hub/StationCard.scss`
- `apps/desktop-web/src/features/workspace-hub/station-card-header-model.ts`
- `apps/desktop-web/tests/station-card-header-model.test.ts`

## Implementation Notes

- Move the identity composition into the header model so JSX stays simple.
- Render a single wrapper element for the unified identity block.
- Style the wrapper as one capsule with internal emphasis differences instead of multiple pills.
- Let the name segment shrink first in compact widths; role and tool should remain legible.

## Verification

- Run the focused header model test suite.
- Run the desktop web build to verify TypeScript and SCSS integration.
