# 业务设计器模块方案

**日期**：2026-06-10  
**状态**：方案草案，暂不进入编码实现  
**范围**：为 GT Office 新增“业务设计器”功能，用于可视化需求设计、Agent 辅助补全、生成适合 AI Coding Agent 使用的专业需求文档，并通过本地 Git 管理需求变更历史。

## 1. 目标

业务设计器的目标是把模糊的业务想法，逐步整理成结构化、可审阅、可版本对比，并且能直接交给 Codex、Claude Code 等 Coding Agent 执行的需求包。

它不是一个普通 Markdown 编辑器，也不是让用户直接写 HTML 或 JSON。用户看到的是可视化工作台：文本块、业务流程、实体字段、伪代码、面向对象设计、API 契约、技术栈、验收标准、开放问题、Agent 指令等内容都以结构化模块呈现。系统在后台把这些模块编译为 Markdown、HTML 和 JSON，让人能读、Agent 也能稳定消费。

典型流程：

1. 用户从左侧侧栏进入 `业务设计器`。
2. 用户在 `.gtoffice/docs` 下创建一个需求包，例如 `order-system`。
3. 用户在实体模块里输入 `订单`。
4. 用户点击 `让 Agent 补全`。
5. GT Office 按固定 JSON 输出协议，把上下文发送给用户选择的 Codex 或 Claude Code 会话。
6. Agent 返回字段、状态流转、校验规则、API、事件、测试点和开放问题。
7. 用户在可视化 diff 中逐项接受或拒绝 Agent 的建议。
8. 用户确认后，系统编译输出需求文档，并在 `.gtoffice/docs/.git` 中创建一次需求 checkpoint。
9. 后续 Coding Agent 可基于这份需求包开始编码，而不是基于一段模糊口头描述行动。

## 2. 产品原则

- **可视化优先，源码可携带**：用户主要编辑块、表格、流程和表单；落盘文件仍是 Markdown、HTML、JSON 等通用格式。
- **默认面向 Agent 可读**：每个设计块都能编译为确定性的 JSON schema 和 Agent brief。
- **Agent 不直接改需求**：Agent 只能返回建议补丁，必须由用户审阅后应用。
- **工作区内闭环**：所有文件默认放在当前 workspace 的 `.gtoffice/docs` 下。
- **需求可版本化**：每次用户确认的重要改动都可形成本地 Git checkpoint，便于对比历史。
- **模块化而不是一份巨型文档**：需求按业务模块拆分，通过统一 manifest 串联。
- **不为了方便新增依赖**：第一版优先使用现有技术栈和依赖；确实需要新依赖时，先更新 `docs/DEPENDENCIES.md` 并说明取舍。

## 3. 与当前架构的关系

当前项目是 Tauri v2 + React/TypeScript + Rust crates。`$native-feel-cross-platform-desktop` skill 推荐的完整四层原生架构，不作为这个功能的一次性重写目标。本方案采用其中的原则，但实现必须服从当前仓库边界。

相关原则：

- `T1 - Place the seam at the rendering surface`：可视化编辑留在 React WebView；文件系统、Git、Agent 进程控制、路径安全和系统能力留在 Tauri/Rust。代价是没有完全自研 Swift/WPF shell 的控制力，但能保持当前项目速度和边界稳定。
- `T2 - One schema, many languages`：前端、后端、落盘 JSON、Agent patch 共享一套文档/块 schema。代价是前期需要更严格地定义数据结构。
- `T3 - Adopt the platform; don't compete with it`：UI 使用系统字体、系统滚动、Tauri 原生对话框、现有窗口行为，不做网页式炫技。代价是品牌视觉更克制。
- `T4 - Performance is a property of perception`：优先保证输入、选中块、切换视图、预览和 checkpoint 的主观速度，而不是追求抽象性能指标。
- `T6 - Cross boundaries intentionally`：autosave、compile、Git checkpoint、Agent completion 都必须批处理、可追踪、可取消，避免 React effect 高频跨 IPC 调用。

## 4. 用户体验设计

### 4.1 侧栏入口

新增侧栏菜单：

- 中文名称：`业务设计器`
- 英文名称：`Designer`
- 建议 ID：`designer`
- 建议位置：放在 `文件管理` 之后、`Git 协作` 之前。原因是它产出需求文件，并且通常发生在编码和 Git 审阅之前。

建议前后端目录：

```text
apps/desktop-web/src/features/business-designer/
apps/desktop-tauri/src-tauri/src/commands/business_designer/
crates/gt-business-designer/       # 后端逻辑稳定后再沉淀
```

后端 command 入口只做绑定和参数校验。文档解析、编译、路径校验、Git checkpoint、Agent patch 校验等逻辑不能堆在 command 根目录。

### 4.2 主界面布局

业务设计器应该像一个原生生产力工具，而不是网页 CMS 或营销页。

```text
┌──────────────────────────────────────────────────────────────┐
│ 顶部控制栏 / workspace tabs                                   │
├──────┬────────────────┬─────────────────────────┬────────────┤
│ 侧栏 │ 文档列表/大纲   │ 可视化设计画布            │ 属性/Agent │
│      │ 模块树/最近文档 │ 块、流程、表格、契约       │ 审阅面板    │
├──────┴────────────────┴─────────────────────────┴────────────┤
│ 版本条：保存状态、checkpoint、diff、导出、校验状态             │
└──────────────────────────────────────────────────────────────┘
```

左侧面板：

- 展示 `.gtoffice/docs` 下的需求文档库。
- 展示业务模块树、最近编辑文档、当前文档大纲。
- 展示状态徽章：草稿、可交给 Agent、缺少契约、有开放问题等。

中间画布：

- 以块为单位编辑需求。
- 支持文本、实体模型、流程泳道、规则表、伪代码、API 契约、UI 流程、测试用例、决策记录等。
- 顶部提供模式切换：`设计`、`流程`、`契约`、`Agent Brief`、`预览`。
- 源码视图可以提供给高级用户，但不能成为主体验。

