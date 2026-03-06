# External Channel Relay 架构方案

## 问题诊断

### 当前方案的根本缺陷

我们在尝试从"为人类阅读设计的终端输出"中提取"结构化的机器可读内容"。

```
PTY 原始输出 → VT100 解析 → 行级过滤 → 启发式提取 → Telegram
```

**核心矛盾**：
- TUI 框架（ink、ratatui）使用复杂的 ANSI 控制序列
- 光标定位、覆盖写入、alternate screen buffer 导致内容混乱
- 黑名单过滤器脆弱，维护成本高，误杀风险大

**类比**：这就像从 HTML 渲染后的截图中提取原始文本 —— 理论上可行，但极其脆弱。

## 可靠方案：三层架构

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent 进程                               │
│                                                              │
│  ┌──────────────┐              ┌──────────────┐            │
│  │  Display     │              │  Data        │            │
│  │  Channel     │              │  Channel     │            │
│  │  (PTY)       │              │  (Pipe/File) │            │
│  └──────┬───────┘              └──────┬───────┘            │
└─────────┼──────────────────────────────┼──────────────────┘
          │                              │
          │ ANSI + TUI                   │ JSON/Plain Text
          ↓                              ↓
┌─────────────────────┐        ┌─────────────────────┐
│  Terminal UI        │        │  External Relay     │
│  (xterm.js)         │        │  (Telegram/Feishu)  │
└─────────────────────┘        └─────────────────────┘
```

### Layer 1: Agent 启动配置（立即可行）

**目标**：通过环境变量禁用 TUI，获得纯文本输出

```rust
// crates/vb-terminal/src/lib.rs
// 为外部通道绑定的终端添加特殊环境变量

if let Some(external_channel_binding) = &request.external_channel_binding {
    // 禁用 TUI 和颜色
    command.env("NO_COLOR", "1");
    command.env("TERM", "dumb");
    command.env("CI", "true");

    // Agent 特定的环境变量
    command.env("CLAUDE_NO_TUI", "1");
    command.env("CODEX_OUTPUT_MODE", "plain");
    command.env("GEMINI_NO_INTERACTIVE", "1");
}
```

**优点**：
- 无需修改 agent 代码
- 大多数 CLI 工具已支持这些环境变量
- 立即可测试

**缺点**：
- 不是所有 agent 都支持
- 仍然需要一些过滤逻辑

### Layer 2: 双通道输出（中期方案）

**目标**：为 agent 提供专门的数据输出通道

#### 方案 2A: 文件描述符 (FD)

```rust
// 创建额外的管道用于数据输出
let (data_reader, data_writer) = os_pipe::pipe()?;

command.env("GTOFFICE_DATA_FD", data_writer.as_raw_fd().to_string());

// Agent 可以写入结构化数据：
// echo '{"type":"response","content":"..."}' >&$GTOFFICE_DATA_FD
```

#### 方案 2B: 命名管道 (FIFO)

```rust
// 创建命名管道
let fifo_path = format!("/tmp/gtoffice-{}.fifo", session_id);
mkfifo(&fifo_path)?;

command.env("GTOFFICE_DATA_PIPE", &fifo_path);

// Agent 写入：
// echo '{"content":"..."}' > $GTOFFICE_DATA_PIPE
```

#### 方案 2C: 文件输出

```rust
// 最简单但有延迟
let output_file = format!("/tmp/gtoffice-{}.json", session_id);
command.env("GTOFFICE_OUTPUT_FILE", &output_file);

// 定期读取文件
```

**优点**：
- 完全可靠，无需解析
- 支持结构化数据（JSON）
- 可以传递元数据（工具调用、附件等）

**缺点**：
- 需要 agent 支持（可以通过 wrapper 脚本实现）
- 需要处理两个输出流

### Layer 3: MCP 协议集成（长期方案）

**目标**：使用标准协议与 agent 通信

```rust
// 使用 MCP (Model Context Protocol)
struct McpClient {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl McpClient {
    async fn send_request(&mut self, req: McpRequest) -> McpResponse {
        // JSON-RPC 通信
    }
}
```

**优点**：
- 行业标准，长期可维护
- 支持复杂交互（工具调用、流式输出、中断等）
- 多个 agent 可以共享协议

**缺点**：
- 需要 agent 支持 MCP
- 改造成本较高

## 渐进式实施计划

### Phase 1: 环境变量优化（1-2天）

1. **添加环境变量配置**
   ```rust
   // crates/vb-terminal/src/lib.rs
   if request.disable_tui {
       command.env("NO_COLOR", "1");
       command.env("TERM", "dumb");
       command.env("CI", "true");
   }
   ```

2. **测试效果**
   - 启动 Claude Code 和 Codex CLI
   - 对比输出差异
   - 评估过滤器简化程度

3. **如果效果好（噪音减少 > 50%）**
   - 保留当前过滤器作为 fallback
   - 标记为"可用但不完美"

4. **如果效果不好（噪音减少 < 30%）**
   - 立即进入 Phase 2

### Phase 2: 双通道架构（1周）

1. **设计数据通道接口**
   ```rust
   pub struct ExternalChannelBinding {
       pub channel: String,
       pub data_output_mode: DataOutputMode,
   }

