# Agent Session 架构设计

> **版本**：v2.2
> **日期**：2026-05-24
> **状态**：P0 实现中（后端 + Station 历史列表 + 恢复流程已接入）
> **Provider 范围**：**Claude Code + Codex CLI**

## 1. 核心价值

**一句话**：让用户对 Agent 了如指掌——看到历史、恢复对话、实时感知它在干什么。

三个杀手体验：

1. **开箱即见**：App 打开，还没启动 Agent，就能看到「这个目录下我上次做了什么」，点一下就接上
2. **实时感知**：Agent 在跑的时候，git 变更自动弹出通知——改了什么文件、提交了什么，点击直接跳到 diff
3. **事后复盘**：每个 Session 有 git 变更快照——改了哪些文件、提交了几次、diff 是什么

数据来源只用**可靠的东西**：

| 数据 | 来源 | 可靠性 |
|------|------|--------|
| Session 列表、标题、时间 | Provider 文件系统扫描 + 首行解析 | ✅ 文件系统操作，极稳 |
| 文件变更数、提交数、diff | git log / git diff | ✅ git 稳定，Provider 无关 |
| 实时 git 变更通知 | `GitStatusCoordinator` → `git/updated` 事件 | ✅ 已有基础设施，push 推送 |
| Channel 消息 | `gt-session-log` 现有 poll/bind 机制 | ✅ 已有，**不动** |
| 恢复对话 | Provider 原生 /resume | ✅ Provider 自己的功能 |

**不动的东西**：

| 模块 | 说明 |
|------|------|
| `gt-session-log` 的 Channel 消息解析 | 现有 poll/bind 机制完整服务于 Channel 功能，Session Discovery 是新增模式，不影响 |

**不依赖的东西**：

| 数据 | 原方案 | 问题 |
|------|--------|------|
| 结构化活动流 | JSONL tool_use 解析 | ❌ Provider 内部格式，随时变，解析脆 |
| 验证追踪 | JSONL Bash 工具关键词匹配 | ❌ 格式不稳定，exit code 提取不可靠 |
| 详细时间线 | 逐行解析 JSONL | ❌ 两个 Provider 格式完全不同，维护负担大 |

这些不是不做，而是**等 Provider 提供稳定的事件 API 再做**。当前基于 git + 文件系统。

---

## 2. Provider Session 存储实查

### 2.1 Claude Code

```text
~/.claude/projects/-<encoded-path>/         ← 路径非字母数字 → -
  <uuid>.jsonl                               ← 会话记录
  <uuid>/subagents/agent-<id>.jsonl          ← 子 Agent
  sessions-index.json                         ← 索引（可选）
  memory/                                     ← 项目记忆
```

| 字段 | 说明 |
|------|------|
| project-key | 绝对路径所有非字母数字字符替换为 `-` |
| sessions-index.json | `{entries: [{projectPath, fullPath, fileMtime, isSidechain}]}` |
| JSONL 行类型 | `user`, `assistant`, `attachment`, `last-prompt`, `permission-mode` |
| 恢复方式 | TUI `/resume` |

**platform**：macOS/Linux 用 `$HOME`，Windows 用 `$USERPROFILE`，路径比较需 lowercase。

### 2.2 Codex CLI

```text
~/.codex/sessions/YYYY/MM/DD/
  rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl
```

| 字段 | 说明 |
|------|------|
| 首行 | `session_meta`：`{id, cwd, originator, cli_version, git: {branch, commit_hash}}` |
| 后续行 | `response_item(message/function_call)`, `event_msg(task_started/task_complete/user_message/token_count)`, `turn_context` |
| assistant phase | `commentary`（中间推理，过滤）vs `final_answer`（最终回复） |
| 恢复方式 | `/resume` 或 `codex exec resume --last` |

---

## 3. 总体架构（四层解耦）

