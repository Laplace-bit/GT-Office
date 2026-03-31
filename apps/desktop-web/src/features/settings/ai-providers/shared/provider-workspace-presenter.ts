import type {
  ClaudeSavedProviderSnapshot,
  CodexSavedProviderSnapshot,
  GeminiSavedProviderSnapshot,
} from '../../../../shell/integration/desktop-api.js'
import { t, translateMaybeKey, type Locale } from '../../../../shell/i18n/ui-locale.js'

export type ProviderAgentId = 'claude' | 'codex' | 'gemini'
export type ProviderMode = 'official' | 'preset' | 'custom'
export type SavedProvider =
  | ClaudeSavedProviderSnapshot
  | CodexSavedProviderSnapshot
  | GeminiSavedProviderSnapshot

export interface SavedProviderFact {
  label: string
  value: string
}

export function formatSavedProviderTimestamp(locale: Locale, value: number | null | undefined): string {
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

export function resolveModeLabel(locale: Locale, mode: ProviderMode): string {
  if (mode === 'official') {
    return t(locale, '官方', 'Official')
  }
  if (mode === 'preset') {
    return t(locale, '预设', 'Preset')
  }
  return t(locale, '自定义', 'Custom')
}

export function localizeLabel(locale: Locale, value?: string | null): string {
  if (!value) {
    return ''
  }
  return translateMaybeKey(locale, value) || value
}

export function filterSavedProviders(locale: Locale, providers: SavedProvider[], keyword: string): SavedProvider[] {
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

export function resolveSavedProviderMeta(
  locale: Locale,
  agentId: ProviderAgentId,
  savedProvider: SavedProvider,
): string[] {
  const meta = [resolveModeLabel(locale, savedProvider.mode)]

  if (savedProvider.model) {
    meta.push(savedProvider.model)
  }

  if (savedProvider.hasSecret) {
    meta.push(t(locale, '密钥已托管', 'Secret vaulted'))
  }

  if (agentId === 'gemini') {
    meta.push((savedProvider as GeminiSavedProviderSnapshot).authMode === 'oauth' ? 'OAuth' : 'API Key')
  }

  return meta
}

export function resolveSavedProviderFacts(locale: Locale, savedProvider: SavedProvider): SavedProviderFact[] {
  return [
    {
      label: t(locale, 'Endpoint', 'Endpoint'),
      value: savedProvider.baseUrl || t(locale, '官方模式由 CLI 原生托管', 'Managed natively by the CLI'),
    },
    {
      label: t(locale, '最近应用', 'Last applied'),
      value: formatSavedProviderTimestamp(locale, savedProvider.lastAppliedAtMs),
    },
  ]
}
