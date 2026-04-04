# GT Office Agent Communication Policy

When communicating with another GT Office agent, use `gto` by default. If it is not on `PATH`, use `node tools/gto/bin/gto.mjs`.

- Use `gto directory snapshot --workspace-id <id> --json` or `node tools/gto/bin/gto.mjs directory snapshot --workspace-id <id> --json` to discover agents when you do not already know the target agent id.
- Use `gto agent send-task --target-agent-id <agent> --title <title> --markdown <markdown> --json` when you need another agent to execute or answer in its own terminal.
- Use `gto agent reply-status --task-id <task> --target-agent-id <agent> --detail <text> --json` for short replies and progress updates.
- Use `gto agent handover --task-id <task> --target-agent-id <agent> --summary <text> --json` for completion summaries, blockers, and next steps.
- Use `gto agent inbox --agent-id <agent> --json` and `gto agent task-thread --task-id <task> --json` to inspect open threads and message history.
- Always keep the returned `taskId` and include it in every follow-up status or handover reply.
- When `GTO_WORKSPACE_ID` and `GTO_AGENT_ID` are present in the environment, prefer the CLI defaults instead of repeating those flags manually.

# 项目目标

构建一个跨平台 AI Agent 管理桌面应用，支持 macOS 和 Windows。核心能力围绕：

- workspace
- files
- terminal
- Git
- 多窗口协作
- tool adapters
- change feed
- channels

## 文档入口

项目文档位于 `docs/`，按需读取，不默认全量阅读：

- `docs/01_需求与产品设计.md`
- `docs/02_系统架构与模块目录设计.md`
- `docs/03_项目开发进度跟踪.md`
- `docs/04_上下文交接文档.md`
- `docs/05_高质量功能设计_核心工作流.md`
- `docs/06_API与事件契约草案.md`
- `docs/07_依赖选型与精简清单.md`

读取原则：

- 只读取当前任务直接相关的文档和代码，有关键词则优先使用grep , find 来查找，而不是读取全文
- 用户提到具体文件、模块、流程、契约时，先读再判断
- 规则冲突时，优先采用**与当前任务最相关、最具体**的文档内容

文档映射：

- 需求相关：读 `docs/01`
- 架构、模块边界、目录归属：读 `docs/02`
- 开发进度、当前阶段：读 `docs/03`
- 上下文交接、延续上轮工作：读 `docs/04`
- 核心工作流：读 `docs/05`
- API、事件、前后端契约：读 `docs/06`
- 依赖增删、技术选型：读 `docs/07`

## 默认工作方式

- 以小步、可验证的方式推进
- 一次会话优先解决一个清晰的子任务
- 若任务过大，先切分为当前会话可完成的最小闭环
- 默认直接行动，但不基于猜测行动
- 不对未阅读的代码、文档或行为作判断
- 修改前先明确：当前目标、第一步动作、成功标准
- 修改的问题两次没解决应该考虑调试模式，增加日志等方式定位问题

## 范围控制

- 只做当前请求所需的改动，以及完成该改动所必需的最小配套修改
- 优先小 diff、定点修改、局部一致
- 不顺手重构无关代码
- 不为未来需求提前抽象
- 能局部改就不要整片重写
- 临时文件和辅助脚本若非正式产物，结束前删除

## 仓库边界

### 目录职责

- `packages/`：共享类型、通用能力、可复用基础组件
- `apps/`：应用层，包括 UI 应用和 Tauri shell
- `crates/`：稳定的 Rust 领域能力与基础设施
- `docs/`：需求、架构、进度、交接、契约、依赖策略
- `tests/`：不适合与源码混放的集成测试和 E2E 测试

### 禁止事项

- 不要在根目录散落临时或业务文件
- 不要在 Tauri command 入口写业务逻辑
- 不要让 UI 直接承载系统能力细节
- 不要用便利导入破坏模块边界

## 后端规则

- `apps/desktop-tauri/src-tauri/src/commands/` 必须与 `apps/desktop-web/src/features/*` 保持 feature 对齐
- 新增 Tauri command 时，放到对应 feature 目录；`commands/` 根目录只做入口绑定
- 运行时逻辑、编排、helper 放在 feature 模块或 `crates/` 中
- 跨 feature 的基础设施只放在明确的 infra 模块中，例如 `security`、`system`、`agent`
- `app_state.rs` 仅负责全局装配，不承载业务逻辑
- 后端逻辑稳定后，优先沉淀为独立模块或 crate
- Rust 测试放在 feature `tests/` 或 crate `tests/`，不要散落

## 前端规则

- `apps/desktop-web/src/features/` 是业务 UI、hooks、models、controllers 的主要归属
- `shell/` 只负责应用外壳、窗口框架、导航组合、平台集成
- `components/` 只放跨 feature 复用组件
- feature 专属 UI、hooks、models、styles 应保留在 `features/<name>/`
- `stores/` 只放真正跨 feature 的全局状态
- `styles/` 只放 design tokens、基础层、工具类和跨 feature 样式入口
- 多语言文本必须从组件中抽离，避免硬编码在 UI 内

### 样式约束

- 使用 SCSS，不新增原始 CSS 文件
- 使用响应式单位，避免使用 `px`
- 保持可访问性、主题能力、快捷键支持，以及大列表虚拟化能力
- UI 实现遵循既有设计系统和交互规范，涉及新增或优化界面时ui设计应该使用skill $ui-ux-pro-max ,保持苹果风格；
- 主题需要支持深色和暗色模式，不自行发散

## 工程约束

- Rust 代码必须通过 `rustfmt` 和 `clippy`
- 非简单路径避免 `unwrap()`
- 关键流程补充 `tracing`
- provider / system 能力必须可 mock
- 多工作区操作必须显式携带 `workspace_id`
- terminal 默认 `cwd = workspace.root`
- 自定义 `cwd` 必须位于 workspace 内
- 默认命令只能在 workspace 内执行
- secrets 必须使用系统凭证存储，不得明文落盘
- 高风险命令或文件操作必须先确认
- AI 配置变更遵循：`preview -> validate -> confirm -> apply -> audit`
- 文件或目录膨胀时，按 feature 或模块拆分，不扩大全局桶

## 依赖规则

- 依赖策略以 `docs/07_依赖选型与精简清单.md` 为准
- 新增依赖前，先在 `docs/07` 记录用途、备选方案和影响范围
- 已有合适方案时，不为了便利新增依赖
- 发现未使用依赖或不在白名单内的依赖时应清理

## 验证规则

- 每个有意义的改动都必须有验证路径
- 执行能证明当前改动有效的最小验证
- 不要静默跳过验证
- 可接受验证方式包括：
  - test
  - typecheck
  - build
  - lint
  - 可复现的手工验证
  - `未验证 + 原因`

依赖变更的最低验证：

- `npm run typecheck`
- `npm run build:tauri`
- `cargo check --workspace`

其他要求：

- 不要因为“看起来对”就宣布完成
- 不要为了过测试而硬编码或绕路

## 完成标准

仅当以下适用项满足时，任务才算完成：

- 改动已实现
- 相关行为满足要求
- 模块边界和目录职责未被破坏
