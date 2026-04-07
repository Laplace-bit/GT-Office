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
import { WizardStepBar } from '../WizardStepBar'
import {
  buildFeishuDefaultForm,
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
  onBack?: () => void
}

const FEISHU_STEP_COUNT = 2

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
        title: t(locale, '创建应用并启动连接', 'Create app & Start connection'),
        summary: t(
          locale,
          '在开放平台创建企业自建应用，开启 Bot，填写 App ID 和 Secret 到 GT Office，然后在这里启动长连接。切记：必须等长连接启动成功后，再去开放平台保存事件订阅！',
          'Create an enterprise self-built app, enable Bot, fill the credentials here and start the long connection. Do not save long connection event subscription in platform until the connection starts successfully here!',
        ),
        platformLabel: platform,
        platformUrl,
        note: t(
          locale,
          '当前环境无法直接拉起浏览器，请复制这个地址到系统浏览器手动打开。',
          'This environment cannot open the browser directly. Copy this URL into your system browser manually.',
        ),
        checklist: [
          t(locale, '创建应用与开启 Bot', 'Create app & enable Bot'),
          t(locale, '添加收发消息权限', 'Add message permissions'),
          'App ID & App Secret',
          t(locale, '等待 GT Office 侧显示“已连接”', 'Wait for GT Office to connect'),
        ],
      }
    default:
      return {
        eyebrow: t(locale, 'Step 2', 'Step 2'),
        title: t(locale, '保存订阅与配置路由', 'Save subscription & Bind route'),
        summary: t(
          locale,
          'GT Office 侧的长连接建立后，回到开放平台真正保存你的“使用长连接接收事件”。最后在这里选择消息要投递给哪个 Agent。',
          'Once GT Office is connected, return to Open Platform and save the "use long connection" setting. Finally, configure which Agent will receive the messages.',
        ),
        platformLabel: platform,
        platformUrl,
        note: t(
          locale,
          '如果需要针对不同群组做路由分发，后续可在“通道管理”里维护更复杂的规则，不用一次配满。',
          'Complex rules for different groups can be managed later in "Channel Management". Do not over-configure for now.',
        ),
        checklist: [
          t(locale, '开放平台：事件配置中保存长连接', 'Open Platform: save long connection'),
          t(locale, '开放平台：添加 im.message.receive_v1', 'Open Platform: add im.message.receive_v1'),
          t(locale, 'GT Office：选择投递目标与其他策略', 'GT Office: choose delivery target & policy'),
        ],
      }
  }
}

export function FeishuConnectorWizard({
  locale,
  workspaceId,
  onSuccess,
  editingBinding,
  roles,
  agents,
  connectorAccounts,
  onBack,
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
      case 0:
        return connectionTestPassed
      default:
        return platformSubscriptionConfirmed
    }
  }, [connectionTestPassed, platformSubscriptionConfirmed, wizardStep])

  return (
    <div className="feishu-onboarding-shell">
      <div className="channel-wizard-container feishu-onboarding-modal">
        <header className="channel-wizard-header feishu-modal-header">
          <div className="channel-wizard-title" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {onBack && (
              <button type="button" className="settings-btn settings-btn-icon" onClick={onBack} title={t(locale, '返回', 'Back')} disabled={saving} style={{ padding: '0.25rem 0.35rem', border: 'none', background: 'transparent' }}>
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                  <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
                </svg>
              </button>
            )}
            <div>
              <h4>
                {editingBinding
                  ? t(locale, '编辑 Feishu Channel', 'Edit Feishu Channel')
                  : t(locale, '新增 Feishu Channel', 'Add Feishu Channel')}
              </h4>
            </div>
          </div>
        </header>

        <WizardStepBar total={FEISHU_STEP_COUNT} current={wizardStep} />

        <div className="channel-wizard-body feishu-wizard-layout">
          <section className="feishu-wizard-main">


            {statusMessage && <div className="settings-channel-message">{statusMessage}</div>}
            {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

            <div className="channel-wizard-step-animate" key={wizardStep}>
            {wizardStep === 0 && (
              <div className="settings-pane-section feishu-step-section">
                <p className="channel-wizard-step-label">{t(locale, 'Step 1 — 创建应用与启动连接', 'Step 1 — Create app & Start connection')}</p>
                

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

            {wizardStep === 1 && (
              <div className="settings-pane-section feishu-step-section">
                <p className="channel-wizard-step-label">{t(locale, 'Step 2 — 确认订阅并配置路由', 'Step 2 — Confirm subscription & Configure route')}</p>

                <div className="feishu-confirm-box" style={{ background: 'var(--vb-surface-muted)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
                  <label className="feishu-confirm-check" style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={platformSubscriptionConfirmed}
                      disabled={saving}
                      onChange={(event) => setPlatformSubscriptionConfirmed(event.target.checked)}
                      style={{ marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '0.875rem' }}>
                      {t(
                        locale,
                        '我已在平台成功保存“使用长连接接收事件”，并订阅了 `im.message.receive_v1`。',
                        'I have successfully saved long connection settings in the Platform and subscribed to `im.message.receive_v1`.',
                      )}
                    </span>
                  </label>
                </div>

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
            </div>
          </section>

          <FeishuPlatformGuide
            locale={locale}
            state={guideState}
            disabled={saving}
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
              disabled={saving || !connectionTestPassed || !platformSubscriptionConfirmed}
            >
              {saving ? t(locale, '应用中...', 'Applying...') : t(locale, '应用配置', 'Apply Configuration')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
