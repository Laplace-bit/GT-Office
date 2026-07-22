# 设计工作台创作层重设计 — 对话式 designer agent

- 日期：2026-07-05
- 状态：Approved（直接开发，跳过 SDD）
- 范围：子项目 B（创作层）。产物层（A）已落地。消费层走现有 Agent Station session，不单独建子项目。
- 相关：`docs/superpowers/specs/2026-07-05-designer-artifact-layer-design.md`（A）、`docs/BUSINESS_DESIGNER_MODULE_DESIGN.md`、`docs/AGENT_SESSION_ARCHITECTURE.md`

## 1. 目标

用 workspace 级常驻 designer-scoped station 取代当前 headless 单次 freeform 补全，提供持续对话、流式输出、可恢复、直接改文件 + 画布可视化 + 每轮 checkpoint 回滚。锚定补全 track 原样保留。

## 2. 核心决策（A 之前 brainstorm 已定）

1. 统一两者——开放式设计对话 + 场景提示词作为入口预填消息，喂给同一个持续会话。
2. workspace 级常驻 station——复用 Agent 管理基础设施。
3. 嵌入式终端——图旁边一个 xterm，跟 station 一样。
4. 直接改 + checkpoint 回滚——无预审核闸门；锚定 track 保留为可选 review 流。
5. 实现路径：设计器专属 station（Path 1）——复用 station 运行时，设计器拥有界面与生命周期。

## 3. 架构

```
apps/desktop-web/
  features/business-designer/
    BusinessDesignerPane.tsx ── 嵌入 ──> DesignerAgentPane（薄封装 StationXtermTerminal）
    DesignerAgentDock.tsx ── 场景 quick-action（insert_text/insert_and_submit）
    useDesignerAgentStation.ts ── station 生命周期 / 文档上下文
  features/workspace-hub/ station-model（+ designer scope 过滤）
  features/terminal/ StationXtermTerminal（复用，不改）
apps/desktop-tauri/src-tauri/src/commands/
  business_designer/
    mod.rs ── 删除 headless freeform 路径
    agent_station.rs（新）── ensure/bind/render_scenario_prompt/checkpoint_turn
    agent_completion_prompts.rs ── render_freeform_completion_prompt → render_scenario_prompt
  agent/ agent.rs ── station CRUD（+ designer scope）
  terminal/、tool_adapter/ ── 复用，不改
crates/gt-agent/
  models.rs ── AgentProfile + scope: AgentScope（Station | Designer）
  seeds.rs ── 自动播种 designer station
```

**关键决定**：
- designer station 进 agent registry 但不进全局 station 列表（workspace-hub 按 scope 过滤；设计器面板内嵌）。
- 静态上下文进 CLAUDE.md（docs root），动态意图进场景 quick-action。CLAUDE.md 描述 block schema（含 A 的 uiScreen HTML + `data-*` 约定）、gap/完备性规则、编辑约定、文件布局、反馈回路。
- workdir = workspace docs root；active documentId 走 env（`GTO_DESIGNER_DOCUMENT_ID`）+ 场景提示注入。
- 场景 quick-action 与注释捕获统一为 `insert_text`/`insert_and_submit`——注释选中的元素片段作为一种"场景"注入终端。
- agent 直接改 `design.json` → 现有 `watch_document` 重载图 + 重跑 gap/完备性 → 画布可视化。
- 每轮场景派发自动 `create_checkpoint`，历史面板可 revert。
- session resume 走 `gt-agent-session`（`claude --resume <id>`）。

## 4. 要替换/删除的现有路径

- 前端 `controllers/useDesignerFreeformCompletion.ts` + `model/designer-freeform-completion.ts`。
- 后端 `start_freeform_completion_at` / `run_freeform_completion_process` / `spawn_freeform_output_logger` / `read_freeform_completion_run_log` / `list_freeform_completion_runs` / `update_freeform_completion_run_status` / `reconcile_stale_freeform_run_status` / `infer_freeform_completion_status_from_log` + `DesignerFreeformCompletion*` 类型。
- 前端 `DesignerInspector.tsx` 的 `FreeformCompletionPanel` + `DesignerToolbar.tsx` 的单行 prompt 输入。
- 后端命令注册（`lib.rs`）的 freeform 命令。

## 5. 组件

