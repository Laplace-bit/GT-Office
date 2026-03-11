# AGENTS.md

本文件是 `GT Office` 仓库内的人机协作规范。

## 0. AGENTS.md 在 Codex 中的作用（必须理解）

1. `AGENTS.md` 是仓库级执行规则，约束 AI Agent 与人类开发者的工作方式、文档流程与交接标准。
2. 作用范围是当前仓库（`/mnt/c/personal/vbCode`）内所有改动与会话。
3. 目标是把“该怎么做”变成可执行清单，降低上下文歧义与 token 消耗。
4. 若与平台安全规则冲突，以平台/系统规则为准；仓库内实现细节以本文为准。

## 1. 项目目标

1. 构建跨平台（Windows/Linux/macOS）高性能 AI Coding 桌面工具。
2. 核心能力：Workspace、文件管理、真终端、Git、多窗口并行、Tool Adapter、Change Feed。

## 2. 技术基线

1. 框架：Tauri + Rust + WebUI（React/Svelte）。
2. Rust：`tokio`、`portable-pty`、`notify`、`git2`、`tracing`。
3. 前端：`xterm.js`、Tailwind、轻量状态管理（zustand/jotai）。
4. 数据：SQLite + `.gtoffice/config.json`。
5. 配置：默认配置 + 用户配置 + 工作区配置 + 会话覆盖（分层模型）。

## 3. 目录边界

1. `docs/`：需求、架构、进度、交接、契约。
2. `apps/`：UI 与 Tauri 壳层。
3. `crates/`：Rust 领域模块。
4. `packages/`：共享类型与可复用组件。
5. `tests/`：集成/E2E，测试文件必须独立于被测文件。

禁止：
1. 业务逻辑直接写进 Tauri 命令入口。
2. UI 直接依赖系统能力实现。
3. 跨模块随意引用破坏边界。

后端模块化（MUST）：
1. `apps/desktop-tauri/src-tauri/src/commands/` 必须按前端 `apps/desktop-web/src/features/*` 对齐建目录。
2. 新增 Tauri command 禁止直接放在 `commands/` 根目录；必须归入对应 feature 目录。
3. `commands/` 仅负责命令入口绑定；feature 业务编排、runtime、helper 不得持续堆在 `mod.rs`。
4. 无法映射前端 feature 的后端能力，仅允许放在独立基础设施模块，如 `security`、`system`、`agent`。
5. `app_state.rs` 仅负责全局状态装配；单一 feature 的状态与流程必须下沉到对应 feature 模块。
6. `crates/` 优先承载领域能力；已形成稳定闭环的 feature，必须评估是否建立对应后端子模块或 crate，禁止继续向横向公共模块无界追加代码。
7. 测试文件不得散落在源码根目录；测试必须放入对应 feature 的 `tests/` 目录或 crate `tests/` 目录。
8. 新增文件前必须先确认：它属于哪个 feature、属于入口/领域/基础设施哪一层、为什么不能复用现有目录。

前端模块化（MUST）：
1. `apps/desktop-web/src/features/` 必须作为前端业务模块唯一落点；新增业务 UI、hooks、model、controller 禁止直接放在 `src/` 根目录或 `shell/`。
2. `shell/` 仅负责应用壳层编排、窗口框架、导航装配与平台集成；禁止继续承载具体 feature 实现。
3. `components/` 仅放跨 feature 复用的纯展示/基础组件；一旦组件绑定单一业务语义，必须迁回对应 `features/*`。
4. `features/<name>/` 内必须优先内聚该 feature 的 `components/hooks/model/style`，禁止把同一 feature 的实现拆散到多个无关目录。
5. `styles/` 仅放 design tokens、foundations、utilities 与跨 feature 样式入口；feature 专属样式必须跟随 feature 组件落位。
6. `stores/` 仅允许放跨 feature 的全局状态；单一 feature 状态禁止默认提升为全局 store。
7. 新增前端文件前必须先确认：它属于哪个 feature、是否为通用复用、为什么不能并入现有 feature 目录。

## 4. 开发流程（MUST）

1. 开发前确认 `docs/01` 与 `docs/02` 覆盖需求与架构。
2. 功能编码前补齐 `docs/05`（User Story、主/异常流程、验收）。
3. 联调前确认 `docs/06`（命令、事件、错误码）无歧义。
4. 编码完成后更新 `docs/03` 任务状态。
5. 会话结束前更新 `docs/04` 最近交接快照。
6. 所有改动可追溯到任务 ID（如 `T-00x`）。

## 5. 需求设计门槛（DoR）

