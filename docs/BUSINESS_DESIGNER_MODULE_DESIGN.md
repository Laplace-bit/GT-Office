# 业务设计器模块方案

**当前版本**：v1 — 图范式 + Gap 引擎  
**首次起草**：2026-06-10  
**最近迭代**：2026-06-17  
**适用范围**：GT Office 业务设计器；Phase 6 极简底座之上的范式重写

> v0（Phase 1–6）的进度记录与历史决策保留在文末「附录 A：历史进度（v0）」，本节起的章节描述的是 v1 当前生效设计。

---

## 1. 一句话核心

> **需求是一张以 block 为节点、以 link 为边的关系图；每个 block kind 有一套确定性健全性规则，规则未满足处即「缺口」（Gap）；AI 的唯一职责是补一个被命名的、锚定到宿主 block 的缺口；补完后同一套规则重跑验证 — AI 永远不自我评分。**

这一句话决定了之后的所有结构。范式的「惊艳」不在视觉炫技，而在三条机器可执行的铁律：

1. **AI 任务必须有宿主 block**。不存在「帮我补全整个需求」这类无锚任务。任务 prompt 写死 `hostBlockId` + `gapCodes`，AI 返回的 patch 只能修改宿主 block 或为它显式声明的相邻新 block。
2. **缺口是机器算的，不是 AI 说的**。`gap_rules` 是纯 Rust 函数集，输入 block payload + 图，输出 `Gap[]`。AI 不能发明 gap code，只能补规则发现的 gap。
3. **验证 = 重跑规则**。AI patch 应用后，`validate_document` 重跑 `gap_rules`：目标 gap 消失 = resolved；仍在 = unresolved；新出现 = introduced。**AI 永远无法假装成功**，判定权在规则手里。

「让 AI 有迹可循而不是猜测」在代码层即此三条；其余章节是把它们落到代码与界面。

## 2. 与前序版本的关系

- **v0 Phase 1–5**：16 种块的全功能表格编辑器 + 5 模式切换器。结构严谨但用户被迫先做「元数据架构师」。废弃。
- **v0 Phase 6**：折叠为单一 brief 文本块 + AI 返回的只读结构化块。低门槛但结构折回自然语言，AI 又得猜。废弃为「v1 的图根入口」。
- **v1（本设计）**：图范式 + 规则驱动的缺口 + 锚定到宿主块的 AI 补全。把 Phase 6 的 brief 文本块**保留为图根**，新结构从图根上"长出来"，不丢低门槛。

## 3. 产品原则（v1 收口）

- **可视化优先，源码可携带**：用户主要操作图与下钻表单；落盘文件仍是 JSON / Markdown / HTML。
- **结构从语义中长出**：用户不手画连线、不填表格元数据；图的节点从 brief 实体识别 / 缺口反推 / 直接加块产生，边由 payload 引用自动推导。
- **AI 不直接改需求**：Agent 只能返回锚定到 hostBlockId 的 typed patch，必须由用户审阅后选择性应用。
- **机器先于 AI**：能用规则确定的事情绝不让 AI 决定；能用规则验证的事情绝不让 AI 自评。
- **工作区内闭环**：所有文件默认在 `.gtoffice/docs` 下；needs Git 是独立嵌套 repo。
- **不为了便利新增依赖**：v1 不引入第三方 graph / diagram 库；如确实需要，先更新 `docs/DEPENDENCIES.md`。

## 4. 与现有架构的关系

继续遵循 `$native-feel-cross-platform-desktop` 的四层原则：

- **T1 — 边界在渲染面**：可视化编辑留在 React WebView；文件系统、Git、Agent 进程控制、规则引擎留在 Tauri/Rust。
- **T2 — 一份 schema、多种语言**：`DesignerBlock` / `DesignerGap` / `DesignerRuleRun` / `DesignerAgentTaskRequest` 在前端 TS 与 Rust serde 之间双向对齐。
- **T3 — 拥抱平台**：苹果风格 split-view，系统字体，无 `cursor:pointer`，pressed 态，原生 save dialog，深浅色 token。
- **T4 — 性能即感知**：缺口规则在后端跑，前端拿结果即画；图画布用 SVG + CSS transform，避免阻塞输入；下钻表单仅在双击时挂载。
- **T6 — 跨边界要刻意**：autosave、validate、compile、Git checkpoint、Agent dispatch 都批处理、可追踪、可取消。

## 5. 数据模型

v1 的 schema 改动是**加法**：旧文档加载即正常，零迁移。

### 5.0 跨语言 schema 同步策略（T2）

v1 引入 4 个新数据结构横跨 Rust ↔ TS：`DesignerGap` / `DesignerRuleRun` / `DesignerAgentTaskRequest` / `DesignerPatchApplyResult.gapResolution`。Tauri 项目不能用 UniFFI 自动生成，沿用项目既有约束：

- **Source of truth**：TS-first（`packages/shared-types`），Rust 侧手写 serde 镜像（沿用 v0 既定路线）。
- **防漂移机制**：
  1. 每个新 struct 在 PR 中**必须同时改两侧**；CI 跑 `npm run typecheck` + `cargo check --workspace`，schema 不一致一侧编译断 → PR 红。
  2. 在 `packages/shared-types/src/business-designer/` 加 contract 测试：构造每种新对象的样例 JSON，前端 parse 通过 + 后端 serde deserialize 通过——roundtrip 等价。
  3. Rust serde struct 加 `#[serde(deny_unknown_fields)]`：TS 加字段、Rust 没跟上 → 反序列化失败、立即可见。
- **变更纪律**：改 schema 视同改 IPC 公共 API，不允许"先改一侧、之后再补另一侧"。这是 v1 防漂移的硬约束。

### 5.1 Gap 与 RuleRun（新增）

```ts
interface DesignerGap {
  id: string                 // 稳定 id：hash(blockId + code + 定位参数)
  code: string               // 'no-pk' | 'dead-state' | 'no-errors' | ...
  blockId: string            // 宿主块（hostBlockId 必须等于此值）
  layer: 'intra' | 'inter'   // 块内规则缺口 / 块间拓扑缺口
  severity: 'warning' | 'error'
  message: string             // 给人看的描述
  fixableByAgent: boolean    // false 表示需人决定（如缺名字）
  locator?: Record<string, string> // 定位参数，如 { state: 'paid' }
}

interface DesignerRuleRun {
  kind: DesignerBlockKind
  code: string
  blockId: string
  passed: boolean
}
```

Gap id 稳定算法保证规则重跑后能匹配到同一缺口，进而判断 resolved/unresolved。

### 5.2 validate_document 返回扩展

