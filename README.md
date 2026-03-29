# GT Office

GT Office is a cross-platform AI Agent desktop workspace for macOS and Windows, with Linux development support in the codebase. It combines workspace-aware files, real PTY terminals, Git tooling, multi-agent collaboration, tool adapters, and external channel routing into one desktop shell.

Current release tag target: `v0.1.1`.

## What It Includes

- Workspace-bound file explorer, search, preview, and editor flows
- Real terminal sessions with workspace ownership, session restore, and CLI agent launch
- Git status, diff, history, branch, stash, and refresh coordination
- Multi-station workbench for manager / product / build / quality-release style agent collaboration
- Tool adapter and external connector foundation for Telegram, WeChat, and related routing workflows
- MCP bridge support for dispatch, handoff, and status reporting across agents

## Monorepo Layout

- `apps/desktop-web`: React + Vite desktop UI
- `apps/desktop-tauri`: Tauri shell, native bridge, packaging entry
- `crates/`: Rust domain modules such as terminal, git, workspace, task, storage, settings
- `packages/shared-types`: shared contracts between frontend and backend
- `tools/`: CLI and MCP sidecar utilities
- `docs/`: product, architecture, workflow, contract, dependency, and handoff docs

## Requirements

- Node.js 20+
- npm 10+
- Rust stable toolchain
- Platform build prerequisites for Tauri
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools + WebView2 runtime

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

Frontend typecheck/build:

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

Root package version: `0.1.1`

Recommended release sequence:

```bash
npm run typecheck
cargo check --workspace
npm run build:tauri
git tag -a v0.1.1 -m "GT Office v0.1.1"
git push origin main --follow-tags
```

For public macOS releases, the generated `.app` and `.dmg` must pass Developer ID signing and notarization. When signing is not configured, the build keeps the local `.app` bundle but skips DMG creation so unsigned artifacts are not accidentally published. For local unsigned DMG smoke builds only, use `GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1`.

## Documentation Map

- Requirements: [docs/01_需求与产品设计.md](docs/01_需求与产品设计.md)
- Architecture: [docs/02_系统架构与模块目录设计.md](docs/02_系统架构与模块目录设计.md)
- Progress: [docs/03_项目开发进度跟踪.md](docs/03_项目开发进度跟踪.md)
- Handover: [docs/04_上下文交接文档.md](docs/04_上下文交接文档.md)
- Core workflows: [docs/05_高质量功能设计_核心工作流.md](docs/05_高质量功能设计_核心工作流.md)
- API and event contracts: [docs/06_API与事件契约草案.md](docs/06_API与事件契约草案.md)
- Dependency policy: [docs/07_依赖选型与精简清单.md](docs/07_依赖选型与精简清单.md)
