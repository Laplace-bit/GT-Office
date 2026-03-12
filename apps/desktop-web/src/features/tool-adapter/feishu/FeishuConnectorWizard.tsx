import { useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  desktopApi,
  type AgentProfile,
  type AgentRole,
  type ChannelConnectorAccount,
  type ChannelConnectorHealthResponse,
  type ChannelRouteBinding,
  type ExternalAccessPolicyMode,
} from '@shell/integration/desktop-api'
import { FeishuAccountForm } from './FeishuAccountForm'
import { FeishuHealthCard } from './FeishuHealthCard'
import { FeishuPlatformGuide } from './FeishuPlatformGuide'
import {
  buildFeishuDefaultForm,
  copyTextToClipboard,
  describeError,
  normalizeAgentTarget,
  normalizeRoleTarget,
  parseIdentities,
  platformAppUrl,
  type FeishuGuideState,
  type FeishuWizardForm,
} from './model'

interface FeishuConnectorWizardProps {
  locale: Locale
  workspaceId: string | null
  onClose: () => void
  onSuccess: (message: string) => void
  editingBinding: ChannelRouteBinding | null
  roles: AgentRole[]
  agents: AgentProfile[]
  connectorAccounts: ChannelConnectorAccount[]
}

const FEISHU_STEP_COUNT = 4

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildGuideState(locale: Locale, form: FeishuWizardForm, step: number): FeishuGuideState {
  const platform = form.domain === 'lark' ? 'Lark Open Platform' : '飞书开放平台'
  const platformUrl = platformAppUrl(form.domain)

  switch (step) {
    case 0:
      return {
        eyebrow: t(locale, 'Step 1', 'Step 1'),
        title: t(locale, '先创建应用并拿到凭据', 'Create the app and collect credentials'),
        summary: t(
          locale,
          '先在开放平台创建企业自建应用、开启 Bot，并把 App ID / App Secret 复制出来。这一步先不要保存“长连接接收事件”，因为飞书要求 GT Office 里的长连接已经在线。',
          'First create an enterprise self-built app in Open Platform, enable Bot, and copy the App ID / App Secret. Do not save long connection yet, because Feishu requires the GT Office WebSocket client to already be online.',
        ),
        platformLabel: platform,
        platformUrl,
        note: t(
          locale,
          '当前环境无法直接拉起浏览器，请复制这个地址到系统浏览器手动打开。',
          'This environment cannot open the browser directly. Copy this URL into your system browser manually.',
        ),
        checklist: [
          t(locale, '创建企业自建应用。', 'Create an enterprise self-built app.'),
          t(locale, '开启 Bot 能力。', 'Enable the Bot capability.'),
          t(locale, '添加消息接收、消息发送和用户基础信息相关权限。', 'Grant message receive, message send, and basic user profile permissions.'),
          'App ID',
          'App Secret',
        ],
      }
    case 1:
      return {
        eyebrow: t(locale, 'Step 2', 'Step 2'),
        title: t(locale, '填写凭据并启动长连接', 'Fill credentials and start the long connection'),
        summary: t(
          locale,
          '把 App ID / App Secret 填进 GT Office，然后点击“保存并启动长连接”。只有当 runtime 显示已连接时，飞书开放平台才能成功保存“使用长连接接收事件”。',
          'Fill App ID / App Secret in GT Office, then click “Save and start long connection”. Feishu Open Platform can save long connection only after the runtime shows connected.',
        ),
        platformLabel: platform,
        platformUrl,
        note: t(
          locale,
          '如果这里长连接还没建立成功，不要回开放平台点保存；先在当前弹窗重试连接测试。',
          'If the long connection is not established here yet, do not go back to Open Platform to save it. Retry the connection test in this modal first.',
        ),
        checklist: [
          'Account ID',
          'App ID',
          'App Secret',
          t(locale, '等待 GT Office 显示 runtime 已连接。', 'Wait until GT Office shows the runtime as connected.'),
        ],
      }
    case 2:
      return {
        eyebrow: t(locale, 'Step 3', 'Step 3'),
        title: t(locale, '回到开放平台保存长连接订阅', 'Return to Open Platform and save long connection'),
        summary: t(
          locale,
          '现在 GT Office 已经带着你的 App ID / App Secret 建立长连接，可以回飞书开放平台配置“使用长连接接收事件”，并订阅 `im.message.receive_v1`。',
          'GT Office has now established the WebSocket client using your App ID / App Secret. Return to Open Platform, choose long connection, and subscribe to `im.message.receive_v1`.',
        ),
        platformLabel: platform,
        platformUrl,
        note: t(
          locale,
          '这一步是飞书长连接模式的必需顺序，不是 UI 绕。保存前请先确认上一步里的 runtime 状态已经是“已启动”。',
          'This order is required by Feishu long connection mode, not just a UI choice. Confirm the runtime status is already “Running” before saving.',
        ),
        checklist: [
          t(locale, '进入“事件与回调 > 事件配置”。', 'Open “Events & Callbacks > Event Configuration”.'),
          t(locale, '选择“使用长连接接收事件”。', 'Choose “Use long connection to receive events”.'),
          'im.message.receive_v1',
          t(locale, '保存成功后，再回 GT Office 完成 route 和策略。', 'After saving successfully, return to GT Office to finish the route and policy.'),
        ],
      }
    default:
      return {
        eyebrow: t(locale, 'Step 4', 'Step 4'),
        title: t(locale, '绑定路由并完成配置', 'Bind the route and finish setup'),
        summary: t(
          locale,
          '最后一步统一保存 connector、route 和 access policy。这里尽量只填必要项，先让主链路跑通。',
          'The final step saves the connector, route, and access policy together. Fill only the necessary items and get the main path working first.',
        ),
        platformLabel: platform,
        platformUrl,
        note: t(
          locale,
          '如果后续需要更复杂的策略，可以在通道管理里继续调整，不必在首次接入时一次配满。',
          'If you need more complex policy later, refine it from channel management after the initial setup instead of over-configuring the first pass.',
        ),
        checklist: [
          t(locale, '选择消息投递目标。', 'Choose the message delivery target.'),
          t(locale, '检查 direct / group 匹配。', 'Review the direct / group match.'),
          t(locale, '应用 access policy。', 'Apply the access policy.'),
        ],
      }
  }
}

