# gto CLI 改进方案

> 版本：v1.0 | 日期：2026-04-19 | 作者：Hermès + dzlin

## 目标

将 gto CLI 从"只能发任务和看收件箱"升级为 **Agent 操作平台的完整接口**，让 Agent 能通过 CLI 完成所有基础操作：管理工作区、管理 Agent 生命周期、收发任务、查看状态。

核心原则：**gto 是 Agent 的手和脚**。Agent 不通过 UI 操作平台，只通过 gto。

---

## 一、现有问题审计

### 1.1 命令层级不统一

| 问题 | 说明 |
|------|------|
| `gto agents` vs `gto agent list` | 数据源不同，前者走 `directory.snapshot`，后者走 `agent.list` backend。前者缺少 roleId/state/tool 详情 |
| 顶层 `send/inbox/thread/wait` 与子命令并存 | 人类友好的顶层快捷方式 + `agent` 子命令下的 `send-task/reply-status/handover` 重复但不一致 |

**决策**：保留顶层快捷方式（对人类友好），同时让 `agent send-task` 等子命令共享实现。`gto agents` 统一使用 `agent.list` backend。

### 1.2 Help 系统坏了

```
gto agent --help → "Unknown command: agent --help"
gto role --help → "Unknown command: role --help"
gto channel --help → "Unknown command: channel --help"
```

子命令组没有自己的 help 文本，新用户无法发现可用命令。

### 1.3 命名不一致

| 当前 | 问题 | 决策 |
|------|------|------|
| `gto agent delete` | 与 `gto role remove` 不一致 | → 改为 `gto agent remove` |
| `gto agent prompt read` → 被压成 `prompt-read` | 两个动词用连字符，OK | 保持 |

### 1.4 缺少关键操作

| 缺失能力 | 后端有 | gto 没有 |
|----------|--------|----------|
| Workspace 管理 | `workspace_open/close/list/switch_active/get_context/get_window_active/restore_session/reset_state` | ❌ 无法 CLI 开/关/切换工作区 |
| Agent 启动/停止 | `terminal_create/kill/write/resize` + agent binding | ❌ 无法 CLI 启动或停掉一个 agent |
| workspace-id 每次必传 | — | ❌ 没有快捷获取当前活跃工作区的方式 |

### 1.5 Bridge 路由不完整

gto 通过 `~/.gtoffice/mcp/runtime.json` 找到 Tauri app 的 bridge 端口通信。目前 bridge 只暴露了 `agent.*` 和 `agent.role_*` 方法。workspace、terminal、task_center 的 Tauri commands 还没有对应的 bridge routes。

### 1.6 输入体验差

- `gto send DEV BOSS "hello"` — 位置参数容易搞混
- `gto agent create --role-id <UUID>` — 用户记不住 UUID
- 所有接受 agent-id 的地方，都不支持按 name 查找（只有 `send/inbox/wait` 的顶层快捷方式做了 name 解析，子命令没有）

---

## 二、改进方案

### Phase 1: 修 Bug + 补齐 Bridge（基础设施）

#### 1.1 修复 Help 系统

每个命令组增加独立 help：

```
gto agent --help
  list            List agents in workspace
  get             Get agent details
  create          Create a new agent
  update          Update agent fields
  remove          Remove an agent
  prompt-read     Read agent prompt file
  start           Start agent terminal session
  stop            Stop agent terminal session
  restart         Restart agent terminal session
  status          Show agent runtime status
  send-task       Send a task to another agent
  reply-status    Reply with status update on a task
  handover        Hand over a task with summary
  inbox           List task threads for an agent
  task-thread     View a task thread detail

gto workspace --help
  list            List all workspaces
  open            Open a workspace from path
  close           Close a workspace
  switch          Switch active workspace
  current         Show current active workspace
  info            Get workspace context details

gto role --help
  list            List roles
  create          Create a role
  update          Update role fields
  remove          Remove a role

gto channel --help
  send            Send a channel message
  list-messages   List channel messages

gto directory --help
  snapshot        Take a directory snapshot
```

