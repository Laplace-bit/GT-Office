import type { Locale, TranslationKey } from '../i18n/ui-locale.js'
import {
  getQuickCommandVisibility,
  isQuickCommandProviderId,
  normalizeQuickCommandVisibilityByProvider,
  quickCommandDefaultVisibilityByProvider,
  quickCommandProviderCopyByProvider,
  resolveQuickCommandDescriptionKey,
  resolveQuickCommandDisabledReasonKey,
  resolveQuickCommandPreferenceId,
  type QuickCommandProviderId,
} from './quick-command-metadata.js'

export type ThemeMode = 'graphite-light' | 'graphite-dark'
export type UiFont = 'sf-pro' | 'ibm-plex' | 'system-ui'
export type MonoFont = 'jetbrains-mono' | 'cascadia-code' | 'fira-code'
export type UiFontSize = 'small' | 'medium' | 'large' | 'xlarge'
export type CommandRailProviderId = QuickCommandProviderId
export {
  isQuickCommandProviderId,
  quickCommandDefaultVisibilityByProvider,
  quickCommandProviderCopyByProvider,
  resolveQuickCommandDescriptionKey,
  resolveQuickCommandDisabledReasonKey,
  resolveQuickCommandPreferenceId,
}

export interface CommandRailCommandOption {
  id: string
  label: string
}

export interface UiPreferences {
  locale: Locale
  themeMode: ThemeMode
  uiFont: UiFont
  monoFont: MonoFont
  uiFontSize: UiFontSize
  /** @deprecated Prefer `quickCommandVisibilityByProvider`. */
  showCommandRail: boolean
  showWorkspaceActionsInRail: boolean
  quickCommandVisibilityByProvider: Record<CommandRailProviderId, boolean>
  pinnedCommandIdsByProvider: Record<string, string[]>
}

const STORAGE_KEY = 'gtoffice.ui.preferences.v1'
export const UI_PREFERENCES_UPDATED_EVENT = 'gtoffice:ui-preferences-updated'

export const commandRailClaudeCommandOptions: ReadonlyArray<CommandRailCommandOption> = [
  { id: 'add-dir', label: '/add-dir' },
  { id: 'agents', label: '/agents' },
  { id: 'batch', label: '/batch' },
  { id: 'branch', label: '/branch' },
  { id: 'btw', label: '/btw' },
  { id: 'chrome', label: '/chrome' },
  { id: 'clear', label: '/clear' },
  { id: 'color', label: '/color' },
  { id: 'compact', label: '/compact' },
  { id: 'config', label: '/config' },
  { id: 'context', label: '/context' },
  { id: 'copy', label: '/copy' },
  { id: 'cost', label: '/cost' },
  { id: 'desktop', label: '/desktop' },
  { id: 'diff', label: '/diff' },
  { id: 'doctor', label: '/doctor' },
  { id: 'effort', label: '/effort' },
  { id: 'effort-max', label: '/effort max' },
  { id: 'exit', label: '/exit' },
  { id: 'export', label: '/export' },
  { id: 'fast', label: '/fast' },
  { id: 'feedback', label: '/feedback' },
  { id: 'help', label: '/help' },
  { id: 'hooks', label: '/hooks' },
  { id: 'ide', label: '/ide' },
  { id: 'init', label: '/init' },
  { id: 'install-github-app', label: '/install-github-app' },
  { id: 'install-slack-app', label: '/install-slack-app' },
  { id: 'login', label: '/login' },
  { id: 'logout', label: '/logout' },
  { id: 'loop', label: '/loop' },
  { id: 'mcp', label: '/mcp' },
  { id: 'memory', label: '/memory' },
  { id: 'mobile', label: '/mobile' },
  { id: 'model', label: '/model' },
  { id: 'new', label: '/new' },
  { id: 'plan', label: '/plan' },
  { id: 'permissions', label: '/permissions' },
  { id: 'plugin', label: '/plugin' },
  { id: 'release-notes', label: '/release-notes' },
  { id: 'rename', label: '/rename' },
  { id: 'review', label: '/review' },
  { id: 'resume', label: '/resume' },
  { id: 'rewind', label: '/rewind' },
  { id: 'sandbox', label: '/sandbox' },
  { id: 'schedule', label: '/schedule' },
  { id: 'skills', label: '/skills' },
  { id: 'status', label: '/status' },
  { id: 'simplify', label: '/simplify' },
  { id: 'stats', label: '/stats' },
  { id: 'terminal-setup', label: '/terminal-setup' },
  { id: 'vim', label: '/vim' },
]

