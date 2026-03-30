# GT Office

GT Office 是一个面向 macOS 和 Windows 的跨平台 AI Agent 桌面工作台，代码库同时支持 Linux 开发调试。它把 workspace 感知的文件操作、真实 PTY 终端、Git 工作流、多 Agent 协作、tool adapters 和外部通道路由整合到同一个桌面壳层中。  
GT Office is a cross-platform AI Agent desktop workspace for macOS and Windows, with Linux development support in the codebase. It combines workspace-aware files, real PTY terminals, Git tooling, multi-agent collaboration, tool adapters, and external channel routing into one desktop shell.

当前发布目标版本：`v0.1.3`  
Current release target: `v0.1.3`

## 功能概览 | What It Includes

- 工作区绑定的文件树、搜索、预览与编辑流程  
  Workspace-bound file explorer, search, preview, and editor flows
- 真实终端会话，支持 workspace 归属、会话恢复与 CLI Agent 启动  
  Real terminal sessions with workspace ownership, session restore, and CLI agent launch
- Git 状态、diff、历史、分支、stash 与刷新协调  
  Git status, diff, history, branch, stash, and refresh coordination
- 面向 manager / product / build / quality-release 的多工位协作工作台  
  Multi-station workbench for manager / product / build / quality-release collaboration
- Telegram、WeChat 等外部通道与 tool adapter 基础能力  
  Tool adapter and external connector foundation for Telegram, WeChat, and related workflows
- MCP bridge 支持任务派发、状态汇报与交接  
  MCP bridge support for dispatch, handoff, and status reporting across agents
- 生产桌面包内置 GT Office MCP 资源，支持本地一键安装  
  Production desktop bundles ship the GT Office MCP bridge as local resources for one-click local installation

## 仓库结构 | Monorepo Layout

- `apps/desktop-web`：React + Vite 桌面前端  
  React + Vite desktop UI
- `apps/desktop-tauri`：Tauri 壳层、原生桥接与打包入口  
  Tauri shell, native bridge, and packaging entry
- `crates/`：terminal、git、workspace、task、storage、settings 等 Rust 领域模块  
  Rust domain modules such as terminal, git, workspace, task, storage, and settings
- `packages/shared-types`：前后端共享契约  
  Shared contracts between frontend and backend
- `tools/`：CLI 与 MCP sidecar 工具  
  CLI and MCP sidecar utilities
- `docs/`：产品、架构、流程、契约、依赖与交接文档  
  Product, architecture, workflow, contract, dependency, and handoff docs

## 环境要求 | Requirements

- `Node.js 20+`
- `npm 10+`
- `Rust stable`
- Tauri 平台构建依赖 / Platform-specific Tauri prerequisites
  - macOS：`Xcode Command Line Tools`
  - Windows：`Visual Studio Build Tools` + `WebView2 Runtime`

## 开发启动 | Development

在仓库根目录安装依赖：  
Install dependencies from the repo root:

```bash
npm install
```

启动 Web 前端：  
Run the web UI:

```bash
npm run dev:web
```

启动桌面壳层：  
Run the desktop shell:

```bash
npm run dev:tauri
```

## 验证命令 | Verification

前端 typecheck / build：  
Frontend typecheck/build:

```bash
npm run typecheck
```

Rust workspace 检查：  
Rust workspace check:

```bash
cargo check --workspace
```

桌面生产构建：  
Desktop production build:

```bash
npm run build:tauri
```

## 发布说明 | Release

根 package 版本：`0.1.3`  
Root package version: `0.1.3`

推荐发布顺序：  
Recommended release sequence:

```bash
npm run typecheck
cargo check --workspace
npm run build:tauri
git tag -a v0.1.3 -m "GT Office v0.1.3"
git push origin main --follow-tags
```

面向公众正常分发的 macOS `.app` / `.dmg` 仍然需要 `Developer ID` 签名和 notarization。若未配置签名，默认构建会避免误产出可对外分发的 DMG。  
Public macOS distribution still requires `Developer ID` signing and notarization for `.app` / `.dmg`. Without signing configured, the default build avoids accidentally producing a DMG intended for public distribution.

如果你要发布一个仅供手动本地测试的 unsigned macOS 安装包，可以显式开启：  
If you intentionally want an unsigned macOS package for manual local testing, build with:

```bash
GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1 npm run build:tauri
```

手动安装步骤如下：  
Manual installation steps:

1. 打开 DMG，并把 `GT Office.app` 拖到 `/Applications`  
   Open the DMG and drag `GT Office.app` into `/Applications`
2. 先尝试打开一次应用  
   Try launching the app once
3. 如果被 macOS 拦截，到 `System Settings > Privacy & Security` 点击 `Open Anyway`  
   If macOS blocks it, open `System Settings > Privacy & Security` and choose `Open Anyway`
4. 如有需要，也可以手动移除 quarantine：  
   If needed, remove quarantine manually:

```bash
xattr -dr com.apple.quarantine /Applications/GT\ Office.app
```

## MCP 打包与安装 | MCP Packaging

- 生产桌面包会直接内置 MCP bridge 资源和 sidecar 二进制  
  Production desktop bundles embed the MCP bridge resources and sidecar binary directly in the app
- 桌面端触发 MCP 安装时，优先使用本地 bundle 资源，并由 Rust fallback 直接写入客户端配置  
  Desktop-triggered MCP installation prefers bundled local resources and uses a Rust fallback to write client config directly
- `Claude Code` 只要桌面包存在，就可以在没有 Node 的情况下安装 MCP bridge  
  `Claude Code` can install the MCP bridge without Node as long as the desktop bundle is present
- `Codex CLI` 和 `Gemini CLI` 的“CLI 本体安装”仍然依赖它们官方的 Node/npm 分发；只有 MCP bridge 安装已经本地化  
  `Codex CLI` and `Gemini CLI` still rely on their official Node/npm distribution for the CLI itself; only MCP bridge installation is localized

## 文档导航 | Documentation Map

- 需求文档 / Requirements: [docs/01_需求与产品设计.md](docs/01_需求与产品设计.md)
- 架构文档 / Architecture: [docs/02_系统架构与模块目录设计.md](docs/02_系统架构与模块目录设计.md)
- 开发进度 / Progress: [docs/03_项目开发进度跟踪.md](docs/03_项目开发进度跟踪.md)
- 上下文交接 / Handover: [docs/04_上下文交接文档.md](docs/04_上下文交接文档.md)
- 核心工作流 / Core workflows: [docs/05_高质量功能设计_核心工作流.md](docs/05_高质量功能设计_核心工作流.md)
- API 与事件契约 / API and event contracts: [docs/06_API与事件契约草案.md](docs/06_API与事件契约草案.md)
- 依赖策略 / Dependency policy: [docs/07_依赖选型与精简清单.md](docs/07_依赖选型与精简清单.md)
