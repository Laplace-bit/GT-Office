## v0.7.6 (2026-09-02)

- 1c34152 fix(terminal): pin replay scroll and guard stale session snapshots; merge agent comms policy into CLAUDE.md
- 570b907 fix(session-registry): set busy_timeout before WAL pragma
- 8ec93fa fix(tests): remove stale agent-role API references left by role removal
- 9b11885 fix(ci): drop stale role_key field in gt-task tests; collapse text block match arm
- 54c2dd5 ui: 极简高端视觉基线——暖纸浅色主题、token 断链清扫、Monaco 主题重构
- 732bad8 fix(terminal): guarantee system PATH for in-app terminal shells
- a919971 feat： 优化文件管理，删除无用文件

## v0.7.5 (2026-07-28)

- a851ac1 Enhance quick dispatch rail and fix terminal presentation
- a60375d fix(workspace): keep terminal and fullscreen state instant on workspace switch
- 00a9b3f Unify station selection border

## v0.7.4 (2026-07-27)

- 032bf60 Polish workbench layout and shell chrome
- 97b01c8 Add agent runtime upgrade PRD
- 03e3b7f Add native window vibrancy and terminal focus fixes
- 8b7dee2 Improve terminal drag feedback

## v0.7.3 (2026-07-24)

- 277dbe6 Hide business designer nav entry from activity rail
- 1a0ad0f Fix terminal startup input state
- f9e81c2 Merge branch 'dependency-allowlist-sync'
- 848a722 fix: activate station before terminal launch
- b61b8cf Remove agent roles and role routing
- b5d17d5 feat: harden performance contracts, designer rules, and terminal UX
- e608207 Fix terminal startup focus and session history visibility
- d93960a fix(station): harden workbench terminal interactions
- f8bbc82 feat(agent): add AgentScope field to filter designer agents from station list
- 661f1a0 fix(git): harden workspace lifecycle and status
- b43be81 feat(designer): dispatch scenario to designer agent station terminal (B5 step 2a)
- e9532b2 fix(designer): remove broken freeform completion UI (B5 cleanup)
- e1a0331 feat(designer): useDesignerAgentStation controller + IPC wrappers (B4)
- 3723bf2 refactor(designer): delete headless freeform completion path (B3)
- 90f87f9 feat(designer): agent_station backend (ensure/render_scenario/checkpoint)
- b2fecab feat(agent): seed business-designer role for designer station
- dd574a3 fix(designer): address final-review findings
- c2b14fe docs(designer): sync artifact layer — deps, module design, contracts, ADR 0018
- 17a5135 feat(designer): display completeness gaps in inspector
- e81d825 feat(designer): uiScreen HTML iframe preview + dataContract object render
- 7478057 feat(designer): uiScreen kind + create defaults (frontend)
- 936dc68 feat(designer): compile + export code-gen-prompt.md asset
- 1b178dd fix(designer): satisfy clippy -D warnings in artifact-layer code
- a0d8030 feat(designer): render_code_gen_prompt code-gen asset renderer
- c996269 feat(designer): completeness_rules module + wire into validate
- 644791b feat(designer): check_data_contract JSON Schema consistency rule
- 49d5db7 chore(designer): commit scraper lockfile resolution
- 2534b5d feat(designer): check_ui_screen consistency rule + derive_edges UI arm
- 023e1fa feat(designer): support uiScreen block kind + dataContract schema render
- 807b0df feat(designer): add Completeness layer, Info severity, NavigatesTo/ParticipatesIn relations
- 99730eb feat(designer): add scraper dep + ui_refs HTML data-* extractor
- 3ceb8f0 WIP: snapshot pre-artifact-layer designer/shell work
- 017645d Add designer artifact layer implementation plan
- e0d4ab4 Add designer artifact layer design spec
- 3364602 Fix business designer completion controls
- d020e9b Implement business designer gap completion
- abe75a2 Configure engineering agent skills
- 682dab9 Improve git diff freshness and graph UX
- 76ba95f Cover parent-scoped discard of untracked files
- 8510960 Sync git UI repository scope handling
- 2dc20f2 Strengthen multi-repository git discovery
- 812dfc2 Harden designer v1 spec against native-feel-cross-platform-desktop tenets
- 96c447b Iterate business designer module design to v1 graph paradigm
- d6c4fa3 Add business designer module with full-stack command surface
- d72c6f9 Cut left pane route enter motion
- 4684447 Stabilize terminal idle action presses
- 9c611f9 Stabilize session history action presses
- 87f2c2c Stabilize station toolbar press states
- 60476ae Stabilize station command sheet press states
- ac1bb43 Stabilize station action rail press state
- c5a5cdf Stabilize terminal pane button press states
- 11b2420 Avoid persistent terminal host promotion
- df27aa8 Expose session history as selectable list
- 7515ec5 Keep main surface stable during workspace switch
- f3dd0a6 Cut main pane route fade
- 9992f62 Suppress station chrome touch callouts
- c21f4b6 Let station action rail use native scrolling
- 88fa5bc Cut station slot fade transitions
- 6ecab05 Delay session history loading chrome
- 56deb66 Polish terminal station chrome responsiveness
- a440061 Normalize terminal restore revisions
- dd35745 Normalize terminal output revision hydration
- cf955d9 Normalize terminal session sequence hydration
- d858ae3 Normalize cached terminal output sequences
- 4269207 Normalize terminal output sequences
- d2bc78b Normalize terminal meta unread counts
- 3152c0d Flush merged terminal input fragments
- 3f650b7 Normalize terminal restore viewports
- 33cf5b9 Normalize controller terminal unread deltas
- 93938a8 Normalize terminal submit sequences
- 5571a70 Normalize cached terminal unread deltas
- 05edfcb Normalize terminal output unread deltas
- c20f952 Normalize terminal input flush delays
- 17851ec Harden terminal debug reduced motion
- 2899433 Skip stale terminal replay frame waits
- dd48829 Coalesce terminal pending replay chunks
- 8ecff6d Chunk terminal pending replay writes
- 6ab4d33 Bound terminal input buffer limits
- 332ee8c Harden top control reduced motion
- 1107e43 Harden station overview reduced motion
- 82bdd50 Harden Apple-grade terminal console
- 13e328c Optimize terminal streaming performance
- 5c05a20 Harden terminal performance contracts
- 42106df Fix shell controller type regressions
- 1c113bd Refactor shell root controllers

