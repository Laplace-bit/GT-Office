<div align="center">

# 🏢 GT Office

### Native Multi-Agent Collaborative Workspace

**Stop juggling terminal tabs. Orchestrate all your AI agents in one desktop app.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/Laplace-bit/GT-Office?color=green&label=Download)](https://github.com/Laplace-bit/GT-Office/releases)
[![Stars](https://img.shields.io/github/stars/Laplace-bit/GT-Office?style=social)](https://github.com/Laplace-bit/GT-Office/stargazers)

[Download for macOS](https://github.com/Laplace-bit/GT-Office/releases) · [Download for Windows](https://github.com/Laplace-bit/GT-Office/releases) · [Download for Linux](https://github.com/Laplace-bit/GT-Office/releases) · [Documentation](docs/README.md) · [中文说明](README_CN.md)

</div>

---

## Why GT Office?

If you use **Claude Code, Codex CLI, or Gemini CLI**, you know the pain:

- 😫 A dozen terminal tabs, each running a different agent
- 😫 No way for agents to talk to each other
- 😫 State disappears when you close the terminal
- 😫 No visibility into what each agent is doing
- 😫 Can't monitor agents from your phone or chat apps

**GT Office fixes all of this.** It's a native desktop app that turns isolated CLI tools into a coordinated multi-agent workspace.

| Without GT Office | With GT Office |
|---|---|
| Scattered terminal tabs | Unified workspace view |
| Agents can't communicate | Agent-to-Agent task bus (`gto`) |
| State lost on close | Persistent workspace & agent state |
| No remote visibility | Telegram / WeChat / Feishu channels |
| Manual CLI orchestration | One-click agent launch & management |

---

## ✨ Core Features

| 🖥️ Agent Workstations | 📡 Channels |
|:---:|:---:|
| ![Agents View](docs/assets/agents-view.png) | ![Channel View](docs/assets/channel-view.png) |
| Launch & manage multiple AI agents in one workspace | Route agent output to Telegram, WeChat, Feishu |

| ✅ Tasks | 📁 Explorer | 🔀 Git |
|:---:|:---:|:---:|
| ![Task View](docs/assets/task-view.png) | ![Explorer View](docs/assets/explorer-view.png) | ![Git View](docs/assets/git-view.png) |
| Track agent tasks & progress | Browse & edit project files | Git operations in one click |

### What Makes GT Office Different

- 🏠 **Workspace-Centric Persistence** — Create agents once, they persist across sessions. No more restarting from scratch.
- 🔌 **100% Native Integration** — Wraps official CLIs directly. No abstraction, no capability loss. Claude Code stays Claude Code.
- 🔄 **Agent-to-Agent Communication** — Built-in `gto` CLI lets agents dispatch tasks, share context, and hand off work — automatically.
- 📡 **External Channel Proxy** — Monitor and instruct agents from Telegram, WeChat, or Feishu on your phone.
- ⚔️ **Adversarial Reasoning** — Pre-configured Generator-Evaluator roles for auto-review before delivery.
- ⚙️ **Visual Model Switching** — Change backing LLMs on the fly, zero config file editing.

---

## 🚀 Quick Start

### Install (Binary)

Download the latest release for your platform:

👉 **[GitHub Releases](https://github.com/Laplace-bit/GT-Office/releases)**

### Install (From Source)

```bash
# Prerequisites: Node.js 20+, Rust stable, platform Tauri deps
git clone https://github.com/Laplace-bit/GT-Office.git
cd GT-Office
npm install
npm run dev:tauri
```

macOS Gatekeeper note:unsigned builds need `xattr -dr com.apple.quarantine /Applications/GT\ Office.app` on first run. Code signing is on the [roadmap](#roadmap).

---

## 🏗️ Architecture

```
GT-Office/
├── apps/desktop-web     # React + Vite UI
├── apps/desktop-tauri   # Tauri shell (Rust ↔ JS bridge)
├── crates/              # Rust domain modules
│   ├── gt-terminal/     #   Terminal emulation
│   ├── gt-git/          #   Git operations
│   ├── gt-workspace/    #   Workspace management
│   ├── gt-task/         #   Task tracking
│   └── ...
├── packages/shared-types # Shared TS/RS contracts
├── tools/gto/           # Agent communication CLI
└── docs/                # Architecture & workflow docs
```

Built with **Rust** backend + **React** frontend + **Tauri** shell = fast, lightweight, cross-platform.

---

## 🗺️ Roadmap

- [x] Workspace-centric agent management
- [x] Agent-to-Agent communication (`gto`)
- [x] External channel proxy (Telegram, WeChat, Feishu)
- [x] Cross-platform builds (macOS, Windows, Linux)
- [ ] Code signing & notarization (macOS + Windows)
- [ ] Plugin system for tool adapters
- [ ] Remote workspace over SSH
- [ ] Homebrew / Winget / Scoop distribution

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code style, and PR process.

**New to the project?** Look for [`good first issue`](https://github.com/Laplace-bit/GT-Office/labels/good%20first%20issue) labels to get started.

---

## 📖 Documentation

| Doc | Content |
|-----|---------|
| [Architecture](docs/ARCHITECTURE.md) | System design, monorepo layout, data flow |
| [Workflows](docs/WORKFLOWS.md) | Core user workflows & multi-station collaboration |
| [API Contracts](docs/API_CONTRACTS.md) | Tauri commands, events, shared types |
| [Dependencies](docs/DEPENDENCIES.md) | Dependency policy & allowlist |
| [Release Process](docs/release-process.md) | Tagging, CI, artifact publishing |

---

## ⭐ Show Your Support

If GT Office sounds useful to you:

- Drop a **Star** ⭐ on this repo — it helps others discover it
- Share it with your team
- [Open an issue](https://github.com/Laplace-bit/GT-Office/issues) for bugs or feature requests
- Join the discussion (coming soon!)

---

<div align="center">

**Made with ❤️ for developers who work with AI agents every day**

[Apache License 2.0](LICENSE) · [GitHub](https://github.com/Laplace-bit/GT-Office) · [Releases](https://github.com/Laplace-bit/GT-Office/releases)

</div>