```ts
interface DesignerValidationResult {
  workspaceId: string
  documentId: string
  diagnostics: DesignerDiagnostic[]   // 仅 lint / 格式 / schema 错误
  gaps: DesignerGap[]                 // 新增：一等公民
  rulesRun: DesignerRuleRun[]         // 新增：审计追踪
}
```

`diagnostics` 不再混 gap，前端按对象类型分流，不靠 code 前缀猜。

### 5.3 Agent 任务锚定（新增字段，可选）

```ts
interface DesignerAgentTaskRequest {
  hostBlockId: string        // 必填（v1 前端永远填）
  gapCodes: string[]         // 必填
  scope: 'single' | 'block'
  documentId: string
  baseRevision: string
}
```

`preview_agent_task` / `run_agent_completion` 入参增加这三个字段，**可选**——后端不强制非空，新画布永远填、走范式约束；旧路径不破坏。

### 5.4 Patch 应用三态（新增返回字段）

```ts
interface DesignerPatchApplyResult {
  // 现有字段保留
  gapResolution: {
    targetGapIds: string[]
    resolved: string[]
    unresolved: string[]
    introduced: DesignerGap[]
  }
}
```

### 5.5 图节点位置

存于 `manifest.layout: { [blockId]: { x: number; y: number } }`。manifest 是文档级视图元数据的天然归属，已存在 `tags`。位置是显示状态、不影响语义，存 manifest 不污染 block payload。

### 5.6 边的 relation 词表

v1 固定为 5 种：`dependsOn` / `produces` / `consumes` / `uses` / `extends`。封闭词表是图范式可读性的关键；自由文本会让 AI 又得猜。如未来需要扩词，先更新本节，不允许 ad hoc 引入。

### 5.7 边的来源

边**不**由用户手画，由后端在校验时基于 payload 引用自动推导：
- 字段 type 指向另一实体名 → `entityModel A — uses → entityModel B`
- API 端点的 request/response shape 引用实体 → `apiContract A — dependsOn → entityModel B`
- 业务流程引用实体 → `businessFlow A — consumes → entityModel B`

引用断裂 → `dangling-ref` 缺口。这种「边是派生的」让用户改字段名导致边消失是可见的、可补的。

## 6. Gap 规则集（v1 三种块）

收口原则：**仅做机器能确定的事实**——零主观判断、零业务启发式。「订单该不该有取消路径」是人的决定，归 `openQuestions` 块，不归规则。

### 6.1 entityModel

| code | 规则 | severity | fixable |
|---|---|---|---|
| `no-fields` | 字段数 < 1 | error | ✓ |
| `no-pk` | 无字段标 `isPrimaryKey` 且无名为 `id`/`<entity>Id` 的字段 | warning | ✓ |
| `field-no-type` | 任一字段缺 `type` | error | ✓ |
| `field-no-name` | 任一字段缺 `name` | error | ✗ |
| `enum-no-values` | type=`enum` 的字段 `values` 为空 | error | ✓ |
| `dangling-ref` | 字段 type 指向另一实体但图内无该实体节点 | warning | ✓ |

### 6.2 businessFlow

| code | 规则 | severity | fixable |
|---|---|---|---|
| `no-states` | `states` 为空 | error | ✓ |
| `no-transitions` | `transitions` 为空 | error | ✓ |
| `transition-unknown-state` | 迁移的 `from`/`to` 不在 states 中 | error | ✓ |
| `dead-state` | 状态无出迁且未标 `terminal:true` | warning | ✓ |
| `unreachable-state` | 状态无入迁且非 `initial` | warning | ✓ |
| `no-terminal` | 全图无任何 terminal 状态 | warning | ✓ |

### 6.3 apiContract

| code | 规则 | severity | fixable |
|---|---|---|---|
| `no-endpoints` | `endpoints` 为空 | error | ✓ |
| `endpoint-no-path` | 端点缺 `path` | error | ✓ |
| `endpoint-no-method` | 端点缺 `method` | error | ✓ |
| `no-response` | 端点缺 `response` 或 `responseShape` | warning | ✓ |
| `no-errors` | 端点无 `errors` / `errorCodes` | warning | ✓ |
| `orphan-contract` | 块无任何 `dependsOn` 边到 entityModel | warning | ✓ |

### 6.4 其余 13 种块（text / glossary / ruleTable / pseudocode / objectModel / dataContract / uiWorkflow / technicalStack / nonFunctional / acceptanceCriteria / openQuestions / agentInstruction / decisionRecord）

v1 **不产 gap**，只做 lint（schema 格式 / 字段类型）。它们存在于图中、可作为引用目标（被三种 gap-rule kind 通过 `dependsOn`/`uses` 等指向），但 **AI 任务永远不以它们为 host**——AI 不会被派去补这 13 种块的内容。规则集留扩展位，后续按需加入。

特殊情况：图根 `brief`（kind=`text`，id=`brief`）虽属此 13 种，但作为图入口节点存在，下钻时使用 `DesignerBriefRoot` 面板，不通过画布右键新建。

### 6.5 三态判定语义

```text
patch 应用 → 重跑 gap_rules → 与应用前 rulesRun 快照对比

resolved      = 应用前在 targetGapIds 且应用后不在
unresolved    = 应用前在 targetGapIds 且应用后仍在
introduced    = 应用后新出现的 gap（不限于本次目标）
```

unresolved/introduced 在 UI 上高亮，**不**自动接受为成功。

## 7. 用户体验

### 7.0 Phase 6 → v1 身份连续性（T7）

T7 「身份即肌肉记忆」要求 v1 不能借机"现代化"破坏 Phase 6 用户已建立的肌肉记忆。审计如下：

**必须 100% 保留的快捷键与入口**（v0 Phase 6 已落地，用户已用）：

| 行为 | Phase 6 实现 | v1 处理 |
|---|---|---|
| 保存 | `⌘S` / `Ctrl+S` | 保留，在 brief 与新结构表单都生效 |
| 撤销 / 重做 | 浏览器原生（textarea 内） | 在 brief 内保留浏览器原生；图层面 v1 暂不做全局 undo（明示） |
| Checkpoint | toolbar 按钮 | 保留按钮；新增 v1 入口不替换 |
| 历史浮层 | toolbar `时钟`图标 | 保留 |
| 导出（4 格式） | toolbar 下拉 | 保留 |
| 让 Agent 补全 | toolbar accent 按钮（mock） | **行为升级**：在 brief 上点击仍走 mock 全文补全（兼容旧路径），新增 inspector 内的 host-anchored 补全（新行为） |
| `Esc` 关闭浮层 | history sheet / patch sheet 已支持 | 保留；新增的下钻 side panel 也用 `Esc` |
| 切换文档 | sidebar 点击 | 保留 |

**v1 新快捷键**（不与现有冲突）：

