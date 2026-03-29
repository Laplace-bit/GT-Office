# GT-Office CLI Harness Design

## Summary

为 GT-Office 主仓库新增一个 `cli-anything` 风格的状态化 CLI harness，目标是让 AI agent 能以稳定、可机读、可持续会话的方式操作 GT-Office 的核心产品能力，而不入侵现有业务逻辑。

## Goals

1. 为 GT-Office 提供一个 agent-first 的 CLI 接口，而不是仅服务开发调试。
2. CLI 支持 one-shot 子命令与默认 REPL 两种模式。
3. 所有关键命令支持稳定的 `--json` 输出，便于 AI agent 编排。
4. CLI 会话状态独立持久化，不污染 GT-Office 现有配置。
5. 新增代码尽量收敛在独立 workspace 内，通过薄 adapter 接入现有能力。

## Non-Goals

1. 不重写 GT-Office 业务规则。
2. 不把现有 WebUI feature/controller/store 直接搬进 CLI。
3. 不为了 CLI 改造大面积现有架构。
4. 不在首期追求面向人类的复杂交互体验，优先保证 agent 稳定调用。

## Constraints

1. Harness 放在仓库内独立 package/workspace，而不是根目录散落文件。
2. 允许新增 CLI 专用编排层，但代码不要入侵现有逻辑。
3. 底层约束需遵守现有架构文档，尤其是 `workspace_id` 显式携带、模块边界、最小 diff、最小验证。
4. 输出模型尽量贴合 `docs/06_API与事件契约草案.md` 中的 `ResultEnvelope`。

## Relevant Existing Context

### Architecture alignment

根据 `docs/02_系统架构与模块目录设计.md`：

- GT-Office 已按 `workspace / filesystem / terminal / git / agent / channel / settings` 等域进行模块化。
- WebUI 与后端通过 command/event 契约交互。
- 多工作区与终端等核心能力要求显式上下文，不能被 CLI 的便捷状态绕过。

### Contract alignment

根据 `docs/06_API与事件契约草案.md`：

- 多数核心域已经有明确 command 契约与稳定错误码。
- 所有响应建议使用统一 `ResultEnvelope`。
- `workspaceId` 是大量命令的硬约束。

### Product alignment

根据 `docs/05_高质量功能设计_核心工作流.md`：

- 当前高优先级能力已经围绕 agent/channel/task/settings 等协作域展开。
- CLI 若要成为“无头 GT-Office”入口，应优先覆盖这些已有主域，而不是额外创造新产品语义。

## Recommended Approach

采用 **方案 A：独立 Node CLI workspace + 轻量 GT-Office 编排层**。

### Why this approach

1. 最符合“允许新建一套 CLI 专用编排层，但不入侵现有逻辑”。
2. 最容易实现 `cli-anything` 风格的默认 REPL、状态持久化、稳定 JSON 输出。
3. 与 monorepo 现有 Node workspace、共享类型和前后端契约更容易协同。
4. 比 Rust-only CLI 更适合当前阶段快速做出 agent-first harness，而不逼迫现有后端大规模重构。

## Rejected Alternatives

### 方案 B：独立 Rust CLI crate

优点是类型边界和系统层复用更强，但当前产品操作能力大量依赖既有契约和跨层协同。若首期走 Rust-only，更容易把任务扩展成“先补齐大量后端能力暴露”，不符合最小闭环目标。

### 方案 C：外置 sidecar 风格 CLI

虽然更像“驱动一个运行中的桌面端”，但太依赖正在运行的 GT-Office 实例，不利于稳定测试、脚本化与 agent 编排，也偏离了状态化 harness 的长期目标。

## Design

### 1. Placement and isolation

新 CLI 放在：

`tools/gt-office-cli/`

该目录作为独立 workspace/package 存在，所有 CLI 相关新增复杂度都应优先收敛到这里，不污染：

- `apps/desktop-web/`
- `apps/desktop-tauri/`
- `crates/`

只有当 CLI 首期必须使用、且仓库中不存在稳定后端入口时，才允许补充最薄的一层适配；补口也应以“后端能力补齐”为目标，不能把 CLI 逻辑散落到 UI 代码中。

### 2. Responsibility boundary

CLI harness 只负责三件事：

1. 管理 CLI/REPL 会话状态。
2. 将命令翻译为对 GT-Office 核心能力的调用。
3. 以统一 human/json 格式输出结果。

CLI harness 不负责：

1. 定义新的产品业务规则。
2. 在 command 入口中堆积业务逻辑。
3. 通过 session convenience 绕过产品层约束。

### 3. Directory structure

建议目录：

```text
tools/gt-office-cli/
  package.json
  src/
    index.ts
    gt_office_cli.ts
    core/
      project-state.ts
      session-store.ts
      result-envelope.ts
    adapters/
      workspace-adapter.ts
      filesystem-adapter.ts
      terminal-adapter.ts
      git-adapter.ts
      agent-adapter.ts
      channel-adapter.ts
      settings-adapter.ts
      task-adapter.ts
    commands/
      workspace.ts
      files.ts
      terminal.ts
      git.ts
      agent.ts
      channel.ts
      task.ts
      settings.ts
      session.ts
      repl.ts
    utils/
      format.ts
      json-output.ts
      paths.ts
      errors.ts
  tests/
    TEST.md
    test_core.ts
    test_e2e.ts
```

### 4. Command model

CLI 采用双模式：

1. **one-shot 子命令**：适用于脚本、CI、AI agent 编排。
2. **默认 REPL**：无子命令时进入交互模式，适用于长会话和连续操作。

首期命令组：

