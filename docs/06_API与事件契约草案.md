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
| `fs.delete` | `workspaceId,path` | `kind,deleted` |
| `fs.move` | `workspaceId,fromPath,toPath` | `kind,moved` |
| `fs.copy` | `workspaceId,fromPath,toPath` | `kind,copied` |
| `fs.show_in_folder` | `workspaceId,path` | `opened` |
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
| `terminal.report_rendered_screen` | `sessionId,screenRevision,capturedAtMs,rows[],toolKind?` | `accepted,screenRevision,humanText?` |

Station 约束（T-072）：
1. 角色模式优先 `cwdMode=custom`，目录映射 `.gtoffice/org/{role}/{agent_id}`。
2. `screenRevision` 必须单调递增；乱序/重复快照静默丢弃。
3. 当 `agentToolKind=claude` 且 workspace 存在生效的 Claude provider 配置时，GT Office 必须在创建 terminal 时自动注入 Claude runtime env；Codex/Gemini v1 不注入额外 provider secret env。
4. `humanText` 仅作为终端调试窗口的人类视图稳定正文信号，允许为空；为空时前端必须静默，不得回退展示 prompt / tool / status / input 中间态。

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
2. 变更命令成功后必须触发一次 Git 状态协调刷新；`git/updated` 由协调器在状态真正变化后统一发出。

### 3.5 Task / Channel / Local Bridge（核心协作链路）

| Command | Req（关键字段） | Resp（关键字段） |
|---|---|---|
| `task.list` | `scope` | `tasks[]` |
| `task.dispatch_batch` | `workspaceId,sender,targets,title,markdown,attachments?` | `batchId,results[]` |
| `channel.publish` | `workspaceId,channel,type,payload,idempotencyKey?` | `messageId,acceptedTargets,failedTargets` |
| `changefeed.query` | `workspaceId,sessionId?,limit` | `events[]` |
| `agent.runtime_register` | `workspaceId,agentId,stationId,sessionId,roleKey?,toolKind?,resolvedCwd?,submitSequence?,providerSession?` | `registered,providerSession?` |
| `agent.runtime_unregister` | `workspaceId,agentId` | `unregistered` |

Local Bridge（T-171）：
1. 方法：`health`、`directory.get`、`task.dispatch_batch`、`task.list_threads`、`task.get_thread`、`channel.publish`、`channel.list_messages`。
2. 仅监听 `127.0.0.1`，token 必填。
3. 默认超时 `8s`，网络级失败最多重试 2 次。
5. `directory.get` 返回 `workspaceId,directoryVersion,updatedAtMs,departments[],roles[],agents[],runtimes[]`，其中 `agents[]` 必须合并 repo agent 与 runtime-only agent。
6. 当前推荐的 agent-facing 协作入口是本机 `gto` CLI，而不是 public MCP tool。
7. `gto directory snapshot.workspace_id` 可省略；解析优先级：显式参数 > `GTO_WORKSPACE_ID` 环境变量 > `directory.json` 中最近更新的 workspace snapshot。
8. `gto agent send-task.workspace_id`、`gto agent reply-status.workspace_id`、`gto agent handover.workspace_id` 可省略；解析优先级与 `gto directory snapshot` 一致。
9. `gto agent send-task.targets`、`gto agent reply-status.target_agent_ids`、`gto agent handover.target_agent_ids` 语义固定为 `agent_id[]`。
10. `gto agent reply-status`、`gto agent handover` 中 `sender_agent_id` 可省略；解析优先级：显式参数 > `GTO_AGENT_ID` 环境变量 > 当前 cwd/目录自识别 > 报错。
11. `gto health` 在 bridge 不可达时仍应返回 `runtime/bridge/directory/self` 诊断摘要；bridge 正常时返回值应收敛为最小可执行字段，避免污染 agent 对话。
12. `gto agent send-task` 负责把文本写入目标 agent terminal，并使用 runtime 的 `submitSequence` 自动提交；为兼容交互式 CLI，提交链路需允许在主 `submitSequence` 后追加一次硬回车兜底。
13. `gto agent reply-status`、`gto agent handover` 是协作消息记录，不负责向目标 terminal 注入或执行命令；agent 需要“让对方执行一段文本”时必须使用 `gto agent send-task`。
15. 若 `workspace_id` 形如 `agent-01` 而非 `ws:...`，必须返回明确提示，不允许让 agent 把 `agent_id` 当成 `workspace_id`。
16. 若 bridge 不可达但目录快照可读，发送类命令必须返回专门错误 `LOCAL_BRIDGE_SEND_UNAVAILABLE`，明确说明“目录可读但发送不可用”。
17. agent/station terminal 创建时必须注入：
   - `GTO_WORKSPACE_ID`
   - `GTO_AGENT_ID`
   - `GTO_ROLE_KEY`
   - `GTO_STATION_ID`