| 快捷键 | 行为 | 冲突检查 |
|---|---|---|
| `⌘N` / `Ctrl+N` | 画布空处时新建块 | 与"新建文档"（在 sidebar 上下文）不冲突——按当前焦点上下文路由 |
| `⌘0` / `Ctrl+0` | 画布缩放重置到 100% | 浏览器默认是缩放页面，但 WebView 内禁用浏览器缩放后可占用 |
| `⌘=` / `⌘-` | 画布步进缩放 | 同上 |
| `Space` + 拖拽 | 画布平移 | 与 brief 内空格输入冲突时按"焦点是否在文本框"分流 |
| 双击节点 | 打开下钻面板 | 新行为 |

**初始视觉连续性**：用户首次升级到 v1 打开旧 Phase 6 文档：
1. 文档加载后默认聚焦在 brief 节点（图根），下钻面板自动展开显示 brief 文本框 → **视觉上与 Phase 6 几乎一致**（"打开就是文本框"的肌肉记忆保留）。
2. 图画布在右半边可见但不抢焦点。
3. 用户继续按 Phase 6 的方式编辑 brief 即可，结构是"长出来的"不是"必须先建的"。

**禁止借升级"现代化"的事项**：
- 不改 i18n key（`designer.*` 已发布）。
- 不改文档落盘格式（manifest / blocks / generated 路径不变）。
- 不改 sidebar 视觉密度。
- 不引入 onboarding tour（native 不做这种 web idiom）。

### 7.1 侧栏入口

复用 Phase 6 已建：
- 中文：`业务设计器`，英文：`Designer`，ID：`designer`
- 位置：文件管理之后、Git 协作之前。

### 7.2 主界面布局

```text
┌──────────────────────────────────────────────────────────┐
│ 顶部 workspace tabs                                        │
├────────────┬──────────────────────────────┬───────────────┤
│ 文档列表    │ 关系图画布                    │ 选中块检查器   │
│ (薄侧栏)    │ 节点=块, 边=link, ⚠=缺口       │ + 缺口清单     │
│            │ 缩放/平移, 双击下钻             │ + Agent 入口   │
├────────────┴──────────────────────────────┴───────────────┤
│ 状态条: 草稿/缺口数/校验/checkpoint/导出                    │
└──────────────────────────────────────────────────────────┘
```

三栏，但右栏职责清晰单一：选中块的属性 + 该块的缺口 + 针对缺口的 Agent 入口。**不**回到 v0 Phase 1–5 的「检查器/Agent/Patch 三面板堆叠」。

### 7.3 创作动作（低门槛入口）

用户**不**需要先想「我要建一个 entityModel 块」。三种自然入口：

1. **从 brief 根节点长出**：brief 是图的根节点（kind=`text`，id=`brief`，沿用 Phase 6 落地）。用户在 brief 选中文本如「订单」→ 浮按钮 `↗ 建模为实体` → 一键生成 entityModel 节点入图。**不做**自动 NLP 识别，避免误导。
2. **从缺口反推**：`dangling-ref` 缺口旁直接有 `+ 建 Customer 实体` 按钮——这是图范式区别于「单块编辑器」的核心，跨块补全发生在缺口反推时。
3. **直接加块**：画布空处右键 / 快捷键 `⌘N` → 选 kind → 新建空块。v1 加块菜单仅列 §6 的三种 gap-rule kind（`entityModel` / `businessFlow` / `apiContract`），新块自动带缺口（如 `no-fields`）。其余 13 种 kind 在 v1 不能从画布新建，仅作为图根 brief 的子结构存在或后续版本扩展。

三种入口的共同点：**结构是创作的副产品，不是元数据填报**。

### 7.4 图画布

- **节点**：圆角矩形，显示 kind 图标 + 标题。有缺口时右上角 ⚠ 徽章（数字=缺口数），未满足规则的块用细虚线描边。
- **边**：有向箭头，标签 = relation，颜色按 relation 分。**用户不画边**，断裂即变 dangling-ref 缺口。
- **缩放/平移**：trackpad 双指缩放、空格+拖拽平移；`⌘0` 重置；`⌘=`/`⌘-` 步进缩放。
- **双击节点 → 下钻**：从画布右侧滑入"下钻面板"（slide-in side panel，**非 modal**、**无 backdrop blur**、**不暗化背景画布**——这三条是反 web idiom 的硬约束）。下钻面板宽度约 480px，与右栏 inspector 并排不重叠；面板存在期间用户仍能看到画布全貌（保 T3：原生 split-view 信息密度，不模仿 web 的"全屏对话框"）。面板内容：
  - 极简结构化表单（字段表 / 状态迁移表 / 端点表）
  - 该块的缺口清单（与右栏 inspector 同步）
  - Agent 入口
  - 关闭：`Esc` / 标题栏 close 按钮 / 点击画布空白处

### 7.5 Agent 补全交互（范式硬约束在 UI 上的体现）

- 选中有缺口的块 → 右栏列缺口（每条 gap code + message + fixable 标）。
- 每条缺口旁：`[让 Agent 补]`（scope=single）。块顶部：`[补全本块全部缺口]`（scope=block）。
- 派发前 **preview**：右栏展示将发送的 prompt 与上下文（host block payload + 邻接边 + 当前 gapCodes），符合 `preview → validate → confirm → dispatch` 生命周期。
- Agent 返回 → **Patch Sheet** 浮层逐条 accept/reject（复用 Phase 6 已建的 `DesignerPatchSheet` 与 `apply_agent_patch.acceptedChangeIndices` 协议）。破坏性变更默认不勾。
- 应用后自动重跑 validate → Patch Sheet 尾部三态对比区显示 resolved ✓ / unresolved ⚠ / introduced ⚠。

### 7.6 不做的（避免回到伪 CMS）

- ❌ 每种块的全功能表格编辑器（v0 的 716 行 `DesignerBlockEditorFields` 不复活）。
- ❌ 5 模式切换器（设计/流程/契约/Agent Brief/预览）。模式消失，画布即一切。
- ❌ 手画连线。
- ❌ JSON textarea 作为主编辑面（仅在下钻视图的「源码」标签给高级用户，默认隐藏）。

### 7.7 原生桌面风格

继续遵循 `$native-feel-cross-platform-desktop`：
- macOS `-apple-system` / Windows `Segoe UI Variable`。
- 列表行、节点、缺口条目无 `cursor:pointer`，pressed 态明确。
- 系统 focus ring，深浅色与 accent color 跟随系统。
- 危险操作（删块、删边引用、丢弃 patch）显示明确影响范围。
- 完整键盘操作：节点选中、下钻、缩放、保存、Agent 派发、accept/reject。

### 7.8 原生交互细则（T3 收口）

参考 `references/06-native-conventions.md`，把 v1 容易"网页化"的细节写死：

