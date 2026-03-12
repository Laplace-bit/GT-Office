# Feishu Connector 实现方案（T-172）

## 1. 文档目标

本方案用于指导 GT Office 实现“飞书连接配置功能”，目标是把当前仅有的飞书 webhook 入站骨架，补齐为可配置、可验证、可路由、可持续扩展的 connector 能力。

本方案重点覆盖：

1. 后端模块化目录设计，要求 `feishu/` 与现有 `telegram/` 同级。
2. 前端配置向导设计，要求用户在 GT Office 与飞书开放平台之间切换时有清晰指引。
3. 飞书开放平台侧的具体配置步骤。
4. 分阶段落地路径，优先做“配置闭环”，再做“能力补齐”。

> 2026-03-12 实现补充：
> 当前产品 UI 已进一步简化为“仅暴露 WebSocket”的单线接入流程。
> Webhook 相关能力仍保留在后端 connector 设计中作为后续扩展，但首次配置弹窗不再展示 Webhook 模式、Verification Token 或 callback URL 字段。
> 另一个必须明确的现实约束是：飞书开放平台只有在 GT Office 里的长连接已经在线时，才能保存“使用长连接接收事件”。
> 因此首次接入顺序应为“创建应用并拿到凭据 -> 回 GT Office 启动长连接 -> 回开放平台保存长连接订阅 -> 回 GT Office 完成 route/policy”。

## 2. 当前现状

### 2.1 已有能力

当前仓库已具备以下飞书相关基础：

1. `channel_adapter_runtime` 会生成临时 Feishu webhook URL。
2. Runtime 能处理飞书 `url_verification`。
3. Runtime 能把飞书事件 payload 解析成统一 `ExternalInboundMessage` 并进入现有外部通道派发链路。

这部分代码位于：

- `apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs`

### 2.2 当前缺口

当前真正缺的不是“飞书入站解析”，而是“飞书连接配置闭环”：

1. 没有 `connectors/feishu/` 目录，飞书协议逻辑散落在 runtime 中。
2. `channel_connector_account_upsert/list/health/webhook_sync` 只支持 Telegram。
3. `channel_adapter_status` 中 Feishu 是空壳，`accounts` 永远为空。
4. 前端 `ChannelWizard` 只对 Telegram 采集 token，没有 Feishu 的 `App ID/App Secret/Verification Token/Domain/Connection Mode` 表单。
5. 没有 Feishu 账号存储模型、健康检查、连接测试和官方平台配置指引。
6. 没有“推荐模式”概念，用户不知道该优先走 WebSocket 还是 Webhook。

## 3. 参考 OpenClaw 的关键结论

OpenClaw 的飞书能力可以抽象成五条可直接借鉴的设计原则：

1. 飞书是独立 connector，而不是一段临时 webhook 逻辑。
2. 账号配置与路由绑定解耦。
3. 默认优先 WebSocket，Webhook 作为高级模式。
4. onboarding 阶段直接做连接测试，而不是只保存配置。
5. 账号模型支持 `defaultAccount + accounts.<id>`，方便后续多 bot 扩展。

对 GT Office 最有价值的不是“照抄 UI”，而是照抄这套分层方式。

## 4. 设计原则

### 4.1 模块边界

1. 协议/账号/健康检查/启动逻辑必须收口到 `connectors/feishu/`。
2. Tauri command 只做入口分发，不继续在 `commands/tool_adapter/mod.rs` 内堆业务。
3. 前端继续落在 `features/tool-adapter/` 内，但 Feishu 相关组件必须独立子目录内聚。

### 4.2 用户体验

1. 用户必须知道“当前在哪一步”。
2. 用户必须知道“下一步要去 GT Office 还是飞书开放平台”。
3. 条件字段必须显隐明确，例如只有选择 Webhook 才显示 `Verification Token` 和回调说明。
4. 连接测试必须前置到绑定路由之前。

### 4.3 安全

