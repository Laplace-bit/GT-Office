# GT Office Architecture

## 1. Overview

GT Office is a cross-platform AI Agent desktop workspace for macOS and Windows, with Linux available during development. It brings together workspace-aware file operations, real PTY terminals, Git tooling, multi-agent collaboration, tool adapters, and external channel routing into a single desktop shell.

The application is built on **Tauri v2**: a Rust backend handles all system-level capabilities, while a React + TypeScript frontend provides the UI. The two layers communicate through Tauri invoke commands (request-response) and Tauri events (streaming state updates).

### Design principles

- **Workspace-scoped by default.** Every file, terminal, and Git operation is bound to an active workspace. Commands that operate within a workspace must carry a `workspace_id`.
- **Layered separation.** The Rust backend is organized into domain crates with explicit dependency direction. The frontend is organized into feature modules under `features/`. Cross-boundary access is mediated through abstractions, not direct imports.
- **Mock-first providers.** System capabilities (terminal, Git, settings) are defined as traits in `gt-abstractions` with both real and mock implementations, enabling testability without system dependencies.
- **Sidecar for heavy operations.** Search, file indexing, and similar CPU-intensive work is offloaded to a daemon process (`gt-daemon`) that communicates over a length-delimited TCP protocol.

---

## 2. Monorepo layout

```
GT-Office/
├── apps/
│   ├── desktop-web/          # React + TypeScript UI
│   └── desktop-tauri/        # Tauri shell (Rust + native window)
├── crates/                   # Rust domain modules (see Section 4)
├── packages/
│   └── shared-types/         # TypeScript types shared between frontend code
├── tools/
│   ├── gto/                  # Local CLI for agent communication
│   ├── gto-agent-mcp/        # MCP protocol definitions
│   └── gto-agent-mcp-sidecar/ # Sidecar process for MCP bridge
├── docs/                     # Documentation
├── scripts/                  # Build and release scripts
└── tests/                    # Integration and E2E tests
```

### apps/desktop-web

The React frontend. Key directories:

| Path | Responsibility |
|---|---|
| `src/features/` | Business UI, hooks, and models per feature |
| `src/shell/` | Application shell, window frame, navigation, platform integration |
| `src/components/` | Cross-feature reusable components |
| `src/stores/` | Global shared state (cross-feature only) |
| `src/styles/` | Design tokens, base layers, utility classes |
| `src/hooks/` | Shared React hooks |

Feature modules under `src/features/`:

- `change-feed` -- real-time change notification UI
- `file-explorer` -- workspace file tree browsing
- `file-preview` -- inline file preview (code, PDF, images)
- `git` -- Git status, diff, history views
- `keybindings` -- keyboard shortcut configuration
- `settings` -- user preferences and AI provider config
- `task-center` -- task tracking and agent dispatch
- `terminal` -- PTY terminal sessions via xterm.js
- `tool-adapter` -- channel connectors, bot bindings, message routing
- `workspace` -- workspace lifecycle management
- `workspace-hub` -- multi-station workbench, agent cards, detached windows

### apps/desktop-tauri

The Tauri shell that packages the web UI into a native desktop application. The Rust layer under `src-tauri/src/` contains:

| Path | Responsibility |
|---|---|
| `commands/` | Tauri command handlers, one directory per feature |
| `app_state.rs` | Global state assembly (no business logic) |
| `local_bridge.rs` | Local bridge TCP server for agent and CLI communication |
| `channel_adapter_runtime.rs` | External channel inbound webhook listener |
| `channel_sinks.rs` | Outbound delivery to Telegram, Feishu, WeChat |
| `connectors/` | Per-service connector implementations |
| `daemon_bridge.rs` | Client connection to the gt-daemon sidecar |
| `filesystem_watcher.rs` | Workspace filesystem change notifications |
| `terminal_debug/` | Terminal debug logging and diagnostics |

### packages/shared-types

TypeScript type definitions shared across the frontend. The central type is `ResultEnvelope<T>`:

```typescript
interface ResultEnvelope<T = unknown> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  traceId: string;
}
```

---

## 3. Layered architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   Presentation Layer                          │
│        React WebUI (apps/desktop-web)                         │
│   features/ · shell/ · components/ · stores/                 │
└──────────────────────┬───────────────────────────────────────┘
                       │  Tauri invoke + events
┌──────────────────────▼───────────────────────────────────────┐
│                  Application Layer                            │
│        Tauri Commands (apps/desktop-tauri/commands/)          │
│   Request validation · use-case orchestration · event emit    │
└──────────────────────┬───────────────────────────────────────┘
                       │  crate APIs
┌──────────────────────▼───────────────────────────────────────┐
│                    Domain Layer                               │
│        Core service crates (crates/gt-*)                       │
│   Business logic · domain models · trait abstractions         │
└──────────────────────┬───────────────────────────────────────┘
                       │  OS / external APIs
