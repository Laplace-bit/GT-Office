# GT Office API 与事件契约草案（Token 优化版）

> 目的：用最小文本定义 WebUI 与 Rust Core 的可执行契约，减少跨模块歧义。

## 1. 契约原则

1. Command：请求-响应。
2. Event：流式状态与异步通知。
3. 所有响应使用统一 `ResultEnvelope`。
4. 错误码必须机读稳定，错误信息保持可人读。
5. 除显式全局命令外，命令必须携带 `workspaceId`。

## 2. 统一响应结构

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "traceId": "7a9d..."
}
```

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "SECURITY_PATH_DENIED",
    "message": "Target path is outside workspace",
    "details": {}
  },
  "traceId": "7a9d..."
}
```

## 3. Command 契约（V1）

### 3.1 Workspace

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `workspace.list` | `{}` | `workspaces[]` |
| `workspace.open` | `path` | `workspaceId,name,root` |
| `workspace.close` | `workspaceId` | `closed` |
| `workspace.restore_session` | `workspaceId` | `windows,tabs,terminals` |
| `workspace.switch_active` | `workspaceId` | `activeWorkspaceId` |
| `workspace.get_context` | `workspaceId` | `root,permissions,terminalDefaultCwd` |
| `workspace.get_window_active` | `{}` | `windowLabel,workspaceId?` |

### 3.2 Filesystem

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `fs.list_dir` | `workspaceId,path,depth?` | `entries[]` |
| `fs.read_file` | `workspaceId,path` | `content,encoding,sizeBytes,previewable,truncated` |
| `fs.read_file_full` | `workspaceId,path,limitBytes?` | 同 `read_file` |
| `fs.write_file` | `workspaceId,path,content` | `written` |
| `fs.search_text` | `workspaceId,query,glob?` | `matches[]` |
| `fs.search_files` | `workspaceId,query,maxResults?` | `matches[]`（仅文件） |
| `fs.search_stream_start` | `workspaceId,searchId?,query,glob?` | `searchId,accepted` |
| `fs.search_stream_cancel` | `searchId` | `cancelled` |

约束：
1. 搜索默认 fixed-string（非正则）。
2. 同一 `workspaceId` 新搜索可 supersede 旧搜索。
3. 路径必须是工作区内相对路径，禁止越界。

### 3.3 Terminal

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `terminal.create` | `workspaceId,shell?,cwd?,cwdMode,env?,agentToolKind?` | `sessionId,resolvedCwd` |
| `terminal.write` | `sessionId,input` | `accepted` |
| `terminal.resize` | `sessionId,cols,rows` | `resized` |
| `terminal.kill` | `sessionId,signal?` | `killed` |
| `terminal.report_rendered_screen` | `sessionId,screenRevision,capturedAtMs,rows[]` | `accepted,screenRevision` |

Station 约束（T-072）：
1. 角色模式优先 `cwdMode=custom`，目录映射 `.gtoffice/org/{role}/{agent_id}`。
2. `screenRevision` 必须单调递增；乱序/重复快照静默丢弃。
3. 当 `agentToolKind=claude` 且 workspace 存在生效的 Claude provider 配置时，GT Office 必须在创建 terminal 时自动注入 Claude runtime env；Codex/Gemini v1 不注入额外 provider secret env。

### 3.4 Git

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `git.status` | `workspaceId` | `branch,ahead,behind,files[]` |
| `git.diff_file` | `workspaceId,path` | `patch` |
| `git.stage/unstage` | `workspaceId,paths[]` | `staged/unstaged` |
| `git.discard` | `workspaceId,paths[],includeUntracked?` | `discarded` |
| `git.commit` | `workspaceId,message` | `commit` |
| `git.log` | `workspaceId,limit,skip` | `entries[]` |
| `git.commit_detail` | `workspaceId,commit` | `commit detail` |
| `git.list_branches` | `workspaceId,includeRemote?` | `branches[]` |
| `git.checkout/create_branch/delete_branch` | 对应字段 | `checkedOut/created/deleted` |
| `git.fetch/pull/push` | `workspaceId,remote?,branch?` | `fetched/pulled/pushed` |
| `git.stash_push/pop/list` | 对应字段 | `stashed/popped/entries[]` |

约束：
1. Git 命令必须显式传 `workspaceId`。
2. 变更命令成功后触发 `git/updated`。

