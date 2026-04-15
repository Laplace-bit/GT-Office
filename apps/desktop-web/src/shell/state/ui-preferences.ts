import type { Locale, TranslationKey } from '../i18n/ui-locale.js'
import {
  getQuickCommandVisibility,
  isQuickCommandProviderId,
  normalizeQuickCommandVisibilityByProvider,
  quickCommandDefaultVisibilityByProvider,
  quickCommandProviderCopyByProvider,
  resolveQuickCommandDescriptionKey,
  resolveQuickCommandDisabledReasonKey,
  resolveQuickCommandMetadata,
  resolveQuickCommandPreferenceId,
  type QuickCommandProviderId,
} from './quick-command-metadata.js'

export type ThemeMode = 'graphite-light' | 'graphite-dark'
export type UiFont = 'sf-pro' | 'ibm-plex' | 'system-ui'
export type MonoFont = 'jetbrains-mono' | 'cascadia-code' | 'fira-code'
export type UiFontSize = 'small' | 'medium' | 'large' | 'xlarge'
export type WorkspaceSwitchAnimation = 'crossfade' | 'slide' | 'none'
export type CommandRailProviderId = QuickCommandProviderId
export type CommandCapsuleSubmitMode = 'insert' | 'insert_and_submit'
export type CustomCommandSaveMode = 'save-and-add' | 'save-only'
export {
  isQuickCommandProviderId,
  quickCommandDefaultVisibilityByProvider,
  quickCommandProviderCopyByProvider,
  resolveQuickCommandDescriptionKey,
  resolveQuickCommandDisabledReasonKey,
  resolveQuickCommandMetadata,
  resolveQuickCommandPreferenceId,
}

export interface CustomCommandCapsule {
  id: string
  label: string
  text: string
  submitMode: CommandCapsuleSubmitMode
  createdAt: number
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
  workspaceSwitchAnimation: WorkspaceSwitchAnimation
  autoCheckAppUpdates: boolean
  skippedAppUpdateVersion: string | null
  showWorkspaceActionsInRail: boolean
  quickCommandVisibilityByProvider: Record<CommandRailProviderId, boolean>
  pinnedCommandIdsByProvider: Record<string, string[]>
  customCommandCapsulesByProvider: Record<CommandRailProviderId, CustomCommandCapsule[]>
  orderedCommandCapsuleIdsByProvider: Record<CommandRailProviderId, string[]>
}

const STORAGE_KEY = 'gtoffice.ui.preferences.v1'
export const UI_PREFERENCES_UPDATED_EVENT = 'gtoffice:ui-preferences-updated'
export const PRESET_COMMAND_CAPSULE_PREFIX = 'preset:'
export const CUSTOM_COMMAND_CAPSULE_PREFIX = 'custom:'

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

export function buildPresetCommandCapsuleOrderId(commandId: string): string {
  return `${PRESET_COMMAND_CAPSULE_PREFIX}${commandId.trim().toLowerCase().replace(/\s+/g, '-')}`
}

export function buildCustomCommandCapsuleOrderId(capsuleId: string): string {
  return `${CUSTOM_COMMAND_CAPSULE_PREFIX}${capsuleId.trim()}`
}

export function buildNextOrderedCommandCapsuleIdsForCustomSave(
  currentOrderedCommandCapsuleIds: string[],
  capsuleId: string,
  saveMode: CustomCommandSaveMode,
): string[] {
  if (saveMode !== 'save-and-add') {
    return currentOrderedCommandCapsuleIds
  }

  const orderId = buildCustomCommandCapsuleOrderId(capsuleId)
  if (currentOrderedCommandCapsuleIds.includes(orderId)) {
    return currentOrderedCommandCapsuleIds
  }

  return [...currentOrderedCommandCapsuleIds, orderId]
}

export function resolveCustomCommandSaveModeForEdit(
  currentOrderedCommandCapsuleIds: string[],
  capsuleId: string,
): CustomCommandSaveMode {
  const orderId = buildCustomCommandCapsuleOrderId(capsuleId)
  return currentOrderedCommandCapsuleIds.includes(orderId) ? 'save-and-add' : 'save-only'
}

function createEmptyCustomCommandCapsulesByProvider(): Record<CommandRailProviderId, CustomCommandCapsule[]> {
  return {
    claude: [],
    codex: [],
    gemini: [],
  }
}