1. `appSecret`、`verificationToken` 不落明文 JSON，统一走现有 `credential_store.rs`。
2. 前端只显示 SecretRef 与是否已配置，不回显明文。
3. Webhook 模式默认提示“需要公网/隧道可达”，避免用户把本地 loopback URL 误配到飞书后台。

## 5. 目标能力范围

### 5.1 Phase 1：配置闭环

Phase 1 先完成“能配置、能测通、能启动、能绑定”：

1. Feishu account 存储。
2. Feishu health/probe。
3. Feishu WebSocket 连接模式。
4. 前端向导与平台配置指引。
5. 路由绑定与准入策略继续复用现有 `channel_binding` / `channel_access`。

### 5.2 Phase 2：高级模式与补齐

1. Feishu Webhook 高级模式。
2. Feishu outbound send。
3. 交互卡片、reply in thread、媒体。
4. 更细的群策略、sender allowlist、bot mention 识别。

## 6. 后端模块设计

### 6.1 目录目标

目标目录：

```text
apps/desktop-tauri/src-tauri/src/connectors/
  credential_store.rs
  mod.rs
  telegram/
    api.rs
    inbound.rs
    mod.rs
    offset_store.rs
  feishu/
    mod.rs
    api.rs
    inbound.rs
    outbound.rs
    probe.rs
    websocket.rs
    webhook.rs
    account_store.rs
    types.rs
```

说明：

1. `feishu/` 与 `telegram/` 同级，满足目录边界要求。
2. `channel_adapter_runtime.rs` 不再承担飞书协议细节，只保留 shared webhook ingress 能力。
3. 飞书协议解析移入 `connectors/feishu/inbound.rs`。

### 6.2 文件职责

#### `connectors/feishu/types.rs`

放置飞书 connector 的核心类型：

1. `FeishuAccountUpsertInput`
2. `FeishuConnectorAccountView`
3. `FeishuHealthSnapshot`
4. `FeishuWebhookSyncSnapshot`
5. `FeishuConnectorAccountRecord`
6. `FeishuConnectionMode`
7. `FeishuDomain`

#### `connectors/feishu/account_store.rs`

负责账号元数据持久化：

1. 复用 Telegram 的 `channel/connectors.json`。
2. 在 `ConnectorStoreFile` 中增加 `feishu_accounts` 字段。
3. Secret 本体继续交给 `credential_store.rs`。

建议数据结构：

```json
{
  "version": "1",
  "telegramAccounts": {},
  "feishuAccounts": {
    "default": {
      "accountId": "default",
      "enabled": true,
      "connectionMode": "websocket",
      "domain": "feishu",
      "appId": "cli_xxx",
      "appSecretRef": "feishu.default.app_secret",
      "verificationTokenRef": null,
      "webhookPath": "/feishu/events",
      "webhookHost": "127.0.0.1",
      "webhookPort": 3000,
      "updatedAtMs": 0
    }
  }
}
```

#### `connectors/feishu/api.rs`

封装飞书开放平台 API：

1. `fetch_tenant_access_token`
2. `get_bot_info`
3. `send_message`
4. `reply_message`
5. `update_message`

Phase 1 至少需要 `get_bot_info`。

#### `connectors/feishu/probe.rs`

负责健康检查与连接测试：

1. 校验是否具备 `appId/appSecret`。
2. 调 `bot/v3/info`。
3. 返回 `ok/status/detail/botName/botOpenId/checkedAtMs`。

建议状态枚举：

1. `ok`
2. `not_configured`
3. `auth_failed`
4. `provider_unavailable`
5. `disabled`
6. `webhook_mismatch`
7. `runtime_not_started`

#### `connectors/feishu/websocket.rs`

负责 WebSocket 模式：

1. 启动连接。
2. 接收事件。
3. 统一交给 `inbound.rs` 解析。
4. 再调用现有 `process_external_inbound_message`。

这条链路不依赖 `channel_adapter_runtime`，应作为 Feishu 的推荐模式。

#### `connectors/feishu/webhook.rs`

负责 Webhook 模式的 connector 逻辑，不直接承担 shared HTTP listener：

