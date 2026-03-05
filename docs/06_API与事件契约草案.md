# GT Office API 与事件契约草案

> 目的：统一 WebUI 与 Rust Core 之间的通信协议，减少跨模块歧义。

## 1. 契约原则

1. 命令（Command）用于请求-响应。
2. 事件（Event）用于流式状态与异步通知。
3. 所有响应采用统一 `ResultEnvelope`。
4. 错误码可机读，错误信息可人读。

## 2. 统一响应结构

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "traceId": "7a9d..."
}
```

错误时：

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

1. `workspace.list`
   - req: `{}`
   - resp: `{ "workspaces":[{"workspaceId":"string","root":"string","active":true}] }`
2. `workspace.open`
   - req: `{ "path": "string" }`
   - resp: `{ "workspaceId": "string", "name": "string", "root": "string" }`
3. `workspace.close`
   - req: `{ "workspaceId": "string" }`
   - resp: `{ "closed": true }`
4. `workspace.restore_session`
   - req: `{ "workspaceId": "string" }`
   - resp: `{ "windows": [], "tabs": [], "terminals": [] }`
5. `workspace.switch_active`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "activeWorkspaceId":"string" }`
6. `workspace.get_context`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "workspaceId":"string", "root":"string", "permissions":{}, "terminalDefaultCwd":"workspace_root" }`
7. `workspace.get_window_active`
   - req: `{}`
   - resp: `{ "windowLabel":"string", "workspaceId":"string?" }`

### 3.2 Filesystem

1. `fs.list_dir`
   - req: `{ "workspaceId": "string", "path": "string", "depth": 1 }`
   - resp: `{ "entries": [{"name":"src","kind":"dir","git":"M"}] }`
2. `fs.read_file`
   - req: `{ "workspaceId": "string", "path": "string" }`
   - resp: `{ "content": "string", "encoding": "utf-8|binary", "sizeBytes": 1234, "previewBytes": 1234, "previewable": true, "truncated": false }`
3. `fs.read_file_full`
   - req: `{ "workspaceId": "string", "path": "string", "limitBytes": 2097152? }`
   - resp: `{ "content": "string", "encoding": "utf-8|binary", "sizeBytes": 1234, "previewBytes": 1234, "previewable": true, "truncated": false }`
4. `fs.write_file`
   - req: `{ "workspaceId": "string", "path": "string", "content": "string" }`
   - resp: `{ "written": true }`
5. `fs.search_text`
   - req: `{ "workspaceId": "string", "query": "TODO", "glob": "*.rs" }`
   - resp: `{ "workspaceId":"string", "query":"string", "glob":"string?", "matches":[{"path":"src/main.rs","line":12,"preview":"..."}] }`
   - 行为约束（`T-102`）：
     - 查询按字面量匹配（`fixed string`），不是正则解释。
     - 同一 `workspaceId` 下，新搜索会自动取消旧搜索（supersede）。
     - 默认遵循 `ignore` 标准过滤，隐藏目录（如 `.git`）不参与扫描。
6. `fs.search_files`
   - req: `{ "workspaceId":"string", "query":"task", "maxResults":80? }`
   - resp: `{ "workspaceId":"string", "query":"task", "matches":[{"path":"docs/task.md","name":"task.md"}] }`
   - 行为约束（`T-147`）：
     - 仅返回文件项，不返回目录。
     - 匹配范围为 `path + name` 的不区分大小写子串匹配。
     - 结果路径必须为工作区相对路径，可直接插入任务中心 `@` 引用。
7. `fs.search_stream_start`
   - req: `{ "workspaceId":"string", "searchId":"string?", "query":"TODO", "glob":"*.rs?", "chunkSize":64?, "maxResults":1200? }`
   - resp: `{ "workspaceId":"string", "searchId":"string", "accepted":true }`
   - 说明：
     - 搜索结果通过事件 `daemon/search_chunk` 持续返回。
     - 查询按字面量匹配（fixed string），不会按正则解释特殊字符。
     - 首包采用快速 flush 策略，不等待完整 chunk 才返回首批命中。
     - 若 daemon stream 不可用，前端可回退 `fs.search_text`。
8. `fs.search_stream_cancel`
   - req: `{ "searchId":"string" }`
   - resp: `{ "searchId":"string", "cancelled":true }`

### 3.3 Terminal

1. `terminal.create`
   - req: `{ "workspaceId":"string", "shell":"bash?", "cwd":"string?", "cwdMode":"workspace_root|custom", "env":{} }`
   - resp: `{ "sessionId":"string", "workspaceId":"string", "resolvedCwd":"string" }`
   - station 目录约束：角色模式下必须优先使用 `cwdMode=custom`，并将 `cwd` 绑定到 `.gtoffice/org/{role}/{agent_id}` 对应绝对路径。
2. `terminal.write`
   - req: `{ "sessionId":"string", "input":"ls\n" }`
   - resp: `{ "accepted": true }`
3. `terminal.resize`
   - req: `{ "sessionId":"string", "cols":120, "rows":36 }`
   - resp: `{ "resized": true }`
4. `terminal.kill`
   - req: `{ "sessionId":"string", "signal":"TERM" }`
   - resp: `{ "killed": true }`

### 3.3.1 Station Workspace 映射约束（T-072）

1. 角色元数据新增：
   - `roleWorkdirRel`: `.gtoffice/org/{role}`
   - `agentWorkdirRel`: `.gtoffice/org/{role}/{agent_id}`
2. 会话创建前置：
   - 先通过 `fs.write_file`（写入 marker 文件）确保 `agentWorkdirRel` 目录存在。
3. 失败处理：
   - `workspace.get_context` 失败 -> 终止会话创建并返回错误。
   - 目录创建失败 -> 终止会话创建并返回错误。
4. 角色切换策略：
   - 已有活动会话先执行 `terminal.kill`；成功后清理会话映射并等待新会话按新目录创建。

### 3.4 Git

1. `git.status`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "branch":"main", "ahead":1, "behind":0, "files":[] }`
2. `git.diff_file`
   - req: `{ "workspaceId":"string", "path":"src/main.rs" }`
   - resp: `{ "patch":"@@ ..." }`
