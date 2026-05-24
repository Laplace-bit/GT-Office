# Agent Session 架构设计

> **版本**：v2.0  
> **日期**：2026-05-24  
> **状态**：设计文档（未实现）  
> **Provider 范围**：**Claude Code + Codex CLI**

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| **开箱即见** | App 打开 → Station 立即展示当前目录下的历史 Session，无需等待 Agent 启动 |
| **一键恢复** | 点击历史 Session → 新建 PTY → Provider 原生 resume 接上对话，零配置 |
| **透明闭环** | 每个 Session 可见：目标、进展、文件变更、验证结果——从观察到审计完整闭环 |
| **实时感知** | Agent 执行时结构化活动流，而非空壳终端 |
| **数据壁垒** | Session 元数据与时间线落在 GT Office（SQLite），不完全依赖 Provider |
| **性能优先** | Discovery 缓存 + 增量扫描 + 懒加载，App 打开 < 500ms 可见历史 |

**核心判断**：

> GT Office 的壁垒不是「能启动 Claude」，而是 **唯一记得你在哪个 workspace、哪个 Agent、哪次 Session 做到哪、改了什么、怎么验的**。

**杀手体验**：用户打开 App，还没启动 Agent，就能看到「这个目录下我上次做了什么」，点一下就接上。这不是锦上添花，是 CLI Agent 管理工具的必需品。

---

## 2. 现状分析

### 2.1 现有三层 Session

```text
Layer 0  GtoSession          GT Office 账本（待建）— 产品主键
Layer 1  Terminal Session    terminalSessionId — PTY，App 关闭即失效
Layer 2  Runtime Binding     agentId ↔ terminalSessionId（内存 HashMap）
Layer 3  Provider Session    Claude jsonl / Codex rollout — 磁盘持久
```

| 层级 | 现有实现 | 问题 |
|------|----------|------|
| Terminal | `gt-terminal` | `session.snapshot.json` 存 id，重启后 PTY 已死 |
| Runtime | `AgentRuntimeRegistration` | 内存 HashMap，App 重启丢失；1:1 绑定（同一 agent 只能有一个 session） |
| Provider | `gt-session-log` | 能读日志，但仅用于实时 poll 回复文本，未产品化为列表 + 恢复 |

**用户需求本质**：以 Layer 3 为对话真相，用 Layer 0 索引体验，Layer 1 仅为运行时载体。

### 2.2 现有模块能力

| 模块 | 已有能力 | 需扩展 |
|------|----------|--------|
| `gt-session-log` | Claude/Codex JSONL 解析、prompt 指纹锚定、poll 增量读取、健康状态机 | 增加 Discovery 模式：扫描所有 Session（非仅当前锚定的那个） |
| `gt-terminal` | PTY 创建/写入/销毁、session 生命周期 | 无需大改，Resume 复用 `create_session` + `write_command` |
| `AgentRuntimeRegistration` | agentId ↔ terminalSessionId 绑定、tool_kind | 增加 `gtoSessionId` 字段 |
| `WorkspaceTerminalSessionDocument` | 前端 session 持久化（snapshot.json） | 增加 `lastActiveGtoSessionIds` 字段 |
| `tool_launch` | PTY 创建 → CLI 写入 → Runtime 注册 | 委托 `session.launch` |

---

## 3. Provider Session 存储详查

### 3.1 Claude Code

**目录结构**：

```text
~/.claude/
  projects/
    -<encoded-path>/                  ← project-key = 绝对路径非字母数字替换为 -
      <session-uuid>.jsonl            ← 会话记录
      <session-uuid>/
        subagents/                    ← 子 Agent 记录
          agent-<id>.jsonl
          agent-<id>.meta.json
        tool-results/                 ← 工具结果附件
      sessions-index.json             ← 索引文件（可选）
      memory/                         ← 项目级记忆
```

**project-key 编码规则**：绝对路径中所有非 ASCII 字母数字字符替换为 `-`。
- macOS: `/Users/dzlin/work/GT-Office` → `-Users-dzlin-work-GT-Office`
- Windows: `C:\Users\foo\project` → `-C--Users-foo-project`

**sessions-index.json 格式**：

```json
{
  "entries": [
    {
      "projectPath": "/absolute/path/to/project",
      "fullPath": "/full/path/to/session-file.jsonl",
      "fileMtime": 1714276800,
      "isSidechain": false
    }
  ]
}
```

**JSONL 行类型**：

| type | 含义 |
|------|------|
| `user` | 用户消息，`message.role = "user"`, `message.content = string \| array` |
| `assistant` | 回复，`message.role = "assistant"`, `message.content` 含 `text`/`thinking`/`tool_use`/`tool_result` |
| `attachment` | 系统事件，含 `sessionId`, `cwd`, `gitBranch`, `version` |
| `last-prompt` | 最近 prompt 指针，含 `sessionId` |
| `permission-mode` | 权限模式 |

