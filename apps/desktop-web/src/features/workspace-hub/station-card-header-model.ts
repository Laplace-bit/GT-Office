export type StationCardLaunchState = 'idle' | 'live' | 'alert'
export type StationCardLaunchIcon = 'play' | 'circle'

export interface StationCardLaunchRuntime {
  sessionId: string | null
  stateRaw?: string | null
  agentRunning: boolean
}

export interface StationCardIdentityMetaItem {
  kind: 'name' | 'role' | 'tool'
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
  nameText: string,
  roleText: string,
  toolText: string,
): StationCardIdentityMetaItem[] {
  return [
    { kind: 'name', label: nameText },
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

export function resolveStationCardLaunchIcon(launchState: StationCardLaunchState): StationCardLaunchIcon {
  if (launchState === 'live') {
    return 'circle'
  }
  return 'play'
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
