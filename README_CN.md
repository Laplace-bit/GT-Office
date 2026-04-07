# GT Office

[English README](README.md)

GT Office 是一个面向 macOS 和 Windows 的跨平台 AI Agent 桌面工作台，代码库同时支持 Linux 开发调试。它把 workspace 感知的文件操作、真实 PTY 终端、Git 工作流、多 Agent 协作、tool adapters 和外部通道路由整合到同一个桌面壳层中。

当前发布目标版本：`v0.1.4`

## 功能概览

- 工作区绑定的文件树、搜索、预览与编辑流程
- 真实终端会话，支持 workspace 归属、会话恢复与 CLI Agent 启动
- Git 状态、diff、历史、分支、stash 与刷新协调
- 面向 manager / product / build / quality-release 的多工位协作工作台
- Telegram、WeChat 等外部通道与 tool adapter 基础能力
- `gto` 本机 CLI 支持 agent 目录查询、任务派发、等待答复、状态回报与交接
- 桌面端内置本机 bridge，供 `gto` 连接当前运行中的 GT Office 实例

## 仓库结构

- `apps/desktop-web`：React + Vite 桌面前端
- `apps/desktop-tauri`：Tauri 壳层、原生桥接与打包入口
- `crates/`：terminal、git、workspace、task、storage、settings 等 Rust 领域模块
- `packages/shared-types`：前后端共享契约
- `tools/`：CLI 与本地 bridge 相关工具
- `docs/`：产品、架构、流程、契约、依赖与交接文档

## 环境要求

- `Node.js 20+`
- `npm 10+`
- `Rust stable`
- Tauri 平台构建依赖
  - macOS：`Xcode Command Line Tools`
  - Windows：`Visual Studio Build Tools` + `WebView2 Runtime`

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

根 package 版本：`0.1.4`

推荐发布顺序：

```bash
npm run typecheck
cargo check --workspace
npm run build:tauri
git tag -a v0.1.4 -m "GT Office v0.1.4"
git push origin main --follow-tags
```

面向公众正常分发的 macOS `.app` / `.dmg` 仍然需要 `Developer ID` 签名和 notarization。若未配置签名，默认构建会避免误产出可对外分发的 DMG。

如果你要发布一个仅供手动本地测试的 unsigned macOS 安装包，可以显式开启：

```bash
GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1 npm run build:tauri
```

手动安装步骤如下：

1. 打开 DMG，并把 `GT Office.app` 拖到 `/Applications`
2. 先尝试打开一次应用
3. 如果被 macOS 拦截，到 `System Settings > Privacy & Security` 点击 `Open Anyway`
4. 如有需要，也可以手动移除 quarantine：

```bash
xattr -dr com.apple.quarantine /Applications/GT\ Office.app
```

## 本机 CLI 与 Bridge

- 桌面端启动时会暴露本机 bridge 运行时信息，供 `gto` 发现并连接
- `gto` 是当前推荐的本机 agent 协作入口，负责目录查询、任务派发、等待回复、状态回复和 thread 查询
- 当前能力面向本机运行中的 GT Office 实例，不提供远程服务化 API

## 文档导航

- 需求文档：[docs/01_需求与产品设计.md](docs/01_需求与产品设计.md)
- 架构文档：[docs/02_系统架构与模块目录设计.md](docs/02_系统架构与模块目录设计.md)
- 开发进度：[docs/03_项目开发进度跟踪.md](docs/03_项目开发进度跟踪.md)
- 上下文交接：[docs/04_上下文交接文档.md](docs/04_上下文交接文档.md)
- 核心工作流：[docs/05_高质量功能设计_核心工作流.md](docs/05_高质量功能设计_核心工作流.md)
- API 与事件契约：[docs/06_API与事件契约草案.md](docs/06_API与事件契约草案.md)
- 依赖策略：[docs/07_依赖选型与精简清单.md](docs/07_依赖选型与精简清单.md)
