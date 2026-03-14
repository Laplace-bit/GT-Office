import { useEffect, useState } from 'react'

import {
  desktopApi,
  type AiAgentSnapshotCard,
  type AiConfigPreviewResponse,
  type ClaudeAuthScheme,
  type ClaudeDraftInput,
  type ClaudeProviderMode,
  type ClaudeSnapshot,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from '../shared/AiConfigOverlay'

import './ClaudeProviderWorkspace.scss'

interface ClaudeConfigModalProps {
  locale: Locale
  workspaceId: string
  agent: AiAgentSnapshotCard
  snapshot: ClaudeSnapshot
  installing: boolean
  onInstall: () => void
  onReload: () => Promise<void>
  onClose: () => void
}

function defaultPresetId(snapshot: ClaudeSnapshot): string {
  const nonCustom = snapshot.presets.find((preset) => preset.providerId !== 'custom-gateway')
  return nonCustom?.providerId ?? snapshot.presets[0]?.providerId ?? 'anthropic-official'
}

export function ClaudeConfigModal({
  locale,
  workspaceId,
  agent,
  snapshot,
  installing,
  onInstall,
  onReload,
  onClose,
}: ClaudeConfigModalProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [mode, setMode] = useState<ClaudeProviderMode>('preset')
  const [providerId, setProviderId] = useState(defaultPresetId(snapshot))
  const [providerName, setProviderName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [authScheme, setAuthScheme] = useState<ClaudeAuthScheme>('anthropic_api_key')
  const [apiKey, setApiKey] = useState('')
  const [preview, setPreview] = useState<AiConfigPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedPreset =
    snapshot.presets.find((preset) => preset.providerId === providerId) ?? snapshot.presets[0]
  const canInstall = !agent.installStatus.installed
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)

  function clearDerivedState() {
    setPreview(null)
    setError(null)
    setSuccess(null)
  }

  useEffect(() => {
    const nextMode = snapshot.config.activeMode ?? 'preset'
    const nextProviderId =
      snapshot.config.providerId &&
      snapshot.presets.some((preset) => preset.providerId === snapshot.config.providerId)
        ? snapshot.config.providerId
        : defaultPresetId(snapshot)
    const nextPreset =
      snapshot.presets.find((preset) => preset.providerId === nextProviderId) ?? snapshot.presets[0]

    setMode(nextMode)
    setProviderId(nextProviderId)
    setProviderName(
      snapshot.config.providerName ?? (nextMode === 'custom' ? '' : nextPreset?.name ?? ''),
    )
    setBaseUrl(snapshot.config.baseUrl ?? (nextPreset?.endpoint ?? ''))
    setModel(snapshot.config.model ?? (nextPreset?.recommendedModel ?? ''))
    setAuthScheme(snapshot.config.authScheme ?? (nextPreset?.authScheme ?? 'anthropic_api_key'))
    setApiKey('')
    clearDerivedState()
    setStepIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.config.activeMode, snapshot.config.providerId, snapshot.config.updatedAtMs])

  function resetPresetFields(nextProviderId: string) {
    const nextPreset = snapshot.presets.find((preset) => preset.providerId === nextProviderId)
    if (!nextPreset) {
      return
    }
    setProviderId(nextPreset.providerId)
    setProviderName(nextPreset.name)
    setBaseUrl(nextPreset.endpoint)
    setModel(nextPreset.recommendedModel)
    setAuthScheme(nextPreset.authScheme)
    clearDerivedState()
  }

  async function handleGeneratePreview() {
    setLoading(true)
    setError(null)
    try {
      const draft: ClaudeDraftInput = {
        mode,
        providerId: mode === 'preset' ? providerId : undefined,
        providerName: mode === 'custom' ? providerName : undefined,
        baseUrl: mode === 'official' ? undefined : baseUrl,
        model: mode === 'official' ? undefined : model,
        authScheme: mode === 'official' ? undefined : authScheme,
        apiKey: apiKey.trim() || undefined,
      }
      const resp = await desktopApi.aiConfigPreviewPatch(workspaceId, 'claude', 'workspace', draft)
      setPreview(resp)
      setStepIndex(4)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleApply() {
    if (!preview) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      await desktopApi.aiConfigApplyPatch(workspaceId, preview.previewId, 'System Admin')
      setSuccess(t(locale, 'aiConfig.common.success'))
      await onReload()
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const steps = [
    { id: 'check', label: t(locale, 'aiConfig.step.check') },
    { id: 'provider', label: t(locale, 'aiConfig.step.provider') },
    { id: 'guidance', label: t(locale, 'aiConfig.step.guidance') },
    { id: 'details', label: t(locale, 'aiConfig.step.details') },
    { id: 'apply', label: t(locale, 'aiConfig.step.apply') },
  ]

  const localizeCategory = (cat: string) => {
    if (cat === 'Global') return t(locale, 'aiConfig.category.global')
    if (cat === 'China') return t(locale, 'aiConfig.category.china')
    return cat
  }

  const getPresetLogo = (pid: string) => {
    if (pid === 'anthropic-official') return '/assets/logos/claude.webp'
    return null
  }

  const renderLeftAction = () => {
    if (stepIndex === 0) return null
    return (
      <button
        className="nav-side-btn"
        title={stepIndex === 4 ? t(locale, 'aiConfig.common.modify') : t(locale, 'aiConfig.common.back')}
        onClick={() => {
          if (stepIndex === 4) setStepIndex(3)
          else if (stepIndex === 3) setStepIndex(mode === 'official' ? 1 : 2)
          else setStepIndex(stepIndex - 1)
        }}
      >
        <AppIcon name="chevron-left" width={24} height={24} />
      </button>
    )
  }

  const renderRightAction = () => {
    // Special case for Step 0: Install button might be needed.
    // However, if we only have one right button, we prioritze Next.
    // If we need Install, we can show it as a specific icon or just keep it in content.
    // Let's keep Install in content and only use side buttons for navigation.
    
    if (stepIndex < 3) {
      return (
        <button
          className="nav-side-btn"
          title={stepIndex === 2 ? t(locale, 'aiConfig.common.gotIt') : t(locale, 'aiConfig.common.next')}
          onClick={() => {
            if (stepIndex === 1) setStepIndex(mode === 'official' ? 3 : 2)
            else setStepIndex(stepIndex + 1)
          }}
        >
          <AppIcon name="chevron-right" width={24} height={24} />
        </button>
      )
    }

    if (stepIndex === 3) {
      return (
        <button
          className="nav-side-btn"
          disabled={loading}
          title={t(locale, 'aiConfig.common.previewChanges')}
          onClick={() => void handleGeneratePreview()}
        >
          <AppIcon name={loading ? 'loading' : 'chevron-right'} width={24} height={24} />
        </button>
      )
    }

    if (stepIndex === 4 && preview) {
      return (
        <button 
          className="nav-side-btn btn-apply" 
          disabled={loading} 
          title={t(locale, 'aiConfig.common.confirmApply')}
          onClick={() => void handleApply()}
        >
          <AppIcon name={loading ? 'loading' : 'check'} width={24} height={24} />
        </button>
      )
    }

    return null
  }

  return (
    <AiConfigOverlay
      title={t(locale, agent.title as any)}
      subtitle={t(locale, agent.subtitle as any)}
      onClose={onClose}
      leftAction={renderLeftAction()}
      rightAction={renderRightAction()}
    >
      <div className="ai-provider-stepper">
        {steps.map((step, idx) => (
          <button
            key={step.id}
            className={`ai-provider-stepper__item ${stepIndex === idx ? 'is-active' : ''} ${stepIndex > idx ? 'is-complete' : ''}`}
            disabled={idx > stepIndex}
            onClick={() => {
              setStepIndex(idx)
              clearDerivedState()
            }}
          >
            <span>{idx + 1}</span>
            <strong>{step.label}</strong>
          </button>
        ))}
      </div>

      <div className="ai-provider-panel">
        {stepIndex === 0 && (
          <div className="ai-provider-panel-step">
            <div className="ai-provider-panel-content is-centered">
              <div className="ai-provider-panel__header">
                <div>
                  <h4>{t(locale, 'aiConfig.runtime.title')}</h4>
                  <p>{t(locale, 'aiConfig.runtime.desc')}</p>
                </div>
              </div>
              <div className="ai-provider-guide-card__summary">
                <div>
                  <span>{t(locale, 'aiConfig.runtime.nodeStatus')}</span>
                  <strong style={{ color: agent.installStatus.nodeReady ? '#0f8f50' : '#d4af37' }}>
                    {agent.installStatus.nodeReady
                      ? t(locale, 'aiConfig.runtime.ready')
                      : t(locale, 'aiConfig.runtime.notFound')}
                  </strong>
                </div>
                <div>
                  <span>{t(locale, 'aiConfig.runtime.installStatus')}</span>
                  <strong style={{ color: agent.installStatus.installed ? '#0f8f50' : '#d4af37' }}>
                    {agent.installStatus.installed
                      ? t(locale, 'aiConfig.runtime.cliInstalled')
                      : t(locale, 'aiConfig.runtime.notInstalled')}
                  </strong>
                </div>
              </div>

              {canInstall && (
                <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
                  <button
                    className="nav-btn btn-primary"
                    style={{ height: 44, padding: '0 24px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: '#171717', color: 'white', cursor: 'pointer' }}
                    disabled={installDisabled}
                    onClick={() => onInstall()}
                  >
                    <AppIcon name="cloud-download" width={18} height={18} />
                    {installing
                      ? t(locale, 'aiConfig.runtime.installing')
                      : t(locale, 'aiConfig.runtime.installAction')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="ai-provider-panel-step">
            <div className="ai-provider-panel-content">
              <div className="ai-provider-panel__header">
                <div>
                  <h4>{t(locale, 'aiConfig.mode.title')}</h4>
                  <p>{t(locale, 'aiConfig.mode.desc')}</p>
                </div>
              </div>
              <div className="ai-provider-mode-toggle">
                <button
                  className={mode === 'official' ? 'is-active' : ''}
                  onClick={() => {
                    setMode('official')
                    clearDerivedState()
                  }}
                >
                  {t(locale, 'aiConfig.mode.official')}
                </button>
                <button
                  className={mode === 'preset' ? 'is-active' : ''}
                  onClick={() => {
                    setMode('preset')
                    clearDerivedState()
                  }}
                >
                  {t(locale, 'aiConfig.mode.presets')}
                </button>
                <button
                  className={mode === 'custom' ? 'is-active' : ''}
                  onClick={() => {
                    setMode('custom')
                    clearDerivedState()
                  }}
                >
                  {t(locale, 'aiConfig.mode.custom')}
                </button>
              </div>

              {mode === 'preset' && (
                <div className="ai-provider-preset-grid">
                  {snapshot.presets
                    .filter((p) => p.providerId !== 'custom-gateway')
                    .map((p) => (
                      <button
                        key={p.providerId}
                        className={`ai-provider-preset-card ${providerId === p.providerId ? 'is-active' : ''}`}
                        onClick={() => resetPresetFields(p.providerId)}
                      >
                        <div className="preset-card-header">
                          {getPresetLogo(p.providerId) ? (
                            <img src={getPresetLogo(p.providerId)!} alt="" className="preset-logo" />
                          ) : (
                            <div className="preset-logo-placeholder">{p.name.charAt(0)}</div>
                          )}
                          <span>{localizeCategory(p.category)}</span>
                        </div>
                        <strong>{t(locale, p.name as any)}</strong>
                        <small>{t(locale, p.description as any)}</small>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {stepIndex === 2 && (
          <div className="ai-provider-panel-step">
            <div className="ai-provider-panel-content">

              <div className="ai-provider-guide-card__summary">
                <div>
                  <span>{t(locale, 'aiConfig.guide.recommended')}</span>
                  <strong>{selectedPreset.recommendedModel}</strong>
                </div>
                <div>
                  <span>{t(locale, 'aiConfig.guide.authScheme')}</span>
                  <strong>{selectedPreset.authScheme}</strong>
                </div>
              </div>
              <div className="ai-provider-diff-list">
                {selectedPreset.setupSteps.map((step, idx) => (
                  <div key={idx} className="ai-provider-diff-list__item">
                    <div className="ai-provider-dot is-warning" />
                    <div style={{ alignItems: 'flex-start', flex: 1 }}>
                      <strong>
                        {t(locale, 'aiConfig.guide.step')} {idx + 1}
                      </strong>
                      <small>{t(locale, step as any)}</small>
                    </div>
                  </div>
                ))}
              </div>
              <div className="ai-provider-guide-card__links">
                <a href={selectedPreset.websiteUrl} target="_blank" rel="noreferrer">
                  <AppIcon name="external" width={14} height={14} style={{ marginRight: 6 }} />
                  {t(locale, 'aiConfig.guide.website')}
                </a>
                <a href={selectedPreset.apiKeyUrl} target="_blank" rel="noreferrer">
                  <AppIcon name="bolt" width={14} height={14} style={{ marginRight: 6 }} />
                  {t(locale, 'aiConfig.guide.getApiKey')}
                </a>
              </div>
            </div>
          </div>
        )}

        {stepIndex === 3 && (
          <div className="ai-provider-panel-step">
            <div className="ai-provider-panel-content">
              <div className="ai-provider-panel__header">
                <div>
                  <h4>{t(locale, 'aiConfig.details.title')}</h4>
                  <p>
                    {mode === 'official'
                      ? t(locale, 'aiConfig.details.officialDesc')
                      : t(locale, 'aiConfig.details.customDesc')}
                  </p>
                </div>
              </div>

              {mode !== 'official' && (
                <div className="ai-provider-form-grid">
                  <div className="ai-provider-field" style={{ gridColumn: mode === 'custom' ? '1' : 'span 2' }}>
                    <span>{t(locale, 'aiConfig.details.providerName')}</span>
                    <input
                      type="text"
                      value={providerName}
                      placeholder={t(locale, 'aiConfig.details.namePlaceholder')}
                      readOnly={mode === 'preset'}
                      onChange={(e) => setProviderName(e.target.value)}
                    />
                  </div>
                  {mode === 'custom' && (
                    <div className="ai-provider-field">
                      <span>{t(locale, 'aiConfig.guide.authScheme')}</span>
                      <select
                        value={authScheme}
                        onChange={(e) => setAuthScheme(e.target.value as ClaudeAuthScheme)}
                      >
                        <option value="anthropic_api_key">ANTHROPIC_API_KEY</option>
                        <option value="anthropic_auth_token">ANTHROPIC_AUTH_TOKEN</option>
                      </select>
                    </div>
                  )}
                  <div className="ai-provider-field" style={{ gridColumn: 'span 2' }}>
                    <span>{t(locale, 'aiConfig.details.baseUrl')}</span>
                    <input
                      type="text"
                      value={baseUrl}
                      placeholder={t(locale, 'aiConfig.details.endpointPlaceholder')}
                      readOnly={mode === 'preset'}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </div>
                  <div className="ai-provider-field">
                    <span>{t(locale, 'aiConfig.details.model')}</span>
                    <input
                      type="text"
                      value={model}
                      placeholder={t(locale, 'aiConfig.details.modelPlaceholder')}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  </div>
                  <div className="ai-provider-field">
                    <span>{t(locale, 'aiConfig.details.apiKey')}</span>
                    <input
                      type="password"
                      value={apiKey}
                      autoComplete="new-password"
                      placeholder={
                        snapshot.config.hasSecret
                          ? t(locale, 'aiConfig.details.vaulted')
                          : t(locale, 'aiConfig.details.notSet')
                      }
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {mode === 'official' && (
                <div className="ai-provider-diff-list">
                  <div className="ai-provider-diff-list__item">
                    <div className="ai-provider-dot is-success" />
                    <div style={{ alignItems: 'flex-start', flex: 1 }}>
                      <strong>{t(locale, 'aiConfig.details.directTitle')}</strong>
                      <small>{t(locale, 'aiConfig.details.directDesc')}</small>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {stepIndex === 4 && preview && (
          <div className="ai-provider-panel-step">
            <div className="ai-provider-panel-content">
              <div className="ai-provider-panel__header">
                <div>
                  <h4>{t(locale, 'aiConfig.review.title')}</h4>
                  <p>{t(locale, 'aiConfig.review.desc')}</p>
                </div>
              </div>

              <div className="ai-provider-diff-list">
                {preview.maskedDiff.map((change) => (
                  <div key={change.key} className="ai-provider-diff-list__item">
                    <span>{change.label}</span>
                    <div>
                      <small>{change.before || t(locale, 'aiConfig.common.empty')}</small>
                      <strong style={{ color: '#007aff' }}>
                        {change.secret ? '********' : change.after}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>

              {preview.warnings.length > 0 && (
                <div className="ai-provider-diff-list" style={{ marginTop: 8 }}>
                  {preview.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="ai-provider-diff-list__item"
                      style={{ background: '#fff9e6', borderColor: '#ffe58f' }}
                    >
                      <div className="ai-provider-dot is-warning" />
                      <small style={{ color: '#856404' }}>{w}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="error-message" style={{ marginTop: 16 }}>
            {error}
          </div>
        )}
        {success && (
          <div className="success-message" style={{ marginTop: 16 }}>
            {success}
          </div>
        )}
      </div>
    </AiConfigOverlay>
  )
}
