import { useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  desktopApi,
  type AgentProfile,
  type ChannelConnectorAccount,
  type ChannelRouteBinding,
  type ExternalAccessPolicyMode,
} from '@shell/integration/desktop-api'
import { FeishuConnectorWizard } from './feishu'
import { WechatConnectorWizard } from './wechat/WechatConnectorWizard'
import { ChannelWizardFrame } from './ChannelWizardFrame'
import { normalizeChannelAccountId, parseChannelBindingTarget } from './channel-bot-binding-model'

type ConnectorChannel = 'feishu' | 'telegram' | 'wechat'

interface ChannelWizardProps {
  locale: Locale
  workspaceId: string | null
  onClose: () => void
  onSuccess: (message: string) => void
  editingBinding: ChannelRouteBinding | null
  agents: AgentProfile[]
  connectorAccounts: ChannelConnectorAccount[]
  addedChannels: ConnectorChannel[]
  telegramWebhook: string
  feishuWebhook: string
  initialChannel?: ConnectorChannel
  embedded?: boolean
}

interface TelegramWizardForm {
  accountId: string
  peerKind: 'direct' | 'group'
  peerPattern: string
  targetAgentId: string
  telegramBotToken: string
  priority: number
  policyMode: ExternalAccessPolicyMode
  approveIdentities: string
}