**恢复方式**：TUI 内 `/resume`，选择历史 session 继续对话。

**平台差异**：
- macOS/Linux: `$HOME` 优先
- Windows: `$USERPROFILE` 优先，路径比较需 lowercase

### 3.2 Codex CLI

**目录结构**：

```text
~/.codex/
  sessions/
    YYYY/MM/DD/
      rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl
  auth.json
  config.toml
  .codex-global-state.json
```

**rollout JSONL 格式**：

首行固定为 `session_meta`：

```json
{
  "timestamp": "2026-05-16T12:38:16.298Z",
  "type": "session_meta",
  "payload": {
    "id": "019e30af-...",
    "timestamp": "2026-05-16T12:07:49.038Z",
    "cwd": "/Users/dzlin/work/GT-Office",
    "originator": "codex-tui",
    "cli_version": "0.130.0",
    "source": "cli",
    "model_provider": "custom",
    "git": {
      "commit_hash": "3d3b3679...",
      "branch": "main",
      "repository_url": "https://github.com/..."
    }
  }
}
```

**后续行类型**：

| type | payload.type | 含义 |
|------|-------------|------|
| `response_item` | `message` (role: user/assistant) | 对话消息 |
| `response_item` | `function_call` | 工具调用请求 |
| `response_item` | `function_call_output` | 工具调用结果 |
| `event_msg` | `task_started` / `task_complete` | 任务生命周期 |
| `event_msg` | `user_message` | 用户输入 |
| `event_msg` | `token_count` | Token 统计 |
| `turn_context` | — | Turn 级上下文（模型名、cwd） |

assistant 消息有 `phase` 字段：`"commentary"`（中间推理，应过滤）vs `"final_answer"`（最终回复）。

**恢复方式**：`/resume` 或 `codex exec resume --last`。

---

## 4. 总体架构（分层解耦）

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 4: UI                                                         │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ Station Idle  │  │ Station Live│  │ Session Detail            │   │
│  │ 历史列表+摘要 │  │ 终端+活动流│  │ 时间线/Diff/验证          │   │
│  └───────┬───────┘  └──────┬──────┘  └────────────┬─────────────┘   │
└──────────┼─────────────────┼─────────────────────┼─────────────────┘
           │ session.*       │ session.activity     │ session.get
           │ commands        │ events               │ session.timeline
┌──────────┼─────────────────┼─────────────────────┼─────────────────┐
│  Layer 3: Tauri Bridge                                               │
│  session.list │ session.launch │ session.get │ session.timeline     │
│  session.discover │ session.end │ session.resume                    │
└──────────┼──────────────────────────────────────────────────────────┘
           │
┌──────────┼──────────────────────────────────────────────────────────┐
│  Layer 2: gt-agent-session (Domain Crate)                            │
│                                                                      │
│  ┌─────────────────────┐  ┌──────────────────────────────────────┐  │
│  │ SessionRegistry     │  │ ProviderSessionDiscovery             │  │
│  │ - CRUD GtoSession   │  │ - scan ~/.claude/projects/<key>/     │  │
│  │ - lifecycle 管理    │  │ - scan ~/.codex/sessions/YYYY/.../   │  │
│  │ - SQLite 持久化     │  │ - cwd 匹配 + 去重                   │  │
│  └──────────┬──────────┘  └──────────────┬───────────────────────┘  │
│             │                            │                          │
│  ┌──────────┴──────────┐  ┌──────────────┴───────────────────────┐  │
│  │ SessionBindingService│  │ SessionSummaryService              │  │
│  │ - Gto ↔ Provider 绑定│  │ - 首尾消息提取                    │  │
│  │ - 首次用户确认      │  │ - git diff --stat                  │  │
│  │ - 重复自动复用      │  │ - 文件变更统计                     │  │
│  └─────────────────────┘  └────────────────────────────────────┘  │
│                                                                      │
│  ┌─────────────────────┐  ┌──────────────────────────────────────┐  │
│  │ SessionResumeService│  │ SessionObserver                     │  │
│  │ - PTY 创建 + 命令编排│  │ - file watcher 监听 jsonl 增量     │  │
│  │ - handover 注入     │  │ - 结构化活动事件                    │  │
│  └─────────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
           │                            │
┌──────────┼────────────────────────────┼──────────────────────────────┐
│  Layer 1: Infrastructure                                              │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ gt-session-log│  │ gt-terminal  │  │ SQLite       │               │
│  │ JSONL 解析   │  │ PTY 管理     │  │ 持久化       │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                  │                  │                       │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐               │
│  │ ~/.claude/   │  │ PTY 进程管理  │  │ .gtoffice/   │               │
│  │ ~/.codex/    │  │              │  │ sessions.db  │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
           │
