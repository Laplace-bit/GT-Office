# GT Office Agent Runtime 与多 Agent 协同升级 PRD

> 状态：提案 | 优先级：P0-P2 分期交付 | 目标用户：同时运行多个 CLI Coding Agent 的个人开发者和小型工程团队
> 设计来源：对 Herdr 的产品与架构调研；本文只借鉴其产品机制，不复制其终端优先产品形态或实现结构。

## 问题陈述（Problem Statement）

GT Office 已经具备工作区受控的 PTY 终端、Station、多窗口工作台、会话恢复、Git、Change Feed、外部 Channel 和 gto Agent 通信。当前 Agent 的运行信息分散在 Station 卡片状态、终端进程探测、Provider 会话、渲染屏幕快照、任务线程和 Channel 事件中。

这会带来三个用户可感知的问题：

1. 用户能看到某个 Station “在线”或“运行”，却无法可靠判断 Agent 是在工作、等待输入、被权限确认阻塞、已完成未查看，还是处于无法判断的状态。
2. 应用重启、窗口切换或 Provider 恢复后，用户不知道恢复的是布局、终端、屏幕内容，还是 Agent 的原生会话；错误的恢复预期会损害信任。
3. gto、外部 Channel、终端和工作台各自拥有局部状态，自动化或 UI 很容易基于过时、低置信度的状态做出错误动作。

本升级的核心不是把 GT Office 改造成终端 multiplexer，而是让桌面工作台具备统一、可解释、可恢复、可自动化的 Agent Runtime 控制面。

## 产品目标

1. 让用户在一个工作区内一眼识别所有 Agent 的真实注意力状态，并优先处理被阻塞、等待输入、失败和完成未查看的工作。
2. 让每个 Agent 状态都能解释其来源、证据和时间，避免“看起来在跑”的模糊反馈。
3. 让 Provider 原生会话恢复、终端恢复、布局恢复和屏幕历史恢复有明确且不同的承诺。
4. 让 gto、外部 Channel 和未来的自动化客户端消费同一份 Agent Runtime Snapshot，而不是各自解析终端输出。
5. 保持 GT Office 的现有差异化：workspace_id 安全边界、桌面 UI、文件/Git 邻接、多窗口协作、外部 Channel 和 Apple-grade 控制台体验。

### 成功指标

| 指标 | 目标 |
|---|---|
| 状态可扫描性 | 用户在工作区工作台中无需打开每个终端，即可识别所有需要人处理的 Agent。 |
| 状态解释性 | 每个非静态 Agent 状态可显示来源、最后变更时间和简短证据；无法确定时明确显示 Unknown。 |
| 状态延迟 | 已接收的结构化状态在 200 ms 内反映到活动工作台；高频终端输出不得造成可见卡顿。 |
| 恢复诚实性 | 恢复界面明确标出进程存活、布局恢复、原生会话恢复和仅恢复终端快照之间的差异。 |
| 安全性 | 屏幕推断不能自动提交输入或批准风险操作；持久化原始屏幕历史默认关闭。 |
| 自动化一致性 | gto、Channel 和工作台查询同一 Agent Runtime Snapshot，且每个结果显式携带 workspace_id、agent_id、station_id 和 terminal session identity。 |

## 解决方案（Solution）

建立一个由任务域拥有的 Agent Runtime Contract。终端、Provider 集成、gto、Channel 和恢复逻辑只向该契约报告 Observation；工作台、通知、任务分发和自动化客户端只读取其归并后的 Runtime Snapshot。

单一跨层接缝为 Agent Runtime Contract：

| 输入方 | 输入内容 | 输出方 |
|---|---|---|
| 终端与进程探测 | PTY 存活、前台进程、渲染屏幕快照 | Runtime Snapshot |
| Provider 集成 | 生命周期事件、原生会话引用、显示元数据 | Runtime Snapshot |
| gto 与本地 bridge | 任务状态、Agent 报告、等待请求 | Runtime Snapshot 与 Runtime Event |
| Channel | 外部任务、回复、人工确认结果 | Runtime Snapshot 与 Attention Event |
| 恢复流程 | 终端重新绑定、原生会话恢复结果 | Runtime Snapshot |
| 工作台与通知 | 状态、注意力、解释信息 | 只读 Projection |

