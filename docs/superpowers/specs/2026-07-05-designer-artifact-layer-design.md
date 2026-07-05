# 设计工作台产物层重设计 — code-gen-ready 提示词资产

- 日期：2026-07-05
- 状态：Draft，待审阅
- 范围：子项目 A（产物层）。子项目 B（创作层）、C（消费层）见本文档"上下文与分解"一节，本文档不展开。
- 相关文档：`docs/BUSINESS_DESIGNER_MODULE_DESIGN.md`（v1.1）、`docs/ARCHITECTURE.md`、`docs/API_CONTRACTS.md`、`CONTEXT.md`、`docs/adr/0001`–`0017`

## 1. 背景与动机

### 1.1 终极预期

设计工作台的终极目标不是"做一个需求文档工具"，而是实现一种新的软件开发范式：**把产品工程师与软件工程师合并**。工作台以四柱——文本描述 + JSON Schema + 流程 + UI——准确表达一个软件系统的需求说明；这份说明同时是一份**软件系统的提示词资产**，AI agent 能据此生产准确代码。

换言之，工作台的产物必须同时满足两个身份：

1. 一份准确、完备的需求说明书（人可读）；
2. 一份可被代码生成 agent 直接消费的提示词资产（机器可读、结构化）。

### 1.2 现状审视

当前设计工作台是"带设计补全回路的结构化需求包"，不是"代码生成驱动器"。核实结论：

| 维度 | 现状 | 对终极预期的支持 |
|---|---|---|
| text | `brief`（`text` block，id 强制为 `brief`），强 | 满足 |
| JSON Schema | `dataContract.schema` 为自由字符串，不解析不校验；`objectModel` 为自由 JSON。无任何符合标准、机器可消费的 JSON Schema block | 缺口 |
| flow | `businessFlow`（states/transitions）+ 6 条 gap 规则，强 | 满足 |
| UI | `uiWorkflow` 仅为标签——无 payload schema、无 gap 规则、无渲染器（`JSON.stringify` 直出）、画布不可创建（`docs/BUSINESS_DESIGNER_MODULE_DESIGN.md` §7.3 限制只能创建 entityModel/businessFlow/apiContract） | 缺口 |
| 提示词资产编译 | `compile_document` 产出 `agent-brief.md` + `agent-input.json`，声明 `outputContract: "DesignerAgentPatch"`——面向"返回设计补丁"的 agent，不面向"生成代码"的 agent。`render_coding_handoff_markdown` 是唯一的真代码 agent 提示，但仅 handoff 时生成、非编译产物、UI 出 v1 范围 | 错位 |
| 代码生成 handoff + 反馈 | `dispatch_coding_handoff` 经通用 Task Center 派发，无硬编码 coding agent；唯一反馈回路 `recover_agent_patch_from_task` 回收的是**设计补丁**，非代码生成结果；编译错误/测试失败/agent 提问无回写 spec 的通路；handoff UI 出 v1 范围 | 缺口 |

设计文档自身的措辞是"需求包"（requirement package），成功标准是"结构完备、规则全绿、可导出的需求包"——**未把"驱动代码生成"列为目标**。`docs/adr/0001`–`0017` 仅覆盖 v1.0 锚定补全，v1.1 自由补全与产物层均无 ADR。

### 1.3 创作层现状（子项目 B 领域，仅作上下文）

当前自由补全（freeform completion）走 headless 单次 CLI 派发：`codex exec "<prompt>"` / `claude -p "<prompt>"`，stdout 写 `.log` 文件，前端每 2 秒轮询渲染原始日志文本，`session_id = "headless:<command>"`，无流式、无对话延续、无 resume。这偏离 `docs/BUSINESS_DESIGNER_MODULE_DESIGN.md` §5.4/§7.6/M5 原本要求的"专属 transient CLI Agent session，复用 terminal/session 基础设施"。Agent 管理的 station 则用交互式 PTY + `terminal/output` 流 + 提供方侧会话持久化 + resume——这是创作层要采用的模型，但属于子项目 B。

