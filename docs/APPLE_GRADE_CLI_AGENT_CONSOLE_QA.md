# Apple-Grade CLI Agent Console QA

> Scope: CLI Agent, Terminal, Agent Session, Workspace/Git adjacency
> Platforms: macOS first, Windows parity
> Source target: [APPLE_GRADE_CLI_AGENT_CONSOLE.md](APPLE_GRADE_CLI_AGENT_CONSOLE.md)

Use this checklist before claiming the CLI Agent / Terminal Console feels native. It is intentionally manual because several requirements can only be proven in a real desktop shell: IME composition, window focus, native menus, file drag/drop, notifications, multi-monitor placement, and WebView lifecycle behavior.

Current automated status records are tracked in [APPLE_GRADE_CLI_AGENT_CONSOLE_QA_STATUS.md](APPLE_GRADE_CLI_AGENT_CONSOLE_QA_STATUS.md).

## Required Evidence

Record these with each run:

- Date, app version or commit SHA, OS version, display setup, input methods enabled.
- Commands run before manual QA.
- Screenshots or short recordings for visual/focus regressions.
- Exact failure text for terminal/provider/workspace errors.
- Whether each item is pass, fail, not applicable, or not verified.

## Preflight

Run from the repository root:

```bash
npm run typecheck
cargo check --workspace
```

For release candidates, also run the release-required build gates defined by the release process.

Static checks:

```bash
rg -n "cursor:\s*pointer" apps/desktop-web/src/features/terminal apps/desktop-web/src/features/workspace-hub apps/desktop-web/src/features/workspace apps/desktop-web/src/shell/layout -g '*.scss' -g '*.tsx' -g '*.ts'
rg -n "behavior:\s*['\"]smooth|scrollIntoView\([^\n]*smooth|scrollTo\([^\n]*smooth" apps/desktop-web/src/features/terminal apps/desktop-web/src/features/workspace-hub apps/desktop-web/src/features/workspace apps/desktop-web/src/shell/layout -g '*.ts' -g '*.tsx'
```

Expected result: no broad `cursor: pointer` in the console priority surfaces and no JS smooth-scroll usage in terminal/session switching paths.

## macOS QA

### Launch, Window, Focus

- [ ] Warm activation opens the console and is interactive without a visible blank frame.
- [ ] Cold launch reaches a usable workspace console or shows real progress.
- [ ] Initial focus lands in the most likely input when opening the console.
- [ ] Station/session activation restores focus to the terminal input without requiring a click.
- [ ] Hide, minimize, restore, and app re-focus do not leave stale WebView UI.
- [ ] Window restores on the correct display and does not jump to screen 0 in multi-monitor setups.
- [ ] Standard window shortcuts behave as native macOS users expect: close, minimize, zoom/fullscreen.

### Keyboard Operation

- [ ] Tab reaches station list, terminal controls, quick commands, command sheets, and modals in a logical order.
- [ ] Enter/Space activates focused command buttons.
- [ ] Escape dismisses the nearest transient state: command sheet, modal, confirmation dialog, or popover.
- [ ] Quick commands are reachable and executable without mouse use.
- [ ] Agent/session list selection can be operated without losing terminal scroll/input context.
- [ ] Focus rings are visible on every interactive control and are not clipped.

### Terminal Responsiveness

- [ ] Typing into an active terminal remains responsive while output is streaming.
- [ ] Large output does not visibly hitch the terminal scroll or input echo.
- [ ] Session switching preserves scrollback, input draft, focused control, and session identity.
- [ ] Launching a CLI agent shows visible feedback within 200 ms.
- [ ] Terminal resize does not leave blank or stale xterm regions.
- [ ] Hidden or background terminal output catches up without flooding React renders when the station becomes active.

Suggested streaming smoke command:

```bash
for i in {1..2000}; do echo "line $i $(date +%s%N)"; done
```

Suggested interactive echo smoke command:

```bash
python3 - <<'PY'
import sys
print("type text; Ctrl-D exits")
for line in sys.stdin:
    print("echo:", line.rstrip())
PY
```

### IME

