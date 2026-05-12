## v0.5.0 (2026-05-12)

- 4865530 Fix git hook PATH handling in background commands
- c5f443b Fix workspace switch editor tab desync
- 3f97afd Implement AI provider workspace
- ce56621 Persist tab reorder across backend refreshes
- bf3872f Clear dragging state in drop handlers to prevent stuck tab
- 5dada0f Fix cross-window workspace tab drag-and-drop merge
- d4e11f3 Fix workspace tab reorder drop index
- e741714 Center StationCard activity comet
- 240ca33 Clean terminal recovery timers and tab reorder path
- 8d066d3 Fix detached workspace window terminal handoff
- a0b4e14 Keep file tree mounted across pane switches
- 9619e5d Add terminal file path drag from tree and tabs
- 8602c77 Fix clippy question_mark lint in app state
- 139bc62 Format tauri git and feishu command modules
- 143710b Simplify channel connector agent binding flows
- 5f86e1c Revert "Refine station dock restore ghost animation"
- d57ba15 Refine station dock restore ghost animation
- f826253 Optimize station dock restore animation
- 5aed00b Fix station dock restore layout flicker
- 2f73d5d Refine station minimize dock interactions
- 3ffb5d7 Fix terminal menu parsing and stale git discard paths
- 5755e17 Fix git discard for added files

## v0.4.2 (2026-05-09)

- 09d4b7e Harden workspace switching crash guards

## v0.4.1 (2026-05-09)

- 28ff64e fix(explorer): improve drag scroll and github seo
- e5eebf5 fix: 修复文件树拖拽移动链路
- 658295b Fix TUI menu parsing and rendered reply accumulation
- 38ba6fd Fix Codex terminal render recovery
- b53d38e feat(channel): support text-based option selection for terminal navigation prompts

## v0.4.0 (2026-05-06)

- 41eabeb ci(release): sync version from git tag before build
- b76087e fix(terminal): force close returns to idle state and adds confirmation dialog
- e6637d7 fix(windows): suppress console window flash and fix terminal close/delete
- 3e0ea27 Fix terminal force close cleanup
- 1500373 fix(git): align tag list payload contract
- 519a1c3 fix(tests): remove non-existent build_git_commit_payload import and test
- f2e0bb3 fix(terminal): enforce minimum contrast ratio for light theme readability
- 33533f1 fix(git): use is_none_or to satisfy clippy::unnecessary-map-or
- 831cd61 fix(git): fix tag list payload key and polish styles for responsiveness
- 1b5f57a feat(git): add ⌘R keyboard shortcut to refresh git status
- e539aa8 feat(git): hunk-level stage/unstage buttons in DiffViewer
- 6bceb56 feat(git): merge and conflict resolution UI
- fa56930 feat(git): cherry-pick, revert, reset actions in commit graph detail panel
- ea05174 feat(git): tag management UI with create, delete, and push
- e2312ed feat(git): multiline commit editor with amend toggle and keyboard shortcut
- e01c8f1 refactor(git): extract inline components from GitPane.tsx into separate files
- f328899 refactor(git): decompose useGitWorkspaceController into focused sub-controllers
- ec4ad00 feat(git): add frontend API wrappers and i18n for new git commands
- dda6ae6 feat(git): add commit amend support
- 6187359 feat(git): add hunk-level stage/unstage backend commands
- 0a1741d fix(git): remove auto-abort from merge conflict path — leave repo in conflicted state
- 3f8e6af feat(git): add merge, conflict_list, merge_continue, merge_abort backend commands
- bd53989 feat(git): add cherry-pick, revert, reset backend commands
- 7547308 fix(git): use structured output in tag_list, validate annotated tag message
- c719364 feat(git): add tag list/create/delete/push backend commands
- e4e68c8 docs: add Git panel redesign implementation plan
- 18d1e87 docs: add Git panel redesign design spec
- e9812fa chore: update Cargo.lock with urlencoding dependency
- a91e363 fix(feishu): allow dead_code on API response structs
- 4fc7e2b fix(theme): polish sakura-night theme — fix broken selectors and hardcoded colors
- 4b0eed7 feat(theme): add Sakura Night (樱花夜) dark theme with neon pink accents
- 4451ac3 feat(feishu): update channel description for QR scan flow
- 24c845e style(feishu): add QR scan component styles
- 40c1569 feat(feishu): replace manual credential form with QR scan wizard step
- af0855e feat(feishu): add FeishuQrScan component with QR code display
- 094679b feat(feishu): add frontend types and API methods for QR login
- 1a7fcb6 feat(feishu): add Tauri commands for QR login start and cancel
- c3b124b feat(feishu): add QR login orchestration with background polling and cancellation
- a9e9328 feat(feishu): add app_registration module for OAuth device-code flow
- d6af404 feat(feishu): add QR login result types for device-code flow
- 45e855d docs: add Feishu QR scan implementation plan
- 2b5da3a docs: add Feishu QR scan connection design spec
- 2c31372 fix(station): remove blocked/pending metric from role overview stats
- c7f75e0 feat(editor): add Dart/Flutter and 11 more language mappings
- f854a57 fix(shell): expand titlebar drag region to fill space right of tab bar
- 7c8f419 feat: update app icons with new branding
- c873c02 Improve terminal restore scheduling
- 937da3c Polish workspace switch transitions

