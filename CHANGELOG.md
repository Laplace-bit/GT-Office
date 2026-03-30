# Changelog

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