**Loading**：
- < 200ms 操作 → 显示**无任何 loading 反馈**，结果到达直接 commit（save、validate、节点创建、inspector 切换都属此类）。
- 200ms ~ 2s → spinner（小型，靠近触发处，不全屏）。Agent dispatch、export 属此类。
- \> 2s → 进度反馈（如"正在生成 patch..."文字 + spinner）。
- **绝不**用 skeleton 占位符——这是纯 web idiom，与原生应用感冲突。

**Empty state**（每种状态一个图标 + 一句话 + 一个主操作，不解释、不教学）：
- workspace 未选 → 现状 i18n `designer.workspaceRequired` 保留。
- workspace 已选但 docs repo 未初始化 → "初始化 docs 仓库"（现状保留）。
- docs 仓库已就绪但无文档 → "创建第一个需求包"。
- 文档已选但图为空（仅 brief 根节点，无任何业务块） → "在 brief 中选中实体名建模" + brief 文本框光标自动聚焦。
- 块已选但无缺口 → inspector 显示"该块结构完整 ✓"，不显示 Agent 入口（避免无目标补全）。

**Hover 规则**（参考 `references/06-native-conventions.md` § Edge cases）：
- **节点（list-row 类）**：可有 subtle 背景 hover 高亮，但 `cursor: default`，**不**显示 pointer 手势。
- **toolbar 图标按钮**：可有 subtle 背景 tint hover，`cursor: default`。
- **缺口列表项（list-row 类）**：subtle 背景 hover，`cursor: default`。
- **plain push button**（如"创建文档"、"让 Agent 补"）：**无** hover 视觉变化（按 macOS native button 规范）；只有 `:active` pressed 态。
- **brief 文本中的"建模为实体"浮按钮**：作为内容区按钮，可有 hover 背景，`cursor: default`。

**Pressed 态**：所有按钮必须有 `:active` 视觉下沉 / 颜色加深，与 hover 区分。

**Onboarding**：v1 **不做**多步引导教程；空状态的一句话 + 主操作即引导。如需教学，靠首次悬停时的 tooltip（一次性，不重复）。

**Toast / 通知**：v1 **不引入**自画 toast；状态条已承担轻量反馈（"已保存"），破坏性反馈（错误）走 inline error banner（已有 `.designer-error-banner`）。

## 8. 后端模块边界与命令变更

### 8.1 文件结构

```text
apps/desktop-tauri/src-tauri/src/commands/business_designer/
├── mod.rs              # Tauri command 入口绑定（命令清单不变）
├── gap_rules/          # 新增：规则引擎
│   ├── mod.rs          # GapRule trait + 注册表 + run_all(graph)
│   ├── entity.rs       # entityModel 规则
│   ├── flow.rs         # businessFlow 规则
│   ├── api.rs          # apiContract 规则
│   └── tests.rs        # 规则单测（每条规则一组 fixture）
├── validation.rs       # 现有 validate 逻辑外提 + 调 gap_rules::run_all
└── tests/mod_tests.rs  # 现有测试（命令级）
```

`gap_rules` 是纯函数模块——无 IO、无 Tauri、无 state，可独立单测。规则集稳定后整个 `business_designer/` 可沉淀为 `crates/gt-business-designer`，v1 不做。

### 8.2 命令清单变更

| 命令 | v1 改动 |
|---|---|
| `business_designer.list_documents` | 不动 |
| `business_designer.create_document` | 不动 |
| `business_designer.read_document` | 不动 |
| `business_designer.save_document` | 不动 |
| `business_designer.compile_document` | 不动 |
| **`business_designer.validate_document`** | **返回新增 `gaps` / `rulesRun`** |
| `business_designer.init_docs_repo` | 不动 |
| `business_designer.create_checkpoint` | 不动 |
| `business_designer.diff_checkpoint` | 不动 |
| `business_designer.list_checkpoints` | 不动 |
| `business_designer.compare_checkpoints` | 不动 |
| `business_designer.preview_agent_task` | 入参增 `hostBlockId`/`gapCodes`/`scope`（可选，缺省退现行行为） |
| `business_designer.run_agent_completion` | 同上（可选） |
| `business_designer.validate_agent_patch` | 校验加：每个 change 必须命中 hostBlockId（若 patch metadata 有 host） |
| `business_designer.apply_agent_patch` | 应用后自动 validate 并附 `gapResolution` |
| `business_designer.export_document` | 不动 |
| `business_designer.list_handoffs` 等 handoff 链 | 不动 |

新增**零**命令；扩展 4 个返回 / 入参；其余不动。

### 8.3 Patch 校验铁律（host 命中）

`apply_agent_patch` 在校验阶段：

```text
host = patch.metadata.hostBlockId
if host is some:
    for change in patch.changes:
        target =
          change.targetBlockId      if op in {updateBlock, deleteBlock}
          change.afterBlockId        if op == addBlock
        if target != host:
            reject_patch("change targets {target}, host is {host}")
            return  # 不部分应用
```

`hostBlockId` 写入归档 patch 的 metadata（`run_agent_completion` 派发时记录），不靠前端再传——避免前端绕过范式。

### 8.4 三态对比实现

```text
fn apply_agent_patch(...) -> ApplyResult:
    before = gap_rules::run_all(load_graph())
    apply_changes(...)
    save_graph()
    after = gap_rules::run_all(load_graph())
    
    target = patch.metadata.gapCodes
    target_ids = before.gaps where code in target
    
    resolved   = target_ids - after.gap_ids
    unresolved = target_ids ∩ after.gap_ids
    introduced = after.gaps - before.gaps
    
    return ApplyResult { ..., gap_resolution: { ... } }
```

### 8.5 Rust 模块职责（接口形状，不是实现）

```rust
// gap_rules/mod.rs
pub trait GapRule {
    fn code(&self) -> &'static str;
    fn applies_to(&self) -> DesignerBlockKind;
    fn check(&self, block: &DesignerBlock, graph: &DesignerDesignGraph) -> Vec<DesignerGap>;
}

pub fn run_all(graph: &DesignerDesignGraph) -> GapRunResult {
    // 注册表里取所有 rule，按 block 分发，聚合 gaps + ruleRuns
}
```

每条规则一个独立 struct 实现 `GapRule`，注册到 `register_rules()` 函数，`mod.rs` 的注册表是 v1 的扩展点：未来加规则只需加 struct + 注册一行。

## 9. 前端模块边界

