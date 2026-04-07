import { useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  desktopApi,
  type AgentRole,
  type AgentProfile,
  type ChannelConnectorAccount,
  type ChannelRouteBinding,
  type ExternalAccessPolicyMode,
} from '@shell/integration/desktop-api'
import { FeishuConnectorWizard } from './feishu'
import { WechatConnectorWizard } from './wechat/WechatConnectorWizard'
import { normalizeChannelAccountId, parseChannelBindingTarget } from './channel-bot-binding-model'

type ConnectorChannel = 'feishu' | 'telegram' | 'wechat'
type TelegramTargetBindingType = 'role' | 'agent'

interface ChannelWizardProps {
  locale: Locale
  workspaceId: string | null
  onClose: () => void
  onSuccess: (message: string) => void
  editingBinding: ChannelRouteBinding | null
  roles: AgentRole[]
  agents: AgentProfile[]
  connectorAccounts: ChannelConnectorAccount[]
  addedChannels: ConnectorChannel[]
  telegramWebhook: string
  feishuWebhook: string
  initialChannel?: ConnectorChannel
}

interface TelegramWizardForm {
  accountId: string
  peerKind: 'direct' | 'group'
  peerPattern: string
  targetBindingType: TelegramTargetBindingType
  targetRoleKey: string
  targetAgentId: string
  telegramBotToken: string
  priority: number
  policyMode: ExternalAccessPolicyMode
  approveIdentities: string
}

const TELEGRAM_STEP_COUNT = 2
const ROLE_TARGET_PREFIX = 'role:'

function normalizeRoleTarget(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith(ROLE_TARGET_PREFIX) ? trimmed : `${ROLE_TARGET_PREFIX}${trimmed}`
}

function normalizeAgentTarget(value: string): string {
  return value.trim()
}

function parseIdentities(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,;]/g).map((item) => item.trim()).filter(Boolean)))
}

function describeError(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return 'unknown'
}

function WizardStepBar({ total, current }: { total: number; current: number }) {
  return (
    <div className="channel-wizard-step-bar">
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={index}
          className={`channel-wizard-step-segment ${index === current ? 'active' : ''} ${index < current ? 'completed' : ''}`}
        />
      ))}
    </div>
  )
}

function ChannelChooser({
  locale,
  onSelect,
}: {
  locale: Locale
  onSelect: (channel: ConnectorChannel) => void
}) {
  return (
    <div className="channel-wizard-container">
      <header className="channel-wizard-header">
        <div className="channel-wizard-title" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h4>{t(locale, '选择通道', 'Choose Channel')}</h4>
            <span style={{ fontSize: '0.75rem', color: 'var(--vb-text-muted)' }}>{t(locale, '选择要接入的外部通道。', 'Select the external channel to connect.')}</span>
          </div>
        </div>
      </header>
      <div className="channel-wizard-body">
        <div className="channel-wizard-channel-grid">
          <button
            type="button"
            className="channel-wizard-channel-option wechat"
            onClick={() => onSelect('wechat')}
          >
            <span className="channel-wizard-channel-eyebrow">{t(locale, '微信', 'WeChat')}</span>
            <strong>{t(locale, '扫码 + 私聊路由', 'QR bind + DM routing')}</strong>
            <p>{t(locale, '桌面扫码绑定微信账号，把私聊稳定路由到 Agent。', 'Bind your WeChat on desktop via QR and route DMs to an Agent.')}</p>
          </button>
          <button
            type="button"
            className="channel-wizard-channel-option feishu"
            onClick={() => onSelect('feishu')}
          >
            <span className="channel-wizard-channel-eyebrow">{t(locale, '飞书 / Lark', 'Feishu / Lark')}</span>
            <strong>{t(locale, '长连接接入', 'WebSocket long connection')}</strong>
            <p>{t(locale, '企业自建应用，分步引导完成 WebSocket 接入。', 'Enterprise self-built app with step-by-step WebSocket onboarding.')}</p>
          </button>
          <button
            type="button"
            className="channel-wizard-channel-option telegram"
            onClick={() => onSelect('telegram')}
          >
            <span className="channel-wizard-channel-eyebrow">Telegram</span>
            <strong>{t(locale, 'Bot Token 接入', 'Bot Token onboarding')}</strong>
            <p>{t(locale, '适合 BotFather 模式，快速接入私聊 / 群组通道。', 'Quick onboarding via BotFather for direct or group chats.')}</p>
          </button>
        </div>
      </div>
    </div>
  )
}

