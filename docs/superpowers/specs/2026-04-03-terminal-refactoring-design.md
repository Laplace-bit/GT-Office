# GT Office 终端子系统重构设计文档

> 创建日期：2026-04-03
> 状态：待审核

## 1. 概述

### 1.1 目标

| 指标 | 现状 | 目标 | 提升 |
|---|---|---|---|
| WebView 中 xterm 实例数 | N（= station 数） | 1-2 | -80%+ |
| 每 chunk IPC 体积 | raw × 1.33（base64） | raw × 1（binary） | -25% |
| VT 解析次数/chunk | 2（前端 + 后端） | 1（后端） | -50% |
| ShellRoot 终端代码行 | ~1000 行 | ~200 行 | -80% |
| 终端切换延迟 | serialize → destroy → recreate | 后端 rendered screen → reset + write | -70% |

### 1.2 核心设计决策

| 决策 | 选择 | 原因 |
|---|---|---|
| 实现顺序 | Phase 1 先行（后端 VT Engine） | 可靠性最高，不破坏现有功能 |
| Detached Window | Snapshot 模式，激活时获取完整内容 | 统一架构，保证内容完整性 |
| Binary Channel | 无降级，要求现代 WebView | macOS WKWebView / Windows WebView2 都支持 |
| 内容完整性 | 后端 VT Engine 维护完整 scrollback | 切换窗口时恢复完整内容 |

---

## 2. 后端架构

### 2.1 新 Crate：`vb-terminal-core`

目录结构：

```
crates/vb-terminal-core/
├── Cargo.toml
├── src/
│   ├── lib.rs                    # 公共 API 导出
│   ├── session.rs                # TerminalSession 生命周期管理
│   ├── pty.rs                    # PTY spawn/IO（从 vb-terminal 迁移）
│   ├── vt_engine.rs              # VT state wrapper（基于 vt100 crate）
│   ├── output_router.rs          # 三态分发：Active/Visible/Hidden
│   ├── snapshot.rs               # RenderedScreen 生成
│   ├── scrollback.rs             # 高效 ring buffer
│   ├── input.rs                  # 输入写入 + backpressure
│   └── process_tree.rs           # 进程树查询
└── tests/
    ├── session_tests.rs
    ├── vt_engine_tests.rs
    ├── output_router_tests.rs
    └── snapshot_tests.rs
```

### 2.2 核心数据结构

```rust
// session.rs
pub struct TerminalSessionState {
    pub session_id: String,
    pub workspace_id: String,
    pub resolved_cwd: String,
    
    // PTY runtime
    pty_writer: Box<dyn Write + Send>,
    pty_master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    
    // VT canonical state（唯一 truth）
    vt_parser: vt100::Parser,
    
    // Output routing
    visibility: SessionVisibility,
    output_seq: u64,
    
    // Scrollback（支持完整内容恢复）
    scrollback: ScrollbackStore,
    
    // Batch buffer（高性能）
    batch_buffer: Vec<u8>,
    batch_dirty: bool,
}

pub enum SessionVisibility {
    Active,   // 原始字节流直接转发
    Visible,  // 低频 snapshot 推送
    Hidden,   // 只维护 VT state
}
```

### 2.3 Output Router 三态分发

```rust
// output_router.rs
const OUTPUT_BATCH_WINDOW_MS: u64 = 8;
const SCROLLBACK_MAX_LINES: usize = 10000;
const SCROLLBACK_MAX_BYTES: usize = 4 * 1024 * 1024;  // 4MB

impl OutputRouter {
    pub fn dispatch_output(&mut self, session_id: &str, chunk: &[u8]) {
        let session = self.sessions.get_mut(session_id)?;
        
        // 1. VT 解析（必须，维护 truth）
        session.vt_parser.process(chunk);
        
        // 2. Scrollback 追加（ring buffer）
        session.scrollback.push(chunk);
        
        // 3. Active: 批量发送
        if session.visibility == SessionVisibility::Active {
            session.batch_buffer.extend_from_slice(chunk);
            session.batch_dirty = true;
        }
    }
    
    /// 定时 tick（~8ms）
    pub fn flush_active_batches(&mut self) -> Vec<(String, Vec<u8>)> {
        self.sessions.iter_mut()
            .filter(|(_, s)| s.visibility == Active && s.batch_dirty)
            .map(|(id, s)| {
                let batch = std::mem::take(&mut s.batch_buffer);
                s.batch_dirty = false;
                (id.clone(), batch)
            })
            .collect()
    }
}
```

### 2.4 Ring Buffer Scrollback