右侧检查器：

- 展示当前选中块的属性。
- 展示 Agent 操作面板。
- 支持选择补全模式：实体补全、流程扩展、API 生成、测试生成、风险审查、编码简报生成。
- 支持选择 Agent provider：Codex、Claude Code，未来可扩展到其他 Agent。
- 展示即将发送给 Agent 的上下文、输出 schema、置信度和开放问题。

底部版本条：

- 显示最近保存时间。
- 显示当前 docs repo 的分支/checkpoint。
- 显示相对上次 checkpoint 的 diff 状态。
- 显示校验状态。
- 提供导出 Markdown、HTML、JSON、Agent bundle 的入口。

### 4.3 原生桌面 UI 风格

按 `$native-feel-cross-platform-desktop` 的规则约束：

- 使用系统字体：macOS 使用 `-apple-system` / `BlinkMacSystemFont`，Windows 使用 `Segoe UI Variable` / `Segoe UI`。
- 列表行、大纲行、侧栏项不要使用 `cursor: pointer`，避免网页感。
- 使用紧凑 source list、分栏、工具栏图标按钮，不做卡片堆叠式 SaaS 页面。
- 导入、导出、选择目录使用 Tauri 原生对话框。
- 跟随系统深色/浅色模式和 accent color，不硬编码大面积紫色、蓝紫色、米色或深蓝主题。
- 主视图切换不做网页式 route fade，动画应短、轻、功能性明确。
- 支持完整键盘操作：文档切换、块移动、搜索、Agent 命令、接受/拒绝 patch。
- 导出不模拟浏览器下载条，使用原生 save panel。
- 空状态保持克制：一个图标、一句话、一个主操作。
- 危险操作必须显示明确影响范围，例如会影响哪个文档、哪个 checkpoint、哪个路径。

`ui-ux-pro-max` 查询给出的方向是专业、信息密度高、实时协作型企业工具。落到 GT Office 中，应转化为 Apple 风格 split-view 工作台：密度适中、层级清晰、focus ring 明确、颜色来自 token，不使用装饰性渐变和大 hero。

## 5. 核心功能

### 5.1 文档库

- 从模板创建需求包：
  - 产品需求
  - 业务模块
  - 领域模型
  - API 契约
  - Agent 编码简报
  - 现有代码分析简报
- 浏览 `.gtoffice/docs` 下的结构化文档。
- 支持置顶关键需求包。
- 支持搜索标题、标签、实体、API、决策记录和生成的 JSON。
- 展示每个需求包是否已经足够交给 Agent 编码。

### 5.2 可视化需求块

第一版建议支持以下块类型：

| 块类型 | 用途 | 对 Agent 的价值 |
|---|---|---|
| 文本段落 | 目标、背景、约束 | 提供自然语言意图 |
| 业务词汇表 | 术语、同义词、禁用词 | 避免命名漂移 |
| 实体模型 | 字段、类型、是否必填、示例、校验 | 生成类型、schema、迁移 |
| 业务流程 | 状态、泳道、触发器、异常路径 | 生成 workflow 和测试 |
| 规则表 | 条件、动作、优先级 | 生成确定性分支逻辑 |
| 伪代码 | 算法轮廓 | 指导实现但不绑定语言 |
| 对象模型 | 类、接口、服务、聚合根 | 指导模块边界 |
| API 契约 | 请求、响应、错误、权限、事件 | 指导前后端契约 |
| 数据契约 | JSON schema、数据库提示、索引 | 指导持久化设计 |
| UI 流程 | 页面、用户动作、加载和错误状态 | 指导前端实现 |
| 技术栈 | runtime、库、限制、禁用依赖 | 防止 Agent 自行发散 |
| 非功能需求 | 性能、可靠性、可访问性、安全 | 明确质量门槛 |
| 验收标准 | Given/When/Then、手工验证 | 驱动测试和验收 |
| 开放问题 | 未决业务点 | 防止 Agent 假装确定 |
| Agent 指令 | provider 相关执行说明 | 控制 Codex/Claude handoff |
| 决策记录 | ADR 式选择和取舍 | 保留设计原因 |

后续可扩展：

- 事件风暴视图。
- 权限矩阵。
- 数据流向图。
- 错误码体系。
- 可观测性计划。
- 迁移计划。
- 灰度和回滚计划。
- 风险清单。
- 测试矩阵。
- 可追溯矩阵：目标 -> 需求 -> 契约 -> 任务 -> 改动文件。

### 5.3 Agent 辅助补全

Agent 操作应该是上下文动作，而不是一个泛泛的“问 AI”输入框。

建议动作：

- 根据短词补全实体字段，例如用户输入 `订单`。
- 根据用户故事扩展业务流程。
- 根据实体生命周期生成状态机。
- 根据流程和实体生成 API 契约。
- 根据实体模型生成 JSON schema。
- 生成验收标准。
- 审查需求歧义。
- 找缺失的边界情况。
- 把需求包转换成 Agent 编码简报。
- 把大模块拆成小的编码任务。
- 在业务规则不明确时生成“需要人确认的问题”，而不是硬猜。

Agent 输出必须是 typed patch，例如：

```json
{
  "schemaVersion": 1,
  "documentId": "order-system",
  "baseRevision": "rev_20260610_001",
  "summary": "补全订单实体和生命周期",
  "changes": [
    {
      "op": "addBlock",
      "afterBlockId": "entity-order",
      "block": {
        "id": "entity-order-fields",
        "kind": "entityModel",
        "title": "订单字段",
        "payload": {
          "entityName": "Order",
          "fields": [
            { "name": "id", "type": "string", "required": true, "description": "订单唯一标识" },
            { "name": "customerId", "type": "string", "required": true, "description": "下单客户" },
            { "name": "status", "type": "enum", "required": true, "values": ["draft", "submitted", "paid", "fulfilled", "cancelled"] }
          ]
        }
      }
    }
  ],
  "openQuestions": [
    "订单是否需要支持部分退款？",
    "订单号是否由外部支付系统生成？"
  ]
}
```