顶层 help 更新：

```
gto --help
gto: local GT Office agent CLI

Top-level shortcuts
  gto agents                      List agents (alias for: gto agent list)
  gto send <from> <to> <text>     Send a task between agents
  gto inbox <agent>               Check agent inbox
  gto thread <taskId>              View task thread
  gto wait <taskId> --from <agent> Wait for task reply

Command groups
  gto workspace ...               Workspace management
  gto agent ...                    Agent CRUD and lifecycle
  gto role ...                     Role management
  gto channel ...                  Channel messaging
  gto directory ...                Directory snapshot

Options
  --workspace-id <id>             Workspace ID (or set GTO_WORKSPACE_ID)
  --json                          Output as JSON
  --help / -h                     Show help
```

#### 1.2 统一 `gto agents` 数据源

`gto agents` 顶层快捷方式改为调用 `agent.list` backend（与 `gto agent list` 一致），不再走 `directory.snapshot`。

#### 1.3 补齐 Rust Bridge Routes

在 `tool_adapter` 或专用 bridge 模块中注册以下 route：

| Bridge Method | 映射 | 说明 |
|---|---|---|
| `workspace.list` | `workspace_list` | 直接映射 |
| `workspace.open` | `workspace_open` | 直接映射 |
| `workspace.close` | `workspace_close` | 直接映射 |
| `workspace.switch_active` | `workspace_switch_active` | 直接映射 |
| `workspace.get_context` | `workspace_get_context` | 直接映射 |
| `workspace.get_window_active` | `workspace_get_window_active` | 直接映射 |
| `workspace.restore_session` | `workspace_restore_session` | 直接映射 |
| `workspace.reset_state` | `workspace_reset_state` | 直接映射 |
| `agent.start` | **复合 command** | 组合 terminal_create + agent binding + 写 prompt file |
| `agent.stop` | 组合 terminal_kill + unbinding | |
| `agent.restart` | stop then start | CLI 端编排，先 stop 再 start |

**`agent.start` 复合 command 的设计**：

```rust
// 新增 Tauri command: agent_start
// 步骤：
// 1. 验证 agent 存在、state 不是 terminated
// 2. 确认 workspace 已打开
// 3. 创建 terminal session (terminal_create)
// 4. 绑定 agent 到 terminal
// 5. 启动 agent 进程（根据 tool: codex/claude/gemini 选择对应 CLI）
// 6. 返回 { agentId, sessionId, pid?, status: "online" }
//
// 原子性：如果任何步骤失败，回滚已创建的 terminal 和 binding
```

在 TypeScript bridge client (`agent_backend.ts`) 中添加：

```typescript
start<T>(params: { workspaceId: string; agentId: string }): Promise<T>
stop<T>(params: { workspaceId: string; agentId: string }): Promise<T>
```

#### 1.4 命名统一

`gto agent delete` → `gto agent remove`，与 `gto role remove` 一致。

后端 bridge method 名保持 `agent.delete` 不变（避免破坏性变更），只改 CLI 层路由。

---

### Phase 2: Workspace 管理命令

```
gto workspace list [--json]                     # 列出所有工作区
gto workspace open <path> [--json]               # 打开工作区（路径可以是相对路径）
gto workspace close <workspace-id> [--json]       # 关闭工作区
gto workspace switch <workspace-id> [--json]     # 切换活跃工作区
gto workspace current [--json]                    # 显示当前活跃工作区
gto workspace info [workspace-id] [--json]        # 查看工作区详情（不传则用当前）
```

**workspace-id 智能推断链**：

```
1. 命令行 --workspace-id <id>
2. 环境变量 GTO_WORKSPACE_ID
3. 从 cwd 向上查找 .gtoffice/session.snapshot.json 推断
4. 如果只有一个打开的 workspace，自动使用
5. 否则报错，要求显式指定
```

