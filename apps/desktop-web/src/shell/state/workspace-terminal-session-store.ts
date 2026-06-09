import type { AgentStation } from '@features/workspace-hub'
import type { SessionOwnedRestoreState } from '@features/terminal/runtime'
import type { StationTerminalRuntime } from '../layout/ShellRoot.shared.js'
import { createInitialStationTerminals, getStationIdleBanner } from '../layout/ShellRoot.shared.js'

export interface WorkspaceTerminalSessionDocument {
  stationTerminals: Record<string, StationTerminalRuntime>
  outputCache: Record<string, string>
  outputRevision: Record<string, number>
  restoreState: Record<string, SessionOwnedRestoreState>
  sessionStation: Record<string, string>
  sessionSeq: Record<string, number>
  sessionVisibility: Record<string, boolean>
}

export interface WorkspaceTerminalSessionOwner {
  workspaceId: string
  stationId: string
  document: WorkspaceTerminalSessionDocument
}

function normalizeWorkspaceTerminalDocumentCounter(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

export function createWorkspaceTerminalSessionDocument(
  stations: AgentStation[],
): WorkspaceTerminalSessionDocument {
  return {
    stationTerminals: createInitialStationTerminals(stations),
    outputCache: stations.reduce<Record<string, string>>((acc, station) => {
      acc[station.id] = getStationIdleBanner(station)
      return acc
    }, {}),
    outputRevision: stations.reduce<Record<string, number>>((acc, station) => {
      acc[station.id] = 0
      return acc
    }, {}),
    restoreState: {},
    sessionStation: {},
    sessionSeq: {},
    sessionVisibility: {},
  }
}

export function cloneWorkspaceTerminalSessionDocument(
  document: WorkspaceTerminalSessionDocument,
): WorkspaceTerminalSessionDocument {
  return {
    stationTerminals: { ...document.stationTerminals },
    outputCache: { ...document.outputCache },
    outputRevision: { ...document.outputRevision },
    restoreState: { ...document.restoreState },
    sessionStation: { ...document.sessionStation },
    sessionSeq: { ...document.sessionSeq },
    sessionVisibility: { ...document.sessionVisibility },
  }
}

export function hydrateWorkspaceTerminalSessionDocument(
  document: WorkspaceTerminalSessionDocument | null | undefined,
  stations: AgentStation[],
): WorkspaceTerminalSessionDocument {
  const hydrated = document
    ? cloneWorkspaceTerminalSessionDocument(document)
    : createWorkspaceTerminalSessionDocument(stations)
  const stationIds = new Set(stations.map((station) => station.id))
  const initialRuntimes = createInitialStationTerminals(stations)
  const retainedSessionStation = new Map<string, string>()

  stations.forEach((station) => {
    const cached = hydrated.stationTerminals[station.id]
    if (cached) {
      if (cached.sessionId) {
        retainedSessionStation.set(cached.sessionId, station.id)
      }
    } else {
      hydrated.stationTerminals[station.id] = initialRuntimes[station.id]
    }
    if (!Object.prototype.hasOwnProperty.call(hydrated.outputCache, station.id)) {
      hydrated.outputCache[station.id] = getStationIdleBanner(station)
    }
    hydrated.outputRevision[station.id] = normalizeWorkspaceTerminalDocumentCounter(
      hydrated.outputRevision[station.id],
    )
  })

  Object.keys(hydrated.stationTerminals).forEach((stationId) => {
    if (!stationIds.has(stationId)) {
      delete hydrated.stationTerminals[stationId]
    }
  })
  Object.keys(hydrated.outputCache).forEach((stationId) => {
    if (!stationIds.has(stationId)) {
      delete hydrated.outputCache[stationId]
      delete hydrated.outputRevision[stationId]
      delete hydrated.restoreState[stationId]
    }
  })

  Object.entries(hydrated.sessionStation).forEach(([sessionId, stationId]) => {
    if (retainedSessionStation.get(sessionId) !== stationId) {
      delete hydrated.sessionStation[sessionId]
      delete hydrated.sessionSeq[sessionId]
      delete hydrated.sessionVisibility[sessionId]
    }
  })
  retainedSessionStation.forEach((stationId, sessionId) => {
    hydrated.sessionStation[sessionId] = stationId
    hydrated.sessionSeq[sessionId] = normalizeWorkspaceTerminalDocumentCounter(hydrated.sessionSeq[sessionId])
    hydrated.sessionVisibility[sessionId] = hydrated.sessionVisibility[sessionId] ?? false
  })

  return hydrated
}
export function findWorkspaceTerminalSessionOwner(
  documents: Record<string, WorkspaceTerminalSessionDocument>,
  sessionId: string | null | undefined,
): WorkspaceTerminalSessionOwner | null {
  const normalizedSessionId = sessionId?.trim() ?? ''
  if (!normalizedSessionId) {
    return null
  }
  for (const [workspaceId, document] of Object.entries(documents)) {
    const stationId = document.sessionStation[normalizedSessionId]
    if (!stationId) {
      continue
    }
    return {
      workspaceId,
      stationId,
      document,
    }
  }
  return null
}

export function setWorkspaceTerminalSessionVisibility(
  document: WorkspaceTerminalSessionDocument,
  visible: boolean,
): string[] {
  const sessionIds = Object.keys(document.sessionStation)
  sessionIds.forEach((sessionId) => {
    document.sessionVisibility[sessionId] = visible
  })
  return sessionIds
}

export function removeWorkspaceTerminalSessionBinding(
  document: WorkspaceTerminalSessionDocument,
  sessionId: string | null | undefined,
  nextStateRaw: 'exited' | 'killed' | 'failed' = 'exited',
): string | null {
  const normalizedSessionId = sessionId?.trim() ?? ''
  if (!normalizedSessionId) {
    return null
  }
  const stationId = document.sessionStation[normalizedSessionId] ?? null
  if (!stationId) {
    return null
  }
  delete document.sessionStation[normalizedSessionId]
  delete document.sessionSeq[normalizedSessionId]
  delete document.sessionVisibility[normalizedSessionId]

  const runtime = document.stationTerminals[stationId]
  if (runtime?.sessionId === normalizedSessionId) {
    document.stationTerminals[stationId] = {
      ...runtime,
      sessionId: null,
      stateRaw: nextStateRaw,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    }
  }
  return stationId
}