┌──────────┼──────────────────────────────────────────────────────────┐
│  Layer 0: Provider Truth                                             │
│  Claude JSONL / Codex Rollout — 磁盘持久，不可变                    │
└──────────────────────────────────────────────────────────────────────┘
```

**层间依赖规则**：

| 层 | 可依赖 | 不可依赖 |
|----|--------|----------|
| Layer 4 (UI) | Layer 3 (Tauri Bridge) | 直接调用 Layer 2/1 |
| Layer 3 (Bridge) | Layer 2 (Domain) | 直接操作 Layer 1 |
| Layer 2 (Domain) | Layer 1 (Infra) | 不感知 Tauri |
| Layer 1 (Infra) | 无外部依赖 | 不感知 Domain 语义 |

---

## 5. 核心数据模型

### 5.1 GtoSession（主表）

```sql
CREATE TABLE gto_sessions (
  gto_session_id    TEXT PRIMARY KEY,          -- UUID，永久不变
  workspace_id      TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  station_id        TEXT NOT NULL,
  provider          TEXT NOT NULL,              -- 'claude' | 'codex'
  provider_session_id TEXT,                    -- Provider 的 session ID
  provider_log_path TEXT,                      -- jsonl 文件绝对路径
  terminal_session_id TEXT,                    -- 仅 live 时有值
  lifecycle         TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'stopped' | 'archived'
  title             TEXT,                      -- 首条用户消息摘要
  goal_summary      TEXT,                      -- 目标/成果概述
  cwd               TEXT NOT NULL,             -- Agent 工作目录
  started_at_ms     INTEGER NOT NULL,
  ended_at_ms       INTEGER,
  last_activity_at_ms INTEGER NOT NULL,
  discovery_source  TEXT NOT NULL DEFAULT 'provider_scan',  -- 'gto_launch' | 'provider_scan' | 'channel' | 'import'
  user_confirmed    INTEGER NOT NULL DEFAULT 0,            -- 首次绑定是否用户确认
  created_at_ms     INTEGER NOT NULL,
  updated_at_ms     INTEGER NOT NULL
);

CREATE INDEX idx_sessions_workspace_agent ON gto_sessions(workspace_id, agent_id);
CREATE INDEX idx_sessions_lifecycle ON gto_sessions(lifecycle);
CREATE INDEX idx_sessions_last_activity ON gto_sessions(last_activity_at_ms DESC);
```

### 5.2 SessionStats（统计表，独立解耦）

```sql
CREATE TABLE session_stats (
  gto_session_id    TEXT PRIMARY KEY REFERENCES gto_sessions(gto_session_id),
  files_touched     INTEGER DEFAULT 0,
  files_created     INTEGER DEFAULT 0,
  files_modified    INTEGER DEFAULT 0,
  files_deleted     INTEGER DEFAULT 0,
  git_commits       INTEGER DEFAULT 0,
  git_diff_additions INTEGER DEFAULT 0,
  git_diff_deletions  INTEGER DEFAULT 0,
  commands_run      INTEGER DEFAULT 0,
  verification_passed INTEGER DEFAULT 0,
  verification_failed INTEGER DEFAULT 0,
  prompt_count      INTEGER DEFAULT 0,
  tool_call_count  INTEGER DEFAULT 0,
  updated_at_ms    INTEGER NOT NULL
);
```

**设计理由**：统计维度会持续增加，独立表避免频繁 ALTER 主表，且支持按需 JOIN 懒加载。

### 5.3 SessionEvent（时间线）

```sql
CREATE TABLE session_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  gto_session_id  TEXT NOT NULL REFERENCES gto_sessions(gto_session_id),
  event_kind      TEXT NOT NULL,        -- 见下表
  event_data      TEXT NOT NULL,       -- JSON
  occurred_at_ms  INTEGER NOT NULL,
  sequence        INTEGER NOT NULL      -- 单 Session 内递增序号
);

CREATE INDEX idx_events_session_seq ON session_events(gto_session_id, sequence);
```

| event_kind | 含义 | data 示例 |
|------------|------|-----------|
| `session.created` | Session 创建 | `{source: "gto_launch"}` |
| `session.bound` | Provider Session 绑定 | `{providerSessionId, logPath}` |
| `prompt.user` | 用户输入 | `{text: "修复..."}` |
| `prompt.assistant` | Agent 回复摘要 | `{text: "已修复...", charCount: 1200}` |
| `file.changed` | 文件变更 | `{path, kind: "create|modify|delete"}` |
| `git.commit` | Git 提交 | `{hash, message, additions, deletions}` |
| `verify.run` | 验证执行 | `{command, exitCode, duration}` |
| `session.stopped` | Session 停止 | `{reason: "user"|"pty_exit"|"app_restart"}` |
| `session.archived` | 归档 | `{}` |

### 5.4 生命周期：三态模型

```text
live ──→ stopped ──→ archived
 ↑_________|
   Resume