### 3.5 Task / Channel / MCP（核心协作链路）

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `task.list` | `scope` | `tasks[]` |
| `task.dispatch_batch` | `workspaceId,sender,targets,title,markdown,attachments?` | `batchId,results[]` |
| `channel.publish` | `workspaceId,channel,type,payload,idempotencyKey?` | `messageId,acceptedTargets,failedTargets` |
| `changefeed.query` | `workspaceId,sessionId?,limit` | `events[]` |
| `agent.runtime_register` | `workspaceId,agentId,stationId,sessionId,roleKey?` | `registered` |
| `agent.runtime_unregister` | `workspaceId,agentId` | `unregistered` |

MCP Bridge（T-171）：
1. 方法：`health`、`directory.get`、`task.dispatch_batch`、`channel.publish`、`channel.list_messages`。
2. 仅监听 `127.0.0.1`，token 必填。
3. 默认超时 `8s`，网络级失败最多重试 2 次。
4. 安装目标：Claude/Codex/Gemini/Qwen；server id 统一 `gto-agent-bridge`，安装必须幂等。
   - 安装器除写入 MCP server 外，还应写入一份受管的 agent communication policy，并尽可能落到各 CLI 的默认指令文件位置。
5. `directory.get` 返回 `workspaceId,directoryVersion,updatedAtMs,departments[],roles[],agents[],runtimes[]`，其中 `agents[]` 必须合并 repo agent 与 runtime-only agent。
6. public MCP tool 采用“两步式”：
   - 先 `gto_get_agent_directory(workspace_id?)`
   - 再 `gto_dispatch_task / gto_report_status / gto_handover`
7. `gto_get_agent_directory.workspace_id` 可省略；解析优先级：显式参数 > `GTO_WORKSPACE_ID` 环境变量 > `directory.json` 中最近更新的 workspace snapshot。
8. `gto_dispatch_task.workspace_id`、`gto_report_status.workspace_id`、`gto_handover.workspace_id` 可省略；解析优先级与 `gto_get_agent_directory` 一致。
9. `gto_dispatch_task.targets`、`gto_report_status.target_agent_ids`、`gto_handover.target_agent_ids` 语义固定为 `agent_id[]`。
10. `gto_report_status`、`gto_handover` 中 `sender_agent_id` 可省略；解析优先级：显式参数 > `GTO_AGENT_ID` 环境变量 > 当前 cwd/目录自识别 > 报错。
11. `gto_health` 在 bridge 不可达时仍应返回 `runtime/bridge/directory/self` 诊断摘要；bridge 正常时返回值应收敛为最小可执行字段，避免污染 agent 对话。
12. public tool description 必须短而硬约束，明确“GT Office agent 间通信默认走本 MCP”，而不是输出长段操作教程。
13. `gto_dispatch_task` 负责把文本写入目标 agent terminal，并使用 runtime 的 `submitSequence` 自动提交；为兼容交互式 CLI，提交链路需允许在主 `submitSequence` 后追加一次硬回车兜底。
14. `gto_report_status`、`gto_handover` 是协作消息记录，不负责向目标 terminal 注入或执行命令；agent 需要“让对方执行一段文本”时必须使用 `gto_dispatch_task`。
15. 若 `workspace_id` 形如 `agent-01` 而非 `ws:...`，必须返回明确提示，不允许让 agent 把 `agent_id` 当成 `workspace_id`。
16. 若 bridge 不可达但目录快照可读，发送类 tool 必须返回专门错误 `MCP_BRIDGE_SEND_UNAVAILABLE`，明确说明“目录可读但发送不可用”。
17. agent/station terminal 创建时必须注入：
   - `GTO_WORKSPACE_ID`
   - `GTO_AGENT_ID`
   - `GTO_ROLE_KEY`
   - `GTO_STATION_ID`
18. 若 GT Office 桌面端运行于 Windows、agent/MCP 运行于 WSL，public MCP tool 仍必须可用；runtime 与 directory 的候选选择必须优先命中“包含目标 workspace snapshot 的同一状态根”，避免目录来自一侧、发送却连到另一侧死端口。
19. `channel.list_messages` / `gto_list_messages` 用于读取 sender 自己收到的 `status/handover` inbox；默认按“当前 agent”过滤。
20. 纯终端打印但未经过 `channel.publish` 的文本，不属于 inbox，可见于目标 agent 本地 terminal，但不可被 sender 通过 `gto_list_messages` 拉取。