**新增文件**：

- `tools/gto/src/commands/workspace.ts` — WorkspaceBackend + createWorkspaceCommands
- `tools/gto/src/adapters/workspace_backend.ts` — bridge 调用

---

### Phase 3: Agent 生命周期命令

```
gto agent start <agent-ref> [--workspace-id <id>] [--json]
gto agent stop <agent-ref> [--workspace-id <id>] [--json]
gto agent restart <agent-ref> [--workspace-id <id>] [--json]
gto agent status <agent-ref> [--workspace-id <id>] [--json]
```

**`agent-ref` 解析**：支持 name 或 id 前缀，自动模糊匹配（已有的 `resolveAgentByRef` 逻辑复用）。

```
gto agent start DEV              # 按 name 查找
gto agent start 1566729b         # 按 id 前缀查找
gto agent start 1566729b-6bd8-40bd-baaa-405895e34eef  # 完整 id
```

**`agent start` 启动流程**：

1. 通过 `agent.list` 找到 agent 记录
2. 通过 `agent.start` bridge route 创建终端会话并绑定
3. 输出启动结果 `{ agentId, sessionId, status }`
4. Agent 进程在终端中运行，gto 不会阻塞等待

**`agent stop` 停止流程**：

1. 找到 agent 对应的 terminal session
2. 调用 `agent.stop` bridge route（terminal_kill + unbinding）
3. 输出停止结果

**`agent status`**：

1. 从 `directory.snapshot` 获取 agent 在线状态
2. 如果在线，附带 terminal session 信息
3. 输出格式化状态表

---

### Phase 4: 规范化已有命令

#### 4.1 顶层快捷方式保留

`gto send` / `gto inbox` / `gto thread` / `gto wait` 保留为人类友好的快捷方式。

内部统一路由：`gto send` 内部调用与 `gto agent send-task` 相同的 TaskCommands。

#### 4.2 Name 解析增强

所有接受 `--agent-id` 的子命令，增加 `--agent` 参数支持 name 解析：

```
# 之前
gto agent send-task --target-agent-id 1566729b-6bd8-40bd-baaa-405895e34eef --title "xxx"

# 之后（两种都支持）
gto agent send-task --target-agent-id 1566729b... --title "xxx"
gto agent send-task --target-agent DEV --title "xxx"
```

实现方式：如果 `--target-agent` 传了 name，先查 directory 解析成 id。

#### 4.3 `delete` → `remove`

CLI 层路由：
- `gto agent remove` → 调用 `agent.delete` backend（bridge method 不改）
- `gto agent delete` → 保留为 `remove` 的别名，输出 deprecation warning

---

### Phase 5: 输出格式优化

#### 5.1 默认人类可读

`gto agent list` 默认输出表格：

```
ID          NAME     ROLE      TOOL     STATE
1566729b    DEV      dev        codex    online
8240392a    BOSS     boss       claude   online
86e85f22    analyze  analyst    codex    offline
```

`gto workspace list` 默认输出：

```
ID                         NAME           ROOT                    ACTIVE
ws:3da42bae...3dc121       GT-Office      /Users/dzlin/work/...   ✓
```

加 `--json` 时输出原始 JSON（当前行为）。

#### 5.2 实现策略

在 `tools/gto/src/core/output.ts` 中扩展 `renderOutput`，根据 `--json` flag 分支：
- `--json` → 直接 JSON.stringify
- 默认 → 调用对应命令的 `renderHumanReadable()` 函数

---

