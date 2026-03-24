import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import {
  desktopApi,
  type AiAgentInstallStatus,
  type AiConfigPreviewResponse,
  type CodexDraftInput,
  type CodexProviderMode,
  type CodexProviderPreset,
  type CodexSnapshot,
  type GeminiAuthMode,
  type GeminiDraftInput,
  type GeminiProviderMode,
  type GeminiProviderPreset,
  type GeminiSnapshot,
} from '@shell/integration/desktop-api'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from '../shared/AiConfigOverlay'
import { describeUnknownError, type LightAgentSnapshotCard } from '../shared/provider-utils'

import '../claude/ClaudeProviderWorkspace.scss'
import './LightAgentProviderWorkspace.scss'

interface BaseLightProviderConfigModalProps<TGuide extends CodexSnapshot | GeminiSnapshot> {
  workspaceId: string
  locale: Locale
  agent: LightAgentSnapshotCard
  guide: TGuide
  installing: boolean
  onInstall: () => void
  onReload: () => void | Promise<void>
  onClose: () => void
}

interface SharedLightProviderConfigModalProps {
  workspaceId: string
  locale: Locale
  agent: LightAgentSnapshotCard
  guide: CodexSnapshot | GeminiSnapshot
  provider: 'codex' | 'gemini'
  installing: boolean
  onInstall: () => void
  onReload: () => void | Promise<void>
  onClose: () => void
}

type LightProviderFlowStepId = 'check' | 'guidance' | 'details' | 'apply'
type ProviderMode = CodexProviderMode | GeminiProviderMode
type ProviderPreset = CodexProviderPreset | GeminiProviderPreset

const LIGHT_PROVIDER_FLOW: LightProviderFlowStepId[] = ['check', 'guidance', 'details', 'apply']
const LIGHT_PROVIDER_DIRECT_FLOW: LightProviderFlowStepId[] = ['guidance', 'details', 'apply']
const CUSTOM_PROVIDER_ID = 'custom-gateway'

function needsLightAgentRuntimeCheck(installStatus: AiAgentInstallStatus): boolean {
  return !installStatus.installed || (installStatus.requiresNode && !installStatus.nodeReady)
}

function resolveLightAgentFlowSteps(runtimeCheckRequired: boolean): LightProviderFlowStepId[] {
  return runtimeCheckRequired ? LIGHT_PROVIDER_FLOW : LIGHT_PROVIDER_DIRECT_FLOW
}

function resolveLightAgentEntryStep(runtimeCheckRequired: boolean): LightProviderFlowStepId {
  return runtimeCheckRequired ? 'check' : 'guidance'
}

function getPreviousLightAgentStep(
  currentStep: LightProviderFlowStepId,
  steps: LightProviderFlowStepId[],
): LightProviderFlowStepId | null {
  const currentIndex = steps.indexOf(currentStep)
  if (currentIndex <= 0) {
    return null
  }
  return steps[currentIndex - 1] ?? null
}

function getNextLightAgentStep(
  currentStep: LightProviderFlowStepId,
  steps: LightProviderFlowStepId[],
): LightProviderFlowStepId | null {
  const currentIndex = steps.indexOf(currentStep)
  if (currentIndex < 0 || currentIndex >= steps.length - 1) {
    return null
  }
  return steps[currentIndex + 1] ?? null
}

function resolveOfficialProviderId(provider: 'codex' | 'gemini'): string {
  return provider === 'codex' ? 'codex-official' : 'google-official'
}

function resolveLightAgentEnvVar(provider: 'codex' | 'gemini'): string {
  return provider === 'codex' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY'
}

function resolveLightAgentConfigLabel(locale: Locale, configPath?: string | null): string {
  if (configPath) {
    return configPath
  }
  return t(locale, 'aiConfig.light.nativeConfigManaged')
}

function resolveGeminiSelectedType(authMode: GeminiAuthMode): string {
  return authMode === 'oauth' ? 'oauth-personal' : 'gemini-api-key'
}

function resolveModeLabel(locale: Locale, mode: ProviderMode): string {
  if (mode === 'official') return t(locale, 'aiConfig.mode.official')
  if (mode === 'preset') return t(locale, 'aiConfig.mode.presets')
  return t(locale, 'aiConfig.mode.custom')
}