## v0.7.2 (2026-06-06)

- 616eddf Release v0.7.1
- 988203b Remove terminal interrupt guard
- cbee5e1 Unify station card motion transitions
- b0ddd24 Add station minimize/restore taskbar ghost animation
- b7392a4 Add input defaults initialization for shell integration
- 2c74b09 Improve terminal viewport wake with staged delays and visibility observers
- 6172990 Fix detached station CLI launch bridge
- a6558e7 Update agent session runtime plumbing
- 28aa6db Revert v0.7.1 release metadata
- e9f58f7 Fix terminal prompt cursor alignment
- f856adf Release v0.7.1
- 18981f2 Fix production editor and terminal colors
- 28e2a12 debug(terminal): write spawned command and parent process env to workspace file
- 9be1493 fix(terminal): add FORCE_COLOR=3 and CLICOLOR_FORCE=1 for defense-in-depth color support
- 48717a5 fix(terminal): unconditionally set TERM/COLORTERM to prevent login shell reset

## v0.7.1 (2026-06-06)

- 988203b Remove terminal interrupt guard
- cbee5e1 Unify station card motion transitions
- b0ddd24 Add station minimize/restore taskbar ghost animation
- b7392a4 Add input defaults initialization for shell integration
- 2c74b09 Improve terminal viewport wake with staged delays and visibility observers
- 6172990 Fix detached station CLI launch bridge
- a6558e7 Update agent session runtime plumbing
- 28aa6db Revert v0.7.1 release metadata
- e9f58f7 Fix terminal prompt cursor alignment
- f856adf Release v0.7.1
- 18981f2 Fix production editor and terminal colors
- 28e2a12 debug(terminal): write spawned command and parent process env to workspace file
- 9be1493 fix(terminal): add FORCE_COLOR=3 and CLICOLOR_FORCE=1 for defense-in-depth color support
- 48717a5 fix(terminal): unconditionally set TERM/COLORTERM to prevent login shell reset

## v0.7.0 (2026-06-01)