### 3.6 Settings / Keymap / AI Config

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `settings.get_effective` | `workspaceId?` | `values,sources` |
| `settings.update` | `workspaceId?,scope,patch` | `updated,effective` |
| `settings.reset` | `workspaceId?,scope,keys[]` | `reset,effective` |
| `keymap.list` | `workspaceId?` | `bindings[]` |
| `keymap.update_binding` | `scope,commandId,keystroke` | `saved,conflicts` |
| `keymap.reset` | `scope,commandId?` | `reset` |
| `ai_config.read_snapshot` | `workspaceId,allow?` | `snapshot{agents[],claude,codex,gemini},masking[]` |
| `ai_config.preview_patch` | `workspaceId,scope,agent,draft` | `previewId,allowed,normalizedDraft,maskedDiff[],changedKeys[],secretRefs[],warnings[]` |
| `ai_config.apply_patch` | `workspaceId,previewId,confirmedBy` | `applied,auditId,effective,changedTargets[]` |
| `ai_config.switch_saved_claude_provider` | `workspaceId,savedProviderId,confirmedBy` | `applied,auditId,effective,changedTargets[]` |
| `agent_install_status` | `agent` | `installed,executable?,requiresNode,nodeReady` |
| `agent_mcp_install_status` | `agent` | `installed` |
| `install_agent` | `agent` | `ok`（成功后前端需重新查询 `agent_install_status`） |
| `install_agent_mcp` | `agent` | `ok`（成功后前端需重新查询 `ai_config.read_snapshot` 或 `agent_mcp_install_status`） |

AI Config 约束（T-171）：
1. v1 仅 Claude 支持进阶供应商配置；Codex/Gemini 只返回轻量引导信息。
2. Claude `draft.mode` 允许 `official|preset|custom`。
3. Claude `draft.savedProviderId` 可选；当前端从“已保存供应商”编辑已有记录时，必须携带该字段，以便后端复用原 saved provider 记录与托管密钥。
4. Claude `preview_patch` 必须拒绝缺失 `baseUrl/model/apiKey` 且无已有 `secretRef` 的新配置。
5. `apply_patch` 必须把 API Key 写入系统凭据库，只在工作区配置保存 `secretRef`；Claude 应用时还必须同步 GT Office 受管 env 键到 `~/.claude/settings.json`。
6. `ai_config.read_snapshot` 返回的 Claude 预设目录必须包含 `websiteUrl/apiKeyUrl/billingUrl/recommendedModel/endpoint/authScheme/setupSteps[]`，以支撑新手引导。
7. Claude live sync 必须保留 `~/.claude/settings.json` 中与当前供应商无关的根字段和 `env` 键，例如 `mcpServers`、`permissions` 及用户自定义 env；仅允许增删 GT Office 受管的 Claude provider 键。
8. `ai_config.read_snapshot.snapshot.claude` 必须返回 `savedProviders[]`，其中每项至少包含 `savedProviderId,mode,providerId,providerName,baseUrl,model,authScheme,hasSecret,isActive,createdAtMs,updatedAtMs,lastAppliedAtMs`。
9. `ai_config.switch_saved_claude_provider` 必须基于数据库中的 saved provider 切换当前生效 Claude 配置，并同步工作区配置、live settings 与 active saved provider 标记。
10. Claude 选择 `official` 并应用时，也必须落一条可切换的 saved provider 记录；后续从 saved list 切回官方时，应清除 GT Office 托管的 Claude env 覆盖并恢复原生官方模式。
11. Claude `official` 模式在 `preview_patch`、`read_snapshot` 与 `savedProviders[]` 中必须返回规范化后的 Anthropic 官方基线字段（如 `providerName/baseUrl/model/authScheme`）；即使 live settings 最终会清空托管 env，也不能把这些字段留空或显示上一家供应商的残留值。
12. Claude saved provider 编辑成功后，后端必须优先复用原 `savedProviderId` 更新该条记录；若编辑结果与同 workspace 下另一条记录的 fingerprint 完全一致，则允许折叠到已有记录，但不得额外生成重复 saved provider。
13. `savedProviders[]` 的返回顺序必须稳定反映“保存顺序”；从列表切换当前配置时只能更新 `isActive` 和应用结果，不能因为激活状态变化把目标项重排到数组前面。
14. `settings.values.ui.taskQuickDispatch.opacity` 用于控制全局任务派发浮层面板透明度，建议范围 `0.55 - 1.00`。
15. `settings.values.keybindings.overrides[]` 中允许命令 `task.center.quick_dispatch`；默认键位为 `Mod+Shift+K`，用于任意主界面唤起全局任务派发浮层。
16. `AiAgentSnapshotCard` 必须返回 `mcpInstalled`，供设置页在每个 agent 项中单独展示 MCP 状态。
17. `install_agent` 只负责安装 CLI，本身不得再触发 MCP 安装。
18. `install_agent_mcp` 必须支持按单个 agent 定向安装 MCP 配置，不得隐式修改其他 agent 的配置文件。
19. 设置页 UI 必须将 MCP 收口到“增强服务”弹窗中，不在 agent 卡片主操作区直接暴露原始 MCP 状态术语。
20. “增强服务”弹窗至少预留 `MCP` 与 `Skills` 两个 tab；当前版本只有 `MCP` tab 具备真实服务项。
21. 当 `mcpInstalled=true` 但 `installStatus.installed=false` 时，前端必须显示“已预配置，待 CLI 可用”之类的依赖态，而不是直接显示“已安装”。

