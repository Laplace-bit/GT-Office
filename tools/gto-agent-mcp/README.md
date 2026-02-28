# gto-agent-mcp

独立 MCP 工具（与 GT Office 主工程解耦），用于多 Agent 协作通信：

- manager agent 派发任务给执行 agent（复用 GT Office `task_dispatch_batch`）
- 执行 agent 向 manager 汇报 `status/handover`（复用 GT Office `channel_publish`）
- 自动将 MCP server 写入主流 CLI Agent 用户配置（Claude/Codex/Gemini/Qwen）

## 命令

```bash
# 启动 MCP server（stdio）
node tools/gto-agent-mcp/bin/gto-agent-mcp.mjs serve

# 安装到 CLI Agent 用户配置
node tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs

# 指定目标工作区（用于 Claude 新版 project-scope MCP 配置）
node tools/gto-agent-mcp/bin/gto-agent-mcp-install.mjs --workspace /mnt/c/project/vbCode
```

## 运行时依赖

MCP server 通过本地桥接文件连接 GT Office：

- 默认运行时文件：`~/.gtoffice/mcp/runtime.json`
- 可用环境变量覆盖：`GTO_MCP_RUNTIME_FILE=/custom/runtime.json`

运行时文件由 GT Office 桌面端启动时生成，包含：

- `host`
- `port`
- `token`

## 暴露工具

- `gto_dispatch_task`
- `gto_report_status`
- `gto_handover`
- `gto_health`
