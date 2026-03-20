# 原生 TUI 渲染屏幕提取设计（Native TUI Rendered Screen Extraction）

## 1. 背景与目标

### 1.1 核心矛盾
在集成 CLI Agent（如 `claude-code`、`codex`、`gemini-cli`）时，系统需要同时满足两件事：

1. **保持当前 live terminal session 原生执行**：来自 Channel 的消息必须直接进入当前命令行会话执行，不能额外启动第二个 headless Agent 进程替代当前会话。
2. **将真正的响应正文回传给 Channel**：回传内容应尽可能排除 `thinking`、`working`、`tool/status`、placeholder、prompt、spinner 等非正文噪音。

当前基于 PTY chunk/buffer 的解析方案存在天然缺陷：

- ANSI 控制序列与重绘会污染文本流。
- 光标覆盖、局部刷新、alt-screen 会让 chunk 拼接失真。
- 同一段输出中会混入状态区、工具区、输入回显与正文区。
- 当无法明确识别正文块时，回退整段文本会产生明显误报。

因此本方案不再把 **原始 PTY buffer/chunk** 作为正文提取事实源，而是改为基于 **用户已经看到的、xterm 已解释并维护在 screen model 中的最近 TUI 界面** 做屏幕标准化与 diff 提取。

### 1.2 方案定位
本文件定义 GT Office 当前阶段的正式主方案：

- **保持 live terminal session 为唯一执行载体**。
- **不引入协议拦截、代理转发、虚拟 API Key、MITM、额外 headless runner**。
- **preview / 交互态 / finalize 边界仍基于 xterm rendered-screen / screen model**。
- **最终正文允许引入 provider session log 作为高置信主源**，当前 v1 支持 Claude/Codex；不支持的 provider 继续回退到 rendered-screen / VT 文本。

该方案的目标是：

- 在不破坏当前终端语义的前提下，尽可能高精度地提取最近已经响应的正文；
- 以“准确率优先”为原则，宁可静默，也不误发整屏状态文本。

### 1.3 不追求的目标
本方案不是语义真源方案，不承诺：

- 跨所有 CLI/TUI 版本 100% 稳定。
- 从表现层无损恢复上游 Agent 的全部语义事件。
- 任意布局改版后仍零成本保持正确。

---

## 2. 架构总览

### 2.1 总体链路
```text
[ Channel Message ]
      |
      v
[ 当前 Station 绑定的 live terminal session ]
      |
      | 1. 正常执行并在 xterm 中原生显示
      v
[ xterm rendered TUI ] ----> [ provider session log ]
      |                               |
      | 2. 采集已渲染 screen snapshot      | 3. 绑定并轮询 Claude/Codex session log
      v                               v
[ Screen Normalizer ]             [ Session Log Reader ]
      |                               |
      | 4. diff / prompt / finalize    | 5. high-confidence final body
      v                               |
[ Candidate Block Extractor ] <--------
      |
      | 6. source selection / fallback
      v
[ Channel Relay ]
```

### 2.2 核心原则
1. **执行与提取分离**：消息执行仍通过当前终端进行，正文提取只读取渲染结果。
2. **双源但单控制面**：live terminal 负责执行与交互态；session log 只作为最终正文辅助源，不驱动执行。
3. **渲染结果优先于原始 buffer**：不再依赖 PTY chunk 拼接来决定外发内容。
4. **标准化后再 diff**：直接读取 `xterm.buffer.active` 的屏幕行与光标状态，不对零散 DOM 节点、`innerText`、原始 xterm class 做业务判断。
5. **低置信静默**：没有明确正文块时，不允许回退整屏文本。
6. **provider session 显式绑定优先**：若 runtime 已知 `providerSessionId/logPath`，解析器必须优先使用，不得退回“同 cwd 最新文件”猜测。
7. **重 I/O 不阻塞前端**：session log 的扫描、读取、重绑只能在后台 worker / blocking 段执行。

---

## 3. 屏幕模型与提取机制

### 3.1 渲染屏幕标准化模型
前端必须先将当前 xterm 已渲染界面归一化为稳定结构 `RenderedScreenSnapshot`，再参与后续 diff 与正文判定。这里的“已渲染界面”指 `xterm.buffer.active` 中已经解释完成的屏幕状态，而不是 DOM 文本树。

建议最小字段：

```ts
interface RenderedScreenSnapshot {
  sessionId: string
  screenRevision: number
  capturedAtMs: number
  viewportTop: number
  viewportHeight: number
  baseY: number
  cursorRow: number | null
  cursorCol: number | null
  rows: Array<{
    rowIndex: number
    text: string
    trimmedText: string
    isBlank: boolean
  }>
}
```

说明：