### 3.7 Agent / Hook / Policy / Observability

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `agent.department_list` | `workspaceId` | `departments[]` |
| `agent.role_list` | `workspaceId` | `roles[]` |
| `agent.list` | `workspaceId` | `agents[]` |
| `agent.create` | `workspaceId,name,roleId,tool?,workdir?,customWorkdir?,employeeNo?,state?` | `agent` |
| `agent.update` | `workspaceId,agentId,name,roleId,tool?,workdir?,customWorkdir?,employeeNo?,state?` | `agent` |
| `agent.delete` | `workspaceId,agentId` | `deleted` |
| `agent.update_state/assign_task` | 对应字段 | `updated/taskId` |
| `hook.list/register/toggle/run_history` | 对应字段 | `subscriptions/hookId/updated/runs` |
| `policy.preview_charter/get_snapshot/evaluate` | 对应字段 | `valid/snapshot/allowed` |
| `obs.query_graph/query_timeline` | 对应字段 | `nodes+edges/events` |
| `cache.health/flush_scope` | 对应字段 | `enabled/backend/flushed` |

### 3.8 外部通道适配（T-172）

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `channel_adapter.status` | `{}` | `running,adapters,runtime,snapshot` |
| `channel_binding.upsert` | `workspaceId,channel,accountId?,peer*,targetAgentId,priority?` | `updated,created,binding` |
| `channel_binding.list` | `workspaceId?` | `bindings[]` |
| `channel_access.policy_set` | `channel,accountId?,mode` | `updated,mode` |
| `channel_access.approve/list` | 对应字段 | `approved/entries` |
| `channel_external.inbound` | `message{channel,accountId?,peer*,sender*,messageId,text,...}` | `traceId,status,idempotentHit,...` |
| `system.gto_doctor` | `{}` | `ok,summary,checks,suggestions` |
| `channel_connector_account_upsert/list` | 对应字段 | `updated/accounts` |
| `channel_connector_health` | `channel,accountId?` | `ok,status,webhookMatched` |
| `channel_connector_webhook_sync` | `channel,accountId?,webhookUrl?` | `ok,webhookUrl,detail` |

语义约束（关键）：
1. `channel + accountId` 标识一个 bot 实例；UI 按 `channel -> bot -> route` 展示。
2. 默认准入策略 `pairing`。
3. 幂等命中返回 `duplicate`，不得重复派发。
4. 入站派发后必须写入已绑定 live terminal session；禁止另起 headless 会话替代。
5. 外部回复采用双源提取：
   - `RenderedScreenSnapshot`：preview、交互 prompt、ready/finalize 边界、低置信 fallback。
   - provider `session log`：Claude/Codex 的高置信最终正文。
   - 优先级：`session-log > rendered-screen-fallback > vt-fallback`。
6. finalize 判定继续以 live terminal 状态为主；只要存在 active interaction prompt，就禁止 finalize。
7. Telegram 交互按钮（inline keyboard）与正文分离，按钮回调需复用同一 reply session。
8. Telegram callback payload 允许两种前缀：
   - `gto:<submit_text>`
   - `gto-key:up|down|enter|esc|tab`
