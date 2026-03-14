import { useEffect, useState, type CSSProperties } from 'react'

import {
  desktopApi,
  type AiAgentSnapshotCard,
  type AiConfigPreviewResponse,
  type ClaudeAuthScheme,
  type ClaudeDraftInput,
  type ClaudeProviderMode,
  type ClaudeProviderPreset,
  type ClaudeSnapshot,
} from '@shell/integration/desktop-api'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from '../shared/AiConfigOverlay'
import { describeUnknownError } from '../shared/provider-utils'

import {
  type ClaudeFlowStepId,
  getNextClaudeStep,
  getPreviousClaudeStep,
  needsClaudeRuntimeCheck,
  resolveClaudeEntryStep,
  resolveClaudeFlowSteps,
} from './claudeConfigFlow'

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

function getPresetById(snapshot: ClaudeSnapshot, providerId: string): ClaudeProviderPreset | undefined {
  return snapshot.presets.find((preset) => preset.providerId === providerId)
}

function getCustomPreset(snapshot: ClaudeSnapshot): ClaudeProviderPreset | undefined {
  return getPresetById(snapshot, 'custom-gateway')
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
  const runtimeCheckRequired = needsClaudeRuntimeCheck(agent.installStatus)
  const [currentStep, setCurrentStep] = useState<ClaudeFlowStepId>('check')
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

  const canInstall = !agent.installStatus.installed
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)
  const availableSteps = resolveClaudeFlowSteps(mode, runtimeCheckRequired)
  const currentStepIndex = Math.max(availableSteps.indexOf(currentStep), 0)
  const nextStep = getNextClaudeStep(currentStep, availableSteps)
  const previousStep = getPreviousClaudeStep(currentStep, availableSteps)
  const selectedPreset = getPresetById(snapshot, providerId) ?? snapshot.presets[0]
  const customPreset = getCustomPreset(snapshot)
  const canReusePresetSecret =
    snapshot.config.providerId === providerId &&
    snapshot.config.hasSecret &&
    Boolean(snapshot.config.secretRef)
  const canReuseCustomSecret =
    snapshot.config.providerId === 'custom-gateway' &&
    snapshot.config.hasSecret &&
    Boolean(snapshot.config.secretRef)
  const hasApiKeyInput = apiKey.trim().length > 0
  const hasReusableSecret = mode === 'preset' ? canReusePresetSecret : canReuseCustomSecret
  const previewDisabled =
    loading ||
    (mode === 'official'
      ? !snapshot.canApplyOfficialMode
      : mode === 'preset'
        ? !hasApiKeyInput && !canReusePresetSecret
        : !providerName.trim() ||
          !baseUrl.trim() ||
          !model.trim() ||
          !authScheme ||
          (!hasApiKeyInput && !canReuseCustomSecret))

  function clearDerivedState() {
    setPreview(null)
    setError(null)
    setSuccess(null)
  }

  function seedPresetFields(nextProviderId: string, overrides?: Partial<ClaudeDraftInput>) {
    const nextPreset = getPresetById(snapshot, nextProviderId)
    if (!nextPreset) {
      return
    }
    setProviderId(nextPreset.providerId)
    setProviderName(overrides?.providerName ?? translateMaybeKey(locale, nextPreset.name))
    setBaseUrl(overrides?.baseUrl ?? nextPreset.endpoint)
    setModel(overrides?.model ?? nextPreset.recommendedModel)
    setAuthScheme(overrides?.authScheme ?? nextPreset.authScheme)
  }

  function seedCustomFields() {
    setProviderId(customPreset?.providerId ?? 'custom-gateway')
    if (snapshot.config.activeMode === 'custom') {
      setProviderName(
        translateMaybeKey(locale, snapshot.config.providerName) ??
          (customPreset?.name ? translateMaybeKey(locale, customPreset.name) : ''),
      )
      setBaseUrl(snapshot.config.baseUrl ?? customPreset?.endpoint ?? '')
      setModel(snapshot.config.model ?? customPreset?.recommendedModel ?? '')
      setAuthScheme(snapshot.config.authScheme ?? customPreset?.authScheme ?? 'anthropic_api_key')
      return
    }
    setProviderName(customPreset?.name ? translateMaybeKey(locale, customPreset.name) : '')
    setBaseUrl(customPreset?.endpoint ?? '')
    setModel(customPreset?.recommendedModel ?? '')
    setAuthScheme(customPreset?.authScheme ?? 'anthropic_api_key')
  }

  function handleModeChange(nextMode: ClaudeProviderMode) {
    setMode(nextMode)
    clearDerivedState()

    if (nextMode === 'preset') {
      const nextPresetId = providerId === 'custom-gateway' ? defaultPresetId(snapshot) : providerId
      seedPresetFields(nextPresetId)
      setCurrentStep('provider')
      return
    }

    if (nextMode === 'custom') {
      seedCustomFields()
      setCurrentStep('details')
      return
    }

    setCurrentStep('details')
  }

  function handlePresetSelect(nextProviderId: string) {
    if (mode !== 'preset') {
      setMode('preset')
    }
    seedPresetFields(nextProviderId)
    clearDerivedState()
  }

  function handleCustomFieldChange(update: () => void) {
    clearDerivedState()
    update()
  }

  useEffect(() => {
    const nextMode = snapshot.config.activeMode ?? 'preset'
    const savedPresetId =
      snapshot.config.providerId &&
      snapshot.config.providerId !== 'custom-gateway' &&
      snapshot.presets.some((preset) => preset.providerId === snapshot.config.providerId)
        ? snapshot.config.providerId
        : defaultPresetId(snapshot)
    const savedPreset = getPresetById(snapshot, savedPresetId) ?? snapshot.presets[0]

    setMode(nextMode)
    if (nextMode === 'custom') {
      setProviderId(customPreset?.providerId ?? 'custom-gateway')
      setProviderName(
        translateMaybeKey(locale, snapshot.config.providerName) ??
          (customPreset?.name ? translateMaybeKey(locale, customPreset.name) : ''),
      )
      setBaseUrl(snapshot.config.baseUrl ?? customPreset?.endpoint ?? '')
      setModel(snapshot.config.model ?? customPreset?.recommendedModel ?? '')
      setAuthScheme(snapshot.config.authScheme ?? customPreset?.authScheme ?? 'anthropic_api_key')
    } else {
      setProviderId(savedPresetId)
      setProviderName(
        nextMode === 'preset'
          ? savedPreset?.name
            ? translateMaybeKey(locale, savedPreset.name)
            : ''
          : snapshot.config.providerName ??
            (savedPreset?.name ? translateMaybeKey(locale, savedPreset.name) : ''),
      )
      setBaseUrl(snapshot.config.baseUrl ?? savedPreset?.endpoint ?? '')
      setModel(snapshot.config.model ?? savedPreset?.recommendedModel ?? '')
      setAuthScheme(snapshot.config.authScheme ?? savedPreset?.authScheme ?? 'anthropic_api_key')
    }
    setApiKey('')
    clearDerivedState()
    setCurrentStep(resolveClaudeEntryStep(nextMode, runtimeCheckRequired))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    customPreset?.authScheme,
    customPreset?.endpoint,
    customPreset?.name,
    customPreset?.providerId,
    customPreset?.recommendedModel,
    locale,
    runtimeCheckRequired,
    snapshot.config.activeMode,
    snapshot.config.providerId,
    snapshot.config.updatedAtMs,
  ])

  useEffect(() => {
    if (availableSteps.includes(currentStep)) {
      return
    }
    setCurrentStep(resolveClaudeEntryStep(mode, runtimeCheckRequired))
  }, [availableSteps, currentStep, mode, runtimeCheckRequired])

  async function handleGeneratePreview() {
    setLoading(true)
    setError(null)
    try {
      const draft: ClaudeDraftInput = {
        mode,
        providerId: mode === 'preset' ? providerId : undefined,
        providerName: mode === 'custom' ? providerName.trim() : undefined,
        baseUrl: mode === 'official' ? undefined : baseUrl.trim(),
        model: mode === 'official' ? undefined : model.trim(),
        authScheme: mode === 'official' ? undefined : authScheme,
        apiKey: apiKey.trim() || undefined,
      }
      const resp = await desktopApi.aiConfigPreviewPatch(workspaceId, 'claude', 'workspace', draft)
      setPreview(resp)
      setCurrentStep('apply')
    } catch (err) {
      setError(describeUnknownError(err))
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
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setLoading(false)
    }
  }

  const stepLabels: Record<ClaudeFlowStepId, string> = {
    check: t(locale, 'aiConfig.step.check'),
    provider: t(locale, 'aiConfig.step.provider'),
    guidance: t(locale, 'aiConfig.step.guidance'),
    details: t(locale, 'aiConfig.step.details'),
    apply: t(locale, 'aiConfig.step.apply'),
  }

  const localizeCategory = (cat: string) => {
    if (cat === 'Global') return t(locale, 'aiConfig.category.global')
    if (cat === 'China') return t(locale, 'aiConfig.category.china')
    return translateMaybeKey(locale, cat)
  }

  const getPresetLogo = (pid: string) => {
    if (pid === 'anthropic-official') return '/assets/logos/claude.webp'
    return null
  }

  const renderLeftAction = () => {
    if (!previousStep) {
      return null
    }
    return (
      <button
        className="nav-side-btn"
        title={currentStep === 'apply' ? t(locale, 'aiConfig.common.modify') : t(locale, 'aiConfig.common.back')}
        onClick={() => setCurrentStep(previousStep)}
      >
        <AppIcon name="chevron-left" width={24} height={24} />
      </button>
    )
  }

  const renderRightAction = () => {
    if (currentStep === 'details') {
      return (
        <button
          className="nav-side-btn"
          disabled={previewDisabled}
          title={t(locale, 'aiConfig.common.previewChanges')}
          onClick={() => void handleGeneratePreview()}
        >
          <AppIcon name={loading ? 'activity' : 'chevron-right'} width={24} height={24} />
        </button>
      )
    }

    if (currentStep === 'apply' && preview) {
      return (
        <button
          className="nav-side-btn btn-apply"
          disabled={loading}
          title={t(locale, 'aiConfig.common.confirmApply')}
          onClick={() => void handleApply()}
        >
          <AppIcon name={loading ? 'activity' : 'check'} width={24} height={24} />
        </button>
      )
    }

    if (!nextStep) {
      return null
    }

    return (
      <button
        className="nav-side-btn"
        title={currentStep === 'guidance' ? t(locale, 'aiConfig.common.gotIt') : t(locale, 'aiConfig.common.next')}
        onClick={() => setCurrentStep(nextStep)}
      >
        <AppIcon name="chevron-right" width={24} height={24} />
      </button>
    )
  }

  const stepperStyle = {
    '--step-count': availableSteps.length,
  } as CSSProperties

  return (
    <AiConfigOverlay
      title={translateMaybeKey(locale, agent.title)}
      subtitle={translateMaybeKey(locale, agent.subtitle)}
      onClose={onClose}
      leftAction={renderLeftAction()}
      rightAction={renderRightAction()}
    >
      <div className="ai-provider-stepper" style={stepperStyle}>
        {availableSteps.map((stepId, idx) => {
          const stepIndex = availableSteps.indexOf(stepId)
          return (
            <button
              key={stepId}
              className={`ai-provider-stepper__item ${currentStep === stepId ? 'is-active' : ''} ${currentStepIndex > stepIndex ? 'is-complete' : ''}`}
              disabled={stepIndex > currentStepIndex}
              onClick={() => {
                setCurrentStep(stepId)
                clearDerivedState()
              }}
            >
              <span>{idx + 1}</span>
              <strong>{stepLabels[stepId]}</strong>
            </button>
          )
        })}
      </div>

      <div className="ai-provider-panel">
        {currentStep === 'check' && (
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
                    style={{
                      height: 44,
                      padding: '0 24px',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      border: 'none',
                      background: '#171717',
                      color: 'white',
                      cursor: 'pointer',
                    }}
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

        {currentStep === 'provider' && (
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
                  disabled={!snapshot.canApplyOfficialMode}
                  onClick={() => handleModeChange('official')}
                >
                  {t(locale, 'aiConfig.mode.official')}
                </button>
                <button
                  className={mode === 'preset' ? 'is-active' : ''}
                  onClick={() => handleModeChange('preset')}
                >
                  {t(locale, 'aiConfig.mode.presets')}
                </button>
                <button
                  className={mode === 'custom' ? 'is-active' : ''}
                  onClick={() => handleModeChange('custom')}
                >
                  {t(locale, 'aiConfig.mode.custom')}
                </button>
              </div>

              {mode === 'preset' && (
                <div className="ai-provider-preset-grid">
                  {snapshot.presets
                    .filter((preset) => preset.providerId !== 'custom-gateway')
                    .map((preset) => (
                      <button
                        key={preset.providerId}
                        className={`ai-provider-preset-card ${providerId === preset.providerId ? 'is-active' : ''}`}
                        onClick={() => handlePresetSelect(preset.providerId)}
                      >
                        <div className="preset-card-header">
                          {getPresetLogo(preset.providerId) ? (
                            <img src={getPresetLogo(preset.providerId)!} alt="" className="preset-logo" />
                          ) : (
                            <div className="preset-logo-placeholder">{translateMaybeKey(locale, preset.name).charAt(0)}</div>
                          )}
                          <span>{localizeCategory(preset.category)}</span>
                        </div>
                        <strong>{translateMaybeKey(locale, preset.name)}</strong>
                        <small>{translateMaybeKey(locale, preset.description)}</small>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {currentStep === 'guidance' && (
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
                      <small>{translateMaybeKey(locale, step)}</small>
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

        {currentStep === 'details' && (
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
                      onChange={(event) =>
                        handleCustomFieldChange(() => setProviderName(event.target.value))
                      }
                    />
                  </div>
                  {mode === 'custom' && (
                    <div className="ai-provider-field">
                      <span>{t(locale, 'aiConfig.guide.authScheme')}</span>
                      <select
                        value={authScheme}
                        onChange={(event) =>
                          handleCustomFieldChange(() =>
                            setAuthScheme(event.target.value as ClaudeAuthScheme),
                          )
                        }
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
                      onChange={(event) =>
                        handleCustomFieldChange(() => setBaseUrl(event.target.value))
                      }
                    />
                  </div>
                  <div className="ai-provider-field">
                    <span>{t(locale, 'aiConfig.details.model')}</span>
                    <input
                      type="text"
                      value={model}
                      placeholder={t(locale, 'aiConfig.details.modelPlaceholder')}
                      onChange={(event) =>
                        handleCustomFieldChange(() => setModel(event.target.value))
                      }
                    />
                  </div>
                  <div className="ai-provider-field">
                    <span>{t(locale, 'aiConfig.details.apiKey')}</span>
                    <input
                      type="password"
                      value={apiKey}
                      autoComplete="new-password"
                      placeholder={
                        hasReusableSecret
                          ? t(locale, 'aiConfig.details.vaulted')
                          : t(locale, 'aiConfig.details.notSet')
                      }
                      onChange={(event) =>
                        handleCustomFieldChange(() => setApiKey(event.target.value))
                      }
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

        {currentStep === 'apply' && preview && (
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
                      <small>{translateMaybeKey(locale, change.before) || t(locale, 'aiConfig.common.empty')}</small>
                      <strong style={{ color: '#007aff' }}>
                        {change.secret ? '********' : translateMaybeKey(locale, change.after)}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>

              {preview.warnings.length > 0 && (
                <div className="ai-provider-diff-list" style={{ marginTop: 8 }}>
                  {preview.warnings.map((warning, index) => (
                    <div
                      key={index}
                      className="ai-provider-diff-list__item"
                      style={{ background: '#fff9e6', borderColor: '#ffe58f' }}
                    >
                      <div className="ai-provider-dot is-warning" />
                      <small style={{ color: '#856404' }}>{translateMaybeKey(locale, warning)}</small>
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