```

| 状态 | 含义 | terminalSessionId | 可操作 |
|------|------|-------------------|--------|
| `live` | Agent 在跑，PTY 在线 | 有值 | 查看、停止 |
| `stopped` | PTY 已断，对话可恢复 | null | 恢复、归档 |
| `archived` | 不再关心 | null | 仅只读 |

**App 重启策略**：所有原 `live` 批量转 `stopped`，不假装 PTY 仍存活。UI 诚实标注「点击恢复对话」。

**三态 vs 五态的理由**：`draft` 合并入 `live`（创建即活），`paused`/`ended` 合并为 `stopped`（用户不区分暂停和结束，关心的是「能不能接上」）。减少状态 = 减少边缘场景 = 减少 bug。

---

## 6. Discovery：Provider Session 发现

### 6.1 总体流程

```text
App 启动
  │
  ├─ 1. 读 SQLite 缓存 → 立即渲染历史列表（< 50ms）
  │
  ├─ 2. 后台异步：Provider Scan
  │     ├─ Claude: 读 sessions-index.json + 扫描 project dir
  │     ├─ Codex:  遍历 ~/.codex/sessions/ 下 session_meta
  │     └─ 结果：ProviderSessionCandidate[]
  │
  ├─ 3. Merge：按 providerLogPath / providerSessionId 去重
  │     ├─ 已在 SQLite → 更新 lastActivityAtMs
  │     └─ 新发现 → 创建 GtoSession (lifecycle=stopped, userConfirmed=false)
  │
  └─ 4. 前端增量更新列表
```

**关键性能保障**：步骤 1 先于步骤 2 返回，用户看到的不是空白等待。

### 6.2 Claude Discovery 实现

```rust
struct ClaudeSessionDiscovery {
    home_dir: PathBuf,
}

impl ClaudeSessionDiscovery {
    /// 扫描指定 cwd 对应的所有 Claude Session
    fn scan_for_cwd(&self, cwd: &Path) -> Vec<ProviderSessionCandidate> {
        let project_key = claude_project_key_for_path(cwd);
        let project_dir = self.home_dir.join(".claude/projects").join(&project_key);

        if !project_dir.exists() {
            return vec![];
        }

        // 优先读 sessions-index.json
        if let Ok(entries) = read_sessions_index(&project_dir) {
            return entries
                .into_iter()
                .filter(|e| !e.is_sidechain && paths_match(&e.project_path, cwd))
                .filter(|e| Path::new(&e.full_path).exists())
                .map(|e| ProviderSessionCandidate {
                    provider: Provider::Claude,
                    provider_session_id: None,  // Claude 从 jsonl 文件名提取
                    log_path: PathBuf::from(&e.full_path),
                    cwd: cwd.to_path_buf(),
                    modified_at_ms: e.file_mtime * 1000,
                    first_user_message: None,   // 懒加载
                })
                .collect();
        }

        // Fallback: 扫描目录下所有 .jsonl
        scan_jsonl_files(&project_dir)
            .into_iter()
            .map(|path| ProviderSessionCandidate {
                provider: Provider::Claude,
                provider_session_id: None,
                log_path: path,
                cwd: cwd.to_path_buf(),
                modified_at_ms: file_mtime_ms(&path),
                first_user_message: None,
            })
            .collect()
    }
}
```

**sessions-index.json 不可靠场景**：
- 文件不存在 → 回退目录扫描
- `projectPath` 与 cwd 不匹配（符号链接、路径规范化差异）→ 回退
- 文件存在但为空 → 回退

### 6.3 Codex Discovery 实现

```rust
struct CodexSessionDiscovery {
    sessions_root: PathBuf,  // ~/.codex/sessions/
}

impl CodexSessionDiscovery {
    fn scan_for_cwd(&self, cwd: &Path) -> Vec<ProviderSessionCandidate> {
        let normalized_cwd = normalize_path(cwd);

        walk_jsonl_files(&self.sessions_root)
            .into_iter()
            .filter_map(|path| {
                // 只读首行 session_meta
                let meta = extract_codex_session_meta(&path)?;
                if !paths_match_normalized(&meta.cwd, &normalized_cwd) {
                    return None;
                }
                Some(ProviderSessionCandidate {
                    provider: Provider::Codex,
                    provider_session_id: Some(meta.id),
                    log_path: path,
                    cwd: cwd.to_path_buf(),
                    modified_at_ms: file_mtime_ms(&path),
                    first_user_message: None,
                })
            })
            .collect()
    }
}
```

**Codex 首行提取优化**：只读文件第一个 `\n`，不加载全文。`std::io::BufReader` + `read_line` 即可，I/O 成本极低。

### 6.4 跨平台路径匹配

```rust
fn paths_match_normalized(a: &Path, b: &Path) -> bool {
    let na = normalize_path(a);
    let nb = normalize_path(b);
    #[cfg(windows)]
    { na.to_lowercase() == nb.to_lowercase() }
    #[cfg(not(windows))]
    { na == nb }
}