该接缝不替换现有 Station、Terminal Session 或 Task Thread。它负责把它们之间的运行事实组织成一致的 Agent Runtime 视图。

## 领域模型

| 术语 | 定义 | 生命周期与归属 |
|---|---|---|
| Workspace | 文件、终端、Git 和权限操作的根安全边界。 | 已有概念；所有 Runtime 操作必须携带 workspace_id。 |
| Station | 用户在工作台上配置的角色与终端承载位。 | 已有概念；可以没有活跃 Agent。 |
| Terminal Session | 承载 shell 或 CLI Agent 的真实 PTY 会话。 | 已有概念；负责传输，不等价于 Agent。 |
| Agent Runtime | 由一个 Agent、Station、Terminal Session 和 Provider 关联形成的活跃运行实体。 | 新的统一运行时 Projection。 |
| Runtime Observation | 某个来源对 Agent Runtime 的一次事实报告。 | 追加式或可过期；不直接驱动 UI。 |
| Runtime Snapshot | 对 Observation 做来源优先级、顺序和有效期归并后的当前视图。 | Agent Runtime Contract 的唯一读取模型。 |
| Lifecycle State | Agent 的语义工作状态。 | 见下表；与进程在线状态分离。 |
| Status Authority | 允许对 Lifecycle State 产生权威影响的来源。 | Provider Hook、结构化事件、人工确认、屏幕推断、进程观察和恢复。 |
| Attention State | 面向用户排序与提醒的派生状态。 | 由 Lifecycle State、已查看状态和任务关联生成。 |
| Native Session Reference | Provider 自己提供的可恢复会话 ID 或路径。 | 不等同于 PTY 或屏幕历史。 |

### Lifecycle State

| 状态 | 语义 | 是否可由屏幕推断单独确认 |
|---|---|---|
| idle | Agent 已连接但当前没有可确认的工作。 | 可以，但低置信度。 |
| launching | 正在启动 Provider 或恢复会话。 | 不适用。 |
| working | Provider 或可靠证据表明 Agent 正在执行工作。 | 可以，低置信度。 |
| waiting | Agent 正在等待普通输入或下一步任务。 | 可以，低置信度。 |
| blocked | Agent 显式要求权限、确认、关键决策或无法继续的输入。 | 仅可作为“疑似阻塞”；不得自动批准。 |
| completed | 当前工作完成，且尚未由用户查看或确认。 | 可以作为候选状态，需标明来源。 |
| failed | 启动、会话、Provider 或运行过程已明确失败。 | 不适用。 |
| recovering | 正在重新绑定终端或恢复原生 Provider 会话。 | 不适用。 |
| stopped | 关联的 Terminal Session 或 Agent 进程已经结束。 | 可以由进程观察确认。 |
| unknown | 已有 Agent 但没有足以给出其他结论的可靠证据。 | 默认安全回退。 |

Lifecycle State 不表示传输连通性。Snapshot 还必须独立给出 online、terminal_alive 和 provider_session_available，以避免把“连接着”误读为“正在工作”。

### Status Authority 与优先级

1. Provider 官方生命周期 Hook 或协议事件。
2. GT Office 结构化运行时事件与经用户确认的人工操作。
3. Provider 原生会话恢复结果与终端进程观察。
4. 经版本化规则解析出的渲染屏幕快照。
5. 无证据时的 Unknown。

每个 Observation 必须包含 source、authority_kind、sequence、observed_at、confidence 和可供诊断的受限 evidence。低优先级来源不能覆盖仍有效的高优先级来源；同一来源的过期 sequence 只能被记录为忽略，不得倒退 Snapshot。

## 用户故事（User Stories）