UI 必须把 patch 渲染成可视化 diff，并提供逐块接受/拒绝。

### 5.4 专业输出包

每个需求包应能编译出：

- `README.md`：面向人的需求概览。
- `agent-brief.md`：给 Coding Agent 的简洁执行说明。
- `requirements.md`：产品和业务需求。
- `domain.md`：词汇表、实体、生命周期、业务规则。
- `flows.md`：业务流程和异常路径。
- `contracts.md`：API、事件、JSON schema、错误码。
- `architecture.md`：模块边界、技术栈、依赖约束。
- `acceptance.md`：验收标准、测试矩阵、验证路径。
- `open-questions.md`：未决问题。
- `design.json`：完整机器可读块图。
- `agent-input.json`：紧凑、校验后的 Agent 输入 JSON。
- `preview.html`：GT Office 生成的本地可视化预览。

生成文件必须稳定、确定，避免 Git diff 每次出现无意义变动。

### 5.5 本地需求 Git 历史

业务设计器应在以下目录初始化并管理一个独立本地 Git 仓库：

```text
<workspace>/.gtoffice/docs/.git
```

规则：

- 第一次进入业务设计器或第一次创建文档时初始化。
- 只跟踪 `.gtoffice/docs` 下的文件。
- 默认不配置 remote。
- 不存储 credentials、provider secrets、原始终端日志。
- 不在每次键入时自动 commit，只在用户确认 checkpoint 时提交。
- 建议 commit message：

```text
designer: checkpoint <document-title> <short-revision>
```

支持对比：

- 当前视觉状态 vs 上次 checkpoint。
- checkpoint vs checkpoint。
- Agent patch vs 当前视觉状态。
- 新旧 Agent brief 对比。

如果 workspace 本身已经是 Git 仓库，`.gtoffice/docs` 仍然是独立嵌套仓库。UI 必须明确提示，避免用户把“需求历史”和“源码历史”混淆。

## 6. 存储模型

### 6.1 目录结构

```text
.gtoffice/
└── docs/
    ├── .git/
    ├── index.json
    ├── templates/
    │   ├── product-requirement.template.json
    │   └── agent-brief.template.json
    └── documents/
        └── order-system/
            ├── manifest.json
            ├── README.md
            ├── design.json
            ├── blocks/
            │   ├── 001-overview.json
            │   ├── 010-domain-order.json
            │   ├── 020-flow-order-submit.json
            │   └── 090-agent-instructions.json
            ├── generated/
            │   ├── agent-brief.md
            │   ├── agent-input.json
            │   ├── contracts.md
            │   └── preview.html
            └── patches/
                └── agent-patch-20260610-001.json
```

### 6.2 标准源文件

采用混合模型：

- `manifest.json` 是需求包入口。
- `design.json` 是完整标准块图，便于可靠解析。
- `blocks/*.json` 支持局部加载和更小 diff。
- 生成的 `.md` 和 `.html` 是可携带输出，不是唯一真相来源。

这样既满足用户能导出、阅读 Markdown/HTML，也保证应用能安全进行可视化编辑，而不是靠脆弱的 Markdown 解析反推结构。

### 6.3 manifest 示例

```json
{
  "schemaVersion": 1,
  "documentId": "order-system",
  "title": "订单系统需求设计",
  "module": "commerce",
  "createdAt": "2026-06-10T00:00:00.000Z",
  "updatedAt": "2026-06-10T00:00:00.000Z",
  "entry": "design.json",
  "generated": {
    "readme": "README.md",
    "agentBrief": "generated/agent-brief.md",
    "agentInput": "generated/agent-input.json",
    "previewHtml": "generated/preview.html"
  },
  "tags": ["order", "commerce"],
  "status": "draft"
}
```

### 6.4 块 schema 草案

```ts
type DesignerBlockKind =
  | 'text'
  | 'glossary'
  | 'entityModel'
  | 'businessFlow'
  | 'ruleTable'
  | 'pseudocode'
  | 'objectModel'
  | 'apiContract'
  | 'dataContract'
  | 'uiWorkflow'
  | 'technicalStack'
  | 'nonFunctional'
  | 'acceptanceCriteria'
  | 'openQuestions'
  | 'agentInstruction'
  | 'decisionRecord'

interface DesignerBlock<TPayload = unknown> {
  id: string
  kind: DesignerBlockKind
  title: string
  order: number
  payload: TPayload
  links: Array<{ targetBlockId: string; relation: string }>
  validation: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string }>
  updatedAt: string
}
```

## 7. 后端与 API 设计

所有命令都必须携带 `workspaceId`。

### 7.1 Tauri commands

| Command | 用途 |
|---|---|
| `business_designer.list_documents` | 列出 `.gtoffice/docs/documents` 下的需求包 |
| `business_designer.create_document` | 创建 manifest、标准块图和初始 checkpoint |
| `business_designer.read_document` | 读取 manifest 和指定 blocks |
| `business_designer.save_document` | 原子保存变更 blocks |
| `business_designer.compile_document` | 生成 Markdown、HTML、JSON |
| `business_designer.validate_document` | 返回 schema、完整性、Agent 可读性诊断 |
| `business_designer.init_docs_repo` | 初始化 `.gtoffice/docs/.git` |
| `business_designer.create_checkpoint` | 用用户可见 message 提交当前 docs 状态 |
| `business_designer.diff_checkpoint` | 返回 checkpoint 或 working tree 的结构化 diff |
| `business_designer.preview_agent_task` | 调度前生成 prompt 和 JSON 合约预览 |
| `business_designer.run_agent_completion` | 把补全任务发送给选中的 provider/session |
| `business_designer.apply_agent_patch` | 校验并应用用户接受的 patch 操作 |
| `business_designer.export_document` | 通过原生 save flow 导出指定文件 |