function resolveGeminiAuthModeLabel(locale: Locale, authMode: GeminiAuthMode): string {
  return authMode === 'oauth'
    ? t(locale, 'aiConfig.light.oauthSignIn')
    : t(locale, 'aiConfig.details.apiKey')
}

function localizePresetName(locale: Locale, preset: ProviderPreset | null | undefined): string {
  if (!preset) {
    return ''
  }
  return translateMaybeKey(locale, preset.name) || preset.name
}

function localizePresetDescription(locale: Locale, preset: ProviderPreset | null | undefined): string {
  if (!preset) {
    return ''
  }
  return translateMaybeKey(locale, preset.description) || preset.description
}

function localizePresetCategory(locale: Locale, category: string): string {
  if (category === 'Global' || category === 'aiConfig.category.global') {
    return t(locale, 'aiConfig.category.global')
  }
  if (category === 'China' || category === 'aiConfig.category.china') {
    return t(locale, 'aiConfig.category.china')
  }
  return translateMaybeKey(locale, category) || category
}

function SharedLightProviderConfigModal({
  workspaceId,
  locale,
  agent,
  guide,
  provider,
  installing,
  onInstall,
  onReload,
  onClose,
}: SharedLightProviderConfigModalProps) {
  const runtimeCheckRequired = needsLightAgentRuntimeCheck(agent.installStatus)
  const availableSteps = resolveLightAgentFlowSteps(runtimeCheckRequired)
  const officialProviderId = resolveOfficialProviderId(provider)
  const currentStepLabels: Record<LightProviderFlowStepId, string> = {
    check: t(locale, 'aiConfig.step.check'),
    guidance: t(locale, 'aiConfig.step.guidance'),
    details: t(locale, 'aiConfig.step.details'),
    apply: t(locale, 'aiConfig.step.apply'),
  }

  const presets = guide.presets
  const officialPreset = presets.find((preset) => preset.providerId === officialProviderId) ?? presets[0] ?? null
  const customPreset = presets.find((preset) => preset.providerId === CUSTOM_PROVIDER_ID) ?? presets[presets.length - 1] ?? null
  const selectablePresets = presets.filter(
    (preset) => preset.providerId !== officialProviderId && preset.providerId !== CUSTOM_PROVIDER_ID,
  )
  const defaultPreset = selectablePresets[0] ?? officialPreset ?? customPreset

  const [currentStep, setCurrentStep] = useState<LightProviderFlowStepId>('check')
  const [mode, setMode] = useState<ProviderMode>('official')
  const [providerId, setProviderId] = useState('')
  const [providerName, setProviderName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [configToml, setConfigToml] = useState('')
  const [authMode, setAuthMode] = useState<GeminiAuthMode>('oauth')
  const [selectedType, setSelectedType] = useState(resolveGeminiSelectedType('oauth'))
  const [preview, setPreview] = useState<AiConfigPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const currentStepIndex = Math.max(availableSteps.indexOf(currentStep), 0)
  const previousStep = getPreviousLightAgentStep(currentStep, availableSteps)
  const nextStep = getNextLightAgentStep(currentStep, availableSteps)
  const canInstall = !agent.installStatus.installed
  const currentConfig = guide.config
  const codexConfig = provider === 'codex' ? guide.config as CodexSnapshot['config'] : null
  const geminiConfig = provider === 'gemini' ? guide.config as GeminiSnapshot['config'] : null
  const envVarName = resolveLightAgentEnvVar(provider)

  const activePreset = useMemo(() => {
    if (mode === 'official') {
      return officialPreset
    }
    if (mode === 'custom') {
      return customPreset
    }
    return presets.find((preset) => preset.providerId === providerId) ?? defaultPreset
  }, [customPreset, defaultPreset, mode, officialPreset, presets, providerId])

  const activePresetLabel = localizePresetName(locale, activePreset)
  const activePresetDescription = localizePresetDescription(locale, activePreset)

  const canReuseSecret = useMemo(() => {
    if (mode === 'official') {
      return false
    }
    const targetProviderId = mode === 'custom' ? CUSTOM_PROVIDER_ID : providerId
    return currentConfig.providerId === targetProviderId && currentConfig.hasSecret && Boolean(currentConfig.secretRef)
  }, [currentConfig.hasSecret, currentConfig.providerId, currentConfig.secretRef, mode, providerId])

  const requiresApiKey = useMemo(() => {
    if (provider === 'codex') {
      if (mode === 'official') {
        return false
      }
      if (mode === 'custom') {
        return true
      }
      return Boolean((activePreset as CodexProviderPreset | null | undefined)?.requiresApiKey)
    }

    if (mode === 'official') {
      return false
    }
    if (mode === 'custom') {
      return authMode === 'api_key'
    }
    return authMode === 'api_key' || Boolean((activePreset as GeminiProviderPreset | null | undefined)?.requiresApiKey)
  }, [activePreset, authMode, mode, provider])

  const previewDisabled = useMemo(() => {
    if (loading) {
      return true
    }
    if (mode === 'custom') {
      if (!providerName.trim() || !baseUrl.trim() || !model.trim()) {
        return true
      }
    }
    if (requiresApiKey && !apiKey.trim() && !canReuseSecret) {
      return true
    }
    return false
  }, [apiKey, baseUrl, canReuseSecret, loading, mode, model, providerName, requiresApiKey])

  function clearDerivedState() {
    setPreview(null)
    setError(null)
    setSuccess(null)
  }

  function applyCodexState(nextMode: CodexProviderMode, nextProviderId?: string) {
    const nextPreset =
      nextMode === 'official'
        ? officialPreset
        : nextMode === 'custom'
          ? customPreset
          : presets.find((preset) => preset.providerId === nextProviderId)
            ?? presets.find((preset) => preset.providerId === currentConfig.providerId)
            ?? defaultPreset

    setMode(nextMode)
    setProviderId(nextPreset?.providerId ?? nextProviderId ?? '')
    setProviderName(
      nextMode === 'custom'
        ? currentConfig.activeMode === 'custom'
          ? currentConfig.providerName ?? ''
          : translateMaybeKey(locale, nextPreset?.name) || ''
        : '',
    )

    if (nextMode === 'official') {
      setBaseUrl(currentConfig.activeMode === 'official' ? currentConfig.baseUrl ?? '' : nextPreset?.endpoint ?? '')
      setModel(currentConfig.activeMode === 'official' ? currentConfig.model ?? '' : nextPreset?.recommendedModel ?? '')
      setConfigToml('')
      return
    }

    if (nextMode === 'custom') {
      setBaseUrl(currentConfig.activeMode === 'custom' ? currentConfig.baseUrl ?? '' : nextPreset?.endpoint ?? '')
      setModel(currentConfig.activeMode === 'custom' ? currentConfig.model ?? '' : nextPreset?.recommendedModel ?? '')
      setConfigToml(
        currentConfig.activeMode === 'custom'
          ? codexConfig?.configToml ?? ''
          : (nextPreset as CodexProviderPreset | null | undefined)?.configTemplate ?? '',
      )
      return
    }

    const presetId = nextPreset?.providerId ?? ''
    const isCurrentPreset = currentConfig.activeMode === 'preset' && currentConfig.providerId === presetId
    setBaseUrl(isCurrentPreset ? currentConfig.baseUrl ?? nextPreset?.endpoint ?? '' : nextPreset?.endpoint ?? '')
    setModel(isCurrentPreset ? currentConfig.model ?? nextPreset?.recommendedModel ?? '' : nextPreset?.recommendedModel ?? '')
    setConfigToml(
      isCurrentPreset
        ? codexConfig?.configToml ?? (nextPreset as CodexProviderPreset | null | undefined)?.configTemplate ?? ''
        : (nextPreset as CodexProviderPreset | null | undefined)?.configTemplate ?? '',
    )
  }

  function applyGeminiState(nextMode: GeminiProviderMode, nextProviderId?: string) {
    const nextPreset =
      nextMode === 'official'
        ? officialPreset
        : nextMode === 'custom'
          ? customPreset
          : presets.find((preset) => preset.providerId === nextProviderId)
            ?? presets.find((preset) => preset.providerId === currentConfig.providerId)
            ?? defaultPreset

    const fallbackAuthMode =
      nextMode === 'official'
        ? 'oauth'
        : (nextPreset as GeminiProviderPreset | null | undefined)?.authMode ?? 'api_key'
    const isCurrentMatch =
      currentConfig.activeMode === nextMode
      && (nextMode !== 'preset' || currentConfig.providerId === (nextPreset?.providerId ?? null))
      && (nextMode !== 'custom' || currentConfig.providerId === CUSTOM_PROVIDER_ID)

    const nextAuthMode = isCurrentMatch ? geminiConfig?.authMode ?? fallbackAuthMode : fallbackAuthMode
    const nextSelectedType = isCurrentMatch
      ? geminiConfig?.selectedType ?? resolveGeminiSelectedType(nextAuthMode)
      : (nextPreset as GeminiProviderPreset | null | undefined)?.selectedType ?? resolveGeminiSelectedType(nextAuthMode)

    setMode(nextMode)
    setProviderId(nextPreset?.providerId ?? nextProviderId ?? '')
    setProviderName(
      nextMode === 'custom'
        ? currentConfig.activeMode === 'custom'
          ? currentConfig.providerName ?? ''
          : translateMaybeKey(locale, nextPreset?.name) || ''
        : '',
    )
    setBaseUrl(isCurrentMatch ? currentConfig.baseUrl ?? nextPreset?.endpoint ?? '' : nextPreset?.endpoint ?? '')
    setModel(isCurrentMatch ? currentConfig.model ?? nextPreset?.recommendedModel ?? '' : nextPreset?.recommendedModel ?? '')
    setAuthMode(nextAuthMode)
    setSelectedType(nextSelectedType)
    setConfigToml('')
  }

  function applyProviderState(nextMode: ProviderMode, nextProviderId?: string) {
    clearDerivedState()
    setApiKey('')
    if (provider === 'codex') {
      applyCodexState(nextMode as CodexProviderMode, nextProviderId)
      return
    }
    applyGeminiState(nextMode as GeminiProviderMode, nextProviderId)
  }

  useEffect(() => {
    const activeMode = (currentConfig.activeMode ?? (defaultPreset ? 'preset' : 'official')) as ProviderMode
    applyProviderState(activeMode, currentConfig.providerId ?? defaultPreset?.providerId)
    setCurrentStep(resolveLightAgentEntryStep(runtimeCheckRequired))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide, provider, locale, runtimeCheckRequired])

  useEffect(() => {
    if (availableSteps.includes(currentStep)) {
      return
    }
    setCurrentStep(resolveLightAgentEntryStep(runtimeCheckRequired))
  }, [availableSteps, currentStep, runtimeCheckRequired])

  async function handleGeneratePreview() {
    setLoading(true)
    setError(null)
    try {
      if (provider === 'codex') {
        const draft: CodexDraftInput = {
          mode: mode as CodexProviderMode,
          providerId: mode === 'preset' ? providerId || undefined : undefined,
          providerName: mode === 'custom' ? providerName.trim() || undefined : undefined,
          baseUrl: mode === 'official' ? undefined : baseUrl.trim() || undefined,
          model: mode === 'official' ? undefined : model.trim() || undefined,
          apiKey: requiresApiKey ? apiKey.trim() || undefined : undefined,
          configToml: mode === 'official' ? undefined : configToml.trim() || undefined,
        }
        const response = await desktopApi.aiConfigPreviewPatch(workspaceId, 'codex', 'workspace', draft)
        setPreview(response)
        setCurrentStep('apply')
        return
      }

      const draft: GeminiDraftInput = {
        mode: mode as GeminiProviderMode,
        authMode: mode === 'official' ? undefined : authMode,
        providerId: mode === 'preset' ? providerId || undefined : undefined,
        providerName: mode === 'custom' ? providerName.trim() || undefined : undefined,
        baseUrl: mode === 'official' ? undefined : baseUrl.trim() || undefined,
        model: mode === 'official' ? undefined : model.trim() || undefined,
        apiKey: requiresApiKey ? apiKey.trim() || undefined : undefined,
        selectedType: mode === 'official' ? undefined : selectedType,
      }
      const response = await desktopApi.aiConfigPreviewPatch(workspaceId, 'gemini', 'workspace', draft)
      setPreview(response)
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

  const stepperStyle = {
    '--step-count': availableSteps.length,
  } as CSSProperties

  const renderLeftAction = () => {
    if (!previousStep) {
      return null
    }
    return (
      <button
        className="nav-side-btn"
        title={currentStep === 'apply' ? t(locale, 'aiConfig.common.modify') : t(locale, 'aiConfig.common.back')}
        onClick={() => {
          setCurrentStep(previousStep)
          if (previousStep !== 'apply') {
            setError(null)
            setSuccess(null)
          }
        }}
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
        title={currentStep === 'guidance' ? t(locale, 'aiConfig.common.next') : t(locale, 'aiConfig.common.next')}
        onClick={() => setCurrentStep(nextStep)}
      >
        <AppIcon name="chevron-right" width={24} height={24} />
      </button>
    )
  }

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
                if (stepId !== 'apply') {
                  setError(null)
                  setSuccess(null)
                }
              }}
            >
              <span>{idx + 1}</span>
              <strong>{currentStepLabels[stepId]}</strong>
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
                  <h4>{t(locale, 'aiConfig.light.readiness')}</h4>
                  <p>{t(locale, 'aiConfig.light.runtimeCheckDesc')}</p>
                </div>
              </div>

              <div className="ai-provider-guide-card__summary ai-light-provider-summary">
                <div>
                  <span>{t(locale, 'aiConfig.runtime.nodeStatus')}</span>
                  <strong style={{ color: agent.installStatus.nodeReady ? '#0f8f50' : '#d4af37' }}>
                    {agent.installStatus.nodeReady
                      ? t(locale, 'aiConfig.runtime.ready')
                      : t(locale, 'aiConfig.runtime.notFound')}
                  </strong>
                  <small>
                    {agent.installStatus.requiresNode
                      ? t(locale, 'aiConfig.light.nodeRequired')
                      : t(locale, 'aiConfig.light.nodeNotRequired')}
                  </small>
                </div>
                <div>
                  <span>{t(locale, 'aiConfig.runtime.installStatus')}</span>
                  <strong style={{ color: agent.installStatus.installed ? '#0f8f50' : '#d4af37' }}>
                    {agent.installStatus.installed
                      ? t(locale, 'aiConfig.runtime.cliInstalled')
                      : t(locale, 'aiConfig.runtime.notInstalled')}
                  </strong>
                  <small>{agent.installStatus.executable || t(locale, 'aiConfig.light.pathFallback')}</small>
                </div>
                <div>
                  <span>{t(locale, 'aiConfig.light.mcpBridge')}</span>
                  <strong style={{ color: guide.mcpInstalled ? '#0f8f50' : '#d4af37' }}>
                    {guide.mcpInstalled
                      ? t(locale, 'aiConfig.light.configured')
                      : t(locale, 'aiConfig.light.notConfigured')}
                  </strong>
                  <small>{t(locale, 'aiConfig.light.mcpOptional')}</small>
                </div>
                <div>
                  <span>{t(locale, 'aiConfig.light.credentialStatus')}</span>
                  <strong style={{ color: currentConfig.hasSecret ? '#0f8f50' : '#d4af37' }}>
                    {currentConfig.hasSecret
                      ? t(locale, 'aiConfig.light.vaulted')
                      : t(locale, 'aiConfig.light.notConfiguredYet')}
                  </strong>
                  <small>{t(locale, 'aiConfig.light.workspaceSecretDesc')}</small>
                </div>
              </div>

              {agent.installStatus.issues.length > 0 && (
                <div className="ai-light-provider-note">
                  <strong>{t(locale, 'aiConfig.runtime.notes')}</strong>
                  <p>{agent.installStatus.issues.join(' ')}</p>
                </div>
              )}

              {canInstall && (
                <div className="ai-provider-install-action">
                  <button className="nav-btn btn-primary" disabled={installing} onClick={() => onInstall()}>
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

        {currentStep === 'guidance' && (
          <div className="ai-provider-panel-step">
            <div className="ai-provider-panel-content">
              <div className="ai-provider-panel__header">
                <div>
                  <h4>{t(locale, 'aiConfig.guide.title')}</h4>
                  <p>{translateMaybeKey(locale, guide.summary) || t(locale, 'aiConfig.light.guidanceFallback')}</p>
                </div>
              </div>

              <div className="ai-provider-mode-toggle">
                <button
                  className={mode === 'official' ? 'is-active' : ''}
                  onClick={() => applyProviderState('official')}
                >
                  {t(locale, 'aiConfig.mode.official')}
                </button>
                <button
                  className={mode === 'preset' ? 'is-active' : ''}
                  onClick={() => applyProviderState('preset', defaultPreset?.providerId)}
                >
                  {t(locale, 'aiConfig.mode.presets')}
                </button>
                <button
                  className={mode === 'custom' ? 'is-active' : ''}
                  onClick={() => applyProviderState('custom')}
                >
                  {t(locale, 'aiConfig.mode.custom')}
                </button>
              </div>

              {mode === 'preset' && selectablePresets.length > 0 && (
                <div className="ai-provider-preset-grid">
                  {selectablePresets.map((preset) => (
                    <button
                      key={preset.providerId}
                      className={`ai-provider-preset-card ${providerId === preset.providerId ? 'is-active' : ''}`}
                      onClick={() => applyProviderState('preset', preset.providerId)}
                    >
                      <div className="preset-card-header">
                        <div className="preset-logo-placeholder">
                          {localizePresetName(locale, preset).charAt(0) || 'P'}
                        </div>
                        <span>{localizePresetCategory(locale, preset.category)}</span>
                      </div>
                      <strong>{localizePresetName(locale, preset)}</strong>
                      <small>{localizePresetDescription(locale, preset)}</small>
                    </button>
                  ))}
                </div>
              )}

              {(mode !== 'preset' || selectablePresets.length === 0) && activePreset && (
                <article className="ai-light-provider-selection-card">
                  <div className="ai-light-provider-selection-card__top">
                    <div>
                      <strong>{activePresetLabel}</strong>
                      <p>{activePresetDescription}</p>
                    </div>
                    <span>{resolveModeLabel(locale, mode)}</span>
                  </div>
                </article>
              )}

              <div className="ai-provider-guide-card__summary ai-light-provider-summary">
                <div>
                  <span>{t(locale, 'aiConfig.light.injectedEnvVar')}</span>
                  <strong>{envVarName}</strong>
                  <small>{t(locale, 'aiConfig.light.injectedEnvVarDesc')}</small>
                </div>
                <div>
                  <span>{t(locale, 'aiConfig.details.model')}</span>
                  <strong>{model || activePreset?.recommendedModel || t(locale, 'aiConfig.common.empty')}</strong>
                  <small>{t(locale, 'aiConfig.light.recommendedPrefillDesc')}</small>
                </div>
                <div>
                  <span>{t(locale, 'aiConfig.light.localConfigPath')}</span>
                  <strong>{resolveLightAgentConfigLabel(locale, guide.configPath)}</strong>
                  <small>{t(locale, 'aiConfig.light.localConfigDesc')}</small>
                </div>
                <div>
                  <span>{provider === 'gemini' ? t(locale, 'aiConfig.light.authMode') : t(locale, 'aiConfig.light.configMode')}</span>
                  <strong>
                    {provider === 'gemini' && mode !== 'official'
                      ? resolveGeminiAuthModeLabel(locale, authMode)
                      : resolveModeLabel(locale, mode)}
                  </strong>
                  <small>
                    {provider === 'gemini'
                      ? t(locale, 'aiConfig.light.geminiAuthModeDesc')
                      : t(locale, 'aiConfig.light.codexConfigTemplateDesc')}
                  </small>
                </div>
              </div>

              <div className="ai-provider-guide-card__links">
                <a href={guide.docsUrl} target="_blank" rel="noreferrer">
                  <AppIcon name="external" width={14} height={14} style={{ marginRight: 6 }} />
                  {t(locale, 'aiConfig.light.docs')}
                </a>
                {activePreset?.websiteUrl && (
                  <a href={activePreset.websiteUrl} target="_blank" rel="noreferrer">
                    <AppIcon name="external" width={14} height={14} style={{ marginRight: 6 }} />
                    {t(locale, 'aiConfig.guide.website')}
                  </a>
                )}
                {activePreset?.apiKeyUrl && (
                  <a href={activePreset.apiKeyUrl} target="_blank" rel="noreferrer">
                    <AppIcon name="external" width={14} height={14} style={{ marginRight: 6 }} />
                    {t(locale, 'aiConfig.guide.getApiKey')}
                  </a>
                )}
                {activePreset?.billingUrl && (
                  <a href={activePreset.billingUrl} target="_blank" rel="noreferrer">
                    <AppIcon name="external" width={14} height={14} style={{ marginRight: 6 }} />
                    {t(locale, 'aiConfig.light.billingConsole')}
                  </a>
                )}
              </div>

              {provider === 'gemini' && Boolean((activePreset as GeminiProviderPreset | null | undefined)?.extraEnv) && (
                <div className="ai-light-provider-extra-env">
                  <strong>{t(locale, 'aiConfig.light.extraEnvironment')}</strong>
                  <div className="ai-light-provider-inline-badges">
                    {Object.entries((activePreset as GeminiProviderPreset).extraEnv ?? {}).map(([key, value]) => (
                      <span key={key}>
                        <code>{key}</code>
                        <small>{value}</small>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="ai-light-provider-guide-list">
                {(activePreset?.setupSteps ?? guide.tips).map((step, index) => (
                  <div key={`${step}-${index}`} className="ai-provider-diff-list__item">
                    <div className="ai-provider-dot is-warning" />
                    <div>
                      <strong>
                        {t(locale, 'aiConfig.guide.step')} {index + 1}
                      </strong>
                      <small>{translateMaybeKey(locale, step)}</small>
                    </div>
                  </div>
                ))}
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
                    {provider === 'codex'
                      ? t(locale, 'aiConfig.light.codexDetailsDesc')
                      : t(locale, 'aiConfig.light.geminiDetailsDesc')}
                  </p>
                </div>
              </div>

              <div className="ai-light-provider-inline-badges">
                <span>{resolveModeLabel(locale, mode)}</span>
                <span>{activePresetLabel || translateMaybeKey(locale, agent.title)}</span>
                {provider === 'gemini' && mode !== 'official' && <span>{resolveGeminiAuthModeLabel(locale, authMode)}</span>}
              </div>

              {mode === 'official' ? (
                <div className="ai-provider-diff-list">
                  <div className="ai-provider-diff-list__item">
                    <div className="ai-provider-dot is-success" />
                    <div style={{ alignItems: 'flex-start', flex: 1 }}>
                      <strong>{t(locale, 'aiConfig.details.directTitle')}</strong>
                      <small>
                        {provider === 'codex'
                          ? t(locale, 'aiConfig.light.codexOfficialModeDesc')
                          : t(locale, 'aiConfig.light.geminiOfficialModeDesc')}
                      </small>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ai-provider-form-grid ai-light-provider-details-grid">
                  <div className="ai-provider-field" style={{ gridColumn: 'span 2' }}>
                    <span>{t(locale, 'aiConfig.details.providerName')}</span>
                    {mode === 'custom' ? (
                      <input
                        type="text"
                        value={providerName}
                        placeholder={t(locale, 'aiConfig.details.namePlaceholder')}
                        onChange={(event) => {
                          clearDerivedState()
                          setProviderName(event.target.value)
                        }}
                      />
                    ) : (
                      <input type="text" className="is-readonly" value={activePresetLabel} readOnly />
                    )}
                    <small>
                      {mode === 'custom'
                        ? t(locale, 'aiConfig.light.customProviderNameDesc')
                        : t(locale, 'aiConfig.light.presetProviderNameDesc')}
                    </small>
                  </div>

                  {provider === 'gemini' && (
                    <div className="ai-provider-field">
                      <span>{t(locale, 'aiConfig.light.authMode')}</span>
                      <select
                        value={authMode}
                        onChange={(event) => {
                          const nextAuthMode = event.target.value as GeminiAuthMode
                          clearDerivedState()
                          setAuthMode(nextAuthMode)
                          setSelectedType(resolveGeminiSelectedType(nextAuthMode))
                        }}
                      >
                        <option value="oauth">{t(locale, 'aiConfig.light.oauthSignIn')}</option>
                        <option value="api_key">{t(locale, 'aiConfig.details.apiKey')}</option>
                      </select>
                      <small>
                        {t(locale, 'aiConfig.light.geminiSelectedTypeDesc')}
                      </small>
                    </div>
                  )}

                  {provider === 'gemini' && (
                    <div className="ai-provider-field">
                      <span>{t(locale, 'aiConfig.light.runtimeType')}</span>
                      <input type="text" className="is-readonly" value={selectedType} readOnly />
                      <small>
                        {t(locale, 'aiConfig.light.runtimeTypeDerivedDesc')}
                      </small>
                    </div>
                  )}

                  <div className="ai-provider-field" style={{ gridColumn: 'span 2' }}>
                    <span>{t(locale, 'aiConfig.details.baseUrl')}</span>
                    <input
                      type="text"
                      value={baseUrl}
                      placeholder={t(locale, 'aiConfig.details.endpointPlaceholder')}
                      onChange={(event) => {
                        clearDerivedState()
                        setBaseUrl(event.target.value)
                      }}
                    />
                    <small>
                      {mode === 'custom'
                        ? t(locale, 'aiConfig.light.customBaseUrlDesc')
                        : t(locale, 'aiConfig.light.presetBaseUrlDesc')}
                    </small>
                  </div>

                  <div className="ai-provider-field">
                    <span>{t(locale, 'aiConfig.details.model')}</span>
                    <input
                      type="text"
                      value={model}
                      placeholder={t(locale, 'aiConfig.details.modelPlaceholder')}
                      onChange={(event) => {
                        clearDerivedState()
                        setModel(event.target.value)
                      }}
                    />
                    <small>
                      {t(locale, 'aiConfig.light.modelFallbackDesc')}
                    </small>
                  </div>

                  {(requiresApiKey || canReuseSecret) && (
                    <div className="ai-provider-field">
                      <span>{envVarName}</span>
                      <input
                        type="password"
                        value={apiKey}
                        autoComplete="new-password"
                        placeholder={
                          canReuseSecret
                            ? t(locale, 'aiConfig.details.vaulted')
                            : provider === 'codex'
                              ? 'sk-...'
                              : 'AIza...'
                        }
                        onChange={(event) => {
                          clearDerivedState()
                          setApiKey(event.target.value)
                        }}
                      />
                      <small>
                        {canReuseSecret
                          ? t(locale, 'aiConfig.light.keepVaultedSecret')
                          : requiresApiKey
                            ? t(locale, 'aiConfig.light.storeVaultedSecret')
                            : t(locale, 'aiConfig.light.apiKeyOptionalDesc')}
                      </small>
                    </div>
                  )}

                  {provider === 'codex' && (
                    <div className="ai-provider-field" style={{ gridColumn: 'span 2' }}>
                      <span>{t(locale, 'aiConfig.light.configTomlLabel')}</span>
                      <textarea
                        className="ai-light-provider-textarea"
                        value={configToml}
                        placeholder={(activePreset as CodexProviderPreset | null | undefined)?.configTemplate ?? ''}
                        onChange={(event) => {
                          clearDerivedState()
                          setConfigToml(event.target.value)
                        }}
                      />
                      <small>
                        {t(locale, 'aiConfig.light.codexConfigTomlDesc')}
                      </small>
                    </div>
                  )}
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
                  <p>{t(locale, 'aiConfig.light.reviewDesc')}</p>
                </div>
              </div>

              <div className="ai-provider-diff-list">
                {preview.maskedDiff.map((change) => {
                  const beforeLabel = translateMaybeKey(locale, change.before) || t(locale, 'aiConfig.common.empty')
                  const afterLabel = change.secret
                    ? '********'
                    : translateMaybeKey(locale, change.after) || t(locale, 'aiConfig.common.empty')

                  return (
                    <div key={change.key} className="ai-provider-diff-list__item">
                      <span>{change.label}</span>
                      <div>
                        <small>{beforeLabel}</small>
                        <strong style={{ color: '#007aff' }}>{afterLabel}</strong>
                      </div>
                    </div>
                  )
                })}
              </div>

              {preview.warnings.length > 0 && (
                <div className="ai-provider-diff-list">
                  {preview.warnings.map((warning, index) => (
                    <div key={`${warning}-${index}`} className="ai-provider-diff-list__item ai-light-provider-warning">
                      <div className="ai-provider-dot is-warning" />
                      <div>
                        <strong>{t(locale, 'aiConfig.light.warningTitle')}</strong>
                        <small>{translateMaybeKey(locale, warning)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {error && <div className="ai-provider-feedback is-error">{error}</div>}
        {success && <div className="ai-provider-feedback is-success">{success}</div>}
      </div>
    </AiConfigOverlay>
  )
}

export function CodexConfigModal(props: BaseLightProviderConfigModalProps<CodexSnapshot>) {
  return <SharedLightProviderConfigModal {...props} provider="codex" />
}

export function GeminiConfigModal(props: BaseLightProviderConfigModalProps<GeminiSnapshot>) {
  return <SharedLightProviderConfigModal {...props} provider="gemini" />
}