1. 作为同时管理多个 Agent 的开发者，我希望在工作台上看到每个 Station 的真实工作状态，以便不必逐个打开终端确认。
2. 作为开发者，我希望被权限确认或问题阻塞的 Agent 始终排在最前面，以便及时处理真正需要我决策的事项。
3. 作为开发者，我希望区分“Agent 在工作”“Agent 等我输入”“Agent 已完成但我尚未查看”和“系统无法判断”，以便合理安排注意力。
4. 作为开发者，我希望点击状态后看到状态来源、最后变更时间和证据摘要，以便判断其可信度。
5. 作为开发者，我希望屏幕文字误判不会导致 GT Office 自动发送确认或执行危险操作，以便保留人工控制权。
6. 作为 Codex 或 Claude Code 用户，我希望应用重启后知道原生会话是否真的恢复，以便决定继续、重新启动或查看历史。
7. 作为开发者，我希望恢复界面分别说明布局、PTY、原生 Provider 会话和屏幕历史的恢复结果，以便不误以为进程仍在运行。
8. 作为多窗口用户，我希望同一 Agent Runtime 在主窗口和 Detached Window 中显示一致，以便避免重复或相互矛盾的状态。
9. 作为使用 gto 的 Agent，我希望能查询和等待指定 Agent Runtime 的语义状态，以便在协作流程中避免轮询终端文本。
10. 作为任务发起者，我希望等待绑定到启动时的 Runtime identity，以便替换或重启后的同名 Agent 不会错误满足旧等待。
11. 作为外部 Channel 使用者，我希望收到的是语义化的 blocked、completed 或 failed 事件，而不是未经验证的终端片段。
12. 作为 Provider 集成维护者，我希望只上报自己真正可靠的能力，以便不会把不完整 Hook 伪装成全生命周期权威。
13. 作为支持工程师，我希望执行 Runtime Explain 并得到规则版本、匹配结果和回退原因，以便诊断错误状态。
14. 作为注重隐私的用户，我希望原始屏幕历史默认不持久化，并能单独清除历史，以便避免把 token 或敏感输出写入磁盘。
15. 作为并行实现任务的开发者，我希望在确认后为任务创建隔离的 Git worktree，以便不同 Agent 不会在同一工作目录互相覆盖。
16. 作为任务发起者，我希望 worktree 创建、分支、基线和清理都可预览、确认和审计，以便避免隐式文件或 Git 破坏。
17. 作为扩展作者，我希望未来可通过声明式 manifest 接收受控事件和上下文，以便扩展工作流而不侵入核心状态模型。
18. 作为管理员或安全敏感用户，我希望远程规则、插件和集成配置变更遵循 preview、validate、confirm、apply、audit，以便控制供应链风险。
19. 作为首次使用者，我希望在 Quick Start 中理解“Station、Terminal Session、Agent Runtime、Task”的区别，以便正确使用多 Agent 工作台。
20. 作为性能敏感用户，我希望持续终端输出不会让状态卡片闪烁或输入变慢，以便控制台保持原生应用般的响应。

## 功能需求

### R1. Agent Runtime Contract

1. 系统必须以 workspace_id 与 agent_id 作为 Runtime 的逻辑唯一键，同时保留 station_id、terminal_session_id 和可选 native_session_reference。
2. Runtime Snapshot 必须提供 lifecycle_state、availability、authority、confidence、sequence、changed_at、last_seen_at、attention_state、provider、resolved_cwd 和诊断摘要。
3. Runtime Observation 必须记录来源和过期/忽略原因，但 UI 默认只读取 Snapshot。
4. Station 可以存在而不绑定活跃 Runtime；Terminal Session 可以承载普通 shell 而不成为 Agent Runtime。
5. Runtime 解绑不得删除 Task Thread、审计记录或可恢复的原生会话引用；仅清除依赖该活跃 Runtime 的临时投递路径。
6. 所有 Runtime 读取、写入和事件必须显式携带 workspace_id，拒绝跨工作区关联。

### R2. 运行时状态报告与归并