18. 若 GT Office 桌面端运行于 Windows、agent/CLI 运行于 WSL，本机 `gto` 仍必须可用；runtime 与 directory 的候选选择必须优先命中“包含目标 workspace snapshot 的同一状态根”，避免目录来自一侧、发送却连到另一侧死端口。
19. `task.list_threads` / `task.get_thread` 是当前 sender 读取任务线程与回传正文的标准入口；默认按“当前 agent”过滤。
20. 纯终端打印但未经过 `channel.publish` 的文本，不属于任务线程，可见于目标 agent 本地 terminal，但不可被 sender 通过 `gto` thread/inbox 拉取。
21. `agent.runtime_register.providerSession` 为 provider 专属会话绑定元数据；当前用于 Codex/Claude session log 绑定，字段最少包含 `provider,providerSessionId?,logPath?,sessionStartedAtMs?,discoveryConfidence?`。

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
| `agent_install_status` | `agent` | `installed,executable?,requiresNode,nodeReady,npmReady,installAvailable,uninstallAvailable,detectedBy[],issues[]` |
| `install_agent` | `agent` | `ok`（成功后前端需重新查询 `agent_install_status`） |

AI Config 约束（T-171）：
1. v1 仅 Claude 支持进阶供应商配置；Codex/Gemini 只返回轻量引导信息。
2. Claude `draft.mode` 允许 `official|preset|custom`。
3. Claude `draft.savedProviderId` 可选；当前端从“已保存供应商”编辑已有记录时，必须携带该字段，以便后端复用原 saved provider 记录与托管密钥。
4. Claude `preview_patch` 必须拒绝缺失 `baseUrl/model/apiKey` 且无已有 `secretRef` 的新配置。
5. `apply_patch` 必须把 API Key 写入系统凭据库，只在工作区配置保存 `secretRef`；Claude 应用时还必须同步 GT Office 受管 env 键到 `~/.claude/settings.json`。
6. `ai_config.read_snapshot` 返回的 Claude 预设目录必须包含 `websiteUrl/apiKeyUrl/billingUrl/recommendedModel/endpoint/authScheme/setupSteps[]`，以支撑新手引导。
7. Claude live sync 必须保留 `~/.claude/settings.json` 中与当前供应商无关的根字段和 `env` 键，例如 `permissions` 及用户自定义 env；仅允许增删 GT Office 受管的 Claude provider 键。
8. `ai_config.read_snapshot.snapshot.claude` 必须返回 `savedProviders[]`，其中每项至少包含 `savedProviderId,mode,providerId,providerName,baseUrl,model,authScheme,hasSecret,isActive,createdAtMs,updatedAtMs,lastAppliedAtMs`。
9. `ai_config.switch_saved_claude_provider` 必须基于数据库中的 saved provider 切换当前生效 Claude 配置，并同步工作区配置、live settings 与 active saved provider 标记。
10. Claude 选择 `official` 并应用时，也必须落一条可切换的 saved provider 记录；后续从 saved list 切回官方时，应清除 GT Office 托管的 Claude env 覆盖并恢复原生官方模式。
11. Claude `official` 模式在 `preview_patch`、`read_snapshot` 与 `savedProviders[]` 中必须返回规范化后的 Anthropic 官方基线字段（如 `providerName/baseUrl/model/authScheme`）；即使 live settings 最终会清空托管 env，也不能把这些字段留空或显示上一家供应商的残留值。
12. Claude saved provider 编辑成功后，后端必须优先复用原 `savedProviderId` 更新该条记录；若编辑结果与同 workspace 下另一条记录的 fingerprint 完全一致，则允许折叠到已有记录，但不得额外生成重复 saved provider。
13. `savedProviders[]` 的返回顺序必须稳定反映“保存顺序”；从列表切换当前配置时只能更新 `isActive` 和应用结果，不能因为激活状态变化把目标项重排到数组前面。
14. `settings.values.ui.taskQuickDispatch.opacity` 用于控制全局任务派发浮层面板透明度，建议范围 `0.55 - 1.00`。
15. `settings.values.keybindings.overrides[]` 中允许命令 `task.center.quick_dispatch`；默认键位为 `Mod+Shift+K`，用于任意主界面唤起全局任务派发浮层。
16. `install_agent` 只负责安装 CLI，本身不得再触发其他协作配置写入。
17. 设置页 UI 不再暴露 MCP 安装、迁移、卸载状态；增强服务弹窗当前仅保留 Skills 分类和后续扩展位。
24. `install_agent` 成功返回前必须执行一次真实 CLI 复检；至少要求能定位到受支持的可执行文件并通过版本探测，不得仅以安装脚本退出码判定成功。
25. `uninstall_agent` 成功返回前必须确认本机已不再检测到对应 CLI；Claude 在可识别来源时应支持 native/homebrew/npm 受管卸载。

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
| `channel_connector_wechat_auth_start` | `accountId?` | `session{authSessionId,status,qrCodeSvgDataUrl,...}` |
| `channel_connector_wechat_auth_status` | `authSessionId` | `session{status,boundAccountId?,detail,...}` |
| `channel_connector_wechat_auth_cancel` | `authSessionId` | `session{status=cancelled,...}` |

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
7. Codex session log 绑定优先级固定为：`providerSession.logPath > providerSession.providerSessionId > cwd + bind 时间窗 + prompt anchor > 同 cwd 最新活跃日志`。
8. Codex session log 的 channel final body 只允许来自 request 绑定后的结构化 assistant `response_item` 输出；其中 `response_item.payload.phase=commentary` 与 `event_msg/agent_message` commentary 一律仅用于调试与观测，不得直接进入 channel 正文。`finalize` 对 channel 只能发送相对最后一次 preview 的新增尾段，delta 为空时不得重复外发整段正文。
9. session log 文件读取、扫描、重绑必须运行在后台 worker / blocking 段，不得阻塞前端交互线程。
10. Telegram 交互按钮（inline keyboard）与正文分离，按钮回调需复用同一 reply session。
11. Telegram callback payload 允许两种前缀：
   - `gto:<submit_text>`
   - `gto-key:up|down|enter|esc|tab`