每个功能点进入实现前必须满足：
1. `FR` 与 `NFR` 明确且可验收。
2. 至少 1 条 User Story（前置条件、主流程、异常流程）。
3. 契约完整：命令入参/出参、事件 payload、错误码。
4. 数据影响明确：表结构/配置字段/状态机变化。
5. 验收用例至少 1 条正常流 + 1 条异常流。

## 6. 代码规范

Rust：
1. 通过 `rustfmt` 与 `clippy`。
2. 统一领域错误类型，避免 `unwrap()` 滥用。
3. 关键链路必须有 `tracing`。
4. 单文件持续膨胀时，优先拆分 feature 子模块，禁止默认继续向超大文件追加实现。

Frontend：
1. 组件按 feature 分层，避免全局状态泛滥。
2. 大列表必须虚拟化。
3. 主题、快捷键、可访问性默认可用。
4. 多语言配置独立文件，禁止与业务代码耦合。
5. 样式统一使用 SCSS，按组件拆分样式文件，禁止新增裸 CSS。
6. 单文件或单目录持续膨胀时，优先拆分 feature 子模块，禁止默认继续向 `shell/`、全局 `components/`、全局 `stores/` 追加业务实现。

## 7. 架构与安全规范

1. 核心能力通过抽象接口暴露，禁止上层直连基础设施实现。
2. 多工作区操作必须显式携带 `workspace_id`。
3. 终端默认 `cwd = workspace.root`；自定义 cwd 必须做越界校验。
4. Provider 必须可 mock，支持 workspace/terminal/git/settings 隔离测试。
5. 默认命令只允许在 workspace 内执行。
6. 密钥必须存系统凭据，不允许明文落盘。
7. 高危命令/文件操作必须二次确认。
8. AI 配置变更必须走“预览 -> 校验 -> 确认 -> 应用 -> 审计”。

## 8. UI 规范

1. 风格：简洁、高级、专业、秩序化，响应式与自适应。
2. 统一设计令牌：色彩、间距、圆角、阴影、动效、字体层级。
3. 动效低干扰、快反馈，不影响高频操作效率。
4. 设置页/终端页/工作区页保持一致交互语义。
5. 字体建议：UI 使用 `SF Pro` 风格，代码区使用高可读等宽字体。

## 9. Git 与依赖治理

1. 分支命名：`feat/*`、`fix/*`、`refactor/*`、`docs/*`。
2. Commit：Conventional Commits（`feat:`、`fix:`、`docs:`）。
3. PR 必须包含：变更说明、风险、验证步骤。
4. 依赖选型以 `docs/07_依赖选型与精简清单.md` 为准。
5. 新增依赖必须说明用途/替代方案/影响范围，并更新 `docs/07`。
6. 发现未使用或非白名单依赖，直接删除。
7. 依赖变更后最小验证：`npm run typecheck`、`npm run build:web`、`cargo check --workspace`。

## 10. Agent 交接（MUST）

### 10.1 会话结束前

1. 更新 `docs/04_上下文交接文档.md`（仅保留“上一任 -> 下一任”的直接交接）。
2. 更新 `docs/03_项目开发进度跟踪.md`（状态与变更记录）。
3. 输出 `Next Agent Starter`，至少包含：
   - 当前里程碑与本轮目标
   - 已完成与未完成（含下一步第一动作）
   - 改动文件清单
   - 风险/阻塞与是否需要决策
   - 验证命令与结果
4. 未验证必须显式写明“未验证 + 原因”。

### 10.2 新会话启动时

1. 常规开发按顺序读取：
   - `docs/README.md`
   - `docs/03_项目开发进度跟踪.md`
   - `docs/04_上下文交接文档.md`
   - `docs/05_高质量功能设计_核心工作流.md`
   - `docs/06_API与事件契约草案.md`
   - `AGENTS.md`
2. 先复述“当前目标、第一执行动作、成功标准”，再改动代码。
3. 若 `docs/04` 缺失关键信息，先补齐交接快照。

## 11. Definition of Done（DoD）

任务标记 `DONE` 前必须满足：
1. 功能满足需求与验收标准。
2. `docs/05` 与 `docs/06` 已同步（如流程/契约变化）。
3. 关键路径有测试或可复现实验步骤。
4. 文档已更新（至少 `docs/03`，必要时 `docs/01/02/04`）。
5. 无阻塞性已知缺陷未记录。
6. 未新增根目录散点文件，且前后端入口层目录仍与前端 feature 边界对齐。

## 12. 文档优先级

1. `docs/01_需求与产品设计.md`
2. `docs/05_高质量功能设计_核心工作流.md`
3. `docs/06_API与事件契约草案.md`
4. `docs/02_系统架构与模块目录设计.md`
5. `AGENTS.md`
6. 其他文档