3. `git.stage`
   - req: `{ "workspaceId":"string", "paths":["src/main.rs"] }`
   - resp: `{ "staged": 1 }`
4. `git.unstage`
   - req: `{ "workspaceId":"string", "paths":["src/main.rs"] }`
   - resp: `{ "unstaged": 1 }`
5. `git.discard`
   - req: `{ "workspaceId":"string", "paths":["src/main.rs"], "includeUntracked":false }`
   - resp: `{ "discarded": 1 }`
6. `git.commit`
   - req: `{ "workspaceId":"string", "message":"feat: ..." }`
   - resp: `{ "commit":"abc123" }`
7. `git.log`
   - req: `{ "workspaceId":"string", "limit":50, "skip":0 }`
   - resp: `{ "entries":[{"commit":"abc123","shortCommit":"abc123","parents":["def456"],"refs":["HEAD -> main","origin/main"],"authorName":"bot","authorEmail":"bot@example.com","authoredAt":"2026-02-08T11:00:00+08:00","summary":"feat: ..."}] }`
8. `git.commit_detail`
   - req: `{ "workspaceId":"string", "commit":"abc123" }`
   - resp: `{ "commit":"abc123","shortCommit":"abc123","parents":["def456"],"refs":["HEAD -> main","origin/main"],"authorName":"bot","authorEmail":"bot@example.com","authoredAt":"2026-02-08T11:00:00+08:00","summary":"feat: ...","body":"...","files":[{"status":"M","path":"src/main.rs","previousPath":null},{"status":"R","path":"src/new.rs","previousPath":"src/old.rs"}] }`
9. `git.list_branches`
   - req: `{ "workspaceId":"string", "includeRemote":false }`
   - resp: `{ "branches":[{"name":"main","current":true,"upstream":"origin/main","tracking":"=","commit":"abc123","summary":"feat: ..."}] }`
10. `git.checkout`
   - req: `{ "workspaceId":"string", "target":"feature/x", "create":false, "startPoint":"origin/main?" }`
   - resp: `{ "checkedOut":true }`
11. `git.create_branch`
    - req: `{ "workspaceId":"string", "branch":"feature/x", "startPoint":"origin/main?" }`
    - resp: `{ "created":true }`
12. `git.delete_branch`
    - req: `{ "workspaceId":"string", "branch":"feature/x", "force":false }`
    - resp: `{ "deleted":true }`
13. `git.fetch`
    - req: `{ "workspaceId":"string", "remote":"origin?", "prune":true, "includeTags":true }`
    - resp: `{ "fetched":true, "remote":"origin" }`
14. `git.pull`
    - req: `{ "workspaceId":"string", "remote":"origin?", "branch":"main?", "rebase":false }`
    - resp: `{ "pulled":true, "remote":"origin", "branch":"main?" }`
15. `git.push`
    - req: `{ "workspaceId":"string", "remote":"origin?", "branch":"main?", "setUpstream":false, "forceWithLease":false }`
    - resp: `{ "pushed":true, "remote":"origin", "branch":"main?" }`
16. `git.stash_push`
    - req: `{ "workspaceId":"string", "message":"WIP?", "includeUntracked":false, "keepIndex":false }`
    - resp: `{ "stashed":true }`
17. `git.stash_pop`
    - req: `{ "workspaceId":"string", "stash":"stash@{0}?" }`
    - resp: `{ "popped":true }`
18. `git.stash_list`
    - req: `{ "workspaceId":"string", "limit":20 }`
    - resp: `{ "entries":[{"stash":"stash@{0}","commit":"abc123","createdAt":"2026-02-08T11:00:00+08:00","summary":"WIP"}] }`

行为约束（`T-104`）：

1. 所有 Git 命令必须显式传入 `workspaceId`，不得依赖全局上下文。
2. 涉及文件路径的命令仅接受仓库内相对路径，禁止绝对路径与 `..` 越界。
3. 高性能策略：`status` 优先走 `git2`，复杂命令走 system git；大仓库状态文件返回量受上限保护。
4. 变更类命令成功后统一触发 `git/updated` 事件，供 UI 与 Hook 流程订阅。

### 3.5 Tool Adapter