12. `channel_external.inbound` 遇到 `gto-key:*` 时必须向目标 terminal 写入对应 ANSI 控制序列，而不是把 payload 当普通文本派发。
13. `channel_connector_account_upsert` 对 Feishu 需支持：
   - `connectionMode=websocket|webhook`
   - `domain=feishu|lark`
   - `appId/appSecret/appSecretRef`
   - `verificationToken/verificationTokenRef`
   - `webhookPath/webhookHost/webhookPort`
14. `channel_connector_health` 对 Feishu 需补充：
   - `botName`
   - `botOpenId`
   - `domain`
   - `runtimeConnected`
   - `connectionMode`
   - `configuredWebhookUrl/runtimeWebhookUrl/webhookMatched`
15. Feishu v1 不提供远程方向控件；若存在交互 prompt，只发送提示文本，不声明可远程选择。
16. `channel_connector_webhook_sync` 对 Feishu 是“生成 + 校验 callback URL”，不是像 Telegram `setWebhook` 那样的远端写回动作。
17. `external/channel_outbound_result` payload 应补充 `channel?`，供用户侧消息流直接展示通道名；前端不得再从 `textPreview/detail` 文案反推 channel。
18. `channel_connector_account_upsert` 对 WeChat 允许保存 `enabled/tokenRef/baseUrl`；token 明文只能通过二维码绑定流程进入系统凭据库，不得落盘。
19. `channel_connector_wechat_auth_start/status/cancel` 仅用于 WeChat 二维码绑定会话；状态至少包含 `awaiting_scan/scanned/confirmed/expired/cancelled`。
20. `channel_connector_health` 对 WeChat 需补充 `runtimeConnected/lastSyncAtMs/botDisplayName?`；当 token 失效时返回 `status=auth_failed`。
21. WeChat v1 入站固定为 `peerKind=direct`，不支持 group；出站必须依赖最近一次入站缓存的 `context_token`，缺失时返回 `CHANNEL_CONNECTOR_CONTEXT_MISSING`。

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
| `git/updated` | `workspaceId,available,branch,dirty,ahead,behind,files[],revision` |
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
   - `session-log-structured`
   - `rendered-screen-fallback`
   - `vt-fallback`
2. `confidence` 与 `relayMode` 对应：
   - `session-log-structured -> high`
   - `rendered-screen-fallback -> medium`
   - `vt-fallback -> low`

## 5. 错误码规范

格式：`<DOMAIN>_<REASON>`。

域：
`WORKSPACE`、`FS`、`TERMINAL`、`GIT`、`TOOL`、`SECURITY`、`TASK`、`SETTINGS`、`KEYMAP`、`AI_CONFIG`、`AGENT`、`CHANNEL`、`HOOK`、`POLICY`、`OBS`、`CACHE`、`LOCAL_BRIDGE`、`DAEMON`、`SEARCH`。

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
23. `LOCAL_BRIDGE_UNAVAILABLE`
24. `LOCAL_BRIDGE_AUTH_FAILED`
25. `LOCAL_BRIDGE_TIMEOUT`
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
`git/updated` 约束：
1. 事件来源既包括 Git 命令成功，也包括 watcher 驱动的工作区文件变更与 `.git` 关键元数据变更。
2. 后端必须对同一 workspace 的刷新做去抖与 singleflight，禁止把每次 filesystem 事件都直接升级为一次全量 Git 状态读取。
3. 只有 `branch/ahead/behind/files` 指纹发生变化时才允许发出事件。
4. `available=false` 表示当前 workspace 不是 Git 仓库；前端必须稳定降级为空态。