```text
apps/desktop-web/src/features/business-designer/
├── BusinessDesignerPane.tsx          # 三栏组合
├── BusinessDesignerPane.scss
├── components/
│   ├── DesignerSidebar.tsx           # 文档列表（保留）
│   ├── DesignerGraphCanvas.tsx       # 新：图画布
│   ├── DesignerInspector.tsx         # 新：选中块检查器 + 缺口清单 + Agent
│   ├── DesignerBlockDrillSheet.tsx   # 新：双击下钻覆盖层
│   ├── DesignerBriefRoot.tsx         # 新：图根 brief 的下钻面板（沿用 DesignerDocument 语义）
│   ├── DesignerPatchSheet.tsx        # 升级：尾部加三态对比区
│   ├── DesignerToolbar.tsx           # 保留
│   ├── DesignerHistorySheet.tsx      # 保留
│   └── DesignerStatusbar.tsx         # 升级：缺口数显示
├── controllers/
│   ├── designerDesktopApi.ts         # 升级：新返回字段
│   ├── useDesignerDocuments.ts       # 保留
│   ├── useDesignerDocumentState.ts   # 升级：携带 gaps/rulesRun/gapResolution
│   ├── useDesignerHistory.ts         # 保留
│   ├── useDesignerGraph.ts           # 新：节点位置、邻接、推导边
│   └── useDesignerAgentTask.ts       # 新：host/gap 锚定、preview/dispatch
└── model/
    ├── designer-blocks.ts            # 不动
    ├── designer-document.ts          # 加 layout 字段
    ├── designer-patch.ts             # 加 hostBlockId/gapCodes/gapResolution
    ├── designer-validation.ts        # 加 gaps/rulesRun
    └── designer-graph.ts             # 新：边推导、布局类型
```

不引入新依赖：节点定位用 SVG + CSS transform，缩放/平移用现有事件。布局用网格初始 + 用户拖拽位置。

## 10. 实施路径

每个里程碑独立验证、独立 commit、独立证明范式有效。

### M1 — 后端 Gap 引擎 + validate 扩展

- 新增 `gap_rules/` 模块，实现三种块的全部规则（§6 收口清单）。
- 扩展 `validate_document` 返回 `gaps` / `rulesRun`，`diagnostics` 退回纯 lint。
- 边推导逻辑（§5.7）放在 `validation.rs`，跑在 `gap_rules::run_all` 之前。
- 每条规则一组 fixture 单测（满足 / 不满足）。
- inter 层规则（`dangling-ref` / `orphan-contract`）需要图遍历，`run_all` 接收完整 `DesignerDesignGraph`。

**验证**：
- `cargo test -p gtoffice-desktop-tauri business_designer`（旧测试 + 新规则测试全绿）
- `cargo clippy --workspace --all-targets -- -D warnings`
- 手工：`validate_document` 一份带已知缺口的 fixture，确认 gaps 数量与定位正确。

完成时，「AI 有迹可循」在后端已成立——命令行即可验证缺口检测。

### M2 — Patch 锚定铁律 + 三态对比

- `run_agent_completion` 接受 `hostBlockId` / `gapCodes` / `scope`，写入归档 patch metadata。
- `apply_agent_patch` 校验：每个 change 命中 host，否则整体拒绝（不部分应用）。
- 应用成功后重跑 `gap_rules`，返回 `gapResolution`。
- mock provider patch 生成器升级为按 `hostBlockId` + `gapCodes` 生成确定性补丁。

**验证**：
- 单测覆盖：host 命中通过、host 不命中拒绝、resolved/unresolved/introduced 三态。
- `cargo test` 绿。
- 手工：mock provider 端到端跑一次 `no-pk` 缺口，确认三态返回。

完成时，**整个范式硬约束已在后端生效**，前端任何后续实现自动获得「AI 有迹可循」的强制力。

### M3 — 前端图画布 + 检查器

- 新建 `DesignerGraphCanvas` / `DesignerInspector` / `DesignerBlockDrillSheet`。
- `BusinessDesignerPane` 切换为三栏：sidebar / canvas / inspector。
- 保留 `DesignerDocument`，重命名为 `DesignerBriefRoot`，作为图根 brief 块的下钻面板。
- 三种创作入口：brief 选中文本浮"建模为实体" / 缺口反推按钮 / 画布右键加块。
- 边由前端从 `validate_document` 返回的隐含引用 + 后端推导结果二者合并渲染（v1 完全信任后端推导）。
- 节点位置存 `manifest.layout`，**拖拽期间纯前端 `transform: translate3d`，mouseup 才 IPC**（§12.3 / §12.5 硬约束）。
- 新增 `styles/tokens/_designer.scss`（§14.2 token 清单），深浅色双套，所有节点 / 边 / 缺口色走 token。
- 实现 §7.0 身份连续性：打开旧 Phase 6 文档 → 默认聚焦 brief 节点、下钻面板自动展开、视觉与 Phase 6 一致。
- 实现 §7.8 原生交互细则：loading 三档、empty 一图标一句话、hover 按节点/按钮分类、pressed 态。

**验证**：
- `npm run typecheck`
- `npm run build:tauri` 产物可启动
- 手工：打开样例文档 → 看到图、缺口徽章、双击下钻、改字段名让边消失、加块让边出现。

### M4 — Agent 派发 UI + Patch Sheet 升级

- Inspector 缺口清单加 `[让 Agent 补]` / `[补全本块全部缺口]`。
- Preview 面板：展示 host + gapCodes + payload + 邻接 prompt。
- `DesignerPatchSheet` 尾部三态对比区。
- `DesignerStatusbar` 显示文档级缺口总数。

**验证**：
- `npm run typecheck` + `cargo check --workspace` + `cargo clippy`
- 手工端到端：写 brief「订单」→ 选中"订单"建 Order 实体（自动有 no-pk 缺口）→ 让 Agent 补 → patch sheet → 接受 → 三态显示 resolved → checkpoint。
- mock provider 验通后，**用 Codex 真实 session 跑一次完整端到端**——v0 全程未做的端到端验证，v1 必须补上。

### 全局验证（每个 M 都跑）

- `npm run typecheck`
- `cargo check --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test -p gtoffice-desktop-tauri business_designer`
- `git diff --check`

## 11. 可靠性

- **原子写入**：先写临时文件、必要时 fsync、再 rename，沿用现有约束。
- **路径安全**：所有路径限制在 workspace root 与 `.gtoffice/docs` 双重边界内。
- **schema 迁移**：`schemaVersion` 已存在；v1 加字段不动版本号（向后兼容加法），下一次破坏性改动再升级。
- **Autosave**：debounce 保存，不每次 autosave 触发 Git commit。
- **Git 错误**：缺 git binary / repo lock / 嵌套 repo 混淆给可操作提示，沿用 v0 处理。
- **Agent 超时**：支持取消并保存 request 状态（沿用现有 task center 集成）。
- **Patch 幂等**：拒绝的 patch 仍归档；接受的 patch 记录 applied revision；host 不命中即整体拒绝、不部分应用。
- **Tracing**：后端命令带 traceId；Agent task 带 request id + document id + hostBlockId + gapCodes，便于审计「AI 改了哪个 host 的哪个 gap」。
- **可 mock**：filesystem / Git / Agent dispatch / gap_rules 都可替换。