export const commandRailCodexCommandOptions: ReadonlyArray<CommandRailCommandOption> = [
  { id: 'agent', label: '/agent' },
  { id: 'apps', label: '/apps' },
  { id: 'clear', label: '/clear' },
  { id: 'compact', label: '/compact' },
  { id: 'copy', label: '/copy' },
  { id: 'debug-config', label: '/debug-config' },
  { id: 'diff', label: '/diff' },
  { id: 'exit', label: '/exit' },
  { id: 'experimental', label: '/experimental' },
  { id: 'fast', label: '/fast' },
  { id: 'fast-off', label: '/fast off' },
  { id: 'fast-on', label: '/fast on' },
  { id: 'fast-status', label: '/fast status' },
  { id: 'feedback', label: '/feedback' },
  { id: 'fork', label: '/fork' },
  { id: 'init', label: '/init' },
  { id: 'logout', label: '/logout' },
  { id: 'mcp', label: '/mcp' },
  { id: 'mention', label: '/mention' },
  { id: 'model', label: '/model' },
  { id: 'new', label: '/new' },
  { id: 'permissions', label: '/permissions' },
  { id: 'personality', label: '/personality' },
  { id: 'plan', label: '/plan' },
  { id: 'ps', label: '/ps' },
  { id: 'resume', label: '/resume' },
  { id: 'review', label: '/review' },
  { id: 'status', label: '/status' },
  { id: 'statusline', label: '/statusline' },
]

export const commandRailGeminiCommandOptions: ReadonlyArray<CommandRailCommandOption> = [
  { id: 'about', label: '/about' },
  { id: 'auth', label: '/auth' },
  { id: 'bug', label: '/bug' },
  { id: 'chat', label: '/chat' },
  { id: 'chat-delete', label: '/chat delete' },
  { id: 'chat-list', label: '/chat list' },
  { id: 'chat-resume', label: '/chat resume' },
  { id: 'chat-save', label: '/chat save' },
  { id: 'chat-share', label: '/chat share' },
  { id: 'clear', label: '/clear' },
  { id: 'commands', label: '/commands' },
  { id: 'commands-reload', label: '/commands reload' },
  { id: 'compress', label: '/compress' },
  { id: 'copy', label: '/copy' },
  { id: 'directory', label: '/directory' },
  { id: 'dir', label: '/dir' },
  { id: 'directory-add', label: '/directory add' },
  { id: 'directory-show', label: '/directory show' },
  { id: 'docs', label: '/docs' },
  { id: 'editor', label: '/editor' },
  { id: 'extensions', label: '/extensions' },
  { id: 'exit', label: '/exit' },
  { id: 'help', label: '/help' },
  { id: 'hooks', label: '/hooks' },
  { id: 'hooks-list', label: '/hooks list' },
  { id: 'ide', label: '/ide' },
  { id: 'ide-status', label: '/ide status' },
  { id: 'init', label: '/init' },
  { id: 'mcp', label: '/mcp' },
  { id: 'mcp-auth', label: '/mcp auth' },
  { id: 'mcp-desc', label: '/mcp desc' },
  { id: 'mcp-list', label: '/mcp list' },
  { id: 'mcp-refresh', label: '/mcp refresh' },
  { id: 'mcp-schema', label: '/mcp schema' },
  { id: 'memory', label: '/memory' },
  { id: 'memory-add', label: '/memory add' },
  { id: 'memory-list', label: '/memory list' },
  { id: 'memory-refresh', label: '/memory refresh' },
  { id: 'memory-show', label: '/memory show' },
  { id: 'model', label: '/model' },
  { id: 'plan', label: '/plan' },
  { id: 'policies', label: '/policies' },
  { id: 'policies-list', label: '/policies list' },
  { id: 'privacy', label: '/privacy' },
  { id: 'quit', label: '/quit' },
  { id: 'restore', label: '/restore' },
  { id: 'rewind', label: '/rewind' },
  { id: 'resume', label: '/resume' },
  { id: 'settings', label: '/settings' },
  { id: 'shells', label: '/shells' },
  { id: 'setup-github', label: '/setup-github' },
  { id: 'skills', label: '/skills' },
  { id: 'skills-list', label: '/skills list' },
  { id: 'skills-reload', label: '/skills reload' },
  { id: 'stats', label: '/stats' },
  { id: 'terminal-setup', label: '/terminal-setup' },
  { id: 'theme', label: '/theme' },
  { id: 'tools', label: '/tools' },
  { id: 'tools-desc', label: '/tools desc' },
  { id: 'vim', label: '/vim' },
]

