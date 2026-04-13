# GT Office

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.6-blue.svg)](CHANGELOG.md)

## 截图

| Agent 工位 | 通道 |
|:---:|:---:|
| ![Agents View](docs/assets/agents-view.png) | ![Channel View](docs/assets/channel-view.png) |

| 任务 | 文件浏览 | Git |
|:---:|:---:|:---:|
| ![Task View](docs/assets/task-view.png) | ![Explorer View](docs/assets/explorer-view.png) | ![Git View](docs/assets/git-view.png) |

**GT-Office: 面向开发者的原生多智能体协同工作台**

一个专为管理和编排本地原生 Agent 而设计的跨平台桌面环境。有别于零散的终端工具，GT-Office 将 Claude Code、Codex CLI 等原生命令行工具整合进了统一的图形化工作区，实现了多并发运行、状态持久化以及深度的“机机对话”协同工作流。

**[English](README.md)**

## 目录

- [核心设计与能力](#核心设计与能力)
- [仓库结构](#仓库结构)
- [环境要求](#环境要求)
- [开发启动](#开发启动)
- [验证命令](#验证命令)
- [发布说明](#发布说明)
- [文档导航](#文档导航)
- [参与贡献](#参与贡献)
- [路线图](#路线图)
- [许可证](#许可证)

## 核心设计与能力

- **工作区维度的状态持久化与多并发**：告别每次繁琐的终端环境配置。只需一键即可并发启动工作区内的多个目标 Agent，所有进程在统一的窗口内集中管理，过程所见即所得。
- **原生能力，零妥协**：无缝接入原生 Claude Code、Codex CLI 与 Gemini CLI 工具，100% 保留官方工具的最核心系统级能力，不做限制性封装。
- **Agent 间通信总线**：内置独创的 `gto` CLI 桥接技术。Agent 之间可以通过该总线自动交接任务、共享上下文与审查代码，从“人机协作”迈向真正的“多智能体协作”。
- **快捷指令与自定义工作流**：通过直观的 UI 管理高频或复杂的命令行参数，让复杂的 AI 操作变得极为简单。
- **外部通道反向代理**：打破命令行工具仅限本地的网络局限。支持将终端执行流双向映射至微信、飞书、Telegram 等应用，实现跨设备的远程监控与指令下发。
- **对抗生成架构**：预设了生成器 (Generator) 与评估器 (Evaluator) 的对抗角色流，通过内部自我审查显著提升终端产出质量与逻辑完备性。
- **可视化模型调度**：提供可视化的 API 外部模型配置能力，可随时为每个 Agent 动态映射和切换底层大模型。

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