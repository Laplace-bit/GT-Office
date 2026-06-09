# Apple-Grade CLI Agent Console

> Status: product and engineering quality target
> Scope: CLI agent console, terminal session surface, workspace/file/Git adjacency
> Applies to: macOS first, Windows parity required

## 1. Goal

GT Office's CLI agent area must feel like an Apple-grade productivity console: quiet, fast, keyboard-first, visually restrained, and platform-consistent. The user should experience Claude Code, Codex CLI, workspace files, Git changes, and session recovery as one native desktop workflow instead of a web panel wrapped in a window.

North-star sentence:

> The CLI Agent experience in GT Office must reach macOS official productivity-app quality: low latency, keyboard-first operation, restrained visual hierarchy, clear state, platform consistency, and user-perceived responsiveness as the highest priority.

This target directly supports the current strategy in [STRATEGIC_DIRECTION.md](STRATEGIC_DIRECTION.md): GT Office is an Agent Workspace OS where workspace, session, terminal, files, Git, provider bootstrap, and channel control are the core value path.

## 2. Native-Feel Principles

This target uses `$native-feel-cross-platform-desktop` as the quality model. The most relevant tenets are:

- T3, adopt the platform; don't compete with it: use system font, system accent, native focus behavior, native scroll behavior, native shortcuts, native dialogs, and platform window behavior where available.
- T4, performance is a property of perception: optimize the interactions the user feels, especially hotkey activation, typing, terminal output, agent switching, and workspace/session restoration.
- T6, cross boundaries intentionally: Tauri IPC, terminal event streams, Git updates, and agent runtime events must be batched, observable, and kept out of accidental render hot loops.
- T8, separate baseline cost from margin cost: WebView and terminal baselines are accepted; avoid margin costs from excessive React rerenders, unbounded logs, unnecessary shadows, and always-on polling.

Current architecture note: GT Office currently uses Tauri + React + Rust, as described in [ARCHITECTURE.md](ARCHITECTURE.md). `$native-feel-cross-platform-desktop` warns that Tauri can become a control-loss compromise for extreme native feel. This document does not require an immediate shell rewrite. It sets the quality bar that current Tauri/WebView work must meet first, and defines when to escalate to native-host spikes.

## 3. Product Surface

The Apple-grade console covers these surfaces:

- Agent station/session list and active session selection.
- Embedded terminal for Claude Code, Codex CLI, and other AI coding tools.
- Command input, command history, prompt dispatch, quick commands, and launch actions.
- Agent lifecycle states: idle, launching, live, busy, waiting, blocked, errored, recovering, stopped.
- Workspace context: root path, active branch, dirty files, current session, provider/tool profile.
- File/Git adjacency: changed files, diff entry points, basic edit handoff, commit path.
- External control adjacency: gto, WeChat/Feishu control, and channel-originated terminal dispatch when present.

It explicitly does not mean adding more workbench spectacle. Station/workbench remains a session organization model, not the main product story.

## 4. Experience Requirements

### 4.1 Visual