1. 新增运行时报告能力，允许 Provider 集成、终端观察器、gto 和恢复服务提交 Observation。
2. 报告必须支持单调 sequence；同来源较旧的报告被安全忽略并可在 Explain 中查看。
3. Provider 集成可分别报告生命周期、原生会话引用和显示元数据，三者不得被强制捆绑。
4. 屏幕推断只能产生低置信度 Observation；当其识别到可能的确认 UI 时，UI 显示“需要检查”或“疑似阻塞”，但不会自动输入、批准或发送敏感数据。
5. 进程退出必须将活跃 Runtime 置为 stopped 或 failed，并保留最后已知状态和诊断信息供用户查看。
6. Snapshot 变更必须产生有序、workspace-scoped 的事件，供工作台、Detached Window、gto 和 Channel 消费。

### R3. Attention Projection 与工作台体验

1. 工作台必须将 Runtime 的语义状态投影为稳定、可扫描的 Station 标记，不直接展示来源的原始字符串。
2. 默认注意力排序必须为 blocked、waiting、failed、completed 未查看、recovering、working、idle、unknown、stopped；用户可按 Station 顺序切换。
3. completed 必须在用户打开关联 Station、查看完成摘要或明确确认后转为已查看，不应因后台轮询而自动消失。
4. 状态变化应在不干扰终端输入的情况下以轻量视觉和可选原生通知呈现；reduced-motion 下不得依赖动画传达语义。
5. 详情面板必须展示 Runtime Explain：当前状态、状态来源、置信度、最后变更时间、原生会话可恢复性和推荐下一步。
6. 同一个 Runtime 在所有窗口中必须使用同一 Snapshot；窗口专属的焦点、展开和已读视图状态可独立存在。

### R4. 恢复语义与隐私

1. 恢复 UI 必须将结果归类为：Live Reattach、Layout Restore、Terminal Recreate、Native Provider Resume、Screen History Replay 或 Restore Failed。
2. Live Reattach 只在原 PTY 和进程仍可确认存活时使用；不能把新建 shell 伪装为 reattach。
3. Native Provider Resume 只基于已验证的 Provider 原生会话引用，且必须显示 Provider、会话标识摘要和恢复结果。
4. Screen History Replay 必须是显式 opt-in；默认不把原始终端屏幕内容作为新的持久化 Runtime 状态。
5. 用户必须能从恢复结果进入对应 Station、重新启动、查看诊断或清除本地历史。
6. 恢复失败不得破坏已有 workspace、Station、Task Thread 或 Git 上下文。

### R5. gto 与本地自动化控制面

1. gto 必须能读取工作区内 Agent Runtime Snapshot，并按 Runtime identity 查询指定 Agent。
2. gto 必须支持一个 server-owned 的等待操作：等待目标 Runtime 到达一个或多个语义状态，支持 timeout 和取消。
3. 等待操作必须绑定开始等待时的 terminal_session_id 与 Runtime revision；后来同名或同 Station 的替代 Agent 不得满足旧等待。
4. 将“发送 prompt 并等待稳定状态”定义为单个原子操作，避免发送成功后才开始等待所产生的竞态。
5. 本地 bridge 必须提供 Bootstrap Snapshot 与增量事件订阅；重连客户端先获取 Snapshot，再消费事件。
6. 自动化 API 的响应、错误和事件模式必须与现有 ResultEnvelope、traceId、workspace_id 和稳定错误码原则一致。

### R6. Provider 集成与可解释检测

1. 每个 Provider Adapter 必须声明其支持的能力：process discovery、lifecycle reporting、native session reference、display metadata、resume 和交互控制。
2. Provider 仅能对其可靠覆盖的状态成为 Authority；不完整 Hook 只能提供辅助元数据或会话引用。
3. 终端屏幕规则必须版本化、可测试、可本地覆盖，并能以 Explain 输出匹配规则、证据区域、回退原因和规则版本。
4. 第一阶段仅支持本地或随应用发布的规则；未来远程规则更新必须签名，并遵循 preview、validate、confirm、apply、audit。
5. 工具或 Provider 升级导致规则不匹配时，系统回退到 unknown 或低置信度状态，不得伪造 completed 或 blocked。

