# T-098 高性能 IDE Sidecar Daemon 工程设计与 Skeleton

> 日期：2026-02-08  
> 目标：为 Tauri IDE 提供“重逻辑外置”的 Rust Core Daemon 最小可运行骨架（跨平台、可流式、可取消、可背压）。

## 1. 系统架构（可落地）

```text
┌───────────────────────────── Desktop Process (Tauri Host) ─────────────────────────────┐
│                                                                                         │
│  WebUI (React/Svelte)                                                                   │
│   - Virtual Tree / Virtual Search List / xterm.js                                       │
│   - Visible Subscriptions / Incremental Rendering                                       │
│              │                                                                          │
│              │ binary frame RPC/event (length-delimited + bincode)                     │
│              ▼                                                                          │
│  Tauri Shell                                                                            │
│   - permission gate, window lifecycle, sidecar bootstrap                               │
│   - NO heavy business logic                                                            │
└──────────────┬───────────────────────────────────────────────────────────────────────────┘
               │ localhost socket (skeleton) / UDS (Linux/macOS) / Named Pipe (Windows)
               ▼
┌────────────────────────────── Rust Core Daemon (Sidecar) ───────────────────────────────┐
│ protocol + transport + scheduler                                                        │
│                                                                                         │
│  Services                                                                               │
│  1) fileio: lazy list_dir, workspace-bound path guard                                  │
│  2) search: ignore walker + grep-* matcher/searcher + streaming + cancel               │
│  3) terminal: portable-pty sessions, output streaming, ring buffer                     │
│                                                                                         │
│  Runtime                                                                                │
│  - tokio async I/O (socket, channels, lifecycle)                                        │
│  - tokio blocking pool for CPU/fs heavy scan                                            │
│  - bounded channel = backpressure boundary                                               │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

关键约束：

1. Tauri 只保留壳层与权限，不承载搜索/扫描/PTY 管理等重逻辑。
2. UI 与 Daemon 走 socket 二进制帧，避免 JSON 大对象序列化成本。
3. 所有重任务可取消（search）、可流式（search/terminal）、可背压（有界通道 + 降采样）。

## 2. Daemon 模块划分与目录

```text
crates/vb-daemon/
  src/
    main.rs                    # sidecar 启动入口
    daemon.rs                  # 连接接入、请求路由、响应封包
    error.rs                   # 统一错误码映射
    protocol/
      message.rs               # request/response/event 类型
      codec.rs                 # bincode 编解码
    transport/
      tcp.rs                   # skeleton: localhost TCP
    fileio/
      service.rs               # list_dir 懒加载分页
    search/
      service.rs               # 流式搜索 + cancel + backpressure
    terminal/
      service.rs               # PTY create/write/resize/kill + output stream
    util/
      ring_buffer.rs           # 通用 ring buffer
