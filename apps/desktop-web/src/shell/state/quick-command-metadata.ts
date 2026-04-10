import type { TranslationKey } from '../i18n/ui-locale.js'

export const quickCommandProviderIds = ['claude', 'codex', 'gemini'] as const

export type QuickCommandProviderId = (typeof quickCommandProviderIds)[number]

export function isQuickCommandProviderId(value: string | null | undefined): value is QuickCommandProviderId {
  return typeof value === 'string' && (quickCommandProviderIds as readonly string[]).includes(value)
}

export interface QuickCommandProviderCopy {
  titleKey: TranslationKey
  descriptionKey: TranslationKey
}

export const quickCommandProviderCopyByProvider: Record<
  QuickCommandProviderId,
  QuickCommandProviderCopy
> = {
  claude: {
    titleKey: 'quickCommands.provider.claude.title',
    descriptionKey: 'quickCommands.provider.claude.description',
  },
  codex: {
    titleKey: 'quickCommands.provider.codex.title',
    descriptionKey: 'quickCommands.provider.codex.description',
  },
  gemini: {
    titleKey: 'quickCommands.provider.gemini.title',
    descriptionKey: 'quickCommands.provider.gemini.description',
  },
}

export const quickCommandDefaultVisibilityByProvider: Record<QuickCommandProviderId, boolean> = {
  claude: true,
  codex: true,
  gemini: true,
}

const quickCommandGenericDescriptionByProvider: Record<QuickCommandProviderId, TranslationKey> = {
  claude: 'quickCommands.command.genericClaude',
  codex: 'quickCommands.command.genericCodex',
  gemini: 'quickCommands.command.genericGemini',
}

const quickCommandDescriptionKeyByProvider: Record<
  QuickCommandProviderId,
  Record<string, TranslationKey>
> = {
  claude: {
    'add-dir': 'quickCommands.command.control',
    agents: 'quickCommands.command.plan',
    batch: 'quickCommands.command.plan',
    branch: 'quickCommands.command.session',
    btw: 'quickCommands.command.session',
    clear: 'quickCommands.command.session',
    chrome: 'quickCommands.command.surface',
    color: 'quickCommands.command.surface',
    compact: 'quickCommands.command.session',
    config: 'quickCommands.command.control',
    context: 'quickCommands.command.inspect',
    copy: 'quickCommands.command.inspect',
    cost: 'quickCommands.command.inspect',
    desktop: 'quickCommands.command.surface',
    diff: 'quickCommands.command.inspect',
    doctor: 'quickCommands.command.control',
    effort: 'quickCommands.command.runtime',
    'effort-max': 'quickCommands.command.runtime',
    exit: 'quickCommands.command.session',
    export: 'quickCommands.command.account',
    fast: 'quickCommands.command.runtime',
    feedback: 'quickCommands.command.account',
    help: 'quickCommands.command.info',
    hooks: 'quickCommands.command.control',
    ide: 'quickCommands.command.control',
    init: 'quickCommands.command.info',
    'install-github-app': 'quickCommands.command.control',
    'install-slack-app': 'quickCommands.command.control',
    login: 'quickCommands.command.account',
    logout: 'quickCommands.command.account',
    loop: 'quickCommands.command.plan',
    mcp: 'quickCommands.command.control',
    memory: 'quickCommands.command.info',
    mobile: 'quickCommands.command.surface',
    model: 'quickCommands.command.runtime',
    new: 'quickCommands.command.session',
    plan: 'quickCommands.command.plan',
    permissions: 'quickCommands.command.control',
    plugin: 'quickCommands.command.control',
    'release-notes': 'quickCommands.command.info',
    rename: 'quickCommands.command.session',
    review: 'quickCommands.command.review',
    resume: 'quickCommands.command.session',
    rewind: 'quickCommands.command.session',
    sandbox: 'quickCommands.command.control',
    schedule: 'quickCommands.command.control',
    skills: 'quickCommands.command.info',
    status: 'quickCommands.command.inspect',
    simplify: 'quickCommands.command.review',
    stats: 'quickCommands.command.inspect',
    'terminal-setup': 'quickCommands.command.control',
    vim: 'quickCommands.command.info',
  },
  codex: {
    agent: 'quickCommands.command.session',
    apps: 'quickCommands.command.control',
    clear: 'quickCommands.command.session',
    compact: 'quickCommands.command.session',
    copy: 'quickCommands.command.inspect',
    'debug-config': 'quickCommands.command.control',
    diff: 'quickCommands.command.inspect',
    exit: 'quickCommands.command.session',
    experimental: 'quickCommands.command.info',
    fast: 'quickCommands.command.runtime',
    'fast-off': 'quickCommands.command.runtime',
    'fast-on': 'quickCommands.command.runtime',
    'fast-status': 'quickCommands.command.runtime',
    feedback: 'quickCommands.command.account',
    fork: 'quickCommands.command.session',
    init: 'quickCommands.command.info',
    logout: 'quickCommands.command.account',
    mcp: 'quickCommands.command.control',
    mention: 'quickCommands.command.inspect',
    model: 'quickCommands.command.runtime',
    new: 'quickCommands.command.session',
    permissions: 'quickCommands.command.control',
    personality: 'quickCommands.command.runtime',
    plan: 'quickCommands.command.plan',
    ps: 'quickCommands.command.runtime',
    resume: 'quickCommands.command.session',
    review: 'quickCommands.command.review',
    status: 'quickCommands.command.inspect',
    statusline: 'quickCommands.command.surface',
  },
  gemini: {
    about: 'quickCommands.command.info',
    auth: 'quickCommands.command.account',
    bug: 'quickCommands.command.account',
    chat: 'quickCommands.command.session',
    'chat-delete': 'quickCommands.command.session',
    'chat-list': 'quickCommands.command.inspect',
    'chat-resume': 'quickCommands.command.session',
    'chat-save': 'quickCommands.command.session',
    'chat-share': 'quickCommands.command.account',
    clear: 'quickCommands.command.session',
    commands: 'quickCommands.command.control',
    'commands-reload': 'quickCommands.command.control',
    compress: 'quickCommands.command.session',
    copy: 'quickCommands.command.inspect',
    directory: 'quickCommands.command.control',
    dir: 'quickCommands.command.control',
    'directory-add': 'quickCommands.command.control',
    'directory-show': 'quickCommands.command.inspect',
    docs: 'quickCommands.command.info',
    editor: 'quickCommands.command.control',
    extensions: 'quickCommands.command.control',
    exit: 'quickCommands.command.session',
    help: 'quickCommands.command.info',
    hooks: 'quickCommands.command.control',
    'hooks-list': 'quickCommands.command.control',
    ide: 'quickCommands.command.control',
    'ide-status': 'quickCommands.command.inspect',
    init: 'quickCommands.command.info',
    mcp: 'quickCommands.command.control',
    'mcp-auth': 'quickCommands.command.control',
    'mcp-desc': 'quickCommands.command.inspect',
    'mcp-list': 'quickCommands.command.control',
    'mcp-refresh': 'quickCommands.command.control',
    'mcp-schema': 'quickCommands.command.inspect',
    memory: 'quickCommands.command.control',
    'memory-add': 'quickCommands.command.plan',
    'memory-list': 'quickCommands.command.inspect',
    'memory-refresh': 'quickCommands.command.control',
    'memory-show': 'quickCommands.command.inspect',
    model: 'quickCommands.command.runtime',
    plan: 'quickCommands.command.plan',
    policies: 'quickCommands.command.control',
    'policies-list': 'quickCommands.command.inspect',
    privacy: 'quickCommands.command.account',
    quit: 'quickCommands.command.session',
    restore: 'quickCommands.command.session',
    rewind: 'quickCommands.command.session',
    resume: 'quickCommands.command.session',
    settings: 'quickCommands.command.control',
    shells: 'quickCommands.command.runtime',
    'setup-github': 'quickCommands.command.control',
    skills: 'quickCommands.command.info',
    'skills-list': 'quickCommands.command.info',
    'skills-reload': 'quickCommands.command.control',
    stats: 'quickCommands.command.inspect',
    'terminal-setup': 'quickCommands.command.control',
    theme: 'quickCommands.command.surface',
    tools: 'quickCommands.command.inspect',
    'tools-desc': 'quickCommands.command.inspect',
    vim: 'quickCommands.command.info',
  },
}

