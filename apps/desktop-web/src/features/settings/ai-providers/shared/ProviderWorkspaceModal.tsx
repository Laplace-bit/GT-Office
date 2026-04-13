import { useEffect, useMemo, useState } from 'react'

import {
  desktopApi,
  type AiAgentSnapshotCard,
  type AiConfigApplyResponse,
  type AiConfigDraftInput,
  type AiConfigSnapshot,
  type ClaudeApiFormat,
  type ClaudeAuthScheme,
  type ClaudeConfigSnapshot,
  type ClaudeDraftInput,
  type ClaudeModelOverrides,
  type ClaudeSavedProviderSnapshot,
  type ClaudeSnapshot,
  type CodexConfigSnapshot,
  type CodexDraftInput,
  type CodexProviderPreset,
  type CodexSavedProviderSnapshot,
  type CodexSnapshot,
  type GeminiAuthMode,
  type GeminiConfigSnapshot,
  type GeminiDraftInput,
  type GeminiProviderPreset,
  type GeminiSavedProviderSnapshot,
  type GeminiSnapshot,
} from '@shell/integration/desktop-api'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon, type AppIconName } from '@shell/ui/icons'

import { AiConfigOverlay } from './AiConfigOverlay'
import {
  filterSavedProviders,
  localizeLabel,
  resolveModeLabel,
  resolveSavedProviderFacts,
  resolveSavedProviderMeta,
  type ProviderMode,
} from './provider-workspace-presenter.js'
import { describeUnknownError } from './provider-utils'

import './ProviderWorkspaceModal.scss'

type ProviderWorkspaceModalProps =
  | {
      agentId: 'claude'
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: ClaudeSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }
  | {
      agentId: 'codex'
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: CodexSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }
  | {
      agentId: 'gemini'
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: GeminiSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }

type EditorMode = 'create' | 'edit' | 'duplicate'
type ViewMode = 'list' | 'editor'

const CUSTOM_PROVIDER_ID = 'custom-gateway'

function resolveSelectedType(authMode: GeminiAuthMode): string {
  return authMode === 'oauth' ? 'oauth-personal' : 'gemini-api-key'
}

function resolveAgentDisplayName(locale: Locale, agent: AiAgentSnapshotCard): string {
  return translateMaybeKey(locale, agent.title)
}

interface ProviderIconButtonProps {
  icon: AppIconName
  label: string
  onClick?: () => void
  disabled?: boolean
  tone?: 'default' | 'danger' | 'active'
}

function ProviderIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  tone = 'default',
}: ProviderIconButtonProps) {
  return (
    <button
      type="button"
      className={`provider-workspace__icon-button is-${tone}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <AppIcon name={icon} width={16} height={16} />
      <span className="vb-sr-only">{label}</span>
    </button>
  )
}

export function ProviderWorkspaceModal(props: ProviderWorkspaceModalProps) {
  const { agentId, locale, agent, guide, onReload, onSnapshotUpdate, onClose } = props
  const [localGuide, setLocalGuide] = useState<typeof guide>(guide)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [editorMode, setEditorMode] = useState<EditorMode>('create')
  const [editingSavedProviderId, setEditingSavedProviderId] = useState<string | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [mode, setMode] = useState<ProviderMode>('preset')
  const [providerId, setProviderId] = useState('')
  const [providerName, setProviderName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [authScheme, setAuthScheme] = useState<ClaudeAuthScheme>('anthropic_api_key')
  const [configToml, setConfigToml] = useState('')
  const [authMode, setAuthMode] = useState<GeminiAuthMode>('oauth')
  const [selectedType, setSelectedType] = useState(resolveSelectedType('oauth'))
  const [loading, setLoading] = useState(false)
  const [switchingSavedProviderId, setSwitchingSavedProviderId] = useState<string | null>(null)
  const [deletingSavedProviderId, setDeletingSavedProviderId] = useState<string | null>(null)
  const [pendingDeleteSavedProviderId, setPendingDeleteSavedProviderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // Advanced Claude options
  const [apiFormat, setApiFormat] = useState<ClaudeApiFormat>('anthropic')
  const [modelOverrides, setModelOverrides] = useState<ClaudeModelOverrides>({})
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    setLocalGuide(guide)
  }, [guide])

  function selectGuideFromSnapshot(snapshot: AiConfigSnapshot): typeof guide {
    switch (agentId) {
      case 'claude':
        return snapshot.claude as typeof guide
      case 'codex':
        return snapshot.codex as typeof guide
      case 'gemini':
        return snapshot.gemini as typeof guide
    }
  }

  function removeSavedProviderFromGuide(
    nextGuide: typeof guide,
    savedProviderId: string,
  ): typeof guide {
    switch (agentId) {
      case 'claude': {
        const typedGuide = nextGuide as ClaudeSnapshot
        const remainingSavedProviders = typedGuide.savedProviders.filter(
          (item) => item.savedProviderId !== savedProviderId,
        )
        return {
          ...typedGuide,
          savedProviders: remainingSavedProviders,
          config:
            typedGuide.config.savedProviderId === savedProviderId
              ? {
                  ...typedGuide.config,
                  savedProviderId:
                    remainingSavedProviders.find((item) => item.isActive)?.savedProviderId,
                }
              : typedGuide.config,
        } as typeof guide
      }
      case 'codex': {
        const typedGuide = nextGuide as CodexSnapshot
        const remainingSavedProviders = typedGuide.savedProviders.filter(
          (item) => item.savedProviderId !== savedProviderId,
        )
        return {
          ...typedGuide,
          savedProviders: remainingSavedProviders,
          config:
            typedGuide.config.savedProviderId === savedProviderId
              ? {
                  ...typedGuide.config,
                  savedProviderId:
                    remainingSavedProviders.find((item) => item.isActive)?.savedProviderId,
                }
              : typedGuide.config,
        } as typeof guide
      }
      case 'gemini': {
        const typedGuide = nextGuide as GeminiSnapshot
        const remainingSavedProviders = typedGuide.savedProviders.filter(
          (item) => item.savedProviderId !== savedProviderId,
        )
        return {
          ...typedGuide,
          savedProviders: remainingSavedProviders,
          config:
            typedGuide.config.savedProviderId === savedProviderId
              ? {
                  ...typedGuide.config,
                  savedProviderId:
                    remainingSavedProviders.find((item) => item.isActive)?.savedProviderId,
                }
              : typedGuide.config,
        } as typeof guide
      }
    }
  }

  const presets = localGuide.presets
  const officialProviderId =
    agentId === 'claude'
      ? 'anthropic-official'
      : agentId === 'codex'
        ? 'codex-official'
        : 'google-official'
  const officialPreset = presets.find((item) => item.providerId === officialProviderId) ?? presets[0] ?? null
  const customPreset = presets.find((item) => item.providerId === CUSTOM_PROVIDER_ID) ?? null
  const selectablePresets = presets.filter(
    (item) => item.providerId !== officialProviderId && item.providerId !== CUSTOM_PROVIDER_ID,
  )
  const defaultPreset = selectablePresets[0] ?? officialPreset ?? customPreset ?? presets[0] ?? null
  const savedProviders = localGuide.savedProviders
  const currentConfig = localGuide.config
  const claudeGuide = agentId === 'claude' ? (localGuide as ClaudeSnapshot) : null
  const codexGuide = agentId === 'codex' ? (localGuide as CodexSnapshot) : null
  const geminiGuide = agentId === 'gemini' ? (localGuide as GeminiSnapshot) : null
  const currentSavedProvider =
    editingSavedProviderId != null
      ? savedProviders.find((item) => item.savedProviderId === editingSavedProviderId) ?? null
      : null
  const filteredSavedProviders = useMemo(
    () => filterSavedProviders(locale, savedProviders, searchValue),
    [locale, savedProviders, searchValue],
  )
  const pendingDeleteSavedProvider =
    pendingDeleteSavedProviderId != null
      ? savedProviders.find((item) => item.savedProviderId === pendingDeleteSavedProviderId) ?? null
      : null
  const currentPreset =
    mode === 'official'
      ? officialPreset
      : mode === 'custom'
        ? customPreset
        : presets.find((item) => item.providerId === providerId) ?? defaultPreset
  const providerLabel = mode === 'custom'
    ? providerName.trim() || t(locale, '自定义供应商', 'Custom provider')
    : localizeLabel(locale, currentPreset?.name)
  const canApplyOfficialMode = agentId === 'claude' ? guide.canApplyOfficialMode : true

  function clearFeedback() {
    setError(null)
    setSuccess(null)
  }

  function resetPreview() {
    clearFeedback()
  }

  function seedClaudeFromCurrent() {
    if (!claudeGuide) {
      return
    }

    const nextMode = (claudeGuide.config.activeMode ?? 'preset') as ProviderMode
    const nextPresetId =
      claudeGuide.config.providerId
      && selectablePresets.some((item) => item.providerId === claudeGuide.config.providerId)
        ? claudeGuide.config.providerId
        : defaultPreset?.providerId ?? ''
    const nextPreset = presets.find((item) => item.providerId === nextPresetId) ?? defaultPreset

    setMode(nextMode)
    if (nextMode === 'official') {
      setProviderId(officialPreset?.providerId ?? officialProviderId)
      setProviderName(localizeLabel(locale, claudeGuide.config.providerName ?? officialPreset?.name) || '')
      setBaseUrl(claudeGuide.config.baseUrl ?? officialPreset?.endpoint ?? '')
      setModel(claudeGuide.config.model ?? officialPreset?.recommendedModel ?? '')
      setAuthScheme(
        claudeGuide.config.authScheme
          ?? (officialPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme
          ?? 'anthropic_auth_token',
      )
      return
    }

    if (nextMode === 'custom') {
      setProviderId(customPreset?.providerId ?? CUSTOM_PROVIDER_ID)
      setProviderName(localizeLabel(locale, claudeGuide.config.providerName) || localizeLabel(locale, customPreset?.name))
      setBaseUrl(claudeGuide.config.baseUrl ?? customPreset?.endpoint ?? '')
      setModel(claudeGuide.config.model ?? customPreset?.recommendedModel ?? '')
      setAuthScheme(
        claudeGuide.config.authScheme
          ?? (customPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme
          ?? 'anthropic_api_key',
      )
      return
    }

    setProviderId(nextPresetId)
    setProviderName(localizeLabel(locale, claudeGuide.config.providerName) || localizeLabel(locale, nextPreset?.name))
    setBaseUrl(claudeGuide.config.baseUrl ?? nextPreset?.endpoint ?? '')
    setModel(claudeGuide.config.model ?? nextPreset?.recommendedModel ?? '')
    setAuthScheme(
      claudeGuide.config.authScheme
        ?? (nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme
        ?? 'anthropic_api_key',
    )
    setApiFormat(claudeGuide.config.apiFormat ?? 'anthropic')
    setModelOverrides(claudeGuide.config.modelOverrides ?? {})
  }

  function seedCodexFromCurrent() {
    if (!codexGuide) {
      return
    }

    const nextMode = (codexGuide.config.activeMode ?? (defaultPreset ? 'preset' : 'official')) as ProviderMode
    const nextPreset =
      nextMode === 'official'
        ? officialPreset
        : nextMode === 'custom'
          ? customPreset
          : presets.find((item) => item.providerId === codexGuide.config.providerId) ?? defaultPreset

    setMode(nextMode)
    setProviderId(nextPreset?.providerId ?? '')
    setProviderName(nextMode === 'custom' ? codexGuide.config.providerName ?? '' : localizeLabel(locale, nextPreset?.name))
    setBaseUrl(
      nextMode === 'official'
        ? codexGuide.config.baseUrl ?? ''
        : codexGuide.config.baseUrl ?? nextPreset?.endpoint ?? '',
    )
    setModel(codexGuide.config.model ?? nextPreset?.recommendedModel ?? '')
    setConfigToml(
      codexGuide.config.configToml
        ?? (nextPreset as CodexProviderPreset | undefined)?.configTemplate
        ?? '',
    )
  }

  function seedGeminiFromCurrent() {
    if (!geminiGuide) {
      return
    }

    const nextMode = (geminiGuide.config.activeMode ?? (defaultPreset ? 'preset' : 'official')) as ProviderMode
    const nextPreset =
      nextMode === 'official'
        ? officialPreset
        : nextMode === 'custom'
          ? customPreset
          : presets.find((item) => item.providerId === geminiGuide.config.providerId) ?? defaultPreset
    const nextAuthMode =
      nextMode === 'official'
        ? 'oauth'
        : geminiGuide.config.authMode ?? (nextPreset as GeminiProviderPreset | undefined)?.authMode ?? 'api_key'

    setMode(nextMode)
    setProviderId(nextPreset?.providerId ?? '')
    setProviderName(nextMode === 'custom' ? geminiGuide.config.providerName ?? '' : localizeLabel(locale, nextPreset?.name))
    setBaseUrl(
      nextMode === 'official'
        ? geminiGuide.config.baseUrl ?? ''
        : geminiGuide.config.baseUrl ?? nextPreset?.endpoint ?? '',
    )
    setModel(geminiGuide.config.model ?? nextPreset?.recommendedModel ?? '')
    setAuthMode(nextAuthMode)
    setSelectedType(
      geminiGuide.config.selectedType
        ?? (nextPreset as GeminiProviderPreset | undefined)?.selectedType
        ?? resolveSelectedType(nextAuthMode),
    )
  }

  function seedFromCurrent() {
    setEditorMode('create')
    setEditingSavedProviderId(null)
    setApiKey('')
    resetPreview()

    if (agentId === 'claude') {
      seedClaudeFromCurrent()
      return
    }
    if (agentId === 'codex') {
      seedCodexFromCurrent()
      return
    }
    seedGeminiFromCurrent()
  }

  function seedFromSavedProvider(savedProviderId: string, nextEditorMode: EditorMode) {
    const savedProvider = savedProviders.find((item) => item.savedProviderId === savedProviderId)
    if (!savedProvider) {
      return
    }

    setEditorMode(nextEditorMode)
    setEditingSavedProviderId(nextEditorMode === 'edit' ? savedProviderId : null)
    setApiKey('')
    resetPreview()

    if (agentId === 'claude') {
      const nextSavedProvider = savedProvider as ClaudeSavedProviderSnapshot
      setMode(nextSavedProvider.mode)
      if (nextSavedProvider.mode === 'official') {
        setProviderId(officialPreset?.providerId ?? officialProviderId)
        setProviderName(localizeLabel(locale, officialPreset?.name) || t(locale, 'Anthropic 官方', 'Anthropic Official'))
        setBaseUrl(officialPreset?.endpoint ?? '')
        setModel(nextSavedProvider.model ?? officialPreset?.recommendedModel ?? '')
        setAuthScheme('anthropic_auth_token')
      } else if (nextSavedProvider.mode === 'custom') {
        setProviderId(nextSavedProvider.providerId ?? customPreset?.providerId ?? CUSTOM_PROVIDER_ID)
        setProviderName(localizeLabel(locale, nextSavedProvider.providerName))
        setBaseUrl(nextSavedProvider.baseUrl ?? customPreset?.endpoint ?? '')
        setModel(nextSavedProvider.model ?? customPreset?.recommendedModel ?? '')
        setAuthScheme(
          nextSavedProvider.authScheme
            ?? (customPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme
            ?? 'anthropic_api_key',
        )
      } else {
        const nextPreset = presets.find((item) => item.providerId === nextSavedProvider.providerId) ?? defaultPreset
        setProviderId(nextSavedProvider.providerId ?? defaultPreset?.providerId ?? '')
        setProviderName(localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, nextPreset?.name))
        setBaseUrl(nextSavedProvider.baseUrl ?? nextPreset?.endpoint ?? '')
        setModel(nextSavedProvider.model ?? nextPreset?.recommendedModel ?? '')
        setAuthScheme(nextSavedProvider.authScheme ?? (nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key')
      }
      setApiFormat(nextSavedProvider.apiFormat ?? 'anthropic')
      setModelOverrides(nextSavedProvider.modelOverrides ?? {})
      return
    }

    if (agentId === 'codex') {
      const nextSavedProvider = savedProvider as CodexSavedProviderSnapshot
      setMode(nextSavedProvider.mode)
      if (nextSavedProvider.mode === 'official') {
        setProviderId(officialPreset?.providerId ?? officialProviderId)
        setProviderName(localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, officialPreset?.name))
        setBaseUrl('')
        setModel(nextSavedProvider.model ?? officialPreset?.recommendedModel ?? '')
        setConfigToml('')
      } else if (nextSavedProvider.mode === 'custom') {
        setProviderId(nextSavedProvider.providerId ?? customPreset?.providerId ?? CUSTOM_PROVIDER_ID)
        setProviderName(localizeLabel(locale, nextSavedProvider.providerName))
        setBaseUrl(nextSavedProvider.baseUrl ?? customPreset?.endpoint ?? '')
        setModel(nextSavedProvider.model ?? customPreset?.recommendedModel ?? '')
        setConfigToml(
          nextSavedProvider.configToml
            ?? (customPreset as CodexProviderPreset | undefined)?.configTemplate
            ?? '',
        )
      } else {
        const nextPreset = presets.find((item) => item.providerId === nextSavedProvider.providerId) ?? defaultPreset
        setProviderId(nextSavedProvider.providerId ?? defaultPreset?.providerId ?? '')
        setProviderName(localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, nextPreset?.name))
        setBaseUrl(nextSavedProvider.baseUrl ?? nextPreset?.endpoint ?? '')
        setModel(nextSavedProvider.model ?? nextPreset?.recommendedModel ?? '')
        setConfigToml(nextSavedProvider.configToml ?? (nextPreset as CodexProviderPreset | undefined)?.configTemplate ?? '')
      }
      return
    }

    const nextSavedProvider = savedProvider as GeminiSavedProviderSnapshot
    setMode(nextSavedProvider.mode)
    setAuthMode(nextSavedProvider.authMode)
    setSelectedType(nextSavedProvider.selectedType)
    if (nextSavedProvider.mode === 'official') {
      setProviderId(officialPreset?.providerId ?? officialProviderId)
      setProviderName(localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, officialPreset?.name))
      setBaseUrl('')
      setModel(nextSavedProvider.model ?? officialPreset?.recommendedModel ?? '')
      return
    }
    if (nextSavedProvider.mode === 'custom') {
      setProviderId(nextSavedProvider.providerId ?? customPreset?.providerId ?? CUSTOM_PROVIDER_ID)
      setProviderName(localizeLabel(locale, nextSavedProvider.providerName))
      setBaseUrl(nextSavedProvider.baseUrl ?? customPreset?.endpoint ?? '')
      setModel(nextSavedProvider.model ?? customPreset?.recommendedModel ?? '')
      return
    }

    const nextPreset = presets.find((item) => item.providerId === nextSavedProvider.providerId) ?? defaultPreset
    setProviderId(nextSavedProvider.providerId ?? defaultPreset?.providerId ?? '')
    setProviderName(localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, nextPreset?.name))
    setBaseUrl(nextSavedProvider.baseUrl ?? nextPreset?.endpoint ?? '')
    setModel(nextSavedProvider.model ?? nextPreset?.recommendedModel ?? '')
  }

  function openCreateEditor() {
    seedFromCurrent()
    setViewMode('editor')
  }

  function openEditEditor(savedProviderId: string) {
    seedFromSavedProvider(savedProviderId, 'edit')
    setViewMode('editor')
  }

  function openDuplicateEditor(savedProviderId: string) {
    seedFromSavedProvider(savedProviderId, 'duplicate')
    setViewMode('editor')
  }

  function handleModeSelect(nextMode: ProviderMode) {
    resetPreview()
    setMode(nextMode)
    setApiKey('')

    if (nextMode === 'official') {
      setProviderId(officialPreset?.providerId ?? officialProviderId)
      setProviderName(localizeLabel(locale, officialPreset?.name))
      setBaseUrl('')
      setModel(officialPreset?.recommendedModel ?? '')
      if (agentId === 'claude') {
        setAuthScheme((officialPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_auth_token')
      }
      if (agentId === 'codex') {
        setConfigToml('')
      }
      if (agentId === 'gemini') {
        setAuthMode('oauth')
        setSelectedType(resolveSelectedType('oauth'))
      }
      return
    }

    if (nextMode === 'custom') {
      setProviderId(customPreset?.providerId ?? CUSTOM_PROVIDER_ID)
      setProviderName(localizeLabel(locale, customPreset?.name))
      setBaseUrl(customPreset?.endpoint ?? '')
      setModel(customPreset?.recommendedModel ?? '')
      if (agentId === 'claude') {
        setAuthScheme((customPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key')
      }
      if (agentId === 'codex') {
        setConfigToml((customPreset as CodexProviderPreset | undefined)?.configTemplate ?? '')
      }
      if (agentId === 'gemini') {
        const nextAuthMode = (customPreset as GeminiProviderPreset | undefined)?.authMode ?? 'api_key'
        setAuthMode(nextAuthMode)
        setSelectedType((customPreset as GeminiProviderPreset | undefined)?.selectedType ?? resolveSelectedType(nextAuthMode))
      }
      return
    }

    const nextPreset = defaultPreset
    setProviderId(nextPreset?.providerId ?? '')
    setProviderName(localizeLabel(locale, nextPreset?.name))
    setBaseUrl(nextPreset?.endpoint ?? '')
    setModel(nextPreset?.recommendedModel ?? '')
    if (agentId === 'claude') {
      setAuthScheme((nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key')
    }
    if (agentId === 'codex') {
      setConfigToml((nextPreset as CodexProviderPreset | undefined)?.configTemplate ?? '')
    }
    if (agentId === 'gemini') {
      const nextAuthMode = (nextPreset as GeminiProviderPreset | undefined)?.authMode ?? 'api_key'
      setAuthMode(nextAuthMode)
      setSelectedType((nextPreset as GeminiProviderPreset | undefined)?.selectedType ?? resolveSelectedType(nextAuthMode))
    }
  }

  function handlePresetSelect(nextProviderId: string) {
    resetPreview()
    setProviderId(nextProviderId)
    setApiKey('')
    const nextPreset = presets.find((item) => item.providerId === nextProviderId) ?? defaultPreset
    setProviderName(localizeLabel(locale, nextPreset?.name))
    setBaseUrl(nextPreset?.endpoint ?? '')
    setModel(nextPreset?.recommendedModel ?? '')
    if (agentId === 'claude') {
      setAuthScheme((nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key')
    }
    if (agentId === 'codex') {
      setConfigToml((nextPreset as CodexProviderPreset | undefined)?.configTemplate ?? '')
    }
    if (agentId === 'gemini') {
      const nextAuthMode = (nextPreset as GeminiProviderPreset | undefined)?.authMode ?? authMode
      setAuthMode(nextAuthMode)
      setSelectedType((nextPreset as GeminiProviderPreset | undefined)?.selectedType ?? resolveSelectedType(nextAuthMode))
    }
  }

  const currentSelectionProviderId =
    mode === 'custom' ? CUSTOM_PROVIDER_ID : mode === 'preset' ? providerId : officialProviderId
  const canReuseSecret =
    Boolean(currentSavedProvider?.hasSecret && editorMode === 'edit')
    || (currentConfig.providerId === currentSelectionProviderId
      && currentConfig.hasSecret
      && Boolean((currentConfig as ClaudeConfigSnapshot | CodexConfigSnapshot | GeminiConfigSnapshot).secretRef))
  const requiresApiKey =
    agentId === 'claude'
      ? mode !== 'official'
      : agentId === 'codex'
        ? mode === 'custom'
          ? true
          : mode === 'official'
            ? false
            : Boolean((currentPreset as CodexProviderPreset | undefined)?.requiresApiKey)
        : mode === 'official'
          ? false
          : mode === 'custom'
            ? authMode === 'api_key'
            : authMode === 'api_key' || Boolean((currentPreset as GeminiProviderPreset | undefined)?.requiresApiKey)
  const isFormValid =
    mode === 'official'
      ? canApplyOfficialMode
      : mode === 'preset'
        ? Boolean(providerId && baseUrl.trim() && model.trim() && (!requiresApiKey || apiKey.trim() || canReuseSecret))
        : Boolean(
            providerName.trim()
            && baseUrl.trim()
            && model.trim()
            && (!requiresApiKey || apiKey.trim() || canReuseSecret),
          )

  function buildDraftInput(): AiConfigDraftInput {
    if (agentId === 'claude') {
      return {
        mode,
        savedProviderId: editorMode === 'edit' ? editingSavedProviderId : undefined,
        providerId: mode === 'preset' ? providerId || undefined : undefined,
        providerName: mode === 'official' ? undefined : providerName.trim() || undefined,
        baseUrl: mode === 'official' ? undefined : baseUrl.trim() || undefined,
        model: mode === 'official' ? undefined : model.trim() || undefined,
        authScheme: mode === 'official' ? undefined : authScheme,
        apiKey: apiKey.trim() || undefined,
        apiFormat: mode === 'official' ? undefined : apiFormat,
        modelOverrides: mode === 'official' ? undefined : (
          (modelOverrides.haikuModel || modelOverrides.sonnetModel || modelOverrides.opusModel)
            ? modelOverrides
            : undefined
        ),
      } satisfies ClaudeDraftInput
    }

    if (agentId === 'codex') {
      return {
        mode,
        savedProviderId: editorMode === 'edit' ? editingSavedProviderId : undefined,
        providerId: mode === 'preset' ? providerId || undefined : undefined,
        providerName: mode === 'custom' ? providerName.trim() || undefined : undefined,
        baseUrl: mode === 'official' ? undefined : baseUrl.trim() || undefined,
        model: mode === 'official' ? undefined : model.trim() || undefined,
        apiKey: requiresApiKey ? apiKey.trim() || undefined : undefined,
        configToml: mode === 'official' ? undefined : configToml.trim() || undefined,
      } satisfies CodexDraftInput
    }

    return {
      mode,
      savedProviderId: editorMode === 'edit' ? editingSavedProviderId : undefined,
      authMode: mode === 'official' ? undefined : authMode,
      providerId: mode === 'preset' ? providerId || undefined : undefined,
      providerName: mode === 'custom' ? providerName.trim() || undefined : undefined,
      baseUrl: mode === 'official' ? undefined : baseUrl.trim() || undefined,
      model: mode === 'official' ? undefined : model.trim() || undefined,
      apiKey: requiresApiKey ? apiKey.trim() || undefined : undefined,
      selectedType: mode === 'official' ? undefined : selectedType,
    } satisfies GeminiDraftInput
  }

  async function syncAfterMutation(
    response: AiConfigApplyResponse,
    message: string,
    options?: { deletedSavedProviderId?: string },
  ) {
    const nextGuide = selectGuideFromSnapshot(response.effective)
    setLocalGuide(
      options?.deletedSavedProviderId
        ? removeSavedProviderFromGuide(nextGuide, options.deletedSavedProviderId)
        : nextGuide,
    )
    onSnapshotUpdate(response.effective)
    await onReload()
    setSuccess(message)
  }

  async function handleApply() {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const preview = await desktopApi.aiConfigPreviewPatch(null, agentId, 'global', buildDraftInput())
      const response = await desktopApi.aiConfigApplyPatch(null, preview.previewId, 'System Admin')
      await syncAfterMutation(
        response,
        editorMode === 'edit'
          ? t(locale, '模型供应商已更新', 'Provider updated')
          : t(locale, '模型供应商已保存', 'Provider saved'),
      )
      setViewMode('list')
      setEditingSavedProviderId(null)
      setEditorMode('create')
      setApiKey('')
    } catch (err) {
      const message = describeUnknownError(err)
      if (message.includes('no effective changes to apply')) {
        setSuccess(t(locale, '没有可保存的变更', 'No changes to save'))
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSwitchSavedProvider(savedProviderId: string) {
    // Proxy-aware switching protection: warn if the target provider uses a format requiring middleware
    if (agentId === 'claude') {
      const target = savedProviders.find(
        (p): p is ClaudeSavedProviderSnapshot =>
          (p as ClaudeSavedProviderSnapshot).savedProviderId === savedProviderId,
      ) as ClaudeSavedProviderSnapshot | undefined
      const targetFormat = target?.apiFormat
      if (targetFormat === 'openai_chat' || targetFormat === 'openai_responses') {
        const confirmed = window.confirm(
          t(
            locale,
            `此供应商使用的 API 格式 (${targetFormat}) 需要代理中间件才能正常工作。\n直接切换可能导致 Claude Code 无法连接。\n确认继续？`,
            `This provider uses API format '${targetFormat}' which requires a proxy middleware.\nSwitching directly may cause Claude Code connection issues.\nContinue anyway?`,
          ),
        )
        if (!confirmed) {
          return
        }
      }
    }

    setSwitchingSavedProviderId(savedProviderId)
    setError(null)
    setSuccess(null)

    try {
      const response = await desktopApi.aiConfigSwitchSavedProvider(
        null,
        agentId,
        savedProviderId,
        'System Admin',
      )
      await syncAfterMutation(response, t(locale, '已切换当前模型供应商', 'Active provider switched'))
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setSwitchingSavedProviderId(null)
    }
  }

  function requestDeleteSavedProvider(savedProviderId: string) {
    setPendingDeleteSavedProviderId(savedProviderId)
    setError(null)
    setSuccess(null)
  }

  async function handleDeleteSavedProvider(savedProviderId: string) {
    setDeletingSavedProviderId(savedProviderId)
    setPendingDeleteSavedProviderId(null)
    setError(null)
    setSuccess(null)

    try {
      const response = await desktopApi.aiConfigDeleteSavedProvider(
        null,
        agentId,
        savedProviderId,
        'System Admin',
      )
      await syncAfterMutation(response, t(locale, '模型供应商已删除', 'Provider deleted'), {
        deletedSavedProviderId: savedProviderId,
      })
      if (editingSavedProviderId === savedProviderId) {
        setViewMode('list')
        setEditingSavedProviderId(null)
      }
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setDeletingSavedProviderId(null)
    }
  }

  const editorTitle =
    editorMode === 'edit'
      ? t(locale, '编辑模型供应商', 'Edit provider')
      : editorMode === 'duplicate'
        ? t(locale, '复制模型供应商', 'Duplicate provider')
        : t(locale, '新增模型供应商', 'Add provider')

  return (
    <AiConfigOverlay
      title={resolveAgentDisplayName(locale, agent)}
      subtitle={t(locale, '模型供应商', 'Model Providers')}
      onClose={onClose}
    >
      <div className="provider-workspace">
        {error && <div className="provider-workspace__feedback is-error">{error}</div>}
        {success && <div className="provider-workspace__feedback is-success">{success}</div>}

        {viewMode === 'list' ? (
          <section className="provider-workspace__panel">
            <div className="provider-workspace__toolbar">
              <div>
                <h4>{t(locale, '已保存供应商', 'Saved providers')}</h4>
                <p>{t(locale, '这里集中管理已保存配置，可直接新增、切换、复制或删除。', 'Manage saved provider configurations here. Add, switch, duplicate, or delete from one place.')}</p>
              </div>
              <div className="provider-workspace__toolbar-actions">
                <label className="provider-workspace__search-wrap">
                  <AppIcon name="search" width={15} height={15} />
                  <input
                    className="provider-workspace__search"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder={t(locale, '搜索名称、模型或地址', 'Search name, model, or endpoint')}
                    aria-label={t(locale, '搜索模型供应商', 'Search providers')}
                  />
                </label>
                <button type="button" className="nav-btn btn-primary provider-workspace__primary-action" onClick={openCreateEditor}>
                  <AppIcon name="plus" width={15} height={15} />
                  {t(locale, '新增', 'Add')}
                </button>
              </div>
            </div>

            {filteredSavedProviders.length === 0 ? (
              <div className="provider-workspace__empty">
                <strong>
                  {savedProviders.length === 0
                    ? t(locale, '还没有模型供应商', 'No providers yet')
                    : t(locale, '没有匹配的结果', 'No matching providers')}
                </strong>
                <p>
                  {savedProviders.length === 0
                    ? t(locale, '先新增一份配置，后续可直接切换或复制。', 'Create your first provider configuration to switch or duplicate later.')
                    : t(locale, '试试更短的关键词，或者清空搜索后再查看全部列表。', 'Try a shorter keyword or clear the search to see everything again.')}
                </p>
                {savedProviders.length === 0 && (
                  <button type="button" className="nav-btn btn-primary" onClick={openCreateEditor}>
                    <AppIcon name="plus" width={15} height={15} />
                    {t(locale, '立即新增', 'Create now')}
                  </button>
                )}
              </div>
            ) : (
              <div className="provider-workspace__list">
                {filteredSavedProviders.map((savedProvider) => {
                  const isBusy =
                    loading
                    || switchingSavedProviderId === savedProvider.savedProviderId
                    || deletingSavedProviderId === savedProvider.savedProviderId
                  const savedProviderMeta = resolveSavedProviderMeta(locale, agentId, savedProvider)
                  const savedProviderFacts = resolveSavedProviderFacts(locale, savedProvider)

                  return (
                    <article
                      key={savedProvider.savedProviderId}
                      className={`provider-workspace__item ${savedProvider.isActive ? 'is-active' : ''}`}
                    >
                      <div className="provider-workspace__item-main">
                        <div className="provider-workspace__item-top">
                          <div className="provider-workspace__item-title">
                            <strong>{localizeLabel(locale, savedProvider.providerName)}</strong>
                            {savedProvider.isActive && (
                              <span className="provider-workspace__badge">
                                <AppIcon name="check" width={12} height={12} />
                                {t(locale, '当前生效', 'Active')}
                              </span>
                            )}
                          </div>
                          <div className="provider-workspace__item-meta">
                            {savedProviderMeta.map((meta, index) => (
                              <span key={`${meta}-${index}`}>{meta}</span>
                            ))}
                          </div>
                        </div>

                        <div className="provider-workspace__item-facts">
                          {savedProviderFacts.map((fact) => (
                            <div key={fact.label} className="provider-workspace__item-fact">
                              <span>{fact.label}</span>
                              <strong title={fact.value}>{fact.value}</strong>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="provider-workspace__item-actions">
                        {!savedProvider.isActive && (
                          <ProviderIconButton
                            icon={switchingSavedProviderId === savedProvider.savedProviderId ? 'activity' : 'check'}
                            label={
                              switchingSavedProviderId === savedProvider.savedProviderId
                                ? t(locale, '切换中...', 'Switching...')
                                : t(locale, '设为当前', 'Set active')
                            }
                            disabled={isBusy}
                            onClick={() => void handleSwitchSavedProvider(savedProvider.savedProviderId)}
                          />
                        )}
                        <ProviderIconButton
                          icon="pencil"
                          label={t(locale, '编辑', 'Edit')}
                          disabled={isBusy}
                          onClick={() => openEditEditor(savedProvider.savedProviderId)}
                        />
                        <ProviderIconButton
                          icon="copy"
                          label={t(locale, '复制', 'Duplicate')}
                          disabled={isBusy}
                          onClick={() => openDuplicateEditor(savedProvider.savedProviderId)}
                        />
                        <ProviderIconButton
                          icon={deletingSavedProviderId === savedProvider.savedProviderId ? 'activity' : 'trash'}
                          label={
                            deletingSavedProviderId === savedProvider.savedProviderId
                              ? t(locale, '删除中...', 'Deleting...')
                              : t(locale, '删除', 'Delete')
                          }
                          disabled={isBusy}
                          tone="danger"
                          onClick={() => requestDeleteSavedProvider(savedProvider.savedProviderId)}
                        />
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="provider-workspace__panel">
            <div className="provider-workspace__toolbar is-editor">
              <div>
                <button
                  type="button"
                  className="provider-workspace__back"
                  onClick={() => {
                    setViewMode('list')
                    clearFeedback()
                  }}
                >
                  <AppIcon name="chevron-left" width={16} height={16} />
                  {t(locale, '返回列表', 'Back to list')}
                </button>
                <h4>{editorTitle}</h4>
                <p>
                  {editorMode === 'duplicate'
                    ? t(locale, '已复制原配置，请按需调整并重新保存。', 'The existing configuration has been copied. Adjust the fields and save as a new provider.')
                    : t(locale, '配置保存后会全局生效，所有工作目录共用。', 'Saved providers apply globally across every workspace.')}
                </p>
              </div>
              <div className="provider-workspace__toolbar-actions">
                <ProviderIconButton
                  icon="rotate-ccw"
                  label={t(locale, '恢复当前配置', 'Reset to current')}
                  disabled={loading}
                  onClick={seedFromCurrent}
                />
              </div>
            </div>

            <div className="provider-workspace__mode-toggle">
              {([
                ['official', t(locale, '官方', 'Official')],
                ['preset', t(locale, '预设', 'Preset')],
                ['custom', t(locale, '自定义', 'Custom')],
              ] as const).map(([value, label]) => {
                const disabled = value === 'official' && !canApplyOfficialMode
                return (
                  <button
                    key={value}
                    type="button"
                    className={mode === value ? 'is-active' : ''}
                    disabled={disabled}
                    onClick={() => handleModeSelect(value)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {mode === 'preset' && selectablePresets.length > 0 && (
              <div className="provider-workspace__preset-grid">
                {selectablePresets.map((preset) => (
                  <button
                    key={preset.providerId}
                    type="button"
                    className={`provider-workspace__preset-card ${providerId === preset.providerId ? 'is-active' : ''}`}
                    onClick={() => handlePresetSelect(preset.providerId)}
                  >
                    <span>{localizeLabel(locale, preset.category)}</span>
                    <strong>{localizeLabel(locale, preset.name)}</strong>
                    <small>{localizeLabel(locale, preset.description)}</small>
                  </button>
                ))}
              </div>
            )}

            <div className="provider-workspace__selection">
              <div>
                <span>{t(locale, '当前选择', 'Current selection')}</span>
                <strong>{providerLabel || t(locale, '未命名供应商', 'Unnamed provider')}</strong>
              </div>
              <div>
                <span>{t(locale, '模式', 'Mode')}</span>
                <strong>{resolveModeLabel(locale, mode)}</strong>
              </div>
              <div>
                <span>{t(locale, '推荐模型', 'Recommended model')}</span>
                <strong>{model || currentPreset?.recommendedModel || t(locale, '默认模型', 'Default model')}</strong>
              </div>
            </div>

            <div className="provider-workspace__form">
              {mode === 'custom' && (
                <label className="provider-workspace__field">
                  <span>{t(locale, '供应商名称', 'Provider name')}</span>
                  <input
                    type="text"
                    value={providerName}
                    placeholder={t(locale, '例如：团队网关', 'For example: Team gateway')}
                    onChange={(event) => {
                      resetPreview()
                      setProviderName(event.target.value)
                    }}
                  />
                </label>
              )}

              {agentId === 'gemini' && mode !== 'official' && (
                <label className="provider-workspace__field">
                  <span>{t(locale, '认证方式', 'Auth mode')}</span>
                  <select
                    value={authMode}
                    onChange={(event) => {
                      const nextAuthMode = event.target.value as GeminiAuthMode
                      resetPreview()
                      setAuthMode(nextAuthMode)
                      setSelectedType(resolveSelectedType(nextAuthMode))
                    }}
                  >
                    <option value="oauth">OAuth</option>
                    <option value="api_key">API Key</option>
                  </select>
                </label>
              )}

              {agentId === 'claude' && mode !== 'official' && (
                <label className="provider-workspace__field">
                  <span>{t(locale, '密钥类型', 'Credential type')}</span>
                  <select
                    value={authScheme}
                    onChange={(event) => {
                      resetPreview()
                      setAuthScheme(event.target.value as ClaudeAuthScheme)
                    }}
                  >
                    <option value="anthropic_api_key">ANTHROPIC_API_KEY</option>
                    <option value="anthropic_auth_token">ANTHROPIC_AUTH_TOKEN</option>
                  </select>
                </label>
              )}

              {agentId === 'gemini' && mode !== 'official' && (
                <label className="provider-workspace__field">
                  <span>{t(locale, '运行类型', 'Runtime type')}</span>
                  <input type="text" value={selectedType} readOnly className="is-readonly" />
                </label>
              )}

              {mode !== 'official' && (
                <label className="provider-workspace__field is-wide">
                  <span>{t(locale, 'Base URL', 'Base URL')}</span>
                  <input
                    type="text"
                    value={baseUrl}
                    placeholder={t(locale, 'https://api.example.com', 'https://api.example.com')}
                    onChange={(event) => {
                      resetPreview()
                      setBaseUrl(event.target.value)
                    }}
                  />
                </label>
              )}

              {mode !== 'official' && (
                <label className="provider-workspace__field">
                  <span>{t(locale, '模型', 'Model')}</span>
                  <input
                    type="text"
                    value={model}
                    placeholder={currentPreset?.recommendedModel ?? ''}
                    onChange={(event) => {
                      resetPreview()
                      setModel(event.target.value)
                    }}
                  />
                </label>
              )}

              {(requiresApiKey || canReuseSecret) && (
                <label className="provider-workspace__field">
                  <span>
                    {agentId === 'claude'
                      ? authScheme === 'anthropic_auth_token'
                        ? 'ANTHROPIC_AUTH_TOKEN'
                        : 'ANTHROPIC_API_KEY'
                      : agentId === 'codex'
                        ? 'OPENAI_API_KEY'
                        : 'GOOGLE_API_KEY'}
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={apiKey}
                    placeholder={
                      canReuseSecret
                        ? t(locale, '沿用已托管密钥', 'Reuse vaulted secret')
                        : agentId === 'gemini'
                          ? 'AIza...'
                          : 'sk-...'
                    }
                    onChange={(event) => {
                      resetPreview()
                      setApiKey(event.target.value)
                    }}
                  />
                  <small>
                    {canReuseSecret
                      ? t(locale, '留空则继续使用当前托管密钥。', 'Leave empty to keep using the vaulted secret.')
                      : t(locale, '保存后会写入系统凭证库，不会明文落盘。', 'The credential is stored in the system keychain and never written in plaintext.')}
                  </small>
                </label>
              )}

              {agentId === 'codex' && mode !== 'official' && (
                <label className="provider-workspace__field is-wide">
                  <span>{t(locale, 'Codex 配置模板', 'Codex config template')}</span>
                  <textarea
                    value={configToml}
                    onChange={(event) => {
                      resetPreview()
                      setConfigToml(event.target.value)
                    }}
                    placeholder={(currentPreset as CodexProviderPreset | undefined)?.configTemplate ?? ''}
                  />
                </label>
              )}

              {/* Advanced Claude options — collapsible */}
              {agentId === 'claude' && mode !== 'official' && (
                <div className="provider-workspace__advanced">
                  <button
                    type="button"
                    className="provider-workspace__advanced-toggle"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    <AppIcon name={showAdvanced ? 'chevron-up' : 'chevron-down'} width={13} height={13} />
                    {showAdvanced
                      ? t(locale, '收起高级选项', 'Hide advanced options')
                      : t(locale, '展开高级选项', 'Advanced options')}
                  </button>

                  {showAdvanced && (
                    <div className="provider-workspace__advanced-fields">
                      <label className="provider-workspace__field">
                        <span>{t(locale, 'API 格式', 'API format')}</span>
                        <select
                          value={apiFormat}
                          onChange={(event) => {
                            resetPreview()
                            setApiFormat(event.target.value as ClaudeApiFormat)
                          }}
                        >
                          <option value="anthropic">{t(locale, 'Anthropic（原生）', 'Anthropic (native)')}</option>
                          <option value="openai_chat">{t(locale, 'OpenAI Chat（需代理）', 'OpenAI Chat (proxy required)')}</option>
                          <option value="openai_responses">{t(locale, 'OpenAI Responses（需代理）', 'OpenAI Responses (proxy required)')}</option>
                        </select>
                        {(apiFormat === 'openai_chat' || apiFormat === 'openai_responses') && (
                          <small className="is-warning">
                            {t(locale, '⚠️ 此格式需要代理中间件才能正常工作', '⚠️ This format requires a proxy middleware to function')}
                          </small>
                        )}
                      </label>

                      <label className="provider-workspace__field">
                        <span>{t(locale, 'Haiku 模型覆盖', 'Haiku model override')}</span>
                        <input
                          type="text"
                          value={modelOverrides.haikuModel ?? ''}
                          placeholder={model || t(locale, '与主模型相同', 'Same as main model')}
                          onChange={(event) => {
                            resetPreview()
                            setModelOverrides((prev) => ({ ...prev, haikuModel: event.target.value || undefined }))
                          }}
                        />
                      </label>

                      <label className="provider-workspace__field">
                        <span>{t(locale, 'Sonnet 模型覆盖', 'Sonnet model override')}</span>
                        <input
                          type="text"
                          value={modelOverrides.sonnetModel ?? ''}
                          placeholder={model || t(locale, '与主模型相同', 'Same as main model')}
                          onChange={(event) => {
                            resetPreview()
                            setModelOverrides((prev) => ({ ...prev, sonnetModel: event.target.value || undefined }))
                          }}
                        />
                      </label>

                      <label className="provider-workspace__field">
                        <span>{t(locale, 'Opus 模型覆盖', 'Opus model override')}</span>
                        <input
                          type="text"
                          value={modelOverrides.opusModel ?? ''}
                          placeholder={model || t(locale, '与主模型相同', 'Same as main model')}
                          onChange={(event) => {
                            resetPreview()
                            setModelOverrides((prev) => ({ ...prev, opusModel: event.target.value || undefined }))
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="provider-workspace__footer">
              <button
                type="button"
                className="nav-btn btn-secondary"
                disabled={loading}
                onClick={() => {
                  setViewMode('list')
                  clearFeedback()
                }}
              >
                <AppIcon name="x-mark" width={15} height={15} />
                {t(locale, '取消', 'Cancel')}
              </button>
              <div className="provider-workspace__footer-actions">
                <button
                  type="button"
                  className="nav-btn btn-primary"
                  disabled={!isFormValid || loading}
                  onClick={() => void handleApply()}
                >
                  <AppIcon name={loading ? 'activity' : 'check'} width={15} height={15} />
                  {loading
                    ? t(locale, '保存中...', 'Saving...')
                    : editorMode === 'edit'
                      ? t(locale, '保存更新', 'Save changes')
                      : t(locale, '保存配置', 'Save provider')}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
      {pendingDeleteSavedProvider && (
        <div
          className="provider-workspace__confirm-overlay"
          onClick={() => setPendingDeleteSavedProviderId(null)}
        >
          <div
            className="provider-workspace__confirm-dialog"
            onClick={(event) => event.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={t(locale, '删除模型供应商', 'Delete provider')}
          >
            <div className="provider-workspace__confirm-icon">
              <AppIcon name="trash" width={20} height={20} />
            </div>
            <h4>{t(locale, '删除模型供应商', 'Delete provider')}</h4>
            <p>
              {t(
                locale,
                '删除后不可恢复。确认删除当前配置？',
                'This action cannot be undone. Delete this saved provider?',
              )}
            </p>
            <strong>{localizeLabel(locale, pendingDeleteSavedProvider.providerName)}</strong>
            <div className="provider-workspace__confirm-actions">
              <button
                type="button"
                className="provider-workspace__confirm-btn is-cancel"
                onClick={() => setPendingDeleteSavedProviderId(null)}
              >
                {t(locale, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="provider-workspace__confirm-btn is-danger"
                onClick={() => void handleDeleteSavedProvider(pendingDeleteSavedProvider.savedProviderId)}
              >
                {t(locale, '确认删除', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AiConfigOverlay>
  )
}