1. `tool.list_profiles`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "profiles":[] }`
2. `tool.launch`
   - req: `{ "workspaceId":"string", "profileId":"codex-default", "context":{} }`
   - resp: `{ "toolSessionId":"string", "terminalSessionId":"string" }`
3. `tool.validate_profile`
   - req: `{ "profile":{} }`
   - resp: `{ "valid":true, "warnings":[] }`

### 3.6 Task & Change Feed

1. `task.list`
   - req: `{ "scope":"global" }`
   - resp: `{ "tasks":[] }`
2. `changefeed.query`
   - req: `{ "workspaceId":"string", "sessionId":"string?", "limit":100 }`
   - resp: `{ "events":[] }`

### 3.6.1 Task Center 派发复合契约（T-074）

1. M1 阶段不新增后端 `task.dispatch` 命令，采用前端复合流程（复用既有命令）：
   - `fs.write_file` -> 写入 `.gtoffice/tasks/{taskId}/task.md`
   - `fs.write_file` -> 写入 `.gtoffice/tasks/{taskId}/manifest.json`
   - `terminal.create`（必要时）-> 确保目标角色会话可用
   - `terminal.write` -> 写入派发提示命令（含 `taskId/taskFilePath`）
2. 前端任务模型字段：
   - `taskId`: `task_YYYYMMDDHHmmss_xxxx`
   - `targetStationId`
   - `title`
   - `markdown`
   - `attachments[]`（`path/name/category`）
   - `status`: `sending|sent|failed`
3. UI 接收反馈约束：
   - 目标角色卡片显示“任务已收到”气泡，展示 `taskId`，约 3 秒自动消退。
4. 失败处理：
   - 任一步骤失败，任务状态置为 `failed` 并记录 `detail`；不得伪造“已送达”状态。

### 3.6.2 Task Center 重发与持久化约束（T-076）

1. 重发契约（前端复合流程）：
   - 输入：`taskId`
   - 前置检查：`task.status === failed` 且 `taskFilePath` 可通过 `fs.read_file` 读取
   - 执行：复用 `terminal.create`（必要时） + `terminal.write`
   - 输出状态：`failed -> sending -> sent|failed`
2. 草稿持久化载体：
   - local key: `gtoffice.task-center:{workspaceId}`
   - workspace file: `.gtoffice/tasks/.task-center-draft.json`
3. 草稿快照结构：
   - `version`
   - `updatedAtMs`
   - `draft`（markdown/targetStationIds[]）
   - `dispatchHistory[]`
4. 读写策略：
   - 加载时优先选择 `updatedAtMs` 更新的快照。
   - 写入采用防抖，避免高频编辑造成频繁 I/O。

### 3.6.3 Task Center 批量派发与 Agent 通道（T-146）

1. 新增命令：`task.dispatch_batch`
   - req:
     - `workspaceId: string`
     - `sender: { type: \"human\"|\"agent\", agentId?: string }`
     - `targets: string[]`（Agent/角色 ID）
     - `title: string`
     - `markdown: string`
     - `attachments: [{ path,name,category }]`（当前任务中心 UI 固定传 `[]`，字段保留用于兼容）
     - `submitSequences?: Record<string, string>`（保留字段；当前桌面实现不再依赖后端提交序列，统一由前端 xterm submit）
   - resp:
     - `batchId: string`
     - `results: [{ targetAgentId, taskId, status:\"sent\"|\"failed\", detail?, taskFilePath? }]`
2. 新增命令：`channel.publish`
   - req:
     - `workspaceId: string`
     - `channel: { kind:\"direct\"|\"group\"|\"broadcast\", id:string }`
     - `senderAgentId?: string`
     - `targetAgentIds?: string[]`
     - `type: \"task_instruction\"|\"status\"|\"handover\"`
     - `payload: object`
     - `idempotencyKey?: string`
   - resp:
     - `messageId: string`
     - `acceptedTargets: string[]`
     - `failedTargets: [{ agentId, reason }]`
3. 新增命令：`agent.runtime_register` / `agent.runtime_unregister`
   - register req: `{ workspaceId, agentId, stationId, roleKey?: string, sessionId, online?: true }`
   - register resp: `{ workspaceId, agentId, stationId, roleKey?: string, sessionId, registered: true|false }`
   - unregister req: `{ workspaceId, agentId }`
   - unregister resp: `{ workspaceId, agentId, unregistered: true|false }`
4. 语义约束：
   - 通道本期仅做传输，不做持久化；应用重启后消息不恢复。
   - 在线目标要求 ACK，离线目标立即失败（`AGENT_OFFLINE`）。
   - `agent.runtime_register` 建议携带 `roleKey`，供外部通道 `role:<role_key|role_id>` 路由时解析在线岗位实例。
   - `task.dispatch_batch` 采用“一发多单”：每个目标独立 `taskId` 与状态。
   - `task.dispatch_batch` 当前仅负责向目标 session 写入命令文本，不在命令文本后拼接回车控制字符。
   - 自动提交统一走前端 xterm sink：`StationXtermTerminal.submit -> terminal.input('\r', true)`，以终端原生输入链路触发 `onData`。
   - 前端执行顺序必须满足“命令写入成功 -> xterm submit”；若 submit 未命中可用 sink，则结果标记 `failed(detail=XTERM_SUBMIT_FAILED)`。

### 3.6.4 Task Center 输入体验约束（T-147）

1. 任务输入模型：
   - 前端不再拆分“标题 + 内容”双输入，统一使用 `markdown` 输入。
   - 派发前由前端从 `markdown` 提取标题摘要后填充 `task.dispatch_batch.title`。
2. `@` 文件引用：
   - 前端在检测到 `@keyword` 时调用 `fs.search_files` 获取候选。
   - 选中候选后写入 `@relative/path/to/file` 到 markdown 内容。
3. 目标选择：
   - UI 使用下拉多选目标 Agent，允许手动清空；清空状态必须保持，不得自动回填。

### 3.6.5 MCP Agent Bridge（T-171）

1. 新增本地桥接协议（仅本机环回）：
   - transport: `tcp + ndjson`（`127.0.0.1`）
   - request:
     - `id: string`
     - `token: string`
     - `method: "health"|"task.dispatch_batch"|"channel.publish"`
     - `params: object`
   - response:
     - `id: string`
     - `ok: boolean`
     - `data?: object`
     - `error?: { code: string, message: string, details?: object }`
2. `task.dispatch_batch`（桥接层）：
   - req: 透传 `TaskDispatchBatchRequest`（`workspaceId/sender/targets/title/markdown/attachments`）
   - resp: 透传 `TaskDispatchBatchResponse`（`batchId/results[]`）
3. `channel.publish`（桥接层）：
   - req: 透传 `ChannelPublishRequest`
   - resp: 透传 `ChannelPublishResponse`
4. 安全约束：
   - 仅绑定 `127.0.0.1`，拒绝非 loopback 来源。
   - token 不通过命令行回显，运行时写入受限文件（`~/.gtoffice/mcp/runtime.json`）。
   - token 缺失或不匹配返回 `MCP_BRIDGE_AUTH_FAILED`。
5. 超时与重试：
   - 单请求默认超时 `8s`。
   - 客户端允许最多 2 次瞬时重试（仅网络级失败可重试）。

### 3.7 Settings

1. `settings.get_effective`
   - req: `{ "workspaceId":"string?" }`
   - resp: `{ "workspaceId":"string?","values":{}, "sources":{"defaults":"built-in","user":"path","workspace":"path?","session":"runtime-memory?"} }`
2. `settings.update`
   - req: `{ "workspaceId":"string?", "scope":"user|workspace|session", "patch":{} }`
   - resp: `{ "workspaceId":"string?", "scope":"user|workspace|session", "patch":{}, "updated":true, "effective":{} }`
3. `settings.reset`
   - req: `{ "workspaceId":"string?", "scope":"user|workspace", "keys":["ui.theme"] }`
   - resp: `{ "workspaceId":"string?", "scope":"user|workspace|session", "keys":["ui.theme"], "reset":true, "effective":{} }`
4. UI 氛围灯设置字段（`T-096`）
   - key: `ui.ambientLighting.enabled`
   - type: `boolean`
   - default: `true`
   - 语义：控制主界面底层动态氛围灯背景显示；`false` 时关闭光效渲染层。
5. UI 氛围灯强度字段（`T-096`）
   - key: `ui.ambientLighting.intensity`
   - type: `"low" | "medium" | "high"`
   - default: `"medium"`
   - 语义：控制底层氛围灯强度档位（透明度、运动幅度、扰动强度、动画速率）。

### 3.8 Keymap

1. `keymap.list`
   - req: `{ "workspaceId":"string?" }`
   - resp: `{ "bindings":[] }`
2. `keymap.update_binding`
   - req: `{ "scope":"user|workspace", "commandId":"terminal.focus", "keystroke":"Ctrl+Alt+T" }`
   - resp: `{ "saved":true, "conflicts":[] }`
3. `keymap.reset`
   - req: `{ "scope":"user|workspace", "commandId":"terminal.focus?" }`
   - resp: `{ "reset":true }`
4. 快捷键覆盖约束（当前前端已消费）：
   - `keybindings.overrides` 中支持以下命令 ID：
     - `shell.search.open_file`（默认 `Ctrl/Cmd+P`）
     - `shell.search.open_content`（默认 `Ctrl/Cmd+Shift+F`）
     - `shell.editor.find`（默认 `Ctrl/Cmd+F`）
     - `shell.editor.replace`（默认 `Ctrl/Cmd+H`）
   - `keystroke` 支持 `Mod/Ctrl/Cmd/Shift/Alt + Key` 组合，前端按平台解析 `Mod`（macOS=Cmd，其它=Ctrl）。

### 3.9 AI Config

1. `ai_config.read_snapshot`
   - req: `{ "workspaceId":"string", "allow":"default|strict" }`
   - resp: `{ "snapshot":{}, "masking":[] }`
2. `ai_config.preview_patch`
   - req: `{ "workspaceId":"string", "scope":"workspace|user", "patch":{} }`
   - resp: `{ "allowed":true, "diff":{}, "warnings":[] }`
3. `ai_config.apply_patch`
   - req: `{ "workspaceId":"string", "previewId":"string", "confirmedBy":"user|policy" }`
   - resp: `{ "applied":true, "auditId":"string" }`

### 3.10 Agent Manager

1. `agent.department_list`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "departments":[{"id":"string","name":"string","orderIndex":1}] }`
2. `agent.role_list`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "roles":[{"id":"string","roleKey":"product","roleName":"Product","departmentId":"dept_product_management","status":"active"}] }`
3. `agent.list`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "agents":[{"id":"string","roleId":"string","state":"ready"}] }`
4. `agent.create`
   - req: `{ "workspaceId":"string", "agentId":"string?", "name":"string", "roleId":"string", "employeeNo":"string?", "state":"ready|paused|blocked|terminated?" }`
   - resp: `{ "agent":{"id":"string","roleId":"string","state":"ready"} }`
5. `agent.update_state`
   - req: `{ "agentId":"string", "to":"paused|ready|terminated" }`
   - resp: `{ "updated":true }`
6. `agent.assign_task`
   - req: `{ "agentId":"string", "taskTemplateId":"string", "payload":{} }`
   - resp: `{ "taskId":"string", "state":"QUEUED" }`

### 3.11 Channel

1. `channel.publish`
   - req: `{ "workspaceId":"string", "channelId":"string", "senderAgentId":"string", "type":"handover|status|instruction", "payload":{}, "idempotencyKey":"string?" }`
   - resp: `{ "messageId":"string", "seq":123, "status":"accepted" }`
2. `channel.subscribe`
   - req: `{ "workspaceId":"string", "channelId":"string", "consumer":"ui|agent", "consumerId":"string" }`
   - resp: `{ "subscriptionId":"string" }`
3. `channel.ack`
   - req: `{ "messageId":"string", "consumerId":"string" }`
   - resp: `{ "acked":true }`

### 3.12 Hook

1. `hook.list`
   - req: `{ "workspaceId":"string" }`
   - resp: `{ "subscriptions":[] }`
2. `hook.register`
   - req: `{ "workspaceId":"string", "event":"git.commit.succeeded", "filter":{}, "action":{}, "policy":{} }`
   - resp: `{ "hookId":"string", "enabled":true }`
3. `hook.toggle`
   - req: `{ "hookId":"string", "enabled":false }`
   - resp: `{ "updated":true }`
4. `hook.run_history`
   - req: `{ "workspaceId":"string", "hookId":"string?", "limit":100 }`
   - resp: `{ "runs":[] }`

### 3.13 Policy

1. `policy.preview_charter`
   - req: `{ "workspaceId":"string", "roleId":"string", "charterMarkdown":"string" }`
   - resp: `{ "valid":true, "summary":{}, "warnings":[] }`
2. `policy.get_snapshot`
   - req: `{ "policySnapshotId":"string" }`
   - resp: `{ "snapshot":{} }`
3. `policy.evaluate`
   - req: `{ "agentId":"string", "action":"terminal.exec|fs.write|settings.update", "resource":{}, "context":{} }`
   - resp: `{ "allowed":false, "decisionId":"string", "reason":"..." }`

### 3.14 Observability

1. `obs.query_graph`
   - req: `{ "workspaceId":"string", "from":"iso", "to":"iso", "filters":{} }`
   - resp: `{ "nodes":[], "edges":[], "stats":{} }`
2. `obs.query_timeline`
   - req: `{ "workspaceId":"string", "limit":200, "cursor":"string?" }`
   - resp: `{ "events":[], "nextCursor":"string?" }`

### 3.15 Cache（Redis 可选）

1. `cache.health`
   - req: `{}`
   - resp: `{ "enabled":true, "backend":"redis|local", "latencyMs":2 }`
2. `cache.flush_scope`
   - req: `{ "scope":"workspace", "workspaceId":"string" }`
   - resp: `{ "flushed":true }`

说明：

1. M1/M2 阶段固定 `backend=local`，不接入 Redis 运行时实现。
2. `cache.*` 契约保留用于 V3+ 向前兼容，不作为当前实现目标。

### 3.16 Sidecar Daemon Socket（T-098）

1. 传输层：
   - `linux/macos`：优先 UDS
   - `windows`：优先 Named Pipe
   - fallback：`127.0.0.1:<port>`
2. 帧格式：
   - `length-delimited` + `bincode`
   - request: `ClientFrame { id, request }`
   - response/event: `ServerFrame { request_id?, payload }`
3. Request 枚举（skeleton）：
   - `Ping`
   - `ListDir`
   - `SearchStart`
   - `SearchCancel`
   - `TerminalCreate`
   - `TerminalWrite`
   - `TerminalResize`
   - `TerminalKill`
4. `ListDir`
   - req: `{ "workspaceRoot":"string", "relPath":"string", "cursor":0?, "limit":256? }`
   - resp: `{ "relPath":"string", "entries":[...], "nextCursor":123?, "total":1000000 }`
5. `SearchStart`
   - req: `{ "searchId":"string", "workspaceRoot":"string", "query":"string", "glob":"*.rs?", "chunkSize":64?, "maxResults":10000? }`
   - resp: `{ "searchId":"string" }`
6. `SearchCancel`
   - req: `{ "searchId":"string" }`
   - resp: `{ "searchId":"string", "cancelled":true }`
7. `TerminalCreate`
   - req: `{ "workspaceRoot":"string", "cwd":"string?", "shell":"string?", "cols":120?, "rows":36?, "env":[["K","V"]] }`
   - resp: `{ "sessionId":"string", "resolvedCwd":"string" }`
8. `TerminalWrite`
   - req: `{ "sessionId":"string", "input":"bytes" }`
   - resp: `{ "sessionId":"string", "acceptedBytes":123 }`

### 3.17 Agent MCP 安装契约（T-171）

1. 安装目标（user scope）：
   - Claude Code：`~/.claude/settings.json`（或项目 `.mcp.json`）
   - Codex：`~/.codex/config.toml`
   - Gemini CLI：`~/.gemini/settings.json`
   - Qwen CLI：`~/.qwen/settings.json`
2. 统一 server id：`gto-agent-bridge`
3. 配置约束：
   - command 指向独立 MCP 工具可执行文件（解耦目录 `tools/gto-agent-mcp`）。
   - args 固定 `["serve"]`，避免各 CLI 配置分叉。
   - 重复安装时必须做 idempotent 更新（覆盖同名，不新增重复节点）。

### 3.18 外部通道适配契约（T-172）

1. 新增命令：`channel_adapter.status`
   - req: `{}`
   - resp: `{ "running":true, "adapters":[{"id":"feishu","mode":"webhook","enabled":true},{"id":"telegram","mode":"webhook","enabled":true}], "runtime":{"host":"127.0.0.1","port":18080,"baseUrl":"http://127.0.0.1:18080","feishuWebhook":"http://127.0.0.1:18080/webhook/feishu/<token>","telegramWebhook":"http://127.0.0.1:18080/webhook/telegram/<token>","metrics":{"totalRequests":0,"webhookRequests":0,"dispatched":0,"duplicate":0,"denied":0,"routeNotFound":0,"failed":0,"unauthorized":0,"rateLimited":0,"timeouts":0,"internalErrors":0,"lastError":"string?","lastErrorAtMs":0?}}, "snapshot":{} }`
2. 新增命令：`channel_binding.upsert`
   - req:
     - `workspaceId: string`
     - `channel: string`
     - `accountId?: string`
     - `peerKind?: "direct"|"group"`
     - `peerPattern?: string`
     - `targetAgentId: string`（支持直接 agent_id，或岗位选择器 `role:<role_key|role_id>`）
     - `priority?: number`
     - `createdAtMs?: number`（可选；缺省时由服务端首次创建时自动填充）
     - `botName?: string`（可选；缺省时服务端在首次绑定后尝试做一次 connector health 自动回填）
   - resp: `{ "updated":true, "created":true|false, "binding":{"workspaceId":"string","channel":"string","accountId":"string?","peerKind":"direct|group?","peerPattern":"string?","targetAgentId":"string","priority":0,"createdAtMs":1738932000456,"botName":"laplaceBitBot"} }`
3. 新增命令：`channel_binding.list`
   - req: `{ "workspaceId":"string?" }`
   - resp: `{ "bindings":[{"workspaceId":"string","channel":"string","accountId":"string?","peerKind":"direct|group?","peerPattern":"string?","targetAgentId":"string","priority":0,"createdAtMs":1738932000456,"botName":"laplaceBitBot?"}] }`
4. 新增命令：`channel_access.policy_set`
   - req: `{ "channel":"string", "accountId":"string?", "mode":"pairing|allowlist|open|disabled" }`
   - resp: `{ "updated":true, "channel":"string", "accountId":"string", "mode":"..." }`
5. 新增命令：`channel_access.approve`
   - req: `{ "channel":"string", "accountId":"string?", "identity":"string" }`
   - resp: `{ "approved":true|false, "channel":"string", "accountId":"string", "identity":"string" }`
6. 新增命令：`channel_access.list`
   - req: `{ "channel":"string", "accountId":"string?" }`
   - resp: `{ "channel":"string", "accountId":"string?", "entries":[{"channel":"string","accountId":"string","identity":"string","approved":true}] }`
7. 新增命令：`channel_external.inbound`
   - req:
     - `message.channel: "feishu"|"telegram"|string`
     - `message.accountId: string?`（默认 `default`）
     - `message.peerKind: "direct"|"group"`
     - `message.peerId: string`
     - `message.senderId: string`
     - `message.senderName?: string`
     - `message.messageId: string`
     - `message.text: string`
     - `message.idempotencyKey?: string`
     - `message.workspaceIdHint?: string`
     - `message.targetAgentIdHint?: string`
     - `message.metadata?: object`
   - resp:
     - `traceId: string`
     - `status: "dispatched"|"duplicate"|"pairing_required"|"denied"|"route_not_found"|"failed"`
     - `idempotentHit: boolean`
     - `workspaceId?: string`
     - `targetAgentId?: string`
     - `taskId?: string`
     - `pairingCode?: string`
     - `detail?: string`
8. 新增命令：`system.gto_doctor`
   - req: `{}`
   - resp: `{ "ok":true, "runtime":{}, "summary":{}, "checks":[...], "suggestions":[...] }`
9. 新增命令：`channel_connector_account_upsert`
   - req:
     - `channel: "telegram"|string`
     - `accountId?: string`（默认 `default`）
     - `enabled?: boolean`
     - `mode?: "webhook"|"polling"`（默认 `polling`）
     - `botToken?: string`（仅用于写入凭据后端，不落盘）
     - `botTokenRef?: string`
     - `webhookSecret?: string`
     - `webhookSecretRef?: string`
     - `webhookPath?: string`
   - resp: `{ "updated":true, "channel":"telegram", "account":{ "accountId":"default", "mode":"polling", "botTokenRef":"telegram/default/bot_token", "hasBotToken":true } }`
10. 新增命令：`channel_connector_account_list`
   - req: `{ "channel":"telegram"|string }`
   - resp: `{ "channel":"telegram", "accounts":[...] }`
11. 新增命令：`channel_connector_health`
   - req: `{ "channel":"telegram"|string, "accountId":"string?" }`
   - resp: `{ "channel":"telegram", "health":{ "ok":true|false, "status":"ok|auth_failed|disabled", "configuredWebhookUrl":"string?", "runtimeWebhookUrl":"string?", "webhookMatched":true|false|null } }`
12. 新增命令：`channel_connector_webhook_sync`
   - req: `{ "channel":"telegram"|string, "accountId":"string?", "webhookUrl":"string?" }`
   - resp: `{ "channel":"telegram", "result":{ "ok":true|false, "webhookUrl":"string", "webhookMatched":true|false, "detail":"string" } }`
   - 说明：
     - `webhookUrl` 为空时使用 runtime 的本机 webhook 地址（`channel_adapter_status.runtime.telegramWebhook`）。
     - Telegram 要求 `setWebhook` 为 HTTPS URL，传入非 HTTPS 将返回 `CHANNEL_CONNECTOR_WEBHOOK_INVALID`。
13. 语义约束：
   - `channel + accountId` 共同标识一个 bot 实例；同一 `channel` 可存在多个 `accountId`，绑定规则需按 bot 维度独立生效。
   - `channel_binding.list` 返回扁平绑定数组，前端展示层应按 `channel -> accountId(bot) -> route` 聚合，避免多 bot 场景信息混叠。
   - `createdAtMs` 记录绑定首建时间；更新既有绑定（同路由主键）时保持原时间不变。
   - `botName` 来源于 connector 健康检查：首次绑定时尝试回填一次；后续健康检查发现变更可通过再次 upsert 更新并持久化。
   - Telegram connector 建议默认 `polling` 模式（token 可用即可完成入站），`webhook` 作为高级可选模式。
   - 默认准入策略为 `pairing`。
   - 幂等命中返回 `duplicate`，不得重复派发任务。
   - 路由未命中返回 `route_not_found` 并发射错误事件。
   - 当 `targetAgentId` 为 `role:<role_key|role_id>` 时，入站派发前按岗位解析目标集合（优先岗位下 agent 档案，同时吸收 `agent.runtime_register.roleKey` 匹配的在线实例）；若岗位不存在或无可投递目标，返回 `failed` 并附错误详情。
   - 入站派发成功后需将目标 runtime session 与外部会话上下文绑定；终端输出若为流式，需按“节流窗口更新同一预览消息 + 静默窗口/会话结束最终收敛”回传，禁止逐 chunk 新消息出站（当前回传通道：Telegram）。
14. runtime 约束：
   - 桌面端启动后自动监听 `127.0.0.1:<random_port>`，并写入 `~/.gtoffice/channel/runtime.json`。
   - 回调路径：`POST /webhook/feishu/<token>`、`POST /webhook/telegram/<token>`。
   - 健康检查：`GET /health`。
   - 稳定性保护：请求读取超时（30s）、content-type 校验（json）、按通道限流（60s 窗口）与 runtime 指标计数。

## 4. Event 契约（V1）

1. `terminal/output`
   - payload: `{ "sessionId":"string", "chunk":"base64", "seq":123, "tsMs":1738932000000 }`
2. `terminal/state_changed`
   - payload: `{ "sessionId":"string", "from":"starting|running", "to":"running|killed|exited", "tsMs":1738932000123 }`
3. `task/changed`
   - payload: `{ "taskId":"string", "state":"IN_PROGRESS", "progress":65 }`
4. `changefeed/append`
   - payload: `{ "eventId":"string", "workspaceId":"string", "source":"tool", "paths":[] }`
5. `workspace/updated`
   - payload: `{ "workspaceId":"string", "kind":"opened|closed|reloaded" }`
6. `workspace/active_changed`
   - payload: `{ "workspaceId":"string", "previousWorkspaceId":"string?" }`
7. `git/updated`
   - payload: `{ "workspaceId":"string", "branch":"main", "dirty":true }`
8. `settings/updated`
   - payload: `{ "workspaceId":"string?", "scope":"user|workspace|session", "keys":["ui.theme","ui.ambientLighting.enabled","ui.ambientLighting.intensity"]?, "tsMs":1738932000123 }`
9. `keymap/updated`
   - payload: `{ "scope":"user|workspace", "commands":["terminal.focus"] }`
10. `ai_config/changed`
   - payload: `{ "auditId":"string", "scope":"workspace", "changedKeys":[] }`
11. `agent/state_changed`
   - payload: `{ "agentId":"string", "roleId":"string", "from":"ready", "to":"paused" }`
12. `channel/message`
   - payload: `{ "channelId":"string", "messageId":"string", "seq":123, "type":"handover", "senderAgentId":"string" }`
13. `channel/ack`
   - payload: `{ "workspaceId":"string", "messageId":"string", "targetAgentId":"string", "status":"delivered|failed", "reason":"string?", "tsMs":1738932000456 }`
14. `task/dispatch_progress`
   - payload: `{ "batchId":"string", "workspaceId":"string", "targetAgentId":"string", "taskId":"string", "status":"sending|sent|failed", "detail":"string?" }`
15. `hook/executed`
   - payload: `{ "hookId":"string", "runId":"string", "event":"git.commit.succeeded", "status":"SUCCESS|FAILED" }`
16. `policy/denied`
   - payload: `{ "decisionId":"string", "agentId":"string", "action":"terminal.exec", "reason":"PATH_OUTSIDE_SCOPE" }`
17. `obs/graph_updated`
   - payload: `{ "workspaceId":"string", "window":"last_5m", "nodeCount":120, "edgeCount":340 }`
18. `filesystem/changed`
   - payload: `{ "workspaceId":"string", "kind":"created|modified|removed|renamed|other", "paths":["src/main.rs"], "tsMs":1738932000999 }`
19. `filesystem/watch_error`
   - payload: `{ "workspaceId":"string", "detail":"string" }`
20. `daemon/search_chunk`
   - payload: `{ "searchId":"string", "items":[{"path":"src/main.rs","line":12,"column":3,"preview":"..."}] }`
21. `daemon/search_backpressure`
   - payload: `{ "searchId":"string", "droppedChunks":12 }`
22. `daemon/search_done`
   - payload: `{ "searchId":"string", "scannedFiles":12000, "emittedMatches":348, "cancelled":false }`
23. `daemon/search_cancelled`
   - payload: `{ "searchId":"string" }`
24. `external/channel_inbound`
   - payload: `{ "traceId":"string", "channel":"string", "accountId":"string", "peerKind":"direct|group", "peerId":"string", "senderId":"string", "senderName":"string?", "messageId":"string", "text":"string?" }`
25. `external/channel_routed`
   - payload: `{ "traceId":"string", "workspaceId":"string", "targetAgentId":"string", "matchedBy":"string", "resolvedTargets":["string"] }`
26. `external/channel_dispatch_progress`
   - payload: `{ "traceId":"string", "workspaceId":"string", "targetAgentId":"string", "taskId":"string", "status":"sending|sent|failed", "detail":"string?" }`
27. `external/channel_reply`
   - payload: `{ "workspaceId":"string", "messageId":"string", "targetAgentId":"string", "status":"delivered|failed", "reason":"string?" }`
28. `external/channel_error`
   - payload: `{ "traceId":"string", "code":"string", "detail":"string" }`
29. `external/channel_outbound_result`
   - payload: `{ "traceId":"string?", "workspaceId":"string", "messageId":"string", "targetAgentId":"string", "status":"delivered|failed", "detail":"string?", "tsMs":1738932000456 }`
30. `external/channel_connector_health_changed`
   - payload: `{ "channel":"telegram|feishu", "accountId":"string", "ok":true|false, "status":"ok|auth_failed|disabled", "detail":"string", "checkedAtMs":1738932000456 }`

## 5. 错误码规范

错误码格式：`<DOMAIN>_<REASON>`

建议域：

1. `WORKSPACE_*`
2. `FS_*`
3. `TERMINAL_*`
4. `GIT_*`
5. `TOOL_*`
6. `SECURITY_*`
7. `TASK_*`
8. `SETTINGS_*`
9. `KEYMAP_*`
10. `AI_CONFIG_*`
11. `AGENT_*`
12. `CHANNEL_*`
13. `HOOK_*`
14. `POLICY_*`
15. `OBS_*`
16. `CACHE_*`
17. `MCP_BRIDGE_*`

首批错误码：

1. `WORKSPACE_NOT_FOUND`
2. `WORKSPACE_CONTEXT_REQUIRED`
3. `FS_PATH_INVALID`
4. `TERMINAL_SPAWN_FAILED`
5. `TERMINAL_CWD_OUTSIDE_WORKSPACE`
6. `TERMINAL_SESSION_NOT_FOUND`
7. `TERMINAL_CWD_MODE_INVALID`
8. `TERMINAL_WRITE_FAILED`
9. `TERMINAL_RESIZE_FAILED`
10. `TERMINAL_KILL_FAILED`
11. `GIT_REPO_INVALID`
12. `TOOL_PROFILE_INVALID`
13. `SECURITY_PATH_DENIED`
14. `TASK_TIMEOUT`
15. `SETTINGS_SCHEMA_INVALID`
16. `KEYMAP_CONFLICT`
17. `KEYMAP_SYSTEM_RESERVED`
18. `AI_CONFIG_FORBIDDEN_FIELD`
19. `AI_CONFIG_PATCH_INVALID`
20. `AGENT_ROLE_INVALID`
21. `AGENT_CHARTER_INVALID`
22. `CHANNEL_PUBLISH_FAILED`
23. `CHANNEL_SEQ_GAP_DETECTED`
24. `HOOK_EXEC_TIMEOUT`
25. `HOOK_CIRCUIT_OPEN`
26. `POLICY_DENIED`
27. `OBS_QUERY_INVALID`
28. `CACHE_BACKEND_UNAVAILABLE`
29. `DAEMON_CONNECTION_CLOSED`
30. `DAEMON_FRAME_TOO_LARGE`
31. `SEARCH_TASK_CANCELLED`
32. `SEARCH_BACKPRESSURE_DROPPED`
33. `MCP_BRIDGE_UNAVAILABLE`
34. `MCP_BRIDGE_AUTH_FAILED`
35. `MCP_BRIDGE_TIMEOUT`
36. `MCP_BRIDGE_METHOD_UNSUPPORTED`
37. `CHANNEL_ROUTE_NOT_FOUND`
38. `CHANNEL_PAIRING_REQUIRED`
39. `CHANNEL_ALLOWLIST_DENIED`
40. `CHANNEL_DISABLED`
41. `CHANNEL_DISPATCH_FAILED`
42. `CHANNEL_CONNECTOR_UNCONFIGURED`
43. `CHANNEL_CONNECTOR_NOT_FOUND`
44. `CHANNEL_CONNECTOR_AUTH_FAILED`
45. `CHANNEL_CONNECTOR_PROVIDER_UNAVAILABLE`
46. `CHANNEL_CONNECTOR_WEBHOOK_MISSING`

## 6. SQLite 草案（V1）

### 6.1 表结构（建议）

1. `workspaces(id, root_path, name, pinned, active, last_opened_at, created_at)`
2. `window_sessions(id, workspace_id, layout_json, opened_tabs_json, updated_at)`
3. `terminal_sessions(id, workspace_id, shell, cwd, state, tool_session_id, started_at, ended_at)`
4. `tool_profiles(id, workspace_id, name, cmd, args_json, env_json, policy_json, updated_at)`
5. `task_runs(id, workspace_id, source, state, payload_json, started_at, ended_at)`
6. `change_feed_events(id, workspace_id, source, source_id, kind, paths_json, summary, created_at)`
7. `app_settings(key, value_json, updated_at)`
8. `setting_change_logs(id, scope, changed_keys_json, actor, created_at)`
9. `keymap_bindings(id, scope, command_id, keystroke, when_clause, source, updated_at)`
10. `ai_config_audit_logs(id, workspace_id, preview_id, diff_json, actor, status, created_at)`
11. `workspace_context_snapshots(id, workspace_id, terminal_default_cwd, env_policy_json, updated_at)`
12. `org_departments(id, workspace_id, name, description, order_index, is_system, created_at_ms, updated_at_ms)`
13. `agent_roles(id, workspace_id, role_key, role_name, department_id, charter_path, policy_json, version, status, is_system, created_at_ms, updated_at_ms)`
14. `agents(id, workspace_id, name, role_id, state, employee_no, policy_snapshot_id, created_at_ms, updated_at_ms)`
15. `agent_task_assignments(id, task_id, agent_id, assigned_by, assigned_at, status)`
16. `channel_messages(id, workspace_id, channel_id, seq, sender_agent_id, msg_type, payload_json, idempotency_key, status, created_at)`
17. `hook_subscriptions(id, workspace_id, event_name, filter_json, action_json, policy_json, enabled, updated_at)`
18. `hook_runs(id, hook_id, event_id, task_id, status, duration_ms, error_json, created_at)`
19. `policy_decisions(id, policy_snapshot_id, agent_id, action, resource_json, allowed, reason, created_at)`
20. `agent_graph_edges(id, workspace_id, src_type, src_id, dst_type, dst_id, edge_type, created_at)`

### 6.2 索引建议

1. `idx_workspaces_last_opened_at`
2. `idx_terminal_sessions_workspace_id`
3. `idx_task_runs_state`
4. `idx_change_feed_workspace_created`
5. `idx_channel_messages_channel_seq`
6. `idx_hook_runs_hook_id_created`
7. `idx_policy_decisions_agent_created`
8. `idx_agent_graph_workspace_created`
9. `idx_agent_roles_workspace_key`
10. `idx_agent_roles_workspace_department`
11. `idx_agents_workspace_role`

## 7. `.gtoffice/config.json` Schema 草案

```json
{
  "$schema": "https://gtoffice.dev/schemas/workspace-config.v1.json",
  "workspace": {
    "name": "my-project",
    "terminalDefaultCwd": "workspace_root"
  },
  "defaultShell": "bash",
  "restorePolicy": {
    "restoreWindows": true,
    "restoreTerminals": true
  },
  "allowedPaths": ["./", "../shared-lib"],
  "search": {
    "ignoreOverrides": ["dist/**"]
  },
  "ui": {
    "theme": "graphite-dark",
    "density": "compact",
    "fontFamily": "SF Pro Text",
    "monoFontFamily": "JetBrains Mono"
  },
  "keybindings": {
    "profile": "vscode-lite",
    "overrides": [
      {
        "command": "tool.launch.codex_default",
        "keystroke": "Ctrl+Alt+C"
      }
    ]
  },
  "terminal": {
    "cwdPolicy": "workspace_root"
  },
  "agent": {
    "charterPath": ".gtoffice/agents/AGENT_CHARTER.md",
    "rolesPath": ".gtoffice/agents/roles",
    "enforceCharter": true
  },
  "channels": {
    "defaultReliability": "at_least_once",
    "maxRetry": 3
  },
  "hooks": {
    "enabled": true,
    "maxConcurrency": 8,
    "defaultTimeoutMs": 12000
  },
  "aiConfig": {
    "allowRead": ["ui.*", "terminal.*", "keybindings.*", "toolProfiles.*"],
    "allowWrite": ["ui.theme", "ui.density", "terminal.defaultShell", "keybindings.overrides", "toolProfiles.*"],
    "requireConfirm": true
  },
  "toolProfiles": [
    {
      "id": "codex-default",
      "name": "Codex Default",
      "cmd": "codex",
      "args": ["--model", "gpt-5"],
      "env": {
        "OPENAI_API_KEY": "@secret:openai_key"
      },
      "policy": {
        "allowNetwork": true,
        "allowedPaths": ["./"]
      }
    }
  ]
}
```

## 8. 协议版本策略

1. 命令与事件带 `apiVersion`（默认 `v1`）。
2. 破坏性变更升级到 `v2` 并保留迁移窗口。
3. `shared-types` 提供版本化类型与兼容层。
4. `ai_config.*` 契约默认开启严格模式，新增字段必须显式加入白名单。
5. `agent/channel/hook/policy/obs/cache` 先发布 `v1alpha`，稳定后升级为 `v1`。

## 9. 测试与验收

1. 命令契约测试：request/response 类型校验。
2. 事件顺序测试：terminal 输出 seq 连续性。
3. 错误码测试：已知失败场景应返回稳定错误码。
4. 向后兼容测试：旧 config 在新版本可迁移。
5. 配置权限测试：AI 读取/写入超出白名单时必须被拒绝。
6. 快捷键冲突测试：冲突保存请求返回 `KEYMAP_CONFLICT`。
7. 多工作区隔离测试：A/B 工作区终端与任务归属必须正确。
8. 终端 cwd 约束测试：workspace 外路径必须返回 `TERMINAL_CWD_OUTSIDE_WORKSPACE`。
9. Agent 角色权限测试：越权动作必须返回 `POLICY_DENIED`。
10. Channel 顺序与幂等测试：同通道 seq 连续、重复消息去重。
11. Hook 熔断测试：连续失败达到阈值触发 `HOOK_CIRCUIT_OPEN`。
12. Redis 降级测试：缓存不可用时 `cache.health` 返回 `backend=local` 且主流程可用。