- Use system font for chrome: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI Variable`, `Segoe UI`, then generic `sans-serif`.
- Follow system light/dark preference with no visible flicker during theme changes.
- Follow system accent where shell APIs expose it; otherwise keep accent restrained and non-brand-heavy.
- Use compact, information-dense layouts that support repeated daily work.
- Prefer full-width panes, split views, sidebars, toolbars, and native-feeling lists over decorative cards.
- Avoid web-signaling decoration: heavy gradients, large marketing hero patterns, oversized shadows, nested cards, and ornamental animation.
- Terminal and output areas may use monospace; surrounding controls should remain system UI.

### 4.2 Interaction

- Keyboard-first operation is required across the console.
- Initial focus must land in the most likely input when the console opens or a session becomes active.
- `Esc` must always close, cancel, clear, or dismiss the nearest active transient state.
- macOS shortcuts use Command conventions; Windows shortcuts use Control/Alt conventions.
- Agent/session lists support arrow navigation and type-ahead where practical.
- Agent switching preserves terminal scroll position, input draft, and session context.
- Command history and quick commands must be reachable without mouse use.
- Buttons and rows need visible pressed/focused states. Hover states are subtle and control-specific.
- Do not apply `cursor: pointer` broadly to rows, tabs, and native-like controls.
- Text selection is disabled for chrome and enabled only for editable fields and user/content output.

### 4.3 Motion

- Use motion only for state continuity: launch, connect, busy, blocked, output arrival, panel reveal, and focus relocation.
- Prefer short ease curves around 120-180 ms for UI state changes.
- Avoid default route fades, large spring/bounce effects, and skeleton screens for fast operations.
- Respect `prefers-reduced-motion`; nonessential motion must become instant or near-instant.
- Terminal output should never be delayed to make animation look smoother.

### 4.4 Terminal

- Terminal input echo must stay responsive even while output is streaming.
- Large output must be chunked, buffered, virtualized, or delegated to xterm behavior instead of forcing React to render every line.
- Terminal scrollback and restoration should be stable across workspace/session switches.
- Terminal IME must be tested on macOS with Pinyin and at least one additional IME path when changing input handling.
- Programmatic scroll uses native behavior; avoid JS smooth-scroll polyfills.
- Operations under 200 ms should not show loading UI; 200 ms to 2 s may show a compact spinner/progress state; beyond 2 s must show explicit progress or status.

### 4.5 Agent State

- Every active agent must expose a scannable state: idle, launching, live, busy, waiting, blocked, errored, recovering, stopped.
- Blocking conditions must be visually distinct from normal busy states.
- Error messages must include the failing surface: provider launch, terminal session, workspace policy, Git operation, channel dispatch, or IPC.
- Agent state changes must be stable enough to scan; avoid flickering badges caused by transient polling.
- Git/file changes triggered during an agent session should surface near the session, with direct navigation to diff or changed file.

## 5. Perceived Performance Targets

These are user-perceived targets, not internal benchmark vanity metrics.

| Interaction | Target |
| --- | --- |
| Warm hotkey or shell activation to visible interactive console | < 120 ms |
| Cold launch to first usable workspace console | < 600 ms when dependencies are warm; otherwise show real progress |
| Command input echo | < 16 ms |
| Agent/session switch | < 100 ms |
| Terminal output frame budget during active streaming | no visible typing or scroll hitch |
| Workspace switch after metadata is cached | < 200 ms to interactive shell |
| Provider/tool launch feedback | visible state within 200 ms |
| Network/config validation failure | surfaced within 10 s |
| Hidden/minimized background CPU | effectively idle unless work is active |

If a target cannot be met, the implementation must record the reason and whether the cost is baseline or margin.

## 6. Architecture Guardrails

- Do not put terminal, Git, or agent runtime hot loops through React state if refs, external stores, event coalescing, or xterm internals can carry the load.
- Do not let Tauri command handlers accumulate business logic. Keep them as thin orchestration over feature modules or crates.
- Every workspace-scoped operation must carry `workspace_id`.
- Terminal default `cwd` remains `workspace.root`; custom `cwd` must stay inside the workspace.
- IPC payloads must be typed, bounded, and observable for high-frequency paths.
- Agent/terminal event streams should batch output and state updates where the UI cannot perceive per-byte granularity.
- Provider and system capabilities must remain mockable.
- Avoid adding dependencies for polish unless [DEPENDENCIES.md](DEPENDENCIES.md) records purpose, alternatives, and impact.

## 7. Native Shell Escalation Triggers

Current Tauri/WebView work should satisfy all controllable native-feel requirements first. Escalate to a native-host spike only when one of these remains blocked by the framework boundary:

- Platform material cannot be applied correctly to the main window or console surfaces.
- Native context menus, system dialogs, notifications, or file drag/drop cannot match platform behavior.
- Window focus, multi-monitor placement, hotkey activation, or restoration cannot meet perceived performance targets.
- IME composition or focus routing remains unreliable in the WebView after targeted fixes.
- WebView lifecycle throttling causes visible stale UI after hiding, minimizing, or restoring windows.
- Accessibility cannot be made acceptable through WebView roles plus host integration.

Escalation means a small proof of concept first, not a full rewrite. The spike must name what is gained and what is given up: native control, platform fidelity, iteration speed, code sharing, test surface, and release complexity.

## 8. Roadmap

### Phase 0: Audit and Baseline

- Audit CLI agent, terminal, station, workspace, and Git adjacency against this document.
- Scan for web-native mismatches such as broad `cursor: pointer`, unbounded smooth transitions, hardcoded accent colors, text-selectable chrome, and fixed pixel-heavy controls.
- Add a checklist to future UI PRs touching the console.

### Phase 1: Visual and Interaction Baseline

- Normalize console typography, spacing, focus rings, list rows, toolbar controls, badges, and empty/error states.
- Align command input, quick commands, session switch, and agent launch controls to keyboard-first behavior.
- Ensure dark/light mode and reduced-motion behavior work on the console surfaces.

### Phase 2: Runtime Smoothness

- Measure and reduce hot paths in terminal output, agent switching, launch feedback, and workspace restoration.
- Batch or coalesce terminal/agent/Git events before they hit React.
- Preserve scroll, input draft, and focused control across session changes.

### Phase 3: Native Integration

- Validate window focus, native menus, file drag/drop, notifications, dialogs, IME, and accessibility on macOS first, then Windows.
- File native shell spikes only for issues that meet the escalation triggers.

### Phase 4: Polish and Regression Gates

- Add repeatable manual QA scripts for macOS and Windows.
- Use [APPLE_GRADE_CLI_AGENT_CONSOLE_QA.md](APPLE_GRADE_CLI_AGENT_CONSOLE_QA.md) as the manual QA script for desktop-only evidence such as IME, native window focus, file drag/drop, notifications, accessibility, and cross-platform parity.
- Add automated checks where practical: typecheck, focused tests, render checks, and performance instrumentation.
- Treat regressions in input echo, terminal streaming, focus, and session switching as release blockers.

## 9. Review Checklist

Use this checklist for any PR that touches CLI agent, terminal, station/session, workspace switch, Git adjacency, or shell chrome:

- Does the change make the Apple-grade console target more true?
- Does it preserve keyboard-first operation?
- Does it preserve terminal input responsiveness while output streams?
- Does it avoid broad web idioms such as `cursor: pointer` on native-like rows?
- Does it respect `prefers-reduced-motion`?
- Does it keep workspace-scoped operations explicit?
- Does it avoid business logic in Tauri command entry points?
- Does it avoid unbounded React rerenders for terminal, Git, or agent events?
- Does it include a verification path: test, typecheck, build, lint, screenshot, or documented manual QA?
- If the change touches desktop-only behavior, was the relevant part of [APPLE_GRADE_CLI_AGENT_CONSOLE_QA.md](APPLE_GRADE_CLI_AGENT_CONSOLE_QA.md) run or explicitly marked not verified?