1. 计算有效的 webhook path/host/port。
2. 提供 health / webhook 配置校验。
3. 对接 `channel_adapter_runtime` 的共享 ingress。

建议把 shared runtime 中现有飞书解析改成：

1. runtime 只分发 URL。
2. payload 交给 `feishu::inbound::parse_webhook_payload()`。

#### `connectors/feishu/inbound.rs`

负责飞书事件解析：

1. `url_verification`
2. `im.message.receive_v1`
3. 后续预留 `card.action.trigger`

输出统一 `ExternalInboundMessage`，继续复用现有 `vb-task` 路由、幂等、准入逻辑。

#### `connectors/feishu/outbound.rs`

Phase 2 使用：

1. pairing approval 回发
2. 文本回复
3. thread reply
4. card / media

### 6.3 Tauri command 分层

当前 `commands/tool_adapter/mod.rs` 已经过大，建议在不破坏对外命令名的前提下做内部下沉：

```text
apps/desktop-tauri/src-tauri/src/commands/tool_adapter/
  mod.rs
  channel_connector.rs
```

其中：

1. `mod.rs` 只保留 `pub use` 与 `#[tauri::command]` 暴露。
2. `channel_connector.rs` 负责按 `channel` 分发到 `telegram` / `feishu`。

这样可以避免继续向根 `mod.rs` 追加 channel-specific 逻辑。

### 6.4 Command 设计

保持现有 command 名称不变，但扩展 Feishu payload 支持：

#### `channel_connector_account_upsert`

当 `channel="feishu"` 时支持：

1. `accountId`
2. `enabled`
3. `connectionMode`: `websocket | webhook`
4. `domain`: `feishu | lark`
5. `appId`
6. `appSecret`
7. `appSecretRef`
8. `verificationToken`
9. `verificationTokenRef`
10. `webhookPath`
11. `webhookHost`
12. `webhookPort`

#### `channel_connector_account_list`

返回：

1. `channel`
2. `accountId`
3. `enabled`
4. `connectionMode`
5. `domain`
6. `appId`
7. `appSecretRef`
8. `verificationTokenRef`
9. `hasAppSecret`
10. `hasVerificationToken`
11. `webhookPath`
12. `webhookHost`
13. `webhookPort`
14. `updatedAtMs`

#### `channel_connector_health`

返回：

1. `ok`
2. `status`
3. `detail`
4. `mode`
5. `botName`
6. `botOpenId`
7. `domain`
8. `checkedAtMs`
9. `runtimeConnected`
10. `configuredWebhookUrl`
11. `runtimeWebhookUrl`
12. `webhookMatched`

#### `channel_connector_webhook_sync`

仅当 `connectionMode = webhook` 时启用：

1. 不负责向飞书后台自动写回配置。
2. 负责返回“应当填写到飞书后台的 callback 地址”。
3. 同时检测当前 runtime URL 与 account 配置是否一致。

这和 Telegram 的 `setWebhook` 不同，Feishu 没有同样的 bot API 自动写回模型，因此这里只做“生成 + 校验”，不做远程改写。

### 6.5 启动与运行

建议在应用启动阶段引入 Feishu connector supervisor：

1. 读取所有启用的 Feishu account。
2. `websocket` 模式直接启动 `feishu::websocket::spawn_account`。
3. `webhook` 模式只登记 health 状态，并复用 `channel_adapter_runtime` 的共享 ingress。

推荐行为：

1. 如果用户未明确选择模式，默认 `websocket`。
2. `webhook` 仅作为高级模式放在 UI 中折叠展示。

## 7. 前端模块设计

### 7.1 目录目标

建议在现有 `tool-adapter` feature 下新增 Feishu 子目录：

```text
apps/desktop-web/src/features/tool-adapter/
  ChannelManagerPane.tsx
  ChannelWizard.tsx
  channel-connector-runtime.ts
  feishu/
    FeishuConnectorWizard.tsx
    FeishuPlatformGuide.tsx
    FeishuAccountForm.tsx
    FeishuHealthCard.tsx
    model.ts
```