### R7. 任务隔离 Worktree

1. 在实现型任务派发时，用户可选择预览并创建隔离 Git worktree；此能力不作为普通 Station 的隐式默认行为。
2. 预览必须展示源工作区、基线分支/提交、目标路径、分支名、目标 Agent 和预计操作。
3. 创建成功后，系统为该 worktree 打开或关联一个新的 Workspace，并将任务、Station、Agent Runtime 与该 workspace_id 绑定。
4. 任何删除 worktree、分支或未提交内容的操作必须单独确认并写入审计记录。
5. 任务完成不自动删除 worktree；用户明确选择清理后才执行。

### R8. 受控扩展机制

1. 插件市场、第三方自动安装和任意远程代码执行不属于初始范围。
2. 后续扩展机制使用声明式 manifest，声明动作、订阅事件、所需上下文、支持平台和最小宿主版本。
3. 插件命令使用 argv，不经 shell 拼接；运行时上下文只提供最小必要的 workspace、task、station 和 runtime 标识。
4. 插件配置、状态和日志必须分离存放；敏感凭据使用系统凭据存储。
5. 安装、升级、启用和权限扩大必须预览、验证、确认、应用和审计。

## 交互与视觉要求

1. Agent Runtime 是工作台和控制台的辅助控制面，不引入终端 multiplexer 风格的全屏 TUI 或 tmux 快捷键体系。
2. 采用现有 Apple-grade CLI Agent Console 原则：紧凑、键盘优先、系统字体、低装饰、清晰焦点和稳定状态。
3. 状态标识必须使用文本、图标、颜色和可访问名称共同表达，不能只依赖颜色或动画。
4. 工作台不应持续轮询终端；终端输出、Runtime Event 和状态卡片更新需批处理或合并，避免进入 React 热循环。
5. Explain、恢复结果和风险操作使用原生感的临时面板或对话框，不嵌套卡片或制造仪表盘式噪音。

## 实现决策（Implementation Decisions）

### 模块边界

1. gt-task 继续作为 Agent Runtime Contract 的领域所有者，扩展现有 AgentRuntimeRegistration 为兼容的 Runtime Snapshot 和 Observation 模型。
2. task-center 命令层只校验请求、调用领域服务、发射事件和转换错误；不在 Tauri command 中实现归并、优先级或恢复业务逻辑。
3. terminal feature 负责从 PTY、进程信息和 xterm 渲染快照产生 Observation；它不决定最终 Lifecycle State。
4. gt-agent-session 负责 Provider 原生会话引用、恢复能力验证和恢复结果；它不拥有全局 Attention 排序。
5. workspace-hub 负责投影、排序、已查看状态和用户交互；不得自行合并原始状态字符串。
6. local bridge 和 gto 消费领域服务提供的 Snapshot/Event，而不是直接读取前端状态或解析终端日志。
7. tool-adapter 和 Channel 只接收语义状态与经过策略允许的摘要；不接收未经审计的原始屏幕输出作为控制依据。

### 契约形状

1. 新的 Runtime Snapshot 必须与现有注册请求向后兼容，旧客户端只需继续提供 workspace、agent、station、terminal session、tool kind 和 online。
2. 新 Observation 接口必须允许 provider_session 作为独立字段，以支持“可恢复但无法可靠推断 lifecycle”的 Provider。
3. Snapshot 和事件必须带 revision；消费者只接受同一 Runtime identity 下单调递增的 revision。
4. Runtime Explain 返回只读诊断数据，默认不含完整原始终端内容；原始证据仅在本地开发诊断且明确授权时可见。
5. Attention State 是派生 Projection，不持久化为 Provider 事实；已查看状态可作为用户级视图状态持久化。
6. Runtime 状态与 Task Thread 状态保持关联但不互相覆盖。任务可 completed，而 Agent 仍 working；Agent 可 blocked，而任务仍 in_progress。