- [ ] Pinyin composition appears at the terminal caret, commits correctly, and does not duplicate characters.
- [ ] Japanese kana composition appears at the caret and commits correctly.
- [ ] Korean Hangul composition appears at the caret and commits correctly, when available.
- [ ] IME composition remains correct after station switch, terminal restore, and modal open/close.

### State And Error Scannability

- [ ] Every active agent exposes one of: idle, launching, live, busy, waiting, blocked, errored, recovering, stopped.
- [ ] Blocked state is visually distinct from busy and waiting.
- [ ] Status labels have useful hover titles and assistive labels.
- [ ] Errors name the failing surface: provider launch, terminal session, workspace policy, Git operation, channel dispatch, or IPC.
- [ ] State badges do not flicker during normal terminal output.

### Visual And Motion

- [ ] Console chrome uses system UI font; terminal/output uses monospace where appropriate.
- [ ] Dark and light themes switch without visible one-frame flicker.
- [ ] UI is compact and information-dense; no decorative hero/card treatment appears in the console path.
- [ ] Rows and native-like controls do not show broad pointer cursors.
- [ ] Chrome text is not selectable; terminal output and editable fields remain selectable.
- [ ] Buttons have visible pressed states.
- [ ] With `prefers-reduced-motion: reduce`, nonessential transitions and animations become instant or near-instant.
- [ ] Programmatic scroll uses native behavior; no smooth-scroll polyfill is visible.

### Native Integration

- [ ] File drag/drop into terminal uses real file paths and does not show browser-style drag behavior.
- [ ] Native context menu behavior is acceptable for terminal/content surfaces.
- [ ] Notifications, if triggered by agent/channel events, use native notification behavior.
- [ ] Native file/save dialogs are used for workspace/file operations where applicable.
- [ ] Accessibility inspection confirms dialogs expose role, label, focus, and dismissal behavior.
- [ ] VoiceOver can read station state, command controls, terminal status overlays, and modals.

### Performance Sampling

- [ ] Warm activation to interactive console is under the target or has a documented baseline/margin reason.
- [ ] Command input echo remains perceptibly immediate.
- [ ] Agent/session switch is perceptibly under 100 ms after cached metadata.
- [ ] Hidden/minimized background CPU is effectively idle unless work is active.
- [ ] Activity Monitor shows no unexpected sustained CPU or battery impact after idle.

## Windows QA

Run the same functional paths on Windows and record differences that are platform-conventional rather than arbitrary.

- [ ] WebView2 renders without first-frame flash or stale restore after minimize.
- [ ] Ctrl/Alt shortcuts follow Windows expectations.
- [ ] Focus rings remain visible and are not macOS-only styling assumptions.
- [ ] Narrator can read station state, command controls, terminal status overlays, and modals.
- [ ] File drag/drop from Explorer into terminal works with real paths.
- [ ] Window minimize, close, restore, and multi-monitor placement behave predictably.
- [ ] Single-instance behavior focuses the existing app instance instead of spawning duplicates.
- [ ] Notifications use Windows native toast behavior where applicable.
- [ ] Terminal output streaming and session switching match macOS behavior.
- [ ] High contrast or increased text scale does not break console controls.

## Failure Handling

For each failure, record:

- Surface: terminal, station list, command sheet, workspace, Git, provider launch, channel dispatch, shell/window, or accessibility.
- Reproduction steps.
- Expected behavior.
- Actual behavior.
- Whether the likely cost is WebView/native baseline or app margin cost.
- Whether it meets a native-shell escalation trigger in `APPLE_GRADE_CLI_AGENT_CONSOLE.md`.

Native-shell spike candidates must name the tradeoff: native control, platform fidelity, iteration speed, code sharing, test surface, and release complexity.

## Release Decision

The console is not Apple-grade complete until:

- [ ] Preflight commands pass.
- [ ] macOS QA passes or every failure is documented with owner and release decision.
- [ ] Windows parity QA passes or every failure is documented with owner and release decision.
- [ ] IME checks pass on macOS.
- [ ] Accessibility checks pass for keyboard and screen-reader operation.
- [ ] Performance misses are classified as baseline or margin cost.
- [ ] Any native-shell escalation trigger has a filed spike or an explicit defer decision.
