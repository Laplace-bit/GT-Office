import { useEffect, useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  desktopApi,
  type AgentProfile,
  type ChannelConnectorAccount,
  type ChannelRouteBinding,
  type ChannelConnectorHealthResponse,
  type WechatAuthSession,
} from '@shell/integration/desktop-api'
import { normalizeChannelAccountId, parseChannelBindingTarget } from '../channel-bot-binding-model'
import { WizardStepBar } from '../WizardStepBar'

interface WechatConnectorWizardProps {
  locale: Locale
  workspaceId: string | null
  onClose: () => void
  onSuccess: (message: string) => void
  editingBinding: ChannelRouteBinding | null
  agents: AgentProfile[]
  connectorAccounts: ChannelConnectorAccount[]
  onBack?: () => void
}

interface WechatWizardForm {
  accountId: string
  targetAgentId: string
  peerPattern: string
}

const STEP_COUNT = 3

function describeError(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return 'unknown'
}

export function WechatConnectorWizard({
  locale,
  workspaceId,
  onSuccess,
  editingBinding,
  agents,
  connectorAccounts,
  onBack,
}: WechatConnectorWizardProps) {
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
        targetAgentId: target.type === 'agent' ? target.value : activeAgents[0]?.id ?? '',
        peerPattern: editingBinding.peerPattern ?? '',
      }
    }
    return {
      accountId: 'default',
      targetAgentId: activeAgents[0]?.id ?? '',
      peerPattern: '',
    }
  }, [activeAgents, editingBinding])

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

  const agentLabelById = useMemo(() => {
    const map = new Map<string, string>()
    activeAgents.forEach((agent) => map.set(agent.id, agent.name))
    return map
  }, [activeAgents])

  const reviewTargetLabel = agentLabelById.get(form.targetAgentId) ?? form.targetAgentId

  const canGoNext = useMemo(() => {
    if (wizardStep === 0) {
      return hasBoundToken
    }
    if (wizardStep === 1) {
      return Boolean(healthSnapshot?.ok)
    }
    if (wizardStep === 2) {
      return Boolean(form.targetAgentId.trim())
    }
    return true
  }, [form.targetAgentId, hasBoundToken, healthSnapshot?.ok, wizardStep])

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
    const targetSelector = form.targetAgentId.trim()
    if (!targetSelector) {
      setErrorMessage(t(locale, '请选择目标 Agent。', 'Choose a target Agent.'))
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
        priority: editingBinding?.priority ?? 100,
      })
      await desktopApi.channelAccessPolicySet('wechat', 'open', normalizedAccountId)
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
              {editingBinding ? t(locale, '编辑 WeChat Channel', 'Edit WeChat Channel') : t(locale, '新增 WeChat Channel', 'Add WeChat Channel')}
            </h4>
          </div>
        </div>
      </header>

      <WizardStepBar total={STEP_COUNT} current={wizardStep} />

      <div className="channel-wizard-body">
        <section className="wechat-wizard-main wechat-wizard-main--minimal">
          {statusMessage && <div className="settings-channel-message">{statusMessage}</div>}
          {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

          <div className="channel-wizard-step-animate" key={wizardStep}>
          {wizardStep === 0 && (
            <div className="settings-pane-section wechat-step-section">
              <div className="feishu-minimal-header">
                <p className="channel-wizard-step-label">{t(locale, 'Step 1 — 扫码绑定', 'Step 1 — Scan to bind')}</p>
                <p>{t(locale, '生成二维码后，用微信完成绑定。', 'Generate a QR code, then complete binding in WeChat.')}</p>
              </div>
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
              <div className="feishu-minimal-header">
                <p className="channel-wizard-step-label">{t(locale, 'Step 2 — 验证连接', 'Step 2 — Verify connection')}</p>
                <p>{t(locale, '做一次连接探活，确认账号可用。', 'Run a health check to confirm the account is available.')}</p>
              </div>
              <div className="feishu-inline-panel">
                <ul className="feishu-review-list">
                  <li>
                    <span>{t(locale, 'Account ID', 'Account ID')}</span>
                    <strong>{normalizedAccountId}</strong>
                  </li>
                  <li>
                    <span>{t(locale, '当前状态', 'Current status')}</span>
                    <strong>{healthSnapshot?.status ?? authSession?.status ?? t(locale, '未绑定', 'Unbound')}</strong>
                  </li>
                </ul>
              </div>
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
              <div className="feishu-minimal-header">
                <p className="channel-wizard-step-label">{t(locale, 'Step 3 — 绑定 Agent', 'Step 3 — Bind Agent')}</p>
                <p>{t(locale, '选择接收微信消息的 Agent。', 'Choose the Agent that receives WeChat messages.')}</p>
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
              <div className="settings-form-group">
                <label>{t(locale, 'Peer Pattern（可选）', 'Peer Pattern (optional)')}</label>
                <input
                  className="settings-input"
                  value={form.peerPattern}
                  disabled={saving}
                  placeholder={t(locale, '默认匹配全部私聊', 'Match all direct messages by default')}
                  onChange={(event) => updateField('peerPattern', event.target.value)}
                />
              </div>
              <div className="feishu-inline-panel">
                <ul className="feishu-review-list">
                  <li>
                    <span>Channel</span>
                    <strong>WeChat</strong>
                  </li>
                  <li>
                    <span>{t(locale, 'Target', 'Target')}</span>
                    <strong>{reviewTargetLabel || '-'}</strong>
                  </li>
                  <li>
                    <span>{t(locale, '匹配', 'Match')}</span>
                    <strong>direct / {form.peerPattern || '*'}</strong>
                  </li>
                </ul>
              </div>
            </div>
          )}
          </div>
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
          <button type="button" className="settings-btn settings-btn-primary" onClick={applyWizard} disabled={saving || !canGoNext}>
            {saving ? t(locale, '应用中...', 'Applying...') : t(locale, '应用配置', 'Apply Configuration')}
          </button>
        )}
      </footer>
    </div>
  )
}
