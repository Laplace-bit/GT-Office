# GT Office — 战略方向（v0.6 起生效）

> **生效日期**：2026-05-12
> **替代文档**：本文档替代 `PRODUCT_VISION.md` 中的旧产品定位。旧文保留作为历史参考。

---

## 1. 新定位

### 旧定位（已废弃）

> "AI Agent Desktop App — 多 Agent 协同工作台"
> "Agent Collaboration — 让多个 AI Agent 像人类团队一样协作"

### 新定位

> **Agent Workspace OS — 中国开发者使用 AI 编程 Agent 的最佳入口**

GT Office 的核心使命是成为 Claude Code、Codex CLI、Gemini CLI 等 AI 编程 Agent 在真实代码库里**最稳定、最懂 workspace、最有记忆**的桌面运行环境。

在全球市场，官方工具（Claude Agent View、Codex Desktop）正在蚕食第三方 GUI wrapper 的空间。但**在中国市场，官方工具不可用或受限**，GT Office 是连接中国开发者和世界级 AI Agent 的桥梁。

### 核心市场洞察

官方工具解决的是 **"有官方 API 的用户怎么更好地用 Agent"**。
GT Office 解决的是 **"没有官方 API 的用户怎么用上 Agent"**。
这是两个完全不同的市场。在后一个市场里，GT Office 没有官方竞争对手。

### 四层价值

| 层级 | 定义 | 作用 | 护城河 |
|------|------|------|--------|
| **Layer 1：Shell** | workspace + terminal + file + git + 一键启动 + 产出物管理 | 保命——用户日常工作的承载面 | 体验质量 + 组合价值（中） |
| **Layer 2：Provider 生态** | 供应商预设目录（12 家中国 + 16+ 全球）+ 微信/飞书 Channel | 降门槛——30 分钟折腾 → 30 秒上手 | 商务关系网络（强） |
| **Layer 3：Protocol** | gto — 独立的 Agent 间通信协议 | 建生态——开源 Agent 编排标准 | 网络效应（中） |
| **Layer 4：Data** | Agent 行为数据 — session 记录、行为分析、跨会话记忆 | 建壁垒——用户积累的数据无法迁移 | 数据壁垒（强） |

---

## 2. 战略冻结规则

自本文档生效起，以下领域**禁止新增功能**：

### 🔴 冻结（不新增，不扩展）

| 领域 | 原因 |
|------|------|
| Multi-agent orchestration 叙事功能 | 定位已被官方侵蚀 |
| Workbench 复杂交互（拖拽画布等） | 过重，偏离 Agent IDE Shell |
| 新增 detached surface / 跨窗口高级功能 | 复杂度过高，收益不足 |
| Git 高级操作（cherry-pick/revert/reset） | 非核心路径，维护成本高 |

### 🟡 维护（只修 bug，不加新功能）

| 领域 | 原因 |
|------|------|
| Task Center | 保留已有功能，但不继续扩展协作编排 |
| Station/Workbench 基础布局 | 保留作为 session 组织模型，不继续做"协作画布" |
| Telegram Channel | 全球市场有价值，但不优先投入 |
| 主题系统 | 保持现有主题，不新增 |

### 🟢 加强（集中投资）

| 领域 | 原因 |
|------|------|
| **Provider 预设目录** | Layer 2 护城河——最硬的壁垒，每多一家合作护城河厚一分 |
| **一键配置 → 启动体验** | 中国用户核心转化路径：选供应商 → 填 Key → 启动 Agent < 60 秒 |
| **微信/飞书 Channel** | 中国市场核心卖点——手机控制 Agent 的唯一通道 |
| Workspace 生命周期 | 产品第一主语 |
| Terminal session 管理与恢复 | 产品第二主语 |
| File browse + preview + basic edit | Agent 产出物管理的核心面 |
| Git 主路径（status/diff/commit/branch/merge） | Agent coding 的基础操作 |
| Tool install / launch / env bootstrap | 与普通终端管理器的关键区别 |
| 中英文 i18n | 中国市场需要中文 |
| gto 协议独立化 | Layer 3 护城河建设 |
| Agent session data 记录 | Layer 4 护城河种子 |
| 前端测试 | 零测试不可接受 |

---

## 3. 核心与可选能力分类

### 3.1 前端能力域

| 域 | 分类 | 说明 |
|----|------|------|
| `shell-core`（window/nav/layout） | **Core** | 壳骨架 |
| `workspace`（lifecycle/tabs/restore） | **Core** | 产品第一主语 |
| `terminal`（session/launch/recovery） | **Core** | 产品第二主语 |
| `file-explorer` + `file-preview` | **Core** | Agent 产出物管理 |
| `git` | **Core** | 基础 Git 操作（status/diff/commit/branch/merge） |
| `settings`（含 tool install + **provider 目录**） | **Core** | 环境配置 + 供应商生态 |
| `tool-adapter`（**微信/飞书 Channel**） | **Core (China)** | 中国市场核心——手机控 Agent |
| `task-center` | **Optional** | 降级为辅助面板 |
| `workspace-hub`（workbench 画布） | **Optional** | 降级为 session grid |

### 3.2 后端能力域

| 域 | 分类 | 说明 |
|----|------|------|
| workspace commands | **Core** | |
| terminal commands | **Core** | |
| filesystem commands | **Core** | |
| git commands | **Core** | |
| settings + ai config + **provider catalog** | **Core** | 供应商预设是核心资产 |
| agent install / tool profiles | **Core** | |
| **channel relay (WeChat/Feishu)** | **Core (China)** | 中国市场差异化 |
| task dispatch | **Optional** | |
| detached surface coord | **Optional** | |
| Telegram relay | **Maintained** | 不主动投入 |

