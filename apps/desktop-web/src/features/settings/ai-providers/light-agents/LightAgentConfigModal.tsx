import { useEffect, useState } from 'react'
import {
  desktopApi,
  type AiConfigPreviewResponse,
  type LightAgentGuide,
  type LightAgentDraftInput,
} from '@shell/integration/desktop-api'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from '../shared/AiConfigOverlay'
import { describeUnknownError, type LightAgentSnapshotCard } from '../shared/provider-utils'

import './LightAgentProviderWorkspace.scss'

interface LightAgentConfigModalProps {
  workspaceId: string
  locale: Locale
  agent: LightAgentSnapshotCard
  guide: LightAgentGuide
  installing: boolean
  onInstall: () => void
  onReload: () => void | Promise<void>
  onClose: () => void
}

function rem14(px: number): string {
  return `${px / 14}rem`
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
  const installDisabled = installing
  const canReuseSecret = guide.config.hasSecret

  useEffect(() => {
    setApiKey('')
    setPreview(null)
    setError(null)
    setStepIndex(canInstall ? 0 : 1)
  }, [agent.agent, canInstall])

  const handleGeneratePreview = async () => {
    setLoading(true)
    setError(null)
    try {
      const draft: LightAgentDraftInput = {
        apiKey: apiKey.trim() || undefined,
      }
      const resp = await desktopApi.aiConfigPreviewPatch(workspaceId, agent.agent, 'workspace', draft)
      setPreview(resp)
      setStepIndex(2)
    } catch (err) {
      setError(describeUnknownError(err))
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
      await onReload()
      // Success delay then close
      setTimeout(() => {
        onClose()
      }, 1000)
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setLoading(false)
    }
  }

  const renderFooter = () => (
    <div className="ai-config-footer-nav">
      <div className="footer-left">
        {stepIndex > 0 && (
          <button className="nav-btn btn-secondary" onClick={() => setStepIndex(stepIndex - 1)}>
            <AppIcon name="chevron-left" width={16} height={16} />
            {stepIndex === 2 ? t(locale, 'aiConfig.common.modify') : t(locale, 'aiConfig.common.back')}
          </button>
        )}
      </div>
      <div className="footer-right">
        {stepIndex === 0 && canInstall && (
          <button
            className="nav-btn btn-primary"
            disabled={installDisabled}
            onClick={onInstall}
          >
            <AppIcon name="cloud-download" width={16} height={16} />
            {installing ? t(locale, 'aiConfig.runtime.installing') : t(locale, 'aiConfig.light.installAction')}
          </button>
        )}
        
        {stepIndex === 0 && (
          <button className="nav-btn btn-primary" onClick={() => setStepIndex(1)}>
            {t(locale, 'aiConfig.common.next')}
            <AppIcon name="chevron-right" width={16} height={16} />
          </button>
        )}

        {stepIndex === 1 && (
          <button
            className="nav-btn btn-primary"
            disabled={loading || (!apiKey.trim() && !canReuseSecret)}
            onClick={() => void handleGeneratePreview()}
          >
            {loading ? '...' : t(locale, 'aiConfig.common.previewChanges')}
            <AppIcon name="chevron-right" width={16} height={16} />
          </button>
        )}

        {stepIndex === 2 && preview && (
          <button className="nav-btn btn-apply" disabled={loading} onClick={() => void handleApply()}>
            <AppIcon name="check" width={16} height={16} />
            {loading ? t(locale, 'aiConfig.common.applying') : t(locale, 'aiConfig.common.confirmApply')}
          </button>
        )}
      </div>
    </div>
  )

  return (
    <AiConfigOverlay
      title={translateMaybeKey(locale, agent.title)}
      subtitle={translateMaybeKey(locale, agent.subtitle)}
      onClose={onClose}
      footer={renderFooter()}
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
            <h4>{t(locale, 'aiConfig.light.readiness')}</h4>
            <div className="readiness-grid">
              <div className="readiness-item">
                <span>{t(locale, 'aiConfig.light.cliTool')}</span>
                <strong className={agent.installStatus.installed ? 'ok' : 'warn'}>
                  {agent.installStatus.installed ? t(locale, 'aiConfig.light.installed') : t(locale, 'aiConfig.light.notFound')}
                </strong>
              </div>
              <div className="readiness-item">
                <span>{t(locale, 'aiConfig.light.mcpBridge')}</span>
                <strong className={guide.mcpInstalled ? 'ok' : 'warn'}>
                  {guide.mcpInstalled ? t(locale, 'aiConfig.light.configured') : t(locale, 'aiConfig.light.notConfigured')}
                </strong>
              </div>
            </div>

            {agent.installStatus.issues.length > 0 && (
              <div className="guide-tips" style={{ 
                marginTop: rem14(12), 
                padding: rem14(12), 
                background: 'var(--vb-bg-tertiary)', 
                borderRadius: rem14(12),
                border: '0.0625rem solid var(--vb-border-subtle)'
              }}>
                <p style={{ margin: 0, fontSize: rem14(13), color: 'var(--vb-text-muted)', lineHeight: 1.6 }}>
                  {agent.installStatus.issues.join(' ')}
                </p>
              </div>
            )}

            <div className="guide-tips" style={{ 
              marginTop: rem14(16), 
              padding: rem14(16), 
              background: 'var(--vb-bg-tertiary)', 
              borderRadius: rem14(12),
              border: '0.0625rem solid var(--vb-border-subtle)'
            }}>
              <p style={{ margin: `0 0 ${rem14(8)} 0`, fontSize: rem14(13), fontWeight: 600 }}>{t(locale, 'aiConfig.guide.title')}</p>
              <ul style={{ margin: 0, paddingLeft: rem14(20), fontSize: rem14(13), color: 'var(--vb-text-muted)', lineHeight: 1.6 }}>
                {guide.tips.map((tip, idx) => (
                  <li key={idx}>{translateMaybeKey(locale, tip)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="step-pane">
            <h4>{t(locale, 'aiConfig.light.credentials')}</h4>
            <p>{t(locale, 'aiConfig.light.credentialsDesc')}</p>
            <div className="field-group">
              <label>
                {agent.agent === 'codex' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY'}
              </label>
              <input
                type="password"
                className="settings-input"
                value={apiKey}
                placeholder={
                  canReuseSecret ? t(locale, 'aiConfig.details.vaulted') : 'sk-...'
                }
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="light-guide-panel">
              <p className="light-guide-summary">{translateMaybeKey(locale, guide.summary)}</p>
              <div className="light-guide-meta">
                <a href={guide.docsUrl} target="_blank" rel="noreferrer">
                  <AppIcon name="external" width={14} height={14} />
                  {t(locale, 'aiConfig.light.docs')}
                </a>
                {guide.configPath && (
                  <div className="config-path-chip">
                    <span>{t(locale, 'aiConfig.light.configPath')}</span>
                    <code>{guide.configPath}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {stepIndex === 2 && preview && (
          <div className="step-pane">
            <h4>{t(locale, 'aiConfig.light.confirmChanges')}</h4>
            <div className="diff-box">
              {preview.maskedDiff.map((change) => (
                <div key={change.key} className="diff-row">
                  <span className="label">{change.label}</span>
                  <span className="val">{t(locale, 'aiConfig.light.ready')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="error-message" style={{ marginTop: rem14(16), color: '#ff4d4f' }}>
            {error}
          </div>
        )}
      </div>
    </AiConfigOverlay>
  )
}
