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
import { ChannelWizardFrame } from '../ChannelWizardFrame'

interface WechatConnectorWizardProps {
  locale: Locale
  workspaceId: string | null
  onClose: () => void
  onSuccess: (message: string) => void
  editingBinding: ChannelRouteBinding | null
  agents: AgentProfile[]
  connectorAccounts: ChannelConnectorAccount[]
  onBack?: () => void
  embedded?: boolean
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
  embedded = false,
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

  const connectionStatusLabel =
    healthSnapshot?.status ?? authSession?.status ?? t(locale, '未绑定', 'Unbound')

  const wizardTitle = editingBinding
    ? t(locale, '编辑 WeChat Channel', 'Edit WeChat Channel')
    : t(locale, '新增 WeChat Channel', 'Add WeChat Channel')

  const wizardFooter = (
    <>
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
    </>
  )

  return (
    <ChannelWizardFrame
      locale={locale}
      embedded={embedded}
      title={wizardTitle}
      stepCount={STEP_COUNT}
      wizardStep={wizardStep}
      saving={saving}
      onBack={onBack}
      footer={wizardFooter}
    >
      {statusMessage && <div className="settings-channel-message">{statusMessage}</div>}
      {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

      <div className="channel-wizard-step-animate" key={wizardStep}>
          {wizardStep === 0 && (
            <div className="channel-connect-layout">
              <div className="channel-qr-box" aria-hidden={!authSession?.qrCodeSvgDataUrl}>
                {authSession?.qrCodeSvgDataUrl ? (
                  <img
                    src={authSession.qrCodeSvgDataUrl}
                    alt={t(locale, '请使用微信扫描此二维码完成绑定', 'Scan this QR code with WeChat to finish binding')}
                  />
                ) : (
                  <p className="channel-qr-placeholder">
                    {t(locale, '点击生成二维码', 'Tap Generate QR Code')}
                  </p>
                )}
              </div>
              <div className="channel-connect-side">
                <p className="channel-wizard-step-desc">
                  {t(locale, '生成二维码后，用微信扫码完成绑定。', 'Generate a QR code, then scan it with WeChat to bind.')}
                </p>
                <div className="settings-form-group">
                  <label>Account ID</label>
                  <input
                    className="settings-input"
                    value={form.accountId}
                    disabled={saving || Boolean(editingBinding)}
                    onChange={(event) => updateField('accountId', event.target.value)}
                  />
                </div>
                <div className="channel-wizard-actions">
                  <button type="button" className="settings-btn settings-btn-primary" onClick={startBind} disabled={saving}>
                    {authSession ? t(locale, '刷新二维码', 'Refresh QR Code') : t(locale, '生成二维码', 'Generate QR Code')}
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
            <div className="channel-connect-side">
              <p className="channel-wizard-step-desc">
                {t(locale, '确认微信账号已连接可用。', 'Confirm the WeChat account is connected and available.')}
              </p>
              <p className="channel-status-line">
                <span>{t(locale, 'Account', 'Account')}</span>
                <strong>{normalizedAccountId}</strong>
                <span aria-hidden="true">·</span>
                <span>{t(locale, '状态', 'Status')}</span>
                <strong>{connectionStatusLabel}</strong>
              </p>
              <div className="channel-wizard-actions">
                <button type="button" className="settings-btn settings-btn-primary" onClick={verifyHealth} disabled={saving || !hasBoundToken}>
                  {t(locale, '验证连接', 'Verify connection')}
                </button>
                <button type="button" className="settings-btn settings-btn-secondary" onClick={startBind} disabled={saving}>
                  {t(locale, '重新绑定', 'Rebind')}
                </button>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="channel-wizard-form-stack">
              <p className="channel-wizard-step-desc">
                {t(locale, '选择接收微信消息的 Agent。', 'Choose the Agent that receives WeChat messages.')}
              </p>
              <div className="channel-wizard-two-column">
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
              </div>
            </div>
          )}
      </div>
    </ChannelWizardFrame>
  )
}