```text
┌────────────────────────────────────────────────────────────────────┐
│  Layer 4: UI                                                       │
│                                                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │ Station Idle     │  │ Station Live     │  │ Session Detail   │ │
│  │ 历史列表 + 摘要  │  │ 终端 + Git 通知  │  │ Git Diff + 信息  │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │
└───────────┼─────────────────────┼───────────────────────┼─────────┘
            │                     │                       │
┌───────────┼─────────────────────┼───────────────────────┼─────────┐
│  Layer 3: Tauri Commands                                           │
│                                                                    │
│  session.list  session.launch  session.get  session.resume        │
│  session.discover  session.end  session.activity                  │
└───────────┼───────────────────────────────────────────────────────┘
            │
┌───────────┼───────────────────────────────────────────────────────┐
│  Layer 2: gt-agent-session (Domain)                                 │
│                                                                    │
│  ┌─────────────────────┐  ┌────────────────────────────────────┐ │
│  │ SessionRegistry     │  │ ProviderScanner                    │ │
│  │ - SQLite CRUD       │  │ - 扫描 ~/.claude/projects/<key>/   │ │
│  │ - 生命周期管理      │  │ - 扫描 ~/.codex/sessions/          │ │
│  └──────────┬──────────┘  │ - cwd 匹配 + 去重                 │ │
│             │              └──────────────┬─────────────────────┘ │
│  ┌──────────┴──────────┐  ┌──────────────┴─────────────────────┐ │
│  │ SessionSummary      │  │ GitSessionDiff                     │ │
│  │ - 首条消息提取      │  │ - git_start_commit / git_end_commit │ │
│  │                     │  │ - git diff --stat / git log         │ │
│  └─────────────────────┘  └────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────────┐  ┌────────────────────────────────────┐ │
│  │ ResumeService       │  │ SessionActivity                    │ │
│  │ - PTY 创建          │  │ - 监听 git/updated 事件            │ │
│  │ - resume 命令编排   │  │ - 差量对比 → 结构化通知            │ │
│  └─────────────────────┘  │ - 通知 → 前端 toast + 跳转         │ │
│                           └────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
            │
┌───────────┼───────────────────────────────────────────────────────┐
│  Layer 1: Infrastructure (已有，不新建)                            │
│                                                                    │
│  gt-session-log     gt-terminal    gt-git    SQLite              │
│  (Channel 解析不动)  (PTY 管理)    (git 操作)  (.gtoffice/db)    │
│                                                                    │
│  GitStatusCoordinator → git/updated 事件 (已有)                   │
│  NotificationStore → toast 通知 (已有)                              │
│  DiffViewer / GitGraphView → 详情页 (已有)                         │
│  gt-changefeed → 实现为 SessionActivity 的数据桥接                │
└────────────────────────────────────────────────────────────────────┘
```

**层间规则**：

| 层 | 可依赖 | 不可依赖 |
|----|--------|----------|
| UI (L4) | Tauri Commands (L3) | 直接调 Domain/Infra |
| Tauri Commands (L3) | Domain (L2) | 直接操作 Infra |
| Domain (L2) | Infra (L1) | 不感知 Tauri |
| Infra (L1) | 无外部依赖 | 不感知 Domain 语义 |

---

## 4. 数据模型

### 4.1 gto_sessions（主表）

```sql
CREATE TABLE gto_sessions (
  gto_session_id     TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  agent_id           TEXT NOT NULL,
  station_id         TEXT NOT NULL,
  provider           TEXT NOT NULL,              -- 'claude' | 'codex'
  provider_session_id TEXT,
  provider_log_path  TEXT,                      -- jsonl 绝对路径
  terminal_session_id TEXT,                      -- 仅 live 时有值
  lifecycle          TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'stopped' | 'archived'
  title              TEXT,                       -- 首条用户消息前 80 字符
  cwd                TEXT NOT NULL,
  started_at_ms     INTEGER NOT NULL,
  ended_at_ms       INTEGER,
  last_activity_at_ms INTEGER NOT NULL,
  created_at_ms      INTEGER NOT NULL,
  updated_at_ms      INTEGER NOT NULL
);

CREATE INDEX idx_sessions_ws_agent ON gto_sessions(workspace_id, agent_id, last_activity_at_ms DESC);
CREATE INDEX idx_sessions_lifecycle ON gto_sessions(lifecycle);
```

**设计说明**：