fn normalize_path(p: &Path) -> String {
    let mut s = p.to_string_lossy().replace('\\', "/");
    while s.ends_with('/') { s.pop(); }
    s
}
```

### 6.5 Discovery 缓存策略

| 层级 | 存储 | TTL | 刷新时机 |
|------|------|-----|----------|
| L1: SQLite GtoSession | `.gtoffice/sessions.db` | 永久 | Discovery merge 时更新 |
| L2: 内存 Provider 扫描结果 | `SessionDiscoveryCache` | 30s | 下次 scan 时覆盖 |
| L3: 首条消息缓存 | `SessionSummaryService` | 永久（惰性写入 SQLite） | 首次读取后缓存 |

**L2 的意义**：避免高频场景（如连续打开多个 workspace）重复扫描磁盘。

---

## 7. Session 摘要与卡片信息

### 7.1 摘要提取（P0 核心，非 P3）

每个 Session 卡片需要以下信息，**全部可在 Discovery 阶段低成本获取**：

| 字段 | 来源 | 获取成本 |
|------|------|----------|
| title | jsonl 首条 `type: "user"` 消息前 80 字符 | 读 1-5 行 |
| provider | 扫描时已知 | 0 |
| startedAtMs | 文件 mtime 或 `attachment` 行的 timestamp | 0 |
| lastActivityAtMs | 文件 mtime | 0 |
| filesTouched / gitCommits | `git diff --stat HEAD~N` 或 jsonl 中 `tool_use` 计数 | 懒加载（展开卡片时） |
| lifecycle | SQLite | 0 |

### 7.2 懒加载策略

```text
卡片折叠态（列表中）：
  title + provider + 时间 + lifecycle
  获取成本：SQLite 读 1 行，< 1ms

卡片展开态（悬停/点击）：
  + 首条用户消息（已缓存）
  + 文件变更数、git commit 数
  + 验证状态
  获取成本：SQLite JOIN session_stats，< 5ms

详情页（点击进入）：
  + 完整 SessionEvent 时间线
  + 文件变更 Diff
  + 命令记录
  获取成本：按需查询，分页加载
```

---

## 8. 绑定策略

### 8.1 首次绑定：用户确认

**问题**：自动判定绑定置信度容易出错（cwd 相同但不是同一个 session、多个 session 同 cwd）。

**方案**：首次发现新 Provider Session 时，一律标记 `userConfirmed = false`，在 UI 上展示「未确认」标签。用户点击「确认关联」后标记为 `true`。

但 **不影响使用**：用户可以直接点击「恢复」，确认动作与恢复动作合二为一。

```text
○ 修复 Git panel 崩溃     2h前  [恢复]  ← 点击 = 确认 + 恢复
○ 接入 webhook             昨天  [恢复]
● 实现登录功能             3d前  ✓已确认  ← 之前确认过，直接恢复
```

### 8.2 重复绑定：自动复用

同一 `providerLogPath` 已存在 GtoSession 记录时，Discovery 不创建新记录，仅更新 `lastActivityAtMs`。

### 8.3 绑定流程

```text
New Session (GTO 发起):
  1. session.launch(new) → 创建 GtoSession (live)
  2. 创建 PTY → 启动 CLI
  3. gt-session-log 发现 Provider Session → bind
  4. 更新 providerSessionId + providerLogPath + userConfirmed = true

Resume Session:
  1. 用户点击历史 Session
  2. session.launch(resume, gtoSessionId) → GtoSession (stopped → live)
  3. 创建新 PTY → 启动 CLI → 注入 /resume 命令
  4. 绑定新 terminalSessionId
  5. 更新 userConfirmed = true
```

---

## 9. Resume 编排

### 9.1 恢复流程

```text
用户点击「恢复」
  │
  ├─ 1. 检查 GtoSession 存储信息
  │     ├─ provider = claude → 准备 /resume 命令
  │     └─ provider = codex → 准备 resume 命令
  │
  ├─ 2. 创建新 PTY Session (gt-terminal::create_session)
  │     └─ cwd = gtoSession.cwd
  │
  ├─ 3. 写入启动命令
  │     ├─ claude: "claude" + Enter
  │     └─ codex: "codex" + Enter
  │
  ├─ 4. 等待 CLI 就绪（150ms）
  │
  ├─ 5. 注入 handover 上下文（见 §9.2）
  │
  ├─ 6. 注入 resume 命令
  │     ├─ claude: "/resume" + Enter → 选择 session
  │     └─ codex: "/resume" + Enter
  │
  └─ 7. 更新 GtoSession
        ├─ lifecycle = live
        ├─ terminalSessionId = 新 PTY ID
        └─ userConfirmed = true
