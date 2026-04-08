# GT Office — Core Workflows

This document describes the primary user workflows supported by GT Office.

## Workspace Lifecycle

A workspace is the fundamental scope boundary in GT Office. All file, terminal, and git operations are bound to the active workspace.

1. **Open** — Select a directory to open as a workspace. The backend creates a workspace context with the root path, permission set, and default terminal cwd.
2. **Active** — The workspace is the parent scope for all subsequent operations. Multiple workspaces can be open simultaneously; one is active at a time.
3. **Close** — Closing a workspace tears down its terminals and releases resources.
4. **Restore** — On relaunch, GT Office restores the previous session: open workspaces, terminal sessions, and UI layout.

Key constraint: all path operations are validated against the workspace root. No file access outside the workspace boundary is permitted.

## File Operations

1. **Browse** — The file tree in the sidebar shows the workspace directory structure with configurable depth.
2. **Open** — Double-click or use quick open to view a file. Text files open in the CodeMirror editor; images, PDFs, and media open in the unified preview tab.
3. **Search** — Full-text search across the workspace with result navigation.
4. **Edit** — CodeMirror-powered editor with language extensions (JavaScript, Python, Rust, JSON, Markdown, CSS, HTML). Edits are saved explicitly.
5. **Preview** — Images, PDFs, audio, and video render inline. Preview tabs share the same tab bar as editor tabs.

## Terminal Sessions

1. **Create** — Open a terminal card bound to the workspace root (or a custom cwd within the workspace). Each terminal runs a real PTY session.
2. **CLI Agent Launch** — Station cards provide one-click launch for Claude Code, Codex CLI, and Gemini CLI. The terminal inherits the workspace context and environment variables (`GTO_WORKSPACE_ID`, `GTO_AGENT_ID`).
3. **Output Parsing** — The VT100 parser filters bootstrap metadata from agent output, keeping the visible terminal clean.
4. **Session Restore** — Terminal sessions persist across workspace reopen. The PTY reconnects to the shell process.
5. **Quick Commands** — Each CLI provider has a set of quick commands accessible from the station card (e.g., `/mcp`, `/status`, `/agents` for Claude Code).

## Git Integration

1. **Status** — View modified, staged, and untracked files in the workspace.
2. **Diff** — Side-by-side diff view for staged and unstaged changes.
3. **Log** — Browse commit history with branch visualization.
4. **Branch** — Create, switch, and manage branches.
5. **Stash** — Create and apply stashes.
6. **Refresh** — File changes trigger automatic git status refresh.

All git operations are scoped to the active workspace.

## Multi-Station Collaboration

The workbench supports multiple station cards, each representing a different role or context:

- **Manager** — Orchestrates tasks across agents
- **Product** — Tracks requirements and acceptance criteria
- **Build** — Runs build and test commands
- **Quality Release** — Performs verification and approval

Each station gets its own terminal and can launch a different CLI agent. Stations share the same workspace context.

## Agent Collaboration via gto

The `gto` CLI is the primary interface for agent-to-agent communication:

1. **Install** — Install CLI agents (Claude, Codex, Gemini) through the provider UI. The installer handles platform-specific setup.
2. **Directory Snapshot** — `gto directory snapshot` discovers available agents in the current workspace and returns their IDs and roles.
3. **Task Dispatch** — `gto send` writes a task to the target agent's terminal and submits it.
4. **Reply** — Agents respond via `gto reply-status` (short progress updates) or `gto handover` (completion summaries with next steps).
5. **Inbox** — `gto inbox` lists pending tasks; `gto thread` shows the full message history for a task.

All communication flows through the local bridge runtime on `127.0.0.1` with token authentication.

## Tool Adapters and Channels

External channels route messages through a relay architecture:

1. **Display Channel** — Agent PTY output → VT100 parsing → xterm.js rendering. This is the human-readable view.
2. **Data Channel** — Structured JSON output → external service adapters. This is the machine-readable view.
3. **Channel Binding** — Bind an agent to an external channel (Telegram, WeChat) with health monitoring and graceful teardown.
4. **Environment Variables** — For channels that need plain-text agent output, environment variables like `NO_COLOR=1` and `TERM=dumb` suppress TUI formatting.
5. **Long-term** — MCP protocol integration provides structured, reliable agent communication for future channel types.