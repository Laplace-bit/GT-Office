import { useEffect, useMemo, useState } from 'react'

import {
  desktopApi,
  type AiConfigApplyResponse,
  type AiConfigFetchedModel,
  type ClaudeSavedProviderSnapshot,
  type ClaudeSnapshot,
  type CodexConfigSnapshot,
  type GeminiConfigSnapshot,
  type GeminiProviderPreset,
} from '@shell/integration/desktop-api'
import { t } from '@shell/i18n/ui-locale'

import {
  filterSavedProviders,
  localizeLabel,
  type ProviderMode,
} from './provider-workspace-presenter.js'
import { describeUnknownError } from './provider-utils'
import {
  buildCurrentSeed,
  buildDraftInput,
  buildModeSeed,
  buildPresetSeed,
  buildSavedProviderSeed,
  computeCanReuseSecret,
  removeSavedProviderFromGuide,
  selectGuideFromSnapshot,
} from './provider-workspace-seeding'
import {
  CUSTOM_PROVIDER_ID,
  type ProviderWorkspaceGuide,
  type ProviderWorkspaceModalProps,
  type ProviderWorkspaceSeed,
} from './provider-workspace-shared'

export function useProviderWorkspaceController(props: ProviderWorkspaceModalProps) {
  const { agentId, locale, guide, onReload, onSnapshotUpdate } = props

  const [localGuide, setLocalGuide] = useState<ProviderWorkspaceGuide>(guide)
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list')
  const [seed, setSeed] = useState<ProviderWorkspaceSeed>({
    editorMode: 'create',
    editingSavedProviderId: null,
    mode: 'preset',
    providerId: '',
    providerName: '',
    baseUrl: '',
    model: '',
    apiKey: '',
    authScheme: 'anthropic_api_key',
    configToml: '',
    authMode: 'oauth',
    selectedType: 'oauth-personal',
    apiFormat: 'anthropic',
    modelOverrides: {},
  })
  const [loading, setLoading] = useState(false)
  const [importingCurrent, setImportingCurrent] = useState(false)
  const [switchingSavedProviderId, setSwitchingSavedProviderId] = useState<string | null>(null)
  const [deletingSavedProviderId, setDeletingSavedProviderId] = useState<string | null>(null)
  const [pendingDeleteSavedProviderId, setPendingDeleteSavedProviderId] = useState<string | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPresetPicker, setShowPresetPicker] = useState(true)
  const [showConfigTemplate, setShowConfigTemplate] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<AiConfigFetchedModel[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false)

  useEffect(() => {
    setLocalGuide(guide)
  }, [guide])

  const presets = localGuide.presets
  const officialProviderId =
    agentId === 'claude' ? 'anthropic-official' : agentId === 'codex' ? 'codex-official' : 'google-official'
  const officialPreset = presets.find((item) => item.providerId === officialProviderId) ?? presets[0] ?? null
  const customPreset = presets.find((item) => item.providerId === CUSTOM_PROVIDER_ID) ?? null
  const selectablePresets = presets.filter(
    (item) => item.providerId !== officialProviderId && item.providerId !== CUSTOM_PROVIDER_ID,
  )
  const defaultPreset = selectablePresets[0] ?? officialPreset ?? customPreset ?? presets[0] ?? null
  const savedProviders = localGuide.savedProviders
  const currentConfig = localGuide.config as ClaudeSnapshot['config'] | CodexConfigSnapshot | GeminiConfigSnapshot
  const currentSavedProvider =
    seed.editingSavedProviderId != null
      ? savedProviders.find((item) => item.savedProviderId === seed.editingSavedProviderId) ?? null
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
    seed.mode === 'official'
      ? officialPreset
      : seed.mode === 'custom'
        ? customPreset
        : presets.find((item) => item.providerId === seed.providerId) ?? defaultPreset
  const providerLabel =
    seed.mode === 'custom'
      ? seed.providerName.trim() || t(locale, '自定义供应商', 'Custom provider')
      : localizeLabel(locale, currentPreset?.name)
  const canApplyOfficialMode = agentId === 'claude' ? guide.canApplyOfficialMode : true
  const canImportCurrent = currentConfig.savedProviderId == null && currentConfig.activeMode != null

  const seedArgs = {
    agentId,
    locale,
    guide: localGuide,
    presets,
    selectablePresets,
    defaultPreset,
    officialPreset,
    customPreset,
    officialProviderId,
  } as const

  const applySeed = (nextSeed: ProviderWorkspaceSeed | Partial<ProviderWorkspaceSeed>) => {
    setSeed((current) => ({ ...current, ...nextSeed, apiKey: nextSeed.apiKey ?? '' }))
  }

  const resetPreview = () => {
    setError(null)
    setSuccess(null)
  }

  const resetDynamicState = () => {
    setFetchedModels([])
    setEndpointDialogOpen(false)
    setShowPresetPicker(true)
    setShowConfigTemplate(false)
  }

  const seedFromCurrent = () => {
    resetPreview()
    resetDynamicState()
    applySeed(buildCurrentSeed(seedArgs))
  }

  const seedFromSavedProvider = (savedProviderId: string, editorMode: 'edit' | 'duplicate') => {
    resetPreview()
    resetDynamicState()
    const nextSeed = buildSavedProviderSeed({ ...seedArgs, savedProviderId, editorMode })
    if (nextSeed) {
      applySeed(nextSeed)
    }
  }

  const openCreateEditor = () => {
    seedFromCurrent()
    setViewMode('editor')
  }

  const openEditEditor = (savedProviderId: string) => {
    seedFromSavedProvider(savedProviderId, 'edit')
    setViewMode('editor')
  }

  const openDuplicateEditor = (savedProviderId: string) => {
    seedFromSavedProvider(savedProviderId, 'duplicate')
    setViewMode('editor')
  }

  const handleModeSelect = (nextMode: ProviderMode) => {
    resetPreview()
    setFetchedModels([])
    setShowPresetPicker(nextMode === 'preset')
    setShowConfigTemplate(false)
    applySeed(buildModeSeed({ ...seedArgs, nextMode, authMode: seed.authMode }))
  }

  const handlePresetSelect = (nextProviderId: string) => {
    resetPreview()
    setFetchedModels([])
    setShowPresetPicker(false)
    setShowConfigTemplate(false)
    applySeed(buildPresetSeed({ agentId, locale, presets, defaultPreset, nextProviderId, authMode: seed.authMode }))
  }

  const currentSelectionProviderId =
    seed.mode === 'custom' ? CUSTOM_PROVIDER_ID : seed.mode === 'preset' ? seed.providerId : officialProviderId
  const canReuseSecret = computeCanReuseSecret(
    currentSavedProvider,
    currentConfig,
    currentSelectionProviderId,
    seed,
  )
  const requiresApiKey =
    agentId === 'claude'
      ? seed.mode !== 'official'
      : agentId === 'codex'
        ? seed.mode === 'custom'
          ? true
          : seed.mode === 'official'
            ? false
            : Boolean(currentPreset && 'requiresApiKey' in currentPreset && currentPreset.requiresApiKey)
        : seed.mode === 'official'
          ? false
          : seed.mode === 'custom'
            ? seed.authMode === 'api_key'
            : seed.authMode === 'api_key' || Boolean((currentPreset as GeminiProviderPreset | undefined)?.requiresApiKey)
  const isFormValid =
    seed.mode === 'official'
      ? canApplyOfficialMode
      : seed.mode === 'preset'
        ? Boolean(seed.providerId && seed.baseUrl.trim() && seed.model.trim() && (!requiresApiKey || seed.apiKey.trim() || canReuseSecret))
        : Boolean(seed.providerName.trim() && seed.baseUrl.trim() && seed.model.trim() && (!requiresApiKey || seed.apiKey.trim() || canReuseSecret))

  const syncAfterMutation = async (
    response: AiConfigApplyResponse,
    message: string,
    options?: { deletedSavedProviderId?: string },
  ) => {
    const nextGuide = selectGuideFromSnapshot(agentId, localGuide, response.effective)
    setLocalGuide(
      options?.deletedSavedProviderId
        ? removeSavedProviderFromGuide(agentId, nextGuide, options.deletedSavedProviderId)
        : nextGuide,
    )
    onSnapshotUpdate(response.effective)
    await onReload()
    setSuccess(message)
  }

  const handleApply = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const preview = await desktopApi.aiConfigPreviewPatch(null, agentId, 'global', buildDraftInput(agentId, seed, requiresApiKey))
      const response = await desktopApi.aiConfigApplyPatch(null, preview.previewId, 'System Admin')
      await syncAfterMutation(
        response,
        seed.editorMode === 'edit'
          ? t(locale, '模型供应商已更新', 'Provider updated')
          : t(locale, '模型供应商已保存', 'Provider saved'),
      )
      setViewMode('list')
      applySeed({ ...seed, editorMode: 'create', editingSavedProviderId: null, apiKey: '' })
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

  const handleSwitchSavedProvider = async (savedProviderId: string) => {
    if (agentId === 'claude') {
      const target = savedProviders.find(
        (p): p is ClaudeSavedProviderSnapshot => p.savedProviderId === savedProviderId,
      )
      const targetFormat = target?.apiFormat
      if (targetFormat === 'openai_chat' || targetFormat === 'openai_responses') {
        const confirmed = window.confirm(
          t(locale, `此供应商使用的 API 格式 (${targetFormat}) 需要代理中间件才能正常工作。\n直接切换可能导致 Claude Code 无法连接。\n确认继续？`, `This provider uses API format '${targetFormat}' which requires a proxy middleware.\nSwitching directly may cause Claude Code connection issues.\nContinue anyway?`),
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
      const response = await desktopApi.aiConfigSwitchSavedProvider(null, agentId, savedProviderId, 'System Admin')
      await syncAfterMutation(response, t(locale, '已切换当前模型供应商', 'Active provider switched'))
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setSwitchingSavedProviderId(null)
    }
  }

  const handleImportCurrent = async () => {
    setImportingCurrent(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await desktopApi.aiConfigImportCurrent(null, agentId, 'System Admin')
      await syncAfterMutation(response, t(locale, '当前配置已导入', 'Current configuration imported'))
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setImportingCurrent(false)
    }
  }

  const handleDeleteSavedProvider = async (savedProviderId: string) => {
    setDeletingSavedProviderId(savedProviderId)
    setPendingDeleteSavedProviderId(null)
    setError(null)
    setSuccess(null)
    try {
      const response = await desktopApi.aiConfigDeleteSavedProvider(null, agentId, savedProviderId, 'System Admin')
      await syncAfterMutation(response, t(locale, '模型供应商已删除', 'Provider deleted'), {
        deletedSavedProviderId: savedProviderId,
      })
      if (seed.editingSavedProviderId === savedProviderId) {
        setViewMode('list')
        applySeed({ editingSavedProviderId: null })
      }
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setDeletingSavedProviderId(null)
    }
  }

  const handleFetchModels = async () => {
    if (!seed.baseUrl.trim()) {
      setError(t(locale, '请先填写 Base URL', 'Enter a base URL first'))
      return
    }
    if (!seed.apiKey.trim()) {
      setError(t(locale, '请先输入 API Key，再拉取模型列表', 'Enter an API key before fetching models'))
      return
    }
    setFetchingModels(true)
    setError(null)
    setSuccess(null)
    try {
      const models = await desktopApi.aiConfigFetchModels(seed.baseUrl.trim(), seed.apiKey.trim())
      setFetchedModels(models)
      setSuccess(
        models.length > 0
          ? t(locale, `已拉取 ${models.length} 个模型`, `Fetched ${models.length} models`)
          : t(locale, '供应商返回了空模型列表', 'The provider returned an empty model list'),
      )
    } catch (err) {
      setError(describeUnknownError(err))
    } finally {
      setFetchingModels(false)
    }
  }

  const openUrl = async (url: string | null | undefined) => {
    const trimmed = url?.trim()
    if (!trimmed) {
      return
    }
    try {
      await desktopApi.systemOpenUrl(trimmed)
    } catch (err) {
      setError(describeUnknownError(err))
    }
  }

  return {
    localGuide,
    viewMode,
    setViewMode,
    seed,
    applySeed,
    loading,
    importingCurrent,
    switchingSavedProviderId,
    deletingSavedProviderId,
    pendingDeleteSavedProviderId,
    setPendingDeleteSavedProviderId,
    searchValue,
    setSearchValue,
    error,
    success,
    showAdvanced,
    setShowAdvanced,
    showPresetPicker,
    setShowPresetPicker,
    showConfigTemplate,
    setShowConfigTemplate,
    fetchedModels,
    fetchingModels,
    endpointDialogOpen,
    setEndpointDialogOpen,
    presets,
    selectablePresets,
    defaultPreset,
    savedProviders,
    filteredSavedProviders,
    pendingDeleteSavedProvider,
    currentPreset,
    providerLabel,
    canApplyOfficialMode,
    canImportCurrent,
    canReuseSecret,
    requiresApiKey,
    isFormValid,
    currentConfig,
    openCreateEditor,
    openEditEditor,
    openDuplicateEditor,
    handleModeSelect,
    handlePresetSelect,
    handleApply,
    handleSwitchSavedProvider,
    handleImportCurrent,
    handleDeleteSavedProvider,
    handleFetchModels,
    openUrl,
    requestDeleteSavedProvider: (savedProviderId: string) => {
      setPendingDeleteSavedProviderId(savedProviderId)
      setError(null)
      setSuccess(null)
    },
    resetToCurrent: seedFromCurrent,
    clearFeedback: () => {
      setError(null)
      setSuccess(null)
    },
  }
}