## 2. 上下文与分解

终极预期跨越两个子项目（A 产物层 + B 创作层），消费层不单独建子项目——依赖现有 Agent Station：

```
子项目 A：产物层（基础 / spine）        子项目 B：创作层
  UI block（schema+规则+渲染）            对话式 designer agent
  JSON Schema block（可校验）             场景 quick-action
  compile 重定向为 code-gen               直接改 + checkpoint
    提示词资产                            文档上下文 + 可视化
  完备性规则                              依赖 A 的词汇表
        │                                      │
        └────────── A 是 spine，B 依赖 A ──────┘
                          │
                          ▼
            消费层：现有 Agent Station Session
            用户在 station session 里把 A 产出的 code-gen-prompt.md
            交给 agent 实现代码。现有 dispatch_coding_handoff 后端已能
            向 station terminal 派发 handoff 提示，UI 可后补；v1 可纯手动。
```

- **A（产物层）**：定义 spec 是什么、编译产出什么。B 的 agent 无法创作不存在的 block；station 消费需要合格的 code-gen 提示词资产——都依赖 A。本 spec 覆盖 A。
- **B（创作层）**：Path 1 对话式 designer agent。workspace 级常驻 station（复用 PTY/`terminal/output`/resume/`StationXtermTerminal`）、嵌入式终端、场景 quick-action、直接改 + 每轮 checkpoint + 画布可视化。依赖 A 的词汇表。延后到 A 词汇表定稿后单独 brainstorm。
- **消费层（不单独建子项目）**：用户在现有 Agent Station session 里把 A 产出的 `code-gen-prompt.md` 交给 agent 实现。station 是通用消费端，能吃任意需求文档；designer 的价值是产出结构最完整、code-gen-ready 的资产，而非 station 的唯一输入。现有 `dispatch_coding_handoff` 后端已能向 station terminal 派发 handoff 提示（Task Center + `write_terminal_with_submit` + `bind_task_wait_reply_sessions`），UI 可后补；v1 可纯手动。代码生成反馈不自动回写 spec——用户通过 B 的对话手动中继。自动化反馈回路不在 v1 范围。

推荐顺序：A → B。消费随 A 落地即可用（手动）。

## 3. 目标与成功标准

### 3.1 目标

让设计文档从"设计补丁导向的需求包"升级为"驱动代码生成的提示词资产"：

1. 四柱齐备——text + JSON Schema + flow + UI 都有结构化、可校验、可渲染的 block。
2. 规则全绿——一致性 gap（现有）+ 完备性 gap（新增）都满足。
3. 编译产出可直接喂给代码 agent 的提示词资产——`code-gen-prompt.md` + `outputContract: "code"`。
4. 代码 agent 据此能生成准确代码（C 层验证；A 层只保证资产合格）。

### 3.2 成功标准

- 一份从"订单系统"brief 出发、四柱齐备的设计文档，编译产出 `code-gen-prompt.md`；
- 该提示词资产包含 role 定位、四柱内容、验收标准、操作规则、输出契约；
- 完备性规则全绿（无孤儿端点/实体、流程有验收、UI 覆盖流程）；
- 现有锚定补全 track（`designerPatch` 模式）不被破坏。

### 3.3 非目标

- 不在本 spec 实现：对话式创作层（B，独立 spec）。
- 不建独立消费层子项目：代码生成消费走现有 Agent Station session（用户把 A 产出的 `code-gen-prompt.md` 交给 station agent 实现）。`dispatch_coding_handoff` 后端已存在，UI 后补；v1 可纯手动。
- 不做自动化代码生成反馈回路（编译错误/测试失败/agent 提问 → 自动回写 spec）。v1 反馈由用户通过 B 的对话手动中继。
- 不重构现有 `entityModel`/`businessFlow`/`apiContract` 的 payload 结构（仅 `dataContract` 升级 + 新增 `uiScreen` HTML payload；`uiWorkflow` 维持占位符不升级）。
- 不做 `crates/gt-business-designer` 沉淀（`docs/BUSINESS_DESIGNER_MODULE_DESIGN.md` §8.1 提及的远期迁移，A 之后视稳定性再议）。