export function FeishuConnectorWizard({
  locale,
  workspaceId,
  onClose,
  onSuccess,
  editingBinding,
  roles,
  agents,
  connectorAccounts,
}: FeishuConnectorWizardProps) {
  const activeRoles = useMemo(() => roles.filter((role) => role.status !== 'disabled'), [roles])
  const activeAgents = useMemo(() => agents.filter((agent) => agent.state !== 'terminated'), [agents])
  const defaultRoleKey = activeRoles[0]?.roleKey ?? ''
  const defaultAgentId = activeAgents[0]?.id ?? ''

  const [wizardStep, setWizardStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [healthSnapshot, setHealthSnapshot] = useState<ChannelConnectorHealthResponse['health'] | null>(null)
  const [connectionTestPassed, setConnectionTestPassed] = useState(false)
  const [platformSubscriptionConfirmed, setPlatformSubscriptionConfirmed] = useState(false)
  const [form, setForm] = useState<FeishuWizardForm>(() =>
    buildFeishuDefaultForm({
      editingBinding,
      connectorAccounts,
      defaultRoleKey,
      defaultAgentId,
    }),
  )

  const accountRecord = useMemo(() => {
    const accountId = form.accountId.trim() || 'default'
    return (
      connectorAccounts.find(
        (item) => item.channel === 'feishu' && item.accountId.toLowerCase() === accountId.toLowerCase(),
      ) ?? null
    )
  }, [connectorAccounts, form.accountId])

  const roleLabelByKey = useMemo(() => {
    const map = new Map<string, string>()
    activeRoles.forEach((role) => {
      map.set(role.id, role.roleName)
      map.set(role.roleKey, role.roleName)
    })
    return map
  }, [activeRoles])

  const agentLabelById = useMemo(() => {
    const map = new Map<string, string>()
    activeAgents.forEach((agent) => map.set(agent.id, agent.name))
    return map
  }, [activeAgents])

  const guideState = useMemo(() => buildGuideState(locale, form, wizardStep), [form, locale, wizardStep])

  const reviewTargetLabel =
    form.targetBindingType === 'role'
      ? roleLabelByKey.get(form.targetRoleKey) ?? form.targetRoleKey
      : agentLabelById.get(form.targetAgentId) ?? form.targetAgentId

  const updateField = <K extends keyof FeishuWizardForm>(key: K, value: FeishuWizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'accountId' || key === 'domain' || key === 'appId' || key === 'appSecret') {
      setConnectionTestPassed(false)
      setPlatformSubscriptionConfirmed(false)
      setHealthSnapshot(null)
    }
  }

  const persistConnectorAccount = async () => {
    const normalizedAccountId = form.accountId.trim() || 'default'
    await desktopApi.channelConnectorAccountUpsert({
      channel: 'feishu',
      accountId: normalizedAccountId,
      enabled: true,
      connectionMode: 'websocket',
      domain: form.domain,
      appId: form.appId.trim(),
      appSecret: form.appSecret.trim() || null,
    })
  }

  const pollHealthUntilRuntimeConnected = async (accountId: string) => {
    let latest: ChannelConnectorHealthResponse['health'] | null = null
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await desktopApi.channelConnectorHealth('feishu', accountId)
      latest = response.health
      if (!latest.ok || latest.runtimeConnected) {
        break
      }
      await sleep(900)
    }
    return latest
  }

  const testConnection = async () => {
    setSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    setPlatformSubscriptionConfirmed(false)
    try {
      await persistConnectorAccount()
      const accountId = form.accountId.trim() || 'default'
      const health = await pollHealthUntilRuntimeConnected(accountId)
      setHealthSnapshot(health)

      const runtimeReady = Boolean(health?.ok && health.runtimeConnected)
      setConnectionTestPassed(runtimeReady)

      if (runtimeReady) {
        setStatusMessage(
          t(
            locale,
            '飞书长连接已建立。现在回到开放平台保存“使用长连接接收事件”。',
            'Feishu long connection is now established. Return to Open Platform and save “use long connection to receive events”.',
          ),
        )
        return
      }

      if (health?.ok) {
        setErrorMessage(
          t(
            locale,
            '应用凭据校验通过，但长连接尚未建立。请在当前弹窗重试，直到 runtime 状态显示“已启动”后，再回开放平台保存长连接。',
            'App credentials are valid, but the long connection is not established yet. Retry in this modal until the runtime status becomes “Running”, then return to Open Platform to save long connection.',
          ),
        )
        return
      }

      setErrorMessage(
        t(locale, '连接测试未通过：{detail}', 'Connection test failed: {detail}', {
          detail: health?.detail || health?.status || '-',
        }),
      )
    } catch (error) {
      setConnectionTestPassed(false)
      setErrorMessage(
        t(locale, '连接测试失败：{detail}', 'Connection test failed: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setSaving(false)
    }
  }

  const applyWizard = async () => {
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }

    const normalizedAccountId = form.accountId.trim() || 'default'
    const targetSelector =
      form.targetBindingType === 'role'
        ? normalizeRoleTarget(form.targetRoleKey)
        : normalizeAgentTarget(form.targetAgentId)
    if (!targetSelector) {
      setErrorMessage(t(locale, '请先选择 route 目标。', 'Select a route target first.'))
      return
    }

    setSaving(true)
    setErrorMessage(null)
    try {
      await persistConnectorAccount()
      await desktopApi.channelBindingUpsert({
        workspaceId,
        channel: 'feishu',
        accountId: normalizedAccountId,
        peerKind: form.peerKind,
        peerPattern: form.peerPattern.trim() || null,
        targetAgentId: targetSelector,
        priority: Number.isFinite(form.priority) ? Math.floor(form.priority) : 100,
      })
      await desktopApi.channelAccessPolicySet('feishu', form.policyMode, normalizedAccountId)
      await Promise.all(
        parseIdentities(form.approveIdentities).map((identity) =>
          desktopApi.channelAccessApprove('feishu', identity, normalizedAccountId),
        ),
      )
      onSuccess(t(locale, 'Feishu 通道配置完成。', 'Feishu channel setup completed.'))
    } catch (error) {
      setErrorMessage(
        t(locale, '应用配置失败：{detail}', 'Applying the configuration failed: {detail}', {
          detail: describeError(error),
        }),
      )
      setSaving(false)
      return
    }
    setSaving(false)
  }

  const canGoNext = useMemo(() => {
    switch (wizardStep) {
      case 1:
        return connectionTestPassed
      case 2:
        return platformSubscriptionConfirmed
      default:
        return true
    }
  }, [connectionTestPassed, platformSubscriptionConfirmed, wizardStep])

  return (
    <div className="feishu-onboarding-shell">
      <div className="channel-wizard-container feishu-onboarding-modal">
        <header className="channel-wizard-header feishu-modal-header">
          <div className="channel-wizard-title">
            <h4>
              {editingBinding
                ? t(locale, '编辑 Feishu Channel', 'Edit Feishu Channel')
                : t(locale, '新增 Feishu Channel', 'Add Feishu Channel')}
            </h4>
            <p>{t(locale, 'Step {step}/{total}', 'Step {step}/{total}', { step: wizardStep + 1, total: FEISHU_STEP_COUNT })}</p>
          </div>
          <button type="button" className="settings-content-close" onClick={onClose} disabled={saving}>
            ×
          </button>
        </header>

        <div className="channel-wizard-steps-indicator">
          {Array.from({ length: FEISHU_STEP_COUNT }).map((_, index) => (
            <div
              key={index}
              className={`channel-wizard-step-dot ${index === wizardStep ? 'active' : ''} ${index < wizardStep ? 'completed' : ''}`}
            />
          ))}
        </div>

        <div className="channel-wizard-body feishu-wizard-layout">
          <section className="feishu-wizard-main">
            <div className="feishu-hero-card">
              <span className="feishu-guide-eyebrow">{t(locale, 'Simple but Correct', 'Simple but Correct')}</span>
              <h5>{t(locale, '按飞书长连接的真实顺序接入', 'Follow the real Feishu long-connection order')}</h5>
              <p>
                {t(
                  locale,
                  '飞书要求先有在线长连接，开放平台才能保存“使用长连接接收事件”。所以流程会先创建应用、再回 GT Office 启动长连接、再回开放平台保存事件订阅，最后回到 GT Office 绑定路由。',
                  'Feishu requires an online WebSocket client before Open Platform can save “use long connection to receive events”. The flow therefore creates the app first, starts the long connection in GT Office, returns to Open Platform to save the subscription, and finally comes back to GT Office to bind the route.',
                )}
              </p>
            </div>

            {statusMessage && <div className="settings-channel-message">{statusMessage}</div>}
            {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

            {wizardStep === 0 && (
              <div className="settings-pane-section feishu-step-section">
                <h4>{t(locale, 'Step 1 在开放平台创建应用', 'Step 1 Create the app in Open Platform')}</h4>
                <div className="settings-form-group">
                  <label>{t(locale, '飞书区域', 'Platform Domain')}</label>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={form.domain === 'feishu' ? 'active' : ''}
                      disabled={saving}
                      onClick={() => updateField('domain', 'feishu')}
                    >
                      Feishu
                    </button>
                    <button
                      type="button"
                      className={form.domain === 'lark' ? 'active' : ''}
                      disabled={saving}
                      onClick={() => updateField('domain', 'lark')}
                    >
                      Lark
                    </button>
                  </div>
                </div>
                <div className="feishu-inline-panel">
                  <ul className="feishu-inline-list">
                    <li>{t(locale, '应用类型：企业自建应用。', 'App type: enterprise self-built app.')}</li>
                    <li>{t(locale, '先完成 Bot 与权限配置。', 'Finish Bot and permission setup first.')}</li>
                    <li>{t(locale, '先复制 App ID / App Secret。', 'Copy App ID / App Secret first.')}</li>
                    <li>{t(locale, '长连接事件订阅留到下一步启动成功后再保存。', 'Save long connection subscription only after the next step starts successfully.')}</li>
                  </ul>
                </div>
              </div>
            )}

            {wizardStep === 1 && (
              <div className="settings-pane-section feishu-step-section">
                <h4>{t(locale, 'Step 2 填写凭据并启动长连接', 'Step 2 Fill credentials and start long connection')}</h4>
                <FeishuAccountForm
                  locale={locale}
                  saving={saving}
                  editing={Boolean(editingBinding)}
                  form={form}
                  accountRecord={accountRecord}
                  onChange={updateField}
                />
                <div className="feishu-step-actions">
                  <button type="button" className="settings-btn settings-btn-primary" onClick={testConnection} disabled={saving}>
                    {saving
                      ? t(locale, '启动中...', 'Starting...')
                      : t(locale, '保存并启动长连接', 'Save and start long connection')}
                  </button>
                </div>
                <FeishuHealthCard locale={locale} health={healthSnapshot} />
              </div>
            )}

            {wizardStep === 2 && (
              <div className="settings-pane-section feishu-step-section">
                <h4>{t(locale, 'Step 3 回开放平台保存长连接', 'Step 3 Return to Open Platform and save long connection')}</h4>
                <FeishuHealthCard locale={locale} health={healthSnapshot} />
                <div className="feishu-inline-panel">
                  <ul className="feishu-inline-list">
                    <li>{t(locale, '进入“事件与回调 > 事件配置”。', 'Open “Events & Callbacks > Event Configuration”.')}</li>
                    <li>{t(locale, '选择“使用长连接接收事件”。', 'Choose “Use long connection to receive events”.')}</li>
                    <li>{t(locale, '添加事件 `im.message.receive_v1`。', 'Add the `im.message.receive_v1` event.')}</li>
                    <li>{t(locale, '保存成功后，再回来做 route 与策略配置。', 'After saving successfully, come back to configure the route and policy.')}</li>
                  </ul>
                </div>
                <label className="feishu-confirm-check">
                  <input
                    type="checkbox"
                    checked={platformSubscriptionConfirmed}
                    disabled={saving || !connectionTestPassed}
                    onChange={(event) => setPlatformSubscriptionConfirmed(event.target.checked)}
                  />
                  <span>
                    {t(
                      locale,
                      '我已在开放平台成功保存“使用长连接接收事件”，并订阅了 `im.message.receive_v1`。',
                      'I have successfully saved “use long connection to receive events” in Open Platform and subscribed to `im.message.receive_v1`.',
                    )}
                  </span>
                </label>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="settings-pane-section feishu-step-section">
                <h4>{t(locale, 'Step 4 绑定 route 并应用策略', 'Step 4 Bind the route and apply policy')}</h4>

                <div className="segmented-control">
                  <button
                    type="button"
                    className={form.targetBindingType === 'agent' ? 'active' : ''}
                    disabled={saving}
                    onClick={() => updateField('targetBindingType', 'agent')}
                  >
                    {t(locale, '绑定 Agent', 'Bind Agent')}
                  </button>
                  <button
                    type="button"
                    className={form.targetBindingType === 'role' ? 'active' : ''}
                    disabled={saving}
                    onClick={() => updateField('targetBindingType', 'role')}
                  >
                    {t(locale, '绑定 Role', 'Bind Role')}
                  </button>
                </div>

                <div className="feishu-form-grid">
                  <div className="settings-form-group">
                    <label>{t(locale, '会话类型', 'Peer Kind')}</label>
                    <select
                      className="settings-select"
                      value={form.peerKind}
                      disabled={saving}
                      onChange={(event) => updateField('peerKind', event.target.value as 'direct' | 'group')}
                    >
                      <option value="direct">Direct</option>
                      <option value="group">Group</option>
                    </select>
                  </div>
                  <div className="settings-form-group">
                    <label>{t(locale, 'Peer Pattern（可选）', 'Peer Pattern (optional)')}</label>
                    <input
                      className="settings-input"
                      value={form.peerPattern}
                      disabled={saving}
                      onChange={(event) => updateField('peerPattern', event.target.value)}
                    />
                  </div>
                </div>

                {form.targetBindingType === 'role' ? (
                  <div className="settings-form-group">
                    <label>{t(locale, '目标 Role', 'Target Role')}</label>
                    <select
                      className="settings-select"
                      value={form.targetRoleKey}
                      disabled={saving || activeRoles.length === 0}
                      onChange={(event) => updateField('targetRoleKey', event.target.value)}
                    >
                      {activeRoles.map((role) => (
                        <option key={role.id} value={role.roleKey}>
                          {role.roleName} ({role.roleKey})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="settings-form-group">
                    <label>{t(locale, '目标 Agent', 'Target Agent')}</label>
                    <select
                      className="settings-select"
                      value={form.targetAgentId}
                      disabled={saving || activeAgents.length === 0}
                      onChange={(event) => updateField('targetAgentId', event.target.value)}
                    >
                      {activeAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="settings-form-group">
                  <label>{t(locale, '优先级', 'Priority')}</label>
                  <input
                    type="number"
                    className="settings-input"
                    value={form.priority}
                    disabled={saving}
                    onChange={(event) => updateField('priority', Number(event.target.value))}
                  />
                </div>

                <div className="settings-form-group">
                  <label>{t(locale, '策略模式', 'Policy Mode')}</label>
                  <select
                    className="settings-select"
                    value={form.policyMode}
                    disabled={saving}
                    onChange={(event) => updateField('policyMode', event.target.value as ExternalAccessPolicyMode)}
                  >
                    <option value="pairing">pairing</option>
                    <option value="allowlist">allowlist</option>
                    <option value="open">open</option>
                    <option value="disabled">disabled</option>
                  </select>
                </div>

                <div className="settings-form-group">
                  <label>{t(locale, '预授权 identities（可选）', 'Pre-approve identities (optional)')}</label>
                  <textarea
                    className="settings-input"
                    rows={4}
                    value={form.approveIdentities}
                    disabled={saving}
                    placeholder={t(locale, '每行一个，或逗号分隔', 'One per line, or comma-separated')}
                    onChange={(event) => updateField('approveIdentities', event.target.value)}
                  />
                </div>

                <div className="feishu-inline-panel">
                  <ul className="feishu-review-list">
                    <li>
                      <span>{t(locale, 'Account ID', 'Account ID')}</span>
                      <strong>{form.accountId || 'default'}</strong>
                    </li>
                    <li>
                      <span>{t(locale, '接入方式', 'Connection Type')}</span>
                      <strong>WebSocket</strong>
                    </li>
                    <li>
                      <span>{t(locale, '目标', 'Target')}</span>
                      <strong>{reviewTargetLabel || '-'}</strong>
                    </li>
                    <li>
                      <span>{t(locale, '匹配', 'Match')}</span>
                      <strong>
                        {form.peerKind} / {form.peerPattern || '*'}
                      </strong>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </section>

          <FeishuPlatformGuide
            locale={locale}
            state={guideState}
            onCopyPlatformUrl={async () => {
              const ok = await copyTextToClipboard(guideState.platformUrl)
              if (ok) {
                setStatusMessage(t(locale, '开放平台地址已复制。', 'Open Platform URL copied.'))
              } else {
                setErrorMessage(t(locale, '复制失败，请手动复制平台地址。', 'Copy failed. Please copy the platform URL manually.'))
              }
            }}
            copyingDisabled={saving}
          />
        </div>

        <footer className="channel-wizard-footer">
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            onClick={() => setWizardStep((value) => Math.max(0, value - 1))}
            disabled={saving || wizardStep === 0}
          >
            {t(locale, '上一步', 'Previous')}
          </button>
          {wizardStep < FEISHU_STEP_COUNT - 1 ? (
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              onClick={() => setWizardStep((value) => Math.min(FEISHU_STEP_COUNT - 1, value + 1))}
              disabled={saving || !canGoNext}
            >
              {t(locale, '下一步', 'Next')}
            </button>
          ) : (
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              onClick={applyWizard}
              disabled={saving || !connectionTestPassed}
            >
              {saving ? t(locale, '应用中...', 'Applying...') : t(locale, '应用配置', 'Apply Configuration')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
