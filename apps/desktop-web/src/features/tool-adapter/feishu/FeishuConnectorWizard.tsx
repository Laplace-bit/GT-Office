import { useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  desktopApi,
  type AgentProfile,
  type ChannelConnectorAccount,
  type ChannelConnectorHealthResponse,
  type ChannelRouteBinding,
} from '@shell/integration/desktop-api'
import { FeishuQrScan } from './FeishuQrScan'
import { FeishuHealthCard } from './FeishuHealthCard'
import { WizardStepBar } from '../WizardStepBar'
import {
  buildFeishuDefaultForm,
  describeError,
  normalizeAgentTarget,
  type FeishuWizardForm,
  type FeishuDomain,
} from './model'

interface FeishuConnectorWizardProps {
  locale: Locale
  workspaceId: string | null
  onClose: () => void
  onSuccess: (message: string) => void
  editingBinding: ChannelRouteBinding | null
  agents: AgentProfile[]
  connectorAccounts: ChannelConnectorAccount[]
  onBack?: () => void
}

const FEISHU_STEP_COUNT = 2

export function FeishuConnectorWizard({
  locale,
  workspaceId,
  onSuccess,
  editingBinding,
  agents,
  connectorAccounts,
  onBack,
}: FeishuConnectorWizardProps) {
  const activeAgents = useMemo(() => agents.filter((agent) => agent.state !== 'terminated'), [agents])
  const defaultAgentId = activeAgents[0]?.id ?? ''

  const [wizardStep, setWizardStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [healthSnapshot, setHealthSnapshot] = useState<ChannelConnectorHealthResponse['health'] | null>(null)
  const [connectionTestPassed, setConnectionTestPassed] = useState(false)
  const [platformSubscriptionConfirmed, setPlatformSubscriptionConfirmed] = useState(false)
  const [qrScanResult, setQrScanResult] = useState<{ accountId: string; appId: string; domain: string } | null>(null)
  const [form, setForm] = useState<FeishuWizardForm>(() =>
    buildFeishuDefaultForm({
      editingBinding,
      connectorAccounts,
      defaultAgentId,
    }),
  )
  const platformLabel = form.domain === 'lark' ? 'Lark Open Platform' : '飞书开放平台'
  const platformUrl = form.domain === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app'

  const agentLabelById = useMemo(() => {
    const map = new Map<string, string>()
    activeAgents.forEach((agent) => map.set(agent.id, agent.name))
    return map
  }, [activeAgents])
  const reviewTargetLabel = agentLabelById.get(form.targetAgentId) ?? form.targetAgentId

  const updateField = <K extends keyof FeishuWizardForm>(key: K, value: FeishuWizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'domain' || key === 'appId') {
      setConnectionTestPassed(false)
      setPlatformSubscriptionConfirmed(false)
      setHealthSnapshot(null)
    }
  }

  const handleQrScanSuccess = (result: { accountId: string; appId: string; domain: string }) => {
    setForm((prev) => ({
      ...prev,
      appId: result.appId,
      domain: result.domain as FeishuDomain,
    }))
    setQrScanResult(result)
    setConnectionTestPassed(true)
    setStatusMessage(
      t(
        locale,
        '飞书长连接已建立。现在回到开放平台保存”使用长连接接收事件”。',
        'Feishu long connection is now established. Return to Open Platform and save “use long connection to receive events”.',
      ),
    )
  }

  const handleQrScanError = (message: string) => {
    setErrorMessage(
      t(locale, '扫码连接失败：{detail}', 'QR scan connection failed: {detail}', {
        detail: message,
      }),
    )
  }

  const applyWizard = async () => {
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }

    const normalizedAccountId =
      editingBinding?.accountId?.trim() || qrScanResult?.accountId?.trim() || 'default'
    const targetSelector = normalizeAgentTarget(form.targetAgentId)
    if (!targetSelector) {
      setErrorMessage(t(locale, '请选择一个 Agent。', 'Select an Agent first.'))
      return
    }

    setSaving(true)
    setErrorMessage(null)
    try {
      await desktopApi.channelBindingUpsert({
        workspaceId,
        channel: 'feishu',
        accountId: normalizedAccountId,
        peerKind: form.peerKind,
        peerPattern: form.peerPattern.trim() || null,
        targetAgentId: targetSelector,
        priority: editingBinding?.priority ?? 100,
      })
      await desktopApi.channelAccessPolicySet('feishu', 'open', normalizedAccountId)
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
        return connectionTestPassed && !!qrScanResult
      default:
        return platformSubscriptionConfirmed
    }
  }, [connectionTestPassed, qrScanResult, platformSubscriptionConfirmed, wizardStep])

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

        <div className="channel-wizard-body">
          <section className="feishu-wizard-main">
            {statusMessage && <div className="settings-channel-message">{statusMessage}</div>}
            {errorMessage && <div className="settings-channel-error">{errorMessage}</div>}

            <div className="channel-wizard-step-animate" key={wizardStep}>
              {wizardStep === 0 && (
                <div className="settings-pane-section feishu-step-section">
                  <div className="feishu-minimal-header">
                    <p className="channel-wizard-step-label">{t(locale, 'Step 1 — 扫码连接', 'Step 1 — Scan QR to Connect')}</p>
                    <p>{t(locale, '扫码后自动创建应用并连接。', 'Scanning will auto-create the app and connect it.')}</p>
                  </div>

                  {connectionTestPassed && qrScanResult ? (
                    <FeishuHealthCard locale={locale} health={healthSnapshot} />
                  ) : (
                    <FeishuQrScan
                      locale={locale}
                      onSuccess={handleQrScanSuccess}
                      onError={handleQrScanError}
                    />
                  )}
                </div>
              )}

              {wizardStep === 1 && (
                <div className="settings-pane-section feishu-step-section">
                  <div className="feishu-minimal-header">
                    <p className="channel-wizard-step-label">{t(locale, 'Step 2 — 完成订阅并绑定 Agent', 'Step 2 — Finish subscription and bind Agent')}</p>
                    <p>{t(locale, '保存平台订阅后，选择接收消息的 Agent。', 'Save the platform subscription, then choose the Agent that receives messages.')}</p>
                  </div>

                  <div className="feishu-platform-compact">
                    <span>{platformLabel}</span>
                    <button
                      type="button"
                      className="settings-btn settings-btn-secondary"
                      onClick={() => void desktopApi.systemOpenUrl(platformUrl)}
                      disabled={saving}
                    >
                      {t(locale, '打开平台', 'Open Platform')}
                    </button>
                  </div>

                  <div className="feishu-confirm-box">
                    <label className="feishu-confirm-check">
                      <input
                        type="checkbox"
                        checked={platformSubscriptionConfirmed}
                        disabled={saving}
                        onChange={(event) => setPlatformSubscriptionConfirmed(event.target.checked)}
                      />
                      <span>
                        {t(
                          locale,
                          '已保存“使用长连接接收事件”并订阅 `im.message.receive_v1`。',
                          'Saved “use long connection to receive events” and subscribed to `im.message.receive_v1`.',
                        )}
                      </span>
                    </label>
                  </div>

                  <div className="feishu-form-grid is-minimal">
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

                  <div className="feishu-inline-panel">
                    <ul className="feishu-review-list">
                      <li>
                        <span>{t(locale, '连接方式', 'Connection')}</span>
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
