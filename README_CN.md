<div align="center">

# 🏢 GT Office

### 面向开发者的原生多智能体协同工作台

**告别终端 Tab 乱战，一个桌面 App 统一调度所有 AI Agent。**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/Laplace-bit/GT-Office?color=green&label=下载)](https://github.com/Laplace-bit/GT-Office/releases)
[![Stars](https://img.shields.io/github/stars/Laplace-bit/GT-Office?style=social)](https://github.com/Laplace-bit/GT-Office/stargazers)

[下载 macOS 版](https://github.com/Laplace-bit/GT-Office/releases) · [下载 Windows 版](https://github.com/Laplace-bit/GT-Office/releases) · [下载 Linux 版](https://github.com/Laplace-bit/GT-Office/releases) · [文档](docs/README.md) · [English](README.md)

</div>

---

## 为什么需要 GT Office？

如果你在用 **Claude Code、Codex CLI 或 Gemini CLI**，这些痛点你一定懂：

- 😫 十几个终端 Tab，每个跑一个 Agent
- 😫 Agent 之间无法互通
- 😫 关掉终端，状态全丢
- 😫 无法查看每个 Agent 的实时进展
- 😫 在手机上完全无法监控 Agent 运行

**GT Office 解决了所有这些问题。** 它是一个原生桌面应用，把零散的 CLI 工具变成统一的多 Agent 协同工作台。

| 没有 GT Office | 有 GT Office |
|---|---|
| 散落的终端 Tab | 统一工作台视图 |
| Agent 之间无法通信 | Agent 间任务总线（`gto`） |
| 关闭即丢失状态 | 工作区 & Agent 状态持久化 |
| 无远程可见性 | 支持 Telegram / 微信 / 飞书通道 |
| 手动编排 CLI 命令 | 一键启动 & 管理 Agent |

---

## ✨ 核心功能

| 🖥️ Agent 工位 | 📡 通道 |
|:---:|:---:|
| ![Agents View](docs/assets/agents-view.png) | ![Channel View](docs/assets/channel-view.png) |
| 在一个工作区启动 & 管理多个 AI Agent | 将 Agent 输出推送到 Telegram、微信、飞书 |

| ✅ 任务 | 📁 文件浏览 | 🔀 Git |
|:---:|:---:|:---:|
| ![Task View](docs/assets/task-view.png) | ![Explorer View](docs/assets/explorer-view.png) | ![Git View](docs/assets/git-view.png) |
| 追踪 Agent 任务与进度 | 浏览 & 编辑项目文件 | 一键 Git 操作 |

### GT Office 的差异化

- 🏠 **工作区持久化** — 创建一次 Agent，跨会话保持状态，无需重启
- 🔌 **100% 原生集成** — 直接嵌入官方 CLI，无抽象层，无能力损耗
- 🔄 **Agent 间通信** — 内置 `gto` CLI，Agent 自动派发任务、共享上下文、交接工作
- 📡 **外部通道代理** — 手机上的 Telegram、微信、飞书即可监控和指挥 Agent
- ⚔️ **对抗推理架构** — 预设 生成者-评审者 角色，交付前自动内部审核
- ⚙️ **可视化模型切换** — 随时切换 LLM 后端，零配置文件修改

---

## 🚀 快速上手

### 直接安装

下载适合你平台的最新版本：

👉 **[GitHub Releases](https://github.com/Laplace-bit/GT-Office/releases)**

### 从源码构建

```bash
# 前置条件：Node.js 20+、Rust stable、平台 Tauri 依赖
git clone https://github.com/Laplace-bit/GT-Office.git
cd GT-Office
npm install
npm run dev:tauri
```

macOS 提示：未签名构建首次运行需执行 `xattr -dr com.apple.quarantine /Applications/GT\ Office.app`。代码签名已在[路线图](#-路线图)中。

---

## 🏗️ 架构

```
GT-Office/
├── apps/desktop-web     # React + Vite 界面
├── apps/desktop-tauri   # Tauri 壳（Rust ↔ JS 桥接）
├── crates/              # Rust 领域模块
│   ├── gt-terminal/     #   终端仿真
│   ├── gt-git/          #   Git 操作
│   ├── gt-workspace/    #   工作区管理
│   ├── gt-task/         #   任务追踪
│   └── ...
├── packages/shared-types # 共享 TS/RS 契约
├── tools/gto/           # Agent 通信 CLI
└── docs/                # 架构 & 工作流文档
```

技术栈：**Rust** 后端 + **React** 前端 + **Tauri** 壳 = 快速、轻量、跨平台

---

## 🗺️ 路线图

- [x] 工作区级 Agent 管理
- [x] Agent 间通信（`gto`）
- [x] 外部通道代理（Telegram、微信、飞书）
- [x] 跨平台构建（macOS, Windows, Linux）
- [ ] 代码签名 & 公证（macOS + Windows）
- [ ] 工具适配器插件系统
- [ ] SSH 远程工作区
- [ ] Homebrew / Winget / Scoop 分发

---

## 🤝 参与贡献

欢迎贡献！详见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境、代码风格和 PR 流程。

**第一次参与？** 搜索 [`good first issue`](https://github.com/Laplace-bit/GT-Office/labels/good%20first%20issue) 标签快速上手。

---

## 📖 文档

| 文档 | 内容 |
|-----|------|
| [架构设计](docs/ARCHITECTURE.md) | 系统设计、目录结构、数据流 |
| [工作流](docs/WORKFLOWS.md) | 核心用户工作流 & 多工作站协同 |
| [API 契约](docs/API_CONTRACTS.md) | Tauri 命令、事件、共享类型 |
| [依赖策略](docs/DEPENDENCIES.md) | 依赖白名单 & 添加规则 |
| [发布流程](docs/release-process.md) | 标签、CI、产物发布 |

---

## ⭐ 支持项目

如果 GT Office 对你有用：

- 给个 **Star** ⭐ — 帮助更多人发现它
- 分享给你的团队
- [提交 Issue](https://github.com/Laplace-bit/GT-Office/issues) 反馈 Bug 或需求
- 加入社区讨论（即将开放）

---

<div align="center">

**为每天和 AI Agent 打交道的开发者而造 ❤️**

[Apache License 2.0](LICENSE) · [GitHub](https://github.com/Laplace-bit/GT-Office) · [Releases](https://github.com/Laplace-bit/GT-Office/releases)

</div>