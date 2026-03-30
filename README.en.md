# GT Office

[中文版 README](README.md)

GT Office is a cross-platform AI Agent desktop workspace for macOS and Windows, with Linux development support in the codebase. It combines workspace-aware files, real PTY terminals, Git tooling, multi-agent collaboration, tool adapters, and external channel routing into one desktop shell.

Current release target: `v0.1.3`

## What It Includes

- Workspace-bound file explorer, search, preview, and editor flows
- Real terminal sessions with workspace ownership, session restore, and CLI agent launch
- Git status, diff, history, branch, stash, and refresh coordination
- Multi-station workbench for manager / product / build / quality-release collaboration
- Tool adapter and external connector foundation for Telegram, WeChat, and related workflows
- MCP bridge support for dispatch, handoff, and status reporting across agents
- Production desktop bundles ship the GT Office MCP bridge as local resources for one-click local installation

## Monorepo Layout

- `apps/desktop-web`: React + Vite desktop UI
- `apps/desktop-tauri`: Tauri shell, native bridge, and packaging entry
- `crates/`: Rust domain modules such as terminal, git, workspace, task, storage, and settings
- `packages/shared-types`: shared contracts between frontend and backend
- `tools/`: CLI and MCP sidecar utilities
- `docs/`: product, architecture, workflow, contract, dependency, and handoff docs

## Requirements

- `Node.js 20+`
- `npm 10+`
- `Rust stable`
- Platform-specific Tauri prerequisites
  - macOS: `Xcode Command Line Tools`
  - Windows: `Visual Studio Build Tools` + `WebView2 Runtime`

## Development

Install dependencies from the repo root:

```bash
npm install
```

Run the web UI:

```bash
npm run dev:web
```

Run the desktop shell:

```bash
npm run dev:tauri
```

## Verification

Frontend typecheck / build:

```bash
npm run typecheck
```

Rust workspace check:

```bash
cargo check --workspace
```

Desktop production build:

```bash
npm run build:tauri
```

## Release

Root package version: `0.1.3`

Recommended release sequence:

```bash
npm run typecheck
cargo check --workspace
npm run build:tauri
git tag -a v0.1.3 -m "GT Office v0.1.3"
git push origin main --follow-tags
```

Public macOS distribution still requires `Developer ID` signing and notarization for `.app` / `.dmg`. Without signing configured, the default build avoids accidentally producing a DMG intended for public distribution.

If you intentionally want an unsigned macOS package for manual local testing, build with:

```bash
GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1 npm run build:tauri
```

Manual installation steps:

1. Open the DMG and drag `GT Office.app` into `/Applications`
2. Try launching the app once
3. If macOS blocks it, open `System Settings > Privacy & Security` and choose `Open Anyway`
4. If needed, remove quarantine manually:

```bash
xattr -dr com.apple.quarantine /Applications/GT\ Office.app
```

## MCP Packaging

- Production desktop bundles embed the MCP bridge resources and sidecar binary directly in the app
- Desktop-triggered MCP installation prefers bundled local resources and uses a Rust fallback to write client config directly
- `Claude Code` can install the MCP bridge without Node as long as the desktop bundle is present
- `Codex CLI` and `Gemini CLI` still rely on their official Node/npm distribution for the CLI itself; only MCP bridge installation is localized

## Documentation Map

- Requirements: [docs/01_需求与产品设计.md](docs/01_需求与产品设计.md)
- Architecture: [docs/02_系统架构与模块目录设计.md](docs/02_系统架构与模块目录设计.md)
- Progress: [docs/03_项目开发进度跟踪.md](docs/03_项目开发进度跟踪.md)
- Handover: [docs/04_上下文交接文档.md](docs/04_上下文交接文档.md)
- Core workflows: [docs/05_高质量功能设计_核心工作流.md](docs/05_高质量功能设计_核心工作流.md)
- API and event contracts: [docs/06_API与事件契约草案.md](docs/06_API与事件契约草案.md)
- Dependency policy: [docs/07_依赖选型与精简清单.md](docs/07_依赖选型与精简清单.md)