## 12. 性能

### 12.1 用户感知目标（绑定具体击键/帧/延迟）

T4 「性能即感知」要求性能目标绑定具体动作，不写抽象 fps/MB：

| 用户动作 | 感知目标 | 验证方式 |
|---|---|---|
| 点击侧栏文档 → 图出现 | 缓存命中 < 200ms 出首帧 | `performance.mark` + DevTools Performance |
| brief 输入字符 → 屏幕显示 | < 50ms（输入热路径不阻塞） | 输入延迟测量；不允许 IPC 同步等待 |
| 拖拽节点 | 60fps 持续，松手到落位 < 50ms | Chrome DevTools Performance 录制 |
| `validate_document` 跑完 | < 300ms（常规需求包，节点数 < 50） | trace；超 300ms 则降级为 debounce |
| Agent 派发 → patch sheet 出现 | mock provider < 100ms；真实 provider 受 Agent 端制约（不计入预算） | trace |
| 接受 patch → 三态显示 | < 300ms（含 validate 重跑） | trace |
| 节点选中 → inspector 切换 | < 16ms（一帧内） | 纯前端，无 IPC |

### 12.2 实现策略

- 图画布初次绘制：常规节点数 < 50 直接全画；> 50 用 viewport culling（只画可视区 + 1 屏 buffer）。
- 节点拖拽：拖拽期间用 `transform: translate3d()` 改 wrapper（GPU 合成层，不触发 layout / paint），mouseup 时一次性写回坐标到 manifest。**严禁**每帧改 SVG `<g transform>` attribute，会触发 SVG re-rasterize。
- 输入热路径不调 Tauri：brief 文本编辑、字段表编辑均在前端 in-memory state，autosave 触发后端（见 §12.5）。
- 验证不阻塞热输入：`validate_document` 在 save commit 后异步触发，结果到达后 patch 到画布。
- Markdown / HTML 输出保持稳定，避免无意义 diff（v0 已达成，v1 保持）。

### 12.3 节点拖拽性能细则

```text
mousedown:  记录起始 (x0, y0)
mousemove:  wrapper.style.transform = `translate3d(${dx}px, ${dy}px, 0)`  // GPU only
mouseup:    一次性 IPC: save_document(manifest with new layout)
            清空 transform, 让 React 用真实 manifest 坐标重渲染
```

拖拽期间零 IPC，60fps 由 GPU 合成保证。这是 T6 在拖拽场景的具体落地。

### 12.4 响应式单位 vs SVG 坐标

CLAUDE.md 规定不用 `px`，但 SVG 内部坐标是 viewBox 数学单位无法 rem。约定：

- DOM wrapper / 节点尺寸 / 文字 / 边距 / 图标：`rem`
- SVG viewBox 内部布局坐标：unitless（纯数学）
- SVG 整体跟随系统字体缩放：通过 wrapper 的 `font-size: 1rem` + viewBox 等比例 + `width: 100%` / `height: 100%`
- 节点尺寸由 `<foreignObject>` 内 DOM 决定（用 rem），SVG 边连线坐标根据 `<foreignObject>` 实际 bbox 计算

### 12.5 IPC 节流契约（T6 跨边界刻意化的硬约束）

以下 4 条 IPC 路径**必须**按此节流，违反即视为 PR 阻断：

| 路径 | 节流策略 | 理由 |
|---|---|---|
| brief textarea 输入 → `save_document` | debounce **1500ms**（人类输入停顿阈值） | 每键击 IPC 是 ShellRoot.tsx 灾难的同型问题（PRODUCT_VISION P0 警告过） |
| 字段表 / 迁移表 / 端点表编辑 → `save_document` | onBlur **或** debounce 1500ms（取先到） | 表单字段编辑同上原则；blur 比 debounce 更符合用户"我编辑完了"心智 |
| 节点拖拽 → `save_document`（layout） | **mouseup 触发一次**（拖拽期间纯前端 transform） | 见 §12.3；拖拽中 60fps × 300ms 节流 = 200 次 IPC，灾难 |
| `save_document` 完成 → `validate_document` | save 成功后跑一次，与 save 同 debounce 链 | validate 跟随 save 而非独立节流，避免双轨 |

- **任何**新引入的"前端 effect → Tauri command"必须在 PR 中说明触发频率、payload 大小、batch 策略。
- Tracing 强制：每条 IPC 携带 `traceId`，前端在 dev 模式下打 console 显示触发频率（开发期发现"一秒跑了 30 次"立即可见）。
- 这一节是 v1 防"网页化滑坡"的最关键 guard，不是 nice-to-have。

## 13. 安全与隐私

- `.gtoffice/docs` 不存 API key、provider secret。
- Agent prompt 默认只含选中 host block 与其邻接 1 跳；用户可主动扩大。
- 派发前 UI 必须展示将发送的上下文。
- Agent session cwd 仍在 workspace 内。
- HTML preview 不允许执行任意脚本（沿用 v0）。
- 文档支持 redaction 标记，导出时隐藏敏感业务词（沿用 v0 设计意图）。

## 14. 技术栈

继续使用 v0 已批准技术栈，不引新依赖：

- 前端：React 19、TypeScript、SCSS、`@tanstack/react-virtual`（缺口列表虚拟化）、现有 `lucide-react` 图标。
- Markdown 渲染：现有 `react-markdown` + `remark-gfm` + `rehype-highlight`（用于 brief 与 Agent 产出的只读块）。
- 图画布：**v1 不引第三方 graph 库**。SVG + CSS transform + 自研节点/边/拖拽。如 M3 实施中确认自研负担过大，先在 `docs/DEPENDENCIES.md` 记录用途、备选方案与影响范围，再讨论。
- 后端：Tauri v2 commands、Rust serde、现有 `gt-git` 模式（用于 `.gtoffice/docs` 的独立 docs repo）。
- Agent 调度：复用现有 terminal/session/task 基础设施，支持 `codex` / `claude`。
- 样式：仅 SCSS；响应式单位（`rem`），不用 `px`。

### 14.1 原生 API 使用边界（T1 / T3 收口）

T1 「seam at rendering surface」明确分工——以下行为强制走 Tauri 原生 API，**不**用 DOM 自画：

