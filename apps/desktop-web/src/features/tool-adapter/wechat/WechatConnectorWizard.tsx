import { useEffect, useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  desktopApi,
  type AgentProfile,
  type AgentRole,
  type ChannelConnectorAccount,
  type ChannelRouteBinding,
  type ChannelConnectorHealthResponse,
  type ExternalAccessPolicyMode,
  type WechatAuthSession,
} from '@shell/integration/desktop-api'
import { normalizeChannelAccountId, parseChannelBindingTarget } from '../channel-bot-binding-model'

interface WechatConnectorWizardProps {
  locale: Locale
  workspaceId: string | null
  onClose: () => void
  onSuccess: (message: string) => void
  editingBinding: ChannelRouteBinding | null
  roles: AgentRole[]
  agents: AgentProfile[]
  connectorAccounts: ChannelConnectorAccount[]
}

type TargetBindingType = 'role' | 'agent'

interface WechatWizardForm {
  accountId: string
  targetBindingType: TargetBindingType
  targetRoleKey: string
  targetAgentId: string
  peerPattern: string
  priority: number
  policyMode: ExternalAccessPolicyMode
  approveIdentities: string
}

const ROLE_TARGET_PREFIX = 'role:'
const STEP_COUNT = 4

function normalizeRoleTarget(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith(ROLE_TARGET_PREFIX) ? trimmed : `${ROLE_TARGET_PREFIX}${trimmed}`
}

function parseIdentities(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,;]/g).map((item) => item.trim()).filter(Boolean)))
}

function describeError(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return 'unknown'
}

function healthPillClass(health: ChannelConnectorHealthResponse['health'] | null): string {
  if (!health) return 'idle'
  if (health.ok) return 'ok'
  if (health.status === 'scanned' || health.status === 'awaiting_scan') return 'pending'
  return 'error'
}

function statusPillClass(status: string | null, ok: boolean): string {
  if (ok || status === 'confirmed') return 'ok'
  if (!status || status === 'unbound') return 'idle'
  if (status === 'scanned' || status === 'awaiting_scan') return 'pending'
  return 'error'
}