```

### 9.2 Handover 上下文注入

每个 Session 在 `stopped` 时自动生成 handover 摘要，Resume 时注入到 prompt 前缀。

**handover 内容**：

```markdown
[GT Office Session Context]
上次会话目标：{title}
进展：{goalSummary || '进行中'}
未完成：{从最后几条 assistant 消息推断}
文件变更：{filesTouched} 个文件
Git 提交：{gitCommits} 次
验证：{verificationPassed} 通过 / {verificationFailed} 失败
──────────
```

**注入方式**：作为 `initialPrompt` 的一部分，在 CLI 启动后写入。用户看到这段上下文，可以选择接受或忽略。

### 9.3 恢复策略矩阵

| 情况 | 对话恢复 | 终端画面 | Handover |
|------|----------|----------|----------|
| Provider Session 完整 | ✅ /resume | ❌ 新 PTY（空白） | ✅ 注入 |
| Provider Session 已删 | ❌ | 仅 GTO 只读时间线 | ✅ 注入 |
| userConfirmed = false | ⚠️ 用户确认后恢复 | ❌ | ✅ |

---

## 10. 实时监控：SessionObserver

### 10.1 从 Poll 到 Push

当前 `gt-session-log` 使用轮询模式（每 1.5s rescan），适合「获取 Agent 回复文本」。但实时监控需要更低的延迟。

**方案**：在 `gt-session-log` 的 poll 基础上，增加 file watcher 监听 jsonl 文件增量写入。

```rust
struct SessionObserver {
    watched_paths: HashMap<String, RecommendedWatcher>,  // gtoSessionId → watcher
    event_tx: Sender<SessionActivityEvent>,
}

impl SessionObserver {
    fn start_observing(&mut self, gto_session_id: &str, log_path: &Path) {
        let tx = self.event_tx.clone();
        let path = log_path.to_path_buf();

        let mut watcher = RecommendedWatcher::new(move |res: Result<Event, _>| {
            match res {
                Ok(Event { kind: EventKind::Modify(_), .. }) => {
                    let _ = tx.send(SessionActivityEvent::LogUpdated {
                        gto_session_id: gto_session_id.to_string(),
                        path: path.clone(),
                    });
                }
                _ => {}
            }
        }, Config::default());

        watcher.watch(log_path, RecursiveMode::NonRecursive).ok();
        self.watched_paths.insert(gto_session_id.to_string(), watcher);
    }
}
```

### 10.2 活动事件结构

```rust
enum SessionActivityEvent {
    LogUpdated {
        gto_session_id: String,
        path: PathBuf,
    },
    TerminalOutput {
        gto_session_id: String,
        chunk: String,
    },
    GitActivity {
        gto_session_id: String,
        event: GitEvent,
    },
}
```

**处理流程**：`LogUpdated` → 触发增量 JSONL 解析 → 提取结构化事件 → 推送前端。

### 10.3 前端活动流

Station Live 时，Terminal 旁边展示结构化活动流：

```text
┌─ Terminal ──────────┐  ┌─ Activity ────────────────────┐
│ $ claude            │  │ 📝 读取 src/main.rs            │
│ > 修复登录 bug      │  │ ✏️ 修改 src/auth.rs            │
│ ...                 │  │ 🔄 git commit "fix: auth..."   │
│                     │  │ ✅ cargo test -- 3/3 passed     │
└─────────────────────┘  └───────────────────────────────┘
```

这不是 P0，但架构上预留 `SessionObserver` 接口，P0 只用 poll。

---

## 11. 性能与可靠性设计

### 11.1 启动性能目标

| 场景 | 目标 | 策略 |
|------|------|------|
| App 打开 → 历史列表可见 | < 500ms | SQLite 先行，Discovery 后台 |
| Discovery 完成全部扫描 | < 3s | 并行扫描 + 缓存 |
| 点击恢复 → PTY 就绪 | < 1s | 复用已有 PTY 创建流程 |
| 卡片展开 → 摘要加载 | < 100ms | 懒加载 + JOIN |

### 11.2 Discovery 性能

**Claude**：
- `sessions-index.json` 存在时：读 1 个 JSON 文件，O(1)
- 回退目录扫描：`read_dir` + filter `.jsonl`，通常 < 50 文件，< 10ms

**Codex**：
- 遍历 `~/.codex/sessions/YYYY/MM/DD/`，递归 `walk_jsonl_files`
- 每个文件只读首行 `session_meta`，< 1ms/文件
- 典型场景：100-500 个文件，总耗时 < 500ms

**优化**：Codex 可先按日期目录 `stat` 跳过太久远的目录（如 > 90 天），减少遍历量。

### 11.3 SQLite 可靠性

- WAL 模式：读写不互相阻塞
- 单连接 + `Mutex`：简单可靠，桌面应用不需要连接池
- 定期 checkpoint：`PRAGMA wal_checkpoint(TRUNCATE)` 每 5 分钟
- 备份：`.gtoffice/sessions.db` 在 workspace 内，跟随 workspace 管理

### 11.4 文件 Watcher 可靠性

- macOS: `FSEvents`（notify crate 默认）
- Windows: `ReadDirectoryChangesW`
- Linux: `inotify`
- 降级策略：watcher 失败时回退到 poll（2s 间隔），不阻塞功能
- 路径不存在（如 Provider 删除了 jsonl）：标记 `SessionHealth::ProviderGone`，不崩溃

### 11.5 并发与线程安全

```text
UI Thread (main)          ← session.* commands（同步/异步）
  │