| 行为 | 实现 | 原因 |
|---|---|---|
| 导出文件保存对话框 | `dialog::save` (Tauri) | 已落地（v0 Phase 4/5），保留 |
| 文档导入文件选择 | `dialog::open` (Tauri) | 同上 |
| 删除文档 / 丢弃 patch 等破坏性确认 | `dialog::ask` / `confirm` (Tauri) | 不用自画 modal；OS 原生对话框是 native-feel 关键 |
| 错误提示（崩溃级） | inline banner（现状）+ 严重时 `dialog::message` | 不用自画 toast |

以下行为受 Tauri WebView 限制，**只能** in-WebView 实现，但需按 native 风格收口：

| 行为 | 限制 | 应对 |
|---|---|---|
| 画布右键菜单（加块） | Tauri 的 native context menu API 受限于版本/平台一致性 | 用 DOM 浮层模拟，但视觉严格按平台风格：macOS 圆角 + 系统字体 + 系统 accent；无 hover cursor pointer；Esc 关闭 |
| 缺口 / 节点 tooltip | Tauri 无独立 tooltip API | 用 DOM tooltip，延迟 500ms 出现，匹配系统 tooltip 风格；不用 popper.js |
| 下钻面板 | side panel 必须在 WebView 内（不是独立 NSPanel） | 见 §7.4：side-slide、无 backdrop、不 modal |

### 14.2 Design tokens 清单

所有 v1 新增视觉元素颜色 / 尺寸必须走 `--vb-*` token 体系，不允许硬编码：

```scss
// Designer-specific tokens (新增到 styles/tokens 体系)
--designer-node-bg              // 节点背景, 跟随深浅色
--designer-node-border          // 节点边框
--designer-node-border-selected // 选中节点边框, 用 system accent
--designer-node-shadow          // 节点阴影
--designer-edge-color           // 默认边色
--designer-edge-dependsOn       // dependsOn 关系色
--designer-edge-produces        // produces 关系色
--designer-edge-consumes        // consumes 关系色
--designer-edge-uses            // uses 关系色
--designer-edge-extends         // extends 关系色
--designer-gap-warning          // ⚠ 缺口色 (warning)
--designer-gap-error            // 缺口色 (error)
--designer-gap-resolved         // resolved ✓ 色
--designer-gap-introduced       // introduced ⚠ 色
--designer-canvas-bg            // 画布底色
--designer-canvas-grid          // 画布栅格(若实现)
--designer-focus-ring           // 焦点环, 用系统 accent
```

token 定义在 `styles/tokens/_designer.scss`，深浅色双套，与 system accent color 通过 CSS `accent-color` 或 OS 提供的变量同步。

### 14.3 Cost classification（T8 baseline vs margin）

T8 要求显式分类成本：

**Baseline（架构选择带来、不可减）**：
- Tauri WebView + WRY runtime（macOS WKWebView / Windows WebView2 内存）
- React 19 + 现有 React 树渲染（已有，v1 不增）
- SVG 图画布的 GPU 合成层（节点数 × 拖拽帧）
- `gap_rules` 在每次 validate 跑全图（O(blocks × rules)，可接受）

**Margin（v1 自己引入、必须 attack 满）**：
- 图画布拖拽 → 必须 transform-only 不触发 layout（§12.3）
- IPC 频率 → 必须按 §12.5 节流契约
- schema 漂移 → 必须按 §5.0 防漂移
- 重渲染 → React.memo / useMemo 节点列表，inspector 切换不重画图
- token 体系 → 不硬编码颜色，避免深浅色切换重画

明确分类后，v1 性能优化精力全部投入 margin，不在 baseline 上空转。

### 14.4 WebView 已知坑预防（继承 v0 shell 已处理项 + v1 新增）

v0 shell 层已经按 `references/03-webview-survival.md` 处理了启动闪白、视图切换闪烁等公共项，v1 在 designer 范围内额外注意：

- **路由切换不要 fade**：`features` 之间切换沿用项目现有 cut 切换（无 route fade，已合规）。designer 内部 sidebar / canvas / inspector / drill panel 之间也是 cut 切换，不加 fade。
- **滚动行为**：缺口长列表用 `overscroll-behavior: contain` 杀掉橡皮筋；不调 `scrollIntoView({ behavior: 'smooth' })`，用 `behavior: 'auto'`（瞬时跳转）。
- **CSS View Transitions**：v1 **禁用** View Transitions API（默认含中间淡出帧，违反 native cut 切换）。
- **字体 fallback prewarming**：图节点会出现中英混排（"订单"/"Order"），首次渲染中文 fallback 可能 stutter。在 `BusinessDesignerPane` 挂载时执行 prewarm（隐藏 span 含中英文 + 常用标点），与项目现有 prewarm 链路对齐。
- **拖拽期间不能触发 React state 频繁更新**：拖拽位置存在 ref / wrapper.style.transform，不进入 React 状态树，避免每帧 reconcile。

## 15. 待确认决策（v1 范围内）

以下决策 v1 已按倾向落定，记录在此供后续修订时回看：

1. **图节点位置存哪里？** 选 manifest.layout（B 方案）。
2. **brief 实体识别策略**：用户选中浮按钮，**不**自动 NLP（最小方案）。
3. **下钻视图**：右侧滑入式 side panel（与 inspector 并排），无 backdrop、不 modal——避免 web idiom 的全屏对话框感；保留画布上下文。
4. **relation 词表**：固定 5 种 `dependsOn` / `produces` / `consumes` / `uses` / `extends`，封闭。

## 16. 成功标准

v1 闭环完成的标志：

**范式硬约束**：
- 用户从一句「订单系统」brief 出发，经几次 Agent 补缺口，得到结构完备、规则全绿、可导出的需求包。
- 任何 AI 输出都被规则验证为 resolved/unresolved/introduced，无人为评分环节。
- `apply_agent_patch` 对 host 不命中的 patch 整体拒绝，不部分应用。

**身份连续性（T7）**：
- 现有 Phase 6 的 brief 文本入口、checkpoint 历史、导出、docs Git 全部保持可用。
- 旧文档加载即默认聚焦 brief 节点 + 自动展开下钻面板，视觉接近 Phase 6（迁移时无重建肌肉记忆成本）。
- v0 已发布的 i18n key、文档落盘格式、sidebar 信息密度不变。

**架构边界**：
- 实现不破坏 GT Office 现有模块边界（前端 features 边界、后端 commands 入口最小化）。
- 范式可扩展：后续加新 block kind 的 gap 规则只需加规则 struct + 注册一行，不动 command 表面。

**性能感知（T4）**：
- §12.1 表格中所有"用户动作 → 感知目标"必须实测达标；超标项必须有降级路径。
- 拖拽 60fps（DevTools Performance 录制确认）。
- 输入热路径无 IPC 阻塞（trace 显示输入到首屏 < 50ms）。

**IPC 纪律（T6）**：
- §12.5 4 条节流契约在代码 review 阶段全部 enforce；dev 模式 trace 不出现"一秒 30+ IPC"的红警。