```rust
// scrollback.rs
pub struct ScrollbackStore {
    buffer: Vec<u8>,           // 环形缓冲区
    write_pos: usize,          // 写入位置
    total_lines: usize,        // 总行数
    max_bytes: usize,          // 上限
}

impl ScrollbackStore {
    pub fn push(&mut self, chunk: &[u8]) {
        for &byte in chunk {
            self.buffer[self.write_pos] = byte;
            self.write_pos = (self.write_pos + 1) % self.max_bytes;
        }
        self.total_lines += chunk.iter().filter(|&&b| b == b'\n').count();
    }
    
    /// 提取完整内容用于 session 切换恢复
    pub fn extract_all(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(self.max_bytes);
        result.extend_from_slice(&self.buffer[self.write_pos..]);
        result.extend_from_slice(&self.buffer[..self.write_pos]);
        result
    }
}
```

### 2.5 与现有 `vb-terminal` 的关系

`vb-terminal` 瘦化为公共接口层：

```rust
// vb-terminal/src/lib.rs
pub use vb_terminal_core::{
    TerminalSessionState, RenderedScreen, SessionVisibility,
    TerminalOutputEvent, TerminalStateChangedEvent,
    // ... 重新导出公共类型
};
```

---

## 3. Binary Channel IPC

### 3.1 新链路

```
PTY bytes → Tauri Channel<Vec<u8>> → JS ArrayBuffer → xterm.write(Uint8Array)
```

### 3.2 Tauri Command 变更

```rust
// commands/terminal/mod.rs

/// 新增：打开 Binary Output Channel
#[tauri::command]
pub fn terminal_open_output_channel(
    session_id: String,
    channel: tauri::ipc::Channel<Vec<u8>>,
    state: State<'_, AppState>,
) -> Result<Value, String>

/// 新增：切换 active session
#[tauri::command]
pub fn terminal_activate(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<RenderedScreen, String>

/// 新增：按需获取 rendered screen
#[tauri::command]
pub fn terminal_get_rendered_screen(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<RenderedScreen, String>

/// 废弃（Phase 3 删除）
// terminal_read_snapshot → 改为 push 模式
// terminal_read_delta → 改为 Binary Channel
// terminal_report_rendered_screen → 后端自生成
```

### 3.3 IPC 协议

**Active Session 输出** — Binary Channel

```
后端 → 前端：Channel<Vec<u8>>
直接推送 PTY 原始字节，零序列化
```

**Inactive Session Snapshot** — Tauri Event（~300ms）

```json
{
  "sessionId": "term:ws1:3",
  "revision": 42,
  "lastLines": "$ npm run build\n✓ Built in 2.3s\n$",
  "cursorRow": 2,
  "totalLines": 150,
  "unreadBytes": 0
}
```

**Session 切换协议**

```
前端 → 后端: terminal_activate(sessionId)
后端:
  1. 旧 active → Visible
  2. 新 active → Active
  3. 返回 RenderedScreen（含 scrollback）
前端:
  1. xterm.reset()
  2. xterm.write(renderedScreen.content)
  3. 打开 Binary Channel
```

### 3.4 高可靠性保障

**序列号 + 断点续传：**

```rust
pub struct OutputChunk {
    pub session_id: String,
    pub seq: u64,
    pub data: Vec<u8>,
    pub is_delta: bool,
}

#[tauri::command]
pub fn terminal_resync(
    session_id: String,
    from_seq: u64,
) -> Result<OutputChunk, String>
```

**VT State 一致性校验：**

```rust
impl VtEngine {
    pub fn validate_consistency(&self) -> Result<(), String> {
        let screen_rows = self.parser.screen().rows();
        if screen_rows != self.rows {
            return Err(format!("VT state inconsistent"));
        }
        Ok(())
    }
}
```

---

## 4. 前端架构

### 4.1 目录重构

```
features/terminal/
├── index.ts
├── controller/
│   ├── TerminalSurfaceController.ts    # 核心编排器
│   ├── TerminalOutputChannel.ts       # Binary Channel 接收
│   ├── TerminalActivationManager.ts   # session 切换逻辑
│   └── TerminalSnapshotManager.ts     # inactive snapshot 管理
├── surfaces/
│   ├── ActiveTerminalSurface.tsx      # Active xterm 渲染面
│   ├── InactiveTerminalSnapshot.tsx   # 非活跃终端预览
│   └── TerminalSurfaceContainer.tsx   # 统一容器
├── xterm/
│   ├── XtermInstance.tsx              # xterm 实例管理（复用）
│   ├── XtermTheme.ts                  # 主题配置
│   └── XtermInputHandler.ts           # 输入处理
├── legacy/                            # 废弃文件（Phase 3 清理）
│   ├── terminal-stream-decoder.ts
│   ├── terminal-vt-parser.ts
│   └── station-terminal-restore-state.ts
├── StationXtermTerminal.tsx           # 简化，委托 ActiveTerminalSurface
├── macos-webkit-ime-workaround.ts     # 保留，精简
└── station-terminal-input-buffer.ts   # 保留
```