Background Thread Pool
  ├─ Discovery Worker     ← 定期/按需扫描，结果写入 SQLite
  ├─ Observer Workers     ← file watcher 回调 → 事件分发
  └─ Summary Worker       ← 懒加载摘要提取，结果写入缓存
```

- SQLite 写入通过 `Mutex<Connection>` 序列化
- 事件通过 Tauri `emit` 推送前端，天然线程安全
- Discovery 结果通过 `tokio::sync::mpsc` 传递，非共享状态

---

## 12. API 契约

### 12.1 Tauri Commands

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `session.list` | `{workspaceId, agentId?, limit?, offset?}` | `GtoSessionCard[]` | 列表（含摘要） |
| `session.get` | `{gtoSessionId}` | `GtoSessionDetail` | 详情 |
| `session.timeline` | `{gtoSessionId, afterSeq?, limit?}` | `SessionEvent[]` | 时间线（分页） |
| `session.launch` | `{workspaceId, agentId, mode: "new"\|"resume", gtoSessionId?, cwd?}` | `{gtoSessionId, terminalSessionId}` | 启动/恢复 |
| `session.end` | `{gtoSessionId}` | `void` | 停止（不归档） |
| `session.archive` | `{gtoSessionId}` | `void` | 归档 |
| `session.discover` | `{workspaceId, cwd}` | `{newCount, updatedCount}` | 手动触发扫描 |
| `session.confirm` | `{gtoSessionId}` | `void` | 用户确认绑定 |
| `session.stats` | `{gtoSessionId}` | `SessionStats` | 统计（懒加载） |

### 12.2 Tauri Events

| Event | Payload | 触发时机 |
|-------|---------|----------|
| `gtoffice:session-state-changed` | `{gtoSessionId, lifecycle, providerSessionId?}` | 生命周期变更 |
| `gtoffice:session-discovered` | `{gtoSessionId, provider, title}` | Discovery 发现新 Session |
| `gtoffice:session-activity` | `{gtoSessionId, kind, data}` | 实时活动（P2+） |

### 12.3 gto CLI 集成

```bash
gto session list --workspace-id <id> [--agent-id <id>]
gto session resume --session-id <id>
gto session info --session-id <id>
```

---

## 13. UI 设计

### 13.1 Station Idle（P0 核心）

App 打开 → Agent 未启动 → Station 显示历史 Session 列表：

```text
┌─ Claude Code ─────────────────────────────────────────────┐
│                                                            │
│  [+ 新会话]                                                │
│                                                            │
│  ── 最近会话 ──────────────────────────────────────────    │
│                                                            │
│  ● 修复 Git panel 崩溃                                     │
│    2h前 · Claude · 3 文件 · 2 提交 · ✓ 测试通过           │
│    [恢复]                                                  │
│                                                            │
│  ○ 接入 webhook                                            │
│    昨天 · Claude · 5 文件 · 1 提交                          │
│    [恢复]                                                  │
│                                                            │
│  ○ 实现登录功能                                             │
│    3d前 · Codex · 12 文件 · 4 提交 · ✗ 1 测试失败         │
│    [恢复]                                                  │
│                                                            │
│  ── 更早 ──                                                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**卡片字段**：
- 标题：首条用户消息前 80 字符
- 时间：相对时间（2h前、昨天、3d前）
- Provider：Claude / Codex 图标
- 文件变更数 + 提交数：从 `session_stats` 获取
- 验证状态：✓ 通过 / ✗ 失败 / — 未验证

### 13.2 Station Live

Agent 运行中，Terminal + 活动指示器：

```text
┌─ Terminal ──────┐  ┌─ Status ───────────┐
│ $ claude         │  │ Session: 修复Git... │
│ > ...            │  │ 文件: 3  提交: 2    │
│                  │  │ 状态: ● 活跃        │
└──────────────────┘  └────────────────────┘
```