const quickCommandProviderNameByProvider: Record<QuickCommandProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
}

const quickCommandStartLiveSessionReasonKeyByProvider: Record<QuickCommandProviderId, TranslationKey> = {
  claude: 'quickCommands.rail.disabled.startClaudeSession',
  codex: 'quickCommands.rail.disabled.startCodexSession',
  gemini: 'quickCommands.rail.disabled.startGeminiSession',
}

function readBooleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeQuickCommandVisibilityByProvider(
  value: unknown,
  legacyVisible?: boolean,
): Record<QuickCommandProviderId, boolean> {
  const current = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const hasSupportedProviderEntry = quickCommandProviderIds.some((providerId) =>
    Object.prototype.hasOwnProperty.call(current, providerId),
  )

  return {
    claude: readBooleanValue(
      current.claude,
      !hasSupportedProviderEntry && typeof legacyVisible === 'boolean'
        ? legacyVisible
        : quickCommandDefaultVisibilityByProvider.claude,
    ),
    codex: readBooleanValue(
      current.codex,
      !hasSupportedProviderEntry && typeof legacyVisible === 'boolean'
        ? legacyVisible
        : quickCommandDefaultVisibilityByProvider.codex,
    ),
    gemini: readBooleanValue(
      current.gemini,
      !hasSupportedProviderEntry && typeof legacyVisible === 'boolean'
        ? legacyVisible
        : quickCommandDefaultVisibilityByProvider.gemini,
    ),
  }
}

export function getQuickCommandVisibility(
  providerId: QuickCommandProviderId,
  visibilityByProvider: Record<QuickCommandProviderId, boolean> | undefined,
): boolean {
  return visibilityByProvider?.[providerId] ?? quickCommandDefaultVisibilityByProvider[providerId]
}

export function resolveQuickCommandDescriptionKey(
  providerId: QuickCommandProviderId,
  commandId: string,
): TranslationKey {
  return (
    quickCommandDescriptionKeyByProvider[providerId][commandId] ??
    quickCommandGenericDescriptionByProvider[providerId]
  )
}

export function resolveQuickCommandPreferenceId(
  slashCommand: string | null | undefined,
  actionId: string,
): string {
  if (slashCommand?.startsWith('/')) {
    return slashCommand.slice(1).replace(/\s+/g, '-').toLowerCase()
  }

  return actionId.replace(/^[^-]+-/, '')
}

export function resolveQuickCommandDisabledReasonKey(
  providerId: QuickCommandProviderId | null,
  disabledReason: string | null | undefined,
): TranslationKey | null {
  if (!disabledReason) {
    return null
  }

  if (disabledReason === 'Detached windows are read only') {
    return 'quickCommands.rail.disabled.detachedReadonly'
  }

  if (!providerId) {
    return null
  }

  return disabledReason === `Start a live ${quickCommandProviderNameByProvider[providerId]} session first`
    ? quickCommandStartLiveSessionReasonKeyByProvider[providerId]
    : null
}