- **不需要 `bindConfidence` 或 `userConfirmed`**——发现即关联，恢复就是确认
- **不需要 `goalSummary`**——P0 只做首条消息提取，摘要留给 P3
- **不需要 `discoverySource`**——来源只有一种：扫描 Provider 目录

### 4.2 session_stats（统计表——全部来自 git，Provider 无关）

```sql
CREATE TABLE session_stats (
  gto_session_id      TEXT PRIMARY KEY REFERENCES gto_sessions(gto_session_id),
  git_start_commit     TEXT,                       -- Session 开始时的 HEAD commit
  git_end_commit       TEXT,                       -- Session 结束时的 HEAD commit（可 null）
  files_changed        INTEGER DEFAULT 0,          -- git diff --stat 的 files changed
  insertions           INTEGER DEFAULT 0,          -- git diff --stat 的 insertions
  deletions            INTEGER DEFAULT 0,          -- git diff --stat 的 deletions
  commits_ahead       INTEGER DEFAULT 0,           -- git log --oneline start..end 的数量
  updated_at_ms        INTEGER NOT NULL
);
```

**为什么用 git 而不是 JSONL**：

git 是稳定的外部工具，输出格式几十年不变，跟 Provider 完全无关。我们在 Session 开始时记 `git_start_commit`，结束时记 `git_end_commit`，所有统计数据都能用 git 命令算出来：

```bash
# 文件变更统计
git diff --stat <start_commit>..<end_commit>

# 提交数
git log --oneline <start_commit>..<end_commit> | wc -l

# 完整 diff
git diff <start_commit>..<end_commit>
```

这比解析 JSONL tool_use 可靠几个数量级。

### 4.3 生命周期：三态

```text
live ──→ stopped ──→ archived
 ↑_________|
   Resume
```

| 状态 | 含义 | terminalSessionId |
|------|------|-------------------|
| `live` | Agent 在跑 | 有值 |
| `stopped` | PTY 断了，可恢复 | null |
| `archived` | 不关心了 | null |

App 重启时：所有 `live` 批量转 `stopped`。

---

## 5. 发现与扫描

### 5.1 启动流程

```text
App 打开 / Workspace 加载
  │
  ├─ 1. 读 SQLite → 立即渲染历史列表（< 50ms）
  │
  ├─ 2. 后台：ProviderScanner
  │     ├─ Claude: sessions-index.json 或目录扫描
  │     ├─ Codex:  遍历 sessions/YYYY/MM/DD/ 下首行 session_meta
  │     └─ 产出：ProviderSessionCandidate[]
  │
  ├─ 3. Merge：按 provider_log_path 去重
  │     ├─ 已在 SQLite → 更新 last_activity_at_ms
  │     └─ 新发现 → INSERT (lifecycle=stopped)
  │
  └─ 4. 前端增量更新列表
```

**关键**：步骤 1 先于步骤 2。用户看到的不是空白等待。

### 5.2 Claude 扫描实现

```rust
fn scan_claude_sessions(home_dir: &Path, cwd: &Path) -> Vec<ProviderSessionCandidate> {
    let project_key = claude_project_key_for_path(cwd);
    let project_dir = home_dir.join(".claude/projects").join(project_key);

    if !project_dir.exists() { return vec![]; }

    // 1. 优先读 sessions-index.json
    if let Ok(entries) = read_sessions_index(&project_dir) {
        return entries
            .into_iter()
            .filter(|e| !e.is_sidechain && paths_match(&e.project_path, cwd))
            .filter(|e| Path::new(&e.full_path).exists())
            .map(to_candidate)
            .collect();
    }

    // 2. Fallback: 扫目录下 .jsonl
    scan_jsonl_files(&project_dir)
        .into_iter()
        .map(to_candidate)
        .collect()
}
```

### 5.3 Codex 扫描实现

```rust
fn scan_codex_sessions(sessions_root: &Path, cwd: &Path) -> Vec<ProviderSessionCandidate> {
    let normalized_cwd = normalize_path(cwd);

    walk_jsonl_files(sessions_root)
        .into_iter()
        .filter_map(|path| {
            let meta = extract_codex_session_meta(&path)?;  // 只读首行
            if !paths_match_normalized(&meta.cwd, &normalized_cwd) {
                return None;
            }
            Some(ProviderSessionCandidate {
                provider: Provider::Codex,
                provider_session_id: Some(meta.id),
                log_path: path,
                cwd: cwd.to_path_buf(),
                modified_at_ms: file_mtime_ms(&path),
                first_user_message: None,  // 懒加载
            })
        })
        .collect()
}
```