说明：

1. 仍然归属 `tool-adapter` feature。
2. Feishu 专属表单、提示文案、平台步骤不再继续塞进通用 `ChannelWizard.tsx`。
3. `ChannelWizard.tsx` 变成外层调度容器，按 channel 渲染不同 wizard。

### 7.2 推荐配置流程

前端应采用清晰的 stepper，而不是只显示一个 webhook 文本框。

建议步骤如下：

1. 选择通道
2. 选择连接模式
3. 前往飞书开放平台创建应用
4. 回到 GT Office 填写凭据
5. 再前往飞书开放平台配置权限与事件订阅
6. 回到 GT Office 执行连接测试
7. 绑定角色/Agent 与准入策略

### 7.3 清晰移动指引设计

每一步都必须显示三类信息：

1. `你当前所在`：GT Office / 飞书开放平台
2. `下一步前往`：GT Office / 飞书开放平台
3. `完成标志`：用户需要拿到什么信息才能回来

建议 UI 结构：

1. 顶部 stepper：展示 1/7 到 7/7。
2. 右侧固定指引卡片：
   - 当前步骤目标
   - 你要复制/填写的字段
   - 需要打开的页面
3. 主按钮文案明确：
   - `打开飞书开放平台`
   - `我已完成，继续`
   - `返回 GT Office 填写凭据`
   - `测试连接`

推荐交互文案示例：

1. `当前在 GT Office：请选择推荐模式。`
2. `下一步前往飞书开放平台：创建企业自建应用并复制 App ID / App Secret。`
3. `返回 GT Office：粘贴 App ID / App Secret 后再继续权限配置。`

### 7.4 向导表单设计

#### Step 1：选择模式

选项：

1. `WebSocket（推荐）`
2. `Webhook（高级）`

说明：

1. WebSocket 不要求公网 callback。
2. Webhook 需要可从飞书访问到的公网地址或反向隧道。

#### Step 2：创建应用指引

展示：

1. 飞书开放平台入口按钮
2. `创建企业自建应用` 的文案提示
3. 复制字段 checklist：
   - App ID
   - App Secret

#### Step 3：填写凭据

字段：

1. `Account ID`
2. `Domain`
3. `App ID`
4. `App Secret`
5. `Verification Token`（仅 Webhook）
6. `Webhook Path/Host/Port`（仅 Webhook，高级展开）

#### Step 4：平台配置指引

展示按模式分支：

1. WebSocket：
   - 开启 Bot 能力
   - 配权限
   - 事件订阅选择长连接
   - 添加 `im.message.receive_v1`
2. Webhook：
   - 开启 Bot 能力
   - 配权限
   - 事件订阅配置回调 URL
   - 填 `verification token`

#### Step 5：连接测试

按钮：

1. `测试连接`

显示结果：

1. `已连接：bot_name`
2. `未配置`
3. `鉴权失败`
4. `网络不可达`
5. `Webhook 地址不匹配`

#### Step 6：绑定路由

沿用当前路由能力：

1. `accountId`
2. `peerKind`
3. `peerPattern`
4. `targetBindingType`
5. `role / agent`
6. `priority`

#### Step 7：准入策略

沿用现有：

1. `pairing`
2. `allowlist`
3. `open`
4. 批量 approve identity

### 7.5 关键前端约束

1. 未通过连接测试前，不允许进入“保存并完成”。
2. `Webhook` 模式下若 runtime 未准备好，明确展示原因。
3. `Verification Token` 与 `App Secret` 永不回显明文。
4. 如果用户切回 `WebSocket`，Webhook 字段自动折叠但不丢失已保存值。

## 8. 飞书开放平台配置说明

这一节用于直接指导用户在飞书侧怎么配，前端 UI 也应尽量复用这份顺序。

### 8.1 推荐模式：WebSocket

#### 1. 创建应用

1. 进入飞书开放平台。
2. 创建企业自建应用。
3. 记录 `App ID` 与 `App Secret`。

