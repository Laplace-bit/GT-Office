# GT Office 产品愿景与改进蓝图

> "Design is not just what it looks like and feels like. Design is how it works." — Steve Jobs

## 灵魂

GT Office 的灵魂是 **Agent Collaboration** — 让多个 AI Agent 像人类团队一样协作。

不是又一个 AI 编辑器。不是又一个终端工具。而是一个 **AI 团队的操作系统**。

用户打开 GT Office，看到的应该是一个正在运转的团队：DEV 在写代码，EVAL 在审阅，BOSS 在调度。Agent 之间有任务流转、有状态变更、有实时协作的可视化。

## 当前状态（v0.3.1 审计）

### ✅ 已兑现的承诺
- Agent-to-Agent 通信（gto CLI，完整 REPL 模式，`--wait` 同步等待）
- 三方频道代理（Telegram/Feishu/WeChat，全部生产级质量）
- 多工作区、文件浏览器、终端、Git 集成
- AI Provider 配置（preview → validate → confirm → apply → audit 生命周期）
- 拖拽式 Workbench 布局

### ⚠️ 半兑现
- 对抗式推理：Generator/Evaluator 角色存在，但无自动化编排流程
- 渠道健康检查：代码里有，用户界面里看不到

### ❌ 缺失的关键体验
- 首次启动没有引导（空白工作区 → 用户茫然）
- CONTRIBUTING.md 链接指向不存在的文件
- 依赖 allowlist 与实际依赖不同步

### 🔴 架构风险
| 文件 | 行数 | 风险 |
|------|------|------|
| `ShellRoot.tsx` | 6,381 | 前端心脏，任何改动都有蝴蝶效应 |
| `app_state.rs` | 3,593 | 业务逻辑堆在应用壳里，违反自身架构原则 |
| `tool_adapter/mod.rs` | 3,567 | 渠道消息推送3层降级策略藏在状态管理里 |

---

## P0：让灵魂被看见

### 0.1 拆分 ShellRoot.tsx

**目标**：将 6,381 行的单体文件拆为 controller 层 + 视图层。

**原则**：
- 现有 hooks（`useShell*Controller.ts`）已经是正确的方向，但 ShellRoot 仍在做太多
- 目标结构：
  - `ShellRoot.tsx` → 纯视图组合（< 200 行）
  - `useWorkspaceController.ts` → 工作区生命周期
  - `useTerminalController.ts` → 终端会话管理
  - `useTaskDispatchController.ts` → 任务派发
  - `useChannelBindingController.ts` → 渠道绑定
  - `useExternalReplyController.ts` → 外部回复流转

**验收标准**：
- [ ] ShellRoot.tsx < 300 行
- [ ] 所有原有功能不变
- [ ] tsc 编译通过
- [ ] 现有测试通过

### 0.2 Agent 协作可视化

**目标**：当 Agent A 给 Agent B 发任务时，用户能看到任务流转。

这是产品的灵魂时刻。目前 Agent 间通信是静默的——用户只能通过终端输出推断发生了什么。

**设计方向**：
- 任务卡片上的状态徽章（dispatched → received → in-progress → replied → handover）
- Agent 之间的轻量连线动画（任务从一个 station 流向另一个）
- 任务中心里的实时时间线视图

**验收标准**：
- [ ] 任务派发时，目标 Agent 的 station 卡片有视觉反馈
- [ ] 任务状态变更反映在任务时间线上
- [ ] 不影响现有性能

---

## P1：让新用户 5 秒理解价值

### 1.1 首次启动引导

**目标**：3 步让用户看到 Agent 协作的价值。

**流程**：
1. 选择工作区目录
2. 创建第一个 Agent（预设模板：DEV + EVAL）
3. 观看它们协作（内置 demo 场景或引导任务）

**验收标准**：
- [ ] 全新用户（无 .gtoffice 目录）首次启动看到引导界面
- [ ] 3 步内完成首次 Agent 创建
- [ ] 引导完成后能立即看到 Agent 间任务流转

### 1.2 补全 CONTRIBUTING.md

README 链接了它但文件不存在。这是对贡献者的断路器。

**验收标准**：
- [ ] CONTRIBUTING.md 存在且内容实质
- [ ] 包含：环境要求、构建步骤、代码规范、PR 流程、测试要求

### 1.3 依赖 allowlist 同步

DEPENDENCIES.md 列了未实际使用的包（`cmdk`, `zustand`, `@tanstack/react-query` 等），实际使用的包（`@git-diff-view/react`, `@chenglou/pretext`）未列出。

**验收标准**：
- [ ] DEPENDENCIES.md 与 package.json + Cargo.toml 同步
- [ ] 移除未使用依赖或标注为"计划使用"
- [ ] 补充未列出但实际使用的依赖

---

## P2：让已有功能发光

### 2.1 对抗式推理自动化编排

**目标**：Generator/Evaluator 不只是角色名，而是能自动跑起来。

**流程**：
1. 用户创建一个"对抗式任务"
2. 系统自动分配给 Generator（生成方案）
3. Generator 完成后自动转发给 Evaluator（评审）
4. Evaluator 评审结果反馈给 Generator（迭代或通过）
5. 最终结果交付给用户

**验收标准**：
- [ ] 任务中心支持"对抗式任务"类型
- [ ] Generator/Evaluator 角色自动编排
- [ ] 至少一轮迭代后自动交付

### 2.2 渠道健康看板

**目标**：让用户看到渠道连接器的运行状态。

**设计方向**：
- 每个渠道卡片显示：连接状态、最后同步时间、消息计数
- 健康检查结果直接反映在 UI 上（绿色/黄色/红色）

**验收标准**：
- [ ] 渠道管理界面显示实时连接状态
- [ ] 健康检查结果可视化

### 2.3 gto CLI 独立文档站

`gto` 是杀手级功能但被淹没在主 README 里。

**验收标准**：
- [ ] `docs/gto-cli-guide.md` 完整文档
- [ ] 包含所有命令的用法和示例
- [ ] 包含典型工作流场景

---

## 架构改进（持续推进）

### A. 业务逻辑下沉

`app_state.rs` 和 `tool_adapter/mod.rs` 中的业务逻辑应当沉淀到对应的 domain crate：
- 外部回复流转逻辑 → `gt-task` 或新建 `gt-channel-relay`
- VT 解析和 rendered screen snapshot → `gt-session-log`
- 交互提示处理 → `gt-agent`

### B. 异步锁改造

6 个 `Arc<Mutex<HashMap<...>>>` 改为 `tokio::sync::RwLock`，避免重流量下的死锁和争用。

### C. 测试补全

优先为以下模块补充测试：
- Telegram/WeChat 渠道连接器（目前只有 Feishu 有测试）
- `tool_adapter/mod.rs` 的消息推送3层降级
- ShellRoot 拆分后的 controller hooks

---

## 执行原则

1. **小步快跑**：每个改动独立、可验证、可回滚
2. **先做看得见的**：P0 的可视化和重构优先，因为它们解锁所有后续创新
3. **不猜**：改动前先读代码，不确定就问
4. **守住底线**：每个 PR 必须通过 typecheck + build + 现有测试