### 7.2 Events

| Event | Payload | 触发时机 |
|---|---|---|
| `business-designer/document-changed` | `{ workspaceId, documentId, revision }` | 保存或外部文件变化 |
| `business-designer/validation-updated` | `{ workspaceId, documentId, diagnostics }` | 校验完成 |
| `business-designer/agent-progress` | `{ workspaceId, requestId, stage, detail }` | Agent 补全过程推进 |
| `business-designer/agent-patch-ready` | `{ workspaceId, requestId, patchPath }` | patch 已写入待审阅 |
| `business-designer/checkpoint-created` | `{ workspaceId, documentId, commit }` | docs repo commit 完成 |

### 7.3 Rust 模块边界

MVP 可先在 `apps/desktop-tauri/src-tauri/src/commands/business_designer/` 下放一个小 service。逻辑稳定后，沉淀为 `crates/gt-business-designer`。

建议 crate 职责：

- 解析 `.gtoffice/docs` 下路径。
- 校验 manifest 和 block schema。
- 原子读写文档。
- 将 block graph 稳定编译为 Markdown/HTML/JSON。
- 管理 docs repo 的 Git checkpoint。
- 校验 Agent patch。
- 提供样例文档 fixture 和测试。

不要把 UI 渲染细节放进 Rust crate。Rust 负责语义输出，前端负责视觉呈现。

### 7.4 前端模块边界

```text
features/business-designer/
├── BusinessDesignerPane.tsx
├── BusinessDesignerPane.scss
├── components/
│   ├── DesignerDocumentList.tsx
│   ├── DesignerOutline.tsx
│   ├── DesignerCanvas.tsx
│   ├── DesignerInspector.tsx
│   ├── DesignerAgentPanel.tsx
│   ├── DesignerPatchReview.tsx
│   └── DesignerVersionStrip.tsx
├── controllers/
│   ├── useDesignerDocuments.ts
│   ├── useDesignerDocumentState.ts
│   ├── useDesignerAgentCompletion.ts
│   ├── useDesignerValidation.ts
│   └── useDesignerVersioning.ts
├── model/
│   ├── designer-blocks.ts
│   ├── designer-document.ts
│   ├── designer-patch.ts
│   └── designer-validation.ts
└── index.ts
```

Shell 层只做最小改动：

- `NavItemId` 增加 `designer`。
- 增加 i18n 文案。
- 增加图标映射。
- 主区域渲染 `BusinessDesignerPane`。
- 如需要，左侧面板接入文档列表和大纲。

## 8. Agent 协作模型

### 8.1 Provider 选择

第一版支持现有 session provider：

- `codex`
- `claude`

UI 不应假设它们是 API chat model，而应视为 GT Office 已管理的本地 Coding Agent 会话。这与当前 `SessionProvider = 'claude' | 'codex'` 保持一致。

### 8.2 请求生命周期

```text
preview -> validate -> confirm -> dispatch -> receive patch -> validate patch -> review -> apply -> compile -> checkpoint
```

这与项目现有 AI 配置的安全流程一致：先预览、校验、确认，再应用，并留审计痕迹。

### 8.3 Agent prompt 合约

每次 Agent 任务必须包含：

- workspace ID。
- 文档路径。
- 被选中的 block IDs。
- 当前 schema version。
- 允许的输出 JSON schema。
- 明确要求只返回 JSON patch。
- 开放问题策略：核心业务规则不清楚时，提出问题，不要编造。
- 文件变更策略：Agent 只提议，GT Office 负责应用用户接受的 patch。

### 8.4 Agent 输出校验

校验步骤：

1. 解析 JSON。
2. 检查 schema version。
3. 检查 base revision。
4. 检查所有引用的 block ID 是否存在，或是否声明为新 block。
5. 拒绝未知 block kind。
6. 按 block kind 校验 payload。
7. 对破坏性替换要求用户明确确认。
8. 原始 patch 保存到 `.gtoffice/docs/documents/<id>/patches/`。
9. 渲染可视化 diff。

Agent 输出无效时，应展示错误或发起修复请求，不能静默进行“尽力而为”的部分应用。

## 9. 可靠性

- **原子写入**：先写 `.gtoffice/docs` 内的临时文件，必要时 fsync，再 rename。
- **路径安全**：所有路径必须同时限制在 workspace root 和 `.gtoffice/docs` 内。
- **schema 迁移**：所有文档带 `schemaVersion`；未来不兼容版本先进入只读模式。
- **Autosave**：视觉编辑可以 debounce 保存，但不能每次 autosave 都生成 Git commit。
- **崩溃恢复**：保存未提交草稿状态，重启后与标准文件对比。
- **Git 错误处理**：缺少 git binary、repo lock、嵌套 repo 混淆等都要给出可操作提示。
- **Agent 超时**：支持取消，并保存 request 状态。
- **Patch 幂等**：拒绝的 patch 仍归档；接受的 patch 记录 applied revision。
- **Tracing**：后端命令带 traceId；Agent task 带 request ID 和 document ID。
- **可 mock**：filesystem、Git、Agent dispatch 都应可替换，方便测试。
- **HTML 安全**：生成 HTML 来自内部 renderer；导入 HTML 第一版应只作为源码查看，除非实现保守 allowlist sanitize。

## 10. 性能

用户感知目标：

- 点击 `业务设计器` 后，缓存数据返回后 200ms 内出现文档列表。
- 文本类块输入时不能每个 keystroke 调 Tauri。
- 选中块、切换块、展开大纲应即时。
- 常规文档的 Agent 任务预览应在 500ms 内完成。
- 编译应尽量增量执行，不能阻塞热输入路径。