## 三、文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `tools/gto/src/commands/workspace.ts` | workspace 命令逻辑 |
| `tools/gto/src/adapters/workspace_backend.ts` | workspace bridge 调用 |
| `tools/gto/src/utils/agent_resolver.ts` | 抽取 agent name→id 解析为独立工具函数 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `tools/gto/src/gt_office_cli.ts` | 添加 workspace 命令路由、agent start/stop/restart/status 路由、delete→remove 别名、help 文本更新、agents 统一数据源 |
| `tools/gto/src/commands/agent.ts` | 添加 start/stop/restart/status 命令、name 解析增强 |
| `tools/gto/src/adapters/agent_backend.ts` | 添加 start/stop bridge methods |
| `tools/gto/src/commands/notify.ts` | `gto notify` 命令 + `channel home` 子命令 + `channel send-to` |
| `tools/gto/src/commands/channel.ts` | 扩展：home set/show 子命令路由 |
| `tools/gto/src/core/argv.ts` | 添加 `--agent` name 解析参数 |
| `tools/gto/src/repl/repl.ts` | REPL 中补全新命令 |

### Rust 端变更

| 文件 | 变更 |
|------|------|
| `apps/desktop-tauri/src-tauri/src/commands/agent.rs` | 新增 `agent_start`、`agent_stop` 复合 command |
| `apps/desktop-tauri/src-tauri/src/commands/tool_adapter/mod.rs` | 注册 workspace.* + agent.start/stop + channel.send_notification + channel.home_set/home_get bridge routes |
| `apps/desktop-tauri/src-tauri/src/channel_sinks.rs` | 新增 `send_proactive_notification` 函数 |
| `apps/desktop-tauri/src-tauri/src/commands/workspace/mod.rs` | 新增 `home_channel_set`、`home_channel_get` 命令（或独立文件）|

---

## 四、执行顺序

```
Phase 1 (1.5d)
  ├── 1.1 修复 help 系统
  ├── 1.2 统一 agents 数据源
  ├── 1.3 Rust bridge routes (workspace.* + agent.start/stop)
  └── 1.4 delete → remove

Phase 2 (0.5d)
  └── gto workspace 命令 + workspace-id 智能推断

Phase 3 (0.5d)
  └── gto agent start/stop/restart/status

Phase 4 (0.5d)
  ├── name 解析增强 (--agent)
  └── 顶层命令共享实现

Phase 5 (0.5d)
  └── 人类可读输出格式

Phase 6 (1d)
  ├── 6.4 Rust: send_proactive_notification + home_channel 存储
  ├── 6.4.3 Rust: bridge routes 注册
  └── 6.5 CLI: gto notify + gto channel home + gto channel send-to

总计预估：4.5 天
```

---

## 五、设计决策记录

| # | 决策 | 选项 | 理由 |
|---|------|------|------|
| 1 | `delete` → `remove` | remove vs 保持 delete | 与 role.remove 一致，减少记忆负担 |
| 2 | 保留顶层快捷方式 | 保留 vs 全部收到子命令 | `gto send` 对人类友好，`gto task send` 等子命令对脚本友好，共存不冲突 |
| 3 | `agent.start` 在 Rust 端做复合 command | Rust 复合 vs CLI 多步编排 | 原子性：终端创建+绑定必须一起成功或一起失败，CLI 多步会有中间态 |
| 4 | git/file 不做 CLI | — | 用户明确表示不需要，Agent 可直接用 shell |
| 5 | workspace-id 智能推断 | — | 减少 CLI 冗余参数，Agent 在 terminal 中运行时已经知道自己的 workspace |
| 6 | Home Channel 存 workspace 级配置 | workspace 配置 vs agent 级配置 | workspace 级更简单，一个 workspace 一个主人；如需 agent 粒度后续可扩展 |
| 7 | `gto notify` 只能发到 home channel | 开放任意 peer vs 锁定 home | 安全优先，防止 Agent 乱发消息到不相关的群/人；`channel send-to` 保留为高级用法 |
| 8 | 复用 `send_text_reply` 函数（reply_to=None） | 新写 vs 复用 | 现有 sink 函数签名已支持 `reply_to_message_id: Option`，传 None 即可主动发送，无需新建函数族 |

---