function TelegramChannelWizard({
  locale,
  workspaceId,
  onSuccess,
  editingBinding,
  roles,
  agents,
  connectorAccounts,
  telegramWebhook,
  onBack,
}: Omit<ChannelWizardProps, 'addedChannels' | 'feishuWebhook'> & { onBack?: () => void }) {
  const activeRoles = useMemo(() => roles.filter((role) => role.status !== 'disabled'), [roles])
  const activeAgents = useMemo(() => agents.filter((agent) => agent.state !== 'terminated'), [agents])
  const roleLabelByKey = useMemo(() => {
    const map = new Map<string, string>()
    activeRoles.forEach((role) => {
      map.set(role.roleKey, role.roleName)
      map.set(role.id, role.roleName)
    })
    return map
  }, [activeRoles])
  const agentLabelById = useMemo(() => {
    const map = new Map<string, string>()
    activeAgents.forEach((agent) => map.set(agent.id, agent.name))
    return map
  }, [activeAgents])

  const defaultForm: TelegramWizardForm = useMemo(() => {
    if (editingBinding) {
      const target = parseChannelBindingTarget(editingBinding.targetAgentId)
      return {
        accountId: editingBinding.accountId ?? 'default',
        peerKind: editingBinding.peerKind === 'group' ? 'group' : 'direct',
        peerPattern: editingBinding.peerPattern ?? '',
        targetBindingType: target.type as TelegramTargetBindingType,
        targetRoleKey: target.type === 'role' ? target.value : '',
        targetAgentId: target.type === 'agent' ? target.value : '',
        telegramBotToken: '',
        priority: editingBinding.priority ?? 100,
        policyMode: 'open',
        approveIdentities: '',
      }
    }
    return {
      accountId: 'default',
      peerKind: 'direct',
      peerPattern: '',
      targetBindingType: 'role',
      targetRoleKey: activeRoles[0]?.roleKey ?? '',
      targetAgentId: activeAgents[0]?.id ?? '',
      telegramBotToken: '',
      priority: 100,
      policyMode: 'open',
      approveIdentities: '',
    }
  }, [activeAgents, activeRoles, editingBinding])

  const [form, setForm] = useState<TelegramWizardForm>(defaultForm)
  const [wizardStep, setWizardStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const normalizedAccountId = normalizeChannelAccountId(form.accountId)
  const hasToken = connectorAccounts.some(
    (account) => account.channel === 'telegram' && account.accountId === normalizedAccountId && account.hasBotToken,
  )

  const reviewTargetLabel =
    form.targetBindingType === 'role'
      ? roleLabelByKey.get(form.targetRoleKey) ?? form.targetRoleKey
      : agentLabelById.get(form.targetAgentId) ?? form.targetAgentId

  const canGoNext = useMemo(() => {
    if (wizardStep === 0) {
      return form.targetBindingType === 'role'
        ? Boolean(form.targetRoleKey.trim())
        : Boolean(form.targetAgentId.trim())
    }
    return true
  }, [form.targetAgentId, form.targetBindingType, form.targetRoleKey, wizardStep])

  const updateField = <K extends keyof TelegramWizardForm>(key: K, value: TelegramWizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const applyWizard = async () => {
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }

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
      if (!hasToken && !form.telegramBotToken.trim()) {
        setErrorMessage(t(locale, 'settings.channel.wizard.error.telegramTokenRequired'))
        setSaving(false)
        return
      }
      if (form.telegramBotToken.trim()) {
        await desktopApi.channelConnectorAccountUpsert({
          channel: 'telegram',
          accountId: normalizedAccountId,
          enabled: true,
          mode: 'polling',
          botToken: form.telegramBotToken.trim(),
        })
      }
      await desktopApi.channelBindingUpsert({
        workspaceId,
        channel: 'telegram',
        accountId: normalizedAccountId,
        peerKind: form.peerKind,
        peerPattern: form.peerPattern.trim() || null,
        targetAgentId: targetSelector,
        priority: Number.isFinite(form.priority) ? Math.floor(form.priority) : 100,
      })
      await desktopApi.channelAccessPolicySet('telegram', form.policyMode, normalizedAccountId)
      for (const identity of parseIdentities(form.approveIdentities)) {
        await desktopApi.channelAccessApprove('telegram', identity, normalizedAccountId)
      }
      onSuccess(t(locale, 'Telegram 通道已配置完成。', 'Telegram channel setup completed.'))
    } catch (error) {
      setErrorMessage(
        t(locale, '通道配置失败: {detail}', 'Channel setup failed: {detail}', {
          detail: describeError(error),
        }),
      )
      setSaving(false)
      return
    }
    setSaving(false)
  }

  const goNext = () => setWizardStep((v) => Math.min(TELEGRAM_STEP_COUNT - 1, v + 1))
  const goPrev = () => setWizardStep((v) => Math.max(0, v - 1))

  return (
    <div className="channel-wizard-container">
      <header className="channel-wizard-header">
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
                ? t(locale, '编辑 Telegram Channel', 'Edit Telegram Channel')
                : t(locale, '新增 Telegram Channel', 'Add Telegram Channel')}
            </h4>
          </div>
        </div>
      </header>

      <WizardStepBar total={TELEGRAM_STEP_COUNT} current={wizardStep} />

      <div className="channel-wizard-body">
        {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

        <div className="channel-wizard-step-animate" key={wizardStep}>
          {wizardStep === 0 && (
            <div className="settings-pane-section">
              <p className="channel-wizard-step-label">{t(locale, 'Step 1 — Bot 配置 & 路由', 'Step 1 — Bot Setup & Routing')}</p>
              {telegramWebhook && (
                <div className="settings-form-group">
                  <label>{t(locale, 'Webhook URL', 'Webhook URL')}</label>
                  <code className="channel-wizard-inline-code">{telegramWebhook}</code>
                </div>
              )}
              <div className="channel-wizard-two-column">
                <div className="settings-form-group">
                  <label>Account ID</label>
                  <input
                    className="settings-input"
                    value={form.accountId}
                    disabled={saving || Boolean(editingBinding)}
                    placeholder="default"
                    onChange={(event) => updateField('accountId', event.target.value)}
                  />
                </div>
                <div className="settings-form-group">
                  <label>{t(locale, 'Bot Token', 'Bot Token')}</label>
                  <input
                    type="password"
                    className="settings-input"
                    value={form.telegramBotToken}
                    disabled={saving}
                    placeholder={
                      hasToken
                        ? t(locale, '已保存；留空不更新', 'Saved; leave blank to keep')
                        : t(locale, '来自 BotFather', 'From BotFather')
                    }
                    onChange={(event) => updateField('telegramBotToken', event.target.value)}
                  />
                </div>
              </div>

              <div className="segmented-control" style={{ marginBottom: '1rem' }}>
                <button
                  type="button"
                  className={form.targetBindingType === 'role' ? 'active' : ''}
                  disabled={saving}
                  onClick={() => updateField('targetBindingType', 'role')}
                >
                  {t(locale, '绑定 Role', 'Bind Role')}
                </button>
                <button
                  type="button"
                  className={form.targetBindingType === 'agent' ? 'active' : ''}
                  disabled={saving}
                  onClick={() => updateField('targetBindingType', 'agent')}
                >
                  {t(locale, '绑定 Agent', 'Bind Agent')}
                </button>
              </div>

              <div className="channel-wizard-two-column">
                <div className="settings-form-group">
                  <label>{t(locale, '消息类型', 'Peer Kind')}</label>
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
                  {form.targetBindingType === 'role' ? (
                    <>
                      <label>{t(locale, '目标 Role', 'Target Role')}</label>
                      <select
                        className="settings-select"
                        value={form.targetRoleKey}
                        disabled={saving || activeRoles.length === 0}
                        onChange={(event) => updateField('targetRoleKey', event.target.value)}
                      >
                        {activeRoles.map((role) => (
                          <option key={role.id} value={role.roleKey}>
                            {role.roleName}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="settings-pane-section">
              <p className="channel-wizard-step-label">{t(locale, 'Step 2 — 准入策略 & 确认', 'Step 2 — Access Policy & Review')}</p>
              <div className="channel-wizard-two-column">
                <div className="settings-form-group">
                  <label>{t(locale, '准入策略', 'Access Policy')}</label>
                  <select
                    className="settings-select"
                    value={form.policyMode}
                    disabled={saving}
                    onChange={(event) => updateField('policyMode', event.target.value as ExternalAccessPolicyMode)}
                  >
                    <option value="open">open — {t(locale, '全部放行', 'Allow all')}</option>
                    <option value="pairing">pairing — {t(locale, '首次配对', 'First-time pairing')}</option>
                    <option value="allowlist">allowlist — {t(locale, '白名单', 'Allowlist')}</option>
                    <option value="disabled">disabled</option>
                  </select>
                </div>
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
              </div>
              <div className="settings-form-group">
                <label>{t(locale, '预授权 identities（可选）', 'Pre-approve identities (optional)')}</label>
                <textarea
                  className="settings-input"
                  rows={3}
                  value={form.approveIdentities}
                  disabled={saving}
                  placeholder={t(locale, '每行一个，或逗号分隔', 'One per line or comma-separated')}
                  onChange={(event) => updateField('approveIdentities', event.target.value)}
                />
              </div>

              <div className="feishu-inline-panel channel-wizard-review-panel">
                <ul className="feishu-review-list">
                  <li>
                    <span>Channel</span>
                    <strong>Telegram</strong>
                  </li>
                  <li>
                    <span>Account</span>
                    <strong>{normalizedAccountId}</strong>
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
                  <li>
                    <span>{t(locale, '策略', 'Policy')}</span>
                    <strong>{form.policyMode}</strong>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="channel-wizard-footer">
        <button
          type="button"
          className="settings-btn settings-btn-secondary"
          onClick={goPrev}
          disabled={saving || wizardStep === 0}
        >
          {t(locale, '上一步', 'Back')}
        </button>
        {wizardStep < TELEGRAM_STEP_COUNT - 1 ? (
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={goNext}
            disabled={saving || !canGoNext}
          >
            {t(locale, '下一步', 'Next')}
          </button>
        ) : (
          <button type="button" className="settings-btn settings-btn-primary" onClick={applyWizard} disabled={saving}>
            {saving ? t(locale, '保存中…', 'Saving…') : t(locale, '完成配置', 'Finish Setup')}
          </button>
        )}
      </footer>
    </div>
  )
}

export function ChannelWizard(props: ChannelWizardProps) {
  const { editingBinding, initialChannel, locale } = props
  const [selectedChannel, setSelectedChannel] = useState<ConnectorChannel | null>(
    initialChannel ?? (editingBinding?.channel as ConnectorChannel | undefined) ?? null,
  )

  if (!selectedChannel) {
    return <ChannelChooser locale={locale} onSelect={setSelectedChannel} />
  }

  const handleBack = () => {
    setSelectedChannel(null)
  }

  const onBack = !editingBinding ? handleBack : undefined

  if (selectedChannel === 'feishu') {
    return (
      <FeishuConnectorWizard
        locale={props.locale}
        workspaceId={props.workspaceId}
        onClose={props.onClose}
        onSuccess={props.onSuccess}
        editingBinding={props.editingBinding}
        roles={props.roles}
        agents={props.agents}
        connectorAccounts={props.connectorAccounts}
        onBack={onBack}
      />
    )
  }

  if (selectedChannel === 'wechat') {
    return (
      <WechatConnectorWizard
        locale={props.locale}
        workspaceId={props.workspaceId}
        onClose={props.onClose}
        onSuccess={props.onSuccess}
        editingBinding={props.editingBinding}
        roles={props.roles}
        agents={props.agents}
        connectorAccounts={props.connectorAccounts}
        onBack={onBack}
      />
    )
  }

  return (
    <TelegramChannelWizard
      locale={props.locale}
      workspaceId={props.workspaceId}
      onClose={props.onClose}
      onSuccess={props.onSuccess}
      editingBinding={props.editingBinding}
      roles={props.roles}
      agents={props.agents}
      connectorAccounts={props.connectorAccounts}
      telegramWebhook={props.telegramWebhook}
      onBack={onBack}
    />
  )
}