- 48abe00 fix(terminal): restore terminal background CSS rule and sync theme fallback values
- 44dadbe Unify station launch controls in header.
- 58eab62 Add agent session history, CLI relaunch, and faster station terminal launch.
- 479e156 Remove Gemini CLI support across backend, frontend, and docs.
- 578408d Fix unit tests after Gemini deprecation and restore interrupt guard helpers.
- 9980fc3 Deprecate Gemini CLI across install, launch, and settings UI.
- 3831135 Release v0.6.3

## v0.6.3 (2026-05-24)

### Startup and production fixes

- Fix production white screen (relative Vite base + CSP for Monaco workers).
- Instant HTML startup skeleton; defer heavy bundles and channel services until UI ready.
- Lazy shell chunks; startup measurement script.

- a6be855 fix(startup): production white screen and faster first paint

## v0.6.2 (2026-05-23)

- 6a735b7 fix(shell): show workspace tab on startup for single workspace
- fe1f94d fix(file-tree): align expand state, row toggle, and overflow clipping
- ae7f417 refactor(channels): simplify connector wizards and remove channel overview
- 517f5e2 fix(channels): multi-bot Feishu routing, safe resolution, and route delete UX
- 93b75e1 fix(terminal): intercept Ctrl+C from frontend before async agent check
- 78f5f6a Fix stale terminal session restore after relaunch
- 053f951 fix(ci): unblock rust clippy and surface test
- 8a9c38c chore(release): sync Cargo.lock for v0.6.1

## v0.6.1 (2026-05-18)

- bb0861e fix(workbench): sync detached container view state
- 882d407 Harden station terminal lifecycle and settings

## v0.6.0 (2026-05-17)

- 3f329b2 Align agent workdir and prompt flows
- bf2b308 fix(git): show persistent banner instead of error loop on non-git directory
- ab4cba5 fix(terminal): reset stale sessionId on hydration to prevent idle screen skip
- 69bc74d fix(shell): add double-click on title bar to toggle maximize/restore
- e00ca5b fix(channel): restore menu title search to skip blank lines instead of breaking
- 3d3b367 refactor: remove activity comet effect and logic from StationCard header
- 8521c6b refactor(git): move test-only helpers out of mod.rs into test file
- 3079cbc refactor: extract inline tests into separate test files
- 30b4594 style: cargo fmt after ChannelError migration
- 1df5a5d test: add channel integration tests
- 3279589 fix: resolve ChannelError migration compile and test errors
- ef1c414 refactor(telegram): migrate API from curl to reqwest HttpClient
- 54bda88 refactor(feishu): migrate API from curl to reqwest HttpClient
- fb78e1a feat(channel): add exponential backoff with jitter to all channel workers
- fbfdb19 feat(channel): add HttpClient wrapping reqwest with retry logic
- c380a7e refactor(channel): split shared connectors.json into per-connector files
- 5dc91f0 feat(channel): add CancellationToken to AppState and wire into all channel workers
- 16390b7 feat(channel): add BackoffPolicy with exponential backoff and jitter
- 3d534dc feat(channel): add ChannelError enum with structured error types
- b81cbcd docs: add Channel reliability Phase 1 implementation plan
- c75f24c docs: add Channel reliability refactoring design spec
- e19b8dd Improve git merge conflict handling
- 1c5236c Update git operations and controller flows
- 290ab04 Refine git changes list and directory headers
- 53dcce8 feat: redesign git operations workspace
- 2da73cc fix: remove accidentally committed js artifacts and update gitignore
- 66e3377 Update AI config and terminal test changes
- e231f46 Add multi-repository git workspace support
- d9cdcd8 chore: update external channel refresh and planning docs
- fe33e3f Fix slow git action refreshes
- 165000e perf: reduce git CLI invocations in backend operations
- cfc99ae perf: eliminate git operation latency with immediate refresh, optimistic UI, and scoped refreshes
- 49a5246 fix: skip ignored paths during git stage
- 6768cff chore: update gto agent sidecar bundle

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
- Kept Codex/Claude-oriented CLI flows workspace-bound, with improved rendered-screen parsing and cleaner human-facing terminal content.
- Refreshed repository release docs, including the root README and release guidance.