**性能**：Codex 只读首行 session_meta（<1ms/文件）。100-500 文件场景 < 500ms。

### 5.4 缓存策略

| 层级 | 存储 | 刷新时机 |
|------|------|----------|
| L1: SQLite gto_sessions | `.gtoffice/sessions.db` | ProviderScanner merge 时 |
| L2: 内存扫描结果 | `DiscoveryCache` | 30s TTL 或手动刷新 |

---

## 6. 摘要与统计（P0 核心，全部基于 git）

### 6.1 卡片字段与来源

| 字段 | 来源 | 获取成本 | 可靠性 |
|------|------|----------|--------|
| title | JSONL 首条 user 消息前 80 字符 | 读 1-5 行 | ✅ 首行解析稳定 |
| provider | 扫描时已知 | 0 | ✅ |
| started_at_ms | 文件 mtime | 0 | ✅ |
| last_activity_at_ms | 文件 mtime | 0 | ✅ |
| lifecycle | SQLite | 0 | ✅ |
| files_changed / commits | `git diff --stat` / `git log` | 懒加载，< 50ms | ✅ git 极稳 |
| 完整 diff | `git diff start..end` | 详情页按需 | ✅ |

### 6.2 Git 统计流程

```text
Session 开始时：
  git rev-parse HEAD → 记录 git_start_commit

Session 结束时：
  git rev-parse HEAD → 记录 git_end_commit
  git diff --stat <start>..<end> → files_changed, insertions, deletions
  git log --oneline <start>..<end> → commits_ahead

卡片展示时（懒加载）：
  读 session_stats 一行即可
```

**注意**：如果 Session 开始时不在 git repo 中（`git rev-parse HEAD` 失败），统计字段留 null，卡片显示 `—`。不崩溃，只是没数据。

### 6.3 懒加载策略

```text
列表态：title + provider + 时间 + lifecycle
       → SQLite 读 1 行，< 1ms

展开态：+ 文件变更数 + 提交数 + 增删行数
       → JOIN session_stats，< 5ms

详情态：+ git log 提交列表 + git diff 文件列表
       → 按需 git 命令，< 100ms
```

---

## 7. 一键恢复

### 7.1 恢复流程

```text
用户点击「恢复」
  │
  ├─ 1. 查 GtoSession（provider, cwd, providerSessionId）
  │
  ├─ 2. 创建新 PTY Session（gt-terminal::create_session）
  │     └─ cwd = gtoSession.cwd
  │
  ├─ 3. 写入启动命令
  │     ├─ claude: "claude" + Enter
  │     └─ codex: "codex" + Enter
  │
  ├─ 4. 等待 CLI 就绪（150ms）
  │
  ├─ 5. 注入 resume 命令
  │     ├─ claude: "/resume" → 选择 providerSessionId 对应的 session
  │     └─ codex: "/resume" 或 "codex exec resume --last"
  │
  ├─ 6. 更新 GtoSession
  │     ├─ lifecycle = live
  │     └─ terminal_session_id = 新 PTY ID
  │
  └─ 前端切换到 Station Live
```

### 7.2 Handover 上下文

Session 停止时自动生成 handover 摘要，Resume 时注入 prompt 前缀。数据全部来自 git：

```text
[GT Office] 上次会话: {title}
变更: {files_changed} 个文件 | +{insertions} -{deletions} | {commits_ahead} 次提交
最后一次提交: {git log -1 --oneline}
──────────
```

### 7.3 恢复策略矩阵

| 场景 | 对话恢复 | 终端画面 |
|------|----------|----------|
| Provider jsonl 完整 | ✅ /resume | 新 PTY（空白），handover 提供上下文 |
| Provider jsonl 已删 | ❌ | GTO 只读时间线 + handover |
| Provider jsonl 部分损坏 | ⚠️ | 尝试 resume，失败则 fallback 到只读 |

