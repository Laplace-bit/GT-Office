# GT Office

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.6-blue.svg)](CHANGELOG.md)

<!-- ![GT Office 截图](docs/assets/screenshot.png) -->

面向 macOS 和 Windows 的跨平台 AI Agent 桌面工作台，代码库同时支持 Linux 开发调试。GT Office 把 workspace 感知的文件操作、真实 PTY 终端、Git 工作流、多 Agent 协作、tool adapters 和外部通道路由整合到同一个桌面壳层中。

**[English](README.md)**

## 目录

- [功能概览](#功能概览)
- [仓库结构](#仓库结构)
- [环境要求](#环境要求)
- [开发启动](#开发启动)
- [验证命令](#验证命令)
- [发布说明](#发布说明)
- [文档导航](#文档导航)
- [参与贡献](#参与贡献)
- [路线图](#路线图)
- [许可证](#许可证)

## 功能概览

- 工作区绑定的文件树、搜索、预览与编辑流程
- 真实终端会话，支持 workspace 归属、会话恢复与 CLI Agent 启动
- Git 状态、diff、历史、分支、stash 与刷新协调
- 面向 manager / product / build / quality-release 的多工位协作工作台
- Telegram、WeChat 等外部通道与 tool adapter 基础能力
- `gto` 本机 CLI 支持 agent 目录查询、任务派发、等待答复、状态回报与交接
- 桌面端内置本机 bridge，供 `gto` 连接当前运行中的 GT Office 实例

## 仓库结构

| 目录 | 用途 |
|------|------|
| `apps/desktop-web` | React + Vite 桌面前端 |
| `apps/desktop-tauri` | Tauri 壳层、原生桥接与打包入口 |
| `crates/` | terminal、git、workspace、task、storage、settings 等 Rust 领域模块 |
| `packages/shared-types` | 前后端共享契约 |
| `tools/` | CLI 与本地 bridge 相关工具 (`gto`) |
| `docs/` | 技术文档 |

## 环境要求

- **Node.js** 20+
- **npm** 10+
- **Rust** stable
- **Tauri 平台构建依赖**
  - macOS：Xcode Command Line Tools
  - Windows：Visual Studio Build Tools + WebView2 Runtime
  - Linux：`libwebkit2gtk-4.1-dev`、`build-essential`、`libssl-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`patchelf`

## 开发启动

在仓库根目录安装依赖：

```bash
npm install
```

启动 Web 前端：

```bash
npm run dev:web
```

启动桌面壳层：

```bash
npm run dev:tauri
```

## 验证命令

前端 typecheck / build：

```bash
npm run typecheck
```

Rust workspace 检查：

```bash
cargo check --workspace
```

桌面生产构建：

```bash
npm run build:tauri
```

## 发布说明

推荐发布流程：

1. 更新版本号和 `CHANGELOG.md`
2. 将发布变更提交到 `main`
3. 给提交打 tag（如 `v0.1.7`）
4. 推送 tag，由 GitHub Actions 自动构建并发布 macOS、Windows、Linux 产物

更详细的发布操作、secrets 与失败重试说明见 [docs/release-process.md](docs/release-process.md)

发布工作流会上传 macOS `.dmg` 和 `.app` 压缩包。若未在 CI 中配置 Developer ID 签名与 notarization，这个 DMG 只适合手动测试或内部分发，可能会被 Gatekeeper 拦截。

如果你要发布一个仅供手动本地测试的 unsigned macOS 安装包：

```bash
GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1 npm run build:tauri
```

手动安装步骤：

1. 打开 DMG，并把 `GT Office.app` 拖到 `/Applications`
2. 先尝试打开一次应用
3. 如果被 macOS 拦截，到 `System Settings > Privacy & Security` 点击 `Open Anyway`
4. 如有需要：`xattr -dr com.apple.quarantine /Applications/GT\ Office.app`

## 文档导航

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — 系统架构、仓库布局与数据流
- [WORKFLOWS.md](docs/WORKFLOWS.md) — 核心用户工作流与多工位协作
- [API_CONTRACTS.md](docs/API_CONTRACTS.md) — Tauri 命令、事件与共享类型
- [DEPENDENCIES.md](docs/DEPENDENCIES.md) — 依赖策略与白名单
- [release-process.md](docs/release-process.md) — 发布流程、tag 与产物

## 参与贡献

开发环境搭建、代码风格、PR 流程等见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路线图

- **代码签名与公证** — 签名的 macOS DMG 与 Windows 安装包，用于正式分发
- **插件系统** — 可扩展的 tool adapter 与通道集成框架
- **远程工作区** — 通过 SSH 连接远程工作区
- ~~**Crate 重命名** — 将 `vb-*` crate 重命名为 `gt-*`，统一品牌~~ (done)

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 许可。