- `workspace`: `list/open/close/active/context`
- `files`: `ls/read/write/search/move/copy/delete`
- `terminal`: `create/select/write/resize/kill/status`
- `git`: `status/diff/log/stage/unstage/commit/branches/checkout`
- `agent`: `list/create/update/delete/assign/runtime`
- `channel`: `dispatch/status/handover/inbox`
- `task`: `list/show/watch`
- `settings`: `get/update/reset`
- `session`: `show/save/load/reset`
- `repl`: 显式进入 REPL；但无子命令时默认进入

命令命名要尽量贴合 GT-Office 现有主域，不另造抽象名词。

### 5. State model

CLI 维护一个轻量 session 状态，至少包含：

- `activeWorkspaceId`
- `activeWorkspaceRoot`
- `selectedTerminalSessionId`
- `selectedAgentId`
- `outputMode`
- 最近一次成功调用的上下文元数据

持久化位置应为 CLI 自己的状态目录，而不是 GT-Office 业务配置：

- macOS/Linux: `~/.config/gt-office-cli/session.json` 或等价 XDG 目录
- Windows: 平台等价用户状态目录

关键原则：

- CLI 顶层可以从 session 自动补全参数。
- adapter 层向 GT-Office 能力发起调用时，仍需显式携带 `workspaceId` 等关键上下文。
- CLI convenience 不能破坏 `docs/06` 中的显式上下文约束。

### 6. Adapter strategy

`adapters/` 构成 CLI 专用 capability facade。

每个 adapter：

- 只负责一个域的能力映射。
- 接收 CLI 参数与 session context。
- 输出标准化 data/error 结构。
- 隐藏底层调用细节。

底层接入优先级：

1. 现有稳定契约（优先）
2. 现有可复用后端模块或共享类型
3. CLI 内部薄 adapter 补口
4. 明确禁止：直接复用或迁移 WebUI feature/store/controller 作为 CLI 核心依赖

### 7. Output and error model

所有命令都应支持：

- human-readable 输出
- `--json` machine-readable 输出

CLI 用户可见的 `--json` 模式统一对齐稳定的 `ResultEnvelope` 风格：成功响应固定返回 `ok / data / error / traceId`，失败响应固定返回 `ok / data / error / traceId`，其中未使用的分支显式为 `null`，便于脚本和 agent 端做稳定解码。底层本地 desktop bridge 传输层仍可额外携带请求相关字段（例如 bridge response 的 `id`），但这不改变 CLI 对外承诺的结果 envelope。

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "traceId": "..."
}
```

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_JSON",
    "message": "Option must be valid JSON"
  },
  "traceId": "..."
}
```

错误模型要求：

- 优先复用 GT-Office 已有错误码，例如：
  - `SECURITY_PATH_DENIED`
  - `CHANNEL_ROUTE_NOT_FOUND`
  - `AGENT_OFFLINE`
  - `MCP_INVALID_PARAMS`
- 仅在 harness 层新增最少错误码，例如：
  - `CLI_SESSION_NOT_INITIALIZED`
  - `CLI_ACTIVE_WORKSPACE_REQUIRED`
  - `CLI_TERMINAL_NOT_SELECTED`
  - `CLI_UNSUPPORTED_BACKEND`

这样可区分“GT-Office 本体错误”与“CLI 会话编排错误”。

### 8. Testing and validation

首期验证重点是“agent 可稳定调用”，不是复杂的人类交互体验。

最小验证矩阵：

1. **核心单测**
   - session store
   - result envelope
   - 参数解析
   - adapter mock 行为

2. **契约级集成测试**
   - `workspace/files/terminal/git/agent/channel/task/settings` 至少各一条主路径
   - 验证 `--json` 输出结构稳定
   - 验证 session 自动补全不绕过底层 `workspaceId` 约束

3. **端到端测试**
   - open workspace
   - create/select terminal
   - write command
   - query git status
   - dispatch channel/agent action
   - save/load session

4. **仓库级最小验证**
   - `npm run typecheck`
   - `npm run build:tauri`
   - `cargo check --workspace`
   - CLI workspace 自身 build/test

如果某项暂时无法验证，必须明确记录：`未验证 + 原因`。

## Acceptance Criteria

该设计落地后，首个可接受版本至少满足：

1. `tools/gt-office-cli/` 作为独立 workspace 存在。
2. CLI 默认进入 REPL，且支持 one-shot 子命令。
3. 关键命令具有稳定 `--json` 输出。
4. session 状态独立持久化，不污染 GT-Office 原有配置。
5. CLI 通过 adapter/orchestration 层调用 GT-Office 能力，而不是直接依赖 UI 逻辑。
6. 多工作区相关命令在底层调用时仍显式传递 `workspaceId`。
7. 完成至少一条贯穿 `workspace -> terminal -> git -> channel/agent` 的可验证主路径。

## Risks and mitigation

### 风险 1：现有能力缺少稳定无头入口

缓解：先以 adapter 封装缺口；若确需补能力，补在后端边界，不把逻辑放到 UI。

### 风险 2：CLI 状态便利性破坏现有架构约束

缓解：顶层只做自动补全；adapter 与底层调用始终显式携带关键上下文字段。

### 风险 3：命令组过大，首期范围失控

缓解：优先按现有主域建壳，首期只打通最小主路径，再逐步扩展子命令。

## Final recommendation

推荐在 GT-Office 主仓库内，以 `tools/gt-office-cli/` 独立 Node workspace 形式实现一个 agent-first、状态化、默认 REPL 的 CLI harness。它通过独立 adapter/orchestration 层对接 GT-Office 现有核心能力与契约，统一提供稳定 JSON 输出与独立 session 状态持久化，并将新增复杂度尽量限制在 CLI workspace 内。