---

## 8. 实时感知：复用已有 Git 基础设施

### 8.1 核心思路

**Agent 在跑 = git 在变。** `GitStatusCoordinator` 已经在 push `git/updated` 事件了。我们只需要：

1. Session `live` 时，监听 `git/updated`
2. 对比前后差量（新文件变更、新提交、分支切换）
3. 弹出通知，点击跳转 DiffViewer / GitGraphView

**零新基础设施**——全复用现有组件。

### 8.2 已有基础设施

| 组件 | 已有能力 | 本次用途 |
|------|----------|----------|
| `GitStatusCoordinator` | 检测 git 状态变化，推送 `git/updated` 事件 | Session 活动信号源 |
| `GitUpdatedPayload` | 含 `branch`, `ahead`, `behind`, `files[]`, `dirty`, `revision` | 差量对比的输入 |
| `NotificationStore` | toast 通知系统（info/warning/error/success，自动消失） | 弹出活动通知 |
| `DiffViewer` | 文件 diff 查看器，支持 hunk staging | 点击通知跳转目标 |
| `GitGraphView` | 提交图，无限滚动 | 点击通知跳转目标 |
| `gt-git::log()` | 提交历史查询 | 获取新提交详情 |
| `gt-changefeed` | **空壳 stub** | 实现 SessionActivity 数据桥接 |

### 8.3 SessionActivity 工作流

```text
Agent Session 变为 live
  │
  ├─ 1. 记录 git_start_commit = git rev-parse HEAD
  ├─ 2. 订阅 git/updated 事件（workspace 级别）
  │
  │  Agent 干活...git 状态变化...
  │
  ├─ 3. 收到 git/updated
  │     ├─ 对比前一次 payload
  │     ├─ branch 变了？→ 通知 "切换到分支 xxx"
  │     ├─ ahead 增加了？→ 查 git log 取新 commit → 通知 "提交: fix: xxx"
  │     ├─ files 变了？→ 通知 "修改了 3 个文件"
  │     └─ 记录差量到 Session 活动记录
  │
  ├─ 4. Session 变为 stopped
  │     ├─ 记录 git_end_commit = git rev-parse HEAD
  │     ├─ 计算并缓存 session_stats
  │     └─ 取消订阅 git/updated
```

### 8.4 差量检测逻辑

```rust
struct GitStatusSnapshot {
    revision: u64,
    branch: String,
    ahead: u32,
    behind: u32,
    dirty: bool,
    files: Vec<GitStatusFile>,  // 已有类型
}

impl SessionActivity {
    /// 对比前后 git/updated payload，产出结构化活动
    fn diff_snapshots(prev: &GitStatusSnapshot, curr: &GitStatusSnapshot) -> Vec<SessionActivityItem> {
        let mut items = Vec::new();

        // 分支切换
        if prev.branch != curr.branch {
            items.push(SessionActivityItem::BranchSwitched {
                from: prev.branch.clone(),
                to: curr.branch.clone(),
            });
        }

        // 新提交
        if curr.ahead > prev.ahead {
            items.push(SessionActivityItem::NewCommits {
                count: curr.ahead - prev.ahead,
            });
        }

        // 文件变更（对比 files 列表）
        let new_changes = diff_file_lists(&prev.files, &curr.files);
        if !new_changes.is_empty() {
            items.push(SessionActivityItem::FilesChanged {
                files: new_changes,
            });
        }

        items
    }
}
```

### 8.5 通知样式与跳转

**原则**：复用 `NotificationStore`，不造新组件。通知自动消失（5s），但可在 Station 内留活动记录。