9. `channel_external.inbound` 遇到 `gto-key:*` 时必须向目标 terminal 写入对应 ANSI 控制序列，而不是把 payload 当普通文本派发。
10. `channel_connector_account_upsert` 对 Feishu 需支持：
   - `connectionMode=websocket|webhook`
   - `domain=feishu|lark`
   - `appId/appSecret/appSecretRef`
   - `verificationToken/verificationTokenRef`
   - `webhookPath/webhookHost/webhookPort`
11. `channel_connector_health` 对 Feishu 需补充：
   - `botName`
   - `botOpenId`
   - `domain`
   - `runtimeConnected`
   - `connectionMode`
   - `configuredWebhookUrl/runtimeWebhookUrl/webhookMatched`
12. Feishu v1 不提供远程方向控件；若存在交互 prompt，只发送提示文本，不声明可远程选择。
13. `channel_connector_webhook_sync` 对 Feishu 是“生成 + 校验 callback URL”，不是像 Telegram `setWebhook` 那样的远端写回动作。
14. `external/channel_outbound_result` payload 应补充 `channel?`，供用户侧消息流直接展示通道名；前端不得再从 `textPreview/detail` 文案反推 channel。

## 4. Event 契约（V1）

### 4.1 核心事件

| Event | Payload（关键字段） |
|---|---|
| `terminal/output` | `sessionId,chunk,seq,tsMs` |
| `terminal/state_changed` | `sessionId,from,to,tsMs` |
| `task/changed` | `taskId,state,progress` |
| `task/dispatch_progress` | `batchId,targetAgentId,taskId,status,detail?` |
| `changefeed/append` | `eventId,workspaceId,source,paths[]` |
| `workspace/updated` | `workspaceId,kind` |
| `workspace/active_changed` | `workspaceId,previousWorkspaceId?` |
| `git/updated` | `workspaceId,branch,dirty` |
| `settings/updated` | `workspaceId?,scope,keys[],tsMs` |
| `keymap/updated` | `scope,commands[]` |
| `ai_config/changed` | `auditId,scope,changedKeys[]` |
| `agent/state_changed` | `agentId,roleId,from,to` |
| `channel/message` | `channelId,messageId,seq,type,senderAgentId` |
| `channel/ack` | `workspaceId,messageId,targetAgentId,status,reason?,tsMs` |
| `hook/executed` | `hookId,runId,event,status` |
| `policy/denied` | `decisionId,agentId,action,reason` |
| `obs/graph_updated` | `workspaceId,window,nodeCount,edgeCount` |
| `filesystem/changed` | `workspaceId,kind,paths[],tsMs` |
| `filesystem/watch_error` | `workspaceId,detail` |
| `daemon/search_chunk` | `searchId,items[]` |
| `daemon/search_backpressure` | `searchId,droppedChunks` |
| `daemon/search_done` | `searchId,scannedFiles,emittedMatches,cancelled` |
| `daemon/search_cancelled` | `searchId` |

### 4.2 外部通道事件（T-172）

| Event | Payload（关键字段） |
|---|---|
| `external/channel_inbound` | `traceId,channel,accountId,peer*,sender*,messageId,text?` |
| `external/channel_routed` | `traceId,workspaceId,targetAgentId,resolvedTargets[]` |
| `external/channel_dispatch_progress` | `traceId,targetAgentId,taskId,status,detail?,title?,contentPreview?` |
| `external/channel_reply` | `workspaceId,messageId,targetAgentId,status,reason?` |
| `external/channel_error` | `traceId,code,detail` |
| `external/channel_outbound_result` | `workspaceId,messageId,targetAgentId,status,detail?,relayMode,confidence,textPreview?` |
| `external/channel_connector_health_changed` | `channel,accountId,ok,status,detail,checkedAtMs` |

`external/channel_outbound_result` 约束：
1. `relayMode` 取值固定为：
   - `session-log`
   - `rendered-screen-fallback`
   - `vt-fallback`
2. `confidence` 与 `relayMode` 对应：
   - `session-log -> high`
   - `rendered-screen-fallback -> medium`
   - `vt-fallback -> low`

## 5. 错误码规范

格式：`<DOMAIN>_<REASON>`。

