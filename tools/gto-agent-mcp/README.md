# gto-agent-mcp

独立 MCP 工具（与 GT Office 主工程解耦），用于多 Agent 协作通信：

- manager agent 派发任务给执行 agent（复用 GT Office `task_dispatch_batch`）
- 执行 agent 向 manager 汇报 `status/handover`（复用 GT Office `channel_publish`）
- 自动将 MCP server 与默认通信 policy 写入主流 CLI Agent 用户配置（Claude/Codex/Gemini/Qwen）

## 命令

```bash
# 启动 MCP server（stdio）
node tools/gto-agent-mcp/bin/gto-agent-mcp.mjs serve

# 安装到 CLI Agent 用户配置（开发态，写入本地 command）
node tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs

# 安装为发布态入口（推荐用于发布包 / 一键安装）
node tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs --mode npx

# 指定目标工作区（用于 Claude 新版 project-scope MCP 配置）
node tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs --workspace /mnt/c/project/vbCode
```

安装模式说明：

- `--mode local`：写入本地 sidecar / node 脚本命令，适合仓库开发调试
- `--mode npx`：写入 `npx -y @gtoffice/agent-mcp-bridge@<version> serve`，适合发布分发
- `--mode auto`：优先尝试 `npx`，无法解析发布包信息时回退本地命令

GT Office 桌面端的一键安装也遵循同一策略：

- debug/dev 构建默认写入本地命令，避免影响仓库联调
- release 构建默认写入 `npx` 入口，避免把本机 `target/.../debug/...` 路径扩散到用户配置

## 运行时依赖

MCP server 通过本地桥接文件连接 GT Office：

- 默认运行时文件：`~/.gtoffice/mcp/runtime.json`
- 可用环境变量覆盖：`GTO_MCP_RUNTIME_FILE=/custom/runtime.json`

运行时文件由 GT Office 桌面端启动时生成，包含：

- `host`
- `port`
- `token`

WSL 兼容说明：

- 当 CLI Agent 运行在 WSL、而 GT Office 桌面端运行在 Windows 时，sidecar 会优先探测 `/mnt/c/Users/<user>/.gtoffice/mcp/runtime.json`
- 安装器会把 `GTO_MCP_RUNTIME_FILE` 写入 MCP 配置，避免读取到陈旧的 Linux 家目录 runtime
- 安装器还会写入 `GTO_AGENT_COMMUNICATION_POLICY_FILE`，并在常见指令文件位置落一份托管的默认协作 policy

默认行为：

- GT Office agent 间通信默认走本 MCP
- `workspace_id` 在 `gto_get_agent_directory/gto_dispatch_task/gto_report_status/gto_handover` 中都可自动解析
- `sender_agent_id` 在 `gto_report_status/gto_handover` 中可按 `显式参数 -> GTO_AGENT_ID -> 当前 cwd/目录推断` 自动识别
- sender agent 可通过 `gto_list_messages` 拉取自己收到的 `status/handover` 回复内容
- 纯终端打印但未走 MCP 的回复，不会进入 inbox

## 暴露工具

- `gto_get_agent_directory`
- `gto_dispatch_task`
- `gto_report_status`
- `gto_handover`
- `gto_health`
- `gto_list_messages`