```text
Agent 正在运行时，Station 区域弹出通知：

┌─ Station ──────────────────────────────────────────────┐
│                                                        │
│  ┌─ Terminal ───────────────┐  ┌─ 活动通知 ──────────┐ │
│  │ $ claude                 │  │                      │ │
│  │ > 修复登录 bug           │  │ 📝 提交: fix: auth  │ │
│  │ ...                      │  │   crash              │ │
│  │                          │  │   [查看 diff →]      │ │
│  │                          │  │                      │ │
│  │                          │  │ ✏️ 修改了 3 个文件    │ │
│  │                          │  │   src/auth.rs        │ │
│  │                          │  │   src/login.tsx      │ │
│  │                          │  │   package.json       │ │
│  │                          │  │   [查看 diff →]      │ │
│  └──────────────────────────┘  └──────────────────────┘ │
│                                                        │
└────────────────────────────────────────────────────────┘

点击 [查看 diff →]：
  → 打开 Git 面板，聚焦到 DiffViewer
  → 或打开 GitGraphView，滚动到对应 commit
```

**实现方式**：

1. `SessionActivity` 检测到差量 → 通过 Tauri `emit` 发送 `gtoffice:session-activity` 事件
2. 前端 `useSessionActivity` hook 监听事件 → 调用 `NotificationStore.addNotification()`
3. 通知组件渲染自定义内容（含跳转链接），复用已有 notification UI

### 8.6 changefeed 的角色

现有 `gt-changefeed` 是空壳 stub，正好用于 SessionActivity 的数据桥接：

```rust
// gt-changefeed: 从 git/updated 事件 → Session 活动记录
pub struct SessionChangeFeed {
    session_id: String,
    last_snapshot: Option<GitStatusSnapshot>,
}

impl SessionChangeFeed {
    /// 接收 git/updated，差量检测，产出活动事件
    pub fn on_git_updated(&mut self, payload: &GitUpdatedPayload) -> Vec<SessionActivityItem> {
        let curr = GitStatusSnapshot::from(payload);
        let items = match &self.last_snapshot {
            Some(prev) => SessionActivity::diff_snapshots(prev, &curr),
            None => vec![],  // 首次，无差量
        };
        self.last_snapshot = Some(curr);
        items
    }
}
```

**与现有 `changefeed_query` Tauri command 的衔接**：扩展返回值，支持按 `gtoSessionId` 查询活动记录。

### 8.7 边界情况

| 情况 | 处理 |
|------|------|
| 不在 git repo 中 | `git/updated` 不会触发，无通知，不影响终端 |
| Agent 在跑但 git 没变化 | 无通知，正常——说明 Agent 在思考或读文件 |
| 短时间大量 `git/updated` | `GitStatusCoordinator` 已有 180ms debounce，天然合并 |
| 多个 Agent 同 workspace | 按 `gtoSessionId` 分离，每个 Session 独立追踪 |
| Agent 做了 git 操作但没 commit | `dirty` 变化被检测，通知「修改了 N 个文件（未提交）」|

---

## 9. UI：Station 三态

### 9.1 Idle — 历史列表

