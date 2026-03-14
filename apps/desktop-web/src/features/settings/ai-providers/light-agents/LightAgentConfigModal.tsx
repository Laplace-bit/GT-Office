import { useEffect, useState } from 'react'
import {
  desktopApi,
  type AiAgentSnapshotCard,
  type AiConfigPreviewResponse,
  type LightAgentGuide,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from '../shared/AiConfigOverlay'

import './LightAgentProviderWorkspace.scss'

interface LightAgentConfigModalProps {
  workspaceId: string
  locale: Locale
  agent: AiAgentSnapshotCard
  guide: LightAgentGuide
  installing: boolean
  onInstall: () => void
  onReload: () => void
  onClose: () => void
}

export function LightAgentConfigModal({
  workspaceId,
  locale,
  agent,
  guide,
  installing,
  onInstall,
  onReload,
  onClose,
}: LightAgentConfigModalProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AiConfigPreviewResponse | null>(null)

  const canInstall = !agent.installStatus.installed
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)

  useEffect(() => {
    setApiKey('')
    setPreview(null)
    setError(null)
    setStepIndex(0)
  }, [agent.agent])

  const handleGeneratePreview = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await desktopApi.aiConfigPreviewPatch(workspaceId, agent.agent, 'workspace', {
        apiKey: apiKey.trim() || undefined,
      } as any)
      setPreview(resp)
      setStepIndex(2)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async () => {
    if (!preview) return
    setLoading(true)
    setError(null)
    try {
      await desktopApi.aiConfigApplyPatch(workspaceId, preview.previewId, 'System Admin')
      onReload()
      setTimeout(() => {
        onClose()
      }, 1000)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AiConfigOverlay
      title={agent.title}
      subtitle={agent.subtitle}
      onClose={onClose}
    >
      <div className="light-stepper">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`step ${stepIndex + 1 === s ? 'current' : stepIndex + 1 > s ? 'active' : ''}`}
          >
            {s}
          </div>
        ))}
      </div>

      <div className="step-container">
        {stepIndex === 0 && (
          <div className="step-pane">
            <h4>{t(locale, '安装与就绪检查', 'Installation & Readiness')}</h4>
            <div className="readiness-grid">
              <div className="readiness-item">
                <span>CLI {t(locale, '工具', 'Tool')}</span>
                <strong className={agent.installStatus.installed ? 'ok' : 'warn'}>
                  {agent.installStatus.installed ? 'Installed' : 'Not Found'}
                </strong>
              </div>
              <div className="readiness-item">
                <span>MCP {t(locale, '网桥', 'Bridge')}</span>
                <strong className={guide.mcpInstalled ? 'ok' : 'warn'}>
                  {guide.mcpInstalled ? 'Configured' : 'Not Configured'}
                </strong>
              </div>
            </div>
            <div className="ai-config-footer-nav">
              {canInstall && (
                <button
                  className="nav-btn btn-primary"
                  disabled={installDisabled}
                  onClick={onInstall}
                >
                  <AppIcon name="cloud-download" width={16} height={16} />
                  {installing ? 'Installing...' : 'Install CLI & Bridge'}
                </button>
              )}
              <button className="nav-btn btn-primary" onClick={() => setStepIndex(1)}>
                {t(locale, '下一步', 'Next')}
                <AppIcon name="chevron-right" width={16} height={16} />
              </button>
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="step-pane">
            <h4>{t(locale, '凭据配置', 'Credentials')}</h4>
            <p>
              {t(
                locale,
                '填入 API Key 后，GT Office 将在启动该工具的终端时自动注入对应的环境变量。',
                'GT Office will inject the API Key into the terminal environment.',
              )}
            </p>
            <div className="field-group">
              <label>
                {agent.agent === 'codex' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY'}
              </label>
              <input
                type="password"
                className="settings-input"
                value={apiKey}
                placeholder={
                  guide.config.hasSecret ? 'Vaulted (enter to override)' : 'sk-...'
                }
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="ai-config-footer-nav">
              <button className="nav-btn btn-secondary" onClick={() => setStepIndex(0)}>
                <AppIcon name="chevron-left" width={16} height={16} />
                {t(locale, '上一步', 'Back')}
              </button>
              <button
                className="nav-btn btn-primary"
                disabled={loading || (!apiKey && !guide.config.hasSecret)}
                onClick={() => void handleGeneratePreview()}
              >
                {loading ? '...' : t(locale, '查看预览', 'Preview')}
                <AppIcon name="chevron-right" width={16} height={16} />
              </button>
            </div>
          </div>
        )}

        {stepIndex === 2 && preview && (
          <div className="step-pane">
            <h4>{t(locale, '确认变更', 'Confirm Changes')}</h4>
            <div className="diff-box">
              {preview.maskedDiff.map((change) => (
                <div key={change.key} className="diff-row">
                  <span className="label">{change.label}</span>
                  <span className="val">Ready</span>
                </div>
              ))}
            </div>
            <div className="ai-config-footer-nav">
              <button className="nav-btn btn-secondary" onClick={() => setStepIndex(1)}>
                <AppIcon name="chevron-left" width={16} height={16} />
                {t(locale, '返回修改', 'Modify')}
              </button>
              <button className="nav-btn btn-apply" disabled={loading} onClick={() => void handleApply()}>
                <AppIcon name="check" width={16} height={16} />
                {loading ? 'Applying...' : 'Confirm & Apply'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="error-message" style={{ marginTop: 16, color: '#ff4d4f' }}>
            {error}
          </div>
        )}
      </div>
    </AiConfigOverlay>
  )
}
