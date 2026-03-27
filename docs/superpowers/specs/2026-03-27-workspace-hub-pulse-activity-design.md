# Workspace Hub Comet Activity Icon Design

**Date:** 2026-03-27

**Goal:** Replace numeric unread badges on inactive terminal surfaces with a small comet-tail activity icon, and change the auto layout preset glyph to `A` for better recognition in compact workspace hub headers.

---

## Scope

- Replace numeric unread badges on inactive terminal surfaces.
- Apply the same semantic treatment to:
  - workspace hub inactive command cards;
  - focus-layout rail items;
  - terminal station pane header.
- Keep the active main station card free of the activity icon because the live terminal already expresses activity.
- Change the auto layout preset button from an icon to the letter `A`.

## Interaction Model

- Numeric unread counts are removed from inactive terminal-related surfaces.
- Agent output speed is represented as a compact comet-tail icon in the header signal zone.
- The icon is triggered by unread-count deltas, not by the accumulated unread total.
- Output speed is expressed by icon motion speed and tail intensity:
  - low: slower sweep;
  - medium: tighter sweep;
  - high: fastest sweep.
- When activity stops, the icon decays and disappears after a short timeout.
- Reduced-motion users see a static emphasized comet state instead of continuous motion.

## Visual Language

- Use a restrained Apple-style glass treatment.
- Keep the motion inside the header signal zone only.
- Do not render any text in the signal zone.
- Do not show any numeric badge on inactive cards after this change.
- The auto layout preset uses the glyph `A` to communicate “adaptive / auto”.
- Focus and custom layout presets keep icon-based affordances.

## Implementation Notes

- Extract speed mapping and decay timing into shared, pure logic so it can be unit-tested.
- Reuse the same comet icon component across workspace hub secondary surfaces instead of duplicating styling logic.
- Keep changes inside `apps/desktop-web/src/features/workspace-hub/` unless a shared pure helper belongs in terminal runtime state utilities.

## Verification

- Unit test the speed mapping and timeout behavior via pure helpers.
- Unit test the layout preset visual mapping so `auto` resolves to `A`.
- Run targeted unit tests, then `npm --workspace apps/desktop-web run build`.