```text
┌─ Claude Code ─────────────────────────────────────────────┐
│                                                            │
│  [+ 新会话]                                                │
│                                                            │
│  ── 最近 ──────────────────────────────────────────────   │
│                                                            │
│  ● 修复 Git panel 崩溃                                     │
│    2h前 · Claude · 3 文件 · +42/-8 · 2 提交               │
│    [恢复对话]                                              │
│                                                            │
│  ○ 接入 webhook                                            │
│    昨天 · Claude · 5 文件 · 1 提交                          │
│    [恢复对话]                                              │
│                                                            │
│  ○ 实现登录功能                                             │
│    3d前 · Codex · 12 文件 · +230/-45 · 4 提交              │
│    [恢复对话]                                              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

卡片信息全部来自可靠数据源：标题来自 JSONL 首行，统计来自 git。

### 9.2 Live — 终端 + Git 活动通知

```text
┌─ Terminal ───────────────────────┐  ┌─ Activity ──────────────────────┐
│ $ claude                         │  │ 📝 提交: fix: auth crash         │
│ > 修复登录 bug                   │  │   [查看 diff →]                  │
│ ...                              │  │                                  │
│                                  │  │ ✏️ 修改了 3 个文件（未提交）      │
│                                  │  │   src/auth.rs                    │
│                                  │  │   src/login.tsx                  │
│                                  │  │   package.json                   │
│                                  │  │   [查看 diff →]                  │
│                                  │  │                                  │
│                                  │  │ 🔄 切换到分支 feature/auth       │
│                                  │  │   [查看提交图 →]                 │
└──────────────────────────────────┘  └──────────────────────────────────┘
```

**数据来源**：`git/updated` 事件差量，Provider 无关，不需要解析 JSONL。
**跳转目标**：点击通知直接跳到已有的 DiffViewer / GitGraphView。

### 9.3 Detail — Git Diff + 提交记录

```text
┌─ 修复 Git panel 崩溃 ─────────────────────────────────────┐
│                                                            │
│  Claude · 2h前 · cwd: ~/work/GT-Office                    │
│                                                            │
│  ── 提交记录 (2) ─────────────────────────────────────    │
│  def456  test: add branch switch test                      │
│  abc789  fix: branch switch crash                          │
│                                                            │
│  ── 文件变更 ──────────────────────────────────────        │
│  M  src/git/panel.tsx                +42  -8               │
│  A  src/git/__tests__/branch.test.ts  +31                  │
│  M  package.json              +1   -0                       │
│                                                            │
│  ── 完整 Diff ────────────────────────────────────        │
│  [展开查看 src/git/panel.tsx 的具体修改]                   │
│                                                            │
│  [恢复对话]                                                │
└────────────────────────────────────────────────────────────┘
```

所有数据来自 `git log` 和 `git diff`，Provider 无关。

---

## 10. 性能与可靠性

### 10.1 性能目标

| 场景 | 目标 | 策略 |
|------|------|------|
| App 打开 → 历史列表可见 | < 500ms | SQLite 先行，扫描后台 |
| Discovery 完成全部扫描 | < 3s | 并行扫描 + 缓存 |
| 点击恢复 → PTY 就绪 | < 1s | 复用现有 PTY 创建 |
| 卡片展开 → 统计加载 | < 100ms | 懒加载 + JOIN |

### 10.2 SQLite

- WAL 模式：读写不阻塞
- 单连接 + Mutex：桌面应用足够
- 路径：`.gtoffice/sessions.db`，跟随 workspace

### 10.3 并发模型

```text
UI Thread (main)
  │
  ├─ session.* commands（同步/异步）
  │
  Background Thread Pool
  ├─ ProviderScanner      ← 定期/按需扫描 → merge SQLite
  ├─ GitSessionDiff       ← 懒加载 git 统计 → 写 session_stats
  ├─ SessionSummary       ← 懒加载首条消息提取 → 写缓存
  └─ SessionChangeFeed    ← 监听 git/updated → 差量检测 → emit session-activity
