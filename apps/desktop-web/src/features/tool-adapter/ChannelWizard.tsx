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
import { normalizeChannelAccountId, parseChannelBindingTarget } from './channel-bot-binding-model'

type ConnectorChannel = 'feishu' | 'telegram'
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

const TELEGRAM_STEP_COUNT = 4
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

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value.trim()) return false
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
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
        <div className="channel-wizard-title">
          <h4>{t(locale, '选择 Channel', 'Choose Channel')}</h4>
          <p>{t(locale, '先选择要接入的外部通道。', 'Choose the external channel to connect first.')}</p>
        </div>
      </header>
      <div className="channel-wizard-body">
        <div className="channel-wizard-channel-grid">
          <button
            type="button"
            className="channel-wizard-channel-option"
            onClick={() => onSelect('telegram')}
          >
            <span className="channel-wizard-channel-eyebrow">Telegram</span>
            <strong>{t(locale, 'Bot Token + polling/webhook', 'Bot Token + polling/webhook')}</strong>
            <p>{t(locale, '适合 BotFather 模式的快速接入。', 'Good for quick onboarding with BotFather.')}</p>
          </button>
          <button
            type="button"
            className="channel-wizard-channel-option feishu"
            onClick={() => onSelect('feishu')}
          >
            <span className="channel-wizard-channel-eyebrow">Feishu</span>
            <strong>{t(locale, '分步引导式接入', 'Guided step-by-step onboarding')}</strong>
            <p>{t(locale, '包含开放平台配置说明、连接测试与 callback 校验。', 'Includes Open Platform guidance, connection testing, and callback validation.')}</p>
          </button>
        </div>
      </div>
    </div>
  )
}

function TelegramChannelWizard({
  locale,
  workspaceId,
  onClose,
  onSuccess,
  editingBinding,
  roles,
  agents,
  connectorAccounts,
  telegramWebhook,
}: Omit<ChannelWizardProps, 'addedChannels' | 'feishuWebhook'>) {
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
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
    if (wizardStep === 1) {
      return form.targetBindingType === 'role'
        ? Boolean(form.targetRoleKey.trim())
        : Boolean(form.targetAgentId.trim())
    }
    return true
  }, [form.targetAgentId, form.targetBindingType, form.targetRoleKey, wizardStep])

  const updateField = <K extends keyof TelegramWizardForm>(key: K, value: TelegramWizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(telegramWebhook)
    if (ok) {
      setStatusMessage(t(locale, '地址已复制。', 'Address copied.'))
    } else {
      setErrorMessage(t(locale, '复制失败，请手动复制。', 'Copy failed. Please copy manually.'))
    }
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

  return (
    <div className="channel-wizard-container">
      <header className="channel-wizard-header">
        <div className="channel-wizard-title">
          <h4>
            {editingBinding
              ? t(locale, '编辑 Telegram Channel', 'Edit Telegram Channel')
              : t(locale, '新增 Telegram Channel', 'Add Telegram Channel')}
          </h4>
          <p>{t(locale, 'Step {step}/{total}', 'Step {step}/{total}', { step: wizardStep + 1, total: TELEGRAM_STEP_COUNT })}</p>
        </div>
        <button type="button" className="settings-content-close" onClick={onClose} disabled={saving}>
          ×
        </button>
      </header>

      <div className="channel-wizard-steps-indicator">
        {Array.from({ length: TELEGRAM_STEP_COUNT }).map((_, index) => (
          <div
            key={index}
            className={`channel-wizard-step-dot ${index === wizardStep ? 'active' : ''} ${index < wizardStep ? 'completed' : ''}`}
          />
        ))}
      </div>

      <div className="channel-wizard-body">
        {statusMessage && <div className="settings-channel-message">{statusMessage}</div>}
        {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

        {wizardStep === 0 && (
          <div className="settings-pane-section">
            <h4>{t(locale, 'Step 1 配置 Telegram Bot', 'Step 1 Configure Telegram Bot')}</h4>
            <div className="settings-form-group">
              <label>{t(locale, 'Webhook URL', 'Webhook URL')}</label>
              <div className="channel-wizard-inline-row">
                <code className="channel-wizard-inline-code">{telegramWebhook || '-'}</code>
                <button type="button" className="settings-btn settings-btn-secondary" disabled={!telegramWebhook} onClick={handleCopy}>
                  {t(locale, '复制地址', 'Copy URL')}
                </button>
              </div>
            </div>
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
              <label>{t(locale, 'Telegram Bot Token（来自 BotFather）', 'Telegram Bot Token (from BotFather)')}</label>
              <input
                type="password"
                className="settings-input"
                value={form.telegramBotToken}
                disabled={saving}
                placeholder={
                  hasToken
                    ? t(locale, '已保存；留空表示不更新', 'Already saved; leave blank to keep current value')
                    : t(locale, '粘贴 Telegram Bot Token', 'Paste Telegram Bot Token')
                }
                onChange={(event) => updateField('telegramBotToken', event.target.value)}
              />
            </div>
          </div>
        )}

        {wizardStep === 1 && (
          <div className="settings-pane-section">
            <h4>{t(locale, 'Step 2 绑定 route 目标', 'Step 2 Bind the route target')}</h4>
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
            <div className="channel-wizard-two-column">
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
          </div>
        )}

        {wizardStep === 2 && (
          <div className="settings-pane-section">
            <h4>{t(locale, 'Step 3 配置准入策略', 'Step 3 Configure the access policy')}</h4>
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
          </div>
        )}

        {wizardStep === 3 && (
          <div className="settings-pane-section">
            <h4>{t(locale, 'Step 4 确认并应用', 'Step 4 Review and apply')}</h4>
            <div className="feishu-inline-panel">
              <ul className="feishu-review-list">
                <li>
                  <span>{t(locale, 'Channel', 'Channel')}</span>
                  <strong>Telegram</strong>
                </li>
                <li>
                  <span>Account ID</span>
                  <strong>{normalizedAccountId}</strong>
                </li>
                <li>
                  <span>{t(locale, 'Target', 'Target')}</span>
                  <strong>{reviewTargetLabel}</strong>
                </li>
                <li>
                  <span>{t(locale, 'Peer Match', 'Peer Match')}</span>
                  <strong>
                    {form.peerKind} / {form.peerPattern || '*'}
                  </strong>
                </li>
              </ul>
            </div>
          </div>
        )}
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
        {wizardStep < TELEGRAM_STEP_COUNT - 1 ? (
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={() => setWizardStep((value) => Math.min(TELEGRAM_STEP_COUNT - 1, value + 1))}
            disabled={saving || !canGoNext}
          >
            {t(locale, '下一步', 'Next')}
          </button>
        ) : (
          <button type="button" className="settings-btn settings-btn-primary" onClick={applyWizard} disabled={saving}>
            {saving ? t(locale, '应用中...', 'Applying...') : t(locale, '应用配置', 'Apply Configuration')}
          </button>
        )}
      </footer>
    </div>
  )
}

export function ChannelWizard(props: ChannelWizardProps) {
  const { editingBinding, locale } = props
  const [selectedChannel, setSelectedChannel] = useState<ConnectorChannel | null>(
    editingBinding ? (editingBinding.channel as ConnectorChannel) : null,
  )

  if (!selectedChannel) {
    return <ChannelChooser locale={locale} onSelect={setSelectedChannel} />
  }

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
    />
  )
}