### 3.3 `desktop-api.ts` 拆分目标

```
desktop-api.ts (3588行, 超级对象)
    ↓ 拆分为
├── workspaceApi.ts
├── terminalApi.ts
├── filesystemApi.ts
├── gitApi.ts
├── settingsApi.ts
├── agentToolApi.ts
├── channelApi.ts       ← 微信/飞书（Core China）
└── labsApi.ts          ← task / surface
```

---

## 4. 执行计划

### Phase 0：战略冻结 + Provider 加强（第 1-2 周）

- [x] 新产品定义文档（本文档）
- [ ] 停止所有冻结领域的开发
- [ ] Provider 目录 UI 优化——分类更清晰（中国/全球/免费试用）
- [ ] 一键配置体验打磨——选供应商 → 填 Key → 启动 Agent < 60 秒
- [ ] 主动联系更多供应商合作

### Phase 1：边界收缩 + 中国 Channel 加固（第 3-4 周）

- [ ] 拆 `desktop-api.ts` 为领域 API client
- [ ] 降级 task-center 为辅助面板
- [ ] 收缩 workspace-hub 角色
- [ ] 微信 bot 稳定性加固
- [ ] 飞书健康检查 UI 可视化
- [ ] Channel → Agent 反向控制体验优化

**验收**：主导航围绕 workspace / files / terminal / git / settings / channels

### Phase 2：核心壳加固（第 5-8 周）

- [ ] Terminal session 恢复稳定性
- [ ] Workspace 多工作区生命周期
- [ ] Git 主路径体验统一
- [ ] Tool install/launch 加固
- [ ] **补前端主路径测试**（controller hooks）

**验收**：用户无需 task/workbench 也能完成完整工作流

### Phase 3：护城河建设（第 6-12 周，与 Phase 2 部分并行）

- [ ] gto 独立化——去掉 GT Office runtime 强依赖
- [ ] gto standalone server mode
- [ ] Agent session data 自动记录（SQLite 落盘）
- [ ] Agent 行为分析基础 dashboard
- [ ] 跨 session 上下文继承 POC

**验收**：gto 可以在没有 GT Office 的情况下独立运行

### Phase 4：架构去债（持续，与其他 Phase 并行）

按以下优先级拆解：

1. `desktop-api.ts`（3588 行）
2. `useShellTerminalController.ts`（3296 行）
3. `useShellWorkspaceSessionController.ts`
4. `commands/tool_adapter/mod.rs`（3688 行）— 拆分但保留 WeChat/Feishu 为 Core
5. `app_state.rs`（4111 行）→ 收敛到 state assembly + domain handles

---

## 5. 决策原则

遇到功能取舍时，用这个决策树：

```
这个功能是否直接服务 workspace/session/terminal/file/git？
    ├── 是 → 评估是否值得投入
    └── 否 → 它是否在强化 Provider 生态 或 中国 Channel？
                ├── 是 → 评估是否值得投入（中国市场核心）
                └── 否 → 它是否在构建 gto 协议 或 agent 数据层？
                            ├── 是 → 评估是否值得投入（护城河）
                            └── 否 → 不做
```

---

## 6. 北极星用例

### 用例 A：中国开发者（核心市场）

1. 下载 GT Office → 打开 → 看到供应商目录（DeepSeek / 智谱 / Kimi / …）
2. 选择供应商 → 填 API Key → **30 秒完成配置**
3. 选择工作区目录 → 一键启动 Claude Code（自动注入 base_url + 环境变量）
4. Agent 写代码 → 旁边看文件变更、Git diff
5. 离开电脑 → 打开微信 → 给 Agent 发指令 → 手机查看进度
6. 下次打开 GT Office → 自动恢复所有 session

**差异化时刻**：步骤 1-3（官方 CLI 做不到中国供应商一键配置）和步骤 5（官方工具没有微信控制）。

### 用例 B：全球开发者

1. 打开 GT Office → 自动恢复上次的 workspace 和所有 terminal session
2. 看到 Agent 上次的工作进度摘要（session data 驱动）
3. 启动 Claude Code → Agent 继承上次的上下文（跨会话记忆）
4. 浏览文件、查看 diff、做 commit
5. 派一个任务给另一个 Agent（gto 协议）
6. 关闭 GT Office → 所有状态持久化

**差异化时刻**：步骤 2 和 3（跨会话记忆）、步骤 5（Agent 间通信协议）。

---

## 7. 竞争定位

| 竞品 | 它的优势 | GT Office 的优势 |
|------|---------|-----------------|
| Claude Agent View | 官方、深度集成 | **中国不可用**；GT Office 跨 Agent、workspace 持久化 |
| Cursor / Windsurf | 一体化 IDE 体验 | GT Office 不替代 IDE，而是**管理 CLI Agent 的产出物** |
| iTerm2 / Warp | 强终端体验 | GT Office 懂 Agent：一键启动、文件联动、Git 联动、session 持久化 |
| cc-switch (CLI) | 轻量切换 provider | GT Office 是**完整工作台**，不只是配置切换器 |
| 无（中国市场） | — | **12 家中国供应商预设 + 微信/飞书控制 = 无直接竞品** |