域：
`WORKSPACE`、`FS`、`TERMINAL`、`GIT`、`TOOL`、`SECURITY`、`TASK`、`SETTINGS`、`KEYMAP`、`AI_CONFIG`、`AGENT`、`CHANNEL`、`HOOK`、`POLICY`、`OBS`、`CACHE`、`MCP_BRIDGE`、`DAEMON`、`SEARCH`。

首批关键错误码：
1. `WORKSPACE_NOT_FOUND`
2. `WORKSPACE_CONTEXT_REQUIRED`
3. `FS_PATH_INVALID`
4. `TERMINAL_SPAWN_FAILED`
5. `TERMINAL_CWD_OUTSIDE_WORKSPACE`
6. `TERMINAL_SESSION_NOT_FOUND`
7. `GIT_REPO_INVALID`
8. `SECURITY_PATH_DENIED`
9. `TASK_TIMEOUT`
10. `SETTINGS_SCHEMA_INVALID`
11. `KEYMAP_CONFLICT`
12. `AI_CONFIG_FORBIDDEN_FIELD`
13. `AGENT_ROLE_INVALID`
14. `POLICY_DENIED`
15. `CHANNEL_ROUTE_NOT_FOUND`
16. `CHANNEL_PAIRING_REQUIRED`
17. `CHANNEL_ALLOWLIST_DENIED`
18. `CHANNEL_DISABLED`
19. `CHANNEL_DISPATCH_FAILED`
20. `CHANNEL_CONNECTOR_UNCONFIGURED`
21. `CHANNEL_CONNECTOR_AUTH_FAILED`
22. `CHANNEL_CONNECTOR_WEBHOOK_MISSING`
23. `MCP_BRIDGE_UNAVAILABLE`
24. `MCP_BRIDGE_AUTH_FAILED`
25. `MCP_BRIDGE_TIMEOUT`
26. `HOOK_CIRCUIT_OPEN`
27. `DAEMON_CONNECTION_CLOSED`
28. `SEARCH_BACKPRESSURE_DROPPED`

## 6. 数据模型（最小草案）

### 6.1 SQLite（核心表）

1. `workspaces`
2. `window_sessions`
3. `terminal_sessions`
4. `tool_profiles`
5. `task_runs`
6. `change_feed_events`
7. `app_settings`
8. `setting_change_logs`
9. `keymap_bindings`
10. `ai_config_audit_logs`
11. `workspace_context_snapshots`
12. `org_departments`
13. `agent_roles`
14. `agents`
15. `agent_task_assignments`
16. `channel_messages`
17. `hook_subscriptions`
18. `hook_runs`
19. `policy_decisions`
20. `agent_graph_edges`

### 6.2 配置 Schema（关键字段）

`.gtoffice/config.json` 必含：
1. `workspace`
2. `defaultShell`
3. `restorePolicy`
4. `allowedPaths`
5. `search`
6. `ui`
7. `keybindings`
8. `terminal`
9. `agent`
10. `channels`
11. `hooks`
12. `aiConfig`
13. `toolProfiles`

AI Provider 配置补充（T-171）：
1. 工作区配置新增 `ai.providers.claude`。
2. `ai.providers.claude` 仅允许保存 `activeMode/providerId/providerName/baseUrl/model/authScheme/secretRef/hasSecret/updatedAtMs`。
3. `ai_config_audit_logs` 必须记录 `auditId/workspaceId/agent/mode/providerId/changedKeysJson/secretRefsJson/confirmedBy/createdAtMs`。

## 7. 版本策略

1. 契约默认 `apiVersion=v1`。
2. 破坏性变更升 `v2` 并保留迁移窗口。
3. `ai_config.*` 默认严格白名单。
4. `agent/channel/hook/policy/obs/cache` 允许先 `v1alpha` 再 `v1`。

## 8. 测试与验收（最小集合）

1. 命令契约测试：req/resp 字段校验。
2. 事件顺序测试：terminal `seq` 连续性。
3. 错误码稳定性测试：同类失败返回固定错误码。
4. 多工作区隔离测试：A/B 工作区会话与任务归属不串扰。
5. cwd 安全测试：workspace 外路径必须拒绝。
6. Channel 幂等测试：重复消息不重复派发。
7. Hook 熔断测试：达到阈值后返回 `HOOK_CIRCUIT_OPEN`。
8. Cache 降级测试：缓存不可用时主流程可用。