实现策略：

- 源码预览、Monaco 等重组件懒加载。
- 长文档块列表和文档库使用已有 `@tanstack/react-virtual` 虚拟化。
- blocks 分文件存储，支持局部读取和较小 diff。
- 保存操作批处理。
- Markdown/HTML 输出保持稳定，避免无意义 diff。
- 避免 React effect 形成 IPC 热循环。
- 校验结果按 document revision 缓存。
- 文档变大后，compile/diff 可放到 Rust 后台任务。

## 11. 安全与隐私

- `.gtoffice/docs` 不得存放 API key、provider secret。
- Agent prompt 默认只包含当前选中文档上下文，除非用户主动扩大范围。
- 发送给 Agent 前，UI 必须展示将发送的上下文。
- 导出的 Agent bundle 应可检查。
- Agent session 的自定义 cwd 必须仍在 workspace 内。
- HTML preview 不允许执行任意脚本。
- 文档支持 redaction 标记，便于导出时隐藏敏感业务词。

## 12. 技术栈

优先使用当前已批准技术栈：

- 前端：React 19、TypeScript、SCSS、现有 shell layout、现有 design tokens。
- 编辑面：源码预览使用现有 Monaco；可视化模式使用自研 React block editor。
- Markdown：现有 `react-markdown`、`remark-gfm`、`rehype-highlight`。
- JSON/schema：`packages/shared-types` 中定义 TypeScript 类型，Rust 侧用 serde struct 对齐。
- 后端：Tauri v2 commands、Rust service module，未来沉淀为 `gt-business-designer` crate。
- 文件系统：沿用 workspace-scoped file API 和 Rust path validation。
- Git：沿用 `gt-git` 模式或在 `.gtoffice/docs` 范围内调用 git CLI。
- Agent 调度：复用现有 terminal/session/task 基础设施，支持 `codex` 和 `claude`。
- 样式：只使用 SCSS，不新增原始 CSS 文件。
- 图标：复用 `lucide-react` 和项目已有 icon wrapper。

第一版不要新增图形编辑器、流程图库或复杂富文本依赖。流程可以先用结构化表单、SVG 连线、泳道/表格视图实现。未来若确实需要第三方 diagram 库，必须先在 `docs/DEPENDENCIES.md` 记录用途、备选方案和影响范围。

## 13. 实现路径

### Phase 0 - 方案确认

- 评审本文档。
- 确定文档 schema 命名和第一批模板。
- 确认 `.gtoffice/docs/.git` 是首次进入自动初始化，还是用户确认后初始化。
- 确认第一批模板：`业务模块`、`Agent Brief`、`API 契约`。

### Phase 1 - 只读原型

- 新增侧栏入口和空的业务设计器 shell。
- 列出 `.gtoffice/docs/documents`。
- 加载一个样例需求包。
- 渲染 block 大纲和只读画布。
- 展示 schema 校验诊断。

验证：

- `npm run typecheck`
- 手工验证打开、切换 nav、切换 workspace 不异常。

### Phase 2 - 可编辑块和编译

- 支持创建/保存需求包。
- 实现核心块类型：文本、实体模型、业务流程、API 契约、验收标准、Agent 指令。
- 编译生成 Markdown 和 `agent-input.json`。
- 增加源码预览。

验证：

- schema validation 和 compiler 单元测试。
- `npm run typecheck`
- `cargo check --workspace`

### Phase 3 - 本地 docs Git

- 初始化 `.gtoffice/docs/.git`。
- 创建 checkpoint。
- 展示当前状态与上次 checkpoint 的 diff。
- 支持历史 checkpoint 列表。

验证：

- Rust 临时 workspace 测试。
- 手工验证 workspace 已是 Git 仓库时的嵌套 repo 场景。

### Phase 4 - Agent 补全

- 增加 provider 选择。
- 生成 task preview。
- 向 Codex/Claude session 发送补全请求。
- 校验返回 patch。
- 渲染可视化 patch review。
- 应用用户选择的变更。
- 编译并在用户确认后 checkpoint。

验证：

- Mock agent 返回合法 patch。
- Mock agent 返回非法 JSON。
- Mock agent 返回过期 base revision。
- 手工用 Codex 和 Claude Code session 跑通一次。

### Phase 5 - 专业输出和编码 handoff

- 增加完整 Agent bundle 导出。
- 增加可追溯矩阵。
- 增加面向 Coding Agent 的任务拆分。
- 接入 Task Center，实现“把该需求发送给 Agent 编码”。

验证：

- 生成的需求包可以被 Coding Agent 在无额外口头补充的情况下使用。
- 用户可以对比 Agent 补全前后的需求 checkpoint。

## 14. 初始模板

### 14.1 业务模块模板

章节：

1. 目标和范围。
2. 参与者和角色。
3. 业务词汇表。
4. 实体模型。
5. 业务生命周期。
6. 业务规则。
7. 用户流程。
8. API / 事件。
9. 数据持久化说明。
10. 边界情况和异常路径。
11. 非功能需求。
12. 验收标准。
13. Agent 编码简报。
14. 开放问题。

### 14.2 Agent 编码简报模板

章节：

1. 目标模块。
2. 可能影响的文件。
3. 现有架构约束。
4. 必须实现的行为。
5. API 契约。
6. 数据契约。
7. UI 预期。
8. 需要新增或运行的测试。
9. 禁止的捷径。
10. 完成检查清单。

### 14.3 API 契约模板

章节：

1. Endpoint / command / event 名称。
2. 请求字段。
3. 响应字段。
4. 错误码。
5. 权限和安全约束。
6. 幂等性。
7. 可观测性。
8. 示例请求和响应。
9. 验收测试。

## 15. 示例：输入 `订单`

用户输入：