## 4. 设计

### 4.1 UI block 模型

**决策（默认，待确认）**：HTML 为 UI 提示词资产——每个屏幕一个 `uiScreen` block，payload 是 HTML；workbench 直接渲染 HTML；注释模式选中元素交 AI 优化。

- 新增 `uiScreen` block：
  ```jsonc
  {
    "screenName": "string",
    "route": "string?",     // 可选路由/路径
    "html": "string"        // 屏幕 HTML 标记，可渲染，承载 data-* 跨 block 链接
  }
  ```
  - HTML 是 UI 的**单一事实来源**——既是设计文档（人可读、可渲染预览），又是代码生成提示词资产（机器可消费、可直接喂给前端代码 agent）。
  - 跨 block 链接用 HTML `data-*` 属性编码（不另建结构字段，保持单一事实来源）：
    - `data-nav="uiScreenId"` — 导航到另一屏幕
    - `data-entity="entityModelId"` — 绑定到实体
    - `data-api="apiContractId"` 或 `data-api="apiContractId:METHOD path"` — 触发 API（支持端点级）
    - `data-flow="businessFlowId"` — 参与某业务流程
- `uiWorkflow` **不升级**——交互流由 HTML 的 `data-flow`/`data-nav` 承载。现有 `uiWorkflow` 占位符维持原状（不删，避免破坏既有词汇表），后续若需显式旅程文档再议。
- 一致性 gap 规则（`gap_rules.rs` 新增 `check_ui_screen`）：
  - HTML 可解析（well-formed）；
  - 所有 `data-nav`/`data-entity`/`data-api`/`data-flow` 引用指向存在的 block。
- 派生边（`derive_edges` 扩展，从 HTML `data-*` 提取）：
  - `uiScreen → uiScreen`（`data-nav`，`navigatesTo`）
  - `uiScreen → entityModel`（`data-entity`，`uses`）
  - `uiScreen → apiContract`（`data-api`，`consumes`）
  - `uiScreen → businessFlow`（`data-flow`，`participatesIn`）
- 渲染：workbench 用 sandboxed iframe（`srcdoc`）直接渲染 `uiScreen.html`；画布节点随派生边连线。
- 注释模式（A 层提供 hook，B 层提供对话）：
  - A：iframe 上叠加注释层，点击选中元素，捕获元素 `outerHTML` + 祖先上下文 + 所属 `uiScreenId`。
  - B：把选中片段 + 用户优化指令发给 designer agent；agent 返回改写后的 HTML 片段或整页；落盘 → checkpoint → 预览/画布重载。
- 画布创建入口放开：`uiScreen` 加入 §7.3 可创建集合。

**备选（未选）**：
- 结构化 `components[]` + `navigation[]`：gap 规则干净，但失去 HTML 的可渲染性与代码生成保真度——UI 不是 HTML 时，代码 agent 还要再猜布局/样式。
- 完整三件套（`uiScreen` + `uiComponent` + `uiFlow`）：表达力强但工作量最大，且仍不如 HTML 直接可消费。

**理由**：HTML 是 UI 的原生语言；可渲染、可注释、可被代码 agent 直接消费，最贴合"提示词资产"愿景。`data-*` 约定保住跨 block 链接与完备性规则，不牺牲结构可校验性。注释模式让"选中即优化"成为一等交互，契合 AI 协作范式。

### 4.2 JSON Schema block

**决策（默认，待确认）**：升级 `dataContract`，不加新 block；`entityModel` 编译时派生 schema。

- `dataContract.payload` 从自由字符串升级为：
  ```jsonc
  { "schema": <JSON Schema object>, "format": "json-schema-draft-07" }
  ```
  - 存为解析后的 JSON 对象（非字符串）。
  - 编译时用 JSON Schema meta-schema 校验合法性（不合法 → error 级 diagnostic，阻塞编译，与现有 error 行为一致）。
