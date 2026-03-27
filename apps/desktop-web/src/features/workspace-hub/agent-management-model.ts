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

function normalizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'agent'
}

export function buildDefaultAgentWorkdir(name: string): string {
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
  if (agent.agent !== 'claude' && agent.agent !== 'codex' && agent.agent !== 'gemini') {
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
