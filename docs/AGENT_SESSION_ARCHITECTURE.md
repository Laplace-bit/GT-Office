# Agent Session 架构设计

> **版本**：草案 v1.0  
> **日期**：2026-05-24  
> **状态**：设计文档（未实现）  
> **Provider 范围**：**Claude Code + Codex CLI**（Gemini CLI 已下线，见 [GEMINI_CLI_DEPRECATION.md](./GEMINI_CLI_DEPRECATION.md)）

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| **统一身份** | 每次从 GT Office 发起的协作有稳定的 `gtoSessionId` |
| **Idle 可见历史** | Agent 未启动时，Station 默认展示该 Agent 在本 workspace 的历史 Session |
| **一键恢复** | 点击历史 Session → 新建 PTY → Provider 原生 resume 接上对话 |
| **透明闭环** | 观察 → 记录 → 可视化 → 恢复 → 审计 |
| **数据壁垒** | Session 元数据与时间线落在 GT Office（SQLite），不完全依赖 Provider |

**核心判断**：

> GT Office 的壁垒不是「能启动 Claude」，而是 **唯一记得你在哪个 workspace、哪个 Agent、哪次 Session 做到哪、改了什么、怎么验的**。

---

## 2. 现状：三层 Session

```text
Layer 0  GtoSession          GT Office 账本（待建）— 产品主键
Layer 1  Terminal Session    terminalSessionId — PTY，App 关闭即失效
Layer 2  Runtime Binding     agentId ↔ terminalSessionId（内存）
Layer 3  Provider Session    Claude jsonl / Codex rollout — 磁盘持久
```

| 层级 | 现有实现 | 问题 |
|------|----------|------|
| Terminal | `gt-terminal` | `session.snapshot.json` 存 id，重启后 PTY 已死 |
| Runtime | `AgentRuntimeRegistration` | `provider_session` 多为 Channel 场景绑定 |
| Provider | `gt-session-log` | 能读日志，未产品化为列表 + 恢复 |

**用户需求本质**：以 Layer 3 为对话真相，用 Layer 0 索引体验，Layer 1 仅为运行时载体。

---

## 3. CLI Provider Session 机理

### 3.1 Claude Code

- **存储**：`~/.claude/projects/<project-key>/*.jsonl`，`sessions-index.json`
- **恢复**：TUI `/resume`（GT Office 已有 quick command）
- **绑定**：`gt-session-log::ClaudeSessionBinding`（prompt 指纹锚定）

### 3.2 Codex CLI

- **存储**：`~/.codex/sessions/.../rollout.jsonl`，`session_meta` 含 `id` 与 `cwd`
- **恢复**：`/resume` 或 `codex exec resume --last`（Channel 已用）
- **绑定**：`gt-session-log::CodexSessionBinding`

### 3.3 恢复 ≠ 复活 PTY

正确流程：

1. 创建新 Terminal Session  
2. 启动 `claude` / `codex`  
3. 注入 Provider resume 命令（带 `providerSessionId` / log 路径）  
4. 绑定 `gtoSessionId` ↔ `providerSessionId` ↔ `terminalSessionId`

---

## 4. 总体架构

```text
┌─ UI ─────────────────────────────────────────────────────────┐
│  Station Idle：Session 列表 + 新建                          │
│  Station Live：Terminal + Activity                          │
│  Session Detail：时间线 / 文件 / 验证                       │
└───────────────────────────┬────────────────────────────────┘
                            │ session.* commands
┌─ Domain: gt-agent-session (新建) ──────────────────────────┐
│  SessionRegistry │ ProviderSessionDiscovery                │
│  SessionBindingService │ SessionObserver │ TimelineStore   │
└───────┬───────────────────────┬────────────────────────────┘
        │                       │
   gt-session-log          gt-terminal / gt-git / fs watcher
        │                       │
   ~/.claude / ~/.codex      changefeed / gto task
        │
   SQLite + .gtoffice/sessions/
```

---

## 5. 核心数据模型

### 5.1 GtoSession

```text
gtoSessionId          UUID，永久不变
workspaceId, agentId, stationId
provider              claude | codex
providerSessionId, providerLogPath
terminalSessionId     仅 active 时有值
lifecycle             draft | active | paused | ended | archived
title, goalSummary, cwd
startedAtMs, endedAtMs, lastActivityAtMs
discoverySource       gto_launch | provider_scan | channel | import
bindConfidence        high | medium | low
stats                 filesTouched, gitCommits, verificationCount, ...
```

