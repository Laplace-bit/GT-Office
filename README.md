# GT Office

GT Office is a cross-platform AI coding desktop application focused on high-performance workspace workflows:

- Multi-workspace file management
- Real PTY terminal sessions bound to workspace context
- Git integrations with hybrid provider strategy
- Tool adapters for AI CLI workflows

## Monorepo Structure

- `apps/desktop-web`: Web UI (React + Vite)
- `apps/desktop-tauri`: Tauri shell and command bridge
- `crates/*`: Rust domain modules and abstractions
- `packages/shared-types`: Shared frontend/backend contracts
- `docs`: Product, architecture, progress, and handover docs

## Quick Start (Scaffold Stage)

1. Install Node.js 20+ and Rust stable.
2. Install dependencies from workspace root.
3. Start web and tauri apps in development mode.

Detailed implementation plan and workflows are documented in `docs/`.