### Phase 6: Home Channel 通知命令

#### 6.1 需求背景

当 Agent 有紧急事情需要通知主人时（比如任务失败、关键发现、需要人工决策），需要一个"呼叫主人"的机制。当前的 `channel.publish` 只能发内部消息（Agent 之间），`deliver_external_reply_text` 只能在 Agent 运行时被动回复外部消息。

**新增能力**：Agent 可以通过 CLI 主动发送文本消息到预先配置的 "Home Channel"（主人的 Telegram/飞书/微信私聊或群）。

#### 6.2 核心概念：Home Channel

Home Channel 是一个 workspace 级别的配置，记录了"主人的通知通道"信息：

```
HomeChannel {
  channel: "telegram" | "feishu" | "wechat"
  account_id: string        // 使用哪个 bot 账号
  peer_id: string           // 主人的 chat/peer ID
  label?: string            // 可选：备注名，如 "dzlin's DM"
}
```

在 workspace 的 station settings 中新增 `homeChannel` 字段。UI 上可以配置，CLI 通过 `gto channel home` 设置。

#### 6.3 CLI 命令

```bash
# 设置 home channel
gto channel home set --channel telegram --account-id <bot-id> --peer-id <chat-id> [--label "dzlin's DM"]

# 查看 home channel
gto channel home show

# 发送通知到 home channel（核心命令）
gto notify "部署失败！检查 server-03"
gto notify "已完成代码审查，等待合并确认" --priority high

# 也支持指定具体通道（不通过 home channel）
gto channel send-to --channel telegram --account-id <bot-id> --peer-id <chat-id> "紧急：服务器宕机"
```

**`gto notify` 语义**：发消息到 home channel。这是 Agent 用户最常用的命令——"有事找主人"。

**`gto channel home`** 子命令：管理 home channel 配置。

**`gto channel send-to`**：直接指定外部通道发送（高级用法）。

#### 6.4 Rust 后端设计

##### 6.4.1 Home Channel 存储

在 workspace 的 `station_config` (或者新增 `workspace_settings` 表) 中存储：

```rust
// 新增数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeChannel {
    pub channel: String,       // "telegram" | "feishu" | "wechat"
    pub account_id: String,    // bot 账号标识
    pub peer_id: String,       // 用户的 chat/peer ID
    #[serde(default)]
    pub label: Option<String>, // 可选备注
}
```

新增两个 Tauri command：
- `home_channel_set(home_channel: HomeChannel, workspace_id: String)` → 存储到 workspace 配置
- `home_channel_get(workspace_id: String)` → 读取 home channel

##### 6.4.2 主动推送 API

新增 Tauri command `channel_send_notification`：

```rust
#[tauri::command]
pub async fn channel_send_notification(
    channel: String,          // "telegram" | "feishu" | "wechat"
    account_id: String,       // bot 账号
    peer_id: String,          // 目标 peer/chat ID
    text: String,             // 消息文本
    priority: Option<String>, // "high" | "normal" | "low"
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String>
```

这个命令**不依赖 ExternalReplyRelayTarget**（不是回复），而是**主动推送**。实现上复用 `channel_sinks.rs` 中已有的 `telegram::send_text_reply` / `feishu::send_text_reply` / `wechat::send_text_reply`，但区别是：
- 不需要 `inbound_message_id`（不是回复）
- 不需要 preview/finalize 两阶段（一次性发送）
- 不需要 relay_mode/confidence

新增一个简化的 sink 函数：

