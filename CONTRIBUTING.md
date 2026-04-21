# Contributing / 贡献指南

Thank you for contributing to GT Office. This guide covers local setup, development workflow, code standards, testing, and pull request expectations.

感谢你为 GT Office 做出贡献。本文档说明本地环境、开发工作流、代码规范、测试要求以及 Pull Request 提交流程。

## 1. Environment Requirements / 环境要求

Before you start, make sure the following tools are installed:

开始之前，请先安装以下环境：

- Node.js 20+
- Rust stable (latest stable release) / Rust stable（最新稳定版）
- macOS: Xcode Command Line Tools
- Linux: WebKitGTK related packages required by Tauri (`webkit2gtk` and related system dependencies) / Linux：Tauri 所需的 WebKitGTK 相关依赖（`webkit2gtk` 及相关系统库）
- Windows: Microsoft Edge WebView2 Runtime / Windows：Microsoft Edge WebView2 Runtime

## 2. Build From Source / 从源码运行

Clone the repository and start the desktop app:

克隆仓库并启动桌面应用：

```bash
git clone https://github.com/Laplace-bit/GT-Office.git
cd GT-Office
npm install
npm run dev:tauri
```

`npm run dev:tauri` runs the Tauri development workflow defined in the repo and starts the web frontend plus Rust desktop shell together.

`npm run dev:tauri` 会调用仓库中定义的 Tauri 开发流程，同时启动前端和 Rust 桌面壳。

## 3. Development Workflow / 开发工作流

Use the smallest validation loop that proves your change:

优先使用最小但足以证明改动有效的验证闭环：

- Frontend development / 前端开发:
  ```bash
  cd apps/desktop-web
  npm run dev
  ```
- Tauri development / Tauri 联调开发:
  ```bash
  npm run dev:tauri
  ```
  This starts Vite and Rust compilation together. / 该命令会同时启动 Vite 与 Rust 编译。
- Type checking / 类型检查:
  ```bash
  npm run typecheck
  ```
- Build verification / 构建检查:
  ```bash
  npm run build:tauri
  ```
- Rust workspace check / Rust 工作区检查:
  ```bash
  cargo check --workspace
  ```

## 4. Code Standards / 代码规范

- Rust: code must pass `rustfmt` and `clippy`. Avoid `unwrap()` on non-trivial paths. Add `tracing` for critical flows when appropriate.
- Rust：代码必须通过 `rustfmt` 与 `clippy`。非简单路径避免使用 `unwrap()`；关键流程按需补充 `tracing`。
- TypeScript: follow the project TypeScript strict-mode setup and keep types explicit at module boundaries.
- TypeScript：遵循项目现有的 TypeScript 严格模式，在模块边界保持清晰类型。
- Frontend styles: use SCSS. Keep the existing Apple-style design language and current design system conventions.
- 前端样式：使用 SCSS，保持现有苹果风格设计语言与设计系统约定。
- Module boundaries: follow the responsibilities defined in `AGENTS.md`.
- 模块边界：遵循 `AGENTS.md` 中的目录职责划分。
- `apps/desktop-web/src/features/` holds feature UI, hooks, models, and controllers. `shell/` should stay focused on application shell, window frame, navigation composition, and platform integration.
- `apps/desktop-web/src/features/` 是业务 UI、hooks、models、controllers 的主要位置；`shell/` 只负责应用外壳、窗口框架、导航组合与平台集成。
- `apps/desktop-tauri/src-tauri/src/commands/` should stay aligned with frontend features. Do not put business logic directly in command entrypoints.
- `apps/desktop-tauri/src-tauri/src/commands/` 需要与前端 feature 对齐，不要把业务逻辑直接堆在 command 入口。

## 5. Pull Request Process / PR 流程

- Fork the repository, create a focused branch, commit your changes, and open a PR.
- Fork 仓库，创建聚焦单一目标的分支，提交后发起 PR。
- Use commit messages in the form:
  ```text
  type(scope): description
  ```
- Commit message 使用如下格式：
  ```text
  type(scope): description
  ```
- Keep each PR focused on one change or one coherent problem.
- 每个 PR 只聚焦一个改动点或一个完整问题闭环。
- Before opening a PR, make sure the relevant checks pass, at minimum:
  ```bash
  npm run typecheck
  npm run build:tauri
  ```
- 发起 PR 前至少确保以下校验通过：
  ```bash
  npm run typecheck
  npm run build:tauri
  ```

## 6. Testing Requirements / 测试要求

- Frontend tests are currently run in `apps/desktop-web` through the project test script, which compiles test files and executes them with `node --test`:
  ```bash
  cd apps/desktop-web
  npm run test:unit
  ```
- 前端测试当前在 `apps/desktop-web` 下运行，项目脚本会先编译测试文件，再通过 `node --test` 执行：
  ```bash
  cd apps/desktop-web
  npm run test:unit
  ```
- Rust tests:
  ```bash
  cargo test --workspace
  ```
- Rust 测试：
  ```bash
  cargo test --workspace
  ```
- Important or behavior-changing changes must include tests or a clear explanation of why tests were not added.
- 关键改动或行为变更必须附带测试；如果未补测试，需要明确说明原因。
- Do not skip verification silently. If something cannot be validated locally, say so in the PR.
- 不要静默跳过验证；若本地无法完成验证，请在 PR 中明确说明。

## 7. Project Documentation Index / 项目文档索引

Start with the docs under [`docs/`](docs/). The most relevant entry points today are:

从 [`docs/`](docs/) 目录开始阅读。当前最常用的入口文档包括：

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): system design, monorepo layout, and module boundaries
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：系统架构、仓库结构与模块边界
- [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md): Tauri commands, events, and shared contracts
- [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md)：Tauri 命令、事件与共享契约
- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md): core product workflows and collaboration flows
- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md)：核心工作流与协作流程
- [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md): dependency policy and dependency review expectations
- [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)：依赖策略与依赖评审要求
- [`docs/release-process.md`](docs/release-process.md): release and packaging workflow
- [`docs/release-process.md`](docs/release-process.md)：发布与打包流程
- [`docs/README.md`](docs/README.md): documentation index for the rest of the project docs
- [`docs/README.md`](docs/README.md)：其他文档的总入口

## 8. Contribution Principles / 贡献原则

- Prefer small, reviewable diffs. / 优先提交小而可审查的改动。
- Do only the minimum supporting changes required by the task. / 只做当前任务所需及其必要配套修改。
- Do not add dependencies unless existing solutions are insufficient and the dependency policy is respected. / 除非现有方案无法满足且符合依赖策略，否则不要新增依赖。
- Preserve existing behavior unless the change explicitly intends to modify it. / 除非任务明确要求，否则不要改变现有行为。

Thank you for helping improve GT Office.

感谢你帮助 GT Office 持续改进。