export const commandRailProviderCommandOptionsByProvider: Record<
  CommandRailProviderId,
  ReadonlyArray<CommandRailCommandOption>
> = {
  claude: commandRailClaudeCommandOptions,
  codex: commandRailCodexCommandOptions,
  gemini: commandRailGeminiCommandOptions,
}

export const commandRailDefaultPinnedCommandIdsByProvider: Record<CommandRailProviderId, string[]> = {
  claude: ['new', 'diff', 'context', 'plan', 'status', 'agents', 'mcp', 'simplify', 'effort-max'],
  codex: ['new', 'review', 'diff', 'status', 'model', 'mcp', 'plan', 'fast-on'],
  gemini: ['resume', 'clear', 'help', 'model', 'mcp-list', 'memory-show', 'stats', 'tools-desc'],
}

export const defaultUiPreferences: UiPreferences = {
  locale: 'zh-CN',
  themeMode: 'graphite-dark',
  uiFont: 'sf-pro',
  monoFont: 'jetbrains-mono',
  uiFontSize: 'medium',
  showCommandRail: true,
  showWorkspaceActionsInRail: true,
  quickCommandVisibilityByProvider: quickCommandDefaultVisibilityByProvider,
  pinnedCommandIdsByProvider: commandRailDefaultPinnedCommandIdsByProvider,
}

export const themeOptions: Array<{ value: ThemeMode; labelKey: TranslationKey }> = [
  { value: 'graphite-light', labelKey: 'themeOption.graphiteLight' },
  { value: 'graphite-dark', labelKey: 'themeOption.graphiteDark' },
]

export const uiFontOptions: Array<{ value: UiFont; label: string }> = [
  { value: 'sf-pro', label: 'SF Pro' },
  { value: 'ibm-plex', label: 'IBM Plex Sans' },
  { value: 'system-ui', label: 'System UI' },
]

export const monoFontOptions: Array<{ value: MonoFont; label: string }> = [
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  { value: 'cascadia-code', label: 'Cascadia Code' },
  { value: 'fira-code', label: 'Fira Code' },
]

export const uiFontSizeOptions: Array<{ value: UiFontSize; labelKey: TranslationKey }> = [
  { value: 'small', labelKey: 'displayPreferences.fontSizeSmall' },
  { value: 'medium', labelKey: 'displayPreferences.fontSizeMedium' },
  { value: 'large', labelKey: 'displayPreferences.fontSizeLarge' },
  { value: 'xlarge', labelKey: 'displayPreferences.fontSizeXLarge' },
]

const uiFontSizeCssMap: Record<UiFontSize, string> = {
  small: '0.9286rem',
  medium: '1rem',
  large: '1.0714rem',
  xlarge: '1.1429rem',
}

const uiFontCssMap: Record<UiFont, string> = {
  'sf-pro': "'SF Pro Text', 'Segoe UI Variable', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
  'ibm-plex': "'IBM Plex Sans', 'Segoe UI Variable', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
  'system-ui': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

const monoFontCssMap: Record<MonoFont, string> = {
  'jetbrains-mono': "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
  'cascadia-code': "'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
  'fira-code': "'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
}

function normalizeCommandPreferenceValue(
  providerId: string,
  value: string,
): string {
  let normalized = value.trim().toLowerCase()

  if (normalized.startsWith(`${providerId}-`)) {
    normalized = normalized.slice(providerId.length + 1)
  }

  return normalized.replace(/\s+/g, '-')
}

function dedupeStrings(
  providerId: string,
  values: unknown,
  fallback: readonly string[],
): string[] {
  if (!Array.isArray(values)) {
    return [...fallback]
  }

  const knownIds = new Set(
    (commandRailProviderCommandOptionsByProvider[providerId as CommandRailProviderId] ?? []).map(
      (option) => option.id,
    ),
  )
  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    if (typeof value !== 'string' || value.length === 0) {
      return
    }

    const normalizedValue = normalizeCommandPreferenceValue(providerId, value)
    if (normalizedValue.length === 0 || seen.has(normalizedValue)) {
      return
    }

    if (knownIds.size > 0 && !knownIds.has(normalizedValue)) {
      return
    }

    seen.add(normalizedValue)
    normalized.push(normalizedValue)
  })

  if (values.length === 0) {
    return []
  }

  return normalized.length > 0 ? normalized : [...fallback]
}