### 4.2 TerminalSurfaceController

```typescript
// controller/TerminalSurfaceController.ts
export class TerminalSurfaceController {
  private activeSessionId: string | null = null
  private outputChannel: TerminalOutputChannel | null = null
  private activationManager: TerminalActivationManager
  private snapshotManager: TerminalSnapshotManager
  private xtermSink: XtermSink | null = null
  
  async activateSession(sessionId: string): Promise<void> {
    if (this.activeSessionId === sessionId) return
    
    this.activeSessionId = sessionId
    
    // 1. 通知后端切换
    const renderedScreen = await invoke<RenderedScreen>('terminal_activate', { sessionId })
    
    // 2. 重置 xterm 并写入新 session 内容
    this.xtermSink?.reset()
    this.xtermSink?.write(renderedScreen.content)
    
    // 3. 重新绑定 output channel
    await this.outputChannel?.rebind(sessionId)
  }
  
  private handleActiveOutput(chunk: Uint8Array): void {
    this.xtermSink?.write(chunk)
  }
  
  handleSnapshotUpdate(sessionId: string, snapshot: TerminalSnapshot): void {
    this.snapshotManager.update(sessionId, snapshot)
  }
  
  bindSink(sink: XtermSink): void {
    this.xtermSink = sink
  }
  
  unbindSink(): void {
    this.xtermSink = null
  }
}
```

### 4.3 ActiveTerminalSurface

```typescript
// surfaces/ActiveTerminalSurface.tsx
export const ActiveTerminalSurface = memo(function ActiveTerminalSurface({
  controller,
  sessionId,
  onData,
  onResize,
}: ActiveTerminalSurfaceProps) {
  const xtermRef = useRef<XtermInstance>(null)
  
  useEffect(() => {
    const sink: XtermSink = {
      write: (chunk: Uint8Array) => xtermRef.current?.write(chunk),
      reset: () => xtermRef.current?.reset(),
      focus: () => xtermRef.current?.focus(),
    }
    controller.bindSink(sink)
    return () => controller.unbindSink()
  }, [controller])
  
  useEffect(() => {
    controller.activateSession(sessionId)
  }, [controller, sessionId])
  
  return <XtermInstance ref={xtermRef} onData={onData} onResize={onResize} />
})
```

### 4.4 InactiveTerminalSnapshot

```typescript
// surfaces/InactiveTerminalSnapshot.tsx
export const InactiveTerminalSnapshot = memo(function InactiveTerminalSnapshot({
  snapshot,
  onActivate,
}: InactiveTerminalSnapshotProps) {
  const displayText = useMemo(() => {
    if (!snapshot?.lastLines) return ''
    return snapshot.lastLines.split('\n').slice(-12).join('\n')
  }, [snapshot?.lastLines])
  
  return (
    <div className="terminal-snapshot" onClick={onActivate}>
      <pre className="terminal-snapshot__content">{displayText}</pre>
      <div className="terminal-snapshot__footer">
        <span>{snapshot?.totalLines} 行</span>
      </div>
      <div className="terminal-snapshot__overlay">
        <span>点击激活</span>
      </div>
    </div>
  )
})
```

### 4.5 ShellRoot 代码迁移

| 迁移项 | 原位置 | 新位置 | 代码行 |
|---|---|---|---|
| output cache | ShellRoot | TerminalSurfaceController | ~150 行 |
| output append/reset | ShellRoot | TerminalSurfaceController | ~200 行 |
| event listeners | ShellRoot | TerminalSurfaceController | ~300 行 |
| sink binding | ShellRoot | TerminalSurfaceController | ~150 行 |
| session 切换 | ShellRoot | TerminalActivationManager | ~100 行 |
| **ShellRoot 减少** | | | **~900 行** |

---

## 5. 接口定义

### 5.1 RenderedScreen（后端 → 前端）

```rust
/// 从后端 VT state 生成的 rendered screen
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedScreen {
    pub session_id: String,
    pub revision: u64,              // 单调递增版本号
    pub content: Vec<u8>,           // 完整终端内容（含 scrollback）
    pub cols: u16,
    pub rows: u16,
    pub cursor_row: u32,
    pub cursor_col: u32,
    pub scrollback_lines: u32,      // scrollback 总行数
    pub title: Option<String>,      // 终端标题
}
```