```

事件通过 Tauri `emit` 推送前端。SQLite 写入通过 `Mutex<Connection>` 序列化。
`SessionChangeFeed` 订阅已有的 `git/updated` 事件流，不新增 watcher。

### 10.4 降级策略

| 故障场景 | 降级行为 |
|----------|----------|
| Provider 目录不存在 | 空列表，不崩溃 |
| sessions-index.json 损坏 | 回退目录扫描 |
| 首条消息解析失败 | title 显示 `(unknown)`，不崩溃 |
| 不在 git repo 中 | 统计字段显示 `—`，不影响列表 |
| git diff 失败 | 跳过统计，卡片只显示 title + 时间 |
| Provider resume 失败 | fallback 到只读 git diff |

---

## 11. 与现有模块关系

| 模块 | 角色 | 改动范围 |
|------|------|----------|
| `gt-session-log` | Channel 消息解析（不动）+ Discovery 模式（新增） | **新增** Discovery 扫描方法；**不动**现有 poll/bind/Channel 逻辑 |
| `gt-terminal` | PTY 管理 | 无需大改，Resume 复用 create + write |
| `gt-git` | git 操作 | 无需改动，`GitService` 现有方法够用 |
| `GitStatusCoordinator` | git/updated 事件推送 | 无需改动，`SessionChangeFeed` 只是订阅者 |
| `AgentRuntimeRegistration` | 运行时绑定 | 增加 `gtoSessionId` 字段 |
| `WorkspaceTerminalSessionDocument` | 前端持久化 | 增加 `lastActiveGtoSessionIds` |
| `tool_launch` | 启动入口 | 委托 `session.launch`，记录 `git_start_commit` |
| `gt-changefeed` | 空壳 stub → 实现 `SessionChangeFeed` | **从空壳变为** git/updated 差量检测 + Session 活动记录 |
| `NotificationStore` | toast 通知 | 无需改动，直接复用 `addNotification()` |
| `DiffViewer` / `GitGraphView` | 详情页 | 无需改动，作为通知跳转目标 |
| `app_state.rs` | 全局装配 | 仅注册 `SessionService`，不承载业务 |

---

## 12. 实施阶段

| 阶段 | 交付 | 用户感知 | 数据来源 |
|------|------|----------|----------|
| **P0** | SQLite + Discovery + 历史列表卡片 + 一键恢复 | 「我能看到做了什么、点一下就接上」 | 文件系统 + git |
| **P1** | Git 活动通知（监听 `git/updated` → toast → 跳转 DiffViewer） | 「Agent 在跑时，改了什么自动弹出来，点一下看 diff」 | `git/updated` 事件 |
| **P2** | Git Diff Detail 页 + handover 注入 | 「点进去看改了什么、恢复时有上下文」 | git |
| **P3** | 结构化活动流 + 验证追踪 | 「看着它在干活」 | **等 Provider 提供稳定 API 后再做** |

### P0 详细拆解

| 子任务 | 说明 |
|--------|------|
| P0.1: `gt-agent-session` crate 骨架 | SQLite schema、基础 CRUD |
| P0.2: `ProviderScanner` (Claude) | sessions-index.json + 目录回退 |
| P0.3: `ProviderScanner` (Codex) | 遍历 sessions/ 下首行 session_meta |
| P0.4: `SessionSummary` | 首条消息提取（仅读 1-5 行），不影响 Channel 解析 |
| P0.5: `GitSessionDiff` | 启动时记 `git_start_commit`，结束时记 `git_end_commit`，懒加载统计 |
| P0.6: Tauri bridge | session.list / session.discover / session.launch / session.get |
| P0.7: Station Idle UI | 历史列表 + 卡片 |
| P0.8: App 启动 Discovery | workspace 加载后自动 scan |

### P1 详细拆解

| 子任务 | 说明 |
|--------|------|
| P1.1: `SessionChangeFeed` | 实现 `gt-changefeed`，监听 `git/updated`，差量检测 |
| P1.2: `SessionActivity` 事件 | 差量 → `SessionActivityItem` 枚举（BranchSwitched/NewCommits/FilesChanged） |
| P1.3: Tauri 事件桥接 | `gtoffice:session-activity` 事件推送前端 |
| P1.4: 前端 Activity 面板 | Station Live 时在终端旁展示活动通知，复用 NotificationStore |
| P1.5: 跳转导航 | 点击通知 → 打开 DiffViewer 或 GitGraphView |

**不做**：多 Agent 协作画布、PTY scrollback 持久化、JSONL 结构化事件解析（等 Provider API）、Gemini 路径、Channel 消息解析改动。

---

## 13. 原则

1. **只依赖稳定的数据源**：文件系统、git、Provider 首行——不解析 Provider 内部 JSONL 格式
2. **不动现有功能**：Channel 消息解析、`gt-session-log` poll/bind 逻辑——新增 Discovery 模式，不改动
3. **复用已有基础设施**：`git/updated` 事件、`NotificationStore`、`DiffViewer`、`GitGraphView`——不造新组件
4. **Provider 是对话真相**：恢复对话用 Provider 原生 /resume，GTO 只做索引
5. **PTY 是载体**：Terminal 可弃可替换，不作为恢复依据
6. **SQLite 先行**：打开 App 先给历史列表，扫描在后台做
7. **三态足够**：live / stopped / archived，减少状态 = 减少边缘 bug
8. **逻辑下沉 `gt-agent-session`**：不膨胀 `app_state`
9. **统计独立于主表**：`session_stats` 独立，且全部来自 git
10. **降级不崩溃**：不在 git repo 中就显示 `—`，Provider 目录缺失就空列表
11. **不猜 Provider 格式**：JSONL 只读首行取 title，不逐行解析做结构化提取