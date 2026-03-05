import { useMemo, useState } from 'react'
import { t, type Locale } from '../../i18n/ui-locale'
import {
  desktopApi,
  type AgentRole,
  type AgentProfile,
  type ChannelConnectorAccount,
  type ChannelRouteBinding,
  type ExternalAccessPolicyMode,
} from '../../integration/desktop-api'
import {
  normalizeChannelAccountId,
  parseChannelBindingTarget,
} from '../channel-bot-binding-model'

type ConnectorChannel = 'feishu' | 'telegram'

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

interface WizardForm {
  channel: ConnectorChannel
  accountId: string
  peerKind: 'direct' | 'group'
  peerPattern: string
  targetBindingType: 'role' | 'agent'
  targetRoleKey: string
  targetAgentId: string
  telegramBotToken: string
  priority: number
  policyMode: ExternalAccessPolicyMode
  approveIdentities: string
}

const WIZARD_STEP_COUNT = 4
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
  return Array.from(new Set(value.split(/[\n,;]/g).map((e) => e.trim()).filter((e) => e.length > 0)))
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

export function ChannelWizard({
  locale,
  workspaceId,
  onClose,
  onSuccess,
  editingBinding,
  roles,
  agents,
  connectorAccounts,
  addedChannels,
  telegramWebhook,
  feishuWebhook,
}: ChannelWizardProps) {
  const [saving, setSaving] = useState(false)
  const [wizardStep, setWizardStep] = useState(editingBinding ? 1 : 0)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)


  const activeRoles = useMemo(() => roles.filter((role) => role.status !== 'disabled'), [roles])
  const activeAgents = useMemo(() => agents.filter((agent) => agent.state !== 'terminated'), [agents])

  const roleLabelByKey = useMemo(() => {
    const map = new Map<string, string>()
    activeRoles.forEach((r) => { map.set(r.roleKey, r.roleName); map.set(r.id, r.roleName) })
    return map
  }, [activeRoles])

  const agentLabelById = useMemo(() => {
    const map = new Map<string, string>()
    activeAgents.forEach((a) => { map.set(a.id, a.name) })
    return map
  }, [activeAgents])

  const defaultForm: WizardForm = useMemo(() => {
    if (editingBinding) {
      const target = parseChannelBindingTarget(editingBinding.targetAgentId)
      return {
        channel: editingBinding.channel as ConnectorChannel,
        accountId: editingBinding.accountId ?? 'default',
        peerKind: editingBinding.peerKind === 'group' ? 'group' : 'direct',
        peerPattern: editingBinding.peerPattern ?? '',
        targetBindingType: target.type as 'role' | 'agent',
        targetRoleKey: target.type === 'role' ? target.value : '',
        targetAgentId: target.type === 'agent' ? target.value : '',
        telegramBotToken: '',
        priority: editingBinding.priority ?? 100,
        policyMode: 'open',
        approveIdentities: '',
      }
    }
    const defaultRole = activeRoles[0]?.roleKey ?? ''
    const defaultAgent = activeAgents[0]?.id ?? ''
    const defaultChannel: ConnectorChannel = addedChannels[0] || 'telegram'
    return {
      channel: defaultChannel,
      accountId: 'default',
      peerKind: 'direct',
      peerPattern: '',
      targetBindingType: 'role',
      targetRoleKey: defaultRole,
      targetAgentId: defaultAgent,
      telegramBotToken: '',
      priority: 100,
      policyMode: 'open',
      approveIdentities: '',
    }
  }, [editingBinding, activeRoles, activeAgents, addedChannels])

  const [wizardForm, setWizardForm] = useState<WizardForm>(defaultForm)
  const currentWebhook = wizardForm.channel === 'telegram' ? telegramWebhook : feishuWebhook

  const updateWizardField = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => {
    setWizardForm((prev) => ({ ...prev, [key]: value }))
  }

  const canGoNext = useMemo(() => {
    if (wizardStep === 1) {
      if (wizardForm.targetBindingType === 'role') return wizardForm.targetRoleKey.trim().length > 0
      return wizardForm.targetAgentId.trim().length > 0
    }
    return true
  }, [wizardStep, wizardForm.targetBindingType, wizardForm.targetRoleKey, wizardForm.targetAgentId])

  const handleCopy = async (value: string) => {
    const ok = await copyTextToClipboard(value)
    if (ok) setStatusMessage(t(locale, '地址已复制。', 'Address copied.'))
    else setErrorMessage(t(locale, '复制失败，请手动复制。', 'Copy failed. Please copy manually.'))
  }

  const applyWizard = async () => {
    if (!desktopApi.isTauriRuntime()) return
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }

    const targetSelector = wizardForm.targetBindingType === 'role'
      ? normalizeRoleTarget(wizardForm.targetRoleKey)
      : normalizeAgentTarget(wizardForm.targetAgentId)
    const normalizedAccountId = normalizeChannelAccountId(wizardForm.accountId)

    if (!targetSelector) {
      setErrorMessage(t(locale, 'settings.channel.wizard.error.targetRequired'))
      return
    }

    setSaving(true)
    setErrorMessage(null)

    try {
      if (wizardForm.channel === 'telegram') {
        const hasToken = connectorAccounts.some(a => a.channel === 'telegram' && a.accountId === normalizedAccountId && a.hasBotToken)
        if (!hasToken && !wizardForm.telegramBotToken.trim() && !editingBinding) {
           setErrorMessage(t(locale, 'settings.channel.wizard.error.telegramTokenRequired'))
           setSaving(false)
           return
        }

        if (wizardForm.telegramBotToken.trim()) {
          await desktopApi.channelConnectorAccountUpsert({
            channel: 'telegram',
            accountId: normalizedAccountId,
            enabled: true,
            mode: 'polling',
            botToken: wizardForm.telegramBotToken.trim(),
          })
        }
      }

      await desktopApi.channelBindingUpsert({
        workspaceId,
        channel: wizardForm.channel,
        accountId: normalizedAccountId,
        peerKind: wizardForm.peerKind,
        peerPattern: wizardForm.peerPattern.trim() || null,
        targetAgentId: targetSelector,
        priority: Number.isFinite(wizardForm.priority) ? Math.floor(wizardForm.priority) : 100,
      })

      await desktopApi.channelAccessPolicySet(wizardForm.channel, wizardForm.policyMode, normalizedAccountId)

      const identities = parseIdentities(wizardForm.approveIdentities)
      for (const identity of identities) {
        await desktopApi.channelAccessApprove(wizardForm.channel, identity, normalizedAccountId)
      }

      onSuccess(t(locale, '{channel} 通道已配置完成。', '{channel} channel setup completed.', { channel: wizardForm.channel }))
    } catch (error) {
      setErrorMessage(t(locale, '通道配置失败: {detail}', 'Channel setup failed: {detail}', { detail: describeError(error) }))
      setSaving(false)
    }
  }



  const reviewTargetLabel = wizardForm.targetBindingType === 'role'
    ? roleLabelByKey.get(wizardForm.targetRoleKey) ?? wizardForm.targetRoleKey
    : agentLabelById.get(wizardForm.targetAgentId) ?? wizardForm.targetAgentId

  return (
    <div className="channel-wizard-container">
      <header className="channel-wizard-header">
        <div className="channel-wizard-title">
          <h4>{editingBinding ? t(locale, '编辑 Channel 路由', 'Edit Channel Route') : t(locale, '添加 Channel 向导', 'Add Channel Wizard')}</h4>
          <p>{t(locale, 'Step {step}/{total}', 'Step {step}/{total}', { step: wizardStep + 1, total: WIZARD_STEP_COUNT })}</p>
        </div>
        <button type="button" className="settings-content-close" onClick={onClose} disabled={saving}>×</button>
      </header>

      <div className="channel-wizard-steps-indicator">
        {Array.from({ length: WIZARD_STEP_COUNT }).map((_, idx) => (
          <div key={idx} className={`channel-wizard-step-dot ${idx === wizardStep ? 'active' : ''} ${idx < wizardStep ? 'completed' : ''}`} />
        ))}
      </div>

      <div className="channel-wizard-body">
        {statusMessage && <div style={{ color: 'var(--vb-success)', marginBottom: 16 }}>{statusMessage}</div>}
        {errorMessage && <div style={{ color: 'var(--vb-error)', marginBottom: 16 }}>{errorMessage}</div>}

        {wizardStep === 0 && (
          <div>
            <div className="settings-pane-section">
              <h4>{t(locale, 'Step 1 选择通道并绑定 webhook', 'Step 1 Select channel and webhook')}</h4>
              
              <div className="settings-form-group">
                <div className="segmented-control" style={{ marginBottom: 16 }}>
                  <button type="button" className={wizardForm.channel === 'telegram' ? 'active' : ''} onClick={() => updateWizardField('channel', 'telegram')} disabled={saving || !!editingBinding}>Telegram</button>
                  <button type="button" className={wizardForm.channel === 'feishu' ? 'active' : ''} onClick={() => updateWizardField('channel', 'feishu')} disabled={saving || !!editingBinding}>{t(locale, '飞书', 'Feishu')}</button>
                </div>

                <label>{t(locale, '回调地址', 'Webhook URL')}</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <code style={{ flex: 1, padding: '8px 12px', background: 'var(--vb-input-bg)', borderRadius: 8, border: '1px solid var(--vb-input-border)' }}>{currentWebhook || '-'}</code>
                  <button type="button" className="settings-btn settings-btn-secondary" disabled={!currentWebhook} onClick={() => handleCopy(currentWebhook)}>Copy</button>
                </div>

                <div className="settings-form-group">
                  <label>Account ID</label>
                  <input className="settings-input" value={wizardForm.accountId} disabled={saving || !!editingBinding} placeholder="default" onChange={(e) => updateWizardField('accountId', e.target.value)} />
                </div>

                {wizardForm.channel === 'telegram' && (
                  <div className="settings-form-group">
                    <label>{t(locale, 'Telegram Bot Token（来自 BotFather）', 'Telegram Bot Token (from BotFather)')}</label>
                    <input type="password" className="settings-input" value={wizardForm.telegramBotToken} disabled={saving} placeholder={t(locale, '粘贴 Telegram Bot Token (若已有可留空)', 'Paste Telegram Bot Token (Leave empty if already set)')} onChange={(e) => updateWizardField('telegramBotToken', e.target.value)} />
                    <span className="hint">The token is only required when setting up for the first time or updating it.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {wizardStep === 1 && (
          <div>
            <div className="settings-pane-section">
              <h4>{t(locale, 'settings.channel.wizard.step2.title')}</h4>
              
              <div className="segmented-control" style={{ marginBottom: 16 }}>
                <button type="button" className={wizardForm.targetBindingType === 'agent' ? 'active' : ''} onClick={() => updateWizardField('targetBindingType', 'agent')} disabled={saving}>{t(locale, 'settings.channel.wizard.step2.bindAgent')}</button>
                <button type="button" className={wizardForm.targetBindingType === 'role' ? 'active' : ''} onClick={() => updateWizardField('targetBindingType', 'role')} disabled={saving}>{t(locale, 'settings.channel.wizard.step2.bindRole')}</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="settings-form-group">
                  <label>{t(locale, '会话类型', 'Peer Kind')}</label>
                  <select className="settings-select" value={wizardForm.peerKind} disabled={saving} onChange={(e) => updateWizardField('peerKind', e.target.value as 'direct' | 'group')}>
                    <option value="direct">Direct</option>
                    <option value="group">Group</option>
                  </select>
                </div>

                <div className="settings-form-group">
                  <label>{t(locale, 'Peer Pattern（可选）', 'Peer Pattern (optional)')}</label>
                  <input className="settings-input" value={wizardForm.peerPattern} disabled={saving} onChange={(e) => updateWizardField('peerPattern', e.target.value)} />
                </div>
              </div>

              {wizardForm.targetBindingType === 'role' ? (
                <div className="settings-form-group">
                  <label>{t(locale, 'settings.channel.wizard.step2.roleSelect')}</label>
                  <select className="settings-select" value={wizardForm.targetRoleKey} disabled={saving || activeRoles.length === 0} onChange={(e) => updateWizardField('targetRoleKey', e.target.value)}>
                    {activeRoles.length === 0 && <option value="">{t(locale, 'settings.channel.wizard.step2.emptyRole')}</option>}
                    {activeRoles.map(r => <option key={r.id} value={r.roleKey}>{r.roleName} ({r.roleKey})</option>)}
                  </select>
                </div>
              ) : (
                <div className="settings-form-group">
                  <label>{t(locale, 'settings.channel.wizard.step2.agentSelect')}</label>
                  <select className="settings-select" value={wizardForm.targetAgentId} disabled={saving || activeAgents.length === 0} onChange={(e) => updateWizardField('targetAgentId', e.target.value)}>
                    {activeAgents.length === 0 && <option value="">{t(locale, 'settings.channel.wizard.step2.emptyAgent')}</option>}
                    {activeAgents.map(a => <option key={a.id} value={a.id}>{agentLabelById.get(a.id) ?? a.name}</option>)}
                  </select>
                </div>
              )}

              <div className="settings-form-group">
                <label>{t(locale, '优先级', 'Priority')}</label>
                <input type="number" className="settings-input" value={wizardForm.priority} disabled={saving} onChange={(e) => updateWizardField('priority', Number(e.target.value))} />
              </div>

            </div>
          </div>
        )}

        {wizardStep === 2 && (
          <div>
            <div className="settings-pane-section">
              <h4>{t(locale, 'Step 3 准入策略与授权', 'Step 3 Access policy & approvals')}</h4>
              
              <div className="settings-form-group">
                <label>{t(locale, '策略模式', 'Policy Mode')}</label>
                <select className="settings-select" value={wizardForm.policyMode} disabled={saving} onChange={(e) => updateWizardField('policyMode', e.target.value as ExternalAccessPolicyMode)}>
                  <option value="pairing">pairing</option>
                  <option value="allowlist">allowlist</option>
                  <option value="open">open</option>
                  <option value="disabled">disabled</option>
                </select>
              </div>

              <div className="settings-form-group">
                <label>{t(locale, '预授权 identities（可选）', 'Pre-approve identities (optional)')}</label>
                <textarea className="settings-input" rows={4} value={wizardForm.approveIdentities} disabled={saving} placeholder={t(locale, '每行一个，或逗号分隔', 'One per line, or comma-separated')} onChange={(e) => updateWizardField('approveIdentities', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {wizardStep === 3 && (
          <div>
            <div className="settings-pane-section">
              <h4>{t(locale, 'Step 4 确认并应用', 'Step 4 Review and apply')}</h4>
              <div style={{ background: 'var(--vb-surface-muted)', borderRadius: 12, padding: 20 }}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                  <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t(locale, '通道', 'Channel')}</span><strong>{wizardForm.channel}</strong></li>
                  <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Account ID</span><strong>{normalizeChannelAccountId(wizardForm.accountId)}</strong></li>
                  <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Target</span><strong>{reviewTargetLabel}</strong></li>
                  <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Peer Match</span><strong>{wizardForm.peerKind} / {wizardForm.peerPattern || '*'}</strong></li>
                  <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Policy</span><strong>{wizardForm.policyMode}</strong></li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="channel-wizard-footer">
        <button type="button" className="settings-btn settings-btn-secondary" onClick={() => setWizardStep(p => Math.max(0, p - 1))} disabled={saving || wizardStep === 0}>
          {t(locale, '上一步', 'Previous')}
        </button>
        {wizardStep < WIZARD_STEP_COUNT - 1 ? (
          <button type="button" className="settings-btn settings-btn-primary" onClick={() => setWizardStep(p => Math.min(WIZARD_STEP_COUNT - 1, p + 1))} disabled={saving || !canGoNext}>
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