- 一致性 gap 规则（`gap_rules.rs` 新增 `check_data_contract`）：
  - `schema` 合法 JSON Schema；
  - 有 `type` 或 `$ref`；
  - `type: object` 时有 `properties`。
- `entityModel` payload 不变（typed fields）；**编译时**在 `render_code_gen_prompt` 中从 `entityModel.fields` 派生 JSON Schema（`{ "type": "object", "properties": {...}, "required": [...] }`）注入提示词资产。block 本身不重复维护 schema。

**备选（未选）**：新增独立 `jsonSchema` block。重复 `dataContract` 职责，徒增词汇表。

**理由**：`dataContract` 本就是"schema block"，只是没强制；让它真正解析校验是最小修复。`entityModel` 派生 schema 让代码 agent 拿到机器可消费 schema 又不强迫用户重复维护。

### 4.3 compile 重定向

**决策（默认，待确认）**：并行新增 code-gen 提示词资产，保留 `designerPatch`。

- `compile_document_at` 新增产物 `generated/code-gen-prompt.md`（新渲染器 `render_code_gen_prompt`，见 4.5）。
- `agent-input.json` 增加 `outputContract: "code"` 模式，与现有 `"designerPatch"` 并存。两个 outputContract 对应两条 agent 线（设计补全 vs 代码生成）。
- `export_document` 增加 `codeGenPrompt` 格式（mime `text/markdown`）。
- `designerPatch` 模式与锚定补全 track 原样保留，不破坏。

**备选（未选）**：用 `code` 替换 `designerPatch`。会破坏现有锚定补全回路，风险大。

**理由**：不破坏现有回路；代码生成导向作为一等编译产物，而非 handoff 时才拼的临时 markdown。

### 4.4 完备性规则

**决策（默认，待确认）**：独立软层，不阻塞编译。

- 新增 `layer: "completeness"` gap（区别于现有 `layer: "intra"/"inter"` 一致性 gap）。
  - `severity`: `info` / `warning`（非 `error`）。
  - `fixableByAgent: true`。
  - 不阻塞编译（硬 error 仍阻塞），标记"尚未完整到可准确生成代码"。
- 新模块 `completeness_rules.rs`（`run_completeness(graph)` → 完备性 gap 列表），与 `gap_rules.rs` 的 `run_all` 分离。
- 规则示例（均可判定，无歧义，基于 HTML `data-*` 与 block 间引用）：
  - `orphan-api-contract`：某 `apiContract` block 未被任何 `uiScreen` HTML 的 `data-api` 引用。
  - `orphan-entity`：某 `entityModel` block 未被任何 `apiContract` 端点 shape 或 `uiScreen` HTML 的 `data-entity`/`data-api` 引用。
  - `flow-unverified`（v1 文档级）：文档无任何 `acceptanceCriteria` block。
  - `flow-uncovered-ui`：某 `businessFlow` block 未被任何 `uiScreen` HTML 的 `data-flow` 引用。
  - `no-agent-instruction`：文档无 `agentInstruction` block（沿用现有 warning，迁入完备性层）。
- v1 不做 per-flow 验收匹配（`acceptanceCriteria` 当前为 `{ criteria: string[] }` 平铺列表，无 flow 关联字段）。后续若 `acceptanceCriteria` 增加 `flowRef`，再升级为"每个 businessFlow 有 ≥1 匹配验收项"。

**备选（未选）**：折进现有 `gap_rules.rs` 同层。混淆"内部一致性"与"是否完整到可生成代码"两种语义，且完备性不应阻塞编译。

**理由**：用户强调"准确"，准确性来自完备性而非仅内部一致性。独立软层让 spec 朝 code-gen-ready 成熟，又不被硬错误卡住。

### 4.5 提示词资产结构（`code-gen-prompt.md`）

