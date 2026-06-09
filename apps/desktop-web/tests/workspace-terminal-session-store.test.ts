import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentStation } from '../src/features/workspace-hub/station-model.js'
import type { StationTerminalRuntime } from '../src/shell/layout/ShellRoot.shared.js'
import { reconcileWorkspaceTerminalRestoredSessions } from '../src/shell/state/workspace-terminal-session-reconcile.js'

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

function normalizeWorkspaceTerminalDocumentCounter(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function hydrateWorkspaceTerminalSessionDocument(
  document: WorkspaceTerminalSessionDocument | null | undefined,
  stations: AgentStation[],
): WorkspaceTerminalSessionDocument {
  const hydrated = document ? cloneDocument(document) : createFreshDocument(stations)
  const stationIds = new Set(stations.map((station) => station.id))
  const initialRuntimes = Object.fromEntries(stations.map((s) => [s.id, makeIdleRuntime()]))
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
      hydrated.outputCache[station.id] = ''
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

test('preserves cached sessionId during hydration', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-live')
  cached.sessionStation['session-live'] = 's1'
  cached.sessionSeq['session-live'] = 1
  cached.sessionVisibility['session-live'] = true

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, 'session-live')
  assert.equal(result.stationTerminals['s1'].stateRaw, 'running')
  assert.equal(result.stationTerminals['s1'].shell, 'zsh')
  assert.equal(result.stationTerminals['s1'].cwdMode, 'workspace_root')
  assert.equal(result.stationTerminals['s1'].resolvedCwd, null)
  assert.equal(result.sessionStation['session-live'], 's1')
  assert.equal(result.sessionSeq['session-live'], 1)
  assert.equal(result.sessionVisibility['session-live'], true)
})

test('preserves multiple cached sessionStation bindings during hydration', () => {
  const stations = [makeStation('s1'), makeStation('s2')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-a')
  cached.stationTerminals['s2'] = makeRunningRuntime('session-b')
  cached.sessionStation['session-a'] = 's1'
  cached.sessionStation['session-b'] = 's2'
  cached.sessionSeq['session-a'] = 3
  cached.sessionSeq['session-b'] = 7

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, 'session-a')
  assert.equal(result.stationTerminals['s2'].sessionId, 'session-b')
  assert.deepEqual(result.sessionStation, {
    'session-a': 's1',
    'session-b': 's2',
  })
  assert.deepEqual(result.sessionSeq, {
    'session-a': 3,
    'session-b': 7,
  })
})

test('normalizes cached session sequence values during hydration', () => {
  const stations = [makeStation('s1'), makeStation('s2'), makeStation('s3')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-nan')
  cached.stationTerminals['s2'] = makeRunningRuntime('session-fractional')
  cached.stationTerminals['s3'] = makeRunningRuntime('session-negative')
  cached.sessionStation['session-nan'] = 's1'
  cached.sessionStation['session-fractional'] = 's2'
  cached.sessionStation['session-negative'] = 's3'
  cached.sessionSeq['session-nan'] = Number.NaN
  cached.sessionSeq['session-fractional'] = 8.9
  cached.sessionSeq['session-negative'] = -4

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.deepEqual(result.sessionSeq, {
    'session-nan': 0,
    'session-fractional': 8,
    'session-negative': 0,
  })
})

test('preserves restoreState for station with active session', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-live')
  cached.sessionStation['session-live'] = 's1'
  cached.restoreState['s1'] = {
    sessionId: 'session-live',
    revision: 5,
    state: { content: 'old screen', cols: 80, rows: 24 },
  }

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, 'session-live')
  assert.deepEqual(result.restoreState['s1'], cached.restoreState['s1'])
})

test('preserves unreadCount for active session', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = {
    ...makeRunningRuntime('session-live'),
    unreadCount: 7,
  }
  cached.sessionStation['session-live'] = 's1'

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, 'session-live')
  assert.equal(result.stationTerminals['s1'].stateRaw, 'running')
  assert.equal(result.stationTerminals['s1'].unreadCount, 7)
})

test('preserves outputCache for active session', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-live')
  cached.sessionStation['session-live'] = 's1'
  cached.outputCache['s1'] = 'previous terminal output'
  cached.outputRevision['s1'] = 42

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, 'session-live')
  assert.equal(result.outputCache['s1'], 'previous terminal output')
  assert.equal(result.outputRevision['s1'], 42)
})