function normalizePinnedCommandIdsByProvider(
  value: unknown,
): Record<string, string[]> {
  const current = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const providerIds = new Set([
    ...Object.keys(commandRailDefaultPinnedCommandIdsByProvider),
    ...Object.keys(current),
  ])
  const normalized: Record<string, string[]> = {}

  providerIds.forEach((providerId) => {
    const fallback = commandRailDefaultPinnedCommandIdsByProvider[providerId as CommandRailProviderId] ?? []
    normalized[providerId] = dedupeStrings(providerId, current[providerId], fallback)
  })

  return normalized
}

export function isQuickCommandRailVisible(
  providerId: CommandRailProviderId,
  preferences: Pick<UiPreferences, 'quickCommandVisibilityByProvider'> = defaultUiPreferences,
): boolean {
  return getQuickCommandVisibility(providerId, preferences.quickCommandVisibilityByProvider)
}

export function setQuickCommandRailVisibility(
  providerId: CommandRailProviderId,
  visible: boolean,
  preferences: UiPreferences,
): UiPreferences {
  const quickCommandVisibilityByProvider = {
    ...preferences.quickCommandVisibilityByProvider,
    [providerId]: visible,
  }
  return {
    ...preferences,
    quickCommandVisibilityByProvider,
    showCommandRail: Object.values(quickCommandVisibilityByProvider).some(Boolean),
  }
}

export function toggleQuickCommandRailVisibility(
  providerId: CommandRailProviderId,
  preferences: UiPreferences,
): UiPreferences {
  return setQuickCommandRailVisibility(
    providerId,
    !isQuickCommandRailVisible(providerId, preferences),
    preferences,
  )
}

export function loadUiPreferences(): UiPreferences {
  if (typeof window === 'undefined') {
    return defaultUiPreferences
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultUiPreferences
    }
    const parsed = JSON.parse(raw) as Partial<UiPreferences>
    const normalizedQuickCommandVisibilityByProvider = normalizeQuickCommandVisibilityByProvider(
      parsed.quickCommandVisibilityByProvider,
      parsed.showCommandRail,
    )
    const hasQuickCommandVisibilityByProvider =
      parsed.quickCommandVisibilityByProvider != null &&
      typeof parsed.quickCommandVisibilityByProvider === 'object' &&
      Object.keys(parsed.quickCommandVisibilityByProvider).length > 0
    return {
      locale: parsed.locale ?? defaultUiPreferences.locale,
      themeMode: parsed.themeMode ?? defaultUiPreferences.themeMode,
      uiFont: parsed.uiFont ?? defaultUiPreferences.uiFont,
      monoFont: parsed.monoFont ?? defaultUiPreferences.monoFont,
      uiFontSize:
        parsed.uiFontSize === 'small' || parsed.uiFontSize === 'medium' ||
        parsed.uiFontSize === 'large' || parsed.uiFontSize === 'xlarge'
          ? parsed.uiFontSize
          : defaultUiPreferences.uiFontSize,
      showCommandRail: hasQuickCommandVisibilityByProvider
        ? Object.values(normalizedQuickCommandVisibilityByProvider).some(Boolean)
        : typeof parsed.showCommandRail === 'boolean'
          ? parsed.showCommandRail
          : defaultUiPreferences.showCommandRail,
      showWorkspaceActionsInRail:
        typeof parsed.showWorkspaceActionsInRail === 'boolean'
          ? parsed.showWorkspaceActionsInRail
          : defaultUiPreferences.showWorkspaceActionsInRail,
      quickCommandVisibilityByProvider: normalizedQuickCommandVisibilityByProvider,
      pinnedCommandIdsByProvider: normalizePinnedCommandIdsByProvider(
        parsed.pinnedCommandIdsByProvider,
      ),
    }
  } catch {
    return defaultUiPreferences
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

export function applyUiPreferences(preferences: UiPreferences): void {
  if (typeof document === 'undefined') {
    return
  }
  const root = document.documentElement
  root.dataset.theme = preferences.themeMode
  root.style.setProperty('--vb-font-ui', uiFontCssMap[preferences.uiFont])
  root.style.setProperty('--vb-font-mono', monoFontCssMap[preferences.monoFont])
  root.style.setProperty('--vb-font-size-base', uiFontSizeCssMap[preferences.uiFontSize])
}