### 数据与安全

1. 原生会话 ID、路径和证据摘要按最小化原则存储；UI 不完整显示可能包含敏感信息的值。
2. 不新增默认的全量 PTY 历史持久化。现有 session log 的权限、清理和脱敏策略保持独立并需在后续审计。
3. 所有工作区路径继续由 gt-security 验证；自定义 cwd、worktree 目标和恢复路径不得逃离用户确认的工作区/仓库边界。
4. Runtime 自动化对 blocked、unknown、screen-inferred 状态默认只读；任何输入、审批、删除或 Git 写操作保留现有风险确认。
5. 不引入新依赖作为第一阶段前提；需要新依赖时先更新依赖策略文档并完成规定验证。

## 交付阶段

### Phase 1：统一状态与注意力（P0）

1. 落地 Runtime Snapshot、Observation、Authority、revision 和 Explain 的领域模型。
2. 将现有运行时注册、终端进程观察、Provider Session 绑定和 Station 状态迁移到 Snapshot。
3. 增加 workspace-scoped Runtime Change Event。
4. 工作台使用 Attention Projection 展示 blocked、waiting、failed、completed 未查看和 unknown。
5. 完成现有 Station 状态的兼容映射，避免一次性破坏 launch、terminal 和 task dispatch 流程。

### Phase 2：恢复与 Provider 集成（P1）

1. 增加恢复结果分类与恢复摘要 UI。
2. 对 Codex 和 Claude Code 建立独立的能力声明、原生会话引用和 Explain 证据。
3. 添加版本化的本地屏幕检测规则以及低置信度回退。
4. 让 Detached Window、外部 Channel 和任务中心消费同一 Runtime Snapshot。

### Phase 3：gto 自动化与隔离工作区（P1）

1. 为 gto 增加 Snapshot、事件订阅、身份绑定等待和原子 prompt-plus-wait。
2. 实现预览、确认、审计的任务级 Git worktree 创建、打开和手动清理。
3. 为新用户补充 Quick Start、Agent Skill 和恢复语义说明。

### Phase 4：受控扩展（P2）

1. 定义 manifest、能力授予、动作、事件和插件日志契约。
2. 在没有远程市场的前提下先支持本地开发扩展。
3. 完成安全评审后再评估签名远程规则和插件分发。

## 验收标准

1. 用户在一个包含至少四个活跃 Station 的工作区中，能在工作台上区分 working、waiting、blocked、completed 未查看和 unknown。
2. 点击任一状态可查看 Explain，至少包含 authority、confidence、最后变更时间和状态变更原因。
3. Provider Hook、进程观察和屏幕规则发生冲突时，Snapshot 按指定优先级稳定归并，且 Explain 可展示被忽略的低优先级 Observation。
4. 同来源乱序事件不能使 Lifecycle State 或 revision 倒退。
5. Agent 替换后，旧 gto wait 不会因新 Agent 达到相同状态而错误成功。
6. 应用重启后，恢复界面准确显示每个 Station 的恢复类型；没有存活 PTY 时不会显示 Live Reattach。
7. 默认配置下，新增 Runtime 功能不会持久化完整终端屏幕内容。
8. 所有新的 Runtime 命令和事件在 workspace_id 缺失、Station/Terminal 交叉工作区或路径越界时被拒绝。
9. 高吞吐终端输出期间，Station 状态不会高频闪烁，且终端输入保持符合 Apple-grade 控制台性能目标。
10. Worktree 的创建和清理都要求可见预览、显式确认和审计记录。

## 测试决策（Testing Decisions）

