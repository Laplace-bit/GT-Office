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

export type CommandCapsuleSubmitMode = 'insert' | 'insert_and_submit'

export interface QuickCommandMetadata {
  descriptionKey: TranslationKey
  submitMode: CommandCapsuleSubmitMode
}

const quickCommandMetadataByProvider: Record<
  QuickCommandProviderId,
  Record<string, QuickCommandMetadata>
> = {
  claude: {
    'add-dir': { descriptionKey: 'quickCommands.command.claude.addDir', submitMode: 'insert' },
    agents: { descriptionKey: 'quickCommands.command.claude.agents', submitMode: 'insert_and_submit' },
    batch: { descriptionKey: 'quickCommands.command.claude.batch', submitMode: 'insert' },
    branch: { descriptionKey: 'quickCommands.command.claude.branch', submitMode: 'insert' },
    btw: { descriptionKey: 'quickCommands.command.claude.btw', submitMode: 'insert' },
    clear: { descriptionKey: 'quickCommands.command.claude.clear', submitMode: 'insert_and_submit' },
    chrome: { descriptionKey: 'quickCommands.command.claude.chrome', submitMode: 'insert_and_submit' },
    color: { descriptionKey: 'quickCommands.command.claude.color', submitMode: 'insert' },
    compact: { descriptionKey: 'quickCommands.command.claude.compact', submitMode: 'insert' },
    config: { descriptionKey: 'quickCommands.command.claude.config', submitMode: 'insert_and_submit' },
    context: { descriptionKey: 'quickCommands.command.claude.context', submitMode: 'insert_and_submit' },
    copy: { descriptionKey: 'quickCommands.command.claude.copy', submitMode: 'insert_and_submit' },
    cost: { descriptionKey: 'quickCommands.command.claude.cost', submitMode: 'insert_and_submit' },
    desktop: { descriptionKey: 'quickCommands.command.claude.desktop', submitMode: 'insert_and_submit' },
    diff: { descriptionKey: 'quickCommands.command.claude.diff', submitMode: 'insert_and_submit' },
    doctor: { descriptionKey: 'quickCommands.command.claude.doctor', submitMode: 'insert_and_submit' },
    effort: { descriptionKey: 'quickCommands.command.claude.effort', submitMode: 'insert' },
    'effort-max': { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert_and_submit' },
    exit: { descriptionKey: 'quickCommands.command.claude.exit', submitMode: 'insert_and_submit' },
    export: { descriptionKey: 'quickCommands.command.claude.export', submitMode: 'insert' },
    fast: { descriptionKey: 'quickCommands.command.claude.fast', submitMode: 'insert' },
    feedback: { descriptionKey: 'quickCommands.command.claude.feedback', submitMode: 'insert' },
    files: { descriptionKey: 'quickCommands.command.claude.files', submitMode: 'insert_and_submit' },
    help: { descriptionKey: 'quickCommands.command.claude.help', submitMode: 'insert_and_submit' },
    hooks: { descriptionKey: 'quickCommands.command.claude.hooks', submitMode: 'insert_and_submit' },
    ide: { descriptionKey: 'quickCommands.command.claude.ide', submitMode: 'insert' },
    init: { descriptionKey: 'quickCommands.command.claude.init', submitMode: 'insert_and_submit' },
    login: { descriptionKey: 'quickCommands.command.claude.login', submitMode: 'insert_and_submit' },
    logout: { descriptionKey: 'quickCommands.command.claude.logout', submitMode: 'insert_and_submit' },
    loop: { descriptionKey: 'quickCommands.command.claude.loop', submitMode: 'insert' },
    mcp: { descriptionKey: 'quickCommands.command.claude.mcp', submitMode: 'insert' },
    memory: { descriptionKey: 'quickCommands.command.claude.memory', submitMode: 'insert_and_submit' },
    mobile: { descriptionKey: 'quickCommands.command.claude.mobile', submitMode: 'insert_and_submit' },
    model: { descriptionKey: 'quickCommands.command.claude.model', submitMode: 'insert' },
    new: { descriptionKey: 'quickCommands.command.claude.clear', submitMode: 'insert_and_submit' },
    plan: { descriptionKey: 'quickCommands.command.claude.plan', submitMode: 'insert' },
    permissions: { descriptionKey: 'quickCommands.command.claude.permissions', submitMode: 'insert_and_submit' },
    plugin: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    'release-notes': { descriptionKey: 'quickCommands.command.claude.releaseNotes', submitMode: 'insert_and_submit' },
    rename: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    review: { descriptionKey: 'quickCommands.command.claude.review', submitMode: 'insert' },
    resume: { descriptionKey: 'quickCommands.command.claude.resume', submitMode: 'insert' },
    rewind: { descriptionKey: 'quickCommands.command.claude.rewind', submitMode: 'insert_and_submit' },
    sandbox: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    schedule: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    skills: { descriptionKey: 'quickCommands.command.claude.skills', submitMode: 'insert_and_submit' },
    status: { descriptionKey: 'quickCommands.command.claude.status', submitMode: 'insert_and_submit' },
    simplify: { descriptionKey: 'quickCommands.command.claude.simplify', submitMode: 'insert_and_submit' },
    stats: { descriptionKey: 'quickCommands.command.claude.stats', submitMode: 'insert_and_submit' },
    'terminal-setup': { descriptionKey: 'quickCommands.command.claude.terminalSetup', submitMode: 'insert_and_submit' },
    vim: { descriptionKey: 'quickCommands.command.claude.vim', submitMode: 'insert_and_submit' },
    statusline: { descriptionKey: 'quickCommands.command.claude.statusline', submitMode: 'insert_and_submit' },
  },
  codex: {
    agent: { descriptionKey: 'quickCommands.command.plan', submitMode: 'insert_and_submit' },
    apps: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    clear: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    compact: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    copy: { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    'debug-config': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    diff: { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    exit: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    experimental: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
    fast: { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert' },
    'fast-off': { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert_and_submit' },
    'fast-on': { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert_and_submit' },
    'fast-status': { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert_and_submit' },
    feedback: { descriptionKey: 'quickCommands.command.account', submitMode: 'insert' },
    fork: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    init: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
    logout: { descriptionKey: 'quickCommands.command.account', submitMode: 'insert_and_submit' },
    mcp: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    mention: { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert' },
    model: { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert' },
    new: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    permissions: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    personality: { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert' },
    plan: { descriptionKey: 'quickCommands.command.plan', submitMode: 'insert' },
    ps: { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert_and_submit' },
    resume: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    review: { descriptionKey: 'quickCommands.command.review', submitMode: 'insert_and_submit' },
    status: { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    statusline: { descriptionKey: 'quickCommands.command.surface', submitMode: 'insert_and_submit' },
  },
  gemini: {
    about: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
    auth: { descriptionKey: 'quickCommands.command.account', submitMode: 'insert_and_submit' },
    bug: { descriptionKey: 'quickCommands.command.account', submitMode: 'insert' },
    chat: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    'chat-delete': { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    'chat-list': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    'chat-resume': { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    'chat-save': { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    'chat-share': { descriptionKey: 'quickCommands.command.account', submitMode: 'insert' },
    clear: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    commands: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    'commands-reload': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    compress: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    copy: { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    directory: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    dir: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'directory-add': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'directory-show': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    docs: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
    editor: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    extensions: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    exit: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    help: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
    hooks: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'hooks-list': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    ide: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'ide-status': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    init: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
    mcp: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'mcp-auth': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'mcp-desc': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert' },
    'mcp-list': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    'mcp-refresh': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    'mcp-schema': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert' },
    memory: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'memory-add': { descriptionKey: 'quickCommands.command.plan', submitMode: 'insert' },
    'memory-list': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    'memory-refresh': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    'memory-show': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    model: { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert' },
    plan: { descriptionKey: 'quickCommands.command.plan', submitMode: 'insert' },
    policies: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert' },
    'policies-list': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    privacy: { descriptionKey: 'quickCommands.command.account', submitMode: 'insert_and_submit' },
    quit: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    restore: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    rewind: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert_and_submit' },
    resume: { descriptionKey: 'quickCommands.command.session', submitMode: 'insert' },
    settings: { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    shells: { descriptionKey: 'quickCommands.command.runtime', submitMode: 'insert_and_submit' },
    'setup-github': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    skills: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert' },
    'skills-list': { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
    'skills-reload': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    stats: { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    'terminal-setup': { descriptionKey: 'quickCommands.command.control', submitMode: 'insert_and_submit' },
    theme: { descriptionKey: 'quickCommands.command.surface', submitMode: 'insert' },
    tools: { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert_and_submit' },
    'tools-desc': { descriptionKey: 'quickCommands.command.inspect', submitMode: 'insert' },
    vim: { descriptionKey: 'quickCommands.command.info', submitMode: 'insert_and_submit' },
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
  return resolveQuickCommandMetadata(providerId, commandId).descriptionKey
}

export function resolveQuickCommandMetadata(
  providerId: QuickCommandProviderId,
  commandId: string,
): QuickCommandMetadata {
  return (
    quickCommandMetadataByProvider[providerId]?.[commandId] ?? {
      descriptionKey: quickCommandGenericDescriptionByProvider[providerId],
      submitMode: 'insert_and_submit',
    }
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