```text
订单
```

Agent 应补全：

- 实体：`Order`。
- 字段：id、orderNo、customerId、status、currency、subtotal、discountTotal、taxTotal、grandTotal、paymentStatus、fulfillmentStatus、createdAt、updatedAt、cancelledAt。
- 枚举：订单状态、支付状态、履约状态。
- 校验：金额不能为负，`grandTotal = subtotal - discountTotal + taxTotal`，取消规则。
- 流程：draft -> submitted -> paid -> fulfilled，另有 cancelled/refunded 异常路径。
- API：create order、submit order、cancel order、get order、list orders。
- 事件：order.created、order.submitted、order.paid、order.cancelled。
- 验收标准：创建订单、提交订单、支付订单、取消限制、非法金额拒绝。
- 开放问题：是否支持部分退款、是否需要库存预占、订单号由谁生成、是否需要发票。

## 16. 待确认决策

1. `.gtoffice/docs/.git` 是自动初始化，还是用户首次确认后初始化？
2. 第一版是否支持导入 HTML，还是只支持生成 HTML preview？
3. document ID 使用用户可读 slug，还是 UUID + slug alias？
4. Agent 补全使用新 terminal session，还是复用用户选择的 station/session？
5. 业务设计器未来是否需要独立 detached window？
6. `.gtoffice/docs` 是否默认加入 workspace 源码 Git 的 ignore，还是交给用户决定？

## 17. 成功标准

功能成功的标准：

- 用户能把一句简短业务想法整理为结构化需求包，而不需要手写原始 Markdown。
- 需求包能稳定编译出 Markdown、HTML preview 和 Agent-ready JSON。
- 用户可选择 Codex 或 Claude Code session，让 Agent 返回结构化补全建议。
- 用户能审阅并选择性应用 Agent patch。
- 需求变更会在 `.gtoffice/docs/.git` 中形成 checkpoint，并且可视化对比。
- 生成的 Agent brief 包含领域模型、业务流程、契约、测试、约束和开放问题，能显著减少 Coding Agent 的歧义。
- 实现不破坏 GT Office 现有模块边界，并保持原生桌面应用体验。

## 18. 开发进度记录

### 2026-06-11 Phase 1 底座

已完成：

- 新增业务设计器侧栏入口 `designer`，位置在文件管理之后、Git 协作之前。
- 新增 `apps/desktop-web/src/features/business-designer/` 前端 feature 骨架，包含文档库、块大纲、只读画布、检查器、Agent 面板、Patch 审阅占位和底部版本条。
- 新增 `apps/desktop-tauri/src-tauri/src/commands/business_designer/` 后端命令底座，提供 `business_designer_list_documents` 和 `business_designer_init_docs_repo`。
- `business_designer_init_docs_repo` 会在 workspace 内创建 `.gtoffice/docs`、`documents/`、`templates/`、`index.json` 和第一批模板，并初始化独立 docs Git 仓库。
- `business_designer_list_documents` 会列出 `.gtoffice/docs/documents/*/manifest.json`，返回文档摘要、块数量、诊断和 docs repo 初始化状态。
- 增加 Rust 单元测试覆盖未初始化文档库、脚手架初始化、manifest 摘要读取和 manifest JSON 诊断。
- 前端通过 `desktopApi` 使用 typed contract 访问后端，避免组件直接拼 Tauri invoke。

刻意未做：

- 未实现创建/保存需求包。
- 未实现 block 编辑器、编译器、源码预览。
- 未实现 checkpoint commit、diff、历史列表。
- 未实现 Agent prompt preview、任务派发、patch 校验和可视化审阅应用。

明日继续建议：

1. 实现 `create_document`，生成 `manifest.json`、`design.json`、初始 blocks 和 README。
2. 实现 `read_document`，让只读画布渲染真实 block graph。
3. 增加 schema validation 单元测试，并把核心 TypeScript schema 同步到 Rust serde struct。
4. 进入 Phase 2 前确认首次进入是否自动初始化 docs repo，还是必须用户点击初始化。

### 2026-06-14 Phase 2/3 可编辑底座

已完成：

- 扩展 `business_designer` Tauri command：新增 `create_document`、`read_document`、`save_document`、`validate_document`、`compile_document`、`create_checkpoint`、`diff_checkpoint`、`preview_agent_task`。
- Rust 侧新增结构化 manifest、design graph、block、generated paths、compile/checkpoint/diff 返回类型，command 入口只做 workspace 参数、状态装配和序列化。
- 新增文档落盘约定：`.gtoffice/docs/documents/<documentId>/manifest.json`、`design.json`、`blocks/*.json`、`generated/*`、`patches/`。
- 新增编译器底座，生成 `README.md`、`generated/agent-brief.md`、`generated/agent-input.json`、`generated/preview.html`、`generated/contracts.md`、`generated/acceptance.md`。
- 新增 schema 校验：schema version、document id 一致性、block id 唯一性、block kind、payload 对象、验收标准和 Agent 指令完整性。
- 新增 docs repo Git checkpoint 与 working tree diff，checkpoint 使用 `.gtoffice/docs/.git`，不影响 workspace 主 Git。
- 前端 Business Designer 从只读原型升级为可编辑工作台：支持初始化 docs repo、创建需求包、选择文档、读取详情、编辑 block title/payload、保存、校验、编译、checkpoint、diff refresh、Agent task preview。
- 前端新增 feature 内 API adapter，兼容新旧命名的 coarse IPC 方法，不让组件直接拼 Tauri invoke。
- 使用 `$ui-ux-pro-max` 做 UI/UX 收口，并按 `$native-feel-cross-platform-desktop` 覆盖网页化建议：保留系统字体、split-view 信息密度、键盘焦点、pressed state、深浅色 token，不添加 `cursor:pointer`。
- 新增 Rust 单元测试覆盖 scaffold/list/create/read/save/compile/checkpoint/diff。