test('normalizes cached output revisions during hydration', () => {
  const stations = [makeStation('s1'), makeStation('s2'), makeStation('s3')]
  const cached = createFreshDocument(stations)

  cached.outputRevision['s1'] = Number.NaN
  cached.outputRevision['s2'] = 12.7
  cached.outputRevision['s3'] = -3

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.deepEqual(result.outputRevision, {
    s1: 0,
    s2: 12,
    s3: 0,
  })
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

test('multiple cached sessionIds are all preserved', () => {
  const stations = [makeStation('s1'), makeStation('s2'), makeStation('s3')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-1')
  cached.stationTerminals['s2'] = makeRunningRuntime('session-2')
  cached.stationTerminals['s3'] = makeIdleRuntime()
  cached.sessionStation['session-1'] = 's1'
  cached.sessionStation['session-2'] = 's2'

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, 'session-1')
  assert.equal(result.stationTerminals['s1'].stateRaw, 'running')
  assert.equal(result.stationTerminals['s2'].sessionId, 'session-2')
  assert.equal(result.stationTerminals['s2'].stateRaw, 'running')
  assert.equal(result.stationTerminals['s3'].sessionId, null)
  assert.equal(result.stationTerminals['s3'].stateRaw, 'idle')
  assert.deepEqual(result.sessionStation, {
    'session-1': 's1',
    'session-2': 's2',
  })
  assert.deepEqual(result.sessionSeq, {
    'session-1': 0,
    'session-2': 0,
  })
})

test('mixed idle and running stations: running ones are preserved', () => {
  const stations = [makeStation('s1'), makeStation('s2')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-active')
  cached.stationTerminals['s2'] = makeExitedRuntime()
  cached.sessionStation['session-active'] = 's1'

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.stationTerminals['s1'].sessionId, 'session-active')
  assert.equal(result.stationTerminals['s1'].stateRaw, 'running')
  assert.equal(result.stationTerminals['s2'].sessionId, null)
  assert.equal(result.stationTerminals['s2'].stateRaw, 'exited')
  assert.deepEqual(result.sessionStation, {
    'session-active': 's1',
  })
})

test('restores missing session metadata for cached running session', () => {
  const stations = [makeStation('s1')]
  const cached = createFreshDocument(stations)

  cached.stationTerminals['s1'] = makeRunningRuntime('session-live')

  const result = hydrateWorkspaceTerminalSessionDocument(cached, stations)

  assert.equal(result.sessionStation['session-live'], 's1')
  assert.equal(result.sessionSeq['session-live'], 0)
  assert.equal(result.sessionVisibility['session-live'], false)
})

test('restore reconciliation keeps only live sessions after app relaunch', () => {
  const stations = [makeStation('s1'), makeStation('s2')]
  const document = createFreshDocument(stations)

  reconcileWorkspaceTerminalRestoredSessions(
    document,
    [
      {
        stationId: 's1',
        sessionId: 'session-live',
        shell: '/bin/zsh',
        cwdMode: 'custom',
        resolvedCwd: '/tmp/project',
        active: true,
      },
      {
        stationId: 's2',
        sessionId: 'session-stale',
        shell: '/bin/zsh',
        cwdMode: 'workspace_root',
        resolvedCwd: null,
        active: false,
      },
    ],
    new Set(['session-live']),
  )

  assert.deepEqual(document.stationTerminals['s1'], {
    sessionId: 'session-live',
    stateRaw: 'running',
    unreadCount: 0,
    shell: '/bin/zsh',
    cwdMode: 'custom',
    resolvedCwd: '/tmp/project',
  })
  assert.deepEqual(document.stationTerminals['s2'], makeIdleRuntime())
  assert.deepEqual(document.sessionStation, {
    'session-live': 's1',
  })
  assert.deepEqual(document.sessionSeq, {
    'session-live': 0,
  })
  assert.deepEqual(document.sessionVisibility, {
    'session-live': false,
  })
})

test('restore reconciliation clears cached stale bindings back to idle', () => {
  const stations = [makeStation('s1')]
  const document = createFreshDocument(stations)

  document.stationTerminals['s1'] = {
    ...makeRunningRuntime('session-stale'),
    unreadCount: 4,
  }
  document.sessionStation['session-stale'] = 's1'
  document.sessionSeq['session-stale'] = 9
  document.sessionVisibility['session-stale'] = true
  document.restoreState['s1'] = {
    sessionId: 'session-stale',
    revision: 3,
    state: { content: 'old output', cols: 80, rows: 24 },
  }

  reconcileWorkspaceTerminalRestoredSessions(
    document,
    [
      {
        stationId: 's1',
        sessionId: 'session-stale',
        shell: '/bin/zsh',
        cwdMode: 'workspace_root',
        resolvedCwd: null,
        active: true,
      },
    ],
    new Set(),
  )

  assert.deepEqual(document.stationTerminals['s1'], {
    sessionId: null,
    stateRaw: 'idle',
    unreadCount: 4,
    shell: null,
    cwdMode: 'workspace_root',
    resolvedCwd: null,
  })
  assert.equal(document.sessionStation['session-stale'], undefined)
  assert.equal(document.sessionSeq['session-stale'], undefined)
  assert.equal(document.sessionVisibility['session-stale'], undefined)
  assert.equal(document.restoreState['s1'], undefined)
})