# Changelog

All notable changes to this project are documented in this file.

## v0.3.3 (2026-04-28)

- 6d5c1be fix(workspace): properly close workspace content and switch view on close
- 22db542 feat(terminal): suspend/recover terminal sessions across workspace switches; simplify agent installer PATH detection

## v0.2.0 - 2026-04-13

### Highlights

- Fixed AI provider deletion so workspace-scoped provider cleanup and related persistence no longer leave stale records behind.
- Reworked Markdown preview rendering to restore local image display and improve split-view preview behavior in the file editor.
- Stabilized the desktop Tauri build and Rust CI path, including bundled agent communication resources and follow-up workspace/runtime fixes.
- Refreshed the public README and release-facing project positioning ahead of the 0.2.0 release line.

## v0.1.6 - 2026-04-08

### Highlights

- Tightened the release workflow so GitHub Releases must carry a macOS `.dmg`, Windows NSIS installer, and Linux `.deb` package.
- Updated release documentation to reflect unsigned macOS DMG behavior and the new `v0.1.6` tag target.

## v0.1.5 - 2026-04-08

### Highlights

- Unified the file preview flow with shared preview tabs and added PDF preview support.
- Refactored the channel management UI and expanded multi-language support for channel surfaces.
- Continued terminal subsystem refactoring work and restored preview-related unit coverage.
- Improved agent installer and uninstaller compatibility across multiple local npm installation layouts.

## v0.1.4 - 2026-04-05

### Highlights

- Replaced the old MCP-oriented agent collaboration flow with the `gto` local CLI as the primary communication surface.
- Added stronger `gto wait` handling for explicit replies, observed fallbacks, and interaction-required states.
- Simplified enhancement UX around `GTO Plugin`, refreshed README structure for open-source maintenance, and cleaned up lingering MCP-oriented guidance.

## v0.1.3 - 2026-03-30

### Highlights

- Repairs unsigned local macOS app bundles with ad-hoc codesign before DMG creation, so manual local installs no longer require users to re-sign the app themselves.
- Keeps the unsigned local testing distribution model while reducing the number of manual post-install steps.

## v0.1.2 - 2026-03-30

### Highlights

- Removes external channel reply suffixes such as `[source=... confidence=... phase=...]` from user-facing message bodies.
- Keeps MCP installation local-bundled inside the desktop app and prefers Rust fallback config writing over `npx`.
- Reintroduces manual unsigned macOS DMG packaging for users willing to bypass Gatekeeper locally.

## v0.1.1 - 2026-03-29

### Highlights

- Keeps local macOS Tauri builds working without Apple signing credentials by skipping DMG generation instead of hard-failing the build.
- Prevents accidental re-publication of unsigned macOS DMGs while still preserving a local `.app` build for developer testing.
- Rolls release metadata forward to `v0.1.1` for a clean replacement release.

## v0.1.0 - 2026-03-29

Initial tagged GT Office production release.

### Highlights

- Delivered the cross-platform desktop shell for workspace, files, terminal, Git, multi-station collaboration, and tool adapter workflows.
- Hardened terminal presentation for production by removing station bootstrap metadata from visible terminal output and disabling the terminal debug panel in station cards.
- Kept Codex/Claude/Gemini-oriented CLI flows workspace-bound, with improved rendered-screen parsing and cleaner human-facing terminal content.
- Refreshed repository release docs, including the root README and release guidance.