- `screenRevision`：每次采样递增，用于建立稳定 diff 序列。
- `rows`：表示当前可视区域中用户实际看到的文本行，而不是 PTY 原始输出行。
- `trimmedText`：用于做噪音判断、区域分类和去重。
- `cursorRow/cursorCol`：用于识别输入区、placeholder 覆盖、尾部重绘。
- `viewportTop/baseY`：来自 `terminal.buffer.active`，用于识别滚动、尾部状态区与当前可视窗口。

### 3.2 采样入口
采样入口是 **xterm 已解释完成的屏幕模型**，而不是 PTY buffer，也不是 DOM。

采样可由以下时机触发：

1. 收到新的 terminal output 事件后，下一帧采样一次。
2. Channel reply 绑定激活期间，按固定节流窗口采样。
3. 检测到终端界面稳定一段时间后，执行 finalize 判定。

要求：

- 采样频率必须节流，避免对每个微小 repaint 都立即计算业务 diff。
- 同一会话要保证快照顺序单调，不得并发乱序应用。
- 默认从 `terminal.buffer.active.getLine(...)` 逐行读取文本；只有调试观测时才允许读取 DOM。

### 3.3 区域过滤（Layout Filtering）
正文提取前，必须先对屏幕行做区域级排除。

优先排除的区域：

1. 明显的 prompt / 输入区。
2. 底部状态栏、footer、mode line。
3. 工具执行区、命令回显区、权限确认区。
4. spinner / progress / loading 行。
5. 边框、分隔符、装饰性空白块。

最低要求：

- 不允许把当前输入框、prompt 提示、命令回显当作 assistant 正文候选。
- 对反复变化的底部尾区默认降权处理。

### 3.4 Diff 机制
对连续两个 `RenderedScreenSnapshot` 做差异分析时，不关心 DOM 节点变化，而只关心标准化后“屏幕上新增或被替换的文本块”。

Diff 输出至少区分三类变化：

1. **Append Block**：正文以追加形式出现在后续行中。
2. **Replace Block**：原有 placeholder / loading / 半成品文本被正式内容覆盖。
3. **Redraw Block**：布局刷新或局部重绘，但语义上不应外发。

正文提取只允许从 `Append Block` 和高置信 `Replace Block` 中产生候选内容。

### 3.5 候选正文块提取
Candidate Block Extractor 的职责是从 diff 结果中找出“可能是最新响应正文”的块。

必须满足以下条件中的大部分：

1. 出现在主内容区，而非 footer / prompt / input 区。
2. 不是明显状态文本模式。
3. 不是短时闪现后立刻被覆盖的 placeholder。
4. 与上一轮已发送正文相比存在实质新增，而不是重绘重复。
5. 文本形态符合自然语言正文，而不是命令、token/cost、工具日志或单纯状态标签。

文档默认正文候选的粒度为：

- **块级（block-level）**，不是逐字符或逐 span 的 DOM 增量。
- 优先按“新增的连续非空文本行块”聚合。

---

## 4. 正文判定、流式发送与失败策略

### 4.1 噪音抑制规则
必须显式抑制以下类型内容：

- `thinking`
- `working`
- `running command`
- `tool use`
- `status/progress`
- placeholder
- 输入回显
- prompt 及其回归文本
- spinner 碎片
- token/cost/model 状态行

规则基于“屏幕文本模式 + 区域位置 + 稳定性”联合判断，而不是只靠字符串黑名单。

### 4.2 稳定窗口（Stability Window）
任何候选正文块都必须经过稳定窗口确认，避免把瞬时重绘文本误发到 Channel。

默认策略：

1. 候选块首次出现时，只进入待确认状态。
2. 若在连续 N 个采样周期中保持稳定或仅发生正文追加，则允许作为 preview 输出。
3. 若候选块在稳定前被覆盖、消失或转化为状态区，则直接丢弃。

### 4.3 Preview 与 Finalize 规则
正文外发分为 `preview` 和 `finalize` 两类。

`preview` 触发条件：

1. 已识别到高置信正文块。
2. 正文块通过稳定窗口。
3. 与上次已发内容相比存在可见新增。

`finalize` 触发条件：

1. 当前正文块已稳定且在一段时间内未继续追加。
2. 当前屏幕已进入下一轮 prompt / idle 状态，且不会再回写该正文块。
3. 已存在至少一个高置信正文块。

禁止行为：

- 提取不到正文块时回退整屏文本。
- 仅因为会话 idle 就把最后一屏状态文本 finalize。

### 4.4 置信度策略
默认采用两档置信度：

- `high`：可进入 preview/finalize。
- `low`：只记录，不外发。

默认原则：

- **准确率 > 召回率**
- **低置信不发**
- **模糊边界静默**

### 4.5 失败与降级
当 rendered-screen 解析失败或 session log 不可用时：

1. 不影响当前 terminal 的正常执行与显示。
2. 若 provider session log 已给出最终正文，则允许直接使用 session log 完成 finalize。
3. 若 session log 不可用，则回退到 rendered-screen，再回退到 VT 文本。
4. 允许记录调试样本，但不允许发送原始整屏作为兜底。