### 5.2 TerminalSnapshot（Inactive 推送）

```typescript
// 前端类型定义
interface TerminalSnapshot {
  sessionId: string
  revision: number
  lastLines: string          // 最后 N 行文本（纯文本，不含 ANSI）
  cursorRow: number
  totalLines: number
  unreadBytes: number
  timestamp: number          // ms
}
```

### 5.3 XtermSink（Controller → Xterm）

```typescript
// Controller 绑定到 Xterm 的 sink 接口
interface XtermSink {
  /** 写入原始字节 */
  write(chunk: Uint8Array): void
  /** 重置终端（切换 session 时调用） */
  reset(): void
  /** 聚焦 */
  focus(): void
  /** 获取当前终端尺寸 */
  getSize(): { cols: number; rows: number }
}
```

### 5.4 OutputChunk（Binary Channel）

```rust
/// Binary Channel 推送的输出块
#[derive(Debug, Clone, Serialize)]
pub struct OutputChunk {
    pub session_id: String,
    pub seq: u64,              // 单调递增序列号
    pub data: Vec<u8>,         // PTY 原始字节
    pub ts_ms: u64,            // 时间戳
}
```

---

## 6. 实施阶段

### Phase 1：后端 VT Engine + Binary Channel（2-3 周）

**目标**：创建 `vb-terminal-core` crate，集成 VT engine，实现 Binary Channel 推送。

**具体任务**：

1. 创建 `crates/vb-terminal-core/`
2. 搬迁 session/mux/process_tree 逻辑
3. 为每个 session 添加 `vt100::Parser` VT state
4. 实现 `OutputRouter` 三态分发
5. 实现 `RenderedScreen` 从 VT state 生成
6. 新增 `terminal_open_output_channel` Tauri command
7. 新增 `terminal_activate` / `terminal_get_rendered_screen` commands
8. **旧 API 全部保留**，新旧并行

**验证**：

- `cargo test -p vb-terminal-core`
- `cargo test -p gtoffice-desktop-tauri`
- 手动验证：旧前端 + 新后端仍然工作

### Phase 2：前端 Active-Only xterm（2 周）

**目标**：前端改为 1 个 active xterm 实例 + inactive snapshot 预览。

**具体任务**：

1. 实现 `TerminalSurfaceController`
2. 实现 `ActiveTerminalSurface`（xterm 实例复用）
3. 实现 `InactiveTerminalSnapshot`（纯文本预览）
4. 修改 `TerminalStationPane`：根据 active 状态选择渲染
5. 接入 Binary Channel 替代 base64 event
6. 从 ShellRoot 迁出终端编排逻辑
7. 废弃 `terminal-stream-decoder.ts`、`terminal-vt-parser.ts`

**验证**：

- `npm run typecheck`
- `npm run build`
- 手动验证：切换 station 时终端内容保持
- macOS 环境：IME 输入正常

### Phase 3：外部通道 Relay 统一 + 清理（1 周）

**目标**：app_state 中的外部通道回复改为从后端 VT engine 读取。

**具体任务**：

1. `ExternalReplyRelaySession` 删除内部 `vt100::Parser`
2. `report_external_reply_rendered_screen` 改为从 `vb-terminal-core` 读取
3. 前端删除 `terminal_report_rendered_screen` 调用
4. 清理 ShellRoot 中残留的终端编排代码
5. 删除旧 API

**验证**：

- `cargo test -p gtoffice-desktop-tauri`
- 手动验证：Telegram/飞书通道回复内容正确

### Phase 4：性能调优 + 收口（1 周）

**目标**：性能极致优化和代码清理。

**具体任务**：

1. Output 合批窗口调优
2. Scrollback 内存上限配置化
3. WebGL renderer 启用评估
4. 清理旧代码
5. 更新文档

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| `vt100` crate 与 xterm.js 渲染不一致 | 切换 session 时内容偏差 | Phase 1 增加对比测试 |
| Binary Channel 大数据量推送丢帧 | 输出不完整 | 序列号 + 断点续传 |
| Active xterm 实例复用时状态泄漏 | ANSI mode/颜色残留 | 切换时 `terminal.reset()` |
| 外部通道 relay 改为后端 VT state 后回归 | Telegram/飞书回复异常 | Phase 3 独立，可回滚 |

---

## 8. 不做的事情

1. **不引入 `alacritty_terminal`** — `vt100` crate 已满足需求
2. **不开 native terminal window** — 保持产品一致性
3. **不全量重写前端 terminal feature** — 渐进式迁移
4. **不引入新的 UI 框架** — 保持 React + xterm.js
5. **不做 terminal multiplexer** — 超出当前需求