```
# Software System Implementation Specification
## Role
You are implementing a software system from this specification. Treat it as the source of truth.
## Context
- Module: <document.module>
- Tech stack: <technicalStack payload>
- Conventions: <agentInstruction payload>
## Requirements
### Brief
<text brief markdown>
### Data Schemas
<dataContract.schema JSON Schema> + <entityModel 派生 JSON Schema>
### Business Flows
<businessFlow states/transitions>
### UI
<各 uiScreen 的 HTML（可渲染、可被代码 agent 直接消费）+ data-* 跨 block 链接清单>
## Acceptance Criteria
<acceptanceCriteria>
## Operating Rules
- Treat the spec as the source of truth; do not modify `.gtoffice/docs` requirement files.
- Keep commands and file writes inside the workspace; small verifiable steps.
- Surface unresolved questions before handing over.
## Output Contract
Produce code + report verification evidence + list unresolved questions.
```

渲染器 `render_code_gen_prompt`（新 `code_gen_prompt.rs`）按上述结构拼装，引用所有四柱 block + 验收标准 + 操作规则 + 输出契约。

### 4.6 模块边界（遵循 `CLAUDE.md`）

后端 `apps/desktop-tauri/src-tauri/src/commands/business_designer/`：
- `mod.rs`：`is_supported_block_kind` 加 `uiScreen`（payload 为 HTML 字符串）；升级 `dataContract` payload scaffold（`default_payload_for_kind`）与 `render_block_markdown`；`uiWorkflow` 维持占位符不升级；`preview_agent_task` 等锚定入口对新 block kind 兼容。
- `gap_rules.rs`：新增 `check_ui_screen`（解析 HTML 提取 `data-*` 引用并校验 resolve）/ `check_data_contract` 一致性规则；`derive_edges` 扩展从 HTML `data-*` 提取 UI 相关边。需引入 HTML 解析依赖（默认 `scraper` crate，基于 `html5ever`；记入 `docs/07`）。
- 新 `completeness_rules.rs`：`run_completeness(graph)` + 完备性 gap 类型。
- 新 `code_gen_prompt.rs`：`render_code_gen_prompt`。
- `compile_document_at` / `export_document_at`：增 `code-gen-prompt.md` 产物 + `codeGenPrompt` 格式 + `outputContract: "code"`。

前端 `apps/desktop-web/src/features/business-designer/`：
- `model/designer-blocks.ts`：加 `uiScreen` kind；升级 `uiWorkflow`/`dataContract` payload 类型。
- `model/designer-validation.ts`：加 `completeness` layer 类型与完备性 gap code 常量。
- `model/designer-document-operations.ts`：`AGENT_BLOCK_KINDS` 等集合纳入 `uiScreen`。
- `components/DesignerDocument.tsx` / `DesignerGraphCanvas.tsx` / `DesignerBlockDrillSheet.tsx`：`uiScreen` 用 sandboxed iframe（`srcdoc`）渲染 HTML + 注释层覆盖（选中元素捕获 `outerHTML`+上下文，A 层 hook）；`dataContract` 结构化 schema 编辑器。
- `controllers/useDesignerDocumentState.ts`：validate 结果合并完备性 gap。

## 5. 待确认的决策点

以下 5 个决策已选默认值，等待用户确认或重定向：

| # | 决策 | 默认 | 备选 |
|---|---|---|---|
| 1 | UI block 建模 | HTML 为提示词资产（`uiScreen.html` + `data-*` 跨 block 链接），workbench 渲染 + 注释模式 | 结构化 `components[]` / 完整三件套 |
| 2 | JSON Schema block | 升级 `dataContract`（解析校验）+ `entityModel` 编译时派生 | 新增独立 `jsonSchema` block |
| 3 | compile 重定向 | 并行新增 `code-gen-prompt.md` + `outputContract: "code"`，保留 `designerPatch` | 用 `code` 替换 `designerPatch` |
| 4 | 完备性规则 | 独立软层 `layer: "completeness"`，不阻塞编译 | 折进现有 `gap_rules.rs` 同层 |
| 5 | entityModel→schema | 编译时派生注入提示词 | 强制显式 `dataContract` |

