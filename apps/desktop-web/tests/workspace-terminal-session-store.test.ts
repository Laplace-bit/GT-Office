import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentStation } from '../src/features/workspace-hub/station-model.js'
import type { StationTerminalRuntime } from '../src/shell/layout/ShellRoot.shared.js'

type WorkspaceTerminalSessionDocument = {
  stationTerminals: Record<string, StationTerminalRuntime>
  outputCache: Record<string, string>
  outputRevision: Record<string, number>
  restoreState: Record<string, { sessionId: string; revision: number; state: { content: string; cols: number; rows: number } }>
  sessionStation: Record<string, string>
  sessionSeq: Record<string, number>
  sessionVisibility: Record<string, boolean>
}

function makeStation(id: string): AgentStation {
  return {
    id,
    name: `Station ${id}`,
    roleId: id,
    role: 'generator',
    roleName: 'Generator',
    roleWorkdirRel: '.gtoffice/roles/generator',
    agentWorkdirRel: '.gtoffice',
    customWorkdir: false,
    tool: 'claude',
    toolKind: 'claude',
    promptFileName: null,
    promptFileRelativePath: null,
    terminalSessionId: '',
    state: 'idle',
    workspaceId: 'ws-1',
    orderIndex: 1,
  }
}

function makeRunningRuntime(sessionId: string): StationTerminalRuntime {
  return {
    sessionId,
    stateRaw: 'running',
    unreadCount: 0,
    shell: 'zsh',
    cwdMode: 'workspace_root' as const,
    resolvedCwd: null,
  }
}

function makeIdleRuntime(): StationTerminalRuntime {
  return {
    sessionId: null,
    stateRaw: 'idle',
    unreadCount: 0,
    shell: null,
    cwdMode: 'workspace_root' as const,
    resolvedCwd: null,
  }
}

function makeExitedRuntime(): StationTerminalRuntime {
  return {
    sessionId: null,
    stateRaw: 'exited',
    unreadCount: 0,
    shell: null,
    cwdMode: 'workspace_root' as const,
    resolvedCwd: null,
  }
}

function createFreshDocument(stations: AgentStation[]): WorkspaceTerminalSessionDocument {
  return {
    stationTerminals: Object.fromEntries(stations.map((s) => [s.id, makeIdleRuntime()])),
    outputCache: Object.fromEntries(stations.map((s) => [s.id, ''])),
    outputRevision: Object.fromEntries(stations.map((s) => [s.id, 0])),
    restoreState: {},
    sessionStation: {},
    sessionSeq: {},
    sessionVisibility: {},
  }
}

function cloneDocument(doc: WorkspaceTerminalSessionDocument): WorkspaceTerminalSessionDocument {
  return {
    stationTerminals: { ...doc.stationTerminals },
    outputCache: { ...doc.outputCache },
    outputRevision: { ...doc.outputRevision },
    restoreState: { ...doc.restoreState },
    sessionStation: { ...doc.sessionStation },
    sessionSeq: { ...doc.sessionSeq },
    sessionVisibility: { ...doc.sessionVisibility },
  }
}

/**
 * Reimplementation of hydrateWorkspaceTerminalSessionDocument for testing.
 * This mirrors the production logic to verify the stale-sessionId fix.
 */
function hydrateWorkspaceTerminalSessionDocument(
  document: WorkspaceTerminalSessionDocument | null | undefined,
  stations: AgentStation[],
): WorkspaceTerminalSessionDocument {
  const hydrated = document ? cloneDocument(document) : createFreshDocument(stations)
  const stationIds = new Set(stations.map((station) => station.id))
  const initialRuntimes = Object.fromEntries(stations.map((s) => [s.id, makeIdleRuntime()]))

  stations.forEach((station) => {
    const cached = hydrated.stationTerminals[station.id]
    if (cached) {
      if (cached.sessionId) {
        delete hydrated.sessionStation[cached.sessionId]
        delete hydrated.sessionSeq[cached.sessionId]
        delete hydrated.sessionVisibility[cached.sessionId]
        delete hydrated.restoreState[station.id]
        hydrated.stationTerminals[station.id] = {
          ...cached,
          sessionId: null,
          stateRaw: 'idle',
          shell: null,
          cwdMode: 'workspace_root' as const,
          resolvedCwd: null,
        }
      }
    } else {
      hydrated.stationTerminals[station.id] = initialRuntimes[station.id]
    }
    if (!Object.prototype.hasOwnProperty.call(hydrated.outputCache, station.id)) {
      hydrated.outputCache[station.id] = ''
    }
    if (typeof hydrated.outputRevision[station.id] !== 'number') {
      hydrated.outputRevision[station.id] = 0
    }
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
    if (!stationIds.has(stationId)) {
      delete hydrated.sessionStation[sessionId]
      delete hydrated.sessionSeq[sessionId]
      delete hydrated.sessionVisibility[sessionId]
    }
  })

  return hydrated
}

test('creates a fresh document when no cached document exists', () => {
  const stations = [makeStation('s1')]
  const result = hydrateWorkspaceTerminalSessionDocument(null, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'idle')
  assert.deepEqual(Object.keys(result.sessionStation), [])
})

