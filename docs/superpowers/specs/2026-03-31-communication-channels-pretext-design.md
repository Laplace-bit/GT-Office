# Communication Channels Pretext Design

## Summary

Redesign the `CommunicationChannelsPane` message surface into an elegant instant-messaging experience that feels specific to GT Office instead of a generic legacy chat panel. The new surface keeps the existing conversation grouping and event model, but replaces the current traditional bubble treatment with a lighter "Luminous Workbench" language and uses `pretext` to drive both tight message bubble widths and stable message-height prediction for long conversations.

This work is intentionally scoped to the communication-channel message surface. It does not change terminal rendering, task-center editing, or backend channel semantics.

## Goals

- Replace the current traditional chat bubble look with the chosen `C · Luminous Workbench` direction.
- Make message bubbles feel like an elegant instant-messaging product, not an operations dashboard.
- Use `pretext` to compute very tight bubble widths without changing the current wrapped line count.
- Use `pretext` to predict message heights so long conversations can move onto a stable virtualized list.
- Support both light and dark themes without the visual system collapsing in dark mode.
- Keep normal inbound/outbound distinction adaptive and restrained.
- Make error messages visually clearer than normal messages while staying inside the same design language.
- Preserve current conversation grouping, active-tab behavior, and near-bottom auto-scroll behavior.

## Non-goals

- no backend event-contract changes
- no changes to terminal rendering or terminal snapshot logic
- no markdown/rich-text message rendering
- no attachments, reactions, or inline action buttons
- no hover-driven visual system
- no redesign of channel settings or channel management pages outside the live message surface

## Existing Foundations

The current implementation already provides a usable functional base:

- `CommunicationChannelsPane.tsx` groups external events into per-conversation tabs and preserves the active conversation.
- The pane already implements "stick to bottom if near bottom" behavior for live updates.
- The current CSS already has a dedicated message surface and theme-aware token usage.
- The repo already ships `@tanstack/react-virtual`, so message virtualization does not require a new list library.

Relevant product constraints already exist in the docs:

- communication channels must be a user-facing message view rather than an operations panel
- messages must be grouped by external endpoint + internal target agent
- message bubbles should show only primary content, with failure detail when needed
- the surface must keep high information density and avoid horizontal scrolling

## Chosen Design Direction

### Visual direction

The selected direction is `C · Luminous Workbench`.

Target feel:

- instant-messaging product
- elegant and premium
- visually connected to GT Office's workbench identity
- lighter and calmer than conventional "left gray / right blue" chat UIs

The surface should feel like a premium conversation layer sitting inside the workbench, not like a support console and not like a consumer messenger clone.

### Motion direction

Motion is intentionally restrained:

- no hover-based affordances for message bubbles
- no hover-dependent polish for tabs or rows
- only new-message entrance animation is emphasized

Entrance motion:

- slight upward translation
- slight scale-in recovery
- short opacity fade-in

Reduced-motion behavior:

- respect `prefers-reduced-motion`
- reduce the entrance to near-static opacity-only or no-op behavior

## Visual Rules

### Normal messages

Normal messages use a light, material-driven message block rather than a heavy classic rounded balloon.

Shared characteristics:

- tight width
- soft edge definition
- restrained inner highlight
- low-noise shadows
- strong reading rhythm
- no decorative hover states

### Inbound vs outbound distinction

Inbound/outbound distinction is adaptive rather than fixed.

What stays constant:

- layout position still communicates direction
- inbound remains left-aligned
- outbound remains right-aligned

What adapts:

- contrast level between inbound and outbound
- tint intensity
- material separation

Adaptive rule:

- short messages may use slightly stronger distinction to improve scanability
- long messages should reduce contrast intensity so the conversation does not become a wall of competing blocks
- dark mode should further soften the contrast relative to light mode

The design must avoid a hard-coded old chat pattern such as "strong blue outgoing, dull gray incoming" across all cases.

### Light mode

Light mode should feel airy and expensive:

- inbound: pearl/frosted neutral with subtle depth
- outbound: cool luminous tint with restrained brand influence
- borders remain soft
- shadows remain low contrast

### Dark mode

Dark mode should feel composed rather than neon:

- inbound: graphite glass / smoked panel feel
- outbound: slight color lift and edge glow, but not a bright saturated slab
- body text must remain easy to read at long-message lengths
- surface hierarchy should remain clear without high-contrast glare

### Error messages

Error messages may be more obvious than normal messages.

Rules:

- stronger edge emphasis
- stronger background signal
- clearer status tone
- still consistent with the same workbench material system

Avoid:

- cheap alert-box red
- flat opaque error blocks that visually break the conversation

## Text Layout Design

### Why `pretext`

`pretext` is a good fit here because this surface has two exact problems it solves:

1. multiline bubble shrink-wrap
2. reliable text-height prediction without repeated DOM measurement work

That makes it relevant to this pane and not to unrelated areas such as xterm or CodeMirror.

### Scope of `pretext` usage

`pretext` is used only for plain message text in the communication channels surface.

It is responsible for:

- preparing and caching text measurement state
- computing line count at a max content width
- finding the narrowest width that preserves that line count
- computing predicted content height for a given width

It is not responsible for:

- rich text rendering
- emoji replacement or decoration
- markdown semantics
- message grouping or sorting

### Tight width rule

For each message:

1. compute the max allowed content width based on container width and message kind
2. compute the initial wrapped line count at that max width
3. binary-search the smallest width that keeps the same line count
4. use that width as the message content width
5. add style chrome padding and border space to produce final bubble width

