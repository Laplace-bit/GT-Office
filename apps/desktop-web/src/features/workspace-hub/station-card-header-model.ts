export type StationCardLaunchState = 'idle' | 'live' | 'alert'
export type StationCardLaunchIcon = 'play' | 'circle'
export type StationCardStatusTone = 'idle' | 'live' | 'busy' | 'waiting' | 'blocked' | 'error'

export interface StationCardLaunchRuntime {
  sessionId: string | null
  stateRaw?: string | null
  agentRunning: boolean
}

export interface StationCardStatusRuntime {
  sessionId: string | null
  stateRaw?: string | null
  stationState?: 'running' | 'idle' | 'blocked' | string | null
}

export interface StationCardIdentityMetaItem {
  kind: 'name' | 'tool'
  label: string
}

export interface StationCardStatusMeta {
  key: 'idle' | 'launching' | 'live' | 'busy' | 'waiting' | 'blocked' | 'errored' | 'recovering' | 'stopped'
  tone: StationCardStatusTone
  labelKey:
    | 'station.status.idle'
    | 'station.status.launching'
    | 'station.status.live'
    | 'station.status.busy'
    | 'station.status.waiting'
    | 'station.status.blocked'
    | 'station.status.errored'
    | 'station.status.recovering'
    | 'station.status.stopped'
  descriptionKey:
    | 'station.status.description.idle'
    | 'station.status.description.launching'
    | 'station.status.description.live'
    | 'station.status.description.busy'
    | 'station.status.description.waiting'
    | 'station.status.description.blocked'
    | 'station.status.description.errored'
    | 'station.status.description.recovering'
    | 'station.status.description.stopped'
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
  toolText: string,
): StationCardIdentityMetaItem[] {
  return [
    { kind: 'name', label: nameText },
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

export function resolveStationCardStatusMeta(
  runtime: StationCardStatusRuntime | null | undefined,
): StationCardStatusMeta {
  const normalizedRuntimeState = runtime?.stateRaw?.trim().toLowerCase() ?? ''
  const normalizedStationState = runtime?.stationState?.trim().toLowerCase() ?? ''

  if (
    normalizedRuntimeState === 'launching' ||
    normalizedRuntimeState === 'starting' ||
    normalizedRuntimeState === 'connecting'
  ) {
    return {
      key: 'launching',
      tone: 'busy',
      labelKey: 'station.status.launching',
      descriptionKey: 'station.status.description.launching',
    }
  }
  if (normalizedRuntimeState === 'recovering' || normalizedRuntimeState === 'restoring') {
    return {
      key: 'recovering',
      tone: 'busy',
      labelKey: 'station.status.recovering',
      descriptionKey: 'station.status.description.recovering',
    }
  }
  if (normalizedRuntimeState === 'failed') {
    return {
      key: 'errored',
      tone: 'error',
      labelKey: 'station.status.errored',
      descriptionKey: 'station.status.description.errored',
    }
  }
  if (normalizedRuntimeState === 'blocked' || normalizedStationState === 'blocked') {
    return {
      key: 'blocked',
      tone: 'blocked',
      labelKey: 'station.status.blocked',
      descriptionKey: 'station.status.description.blocked',
    }
  }
  if (normalizedRuntimeState === 'waiting' || normalizedRuntimeState === 'awaiting_input') {
    return {
      key: 'waiting',
      tone: 'waiting',
      labelKey: 'station.status.waiting',
      descriptionKey: 'station.status.description.waiting',
    }
  }
  if (normalizedRuntimeState === 'busy' || normalizedRuntimeState === 'processing') {
    return {
      key: 'busy',
      tone: 'busy',
      labelKey: 'station.status.busy',
      descriptionKey: 'station.status.description.busy',
    }
  }
  if (normalizedRuntimeState === 'killed' || normalizedRuntimeState === 'exited') {
    return {
      key: 'stopped',
      tone: 'idle',
      labelKey: 'station.status.stopped',
      descriptionKey: 'station.status.description.stopped',
    }
  }
  if (runtime?.sessionId || normalizedRuntimeState === 'running' || normalizedStationState === 'running') {
    return {
      key: 'live',
      tone: 'live',
      labelKey: 'station.status.live',
      descriptionKey: 'station.status.description.live',
    }
  }
  return {
    key: 'idle',
    tone: 'idle',
    labelKey: 'station.status.idle',
    descriptionKey: 'station.status.description.idle',
  }
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