## 6. 测试策略

- `gap_rules_tests.rs`：新增 UI/schema 一致性规则用例（HTML 不可解析、`data-*` 引用不存在、`dataContract` 非法 schema 等）。
- 新 `completeness_rules_tests.rs`：完备性规则用例（孤儿 apiContract/entity、流程未验收、流程未被 UI 覆盖等）。
- `mod_tests.rs`：`compile_document_at` 产出 `code-gen-prompt.md` 的快照断言；`outputContract: "code"` 模式；`export_document` 的 `codeGenPrompt` 格式；`uiScreen` HTML 渲染产物（`preview.html` 含 iframe srcdoc）。
- 手工验证：从"订单系统"brief 出发，补全四柱（含 `uiScreen` HTML + `data-*` 链接），编译产出 `code-gen-prompt.md`，人工检视结构完整、可被代码 agent 消费；workbench 渲染 HTML 预览 + 注释模式选中元素。

## 7. 文档同步

A 落地时需同步：
- `docs/BUSINESS_DESIGNER_MODULE_DESIGN.md`：§5 block 词汇表加 `uiScreen`（HTML payload + `data-*` 约定）、升级 `dataContract`（`uiWorkflow` 维持占位符）；§6 gap 规则加 UI（HTML 解析 + `data-*` 校验）/schema 一致性 + 完备性层；§8.2 命令表更新 compile/export 产物；附录 A 补 A 进度。
- `docs/07_依赖选型与精简清单.md`：记录 HTML 解析依赖（`scraper`，基于 `html5ever`）用途、备选（`kuchiki`/regex）、影响范围。
- `docs/API_CONTRACTS.md`：补全 `business_designer.*` 命令面（当前完全缺失）。
- `docs/ARCHITECTURE.md`：§2 feature 列表与 §8 feature↔command 对齐表补 `business-designer`。
- 新增 ADR：v1.1 产物层决策（HTML 为 UI 提示词资产 + `data-*` 跨 block 链接、JSON Schema 校验、compile 双 outputContract、完备性软层）——补 ADR 0001–0017 只覆盖锚定补全的空缺。

## 8. 风险与未决

- **HTML 保真度与 `data-*` 约定遵守**：HTML 承载 UI 表达力强，但 AI 生成 HTML 质量参差（样式、响应式、可访问性），注释模式 + 优化回路可迭代改善。`data-*` 约定是跨 block 链接的唯一桥梁——若 AI 生成 HTML 时不遵守约定，完备性规则失准；需在 designer agent 的 CLAUDE.md（B 层）与 code-gen 提示词资产中明确约定并示例。apiContract 端点级绑定（`data-api="id:METHOD path"`）已支持，AI 是否准确填写端点级引用需观察。
- **完备性规则的 v1 限制**：`flow-unverified` v1 只做文档级（有无 acceptanceCriteria block），无法校验"每个流程是否被验收"。需 `acceptanceCriteria` 加 `flowRef` 才能升级——已记为 v1 之后的演进项，不在 A 范围。
- **`entityModel` 派生 schema 的保真度**：派生 JSON Schema 丢失了 `description` 之外的语义（如约束、索引）。若代码 agent 需要这些，可能仍需显式 `dataContract`。默认派生 + 可选显式覆盖是折中。
- **`outputContract` 双模式的维护成本**：`designerPatch` 与 `code` 并存意味着 compile 路径分叉，需注意共享渲染逻辑（README/contracts/acceptance 等共用）。
- **手动反馈回路的负担**：v1 不自动回写代码生成反馈到 spec，用户需把 station agent 的问题手动中继回 designer（通过 B 对话或直接编辑）。若实践中反馈频繁到成为负担，应优先评估自动化回路（届时再立子项目）。
- **station 消费的资产发现**：A 产出 `code-gen-prompt.md` 在文档 `generated/` 目录，用户手动交给 station 时需知道路径。若 `dispatch_coding_handoff` UI 后补，可消除该路径发现负担——属 B 或后续小改，不在 A 范围。
