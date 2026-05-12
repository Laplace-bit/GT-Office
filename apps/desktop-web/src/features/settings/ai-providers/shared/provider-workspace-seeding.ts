import type {
  AiConfigDraftInput,
  AiConfigSnapshot,
  ClaudeConfigSnapshot,
  ClaudeDraftInput,
  ClaudeProviderPreset,
  ClaudeSavedProviderSnapshot,
  ClaudeSnapshot,
  CodexConfigSnapshot,
  CodexDraftInput,
  CodexProviderPreset,
  CodexSavedProviderSnapshot,
  CodexSnapshot,
  GeminiConfigSnapshot,
  GeminiDraftInput,
  GeminiProviderPreset,
  GeminiSavedProviderSnapshot,
  GeminiSnapshot,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { localizeLabel, type ProviderMode } from './provider-workspace-presenter.js'
import {
  CUSTOM_PROVIDER_ID,
  resolveSelectedType,
  type EditorMode,
  type ProviderWorkspaceAgentId,
  type ProviderWorkspaceGuide,
  type ProviderWorkspaceSeed,
} from './provider-workspace-shared'

interface BuildSeedArgs {
  agentId: ProviderWorkspaceAgentId
  locale: Locale
  guide: ProviderWorkspaceGuide
  presets: Array<ClaudeProviderPreset | CodexProviderPreset | GeminiProviderPreset>
  selectablePresets: Array<ClaudeProviderPreset | CodexProviderPreset | GeminiProviderPreset>
  defaultPreset: ClaudeProviderPreset | CodexProviderPreset | GeminiProviderPreset | null
  officialPreset: ClaudeProviderPreset | CodexProviderPreset | GeminiProviderPreset | null
  customPreset: ClaudeProviderPreset | CodexProviderPreset | GeminiProviderPreset | null
  officialProviderId: string
}

function createBaseSeed(): ProviderWorkspaceSeed {
  return {
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
    selectedType: resolveSelectedType('oauth'),
    apiFormat: 'anthropic',
    modelOverrides: {},
  }
}

export function selectGuideFromSnapshot(
  agentId: ProviderWorkspaceAgentId,
  guide: ProviderWorkspaceGuide,
  snapshot: AiConfigSnapshot,
): ProviderWorkspaceGuide {
  switch (agentId) {
    case 'claude':
      return snapshot.claude as typeof guide
    case 'codex':
      return snapshot.codex as typeof guide
    case 'gemini':
      return snapshot.gemini as typeof guide
  }
}

export function removeSavedProviderFromGuide(
  agentId: ProviderWorkspaceAgentId,
  guide: ProviderWorkspaceGuide,
  savedProviderId: string,
): ProviderWorkspaceGuide {
  switch (agentId) {
    case 'claude': {
      const typedGuide = guide as ClaudeSnapshot
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
                savedProviderId: remainingSavedProviders.find((item) => item.isActive)?.savedProviderId,
              }
            : typedGuide.config,
      }
    }
    case 'codex': {
      const typedGuide = guide as CodexSnapshot
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
                savedProviderId: remainingSavedProviders.find((item) => item.isActive)?.savedProviderId,
              }
            : typedGuide.config,
      }
    }
    case 'gemini': {
      const typedGuide = guide as GeminiSnapshot
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
                savedProviderId: remainingSavedProviders.find((item) => item.isActive)?.savedProviderId,
              }
            : typedGuide.config,
      }
    }
  }
}

