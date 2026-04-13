# GT Office

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.6-blue.svg)](CHANGELOG.md)

## Screenshots

| Agents | Channels |
|:---:|:---:|
| ![Agents View](docs/assets/agents-view.png) | ![Channel View](docs/assets/channel-view.png) |

| Tasks | Explorer | Git |
|:---:|:---:|:---:|
| ![Task View](docs/assets/task-view.png) | ![Explorer View](docs/assets/explorer-view.png) | ![Git View](docs/assets/git-view.png) |

**GT-Office: A Native Multi-Agent Collaborative Workspace**

A next-generation desktop workspace designed to orchestrate, persist, and collaborate with native AI CLI tools (like Claude Code, Codex, and Gemini CLI). Instead of managing isolated command-line sessions, GT-Office provides a unified graphical environment for multi-agent concurrency, workflow persistence, and structured agent-to-agent communication.

**[简体中文](README_CN.md)**

## Table of Contents

- [Core Capabilities](#core-capabilities)
- [Monorepo Layout](#monorepo-layout)
- [Requirements](#requirements)
- [Development](#development)
- [Verification](#verification)
- [Release](#release)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

## Core Capabilities

- **Workspace-Centric Agent Persistence**: Create agents once and persist them within workspaces. Launch multiple concurrent agents with one click and manage them via a unified GUI, eliminating repetitive directory navigation and state loss inherent to standalone CLI tools.
- **100% Native Tool Integration**: Natively embeds official CLI tools (Claude Code, Codex, Gemini CLI) without abstraction layers, preserving their uncompromised underlying capabilities while adding a powerful management shell.
- **Agent-to-Agent Communication Bus**: Built-in `gto` CLI bridging serves as an internal network, enabling agents to securely dispatch tasks, share execution context, and hand over work without human intervention.
- **Customizable Command Workflows**: High-level GUI abstractions for complex CLI operations. Preset and custom command profiles make invoking sophisticated agent routines effortless.
- **External Channel Reverse-Proxy**: Extend local CLI visibility beyond your machine. Route agent execution streams to Telegram, WeChat, and Feishu for remote monitoring and instruction dispatching.
- **Adversarial Reasoning Architecture**: Pre-configured Generator-Evaluator agent roles systematically elevate output quality through automated internal review before human delivery.
- **Visual Model Configuration**: UI-driven configuration panel to map and switch API backing models on the fly, without modifying system-level settings files.

## Monorepo Layout

| Directory | Purpose |
|-----------|---------|
| `apps/desktop-web` | React + Vite desktop UI |
| `apps/desktop-tauri` | Tauri shell, native bridge, and packaging entry |
| `crates/` | Rust domain modules (terminal, git, workspace, task, storage, settings, etc.) |
| `packages/shared-types` | Shared contracts between frontend and backend |
| `tools/` | CLI and local-bridge utilities (`gto`) |
| `docs/` | Technical documentation |

## Requirements

- **Node.js** 20+
- **npm** 10+
- **Rust** stable
- **Platform-specific Tauri prerequisites**
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools + WebView2 Runtime
  - Linux: `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`

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

Recommended release flow:

1. Update version numbers and `CHANGELOG.md`
2. Commit the release changes on `main`
3. Tag the commit (e.g., `v0.1.7`)
4. Push the tag and let GitHub Actions build and publish macOS, Windows, and Linux artifacts

Detailed release operations, secrets, and retry guidance: [docs/release-process.md](docs/release-process.md)

The release workflow uploads a macOS `.dmg` and `.app` archive. Without Developer ID signing and notarization, the DMG is only suitable for manual testing or internal distribution and may be blocked by Gatekeeper.

If you intentionally want an unsigned macOS package for manual local testing:

```bash
GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1 npm run build:tauri
```

Manual installation steps:

1. Open the DMG and drag `GT Office.app` into `/Applications`
2. Try launching the app once
3. If macOS blocks it, open `System Settings > Privacy & Security` and choose `Open Anyway`
4. If needed, remove quarantine manually: `xattr -dr com.apple.quarantine /Applications/GT\ Office.app`

## Local CLI and Bridge

- The desktop app exposes local bridge runtime metadata so `gto` can discover and connect to the running GT Office instance
- `gto` is the recommended local entrypoint for agent collaboration, including directory lookup, task dispatch, waiting, status reporting, and thread inspection
- The current surface is local-only and does not provide a remote service API

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture, monorepo layout, and data flow
- [WORKFLOWS.md](docs/WORKFLOWS.md) — Core user workflows and multi-station collaboration
- [API_CONTRACTS.md](docs/API_CONTRACTS.md) — Tauri command surface, events, and shared types
- [DEPENDENCIES.md](docs/DEPENDENCIES.md) — Dependency policy and allowlist
- [release-process.md](docs/release-process.md) — Release workflow, tagging, and artifact publishing

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR process.

## Roadmap

- **Code signing and notarization** — Signed macOS DMGs and Windows installers for production distribution
- **Plugin system** — Extensible tool adapter and channel integration framework
- **Remote workspace support** — Connect to remote workspaces over SSH
- ~~**Crate rename** — Rename `vb-*` crates to `gt-*` for brand consistency~~ (done)

## License

This project is licensed under [Apache License 2.0](LICENSE).