### 5.2 SessionEvent（时间线）

| kind | 含义 |
|------|------|
| `session.created` / `session.bound` / `session.activated` | 生命周期 |
| `prompt.user` / `prompt.assistant` | 来自 session-log |
| `file.changed` / `git.snapshot` | 工作区 |
| `verify.run` | test/build 命令 |
| `task.gto` / `channel.message` | 协作与 Channel |

---

## 6. 发现与绑定

**Discovery（Idle 列表）**：

1. 查 SQLite 已入账 `GtoSession`  
2. 扫描 Provider 存储（cwd = Agent workdir）  
3. `gt-session-log` 产出 `ProviderSessionCandidate`  
4. 按 `providerLogPath` / `providerSessionId` 去重合并  

**Binding**：

| 场景 | 行为 |
|------|------|
| New | 建 GtoSession → PTY → 启动 CLI → 发现新 Provider Session → bind |
| Resume | 选历史 → PTY → CLI → `/resume` 或 codex exec resume → bind |

---

## 7. 生命周期

```text
draft → active → paused → ended → archived
         ↑___________|
              Resume
```

- App 重启：原 `active` **批量转 `paused`**，不假装 PTY 仍存活  
- UI 诚实标注：「需点击恢复对话」

---

## 8. UI：Station 三态

**Idle（未启动）**：

```text
[ + 新会话 ]
── 最近会话 ──
● 修复 Git panel 崩溃     2h前  [恢复]
○ 接入 webhook             昨天  [恢复]
```

**Live**：Terminal + 绑定 `gtoSessionId` 的活动信号  

**Detail**：完整 SessionEvent 时间线  

---

## 9. 可观测性闭环（O-R-V-R-A）

```text
Observe → Record → Visualize → Resume → Audit
```

| 环 | 数据源 |
|----|--------|
| Observe | session-log poll、VT/human log、git、fs、gto、channel |
| Record | `session_events` 表 + 可选 `summary.md` |
| Visualize | Idle 卡片、Live Comet、Detail Timeline |
| Resume | `session.launch(resume)` + Provider 命令编排 |
| Audit | 统计、常改路径、验证通过率 |

---

## 10. API 契约（规划）

| Command | 用途 |
|---------|------|
| `session.list` | 按 workspace + agent 列 Session |
| `session.get` / `session.timeline` | 详情与事件 |
| `session.launch` | `mode: new \| resume` |
| `session.pause` / `session.end` | 结束 PTY，保留账本 |
| `session.discover` / `session.import` | 扫描与入账 |

事件：`gtoffice:session-activity`、`gtoffice:session-state-changed`

gto CLI：`gto session list`、`gto session resume --session-id`

---

## 11. 恢复策略矩阵

| 情况 | 对话 | 终端画面 |
|------|------|----------|
| Provider Session 完整 | ✅ resume | ❌ 新 PTY |
| Provider 已删 | ❌ | 仅 GTO 只读时间线 |
| 低置信 bind | ⚠️ 用户确认 | ❌ |

---

## 12. 实施阶段

| 阶段 | 交付 |
|------|------|
| **P0** | `gt-agent-session` + SQLite + Discovery（Claude/Codex）+ Idle 列表 |
| **P1** | `session.launch(resume)` + Provider resume 编排 |
| **P2** | SessionObserver + Timeline |
| **P3** | Summary + 恢复前摘要 + Workspace Sessions 视图 |
| **P4** | Verification Ledger 事件 + Audit 统计 |

**不做**：多 Agent 协作画布、完整 PTY scrollback 持久化作为恢复依据、Gemini 相关路径。

---

## 13. 与现有模块关系

| 现有 | 角色 |
|------|------|
| `workspace.session.snapshot.json` | 仅 UI 布局；可扩展记录 `lastActiveGtoSessionIds` |
| `tool_launch` | 委托 `session.launch` |
| `gt-session-log` | Provider 文本真相 + Discovery 实现 |
| `gt-changefeed` | 升级为 SessionEvent 生产者 |
| `AgentRuntimeRegistration` | 增加 `gtoSessionId` 字段 |

---

## 14. 原则

1. 对话内容以 Provider Session 为准；GTO 以账本 + Timeline 为准  
2. PTY 可弃、可替换  
3. Discovery 先于漂亮 UI  
4. 低置信 bind 必须用户确认  
5. 逻辑下沉 `gt-agent-session`，不膨胀 `app_state`  