仍未完成：

- `run_agent_completion`、`apply_agent_patch`、`export_document` 仍是明确错误的 stub，等待 Phase 4/5 接入真实 Agent 任务、patch 校验与导出。
- 历史 checkpoint 列表和 checkpoint-to-checkpoint 对比尚未实现。
- 复杂 block 类型仍以 JSON textarea 为主，后续需要逐步升级为专用编辑器。

### 2026-06-14 Phase 4/5 Agent patch 与输出底座

已完成：

- 后端补齐 `run_agent_completion`、`validate_agent_patch`、`apply_agent_patch`、`export_document`、`list_checkpoints` command，保持 Tauri command 入口只做装配，核心逻辑沉在 `business_designer` feature 模块内。
- 新增 typed Agent patch 协议：`addBlock`、`updateBlock`、`deleteBlock` 三类变更，包含 `schemaVersion`、`documentId`、`baseRevision`、`summary`、`openQuestions`，并在应用前做文档 id、revision、block id、block kind、payload object 校验。
- 新增 Agent patch 预览与归档：Agent 建议先进入 `documents/<documentId>/patches/agent-patch-*.json`，UI 显示结构化 diff，用户可选择性应用变更，Agent 不直接改需求。
- 新增 patch 应用流程：UI 支持逐项接受/拒绝 patch，删除类变更默认不勾选并显示破坏性提示；接受的变更写回 `design.json` 和 block 文件，拒绝的变更保留在结果里，应用后的 detail 立即刷新。
- 新增 checkpoint history 查询，支持按文档过滤最近 50 次 docs repo commit；空 Git repo 返回空历史，避免首启 UI 报错。
- 新增 checkpoint-to-checkpoint 对比：后端支持在 `.gtoffice/docs/.git` 内按文档范围执行 `base..head` 结构化 diff，前端 Inspector 可选择两个 checkpoint 并在 Patch Review 中展示差异。
- 新增导出底座，支持 `markdown`、`html`、`json`、`agentBundle` 四种格式；UI 导出入口使用 Rust/Tauri 调用系统原生 save dialog 并写入文件，保留纯内容导出接口用于自动化和测试。
- 新增编码 handoff 底座：后端生成可审阅的 Task Center dispatch request、三段式任务拆分、附件引用和 Agent brief；前端 Agent 面板支持预览 handoff、输入目标 agent id 并发送到 Task Center。
- 新增真实 task reply patch 回收底座：从 Task Center thread 的 status/handover 消息中提取 fenced JSON 或裸 JSON，归档原始 patch，并复用 typed patch 校验/审阅/应用链路；Handoff 发送结果直接展示每个目标的 task id 和 Recover 操作，减少真实 Codex/Claude 验证时的手工复制。
- 前端工作台接入 Phase 4/5：Agent 面板可生成 mock/Codex patch preview、预览/发送 Coding Handoff、按 task id 回收真实 Agent patch，Patch Review 可显示诊断和应用建议，Version Strip 支持 history refresh 和 Agent bundle export，Inspector 展示 checkpoint history、导出结果和 recovered patch 来源。
- 样式按 `$ui-ux-pro-max` 与 `$native-feel-cross-platform-desktop` 收口：维持 macOS 风格 split-view、系统字体、深浅色 token、焦点态、紧凑工具栏和原生桌面密度，不引入网页式 hover/cursor 行为。
- 新增 Rust 单元测试覆盖 checkpoint history、空 repo history、mock agent patch preview、stale revision 校验、选择性 patch 应用、Agent bundle 导出。

已验证：

- `cargo test -p gtoffice-desktop-tauri business_designer`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `npm run typecheck`
- `git diff --check`

仍未完成：

- `codex` / `claude` provider 的 `run_agent_completion` 按钮仍复用 mock patch 生成器；真实链路已通过 Coding Handoff + task reply patch recovery 接入，但仍需要手工用 Codex 和 Claude Code session 做一次端到端验证。
- 仍需手工验证 checkpoint-to-checkpoint 对比在真实 docs repo 历史中的视觉效果和大列表滚动体验。

### 2026-06-15 Phase 6 前端极简重写（Jobs 式）

**问题诊断**：此前 Phase 1–5 的前端是一个“伪装成桌面应用的网页 CMS”——16 种块类型、每块带表格编辑器、3 栏布局（文档列表 + 画布 + 检查器/Agent/补丁堆叠）、5 模式切换器（设计/流程/契约/Agent Brief/预览）、JSON textarea、实体字段表、API 端点表、流程迁移表。用户在“思考业务”之前必须先做“元数据架构师”，认知负担极重，违反 `$native-feel-cross-platform-desktop` 的 T3（拥抱平台）与 T4（感知即性能）。

**重写核心思想**：文档即画布，Agent 是助手，按钮很少。用户只有一件事——把模糊想法变成结构化可交付需求包：写下来 → Agent 补全 → 审阅建议 → 导出 / 留存。

**已完成**：