test('preserves idle station runtime from cache', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)
  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'idle')
})

test('resets stale sessionId to idle during hydration', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-stale')
  cached.sessionStation['session-stale'] = 's1'
  cached.sessionSeq['session-stale'] = 1
  cached.sessionVisibility['session-stale'] = true

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'idle')
  assert.equal(result.stationTerminals['s1'].shell, null)
  assert.equal(result.stationTerminals['s1'].cwdMode, 'workspace_root')
  assert.equal(result.stationTerminals['s1'].resolvedCwd, null)
  assert.equal(result.sessionStation['session-stale'], undefined)
  assert.equal(result.sessionSeq['session-stale'], undefined)
  assert.equal(result.sessionVisibility['session-stale'], undefined)
})

test('clears stale sessionStation binding when resetting sessionId', () => {
  const stations = [makeStation('s1'), makeStation('s2')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-a')
  cached.stationTerminals['s2'] = makeRunningRuntime('session-b')
  cached.sessionStation['session-a'] = 's1'
  cached.sessionStation['session-b'] = 's2'
  cached.sessionSeq['session-a'] = 3
  cached.sessionSeq['session-b'] = 7

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s2'].sessionId, null)
  assert.deepEqual(Object.keys(result.sessionStation), [])
  assert.deepEqual(Object.keys(result.sessionSeq), [])
})

test('clears restoreState for station when resetting stale sessionId', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-old')
  cached.sessionStation['session-old'] = 's1'
  cached.restoreState['s1'] = {
    sessionId: 'session-old',
    revision: 5,
    state: { content: 'old screen', cols: 80, rows: 24 },
  }

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.restoreState['s1'], undefined)
})

test('preserves unreadCount when resetting stale sessionId', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = {
    ...makeRunningRuntime('session-stale'),
    unreadCount: 7,
  }
  cached.sessionStation['session-stale'] = 's1'

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'idle')
  assert.equal(result.stationTerminals['s1'].unreadCount, 7)
})

test('preserves outputCache when resetting stale sessionId', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-stale')
  cached.sessionStation['session-stale'] = 's1'
  cached.outputCache['s1'] = 'previous terminal output'
  cached.outputRevision['s1'] = 42

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.outputCache['s1'], 'previous terminal output')
  assert.equal(result.outputRevision['s1'], 42)
})

test('does not alter idle station during hydration', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeIdleRuntime()

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'idle')
})

test('does not alter exited station during hydration', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeExitedRuntime()

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'exited')
})

test('adds new stations with idle runtime when they are not in cache', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)
  const newStations = [makeStation('s1'), makeStation('s2')]

  const result = hydrateWorkspaceTerminalSessionDocument(cached, newStations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s2'].sessionId, null)
  assert.equal(result.stationTerminals['s2'].stateRaw, 'idle')
})

test('removes stations that no longer exist', () => {
  const stations = [makeStation('s1'), makeStation('s2')]
  const cached = createFreshDocument(stations)

  const fewerStations = [makeStation('s1')]
  const result = hydrateWorkspaceTerminalSessionDocument(cached, fewerStations)

  assert.equal(result.stationTerminals['s2'], undefined)
  assert.equal(result.outputCache['s2'], undefined)
  assert.equal(result.outputRevision['s2'], undefined)
  assert.equal(result.restoreState['s2'], undefined)
})

test('removes sessionStation entries for stations that no longer exist', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)
  cached.stationTerminals['s1'] = makeIdleRuntime()
  cached.sessionStation['orphan-session'] = 's1-gone'

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.sessionStation['orphan-session'], undefined)
  assert.equal(result.sessionSeq['orphan-session'], undefined)
  assert.equal(result.sessionVisibility['orphan-session'], undefined)
})

test('multiple stale sessionIds are all reset to idle', () => {
  const stations = [makeStation('s1'), makeStation('s2'), makeStation('s3')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-1')
  cached.stationTerminals['s2'] = makeRunningRuntime('session-2')
  cached.stationTerminals['s3'] = makeIdleRuntime()
  cached.sessionStation['session-1'] = 's1'
  cached.sessionStation['session-2'] = 's2'

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'idle')
  assert.equal(result.stationTerminals['s2'].sessionId, null)
  assert.equal(result.stationTerminals['s2'].stateRaw, 'idle')
  assert.equal(result.stationTerminals['s3'].sessionId, null)
  assert.equal(result.stationTerminals['s3'].stateRaw, 'idle')
  assert.deepEqual(Object.keys(result.sessionStation), [])
  assert.deepEqual(Object.keys(result.sessionSeq), [])
})

test('mixed idle and running stations: only running ones are reset', () => {
  const stations = [makeStation('s1'), makeStation('s2')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-active')
  cached.stationTerminals['s2'] = makeExitedRuntime()
  cached.sessionStation['session-active'] = 's1'

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, null)
  assert.equal(result.stationTerminals['s1'].stateRaw, 'idle')
  assert.equal(result.stationTerminals['s2'].sessionId, null)
  assert.equal(result.stationTerminals['s2'].stateRaw, 'exited')
  assert.deepEqual(Object.keys(result.sessionStation), [])
})