### 后端
- `crates/gt-agent/models.rs`：`AgentProfile` 加 `scope: AgentScope`（`Station` | `Designer`，`#[serde(default)]` 向后兼容）。
- `crates/gt-agent/seeds.rs`：每 workspace 播种一个 designer station（role: business-designer, workdir: docs root, scope: Designer）。
- `commands/business_designer/agent_station.rs`（新）：
  - `business_designer_ensure_agent_station(workspaceId)` → 确保 station + terminal session。
  - `business_designer_bind_document_context(workspaceId, documentId)` → 设 env + cd docs root。
  - `business_designer_render_scenario_prompt(workspaceId, documentId, scenario, hostBlockId?, userPrompt?)` → 短场景提示。
  - `business_designer_checkpoint_turn(workspaceId, documentId, message)` → 复用 `create_checkpoint`。
- `agent_completion_prompts.rs`：`render_scenario_prompt` 产出注入终端的短文本（静态上下文在 CLAUDE.md）。
- `lib.rs`：注册新命令，注销 freeform 命令。

### 前端
- `components/DesignerAgentPane.tsx`（新）：薄封装 `StationXtermTerminal`，订阅 `terminal/output`。
- `components/DesignerAgentDock.tsx`（新）：场景 quick-action + 注释捕获 action，`insert_text`/`insert_and_submit`。
- `controllers/useDesignerAgentStation.ts`（新）：`ensure`/`bindDocument`/`injectPrompt`/terminal session 管理。
- 删除 `useDesignerFreeformCompletion.ts` + `designer-freeform-completion.ts`。
- `BusinessDesignerPane.tsx`：替换 freeform 面板 + toolbar 单行输入为 `DesignerAgentPane` + `DesignerAgentDock`。
- `DesignerScreenPreview.tsx`（A 产出）：`onSelectElement` 接 dock 注释捕获 action。
- `features/workspace-hub/station-model.ts`：全局列表按 scope 过滤 Designer。

### CLAUDE.md（docs root，静态上下文）
由 `init_docs_repo` / `ensure_agent_station`（缺失才写）写入：block schema（17 kind，重点 uiScreen HTML + `data-*`、dataContract JSON Schema）、gap + 完备性规则码、编辑约定（直接改 design.json、保留 block id、`data-*` 链接、每轮 checkpoint）、文件布局、反馈回路。

## 6. 数据流

1. 开对话：打开 designer → `ensure` → station + terminal session → 嵌 `StationXtermTerminal`。CLAUDE.md 提供静态上下文。
2. 发场景：点 dock 场景按钮 → `render_scenario_prompt` → `insert_and_submit` → agent 读 CLAUDE.md + 注入提示 → 改 design.json。
3. 注释优化：`DesignerScreenPreview` 注释模式选中元素 → `onSelectElement` → dock 注入"优化此元素：<outerHTML>" → 用户加指令 + 提交 → agent 改写 HTML。
4. 改文件→可视化：agent 改 design.json → `watch_document` → 重载 + 重跑 gap/完备性 → 画布 + 检查器更新。
5. 每轮 checkpoint：场景派发自动 `checkpoint_turn` → 历史面板 revert。
6. 恢复：station 终端会话持久；重开走 `gt-agent-session`。
7. 切文档：`bind_document_context` 更新 env + cd。

## 7. 安全 / 测试 / 迁移 / 文档

- 安全：每轮 checkpoint；直接改 + gap 规则事后判定；dirty-state 沿用 A；iframe sandbox（A 已做）。
- 测试：`agent_station.rs`（ensure 幂等/bind/render_scenario_prompt 快照/checkpoint_turn）；删除 freeform 路径后无悬空引用；前端 hook + dock 测试。验证：`cargo test business_designer` + `cargo clippy -- -D warnings` + `cargo check --workspace` + `npx tsc -b`。
- 迁移：`.agent-runs/` 留盘只读；在途 freeform 进程下次启动清理；CLAUDE.md 缺失才写；`AgentProfile.scope` 默认 `Station` 向后兼容。
- 文档：`BUSINESS_DESIGNER_MODULE_DESIGN.md` §5.4/§7.6/M5 改为 station 模型 + 标注 freeform 移除；`API_CONTRACTS.md` 删 freeform 命令、加新命令；ADR 0019（designer agent station）；DEPENDENCIES 无新依赖。

## 8. 不在 B 范围

- 自动化代码生成反馈回路（消费走现有 station session）。
- 每文档独立持久线程（station workspace 级，文档上下文靠 env）。
- 锚定 gap-completion 折进对话（保留独立 review 流）。

## 9. Native-feel 取舍

在既有 Tauri 架构内（不重审 Tauri 选型）：复用 `StationXtermTerminal` 的原生质感；新组件遵循 CLAUDE.md（苹果风格、深/浅色、`rem`、快捷键、虚拟化）；不用 `cursor: pointer` 等 web 化交互（T3 adopt the platform）。
