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
