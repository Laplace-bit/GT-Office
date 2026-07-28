import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeStationTerminalRuntimesForPresentation,
  resolveStationTerminalRuntimeForPresentation,
} from '../src/shell/state/station-terminal-runtime-presentation.js'
import {
  parkStationTerminalHost,
  disposeAllParkedStationTerminalHosts,
  peekParkedStationTerminalHost,
  type StationTerminalHostPool,
} from '../src/features/terminal/station-terminal-host-pool.js'

function seedParkedHost(sessionId: string) {
  disposeAllParkedStationTerminalHosts()
  parkStationTerminalHost({
    workspaceId: 'ws-1',
    stationId: 'station-a',
    sessionId,
    terminal: { dispose: () => {} } as never,
    fitAddon: { fit: () => {} },
    serializeAddon: { serialize: () => '' },
    webglAddon: null,
    surface: {
      parentElement: null,
      remove: () => {},
    } as unknown as HTMLDivElement,
    sink: null,
  })
}

test('prefers live renderable runtime over cache', () => {
  const resolved = resolveStationTerminalRuntimeForPresentation({
    stationId: 'station-a',
    workspaceId: 'ws-1',
    liveRuntime: {
      sessionId: 'live-1',
      stateRaw: 'running',
      unreadCount: 0,
      shell: 'zsh',
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
    cachedRuntime: {
      sessionId: 'cached-1',
      stateRaw: 'running',
      unreadCount: 2,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
  })
  assert.equal(resolved.sessionId, 'live-1')
})

test('falls back to cached live runtime when live state is idle', () => {
  const resolved = resolveStationTerminalRuntimeForPresentation({
    stationId: 'station-a',
    workspaceId: 'ws-1',
    liveRuntime: {
      sessionId: null,
      stateRaw: 'idle',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
    cachedRuntime: {
      sessionId: 'cached-1',
      stateRaw: 'running',
      unreadCount: 1,
      shell: 'zsh',
      cwdMode: 'custom',
      resolvedCwd: '/tmp',
    },
  })
  assert.equal(resolved.sessionId, 'cached-1')
  assert.equal(resolved.stateRaw, 'running')
  assert.equal(resolved.resolvedCwd, '/tmp')
})

test('reclaims matching parked host when cache still owns the session', () => {
  seedParkedHost('parked-session')

  const resolved = resolveStationTerminalRuntimeForPresentation({
    stationId: 'station-a',
    workspaceId: 'ws-1',
    liveRuntime: {
      sessionId: null,
      stateRaw: 'idle',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
    cachedRuntime: {
      sessionId: 'parked-session',
      stateRaw: 'running',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
  })
  assert.equal(resolved.sessionId, 'parked-session')
  assert.equal(resolved.stateRaw, 'running')
  disposeAllParkedStationTerminalHosts()
})

test('does not resurrect parked host after intentional close (history surface)', () => {
  seedParkedHost('dead-session')

  const resolved = resolveStationTerminalRuntimeForPresentation({
    stationId: 'station-a',
    workspaceId: 'ws-1',
    liveRuntime: {
      sessionId: null,
      stateRaw: 'idle',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
    cachedRuntime: {
      sessionId: null,
      stateRaw: 'idle',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
  })

  assert.equal(resolved.sessionId, null)
  assert.equal(resolved.stateRaw, 'idle')
  assert.equal(peekParkedStationTerminalHost('ws-1', 'station-a'), null)
  disposeAllParkedStationTerminalHosts()
})

test('does not invent a live terminal from a parked host with no expected session', () => {
  seedParkedHost('parked-session')

  const resolved = resolveStationTerminalRuntimeForPresentation({
    stationId: 'station-a',
    workspaceId: 'ws-1',
    liveRuntime: undefined,
    cachedRuntime: null,
  })
  // Without any expected session binding, a parked host is stale and must not
  // invent a live terminal over the idle/history surface.
  assert.equal(resolved.sessionId, null)
  assert.equal(resolved.stateRaw, 'idle')
  assert.equal(peekParkedStationTerminalHost('ws-1', 'station-a'), null)
  disposeAllParkedStationTerminalHosts()
})

test('normalizes closed cache chrome without a session to history idle', () => {
  const resolved = resolveStationTerminalRuntimeForPresentation({
    stationId: 'station-a',
    workspaceId: 'ws-1',
    liveRuntime: undefined,
    cachedRuntime: {
      sessionId: null,
      stateRaw: 'killed',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
  })
  assert.equal(resolved.sessionId, null)
  assert.equal(resolved.stateRaw, 'idle')
})

test('merge keeps every station renderable from cache during workspace switch', () => {
  const merged = mergeStationTerminalRuntimesForPresentation({
    stations: [{ id: 'station-a' }, { id: 'station-b' }],
    liveRuntimes: {},
    workspaceId: 'ws-1',
    cachedDocument: {
      stationTerminals: {
        'station-a': {
          sessionId: 's-a',
          stateRaw: 'running',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        },
        'station-b': {
          sessionId: 's-b',
          stateRaw: 'running',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        },
      },
      outputCache: {},
      outputRevision: {},
      restoreState: {},
      sessionStation: { 's-a': 'station-a', 's-b': 'station-b' },
      sessionSeq: {},
      sessionVisibility: {},
    },
  })
  assert.equal(merged['station-a']?.sessionId, 's-a')
  assert.equal(merged['station-b']?.sessionId, 's-b')
})

// silence unused pool type import helper if tree-shaken
void (null as unknown as StationTerminalHostPool)