**Native feel（T3 / T8）**：
- 通过 `references/06-native-conventions.md` 30 项中与 designer 相关的至少 25 项。
- 无 `cursor: pointer` 在 list-row（grep PR 检查）。
- 无 skeleton 占位符。
- 无 backdrop blur modal。
- 无 route fade transition。
- 颜色 100% 走 token，无硬编码 hex。

**Schema 防漂移（T2）**：
- `packages/shared-types` 含 v1 新增的 4 个数据结构 contract 测试。
- Rust serde struct 加 `#[serde(deny_unknown_fields)]`。
- CI 跑 typecheck + cargo check 双侧验证，单侧改 schema 即编译断。


---

## 附录 A：历史进度（v0）

> 以下为 v0 Phase 1–6 的开发进度记录，保留作为历史参考。v1 起的实现进度独立记录（建议另起 `BUSINESS_DESIGNER_V1_PROGRESS.md`）。

### 2026-06-11 Phase 1 底座

已完成：

- 新增业务设计器侧栏入口 `designer`，位置在文件管理之后、Git 协作之前。
- 新增 `apps/desktop-web/src/features/business-designer/` 前端 feature 骨架。
- 新增 `apps/desktop-tauri/src-tauri/src/commands/business_designer/` 后端命令底座。
- `business_designer_init_docs_repo` 在 workspace 内创建 `.gtoffice/docs` 与初始模板，并初始化独立 docs Git 仓库。
- `business_designer_list_documents` 列出文档并返回摘要、块数、诊断、docs repo 状态。
- 增加 Rust 单测覆盖未初始化、脚手架初始化、manifest 摘要读取与 manifest JSON 诊断。
- 前端通过 `desktopApi` 使用 typed contract 访问后端。

### 2026-06-14 Phase 2/3 可编辑底座

已完成：

- 扩展 `business_designer` 命令：`create_document`、`read_document`、`save_document`、`validate_document`、`compile_document`、`create_checkpoint`、`diff_checkpoint`、`preview_agent_task`。
- 新增文档落盘约定：`manifest.json` / `design.json` / `blocks/*.json` / `generated/*` / `patches/`。
- 新增编译器底座，生成 `README.md` / `agent-brief.md` / `agent-input.json` / `preview.html` / `contracts.md` / `acceptance.md`。
- 新增 schema 校验：schema version、document id 一致性、block id 唯一性、block kind、payload 对象、验收标准与 Agent 指令完整性。
- 新增 docs repo Git checkpoint 与 working tree diff（独立嵌套 repo，不影响 workspace 主 Git）。
- 前端从只读原型升级为可编辑工作台。
- 新增 Rust 单测覆盖 scaffold/list/create/read/save/compile/checkpoint/diff。

### 2026-06-14 Phase 4/5 Agent patch 与输出底座

已完成：

- 后端补齐 `run_agent_completion`、`validate_agent_patch`、`apply_agent_patch`、`export_document`、`list_checkpoints`。
- 新增 typed Agent patch 协议（`addBlock` / `updateBlock` / `deleteBlock`），含 `schemaVersion` / `documentId` / `baseRevision` / `summary` / `openQuestions`。
- Agent 建议先进入 `documents/<id>/patches/agent-patch-*.json`，UI 显示结构化 diff，用户选择性应用。
- 新增 checkpoint history 查询与 checkpoint-to-checkpoint 对比。
- 新增导出底座（`markdown` / `html` / `json` / `agentBundle`）。
- 新增编码 handoff 底座（Task Center dispatch + 任务拆分 + 附件引用）。
- 新增真实 task reply patch 回收底座。

已验证：`cargo test -p gtoffice-desktop-tauri business_designer`、`cargo clippy --workspace --all-targets -- -D warnings`、`npm run typecheck`、`git diff --check`。

仍未完成：

- `codex` / `claude` 真实端到端验证未做（v1 M4 必须补上）。
- 复杂 block 类型仍以 JSON textarea 为主。

### 2026-06-15 Phase 6 前端极简重写

**问题诊断**：v0 Phase 1–5 的前端是「伪装成桌面应用的网页 CMS」——16 块/3 栏/5 模式认知负担极重。

**重写核心思想**：文档即画布，Agent 是助手，按钮很少。

**已完成**：

- 后端完全不动（20 个命令、存储模型、编译器、checkpoint、patch、导出全部保留）。
- 整个需求正文压缩为单个 `text` 块（id=`brief`）。
- 删除旧 16 块/3 栏整套：`DesignerCanvas`、`DesignerBlockEditorFields`（716 行）、`DesignerOutline`、`DesignerInspector`、`DesignerAgentPanel`、`DesignerPatchReview`、`DesignerVersionStrip`、`DesignerDocumentList`、`model/designer-payload.ts`。
- 新建 6 个极简组件：`DesignerSidebar` / `DesignerDocument` / `DesignerToolbar` / `DesignerPatchSheet` / `DesignerStatusbar` / `BusinessDesignerPane`。
- 前端 TS/TSX 从 ~3700 行降到 ~2034 行，SCSS 从 1375 行降到 729 行。

已验证：`npm run typecheck`、`cargo check --workspace`、`cargo clippy`、`cargo test`（19 passed）、`git diff --check`。

**v1 视角的反思**：Phase 6 解决了「认知负担」，但把结构折回自然语言后，AI 又得猜。v1 在保留 Phase 6 brief 文本入口的前提下，把结构以「图节点 + 缺口」的形式请回来，让低门槛与可循结构两者并存。

### 2026-06-17 Phase 6 补全：checkpoint 历史与差异 UI

已完成：

- 新增 model 类型 `DesignerCheckpointEntry` / `DesignerCheckpointHistoryResult` / `DesignerDiffEntry` / `DesignerDiffResult`。
- `designerDesktopApi` 新增 `listDesignerCheckpoints` / `diffDesignerWorkingTree` / `compareDesignerCheckpoints`。
- 新增 `useDesignerHistory` controller 与 `DesignerHistorySheet` 浮动面板。
- `DesignerToolbar` 增加「历史」按钮。
- 新增 `designer.history.*` 中英 i18n。
- 后端零改动。

已验证：`npm run typecheck`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test -p gtoffice-desktop-tauri business_designer`（19 passed）、`npm run build:tauri`。

仍刻意未做（v1 接管）：

- `codex` / `claude` 真实端到端验证（v1 M4 必须）。
- Coding Handoff dispatch / task-patch recovery UI（v1 暂不进入 v1 范围，后续独立设计）。
- 正文 textarea 升级 Monaco（v1 仍延后；brief 文本是图根，保持 native textarea 的 T4 感知速度）。