### 4.6 Provider Session Binding
Codex v1 必须支持 provider-specific session 绑定元数据：

- `providerSessionId`
- `logPath`
- `sessionStartedAtMs`
- `discoveryConfidence`

Codex 发现优先级：

1. 显式 `logPath`
2. 显式 `providerSessionId`
3. 同 `cwd` 且落在 reply bind 时间窗附近的 session
4. 同 `cwd` 且命中当前 prompt anchor 的 session
5. 同 `cwd` 最新活跃 session

Codex transcript 规则：

- assistant commentary 允许进入 transcript
- developer/user/function-call-output 不进入 channel 正文
- finalize 只发送相对最近 preview 的新增尾段；若无新增，则不重复发送

---

## 5. 实施步骤

### Phase 1：Screen Snapshot 采集
1. 在前端建立“已渲染屏幕快照”采集能力。
2. 为每个 terminal session 维护有序 `screenRevision`。
3. 保证采样节流，不对每个微小刷新都立即做业务计算。

### Phase 2：Screen Normalizer
1. 将 `xterm.buffer.active` 中的可视区行、光标位置、viewport/baseY 归一化为稳定的 `RenderedScreenSnapshot`。
2. 使用 `BufferLine.translateToString(...)` 生成每行文本，避免样式、DOM 嵌套、光标装饰干扰。
3. 输出统一的可 diff 行模型。

### Phase 3：Diff 引擎
1. 实现 snapshot 级别的 append / replace / redraw 分类。
2. 为主内容区和尾部状态区建立不同的 diff 权重。
3. 支持 placeholder 覆盖与局部重绘识别。

### Phase 4：正文候选提取与置信度判定
1. 建立区域过滤、噪音抑制、稳定窗口与去重逻辑。
2. 只对高置信正文块触发 preview / finalize。
3. 明确“不发优于误发”的默认行为。

### Phase 5：Channel Relay 接入
1. 将当前 Channel reply 链路接到“rendered-screen preview + session-log finalize”双源选择器，而不是 PTY chunk 文本。
2. 保持“消息进入当前 live terminal session 执行”的主链路不变。
3. Telegram 交互 prompt 需支持 `gto:<text>` 与 `gto-key:*` 两类 callback，均回写同一 session。
4. 补齐调试采样与误判样本记录能力，便于后续规则收敛。

---

## 6. 边界与已知风险

### 6.1 边界
本方案只处理：

- 当前 GT Office 自己展示的 virtual terminal / xterm 界面。
- 基于“用户已看到的最近屏幕”进行正文提取。

本方案不处理：

- 上游 Agent 协议级语义拦截。
- 额外 headless CLI 会话。
- 外部独立终端窗口的附着式解析。

### 6.2 风险
1. xterm 渲染实现变化可能影响快照稳定性。
2. 不同 Agent 的 TUI 布局差异会增加规则复杂度。
3. 大段局部重绘、折叠展开、滚屏会提高误判成本。
4. 该方案仍属于表现层提取，不是语义真源。

### 6.3 默认处置策略
1. 无法确认正文时静默。
2. 误判风险高时不发 preview。
3. 不允许发送整屏 dump 作为兜底。
4. 主链路优先保证 terminal 正常执行，reply 提取失败不得反向影响命令执行。

---

## 7. 验收标准（DoD）
- [ ] 来自 Channel 的消息仍直接写入当前绑定的 live terminal session 执行。
- [ ] 不额外启动第二个 headless `claude/codex/gemini` 进程参与正文回传。
- [ ] reply 提取不再依赖 PTY 原始 chunk/buffer 作为主事实源。
- [ ] Claude/Codex 在 session log 可用时，final body 优先取 session log。
- [ ] rendered-screen 继续负责 interaction prompt、preview 与 finalize 边界。
- [ ] Telegram 方向键交互通过 `gto-key:*` 回写同一 live terminal session。
- [ ] 对明显 `thinking / working / tool / status / prompt / placeholder` 文本不误发到 Channel。
- [ ] 当正文置信度不足时，系统静默而不是发送整屏文本。
- [ ] 同时开启多个 terminal session 时，屏幕提取与 Channel 回传互不串线。

## 8. 最小验收用例

### 正常流
1. 用户通过 Telegram 向当前绑定 station 发送消息。
2. 消息进入当前 live terminal session 执行。
3. xterm 中出现多段流式正文追加，同时后端成功绑定 Claude/Codex session log。
4. 系统从 rendered screen diff 中提取 preview / interaction prompt，并从 session log 提取最终正文。
5. 最终只发送正文，不夹带 prompt、spinner、tool/status 行。

### 异常流
1. Agent 在终端中长时间显示 `thinking`、`working`、命令执行进度与 placeholder。
2. 屏幕发生多次局部重绘，但没有明确正文块。
3. 系统不向 Channel 发送任何正文。
4. 当前 live terminal session 仍保持正常执行和可见展示。
