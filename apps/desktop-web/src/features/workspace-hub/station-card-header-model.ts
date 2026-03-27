export type StationCardLaunchState = 'idle' | 'live' | 'alert'

export interface StationCardLaunchRuntime {
  sessionId: string | null
  stateRaw?: string | null
  agentRunning: boolean
}

export interface StationCardIdentityMetaItem {
  kind: 'role' | 'tool'
  label: string
}

interface StationCardPrimaryLaunchInput {
  stationId: string
  sessionId: string | null | undefined
  agentRunning: boolean
  onSelectStation: (stationId: string) => void
  requestTerminalFocus: () => void
  onLaunchCliAgent: (stationId: string) => void
}

export function buildStationCardIdentityMeta(
  roleText: string,
  toolText: string,
): StationCardIdentityMetaItem[] {
  return [
    { kind: 'role', label: roleText },
    { kind: 'tool', label: toolText },
  ]
}

export function resolveStationCardLaunchState(
  runtime: StationCardLaunchRuntime | null | undefined,
): StationCardLaunchState {
  if (runtime?.stateRaw === 'failed' || runtime?.stateRaw === 'killed') {
    return 'alert'
  }
  if (runtime?.agentRunning) {
    return 'live'
  }
  return 'idle'
}

export function handleStationCardPrimaryLaunch({
  stationId,
  agentRunning,
  onSelectStation,
  requestTerminalFocus,
  onLaunchCliAgent,
}: StationCardPrimaryLaunchInput): void {
  onSelectStation(stationId)
  requestTerminalFocus()
  if (agentRunning) {
    return
  }
  onLaunchCliAgent(stationId)
}