┌──────────────────────▼───────────────────────────────────────┐
│                Infrastructure Layer                            │
│   PTY · filesystem · SQLite · Git CLI · system credentials    │
│   gt-daemon sidecar (search, indexing)                        │
└──────────────────────────────────────────────────────────────┘
```

### Presentation Layer

React components organized by feature. Each feature module owns its UI, hooks, models, and styles. The shell layer handles window framing, navigation, and platform integration. State is managed locally within features; global stores are reserved for truly cross-feature data (e.g., notifications).

### Application Layer

Tauri command handlers in `commands/` are the thin orchestration layer. Each feature has its own command directory. Commands validate inputs, call domain crate APIs, and emit events back to the frontend. They do not contain business logic themselves.

### Domain Layer

Rust crates under `crates/gt-*` encapsulate business logic and domain models. Each crate exposes a focused API consumed by the application layer. Cross-crate dependencies flow downward through the layer stack.

### Infrastructure Layer

System-level capabilities: PTY sessions, filesystem access, SQLite storage, Git CLI invocation, and OS credential storage. The `gt-daemon` sidecar handles CPU-intensive operations like file search and indexing over a TCP protocol, keeping the main process responsive.

---

## 4. Crate dependency graph

```
                    gt-abstractions
                   ╱     │      ╲
                  ╱      │       ╲
           gt-core   gt-workspace  gt-security
              │          │              │
     ┌────────┼──────────┼──────────────┤
     │        │          │              │
  gt-ai-config  gt-filesystem    gt-terminal-core
     │                         ╱           ╲
  gt-settings          gt-terminal      gt-session-log
     │
  gt-storage
     │
  gt-agent
     │
  gt-task
     │
  gt-git
     │
  gt-changefeed
     │
  gt-tools
     │
  gt-telemetry  gt-keymap

         gt-daemon (standalone sidecar process)
```

### Crate descriptions

| Crate | Role |
|---|---|
| `gt-abstractions` | Shared traits (`WorkspaceService`, `TerminalProvider`, `GitProvider`, `SettingsStore`, `CommandPolicyEvaluator`) and utility types (`WorkspaceId`, `WorkspaceContext`, error types). All domain crates depend on these trait definitions rather than concrete implementations. |
| `gt-core` | Shared domain types and fundamental data structures used across multiple crates. |
| `gt-workspace` | Workspace lifecycle management: open, close, switch active workspace, and resolve workspace context (root path, permissions, default terminal cwd). |
| `gt-filesystem` | File and directory operations within workspace boundaries. Enforces that all paths remain inside the workspace root. |
| `gt-terminal` / `gt-terminal-core` | PTY session creation and management. `gt-terminal-core` provides the terminal emulation engine (VT parsing, output routing, scrollback, snapshots); `gt-terminal` adds the PTY provider implementation that integrates with the OS. |
| `gt-git` | Git operations: status, diff, history, branch listing. Invokes the `git` CLI and parses its output. |
| `gt-task` | Task tracking and lifecycle. Defines task dispatch, batch dispatch, channel messaging, agent runtime registration, and progress events. The central model for multi-agent collaboration workflows. |
| `gt-agent` | Agent roles, status, and installation. Defines the `AgentRepository` trait and its SQLite-backed implementation. Manages agent identity, roles, and role-scoped prompts. |
| `gt-ai-config` | AI provider configuration and credential management. Stores provider settings (API keys, model selections) with a preview-validate-confirm-apply-audit lifecycle. Credentials use system keychain storage. |
| `gt-settings` | User preferences and application settings. Layered resolution: user-level, workspace-level, and session-level scopes. |
| `gt-storage` | SQLite persistence layer. Provides repository implementations for agents and AI config. Manages schema migration and connection pooling. |
| `gt-security` | Path validation and workspace-bound access control. Ensures file and terminal operations cannot escape workspace boundaries. |
| `gt-changefeed` | Real-time change notification system. Emits events when files, Git state, or workspace configuration changes, allowing the UI to stay in sync without polling. |
| `gt-session-log` | Terminal session logging. Records PTY output for replay and debugging. Supports structured output parsing (e.g., Codex output format). |
| `gt-telemetry` | Usage metrics and diagnostics. Collects anonymized operational data for debugging and performance monitoring. |
| `gt-keymap` | Keyboard shortcut configuration. Maps key combinations to application actions. |
| `gt-tools` | Tool adapter and external connector infrastructure. Defines agent tool kinds and the agent installer that bootstraps tool environments. |
| `gt-daemon` | Standalone sidecar process for heavy operations. Runs as a separate binary communicating over TCP with length-delimited framing. Provides file search, file I/O proxying, and terminal services. |

---

## 5. Frontend-backend communication

### Request-response: Tauri invoke

The frontend calls backend functions through `tauri.invoke()`. Each command is a Rust function annotated with `#[tauri::command]` in the appropriate feature directory under `commands/`.

All commands return a unified `ResultEnvelope`:

```typescript
interface ResultEnvelope<T = unknown> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  traceId: string;
}
```

The `traceId` field enables end-to-end tracing across frontend and backend logs. The `ok` field allows the frontend to branch without throwing, while the `error` object provides structured error details.

### Streaming: Tauri events

The backend pushes real-time updates to the frontend through `app_handle.emit(event_name, payload)`. This is used for:

- Terminal output streaming (PTY bytes to xterm.js)
- Change feed notifications (file changes, Git status updates)
- Task dispatch progress events
- Channel message events (inbound from external services)

### Workspace scoping

All workspace-scoped commands must carry a `workspace_id` parameter. This is enforced at the application layer: commands resolve the workspace context (root path, permissions, terminal cwd mode) before delegating to domain crates. Terminal commands additionally accept a `cwd_mode` that defaults to `workspace_root`, with custom cwd values validated to remain inside the workspace.

---

## 6. External channel relay

Agent processes produce output through two distinct channels:

### Display Channel

PTY output flows through VT100/VT200 parsing into xterm.js for human consumption. This is the primary interaction surface: the user sees terminal output, types input, and observes agent behavior in real time.

### Data Channel

Structured output (JSON, key-value pairs, status updates) is routed to external services. The `channel_sinks` module dispatches outbound messages to:

- **Telegram** -- via Bot API, supports preview-edit and interaction prompts
- **Feishu** -- via webhook API
- **WeChat** -- via webhook API

Inbound messages arrive through `channel_adapter_runtime.rs`, which runs an HTTP listener on `127.0.0.1` receiving webhook callbacks from external services. Messages are authenticated, deduplicated, and dispatched to the appropriate agent terminal session.

### Three-layer approach for channel quality

| Layer | Strategy | Timeline |
|---|---|---|
| 1 | Environment variable injection to suppress TUI decorations (e.g., `NO_COLOR`, `TERM=dumb`) in agent processes | Immediate |
| 2 | Dual-channel output: raw PTY for display, structured JSON for data extraction and routing | Mid-term |
| 3 | MCP (Model Context Protocol) integration: agents speak structured protocol, eliminating VT parsing entirely | Long-term |

This graduated approach ensures backward compatibility while progressively improving the reliability of structured data extraction from agent output.

---

## 7. Local CLI and bridge

### The `gto` CLI

The `tools/gto` package provides a local command-line interface for agent communication. It discovers the local bridge runtime by reading `~/.gtoffice/mcp/runtime.json`, which contains the bridge address and authentication token.

Primary commands:

- `gto agents` -- inspect available agents in the current workspace
- `gto directory snapshot` -- full directory view of workspace agents
- `gto send <from> <to> <text>` -- dispatch a task between agents
- `gto send ... --wait` / `gto wait <taskId> --from <agent>` -- synchronous task dispatch with reply
- `gto agent reply-status` -- short replies and progress updates
- `gto agent handover` -- completion summaries with blockers and next steps
- `gto inbox <agent>` / `gto thread <taskId>` -- inspect open threads and message history

### The local bridge

The bridge server runs inside the Tauri process (`local_bridge.rs`). It listens on `127.0.0.1` with a randomly assigned port, secured with a token written to the runtime file. The bridge exposes:

- **Agent endpoints** -- CRUD for agent identities and roles
- **Task endpoints** -- dispatch, reply-status, handover, and thread inspection
- **Channel endpoints** -- send messages, list messages
- **Directory endpoints** -- workspace agent snapshots

### Agent communication model

Agent-to-agent communication defaults to the `gto` CLI, not MCP. The flow is:

1. An agent (or the human operator) invokes `gto send` targeting another agent
2. The CLI authenticates with the local bridge using the runtime token
3. The bridge creates a task record and writes a message to the target agent's inbox
4. The target agent reads the message via `gto inbox` or is notified through a Tauri event
5. The target agent replies with `gto agent reply-status` (progress) or `gto agent handover` (completion)

The `gto-agent-mcp-sidecar` provides MCP protocol support as a separate process for agents that speak MCP natively, but the primary communication path remains the `gto` CLI over the local bridge.

---

## 8. Feature-command alignment

The frontend feature modules and backend command directories maintain a strict one-to-one alignment:

| Frontend feature | Backend commands |
|---|---|
| `workspace` | `commands/workspace/` |
| `file-explorer` / `file-preview` | `commands/file_explorer/` |
| `terminal` | `commands/terminal/` |
| `git` | `commands/git/` |
| `task-center` | `commands/task_center/` |
| `tool-adapter` | `commands/tool_adapter/` |
| `workspace-hub` (agent mgmt) | `commands/agent/` |
| `settings` | `commands/settings/` |
| `keybindings` | `commands/keybindings/` |
| `change-feed` | (events only, no commands) |

New Tauri commands must be placed in the corresponding feature directory under `commands/`. The `commands/` root contains only the `mod.rs` binding file and cross-cutting handlers like `security.rs` and `system.rs`.