#### 2. 开启 Bot 能力

1. 打开应用的能力页。
2. 开启 `Bot`。
3. 配置机器人名称与头像。

#### 3. 配权限

Phase 1 建议最小权限集：

1. `im:message`
2. `im:message:readonly`
3. `im:message.p2p_msg:readonly`
4. `im:message.group_at_msg:readonly`
5. `im:message:send_as_bot`
6. `im:chat.members:bot_access`
7. `contact:user.base:readonly`

如果后续要做媒体和卡片，可再追加：

1. `im:resource`
2. `cardkit:card:read`
3. `cardkit:card:write`

#### 4. 配事件订阅

WebSocket 模式：

1. 在事件订阅中选择“长连接接收事件”。
2. 添加事件 `im.message.receive_v1`。
3. Phase 2 若支持卡片交互，再追加 `card.action.trigger`。

#### 5. 发布应用

1. 创建版本。
2. 提交审核/发布。
3. 确保 bot 已可在目标租户中使用。

### 8.2 高级模式：Webhook

除上述步骤外，还需要：

1. 在飞书后台配置事件回调 URL。
2. 获取并记录 `Verification Token`。
3. 将回调 URL 填成 GT Office 展示的公网 URL。

Webhook 模式必须在 UI 中明确提示：

1. 如果当前只拿到 `127.0.0.1` 或局域网地址，飞书无法直接访问。
2. 用户需要反向代理、隧道或公网入口。
3. 若没有公网入口，应改回 `WebSocket（推荐）`。

## 9. 与现有链路的衔接

### 9.1 保持不变

以下能力继续复用现有实现：

1. `channel_binding_upsert/list/delete`
2. `channel_access.policy_set/approve/list`
3. `process_external_inbound_message`
4. `vb-task` 中的幂等、准入、路由、派发

### 9.2 需要调整

1. 把飞书 payload 解析从 `channel_adapter_runtime.rs` 下沉到 `connectors/feishu/inbound.rs`。
2. `channel_adapter_status` 必须返回真实 Feishu accounts。
3. `ChannelWizard` 必须按 connector 类型拆分，不再把 Telegram 逻辑当作默认模板。

## 10. 分阶段实施建议

### 10.1 Phase 1

1. 新增 `connectors/feishu/` 目录与账号存储。
2. 扩展 Tauri command 支持 Feishu account upsert/list/health。
3. 前端完成 Feishu 向导与平台配置指引。
4. 接入 Feishu WebSocket 模式。
5. `channel_adapter_status` 返回 Feishu 账号与健康状态摘要。

### 10.2 Phase 2

1. 接入 Webhook 高级模式。
2. 完成 Feishu outbound send。
3. 补卡片/媒体/interactive callback。
4. 增强群路由和 sender allowlist。

## 11. 验收标准

### 11.1 Phase 1 验收

1. 用户能在 GT Office 内完成 Feishu `App ID/App Secret` 配置。
2. 用户能看到清晰的“去飞书平台 / 回到 GT Office”步骤引导。
3. 用户能通过 `测试连接` 拿到 bot 身份或明确错误。
4. 用户能将 Feishu 账号绑定到 route。
5. 用户选择 `WebSocket` 时，不要求再去配置公网 webhook。

### 11.2 Phase 2 验收

1. 用户选择 `Webhook` 时，能明确看到需要填写到飞书后台的 callback URL。
2. 用户能获得 `webhook matched / mismatch` 诊断。
3. Feishu 回复链路与 Telegram 一样进入统一外部通道回发闭环。

## 12. 当前建议决策

建议本项目直接采用以下决策：

1. Feishu 默认模式定为 `WebSocket`。
2. Webhook 只作为高级模式暴露。
3. 先做“配置闭环 + health/probe + WebSocket”，再做 outbound。
4. 目录必须新增 `apps/desktop-tauri/src-tauri/src/connectors/feishu/`，不再继续把飞书细节留在 runtime 中。

这条路线最符合当前仓库状态，也最接近 OpenClaw 已验证过的实现方式。