   pub enum DataOutputMode {
       Pty,           // 当前方案（fallback）
       File(PathBuf), // 文件输出
       Pipe(OsString),// 命名管道
       Fd(RawFd),     // 文件描述符
   }
   ```

2. **实现文件输出模式**（最简单）
   - Agent 写入 JSON 到指定文件
   - 定期读取并解析
   - 测试延迟和可靠性

3. **创建 Agent Wrapper**
   ```bash
   #!/bin/bash
   # gtoffice-claude-wrapper.sh

   # 捕获 Claude Code 输出并写入数据文件
   claude "$@" | tee >(
       # 提取实际响应内容
       grep -v "^•" | grep -v "^›" | \
       jq -Rs '{content: .}' > "$GTOFFICE_OUTPUT_FILE"
   )
   ```

4. **逐步迁移**
   - 先支持 Claude Code
   - 再支持 Codex CLI
   - 其他 agent 继续用 PTY 解析

### Phase 3: MCP 集成（2-4周）

1. **调研 MCP 支持情况**
   - Claude Code 是否支持 MCP？
   - 需要哪些适配工作？

2. **实现 MCP 客户端**
   - 基于 `@modelcontextprotocol/sdk`
   - 支持 JSON-RPC 通信

3. **渐进式迁移**
   - 优先支持主力 agent
   - 保留 PTY 解析作为 fallback

## 决策建议

### 立即执行（今天）

1. **实验环境变量方案**
   ```bash
   # 测试 Claude Code
   NO_COLOR=1 TERM=dumb claude

   # 测试 Codex CLI
   NO_COLOR=1 TERM=dumb codex
   ```

2. **评估输出差异**
   - 对比有无环境变量的输出
   - 统计噪音行数减少比例
   - 检查是否有内容丢失

3. **做出决策**
   - **如果噪音减少 > 70%**：当前方案 + 环境变量优化即可，短期可用
   - **如果噪音减少 30-70%**：实施 Phase 2（双通道）
   - **如果噪音减少 < 30%**：立即重构，实施 Phase 2 + Phase 3

### 评估标准

**可接受的失败率**：< 5%
- 误杀率（合法内容被过滤）< 2%
- 漏报率（噪音未被过滤）< 3%

**不可接受的失败率**：> 10%
- 需要立即重构

## 技术债务管理

### 当前方案的技术债务

如果保留当前 PTY 解析方案：

1. **明确标注为 "Best Effort"**
   - 在代码注释中说明局限性
   - 在用户文档中说明可能的不准确

2. **添加用户反馈机制**
   - "响应不准确？点击重新提取"
   - 收集失败案例用于改进

3. **定期审查过滤规则**
   - 每月检查误杀和漏报案例
   - 评估是否需要重构

### 重构触发条件

满足以下任一条件时，必须重构：

1. 失败率 > 10%
2. 过滤规则数量 > 50 条
3. 每周收到 > 3 个用户投诉
4. 新 agent 集成需要 > 2 天适配时间

## 总结

**当前方案（VT100 + 过滤器）**：
- ✅ 短期可用（如果环境变量优化有效）
- ⚠️ 长期不可靠（维护成本高，脆弱）
- ❌ 不是最终方案

**推荐路径**：
1. **今天**：测试环境变量优化
2. **本周**：评估效果，决定是否重构
3. **下周**：如需重构，实施双通道架构
4. **下月**：规划 MCP 集成

**关键原则**：
- 不要在脆弱的方案上投入过多精力
- 尽早验证，快速决策
- 渐进式迁移，保持系统可用