function buildDefaultOrderedCommandCapsuleIdsByProvider(
  pinnedCommandIdsByProvider: Record<CommandRailProviderId, string[]>,
): Record<CommandRailProviderId, string[]> {
  return {
    claude: pinnedCommandIdsByProvider.claude.map((commandId) => buildPresetCommandCapsuleOrderId(commandId)),
    codex: pinnedCommandIdsByProvider.codex.map((commandId) => buildPresetCommandCapsuleOrderId(commandId)),
    gemini: pinnedCommandIdsByProvider.gemini.map((commandId) => buildPresetCommandCapsuleOrderId(commandId)),
  }
}

const commandRailDefaultCustomCommandCapsulesByProvider = createEmptyCustomCommandCapsulesByProvider()
export const commandRailDefaultOrderedCommandCapsuleIdsByProvider = buildDefaultOrderedCommandCapsuleIdsByProvider(
  commandRailDefaultPinnedCommandIdsByProvider,
)

export const defaultUiPreferences: UiPreferences = {
  locale: 'zh-CN',
  themeMode: 'graphite-dark',
  uiFont: 'sf-pro',
  monoFont: 'jetbrains-mono',
  uiFontSize: 'medium',
  workspaceSwitchAnimation: 'crossfade',
  autoCheckAppUpdates: true,
  skippedAppUpdateVersion: null,
  showWorkspaceActionsInRail: true,
  quickCommandVisibilityByProvider: quickCommandDefaultVisibilityByProvider,
  pinnedCommandIdsByProvider: commandRailDefaultPinnedCommandIdsByProvider,
  customCommandCapsulesByProvider: commandRailDefaultCustomCommandCapsulesByProvider,
  orderedCommandCapsuleIdsByProvider: commandRailDefaultOrderedCommandCapsuleIdsByProvider,
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

export const workspaceSwitchAnimationOptions: Array<{ value: WorkspaceSwitchAnimation; labelKey: TranslationKey }> = [
  { value: 'crossfade', labelKey: 'displayPreferences.animationCrossfade' },
  { value: 'slide', labelKey: 'displayPreferences.animationSlide' },
  { value: 'none', labelKey: 'displayPreferences.animationNone' },
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

function normalizeCustomCommandCapsuleId(value: string): string {
  return value.trim()
}

function normalizeCustomCommandCapsule(
  value: unknown,
): CustomCommandCapsule | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const current = value as Record<string, unknown>
  const id = typeof current.id === 'string' ? normalizeCustomCommandCapsuleId(current.id) : ''
  const label = typeof current.label === 'string' ? current.label.trim() : ''
  const text = typeof current.text === 'string' ? current.text.trim() : ''
  if (!id || !label || !text) {
    return null
  }

  return {
    id,
    label,
    text,
    submitMode: current.submitMode === 'insert_and_submit' ? 'insert_and_submit' : 'insert',
    createdAt: typeof current.createdAt === 'number' && Number.isFinite(current.createdAt) ? current.createdAt : 0,
  }
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

function normalizeCustomCommandCapsulesByProvider(
  value: unknown,
): Record<CommandRailProviderId, CustomCommandCapsule[]> {
  const current = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const normalized = createEmptyCustomCommandCapsulesByProvider()

  ;(Object.keys(normalized) as CommandRailProviderId[]).forEach((providerId) => {
    const values = Array.isArray(current[providerId]) ? current[providerId] : []
    const seen = new Set<string>()
    normalized[providerId] = values.reduce<CustomCommandCapsule[]>((acc, entry) => {
      const capsule = normalizeCustomCommandCapsule(entry)
      if (!capsule || seen.has(capsule.id)) {
        return acc
      }
      seen.add(capsule.id)
      acc.push(capsule)
      return acc
    }, [])
  })

  return normalized
}

function normalizeStoredCommandCapsuleOrderId(
  providerId: CommandRailProviderId,
  value: string,
): string | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  if (normalized.startsWith(PRESET_COMMAND_CAPSULE_PREFIX)) {
    const commandId = normalizeCommandPreferenceValue(
      providerId,
      normalized.slice(PRESET_COMMAND_CAPSULE_PREFIX.length),
    )
    return commandId ? buildPresetCommandCapsuleOrderId(commandId) : null
  }
  if (normalized.startsWith(CUSTOM_COMMAND_CAPSULE_PREFIX)) {
    const capsuleId = normalizeCustomCommandCapsuleId(normalized.slice(CUSTOM_COMMAND_CAPSULE_PREFIX.length))
    return capsuleId ? buildCustomCommandCapsuleOrderId(capsuleId) : null
  }

  const commandId = normalizeCommandPreferenceValue(providerId, normalized)
  return commandId ? buildPresetCommandCapsuleOrderId(commandId) : null
}

function normalizeOrderedCommandCapsuleIdsByProvider(
  value: unknown,
  pinnedCommandIdsByProvider: Record<string, string[]>,
  customCommandCapsulesByProvider: Record<CommandRailProviderId, CustomCommandCapsule[]>,
): Record<CommandRailProviderId, string[]> {
  const current = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const normalized = {
    claude: [] as string[],
    codex: [] as string[],
    gemini: [] as string[],
  }

  ;(Object.keys(normalized) as CommandRailProviderId[]).forEach((providerId) => {
    const pinnedIds = pinnedCommandIdsByProvider[providerId] ?? []
    const customIds = customCommandCapsulesByProvider[providerId].map((capsule) => capsule.id)
    const allowedPresetOrderIds = new Set(pinnedIds.map((commandId) => buildPresetCommandCapsuleOrderId(commandId)))
    const allowedCustomOrderIds = new Set(customIds.map((capsuleId) => buildCustomCommandCapsuleOrderId(capsuleId)))
    const seen = new Set<string>()
    const hasStoredOrder = Object.prototype.hasOwnProperty.call(current, providerId)
    const values = Array.isArray(current[providerId]) ? current[providerId] : []

    values.forEach((value) => {
      if (typeof value !== 'string') {
        return
      }
      const normalizedValue = normalizeStoredCommandCapsuleOrderId(providerId, value)
      if (!normalizedValue || seen.has(normalizedValue)) {
        return
      }
      if (
        !allowedPresetOrderIds.has(normalizedValue) &&
        !allowedCustomOrderIds.has(normalizedValue)
      ) {
        return
      }
      seen.add(normalizedValue)
      normalized[providerId].push(normalizedValue)
    })

    pinnedIds.forEach((commandId) => {
      const orderId = buildPresetCommandCapsuleOrderId(commandId)
      if (seen.has(orderId)) {
        return
      }
      seen.add(orderId)
      normalized[providerId].push(orderId)
    })

    if (!hasStoredOrder) {
      customIds.forEach((capsuleId) => {
        const orderId = buildCustomCommandCapsuleOrderId(capsuleId)
        if (seen.has(orderId)) {
          return
        }
        seen.add(orderId)
        normalized[providerId].push(orderId)
      })
    }
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
    const parsed = JSON.parse(raw) as Partial<UiPreferences> & { showCommandRail?: unknown }
    const normalizedQuickCommandVisibilityByProvider = normalizeQuickCommandVisibilityByProvider(
      parsed.quickCommandVisibilityByProvider,
      parsed.showCommandRail as boolean | undefined,
    )
    const normalizedPinnedCommandIdsByProvider = normalizePinnedCommandIdsByProvider(
      parsed.pinnedCommandIdsByProvider,
    )
    const normalizedCustomCommandCapsulesByProvider = normalizeCustomCommandCapsulesByProvider(
      parsed.customCommandCapsulesByProvider,
    )
    const normalizedOrderedCommandCapsuleIdsByProvider = normalizeOrderedCommandCapsuleIdsByProvider(
      parsed.orderedCommandCapsuleIdsByProvider,
      normalizedPinnedCommandIdsByProvider,
      normalizedCustomCommandCapsulesByProvider,
    )
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
      workspaceSwitchAnimation:
        parsed.workspaceSwitchAnimation === 'crossfade' || parsed.workspaceSwitchAnimation === 'slide' || parsed.workspaceSwitchAnimation === 'none'
          ? parsed.workspaceSwitchAnimation
          : defaultUiPreferences.workspaceSwitchAnimation,
      autoCheckAppUpdates:
        typeof parsed.autoCheckAppUpdates === 'boolean'
          ? parsed.autoCheckAppUpdates
          : defaultUiPreferences.autoCheckAppUpdates,
      skippedAppUpdateVersion:
        typeof parsed.skippedAppUpdateVersion === 'string' && parsed.skippedAppUpdateVersion.trim().length > 0
          ? parsed.skippedAppUpdateVersion.trim()
          : null,
      showWorkspaceActionsInRail:
        typeof parsed.showWorkspaceActionsInRail === 'boolean'
          ? parsed.showWorkspaceActionsInRail
          : defaultUiPreferences.showWorkspaceActionsInRail,
      quickCommandVisibilityByProvider: normalizedQuickCommandVisibilityByProvider,
      pinnedCommandIdsByProvider: normalizedPinnedCommandIdsByProvider,
      customCommandCapsulesByProvider: normalizedCustomCommandCapsulesByProvider,
      orderedCommandCapsuleIdsByProvider: normalizedOrderedCommandCapsuleIdsByProvider,
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
