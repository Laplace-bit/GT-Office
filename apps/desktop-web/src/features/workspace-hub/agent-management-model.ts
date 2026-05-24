export type ManagedAgentProvider = 'claude' | 'codex' | 'gemini'

export interface AgentProviderOption {
  key: ManagedAgentProvider
  label: string
  promptFileName: string
}

export interface AgentProviderSnapshot {
  agent: string
  installStatus: {
    installed: boolean
  }
  configStatus: string
}

function normalizeAgentWorkdir(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  if (!normalized || normalized === '.') {
    return '.'
  }
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')
  if (segments.length === 0) {
    return '.'
  }
  return segments.join('/')
}

function normalizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'agent'
}

export function buildDefaultAgentWorkdir(_name: string): string {
  return '.'
}

export function buildSuggestedAgentWorkdir(name: string): string {
  return `.gtoffice/${normalizeSegment(name)}`
}

export function resolvePromptFileNameForProvider(provider: ManagedAgentProvider): string {
  switch (provider) {
    case 'claude':
      return 'CLAUDE.md'
    case 'gemini':
      return 'GEMINI.md'
    case 'codex':
    default:
      return 'AGENTS.md'
  }
}

export function resolvePromptFileRelativePathForProvider(
  provider: ManagedAgentProvider,
  workdir: string | null | undefined,
): string {
  const fileName = resolvePromptFileNameForProvider(provider)
  const normalizedWorkdir = normalizeAgentWorkdir(workdir)
  if (normalizedWorkdir === '.') {
    return fileName
  }
  return `${normalizedWorkdir}/${fileName}`
}

export function isWorkspaceRootAgentWorkdir(workdir: string | null | undefined): boolean {
  return normalizeAgentWorkdir(workdir) === '.'
}

export function resolveProviderLabel(provider: ManagedAgentProvider): string {
  switch (provider) {
    case 'claude':
      return 'Claude Code'
    case 'gemini':
      return 'Gemini CLI'
    case 'codex':
    default:
      return 'Codex CLI'
  }
}

export function resolveManagedProviderKey(tool: string | null | undefined): ManagedAgentProvider {
  const normalized = tool?.trim().toLowerCase() ?? ''
  if (normalized.includes('claude')) {
    return 'claude'
  }
  if (normalized.includes('gemini')) {
    return 'gemini'
  }
  return 'codex'
}

function isSelectableProvider(
  agent: AgentProviderSnapshot,
): agent is AgentProviderSnapshot & { agent: ManagedAgentProvider } {
  if (agent.agent === 'gemini') {
    return false
  }
  if (agent.agent !== 'claude' && agent.agent !== 'codex') {
    return false
  }
  return agent.installStatus.installed || agent.configStatus === 'configured'
}

export function resolveAvailableAgentProviders(snapshotAgents: AgentProviderSnapshot[]): AgentProviderOption[] {
  return snapshotAgents
    .filter(isSelectableProvider)
    .map((agent) => ({
      key: agent.agent,
      label: resolveProviderLabel(agent.agent),
      promptFileName: resolvePromptFileNameForProvider(agent.agent),
    }))
}