```

> 生产建议：`transport` 扩展为 `uds.rs`（unix）+ `named_pipe.rs`（windows），并保留 localhost fallback。

## 3. 关键数据结构与线程模型

### 3.1 Protocol / 会话层

1. `ClientFrame { id, request }`
2. `ServerFrame { request_id, payload(Response|Event) }`
3. `ResponseEnvelope { ok, data, error }`

线程模型：

1. 每个 socket 连接：`tokio` 一个 reader loop + 一个 writer task。
2. writer 前有 `mpsc::channel`（有界，默认 512）作为背压边界。

### 3.2 FileIO（list_dir）

关键结构：

1. `ListDirRequest { workspace_root, rel_path, cursor, limit }`
2. `ListDirResponse { entries, next_cursor, total }`

线程模型：

1. 请求处理同步读取单层目录（懒加载，不递归全量扫描）。
2. 按目录优先 + 名称排序，分页返回，前端继续请求下一页。

### 3.3 Search（流式 + cancel）

关键结构：

1. `SearchService { tasks, active_by_client }`
2. `SearchTaskHandle { cancel: AtomicBool, task: JoinHandle }`
3. `SearchChunkEvent / SearchDoneEvent / SearchCancelledEvent`

线程模型：

1. `SearchStart` 进入 `tokio::spawn_blocking`。
2. 每个 client 只保留一个 active search，新搜索先取消旧搜索。
3. 结果按 chunk 发事件流；队列满时 `try_send` 触发降采样并发 `SearchBackpressureEvent`。

### 3.4 Terminal（PTY）

关键结构：

1. `TerminalService { sessions }`
2. `SessionHandle { owner_client_id, control }`
3. `TerminalOutputEvent { session_id, seq, chunk }`

线程模型：

1. `create` 时启动 PTY，并开 reader thread 持续读输出。
2. 输出事件优先 `try_send`；拥塞时写入 ring buffer，恢复后按序 flush。
3. `write/resize/kill` 走 `spawn_blocking`，避免阻塞 async runtime。

## 4. UI 侧必须配合的性能策略

1. 虚拟列表：文件树、搜索结果、终端面板历史都只渲染可见窗口。
2. 可见性订阅：隐藏 tab/窗口只保留摘要，暂停高频渲染。
3. 输出节流：search/terminal 事件先入 UI ring buffer，再 `requestAnimationFrame` 批量刷。
4. 大结果分页：list_dir 用 cursor，search 用 chunk，不回传大数组。
5. 增量渲染：按 chunk 追加，不做全量替换。

## 5. API 设计（消息类型）

### 5.1 请求

1. `Ping`
2. `ListDir(ListDirRequest)`
3. `SearchStart(SearchStartRequest)`
4. `SearchCancel(SearchCancelRequest)`
5. `TerminalCreate(TerminalCreateRequest)`
6. `TerminalWrite(TerminalWriteRequest)`
7. `TerminalResize(TerminalResizeRequest)`
8. `TerminalKill(TerminalKillRequest)`

### 5.2 响应

1. `ListDir(ListDirResponse)`
2. `SearchStarted / SearchCancelled`
3. `TerminalCreated / TerminalWritten / TerminalResized / TerminalKilled`

### 5.3 事件流

1. `SearchChunk`
2. `SearchBackpressure`
3. `SearchDone`
4. `SearchCancelled`
5. `TerminalOutput`
6. `TerminalState`

## 6. 关键性能策略落地

1. Lazy scanning：`list_dir` 只看当前目录 + 分页 cursor。
2. Warm pool：终端侧建议后续加“预热 PTY 池”（当前 skeleton 预留接口）。
3. Debounce/batch：watcher（后续模块）应按 50~200ms 批处理。
4. Backpressure：socket writer 前有界通道；search/terminal 在拥塞时降采样或 ring 缓冲。
5. Ring buffer：已在 terminal 输出链路实现；search 通过 chunk 丢弃统计回传背压事件。

## 7. Skeleton 覆盖清单

已实现：

1. Rust daemon main：`crates/vb-daemon/src/main.rs`
2. protocol 定义：`crates/vb-daemon/src/protocol/message.rs`
3. search demo（stream + cancel + backpressure）：`crates/vb-daemon/src/search/service.rs`
4. list_dir demo（懒加载分页）：`crates/vb-daemon/src/fileio/service.rs`
5. terminal demo（PTY + streaming + ring buffer）：`crates/vb-daemon/src/terminal/service.rs`

## 8. 跨平台风险与解法

1. WebView 渲染瓶颈：
   - 风险：终端/搜索大流量导致前端重渲染风暴。
   - 解法：可见性订阅 + RAF 批量刷 + 虚拟化。
2. Windows ConPTY 差异：
   - 风险：ansi/tui 兼容性、编码行为与 Unix 不一致。
   - 解法：terminal provider 做平台层封装；Windows 保持单独回归用例。
3. mmap 兼容性：
   - 风险：超大文件 mmap 在网络盘/权限边界行为复杂。
   - 解法：默认 chunked read；mmap 仅在本地磁盘与阈值命中后启用。
4. IPC 传输选择：
   - 风险：localhost 在安全与复制开销上不如 UDS/NamedPipe。
   - 解法：生产版优先 UDS/NamedPipe，localhost 仅 fallback 或开发模式。
5. 200+ 终端会话：
   - 风险：线程/句柄资源上升。
   - 解法：会话配额、闲置降频、输出摘要模式、预热池与回收策略。

## 9. 本地运行

```bash
# 启动 daemon
VB_DAEMON_ADDR=127.0.0.1:7878 cargo run -p vb-daemon

# 仅检查与测试
cargo check -p vb-daemon
cargo test -p vb-daemon
```

> 当前 skeleton 使用 localhost TCP；下一步可替换为 UDS / NamedPipe 传输实现。
