import type {
  AgentDeleteRequest,
  AgentDeleteResponse,
  AgentProfile,
  ChannelRouteBinding,
} from '../../shell/integration/desktop-api.js'

export type StationDeleteCleanupStrategy = 'rebind' | 'disable' | 'delete'

export interface StationDeleteCleanupState {
  blockingBindings: ChannelRouteBinding[]
  availableAgents: Array<Pick<AgentProfile, 'id' | 'name'>>
  strategy: StationDeleteCleanupStrategy
  replacementAgentId: string
}

export function buildStationDeleteCleanupState(
  response: AgentDeleteResponse,
  availableAgents: Array<Pick<AgentProfile, 'id' | 'name'>>,
  deletingAgentId: string,
): StationDeleteCleanupState {
  const blockingBindings = response.blockingBindings ?? []
  const filteredAgents = availableAgents.filter((agent) => agent.id !== deletingAgentId)
  return {
    blockingBindings,
    availableAgents: filteredAgents,
    strategy: 'disable',
    replacementAgentId: filteredAgents[0]?.id ?? '',
  }
}

export function canConfirmStationDeleteCleanup(
  state: StationDeleteCleanupState,
): boolean {
  if (state.blockingBindings.length === 0) {
    return false
  }
  if (state.strategy !== 'rebind') {
    return true
  }
  return Boolean(state.replacementAgentId.trim())
}

export function buildStationDeleteCleanupRequest(
  state: StationDeleteCleanupState,
): Pick<AgentDeleteRequest, 'cleanupMode' | 'replacementAgentId'> {
  if (state.strategy === 'rebind') {
    return {
      cleanupMode: 'rebind',
      replacementAgentId: state.replacementAgentId.trim() || null,
    }
  }
  return {
    cleanupMode: state.strategy,
    replacementAgentId: null,
  }
}
