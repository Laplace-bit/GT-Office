# GT Office Agent IDE Shell 架构核查与下一步计划

## 1. 结论

如果 GT Office 的新定位是 **Agent IDE Shell**，那现有架构并不是完全错误，而是**核心骨架可保留，产品重心和模块投资方向需要强制收缩**。

当前最有价值的资产不是多 agent 编排，也不是 channel relay，而是这几层：

- workspace 边界和会话恢复
- 真实 PTY terminal 承载 Claude Code / Codex CLI / Gemini CLI
- 文件浏览、预览、基础编辑
- Git 状态与常用操作
- 桌面壳能力：窗口、surface、恢复、系统集成

当前最危险的问题也很清楚：

1. 架构文档描述的“薄 command / 薄 shell / 清晰分层”与实际代码中心不一致
2. 多 agent workbench、channel、surface 机制已经把主壳拖得过重
3. 前后端边界过宽，`desktop-api.ts` 事实上变成了未治理的超级接口层
4. Shell 状态编排过度集中，继续加功能会越来越难稳

---

## 2. 现状核查

## 2.1 文档定义与现实代码不一致

架构文档把 GT Office 定义为“workspace + terminal + Git + multi-agent collaboration + tool adapters + external channels”的统一桌面壳，[ARCHITECTURE.md](./ARCHITECTURE.md#L5) 仍然沿用旧战略。

文档还写：

- `app_state.rs` 负责 “Global state assembly (no business logic)” [ARCHITECTURE.md](./ARCHITECTURE.md#L68)
- Tauri commands 是 “thin orchestration layer” [ARCHITECTURE.md](./ARCHITECTURE.md#L127)

但实际代码里：

- `app_state.rs` 有 **4111 行**
- `commands/tool_adapter/mod.rs` 有 **3688 行**
- `desktop-api.ts` 有 **3588 行**
- `useShellTerminalController.ts` 有 **3296 行**

这说明现状不是“分层良好但产品方向待调”，而是**产品方向变化已经反向污染了架构边界**。

## 2.2 前端投入重心偏离 Agent IDE Shell

按 feature 代码量看：

- `workspace-hub` 约 **8554 行**
- `settings` 约 **5055 行**
- `git` 约 **5077 行**
- `tool-adapter` 约 **4071 行**
- `file-explorer` 约 **4020 行**
- `terminal` 约 **3694 行**
- `task-center` 约 **2181 行**

其中 `workspace-hub` 是最大前端 feature。这说明当前前端中心更接近“多角色 workbench”，而不是“稳定的 agent IDE shell”。

同时，`useShellWorkspaceSessionController.ts` 的入参已经吸收了 workspace、terminal、file、station、workbench、task、external channel 等多域状态，[useShellWorkspaceSessionController.ts](../apps/desktop-web/src/shell/layout/useShellWorkspaceSessionController.ts#L57) 到 [useShellWorkspaceSessionController.ts](../apps/desktop-web/src/shell/layout/useShellWorkspaceSessionController.ts#L128) 说明 shell controller 已经成为跨域编排中心。

这在旧定位下还能解释为“总控台”，但在 Agent IDE Shell 定位下，这是明显过载。

## 2.3 后端投入重心偏离 Agent IDE Shell

Tauri command 代码量上：

- `tool_adapter` 约 **8033 行**
- `settings` 约 **1670 行**
- `file_explorer` 约 **1639 行**
- `git` 约 **1319 行**
- `workspace` 约 **859 行**
- `terminal` 约 **535 行**
- `task_center` 约 **287 行**

这说明后端最重的不是 terminal、workspace、filesystem、git，而是 channel / tool adapter。

而 `commands/tool_adapter/mod.rs` 头部直接拉入：

- channel binding
- connector health
- Telegram / Feishu / WeChat connector
- external inbound / outbound
- terminal write-through

见 [tool_adapter/mod.rs](../apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs#L1) 到 [tool_adapter/mod.rs](../apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs#L220)。

这不是 Agent IDE Shell 的核心路径，而是历史战略遗留的重资产。

## 2.4 `desktop-api.ts` 已经成为产品边界失控的证据

`desktop-api.ts` 暴露了：

- workspace API
- git API
- fs/search API
- settings / ai config API
- tool profiles / launch API
- agent install API
- detached surface / bridge / topmost / drag / window API
- terminal lifecycle API

相关片段见 [desktop-api.ts](../apps/desktop-web/src/shell/integration/desktop-api.ts#L2238) 到 [desktop-api.ts](../apps/desktop-web/src/shell/integration/desktop-api.ts#L2785)。

它的事实角色已经不是“桌面集成层”，而是 **整个产品的超大协议入口**。这会带来两个后果：

1. 前端很难按产品边界裁剪能力
2. 后端能力只要一暴露，就很容易被 UI 接进去，继续扩面

## 2.5 `AppState` 还是系统耦合中心

`AppState` 当前同时持有：

- workspace service
- terminal provider
- git service
- settings service
- task service
- daemon bridge
- window/workspace binding
- watcher registry
- external reply session
- terminal debug log
- MCP snapshot
- AI config preview cache

见 [app_state.rs](../apps/desktop-tauri/src-tauri/src/app_state.rs#L449) 到 [app_state.rs](../apps/desktop-tauri/src-tauri/src/app_state.rs#L489)。

这个集合本身不是问题，问题是与之配套的方法已经开始吸收行为。文档说这里不承载业务逻辑，但现实已经在逐步滑坡。

---

## 3. Agent IDE Shell 视角下的模块判断

## 3.1 必须保留并继续加固

### A. Workspace

必须保留，且应该成为产品第一主语。

原因：

- 所有 terminal / file / git 都天然依附 workspace
- workspace restore 是桌面壳价值的一部分
- 对 CLI agent 而言，workspace 比“agent team”更稳定

### B. Terminal runtime

必须保留，且应该成为产品第二主语。

原因：

- Claude Code / Codex CLI 的原生界面仍然首先发生在 terminal
- GT Office 如果不是强 terminal 壳，就失去最硬的价值锚点

### C. Files + Preview + Basic Edit

必须保留，但目标是“足够强”，不是“追赶完整 IDE”。

保留理由：

- terminal 驱动的 agent workflow 仍需要快速看文件、打开 diff、改少量内容
- 但不应继续无限扩 editor surface

### D. Git

必须保留，但应该收敛为“agent coding workflow 的基础 Git 面板”。

保留理由：

- status / diff / commit / branch 切换直接服务 agent coding
- 复杂可视化不是核心护城河

### E. Provider / tool install / env bootstrap

必须保留。

这是 Agent IDE Shell 与普通终端管理器的关键区别：它理解 Claude/Codex/Gemini 的安装、启动和上下文。

## 3.2 应降级为次要能力

### A. Task Center

保留，但从“多 agent 协作系统”降级为“轻量 task / prompt dispatch / notes”。

### B. Workbench / Station system

保留最小版本，但必须从“协作画布”降级为“terminal session organization model”。

也就是说：

- `station` 可以继续存在
- 但它的意义应该是 session / profile / role slot
- 不是产品的主叙事

## 3.3 应从核心路线移出

### A. External Channels

`tool-adapter` / Telegram / Feishu / WeChat 不应该再位于核心主线。

处理建议：

- 进入 `Labs` / `Optional` / `Enterprise add-on`
- 从 shell 的一级导航和核心控制器剥离

### B. Agent orchestration story

不再继续投资“Agent 团队操作系统”叙事，也不再以此驱动新架构。

### C. 复杂 detached surface 体系

多窗口、detached terminal、bridge、surface topmost、跨窗口拖放这些能力不一定要删除，但必须降级。

如果它们继续压在主路径上，会持续抬高 shell 复杂度。

---

## 4. 目标架构

## 4.1 产品层重定义

GT Office 新定义应是：

**A desktop shell for AI coding agents across real workspaces.**

产品主路径只围绕这 5 个对象：

1. Workspace
2. Session
3. Terminal
4. File
5. Git

其他能力都必须解释自己如何直接服务这五个对象，否则不进主架构。

## 4.2 前端目标分层

前端应收敛为 4 个主域：

1. `shell-core`
   - window frame
   - navigation
   - layout persistence
   - current workspace/session context

2. `workspace-runtime`
   - workspace tabs
   - restore / switch / detach policy
   - session snapshot

3. `agent-runtime`
   - terminal sessions
   - tool launch
   - provider env
   - station/profile model

4. `developer-surfaces`
   - files
   - preview
   - git
   - settings

建议降级为 optional feature 的域：

- `channels`
- `task-center`
- `workbench-labs`

## 4.3 后端目标分层

Tauri 后端应收敛成以下能力组：

### Core

- workspace
- terminal
- filesystem
- git
- settings
- agent install / tool profiles

### Optional

- task dispatch
- channel relay
- external inbound
- detached surface coordination

### Integration boundary

将 `desktop-api.ts` 拆成面向产品边界的客户端：

- `workspaceApi`
- `terminalApi`
- `filesystemApi`
- `gitApi`
- `settingsApi`
- `agentToolApi`
- `labsApi`

这样前端自然知道什么是主路径，什么是附加能力。

---

## 5. 关键架构问题与处置

## 5.1 `desktop-api.ts` 过大

问题：

- 所有能力平铺暴露
- 主路径与实验能力没有边界

下一步：

- 拆成按领域导出的 API client
- 在 UI 层禁止直接继续扩一个超级对象

## 5.2 Shell controller 过载

问题：

- `useShellWorkspaceSessionController.ts`
- `useShellTerminalController.ts`

已经吸收过多跨域状态。

下一步：

- 把 workbench/detached/channel 相关流程从主 controller 拆走
- 主 controller 只保留 workspace/session/terminal 关键路径

## 5.3 `tool_adapter` 投入与新定位不匹配

问题：

- 后端最大 feature 不是 shell 核心

下一步：

- 停止继续增加 channel 类型和复杂度
- 迁移为 optional module
- UI 上从一级主导航移出

## 5.4 Workbench 的概念过重

问题：

- `workspace-hub` 是最大前端模块
- 当前设计更像多 agent 指挥画布

下一步：

- 保留 station/session 组织能力
- 删弱“中央角色画布（核心）”这类叙事
- 回到更朴素的 session grid / terminal group

## 5.5 架构文档需要重写

问题：

- 当前 `ARCHITECTURE.md` 还在强化旧战略

下一步：

- 重写 overview、frontend features、crate descriptions
- 明确主路径与 optional 能力

---

## 6. 下一步计划

## Phase 0：战略冻结（1 周）

目标：先停错方向。

动作：

- 停止新增 multi-agent collaboration 叙事功能
- 停止新增 channel / connector 扩展
- 停止新增复杂 workbench 交互
- 明确 Agent IDE Shell 的产品定义和北极星用例

产出：

- 新版产品定义文档
- 主路径能力清单
- optional/labs 能力清单

## Phase 1：边界收缩（2-3 周）

目标：把核心路径和附加路径拆开。

动作：

1. 拆 `desktop-api.ts`
2. 把 `channels` 从主导航和主 controller 依赖里移到 optional
3. 将 `task-center` 降级为辅助面板
4. 收缩 `workspace-hub` 的产品角色，把它改名或改义为 session/workspace 布局能力

验收：

- 主导航只围绕 workspace / files / terminal / git / settings
- channel/task/workbench 不再定义产品首页叙事

## Phase 2：核心壳加固（3-5 周）

目标：让 GT Office 成为稳定的 agent desktop shell。

动作：

1. 聚焦 terminal/session 恢复稳定性
2. 聚焦 workspace 切换与多 workspace 生命周期
3. 精简 editor surface，只保留高频需要
4. 统一 Git 主路径体验：status / diff / stage / commit / branch
5. 强化 tool install / launch / env bootstrap

验收：

- 用户可以稳定打开 workspace、启动 agent、看文件、改文件、做 Git 操作、恢复会话
- 不依赖 task/channel/workbench 也能成立

## Phase 3：架构去债（并行推进，4-8 周）

动作：

1. 把 `tool_adapter` 拆成独立 optional backend module
2. 收敛 `AppState` 到真正的 state assembly + domain handles
3. 重新划分 shell controller ownership
4. 为 workspace/session/terminal/git 主路径补测试

优先顺序：

1. `desktop-api.ts`
2. `useShellTerminalController.ts`
3. `useShellWorkspaceSessionController.ts`
4. `commands/tool_adapter/mod.rs`
5. `app_state.rs`

---

## 7. 最终建议

GT Office 现在最应该做的不是证明“它也能做多 agent 协作”，而是证明：

**它是 Claude Code / Codex CLI / Gemini CLI 在真实代码库里最好用、最稳定、最懂 workspace 的桌面壳。**

如果按这个目标重审架构，那么结论很简单：

- 核心骨架能保留
- 但主叙事、主导航、主 controller、主 backend 投入都要收缩
- 必须把 `workspace + terminal + files + git + tool bootstrap` 重新拉回系统中心

只有这样，GT Office 才不会继续被旧战略拖着走。