- **后端完全不动**：20 个 Tauri command、存储模型、编译器、docs Git checkpoint、Agent patch 校验/应用、导出引擎全部保留。前端只调用核心 4 子集（save / run_agent_completion / apply_agent_patch / export_document_to_file）+ compile / validate / create_checkpoint / list / init / create / read。
- **数据模型映射（不动后端）**：整个需求正文压缩为单个 `text` 块（id=`brief`），用户编辑的就是它的 `payload.markdown`；Agent 返回的结构化块（entityModel / apiContract / acceptanceCriteria / openQuestions 等）在画布上渲染为只读内联段落。`save_document` 持久化前端传入的完整 detail，后端不校验结构，故无需改后端即可实现“单一文档”体验。`ensureBriefBlock` 在加载/保存往返中把后端 seed 的首个 text 块归一为 `brief`，保持契约稳定。
- **删除旧的 16 块/3 栏整套**：移除 `DesignerCanvas`、`DesignerBlockEditorFields`（716 行表格编辑器）、`DesignerOutline`、`DesignerInspector`、`DesignerAgentPanel`、`DesignerPatchReview`、`DesignerVersionStrip`、`DesignerDocumentList`、`model/designer-payload.ts`（162 行表格 payload helpers）。
- **新建 6 个极简组件**：
  - `DesignerSidebar`：薄文档列表 + 内联新建 + 初始化文档库（147 行）。
  - `DesignerDocument`：标题输入 + 单一 Markdown 正文 textarea + Agent 产出块的只读 Markdown 渲染（用现有 `MarkdownRenderer`），含 16 种块到稳定 Markdown 的编译器（308 行）。
  - `DesignerToolbar`：单行工具栏，保存 / Agent 补全（accent）/ 导出（下拉，4 格式）/ Checkpoint，全部按钮带 pressed 态与 focus ring，无 hover cursor:pointer（137 行）。
  - `DesignerPatchSheet`：浮动审阅 sheet，逐条 accept/reject，破坏性变更默认不勾并告警，复用 `apply_agent_patch` 的 acceptedChangeIndices 协议（149 行）。
  - `DesignerStatusbar`：底部单行状态条，保存/草稿/Schema/诊断数/docs 就绪（99 行）。
  - `BusinessDesignerPane`：组合两栏 + 工具栏 + 状态条 + 工作区绑定/空状态（174 行）。
- **controller 精简**：`useDesignerDocumentState` 重写为 core-4 子集（load/save/validate/compile/checkpoint/agent/apply/export），去掉 diff/compare/history/handoff/recover 等暂缓项；`useDesignerDocuments` 保留；`designerDesktopApi` 同步精简。
- **i18n**：新增 `designer.*` 文案键（中英双语），删除废弃的 16 块/模式/检查器文案引用；`nav.designer*` 与 `pane.designer.*` 保留供 shell 使用。
- **样式**：全新极简 SCSS（729 行），两栏 + 工具栏 + 状态条，全程 `--vb-*` token、`rem()` 单位、深浅色自适应、无 `cursor:pointer`、pressed 态、系统 focus ring，遵循苹果风格 split-view 与 native-feel 约束。

**已验证**：

- `npm run typecheck`（tsc -b + vite build + shared-types tsc 全绿，SCSS 编译通过）
- `cargo check --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test -p gtoffice-desktop-tauri business_designer`（19 passed）
- `git diff --check`

**瘦身**：前端 TS/TSX 从 ~3700 行降到 ~2034 行（SCSS 从 1375 行降到 729 行），且消除全部表格编辑器、模式切换器、3 栏堆叠。

**刻意未做（与 core-4 范围一致）**：

- checkpoint 历史列表、checkpoint-vs-checkpoint diff、Coding Handoff dispatch、task-patch recovery 的 UI 暂不接入（后端 command 保留，前端后续可加）。
- `codex` / `claude` 真实 provider 链路仍走 mock patch；端到端验证待后续手工跑通。
- 正文 textarea 后续可升级为 Monaco（当前用原生 textarea 保证零加载延迟与感知速度，符合 T4）。

### 2026-06-17 Phase 6 补全：checkpoint 历史与差异 UI

**背景**：设计文档 §5.5「本地需求 Git 历史」要求支持「历史 checkpoint 列表」与「checkpoint vs checkpoint / 当前视觉状态」的对比。Phase 6 极简重写时这两项 UI 被刻意延后（后端 `list_checkpoints` / `diff_checkpoint` / `compare_checkpoints` 已实现并有测试）。本轮按 `$native-feel-cross-platform-desktop` 收口，补齐这块 UI，使其不回到 3 栏/检查器堆叠。

**已完成**：

- 新增 model 类型 `DesignerCheckpointEntry`、`DesignerCheckpointHistoryResult`、`DesignerDiffEntry`、`DesignerDiffResult`，对齐 Rust serde 结构。
- `designerDesktopApi` 新增 `listDesignerCheckpoints`、`diffDesignerWorkingTree`、`compareDesignerCheckpoints`，沿用现有 coarse-name fallback 模式，按 desktop-api 的 `params` 对象契约调用。
- 新增 `controllers/useDesignerHistory.ts`：管理历史列表加载、模式（对比工作区 / 对比两次 checkpoint）、base/head 选择与 diff 计算，带 operation/error 状态；切文档时重置。
- 新增 `components/DesignerHistorySheet.tsx`：浮动面板，列出最近 50 次 docs repo checkpoint，模式切换 + base/head 下拉 + 对比按钮 + 结构化 diff 列表（added/modified/deleted/renamed/untracked 着色）。Escape 关闭，符合 native-feel「Escape 永远有意义」。
- `DesignerToolbar` 增加「历史」按钮（`clock` 图标），`BusinessDesignerPane` 绑定 `useDesignerHistory` 并渲染 sheet。
- 新增 `designer.history.*` 中英 i18n 文案；SCSS 复用 `--vb-*` token、`rem()` 单位、无 `cursor:pointer`、pressed/focus 态、深浅色自适应。
- 后端零改动：复用既有 20 个 command 与 docs Git checkpoint/diff 实现。

**已验证**：

- `npm run typecheck`（tsc -b + vite build + shared-types tsc 全绿）
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test -p gtoffice-desktop-tauri business_designer`（19 passed）
- `npm run build:tauri`（产出 `GT Office.app`）

**仍刻意未做**：

- `codex` / `claude` 真实 provider 链路仍走 mock patch；端到端验证待后续手工跑通。
- Coding Handoff dispatch、task-patch recovery 的 UI 仍按 core-4 范围延后（后端 command 保留）。
- 正文 textarea 升级 Monaco 仍延后（保持 T4 感知速度）。