export function WechatConnectorWizard({
  locale,
  workspaceId,
  onClose,
  onSuccess,
  editingBinding,
  roles,
  agents,
  connectorAccounts,
}: WechatConnectorWizardProps) {
  const activeRoles = useMemo(() => roles.filter((role) => role.status !== 'disabled'), [roles])
  const activeAgents = useMemo(() => agents.filter((agent) => agent.state !== 'terminated'), [agents])
  const [wizardStep, setWizardStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [healthSnapshot, setHealthSnapshot] = useState<ChannelConnectorHealthResponse['health'] | null>(null)
  const [authSession, setAuthSession] = useState<WechatAuthSession | null>(null)

  const defaultForm = useMemo<WechatWizardForm>(() => {
    if (editingBinding) {
      const target = parseChannelBindingTarget(editingBinding.targetAgentId)
      return {
        accountId: editingBinding.accountId ?? 'default',
        targetBindingType: target.type as TargetBindingType,
        targetRoleKey: target.type === 'role' ? target.value : activeRoles[0]?.roleKey ?? '',
        targetAgentId: target.type === 'agent' ? target.value : activeAgents[0]?.id ?? '',
        peerPattern: editingBinding.peerPattern ?? '',
        priority: editingBinding.priority ?? 100,
        policyMode: 'open',
        approveIdentities: '',
      }
    }
    return {
      accountId: 'default',
      targetBindingType: 'role',
      targetRoleKey: activeRoles[0]?.roleKey ?? '',
      targetAgentId: activeAgents[0]?.id ?? '',
      peerPattern: '',
      priority: 100,
      policyMode: 'open',
      approveIdentities: '',
    }
  }, [activeAgents, activeRoles, editingBinding])

  const [form, setForm] = useState<WechatWizardForm>(defaultForm)
  const normalizedAccountId = normalizeChannelAccountId(form.accountId)
  const accountRecord = useMemo(
    () =>
      connectorAccounts.find(
        (account) =>
          account.channel === 'wechat' &&
          normalizeChannelAccountId(account.accountId).toLowerCase() === normalizedAccountId.toLowerCase(),
      ) ?? null,
    [connectorAccounts, normalizedAccountId],
  )
  const hasBoundToken = Boolean(accountRecord?.hasToken || authSession?.status === 'confirmed')

  useEffect(() => {
    if (!authSession) {
      return
    }
    if (['confirmed', 'expired', 'cancelled'].includes(authSession.status)) {
      return
    }
    const timerId = window.setTimeout(async () => {
      try {
        const response = await desktopApi.channelConnectorWechatAuthStatus(authSession.authSessionId)
        setAuthSession(response.session)
        if (response.session.status === 'confirmed') {
          setWizardStep((value) => Math.max(value, 1))
          setStatusMessage(t(locale, '微信绑定成功，继续做连接验证。', 'WeChat bound successfully. Continue to verification.'))
          setErrorMessage(null)
        }
      } catch (error) {
        setErrorMessage(
          t(locale, '二维码状态更新失败: {detail}', 'Failed to refresh QR status: {detail}', {
            detail: describeError(error),
          }),
        )
      }
    }, 1200)
    return () => window.clearTimeout(timerId)
  }, [authSession, locale])

  const updateField = <K extends keyof WechatWizardForm>(key: K, value: WechatWizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

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

  const reviewTargetLabel =
    form.targetBindingType === 'role'
      ? roleLabelByKey.get(form.targetRoleKey) ?? form.targetRoleKey
      : agentLabelById.get(form.targetAgentId) ?? form.targetAgentId
  const isScanStep = wizardStep === 0
  const currentStatus = healthSnapshot?.status ?? authSession?.status ?? t(locale, '未绑定', 'Unbound')
  const currentStatusPillClass = statusPillClass(
    healthSnapshot?.status ?? authSession?.status ?? null,
    Boolean(healthSnapshot?.ok),
  )
  const currentStatusDetail =
    authSession?.detail ??
    t(locale, '在手机上确认登录后继续下一步。', 'Confirm login on your phone, then continue to the next step.')

  const canGoNext = useMemo(() => {
    if (wizardStep === 0) {
      return hasBoundToken
    }
    if (wizardStep === 1) {
      return Boolean(healthSnapshot?.ok)
    }
    if (wizardStep === 2) {
      return form.targetBindingType === 'role'
        ? Boolean(form.targetRoleKey.trim())
        : Boolean(form.targetAgentId.trim())
    }
    return true
  }, [form.targetAgentId, form.targetBindingType, form.targetRoleKey, hasBoundToken, healthSnapshot?.ok, wizardStep])

  const startBind = async () => {
    setSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const response = await desktopApi.channelConnectorWechatAuthStart(normalizedAccountId)
      setAuthSession(response.session)
      setStatusMessage(t(locale, '二维码已生成，请使用微信扫码。', 'QR code ready. Scan it with WeChat.'))
    } catch (error) {
      setErrorMessage(
        t(locale, '生成二维码失败: {detail}', 'Failed to generate QR code: {detail}', {
          detail: describeError(error),
        }),
      )
    }
    setSaving(false)
  }

  const verifyHealth = async () => {
    setSaving(true)
    setErrorMessage(null)
    try {
      const response = await desktopApi.channelConnectorHealth('wechat', normalizedAccountId)
      setHealthSnapshot(response.health)
      if (response.health.ok) {
        setStatusMessage(t(locale, '微信连接已验证。', 'WeChat connection verified.'))
      } else {
        setErrorMessage(response.health.detail)
      }
    } catch (error) {
      setErrorMessage(
        t(locale, '连接验证失败: {detail}', 'Verification failed: {detail}', {
          detail: describeError(error),
        }),
      )
    }
    setSaving(false)
  }

  const applyWizard = async () => {
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }
    const targetSelector =
      form.targetBindingType === 'role' ? normalizeRoleTarget(form.targetRoleKey) : form.targetAgentId.trim()
    if (!targetSelector) {
      setErrorMessage(t(locale, '请选择目标 Agent 或 Role。', 'Choose a target Agent or Role.'))
      return
    }

    setSaving(true)
    setErrorMessage(null)
    try {
      await desktopApi.channelBindingUpsert({
        workspaceId,
        channel: 'wechat',
        accountId: normalizedAccountId,
        peerKind: 'direct',
        peerPattern: form.peerPattern.trim() || null,
        targetAgentId: targetSelector,
        priority: Number.isFinite(form.priority) ? Math.floor(form.priority) : 100,
      })
      await desktopApi.channelAccessPolicySet('wechat', form.policyMode, normalizedAccountId)
      for (const identity of parseIdentities(form.approveIdentities)) {
        await desktopApi.channelAccessApprove('wechat', identity, normalizedAccountId)
      }
      onSuccess(t(locale, '微信通道已配置完成。', 'WeChat channel setup completed.'))
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
    <div className="channel-wizard-container wechat-onboarding-modal">
      <header className="channel-wizard-header wechat-modal-header">
        <div className="channel-wizard-title">
          <h4>
            {editingBinding ? t(locale, '编辑 WeChat Channel', 'Edit WeChat Channel') : t(locale, '新增 WeChat Channel', 'Add WeChat Channel')}
          </h4>
          <p>{t(locale, 'Step {step}/{total}', 'Step {step}/{total}', { step: wizardStep + 1, total: STEP_COUNT })}</p>
        </div>
        <button type="button" className="settings-content-close" onClick={onClose} disabled={saving}>
          ×
        </button>
      </header>

      <div className="channel-wizard-steps-indicator">
        {Array.from({ length: STEP_COUNT }).map((_, index) => (
          <div
            key={index}
            className={`channel-wizard-step-dot ${index === wizardStep ? 'active' : ''} ${index < wizardStep ? 'completed' : ''}`}
          />
        ))}
      </div>

      <div className="channel-wizard-body wechat-wizard-layout">
        <aside className="wechat-wizard-sidebar">
          <div className="wechat-hero-card">
            <span className="wechat-guide-eyebrow">WeChat</span>
            <h5>{t(locale, '个人会话接入', 'Personal chat onboarding')}</h5>
            <p>{t(locale, '桌面端扫码绑定后，再把私聊消息路由到目标 Agent。', 'Bind on desktop with a QR flow, then route direct messages into the target Agent.')}</p>
            {isScanStep ? (
              <div className="wechat-guide-status">
                <span className={`wechat-health-pill ${currentStatusPillClass}`}>{currentStatus}</span>
                <p>{currentStatusDetail}</p>
              </div>
            ) : null}
          </div>
          {!isScanStep ? (
            <div className="wechat-health-card">
              <div className="wechat-health-header">
                <h5>{t(locale, '当前状态', 'Current status')}</h5>
                <span className={`wechat-health-pill ${healthPillClass(healthSnapshot)}`}>
                  {healthSnapshot?.status ?? authSession?.status ?? t(locale, '未绑定', 'Unbound')}
                </span>
              </div>
              <dl className="wechat-health-grid">
                <dt>Account</dt>
                <dd>{normalizedAccountId}</dd>
                <dt>{t(locale, '已绑定 Token', 'Token bound')}</dt>
                <dd>{hasBoundToken ? t(locale, '是', 'Yes') : t(locale, '否', 'No')}</dd>
                <dt>{t(locale, '最后同步', 'Last sync')}</dt>
                <dd>
                  {healthSnapshot?.lastSyncAtMs
                    ? new Date(healthSnapshot.lastSyncAtMs).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US')
                    : '-'}
                </dd>
              </dl>
              {healthSnapshot?.detail ? <p className="wechat-side-note">{healthSnapshot.detail}</p> : null}
            </div>
          ) : null}
        </aside>

        <section className="wechat-wizard-main">
          {statusMessage && !isScanStep && <div className="settings-channel-message">{statusMessage}</div>}
          {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

          {wizardStep === 0 && (
            <div className="settings-pane-section wechat-step-section">
              <div className="wechat-qr-stage">
                {authSession?.qrCodeSvgDataUrl ? (
                  <img
                    className="wechat-qr-image"
                    src={authSession.qrCodeSvgDataUrl}
                    alt={t(locale, '请使用微信扫描此二维码完成绑定', 'Scan this QR code with WeChat to finish binding')}
                    style={{ width: '100%', maxWidth: '18rem', height: 'auto' }}
                  />
                ) : (
                  <div className="wechat-qr-placeholder">
                    <strong>{t(locale, '先生成二维码', 'Generate the QR code first')}</strong>
                    <p>{t(locale, '生成后会在这里显示扫码区。', 'The scan stage will appear here after generation.')}</p>
                  </div>
                )}
              </div>
              <div className="wechat-step-actions">
                <div className="settings-form-group">
                  <label>Account ID</label>
                  <input
                    className="settings-input"
                    value={form.accountId}
                    disabled={saving || Boolean(editingBinding)}
                    onChange={(event) => updateField('accountId', event.target.value)}
                  />
                </div>
                <div className="feishu-step-actions">
                  <button type="button" className="settings-btn settings-btn-secondary" onClick={startBind} disabled={saving}>
                    {authSession ? t(locale, '刷新二维码', 'Refresh QR Code') : t(locale, '开始扫码绑定', 'Start QR Binding')}
                  </button>
                  {authSession ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn-secondary"
                      onClick={async () => {
                        try {
                          await desktopApi.channelConnectorWechatAuthCancel(authSession.authSessionId)
                          setAuthSession(null)
                        } catch (error) {
                          setErrorMessage(describeError(error))
                        }
                      }}
                      disabled={saving}
                    >
                      {t(locale, '取消', 'Cancel')}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="settings-pane-section wechat-step-section">
              <h4>{t(locale, '验证连接', 'Verify the connection')}</h4>
              <p className="wechat-side-note">
                {t(locale, '绑定成功后做一次 token 探活；如果失效，这里直接给出“重新绑定”恢复动作。', 'Run one token probe after binding; if it has expired, recover here with a direct rebind action.')}
              </p>
              <div className="feishu-step-actions">
                <button type="button" className="settings-btn settings-btn-primary" onClick={verifyHealth} disabled={saving || !hasBoundToken}>
                  {t(locale, '执行连接验证', 'Run verification')}
                </button>
                <button type="button" className="settings-btn settings-btn-secondary" onClick={startBind} disabled={saving}>
                  {t(locale, '重新绑定微信', 'Rebind WeChat')}
                </button>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="settings-pane-section wechat-step-section">
              <h4>{t(locale, '选择消息投递目标', 'Choose the delivery target')}</h4>
              <div className="segmented-control">
                <button
                  type="button"
                  className={form.targetBindingType === 'role' ? 'active' : ''}
                  onClick={() => updateField('targetBindingType', 'role')}
                  disabled={saving}
                >
                  {t(locale, '绑定 Role', 'Bind Role')}
                </button>
                <button
                  type="button"
                  className={form.targetBindingType === 'agent' ? 'active' : ''}
                  onClick={() => updateField('targetBindingType', 'agent')}
                  disabled={saving}
                >
                  {t(locale, '绑定 Agent', 'Bind Agent')}
                </button>
              </div>
              <div className="channel-wizard-two-column">
                <div className="settings-form-group">
                  <label>{t(locale, 'Peer Pattern（可选）', 'Peer Pattern (optional)')}</label>
                  <input
                    className="settings-input"
                    value={form.peerPattern}
                    disabled={saving}
                    onChange={(event) => updateField('peerPattern', event.target.value)}
                  />
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
                <label>{t(locale, '策略模式', 'Policy Mode')}</label>
                <select
                  className="settings-select"
                  value={form.policyMode}
                  disabled={saving}
                  onChange={(event) => updateField('policyMode', event.target.value as ExternalAccessPolicyMode)}
                >
                  <option value="open">open</option>
                  <option value="pairing">pairing</option>
                  <option value="allowlist">allowlist</option>
                  <option value="disabled">disabled</option>
                </select>
                <span className="hint">
                  {t(
                    locale,
                    '个人微信建议使用 open；pairing 和 allowlist 会先拦截首条消息，直到 identity 被批准。',
                    'Use open for personal WeChat. Pairing and allowlist will block the first inbound message until the identity is approved.',
                  )}
                </span>
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
            <div className="settings-pane-section wechat-step-section">
              <h4>{t(locale, '确认并应用', 'Review and apply')}</h4>
              <div className="feishu-inline-panel">
                <ul className="feishu-review-list">
                  <li>
                    <span>Channel</span>
                    <strong>WeChat</strong>
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
                    <strong>direct / {form.peerPattern || '*'}</strong>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </section>
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
        {wizardStep < STEP_COUNT - 1 ? (
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={() => setWizardStep((value) => Math.min(STEP_COUNT - 1, value + 1))}
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
