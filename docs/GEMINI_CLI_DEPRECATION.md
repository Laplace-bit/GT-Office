# Gemini CLI 下线说明

> **状态**：已下线（`feature/deprecate-gemini-cli` 分支）  
> **原因**：Google 已放弃 Gemini CLI；GT Office 不再投入维护该工具链。

## 用户可见变化

| 能力 | 之前 | 现在 |
|------|------|------|
| 设置 → AI 工具安装 | 显示 Gemini CLI 卡片，可安装/卸载 | **不再显示** Gemini 卡片 |
| Provider 配置工作区 | 可打开 Gemini 供应商配置 | **入口移除** |
| Station 新建 Agent | 可选 Gemini CLI | **不可选**（仅 Claude / Codex） |
| 一键启动 CLI Agent | `tool_launch` profile `gemini` | **拒绝启动**，返回 `TOOL_PROFILE_DEPRECATED` |
| Quick Commands 配置 | Claude / Codex / Gemini | **仅 Claude / Codex** |
| 微信/飞书 Channel 结构化回复 | 支持 Gemini runtime | **返回 deprecated 错误** |
| 本机仍安装 Gemini CLI | 可卸载 | **仍可通过设置卸载**（清理用），不可新装 |

## 技术开关

Rust 侧统一开关（`crates/gt-tools/src/agent_installer.rs`）：

```rust
pub const GEMINI_CLI_SUPPORTED: bool = false;
```

- `install_agent`：安装直接失败并返回说明文案  
- `install_status`：Gemini 返回 `install_available: false`  
- `tool_list_profiles`：列表不含 Gemini  
- `tool_launch`：`gemini` profile 返回 `TOOL_PROFILE_DEPRECATED`  

## 存量数据

- 工作区中 **已绑定 Gemini 的 Agent/Station** 仍可能显示为 Gemini 工具类型，但 **无法启动**；建议用户编辑 Station 改为 Claude 或 Codex。  
- SQLite / 设置里历史的 Gemini Provider 配置 **未自动删除**，仅 UI 不再暴露编辑入口。  
- `AiConfigSnapshot.gemini` 字段仍可能存在于 API 响应中（兼容旧客户端），但 `agents[]` 不再包含 Gemini 卡片。

## 后续 Session 架构

Agent Session 管理（见 [AGENT_SESSION_ARCHITECTURE.md](./AGENT_SESSION_ARCHITECTURE.md)）仅针对 **Claude Code + Codex CLI** 设计，不包含 Gemini Discovery/Resume。

## 相关文档更新（待合并时同步）

- `STRATEGIC_DIRECTION.md`、`WORKFLOWS.md`、`README.md` 等对外表述应改为 **Claude + Codex**，不再列举 Gemini CLI。