### 13.3 Session Detail

点击 Session 卡片展开 → 完整时间线 + Diff：

```text
┌─ 修复 Git panel 崩溃 ─────────────────────────────────────┐
│                                                            │
│  📋 目标: 修复 Git panel 在切换分支时的崩溃问题            │
│  ⏱ 耗时: 23分钟  📁 文件: 3  📝 提交: 2                   │
│                                                            │
│  ── 时间线 ──────────────────────────────────────────      │
│                                                            │
│  14:01  💬 用户: 修复 Git panel 崩溃                      │
│  14:02  📖 读取 src/git/panel.tsx                         │
│  14:05  ✏️ 修改 src/git/panel.tsx  (+42/-8)              │
│  14:08  📝 git commit "fix: branch switch crash"          │
│  14:10  ✅ cargo test — 12/12 passed                      │
│  14:15  💬 Agent: 已修复，测试通过                        │
│  14:20  📝 git commit "test: add branch switch test"      │
│                                                            │
│  ── 文件变更 ──────────────────────────────────────        │
│  M  src/git/panel.tsx          +42  -8                     │
│  A  src/git/__tests__/branch.test.ts  +31                 │
│  M  package.json              +1   -0                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 14. 与现有模块关系

| 现有模块 | Session 架构中的角色 | 改动范围 |
|----------|---------------------|----------|
| `gt-session-log` | Provider JSONL 解析引擎 + Discovery 底层 | 扩展 Discovery 模式（扫描所有 Session，非仅当前锚定） |
| `gt-terminal` | PTY 管理层 | 无需改动，Resume 复用 `create_session` + `write_command` |
| `AgentRuntimeRegistration` | 运行时绑定 | 增加 `gtoSessionId` 字段 |
| `WorkspaceTerminalSessionDocument` | 前端 session 持久化 | 增加 `lastActiveGtoSessionIds` |
| `tool_launch` | Agent 启动入口 | 委托 `session.launch(new)` |
| `gt-changefeed` | 工作区变更事件源 | 升级为 SessionEvent 生产者 |
| `app_state.rs` | 全局装配 | 仅注册 `SessionService`，不承载业务逻辑 |

---

## 15. 实施阶段（重新排序）

| 阶段 | 交付 | 用户感知 |
|------|------|----------|
| **P0** | `gt-agent-session` crate + SQLite + Discovery (Claude/Codex) + Session 卡片（含摘要 + 统计） | 「我能看到每个 Agent 做了什么」 |
| **P1** | 一键 Resume + handover 注入 + Provider resume 命令编排 | 「我能无缝接上」 |
| **P2** | SessionObserver + 实时活动流 (file watcher → 事件) | 「我看着它在干活」 |
| **P3** | 完整 Timeline + Session Detail 页 + 验证报告卡 | 「我完全掌握全过程」 |
| **P4** | 跨 Session 模式识别 + Audit 统计 | 「系统越用越懂我」 |

**P0 详细拆解**：

| 子任务 | 依赖 | 说明 |
|--------|------|------|
| P0.1: `gt-agent-session` crate 骨架 | 无 | SQLite schema、基础 CRUD |
| P0.2: `ProviderSessionDiscovery` (Claude) | P0.1 | 扫描 sessions-index.json + 目录回退 |
| P0.3: `ProviderSessionDiscovery` (Codex) | P0.1 | 遍历 sessions/ 下 session_meta |
| P0.4: `SessionSummaryService` | P0.1 | 首条消息提取 + git diff --stat |
| P0.5: Tauri bridge (session.list, session.discover) | P0.2, P0.3, P0.4 | 连接前后端 |
| P0.6: Station Idle UI（历史列表 + 卡片） | P0.5 | 前端组件 |
| P0.7: App 启动时触发 Discovery | P0.5 | workspace 加载后自动 scan |

**不做**：多 Agent 协作画布、完整 PTY scrollback 持久化作为恢复依据。

---

## 16. 原则

1. **对话内容以 Provider Session 为准**；GTO 以账本 + Timeline 为准
2. **PTY 可弃、可替换**：Terminal 仅是运行时载体，不作为恢复依据
3. **SQLite 先行，Discovery 后台**：用户打开 App 立刻看到历史，不等扫描
4. **首次绑定用户确认**，确认后自动复用，不再设置信度等级
5. **逻辑下沉 `gt-agent-session`**，不膨胀 `app_state`
6. **统计独立于主表**：`session_stats` 独立，便于扩展和懒加载
7. **三态足够**：live / stopped / archived，减少状态 = 减少边缘 bug
8. **性能是门面**：< 500ms 首屏可见，Discovery 在后台不阻塞 UI
9. **Handover 是安全网**：即使 Provider resume 不可用，GTO 自身记录也能重建上下文