1. 优先在最高可测试接缝验证行为：以 gt-task 的 Runtime Contract 为主测试点，验证 Observation 归并、状态优先级、revision、过期、解绑和 Attention Projection。
2. 在 Tauri command 层验证请求校验、workspace_id 绑定、稳定错误码、事件负载和向后兼容的注册响应，不测试命令内部实现细节。
3. 在前端模型层验证状态映射、排序、已查看行为和 Explain 展示条件；组件测试只覆盖用户可见标签、可访问名称和键盘导航。
4. 在终端集成层使用模拟 PTY、模拟渲染屏幕快照和模拟 Provider Hook 验证低置信度推断不会驱动自动输入。
5. 在 gto/local bridge 集成测试中验证 Snapshot 后订阅、重连、取消、超时、Runtime 替换和原子 prompt-plus-wait。
6. 在恢复集成测试中分别覆盖 Live Reattach、Layout Restore、Native Provider Resume、Screen History Disabled 和 Restore Failed。
7. Worktree 测试使用临时 Git 仓库，验证预览、确认门槛、绑定、清理拒绝和 workspace 安全边界。
8. 复用当前 gt-task 的 runtime 注册与任务分发测试模式、Tauri command 测试模式以及终端渲染快照测试；新增测试只断言外部契约和可见行为。
9. 所有实现阶段至少执行对应的 focused tests、npm run typecheck、cargo check --workspace；触及 Tauri 集成时执行 npm run build:tauri。

## 非目标（Out of Scope）

1. 不把 GT Office 重写为终端 TUI、tmux 替代品或 SSH-first multiplexer。
2. 不在第一阶段引入完整插件市场、第三方自动安装、远程任意代码执行或无确认的插件构建。
3. 不自动批准 Agent 的权限请求、Git 写操作、文件删除、外部消息发送或其他高风险动作。
4. 不把屏幕抓取作为 Provider 的唯一状态真相，也不承诺从 alternate screen 重建完整 Agent 历史。
5. 不自动创建或自动删除 Git worktree；所有会改变仓库结构的操作均需预览和确认。
6. 不改变现有 workspace_id 安全边界，不允许 Agent Runtime 跨工作区共享 Terminal Session。
7. 不以增加大量卡片、动画或仪表盘为代价牺牲 Apple-grade 控制台的紧凑、安静和键盘优先体验。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Provider UI 变化导致屏幕检测失效 | 规则版本化、Explain、Unknown 安全回退、本地覆盖和契约测试。 |
| 多个来源竞争导致状态闪烁 | Authority 优先级、sequence、revision、有效期和事件合并。 |
| 原始终端内容泄露 | 默认不新增持久化、最小化证据、显式 opt-in、清除能力和系统凭据存储。 |
| 自动化等待被 Runtime 替换错误满足 | 绑定 terminal session identity 与 Runtime revision，服务端持有等待。 |
| Worktree 扩大 Git 风险 | Preview、Confirm、Audit、显式清理和临时仓库集成测试。 |
| 终端输出拖慢工作台 | 领域事件与终端字节流分离，批量投影，避免 React 热路径。 |
| 远程规则或插件形成供应链风险 | 初期本地优先；未来使用签名、版本固定和 preview-validate-confirm-apply-audit。 |

## 进一步说明（Further Notes）

1. Herdr 的可借鉴点是明确区分布局、原始终端和识别出的 Agent，并将语义状态、会话恢复、事件订阅和解释工具视为同一控制面的一部分。参考其 [Agent Automation](https://herdr.dev/docs/agent-automation/)、[Session State](https://herdr.dev/docs/session-state/)、[Agents](https://herdr.dev/docs/agents/)、[Socket API](https://herdr.dev/docs/socket-api/) 和 [Plugins](https://herdr.dev/docs/plugins/) 文档。
2. GT Office 当前的优势必须保留：Workspace 是安全边界，而不是终端分组；Station 是工作台组织模型，而不是强制的 pane；gto 是协作协议，而不是仅仅的命令行快捷方式。
3. 本 PRD 不授权复制第三方品牌、文案、图片或 UI。若未来复用 Apache-2.0 源码，必须保留适用的许可证、版权声明和 NOTICE。
4. 本文提出的单一接缝已经基于当前 Agent Runtime 注册、Session Resume Bind、Station 状态和渲染屏幕快照能力设计，实施前应先将 Phase 1 拆为独立的可验证任务。
