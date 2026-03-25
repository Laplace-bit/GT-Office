import { useMemo, useState } from 'react'

import {
  desktopApi,
  type AiAgentSnapshotCard,
  type AiConfigApplyResponse,
  type AiConfigDraftInput,
  type AiConfigPreviewResponse,
  type AiConfigSnapshot,
  type ClaudeAuthScheme,
  type ClaudeConfigSnapshot,
  type ClaudeDraftInput,
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
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from './AiConfigOverlay'
import { describeUnknownError } from './provider-utils'

import './ProviderWorkspaceModal.scss'

type ProviderWorkspaceModalProps =
  | {
      agentId: 'claude'
      workspaceId?: string | null
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: ClaudeSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }
  | {
      agentId: 'codex'
      workspaceId?: string | null
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: CodexSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }
  | {
      agentId: 'gemini'
      workspaceId?: string | null
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: GeminiSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }

type ProviderMode = 'official' | 'preset' | 'custom'
type EditorMode = 'create' | 'edit' | 'duplicate'
type ViewMode = 'list' | 'editor'
type SavedProvider =
  | ClaudeSavedProviderSnapshot
  | CodexSavedProviderSnapshot
  | GeminiSavedProviderSnapshot

const CUSTOM_PROVIDER_ID = 'custom-gateway'

function formatSavedProviderTimestamp(locale: Locale, value: number | null | undefined): string {
  if (!value || value <= 0) {
    return t(locale, '未更新', 'Never updated')
  }

  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function resolveModeLabel(locale: Locale, mode: ProviderMode): string {
  if (mode === 'official') {
    return t(locale, '官方', 'Official')
  }
  if (mode === 'preset') {
    return t(locale, '预设', 'Preset')
  }
  return t(locale, '自定义', 'Custom')
}

function localizeLabel(locale: Locale, value?: string | null): string {
  if (!value) {
    return ''
  }
  return translateMaybeKey(locale, value) || value
}

function resolveSelectedType(authMode: GeminiAuthMode): string {
  return authMode === 'oauth' ? 'oauth-personal' : 'gemini-api-key'
}

function resolveAgentDisplayName(locale: Locale, agent: AiAgentSnapshotCard): string {
  return translateMaybeKey(locale, agent.title)
}

function resolveActiveSummary(
  locale: Locale,
  config: ClaudeConfigSnapshot | CodexConfigSnapshot | GeminiConfigSnapshot,
): string {
  if (!config.activeMode) {
    return t(locale, '尚未配置模型供应商', 'No provider configured yet')
  }

  const provider = localizeLabel(locale, config.providerName) || t(locale, '未命名供应商', 'Unnamed provider')
  const model = config.model?.trim() || t(locale, '默认模型', 'Default model')
  return `${resolveModeLabel(locale, config.activeMode)} · ${provider} · ${model}`
}

function filterSavedProviders(locale: Locale, providers: SavedProvider[], keyword: string): SavedProvider[] {
  const query = keyword.trim().toLowerCase()
  if (!query) {
    return providers
  }

  return providers.filter((provider) => {
    const haystack = [
      localizeLabel(locale, provider.providerName),
      provider.model ?? '',
      provider.baseUrl ?? '',
      provider.providerId ?? '',
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(query)
  })
}

export function ProviderWorkspaceModal(props: ProviderWorkspaceModalProps) {
  const { agentId, workspaceId, locale, agent, guide, onReload, onSnapshotUpdate, onClose } = props
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
  const [preview, setPreview] = useState<AiConfigPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [switchingSavedProviderId, setSwitchingSavedProviderId] = useState<string | null>(null)
  const [deletingSavedProviderId, setDeletingSavedProviderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const presets = guide.presets
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
  const savedProviders = guide.savedProviders
  const currentConfig = guide.config
  const claudeGuide = agentId === 'claude' ? guide : null
  const codexGuide = agentId === 'codex' ? guide : null
  const geminiGuide = agentId === 'gemini' ? guide : null
  const currentSavedProvider =
    editingSavedProviderId != null
      ? savedProviders.find((item) => item.savedProviderId === editingSavedProviderId) ?? null
      : null
  const filteredSavedProviders = useMemo(
    () => filterSavedProviders(locale, savedProviders, searchValue),
    [locale, savedProviders, searchValue],
  )
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
    setPreview(null)
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

  async function handlePreview() {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      let draft: AiConfigDraftInput

      if (agentId === 'claude') {
        draft = {
          mode,
          savedProviderId: editorMode === 'edit' ? editingSavedProviderId : undefined,
          providerId: mode === 'preset' ? providerId || undefined : undefined,
          providerName: mode === 'official' ? undefined : providerName.trim() || undefined,
          baseUrl: mode === 'official' ? undefined : baseUrl.trim() || undefined,
          model: mode === 'official' ? undefined : model.trim() || undefined,
          authScheme: mode === 'official' ? undefined : authScheme,
          apiKey: apiKey.trim() || undefined,
        } satisfies ClaudeDraftInput
      } else if (agentId === 'codex') {
        draft = {
          mode,
          savedProviderId: editorMode === 'edit' ? editingSavedProviderId : undefined,
          providerId: mode === 'preset' ? providerId || undefined : undefined,
          providerName: mode === 'custom' ? providerName.trim() || undefined : undefined,
          baseUrl: mode === 'official' ? undefined : baseUrl.trim() || undefined,
          model: mode === 'official' ? undefined : model.trim() || undefined,
          apiKey: requiresApiKey ? apiKey.trim() || undefined : undefined,
          configToml: mode === 'official' ? undefined : configToml.trim() || undefined,
        } satisfies CodexDraftInput
      } else {
        draft = {
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

      const response = await desktopApi.aiConfigPreviewPatch(workspaceId, agentId, 'global', draft)
      setPreview(response)
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setLoading(false)
    }
  }

  async function syncAfterMutation(response: AiConfigApplyResponse, message: string) {
    onSnapshotUpdate(response.effective)
    await onReload()
    setSuccess(message)
  }

  async function handleApply() {
    if (!preview) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await desktopApi.aiConfigApplyPatch(workspaceId, preview.previewId, 'System Admin')
      await syncAfterMutation(
        response,
        editorMode === 'edit'
          ? t(locale, '模型供应商已更新', 'Provider updated')
          : t(locale, '模型供应商已保存', 'Provider saved'),
      )
      setViewMode('list')
      setPreview(null)
      setEditingSavedProviderId(null)
      setEditorMode('create')
      setApiKey('')
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleSwitchSavedProvider(savedProviderId: string) {
    setSwitchingSavedProviderId(savedProviderId)
    setError(null)
    setSuccess(null)

    try {
      const response = await desktopApi.aiConfigSwitchSavedProvider(
        workspaceId,
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

  async function handleDeleteSavedProvider(savedProviderId: string) {
    const confirmed = window.confirm(
      t(locale, '删除后不可恢复，确认继续？', 'This deletion cannot be undone. Continue?'),
    )
    if (!confirmed) {
      return
    }

    setDeletingSavedProviderId(savedProviderId)
    setError(null)
    setSuccess(null)

    try {
      const response = await desktopApi.aiConfigDeleteSavedProvider(
        workspaceId,
        agentId,
        savedProviderId,
        'System Admin',
      )
      await syncAfterMutation(response, t(locale, '模型供应商已删除', 'Provider deleted'))
      if (editingSavedProviderId === savedProviderId) {
        setViewMode('list')
        setEditingSavedProviderId(null)
        setPreview(null)
      }
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setDeletingSavedProviderId(null)
    }
  }

  const latestUpdatedAtMs = savedProviders.reduce((latest, item) => Math.max(latest, item.updatedAtMs), currentConfig.updatedAtMs ?? 0)
  const toolbarSummary = resolveActiveSummary(locale, currentConfig)
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
        <header className="provider-workspace__header">
          <div className="provider-workspace__summary-card">
            <div className="provider-workspace__summary-top">
              <strong>{t(locale, '当前生效', 'Active')}</strong>
              <span>{savedProviders.length} {t(locale, '份配置', 'configs')}</span>
            </div>
            <h4>{toolbarSummary}</h4>
            <p>
              {t(locale, '最近更新', 'Last updated')}: {formatSavedProviderTimestamp(locale, latestUpdatedAtMs)}
            </p>
          </div>

          <div className="provider-workspace__summary-card is-secondary">
            <div className="provider-workspace__summary-top">
              <strong>{t(locale, 'CLI 状态', 'CLI status')}</strong>
              <span>{agent.installStatus.installed ? t(locale, '已安装', 'Installed') : t(locale, '未安装', 'Not installed')}</span>
            </div>
            <h4>{agent.installStatus.executable || t(locale, '等待安装 CLI', 'CLI not installed yet')}</h4>
            <p>{translateMaybeKey(locale, agent.subtitle)}</p>
          </div>
        </header>

        {error && <div className="provider-workspace__feedback is-error">{error}</div>}
        {success && <div className="provider-workspace__feedback is-success">{success}</div>}

        {viewMode === 'list' ? (
          <section className="provider-workspace__panel">
            <div className="provider-workspace__toolbar">
              <div>
                <h4>{t(locale, '模型供应商', 'Model Providers')}</h4>
                <p>{t(locale, '打开后直接管理已配置列表，新增、切换、复制和删除都在这里完成。', 'Manage your configured providers here. Add, switch, duplicate, or delete without leaving this view.')}</p>
              </div>
              <div className="provider-workspace__toolbar-actions">
                <input
                  className="provider-workspace__search"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder={t(locale, '搜索名称、模型或地址', 'Search name, model, or endpoint')}
                />
                <button type="button" className="nav-btn btn-primary" onClick={openCreateEditor}>
                  {t(locale, '新增模型供应商', 'Add provider')}
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

                  return (
                    <article
                      key={savedProvider.savedProviderId}
                      className={`provider-workspace__item ${savedProvider.isActive ? 'is-active' : ''}`}
                    >
                      <div className="provider-workspace__item-top">
                        <div>
                          <div className="provider-workspace__item-title">
                            <strong>{localizeLabel(locale, savedProvider.providerName)}</strong>
                            {savedProvider.isActive && (
                              <span className="provider-workspace__badge">
                                {t(locale, '当前生效', 'Active')}
                              </span>
                            )}
                          </div>
                          <div className="provider-workspace__item-meta">
                            <span>{resolveModeLabel(locale, savedProvider.mode)}</span>
                            {savedProvider.model && <span>{savedProvider.model}</span>}
                            {savedProvider.hasSecret && <span>{t(locale, '密钥已托管', 'Secret vaulted')}</span>}
                            {agentId === 'gemini' && (
                              <span>{(savedProvider as GeminiSavedProviderSnapshot).authMode === 'oauth' ? 'OAuth' : 'API Key'}</span>
                            )}
                          </div>
                        </div>

                        <div className="provider-workspace__item-actions">
                          {!savedProvider.isActive && (
                            <button
                              type="button"
                              className="nav-btn btn-secondary"
                              disabled={isBusy}
                              onClick={() => void handleSwitchSavedProvider(savedProvider.savedProviderId)}
                            >
                              {switchingSavedProviderId === savedProvider.savedProviderId
                                ? t(locale, '切换中...', 'Switching...')
                                : t(locale, '设为当前', 'Set active')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="nav-btn btn-secondary"
                            disabled={isBusy}
                            onClick={() => openEditEditor(savedProvider.savedProviderId)}
                          >
                            {t(locale, '编辑', 'Edit')}
                          </button>
                          <button
                            type="button"
                            className="nav-btn btn-secondary"
                            disabled={isBusy}
                            onClick={() => openDuplicateEditor(savedProvider.savedProviderId)}
                          >
                            {t(locale, '复制', 'Duplicate')}
                          </button>
                          <button
                            type="button"
                            className="nav-btn btn-secondary is-danger"
                            disabled={isBusy}
                            onClick={() => void handleDeleteSavedProvider(savedProvider.savedProviderId)}
                          >
                            {deletingSavedProviderId === savedProvider.savedProviderId
                              ? t(locale, '删除中...', 'Deleting...')
                              : t(locale, '删除', 'Delete')}
                          </button>
                        </div>
                      </div>

                      <div className="provider-workspace__item-grid">
                        <div>
                          <span>{t(locale, 'Endpoint', 'Endpoint')}</span>
                          <strong>{savedProvider.baseUrl || t(locale, '官方模式由 CLI 原生托管', 'Managed natively by the CLI')}</strong>
                        </div>
                        <div>
                          <span>{t(locale, '最近应用', 'Last applied')}</span>
                          <strong>{formatSavedProviderTimestamp(locale, savedProvider.lastAppliedAtMs)}</strong>
                        </div>
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
                    setPreview(null)
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
                <button
                  type="button"
                  className="nav-btn btn-secondary"
                  disabled={loading}
                  onClick={seedFromCurrent}
                >
                  {t(locale, '恢复当前配置', 'Reset to current')}
                </button>
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
            </div>

            {preview && (
              <div className="provider-workspace__preview">
                <div className="provider-workspace__preview-header">
                  <strong>{t(locale, '预览变更', 'Preview changes')}</strong>
                  <button
                    type="button"
                    className="nav-btn btn-secondary"
                    disabled={loading}
                    onClick={() => setPreview(null)}
                  >
                    {t(locale, '继续编辑', 'Keep editing')}
                  </button>
                </div>
                <div className="provider-workspace__preview-list">
                  {preview.maskedDiff.map((change) => (
                    <div key={change.key} className="provider-workspace__preview-item">
                      <span>{change.label}</span>
                      <div>
                        <small>{localizeLabel(locale, change.before) || t(locale, '空', 'Empty')}</small>
                        <strong>{change.secret ? '********' : localizeLabel(locale, change.after) || t(locale, '空', 'Empty')}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                {preview.warnings.length > 0 && (
                  <div className="provider-workspace__warnings">
                    {preview.warnings.map((warning, index) => (
                      <div key={`${warning}-${index}`} className="provider-workspace__warning">
                        {localizeLabel(locale, warning)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="provider-workspace__footer">
              <button
                type="button"
                className="nav-btn btn-secondary"
                disabled={loading}
                onClick={() => {
                  setViewMode('list')
                  setPreview(null)
                  clearFeedback()
                }}
              >
                {t(locale, '取消', 'Cancel')}
              </button>
              <div className="provider-workspace__footer-actions">
                <button
                  type="button"
                  className="nav-btn btn-secondary"
                  disabled={!isFormValid || loading}
                  onClick={() => void handlePreview()}
                >
                  {loading && !preview ? t(locale, '预览中...', 'Previewing...') : t(locale, '预览变更', 'Preview changes')}
                </button>
                <button
                  type="button"
                  className="nav-btn btn-primary"
                  disabled={!preview || loading}
                  onClick={() => void handleApply()}
                >
                  {loading && preview
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
    </AiConfigOverlay>
  )
}