const TELEGRAM_STEP_COUNT = 2
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
            <p>{t(locale, '扫码即可自动创建应用并连接，无需手动操作。', 'Scan QR to auto-create app and connect. No manual setup needed.')}</p>
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
  agents,
  connectorAccounts,
  telegramWebhook,
  onBack,
  embedded = false,
}: Omit<ChannelWizardProps, 'addedChannels' | 'feishuWebhook'> & { onBack?: () => void; embedded?: boolean }) {
  const activeAgents = useMemo(() => agents.filter((agent) => agent.state !== 'terminated'), [agents])

  const defaultForm: TelegramWizardForm = useMemo(() => {
    if (editingBinding) {
      const target = parseChannelBindingTarget(editingBinding.targetAgentId)
      return {
        accountId: editingBinding.accountId ?? 'default',
        peerKind: editingBinding.peerKind === 'group' ? 'group' : 'direct',
        peerPattern: editingBinding.peerPattern ?? '',
        targetAgentId: target.type === 'agent' ? target.value : activeAgents[0]?.id ?? '',
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
      targetAgentId: activeAgents[0]?.id ?? '',
      telegramBotToken: '',
      priority: 100,
      policyMode: 'open',
      approveIdentities: '',
    }
  }, [activeAgents, editingBinding])

  const [form, setForm] = useState<TelegramWizardForm>(defaultForm)
  const [wizardStep, setWizardStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const normalizedAccountId = normalizeChannelAccountId(form.accountId)
  const hasToken = connectorAccounts.some(
    (account) => account.channel === 'telegram' && account.accountId === normalizedAccountId && account.hasBotToken,
  )

  const canGoNext = useMemo(() => {
    if (wizardStep === 0) {
      const hasTarget = Boolean(form.targetAgentId.trim())
      const hasTokenInput = Boolean(form.telegramBotToken.trim())
      return hasTarget && (hasToken || hasTokenInput)
    }
    return true
  }, [form.targetAgentId, form.telegramBotToken, hasToken, wizardStep])

  const updateField = <K extends keyof TelegramWizardForm>(key: K, value: TelegramWizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const applyWizard = async () => {
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }

    const targetSelector = normalizeAgentTarget(form.targetAgentId)
    if (!targetSelector) {
      setErrorMessage(t(locale, '请选择目标 Agent。', 'Select a target Agent first.'))
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

  const wizardTitle = editingBinding
    ? t(locale, '编辑 Telegram Channel', 'Edit Telegram Channel')
    : t(locale, '新增 Telegram Channel', 'Add Telegram Channel')

  const wizardFooter = (
    <>
      <button
        type="button"
        className="settings-btn settings-btn-secondary"
        onClick={() => setWizardStep((v) => Math.max(0, v - 1))}
        disabled={saving || wizardStep === 0}
      >
        {t(locale, '上一步', 'Previous')}
      </button>
      {wizardStep < TELEGRAM_STEP_COUNT - 1 ? (
        <button
          type="button"
          className="settings-btn settings-btn-primary"
          onClick={() => setWizardStep((v) => Math.min(TELEGRAM_STEP_COUNT - 1, v + 1))}
          disabled={saving || !canGoNext}
        >
          {t(locale, '下一步', 'Next')}
        </button>
      ) : (
        <button type="button" className="settings-btn settings-btn-primary" onClick={applyWizard} disabled={saving}>
          {saving ? t(locale, '应用中...', 'Applying...') : t(locale, '应用配置', 'Apply Configuration')}
        </button>
      )}
    </>
  )

  return (
    <ChannelWizardFrame
      locale={locale}
      embedded={embedded}
      title={wizardTitle}
      stepCount={TELEGRAM_STEP_COUNT}
      wizardStep={wizardStep}
      saving={saving}
      onBack={onBack}
      footer={wizardFooter}
    >
      {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

      <div className="channel-wizard-step-animate" key={wizardStep}>
        {wizardStep === 0 && (
          <div className="channel-wizard-form-stack">
            <p className="channel-wizard-step-desc">
              {t(
                locale,
                '填写 BotFather 提供的 Token，并选择消息路由目标。',
                'Enter the BotFather token and choose where messages are routed.',
              )}
            </p>
            {telegramWebhook ? (
              <div className="settings-form-group">
                <label>{t(locale, 'Webhook URL（参考）', 'Webhook URL (reference)')}</label>
                <code className="channel-wizard-inline-code">{telegramWebhook}</code>
              </div>
            ) : null}
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
            </div>
            <div className="settings-form-group">
              <label>{t(locale, 'Peer Pattern（可选）', 'Peer Pattern (optional)')}</label>
              <input
                className="settings-input"
                value={form.peerPattern}
                disabled={saving}
                placeholder={t(locale, '默认匹配全部', 'Match all by default')}
                onChange={(event) => updateField('peerPattern', event.target.value)}
              />
            </div>
          </div>
        )}

        {wizardStep === 1 && (
          <div className="channel-wizard-form-stack">
            <p className="channel-wizard-step-desc">
              {t(locale, '设置外部消息的准入策略。', 'Configure how external messages are admitted.')}
            </p>
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
          </div>
        )}
      </div>
    </ChannelWizardFrame>
  )
}

export function ChannelWizard(props: ChannelWizardProps) {
  const { editingBinding, initialChannel, locale, embedded = false } = props
  const [selectedChannel, setSelectedChannel] = useState<ConnectorChannel | null>(
    initialChannel ?? (editingBinding?.channel as ConnectorChannel | undefined) ?? null,
  )

  if (!selectedChannel) {
    return <ChannelChooser locale={locale} onSelect={setSelectedChannel} />
  }

  const handleBack = () => {
    setSelectedChannel(null)
  }

  const onBack = !embedded && !editingBinding && !initialChannel ? handleBack : undefined

  if (selectedChannel === 'feishu') {
    return (
      <FeishuConnectorWizard
        locale={props.locale}
        workspaceId={props.workspaceId}
        onClose={props.onClose}
        onSuccess={props.onSuccess}
        editingBinding={props.editingBinding}
        agents={props.agents}
        connectorAccounts={props.connectorAccounts}
        onBack={onBack}
        embedded={embedded}
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
        agents={props.agents}
        connectorAccounts={props.connectorAccounts}
        onBack={onBack}
        embedded={embedded}
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
      agents={props.agents}
      connectorAccounts={props.connectorAccounts}
      telegramWebhook={props.telegramWebhook}
      onBack={onBack}
      embedded={embedded}
    />
  )
}