This creates the "very tight" message treatment the user requested while avoiding reflow-heavy DOM probing.

### Height prediction rule

For each message:

- compute content height from `pretext`
- add vertical padding, border, and optional failure-detail spacing
- store the total as the row estimate

The estimate becomes the list's row size input and should remain stable across theme changes and resize events.

## Architecture

The redesign stays within `apps/desktop-web/src/features/tool-adapter/`.

### Keep unchanged

- external event grouping logic
- conversation-key derivation
- active-conversation selection logic
- current message-content extraction behavior
- near-bottom auto-scroll semantics

### New modules

Suggested structure:

- `CommunicationChannelsPane.tsx`
  - keeps conversation grouping, active selection, and feed state ownership
- `ChannelMessageList.tsx`
  - owns virtualization and row rendering
- `ChannelMessageBubble.tsx`
  - owns visual presentation of one message row
- `channel-message-layout.ts`
  - pure layout helpers, `pretext` preparation cache, tight-width and height computation
- `channel-message-theme.ts`
  - maps message kind + theme + density state into style tokens or CSS custom properties

The exact filenames may vary, but the separation should hold:

- layout math isolated from React rendering
- message visual logic isolated from data grouping logic

## Virtualization Strategy

The current pane renders all messages in the active conversation directly. That is acceptable for short threads but scales poorly.

The redesigned list should use `@tanstack/react-virtual`.

Rules:

- virtualize only the active conversation's messages
- use `pretext`-predicted row heights as `estimateSize`
- keep overscan modest to preserve smooth entrance animations
- preserve current bottom-stick behavior when the user is already near the bottom
- do not auto-snap when the user has intentionally scrolled away from the bottom

This gives a real payoff for the height-prediction work instead of leaving it as future-only infrastructure.

## Theme and Font Handling

### Theme integration

The surface must respond to the existing GT Office theme system:

- graphite light
- graphite dark

All message visuals should derive from CSS variables so that the theme remains declarative and localized to the feature styles.

### Font safety

`pretext` is not reliable enough on macOS when the effective UI font is `system-ui`.

Therefore:

- when the effective communication message font resolves to a safe named stack such as `SF Pro` or `IBM Plex Sans`, use `pretext` shrink-wrap and height prediction
- when the user chooses `system-ui`, fall back to CSS-driven message width and a conservative non-`pretext` height path
- the pane must remain fully functional under fallback; only the precision/polish decreases

This avoids breaking message layout for users who intentionally selected the `system-ui` preference.

### Font loading

If the chosen font family is not yet ready:

- render with fallback sizing first
- refresh layout once fonts are ready
- avoid visible layout thrash where possible by batching the update

## Detailed Behavior

### Bubble sizing behavior

- very short messages become noticeably tighter
- medium messages should still feel calm and balanced, not tiny pills
- long messages continue to respect a maximum width cap for readability
- failure-detail rows may widen slightly if needed, but should still follow the same width system

### Conversation tab behavior

Tabs should be visually upgraded to match the new message language:

- flatter
- cleaner
- more workbench-native

But behavior remains unchanged:

- same conversation grouping
- same active-tab switching
- same label model

### Error behavior

If `pretext` fails for any reason:

- log the error in a controlled way in development
- render the message with CSS width fallback
- continue using a safe row estimate

If the theme or font changes:

- invalidate cached layout inputs tied to the old text/font/style signature
- recompute only the visible or soon-visible rows first

## Data Model for Layout

Each rendered message row should derive a layout record from:

- `messageId`
- normalized text content
- message direction
- message variant (`normal` or `error`)
- theme mode
- effective font signature
- available lane width

Suggested derived fields:

- `contentWidth`
- `bubbleWidth`
- `contentHeight`
- `rowHeight`
- `lineCount`
- `usedFallback`

Layout caching should be keyed by the text and style signature, not by React component identity.

## Accessibility

- preserve semantic ordered list structure for the message stream
- preserve readable color contrast in both themes
- do not rely on hover for affordance or readability
- ensure error messages are visually distinct without depending only on color
- reduced motion must suppress the entrance animation intensity

## Validation Strategy

### Functional verification

- message grouping still matches current behavior
- active conversation switching still works
- live updates still stick to bottom only when appropriate
- error detail still renders when present

### Visual verification

- light mode normal conversation
- dark mode normal conversation
- inbound short message
- outbound short message
- long inbound message
- long outbound message
- error message in both themes
- narrow desktop width / resized pane width
- mixed-language messages including Chinese and English

### Layout verification

- tight width never changes the wrapped line count relative to max-width layout
- height prediction remains stable across repeated renders
- fallback mode triggers when using `system-ui`

### Engineering verification

- `npm run build`
- `npm run typecheck`

## Dependency Impact

This design introduces one new web dependency: `@chenglou/pretext`.

Before implementation:

- update `docs/07_依赖选型与精简清单.md`
- record why existing CSS-only layout is insufficient
- record why current dependencies do not already solve multiline shrink-wrap + stable height prediction together

## Tradeoffs

### Why this is worth it

- directly solves the user's two requested outcomes in one design
- creates a more distinctive communication surface
- reduces future list-scaling pain
- keeps the scope local to one feature

### Cost

- additional layout cache complexity
- theme/font-dependent invalidation logic
- fallback path required for `system-ui`

### Why still preferable to visual-only changes

Visual-only bubble redesign would improve appearance but would not solve:

- very tight bubble sizing
- stable long-list height prediction
- future virtualization integration

This design chooses the slightly larger but still feature-local change because it closes the problem properly.