```rust
// channel_sinks.rs 中新增
pub async fn send_proactive_notification(
    app: &AppHandle,
    channel: &str,
    account_id: &str,
    peer_id: &str,
    text: &str,
) -> Result<ChannelReplyDeliveryResult, String> {
    match ChannelSinkKind::from_channel(channel) {
        ChannelSinkKind::Telegram => {
            telegram::send_text_reply(app, Some(account_id), peer_id, text, None).await
        }
        ChannelSinkKind::Feishu => {
            feishu::send_text_reply(app, Some(account_id), peer_id, text, None).await
        }
        ChannelSinkKind::Wechat => {
            wechat::send_text_reply(app, Some(account_id), peer_id, text, None).await
        }
        ChannelSinkKind::Unsupported => {
            Err(format!("NOTIFICATION_UNSUPPORTED: channel '{}' is not supported for notifications", channel))
        }
    }
}
```

注意：`telegram::send_text_reply` / `feishu::send_text_reply` / `wechat::send_text_reply` 目前签名中的 `reply_to_message_id` 参数是 `Option<&str>`，传 `None` 即可——这说明这些函数已经支持非回复式主动发送。

##### 6.4.3 Bridge Routes

在 tool_adapter bridge 中注册：

| Bridge Method | 映射 | 说明 |
|---|---|---|
| `channel.send_notification` | `channel_send_notification` | 主动推送消息到外部通道 |
| `channel.home_set` | `home_channel_set` | 设置 home channel |
| `channel.home_get` | `home_channel_get` | 获取 home channel |

#### 6.5 CLI 端实现

**新增文件**：

| 文件 | 说明 |
|------|------|
| `tools/gto/src/commands/notify.ts` | notify 命令 + channel home 子命令 |

**`gto notify` 流程**：

1. 读取 workspace home channel 配置（通过 `channel.home_get` bridge）
2. 如果没有配置 home channel，返回错误：`NOTIFY_NO_HOME_CHANNEL: Set a home channel first with: gto channel home set --channel <telegram|feishu|wechat> --account-id <id> --peer-id <id>`
3. 调用 `channel.send_notification` bridge method 发送消息
4. 输出发送结果

**`gto channel home set` 流程**：

1. 验证 `--channel` 参数是 telegram/feishu/wechat 之一
2. 调用 `channel.home_set` bridge method 存储
3. 输出确认信息

**`gto channel send-to` 流程**：

1. 验证 `--channel`, `--account-id`, `--peer-id` 必需参数
2. 调用 `channel.send_notification` bridge method 发送
3. 输出发送结果

#### 6.6 安全考虑

- **防止滥用**：`gto notify` 只能发到 workspace 的 home channel（主人预配置），Agent 不能随便发到任意 peer
- **`gto channel send-to`** 需要显式指定所有参数，作为高级用法保留（未来可加权限控制）
- **速率限制**：在 `channel_send_notification` Rust 命令中加 rate limiting（比如每分钟最多 10 条通知），防止 Agent 刷屏

#### 6.7 与现有架构的关系

```
消息流向：

  内部（Agent ↔ Agent）:
    gto send → channel.publish → TaskService → 事件总线 → 目标Agent

  回复（Agent → 外部用户）:
    Agent 生成回复 → deliver_external_reply_text → telegram/feishu/wechat sink → 外部IM

  新增：主动通知（Agent → 主人）:
    gto notify → channel_send_notification → channel_sinks::send_proactive_notification → 外部IM
```

---

## 六、验证标准

每个 Phase 完成后需验证：

- [ ] 所有现有 gto 命令行为不变（向后兼容）
- [ ] `gto --help` 和 `gto <group> --help` 输出正确
- [ ] `gto workspace` 子命令全部可用
- [ ] `gto agent start/stop/restart/status` 全部可用
- [ ] `gto agent remove` 可用且 `gto agent delete` 保留为别名
- [ ] `--agent DEV` name 解析与 `--target-agent-id <uuid>` 等价
- [ ] `gto agents` 与 `gto agent list --json` 输出数据源一致
- [ ] `gto notify "text"` 可发送消息到 home channel
- [ ] `gto channel home set/show` 正确管理 home channel 配置
- [ ] `gto channel send-to` 可直接指定目标发送
- [ ] 无 --json 时输出人类可读格式
- [ ] 类型检查 + 构建通过