export function buildCurrentSeed(args: BuildSeedArgs): ProviderWorkspaceSeed {
  const {
    agentId, locale, guide, presets, selectablePresets, defaultPreset, officialPreset, customPreset,
    officialProviderId,
  } = args
  const seed = createBaseSeed()

  if (agentId === 'claude') {
    const claudeGuide = guide as ClaudeSnapshot
    const nextMode = (claudeGuide.config.activeMode ?? 'preset') as ProviderMode
    const nextPresetId =
      claudeGuide.config.providerId
        && selectablePresets.some((item) => item.providerId === claudeGuide.config.providerId)
        ? claudeGuide.config.providerId
        : defaultPreset?.providerId ?? ''
    const nextPreset = presets.find((item) => item.providerId === nextPresetId) ?? defaultPreset
    seed.mode = nextMode
    seed.providerId =
      nextMode === 'official'
        ? officialPreset?.providerId ?? officialProviderId
        : nextMode === 'custom'
          ? customPreset?.providerId ?? CUSTOM_PROVIDER_ID
          : nextPresetId
    seed.providerName =
      nextMode === 'official'
        ? localizeLabel(locale, claudeGuide.config.providerName ?? officialPreset?.name)
        : nextMode === 'custom'
          ? localizeLabel(locale, claudeGuide.config.providerName) || localizeLabel(locale, customPreset?.name)
          : localizeLabel(locale, claudeGuide.config.providerName) || localizeLabel(locale, nextPreset?.name)
    seed.baseUrl =
      nextMode === 'official'
        ? claudeGuide.config.baseUrl ?? officialPreset?.endpoint ?? ''
        : nextMode === 'custom'
          ? claudeGuide.config.baseUrl ?? customPreset?.endpoint ?? ''
          : claudeGuide.config.baseUrl ?? nextPreset?.endpoint ?? ''
    seed.model =
      nextMode === 'official'
        ? claudeGuide.config.model ?? officialPreset?.recommendedModel ?? ''
        : nextMode === 'custom'
          ? claudeGuide.config.model ?? customPreset?.recommendedModel ?? ''
          : claudeGuide.config.model ?? nextPreset?.recommendedModel ?? ''
    seed.authScheme =
      nextMode === 'official'
        ? claudeGuide.config.authScheme ?? (officialPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_auth_token'
        : nextMode === 'custom'
          ? claudeGuide.config.authScheme ?? (customPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key'
          : claudeGuide.config.authScheme ?? (nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key'
    seed.apiFormat = claudeGuide.config.apiFormat ?? 'anthropic'
    seed.modelOverrides = claudeGuide.config.modelOverrides ?? {}
    return seed
  }

  if (agentId === 'codex') {
    const codexGuide = guide as CodexSnapshot
    const nextMode = (codexGuide.config.activeMode ?? (defaultPreset ? 'preset' : 'official')) as ProviderMode
    const nextPreset =
      nextMode === 'official'
        ? officialPreset
        : nextMode === 'custom'
          ? customPreset
          : presets.find((item) => item.providerId === codexGuide.config.providerId) ?? defaultPreset
    seed.mode = nextMode
    seed.providerId = nextPreset?.providerId ?? ''
    seed.providerName = nextMode === 'custom' ? codexGuide.config.providerName ?? '' : localizeLabel(locale, nextPreset?.name)
    seed.baseUrl = nextMode === 'official' ? codexGuide.config.baseUrl ?? '' : codexGuide.config.baseUrl ?? nextPreset?.endpoint ?? ''
    seed.model = codexGuide.config.model ?? nextPreset?.recommendedModel ?? ''
    seed.configToml = codexGuide.config.configToml ?? (nextPreset as CodexProviderPreset | undefined)?.configTemplate ?? ''
    return seed
  }

  const geminiGuide = guide as GeminiSnapshot
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
  seed.mode = nextMode
  seed.providerId = nextPreset?.providerId ?? ''
  seed.providerName = nextMode === 'custom' ? geminiGuide.config.providerName ?? '' : localizeLabel(locale, nextPreset?.name)
  seed.baseUrl = nextMode === 'official' ? geminiGuide.config.baseUrl ?? '' : geminiGuide.config.baseUrl ?? nextPreset?.endpoint ?? ''
  seed.model = geminiGuide.config.model ?? nextPreset?.recommendedModel ?? ''
  seed.authMode = nextAuthMode
  seed.selectedType =
    geminiGuide.config.selectedType
      ?? (nextPreset as GeminiProviderPreset | undefined)?.selectedType
      ?? resolveSelectedType(nextAuthMode)
  return seed
}

export function buildSavedProviderSeed(
  args: BuildSeedArgs & { savedProviderId: string; editorMode: EditorMode },
): ProviderWorkspaceSeed | null {
  const {
    agentId, locale, guide, presets, defaultPreset, officialPreset, customPreset, officialProviderId,
    savedProviderId, editorMode,
  } = args
  const savedProvider = guide.savedProviders.find((item) => item.savedProviderId === savedProviderId)
  if (!savedProvider) {
    return null
  }

  const seed = createBaseSeed()
  seed.editorMode = editorMode
  seed.editingSavedProviderId = editorMode === 'edit' ? savedProviderId : null

  if (agentId === 'claude') {
    const nextSavedProvider = savedProvider as ClaudeSavedProviderSnapshot
    seed.mode = nextSavedProvider.mode
    if (nextSavedProvider.mode === 'official') {
      seed.providerId = officialPreset?.providerId ?? officialProviderId
      seed.providerName = localizeLabel(locale, officialPreset?.name) || t(locale, 'Anthropic 官方', 'Anthropic Official')
      seed.baseUrl = officialPreset?.endpoint ?? ''
      seed.model = nextSavedProvider.model ?? officialPreset?.recommendedModel ?? ''
      seed.authScheme = 'anthropic_auth_token'
    } else if (nextSavedProvider.mode === 'custom') {
      seed.providerId = nextSavedProvider.providerId ?? customPreset?.providerId ?? CUSTOM_PROVIDER_ID
      seed.providerName = localizeLabel(locale, nextSavedProvider.providerName)
      seed.baseUrl = nextSavedProvider.baseUrl ?? customPreset?.endpoint ?? ''
      seed.model = nextSavedProvider.model ?? customPreset?.recommendedModel ?? ''
      seed.authScheme =
        nextSavedProvider.authScheme
          ?? (customPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme
          ?? 'anthropic_api_key'
    } else {
      const nextPreset = presets.find((item) => item.providerId === nextSavedProvider.providerId) ?? defaultPreset
      seed.providerId = nextSavedProvider.providerId ?? defaultPreset?.providerId ?? ''
      seed.providerName = localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, nextPreset?.name)
      seed.baseUrl = nextSavedProvider.baseUrl ?? nextPreset?.endpoint ?? ''
      seed.model = nextSavedProvider.model ?? nextPreset?.recommendedModel ?? ''
      seed.authScheme =
        nextSavedProvider.authScheme
          ?? (nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme
          ?? 'anthropic_api_key'
    }
    seed.apiFormat = nextSavedProvider.apiFormat ?? 'anthropic'
    seed.modelOverrides = nextSavedProvider.modelOverrides ?? {}
    return seed
  }

  if (agentId === 'codex') {
    const nextSavedProvider = savedProvider as CodexSavedProviderSnapshot
    seed.mode = nextSavedProvider.mode
    if (nextSavedProvider.mode === 'official') {
      seed.providerId = officialPreset?.providerId ?? officialProviderId
      seed.providerName = localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, officialPreset?.name)
      seed.model = nextSavedProvider.model ?? officialPreset?.recommendedModel ?? ''
    } else if (nextSavedProvider.mode === 'custom') {
      seed.providerId = nextSavedProvider.providerId ?? customPreset?.providerId ?? CUSTOM_PROVIDER_ID
      seed.providerName = localizeLabel(locale, nextSavedProvider.providerName)
      seed.baseUrl = nextSavedProvider.baseUrl ?? customPreset?.endpoint ?? ''
      seed.model = nextSavedProvider.model ?? customPreset?.recommendedModel ?? ''
      seed.configToml = nextSavedProvider.configToml ?? (customPreset as CodexProviderPreset | undefined)?.configTemplate ?? ''
    } else {
      const nextPreset = presets.find((item) => item.providerId === nextSavedProvider.providerId) ?? defaultPreset
      seed.providerId = nextSavedProvider.providerId ?? defaultPreset?.providerId ?? ''
      seed.providerName = localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, nextPreset?.name)
      seed.baseUrl = nextSavedProvider.baseUrl ?? nextPreset?.endpoint ?? ''
      seed.model = nextSavedProvider.model ?? nextPreset?.recommendedModel ?? ''
      seed.configToml = nextSavedProvider.configToml ?? (nextPreset as CodexProviderPreset | undefined)?.configTemplate ?? ''
    }
    return seed
  }

  const nextSavedProvider = savedProvider as GeminiSavedProviderSnapshot
  seed.mode = nextSavedProvider.mode
  seed.authMode = nextSavedProvider.authMode
  seed.selectedType = nextSavedProvider.selectedType
  if (nextSavedProvider.mode === 'official') {
    seed.providerId = officialPreset?.providerId ?? officialProviderId
    seed.providerName = localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, officialPreset?.name)
    seed.model = nextSavedProvider.model ?? officialPreset?.recommendedModel ?? ''
    return seed
  }
  if (nextSavedProvider.mode === 'custom') {
    seed.providerId = nextSavedProvider.providerId ?? customPreset?.providerId ?? CUSTOM_PROVIDER_ID
    seed.providerName = localizeLabel(locale, nextSavedProvider.providerName)
    seed.baseUrl = nextSavedProvider.baseUrl ?? customPreset?.endpoint ?? ''
    seed.model = nextSavedProvider.model ?? customPreset?.recommendedModel ?? ''
    return seed
  }

  const nextPreset = presets.find((item) => item.providerId === nextSavedProvider.providerId) ?? defaultPreset
  seed.providerId = nextSavedProvider.providerId ?? defaultPreset?.providerId ?? ''
  seed.providerName = localizeLabel(locale, nextSavedProvider.providerName) || localizeLabel(locale, nextPreset?.name)
  seed.baseUrl = nextSavedProvider.baseUrl ?? nextPreset?.endpoint ?? ''
  seed.model = nextSavedProvider.model ?? nextPreset?.recommendedModel ?? ''
  return seed
}

export function buildModeSeed(
  args: BuildSeedArgs & { nextMode: ProviderMode; authMode: GeminiSnapshot['config']['authMode'] },
): Partial<ProviderWorkspaceSeed> {
  const { agentId, locale, defaultPreset, officialPreset, customPreset, officialProviderId, nextMode, authMode } = args

  if (nextMode === 'official') {
    return {
      mode: nextMode,
      providerId: officialPreset?.providerId ?? officialProviderId,
      providerName: localizeLabel(locale, officialPreset?.name),
      baseUrl: '',
      model: officialPreset?.recommendedModel ?? '',
      authScheme: (officialPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_auth_token',
      configToml: '',
      authMode: 'oauth',
      selectedType: resolveSelectedType('oauth'),
    }
  }

  if (nextMode === 'custom') {
    const nextAuthMode = (customPreset as GeminiProviderPreset | undefined)?.authMode ?? authMode ?? 'api_key'
    return {
      mode: nextMode,
      providerId: customPreset?.providerId ?? CUSTOM_PROVIDER_ID,
      providerName: localizeLabel(locale, customPreset?.name),
      baseUrl: customPreset?.endpoint ?? '',
      model: customPreset?.recommendedModel ?? '',
      authScheme: (customPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key',
      configToml: (customPreset as CodexProviderPreset | undefined)?.configTemplate ?? '',
      authMode: nextAuthMode,
      selectedType: (customPreset as GeminiProviderPreset | undefined)?.selectedType ?? resolveSelectedType(nextAuthMode),
    }
  }

  const nextPreset = defaultPreset
  const nextAuthMode = (nextPreset as GeminiProviderPreset | undefined)?.authMode ?? authMode ?? 'api_key'
  return {
    mode: nextMode,
    providerId: nextPreset?.providerId ?? '',
    providerName: localizeLabel(locale, nextPreset?.name),
    baseUrl: nextPreset?.endpoint ?? '',
    model: nextPreset?.recommendedModel ?? '',
    authScheme: (nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key',
    configToml: (nextPreset as CodexProviderPreset | undefined)?.configTemplate ?? '',
    authMode: agentId === 'gemini' ? nextAuthMode : authMode ?? 'oauth',
    selectedType: (nextPreset as GeminiProviderPreset | undefined)?.selectedType ?? resolveSelectedType(nextAuthMode),
  }
}

export function buildPresetSeed(
  args: Pick<BuildSeedArgs, 'agentId' | 'locale' | 'presets' | 'defaultPreset'> & {
    nextProviderId: string
    authMode: GeminiSnapshot['config']['authMode']
  },
): Partial<ProviderWorkspaceSeed> {
  const { locale, presets, defaultPreset, nextProviderId, authMode } = args
  const nextPreset = presets.find((item) => item.providerId === nextProviderId) ?? defaultPreset
  const nextAuthMode = (nextPreset as GeminiProviderPreset | undefined)?.authMode ?? authMode ?? 'api_key'
  return {
    providerId: nextProviderId,
    providerName: localizeLabel(locale, nextPreset?.name),
    baseUrl: nextPreset?.endpoint ?? '',
    model: nextPreset?.recommendedModel ?? '',
    authScheme: (nextPreset as ClaudeSnapshot['presets'][number] | undefined)?.authScheme ?? 'anthropic_api_key',
    configToml: (nextPreset as CodexProviderPreset | undefined)?.configTemplate ?? '',
    authMode: nextAuthMode,
    selectedType: (nextPreset as GeminiProviderPreset | undefined)?.selectedType ?? resolveSelectedType(nextAuthMode),
  }
}

export function buildDraftInput(
  agentId: ProviderWorkspaceAgentId,
  seed: ProviderWorkspaceSeed,
  requiresApiKey: boolean,
): AiConfigDraftInput {
  if (agentId === 'claude') {
    return {
      mode: seed.mode,
      savedProviderId: seed.editorMode === 'edit' ? seed.editingSavedProviderId ?? undefined : undefined,
      providerId: seed.mode === 'preset' ? seed.providerId || undefined : undefined,
      providerName: seed.mode === 'official' ? undefined : seed.providerName.trim() || undefined,
      baseUrl: seed.mode === 'official' ? undefined : seed.baseUrl.trim() || undefined,
      model: seed.mode === 'official' ? undefined : seed.model.trim() || undefined,
      authScheme: seed.mode === 'official' ? undefined : seed.authScheme,
      apiKey: seed.apiKey.trim() || undefined,
      apiFormat: seed.mode === 'official' ? undefined : seed.apiFormat,
      modelOverrides:
        seed.mode === 'official'
          ? undefined
          : seed.modelOverrides.haikuModel || seed.modelOverrides.sonnetModel || seed.modelOverrides.opusModel
            ? seed.modelOverrides
            : undefined,
    } satisfies ClaudeDraftInput
  }

  if (agentId === 'codex') {
    return {
      mode: seed.mode,
      savedProviderId: seed.editorMode === 'edit' ? seed.editingSavedProviderId ?? undefined : undefined,
      providerId: seed.mode === 'preset' ? seed.providerId || undefined : undefined,
      providerName: seed.mode === 'custom' ? seed.providerName.trim() || undefined : undefined,
      baseUrl: seed.mode === 'official' ? undefined : seed.baseUrl.trim() || undefined,
      model: seed.mode === 'official' ? undefined : seed.model.trim() || undefined,
      apiKey: requiresApiKey ? seed.apiKey.trim() || undefined : undefined,
      configToml: seed.mode === 'official' ? undefined : seed.configToml.trim() || undefined,
    } satisfies CodexDraftInput
  }

  return {
    mode: seed.mode,
    savedProviderId: seed.editorMode === 'edit' ? seed.editingSavedProviderId ?? undefined : undefined,
    authMode: seed.mode === 'official' ? undefined : seed.authMode,
    providerId: seed.mode === 'preset' ? seed.providerId || undefined : undefined,
    providerName: seed.mode === 'custom' ? seed.providerName.trim() || undefined : undefined,
    baseUrl: seed.mode === 'official' ? undefined : seed.baseUrl.trim() || undefined,
    model: seed.mode === 'official' ? undefined : seed.model.trim() || undefined,
    apiKey: requiresApiKey ? seed.apiKey.trim() || undefined : undefined,
    selectedType: seed.mode === 'official' ? undefined : seed.selectedType,
  } satisfies GeminiDraftInput
}

export function computeCanReuseSecret(
  currentSavedProvider: ProviderWorkspaceGuide['savedProviders'][number] | null,
  currentConfig: ClaudeConfigSnapshot | CodexConfigSnapshot | GeminiConfigSnapshot,
  currentSelectionProviderId: string,
  seed: ProviderWorkspaceSeed,
): boolean {
  return Boolean(currentSavedProvider?.hasSecret && seed.editorMode === 'edit')
    || (
      currentConfig.providerId === currentSelectionProviderId
      && currentConfig.hasSecret
      && Boolean(currentConfig.secretRef)
    )
}
