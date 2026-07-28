import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStationTerminalHostPoolKey,
  disposeAllParkedStationTerminalHosts,
  disposeParkedStationTerminalHost,
  disposeParkedStationTerminalHostsForWorkspace,
  listParkedStationTerminalHostKeys,
  parkStationTerminalHost,
  peekParkedStationTerminalHost,
  reclaimStationTerminalHost,
  shouldPreserveStationTerminalLiveBuffer,
  type ParkedStationTerminalHost,
  type StationTerminalHostPool,
} from '../src/features/terminal/station-terminal-host-pool.js'

function createMockSurface(): HTMLDivElement {
  const surface = {
    className: '',
    parentElement: null as { removeChild: (node: unknown) => void } | null,
    setAttribute: () => {},
    remove: () => {
      if (surface.parentElement) {
        surface.parentElement.removeChild(surface)
        surface.parentElement = null
      }
    },
  }
  return surface as unknown as HTMLDivElement
}

function createMockTerminalHost(
  overrides: Partial<ParkedStationTerminalHost> &
    Pick<ParkedStationTerminalHost, 'workspaceId' | 'stationId' | 'sessionId'>,
): Omit<ParkedStationTerminalHost, 'parkedAtMs' | 'key'> {
  let disposed = false
  return {
    workspaceId: overrides.workspaceId,
    stationId: overrides.stationId,
    sessionId: overrides.sessionId,
    terminal: {
      dispose: () => {
        disposed = true
      },
      __disposed: () => disposed,
    } as unknown as ParkedStationTerminalHost['terminal'],
    fitAddon: { fit: () => {} },
    serializeAddon: { serialize: () => 'serialized' },
    webglAddon: overrides.webglAddon ?? null,
    surface: overrides.surface ?? createMockSurface(),
    sink: overrides.sink ?? {
      write: async () => {},
      reset: async () => {},
      restore: async () => {},
      focus: () => {},
      submit: () => false,
    },
  }
}

test('buildStationTerminalHostPoolKey requires workspace and station ids', () => {
  assert.equal(buildStationTerminalHostPoolKey('ws-1', 'station-a'), 'ws-1::station-a')
  assert.equal(buildStationTerminalHostPoolKey('  ws-1  ', '  station-a  '), 'ws-1::station-a')
  assert.equal(buildStationTerminalHostPoolKey('', 'station-a'), null)
  assert.equal(buildStationTerminalHostPoolKey('ws-1', null), null)
})

test('park and reclaim preserve the live host for matching session identity', () => {
  const pool: StationTerminalHostPool = new Map()
  const host = createMockTerminalHost({
    workspaceId: 'ws-1',
    stationId: 'station-a',
    sessionId: 'session-1',
  })

  const parked = parkStationTerminalHost(host, pool)
  assert.ok(parked)
  assert.deepEqual(listParkedStationTerminalHostKeys(pool), ['ws-1::station-a'])
  assert.equal(peekParkedStationTerminalHost('ws-1', 'station-a', pool)?.sessionId, 'session-1')

  const reclaimed = reclaimStationTerminalHost('ws-1', 'station-a', 'session-1', pool)
  assert.ok(reclaimed)
  assert.equal(reclaimed.sessionId, 'session-1')
  assert.equal(reclaimed.terminal, host.terminal)
  assert.deepEqual(listParkedStationTerminalHostKeys(pool), [])
})

test('reclaim disposes parked host when session identity no longer matches', () => {
  const pool: StationTerminalHostPool = new Map()
  const host = createMockTerminalHost({
    workspaceId: 'ws-1',
    stationId: 'station-a',
    sessionId: 'session-1',
  })
  parkStationTerminalHost(host, pool)

  const reclaimed = reclaimStationTerminalHost('ws-1', 'station-a', 'session-2', pool)
  assert.equal(reclaimed, null)
  assert.deepEqual(listParkedStationTerminalHostKeys(pool), [])
  assert.equal(
    (host.terminal as unknown as { __disposed: () => boolean }).__disposed(),
    true,
  )
})

test('dispose helpers clear workspace-scoped and global parked hosts', () => {
  const pool: StationTerminalHostPool = new Map()
  parkStationTerminalHost(
    createMockTerminalHost({
      workspaceId: 'ws-1',
      stationId: 'station-a',
      sessionId: 'session-1',
    }),
    pool,
  )
  parkStationTerminalHost(
    createMockTerminalHost({
      workspaceId: 'ws-1',
      stationId: 'station-b',
      sessionId: 'session-2',
    }),
    pool,
  )
  parkStationTerminalHost(
    createMockTerminalHost({
      workspaceId: 'ws-2',
      stationId: 'station-a',
      sessionId: 'session-3',
    }),
    pool,
  )

  assert.equal(disposeParkedStationTerminalHost('ws-1', 'station-a', pool), true)
  assert.equal(disposeParkedStationTerminalHostsForWorkspace('ws-1', pool), 1)
  assert.equal(disposeAllParkedStationTerminalHosts(pool), 1)
  assert.deepEqual(listParkedStationTerminalHostKeys(pool), [])
})

test('preserveLiveBuffer is recognized for reclaimed sink rebinds', () => {
  const sinkA = { id: 'a' }
  const sinkB = { id: 'b' }
  assert.equal(
    shouldPreserveStationTerminalLiveBuffer({
      preserveLiveBuffer: true,
      previousSink: null,
      nextSink: sinkB,
    }),
    true,
  )
  assert.equal(
    shouldPreserveStationTerminalLiveBuffer({
      preserveLiveBuffer: true,
      previousSink: sinkA,
      nextSink: sinkB,
    }),
    true,
  )
  assert.equal(
    shouldPreserveStationTerminalLiveBuffer({
      preserveLiveBuffer: false,
      previousSink: null,
      nextSink: sinkB,
    }),
    false,
  )
  assert.equal(
    shouldPreserveStationTerminalLiveBuffer({
      preserveLiveBuffer: true,
      previousSink: null,
      nextSink: null,
    }),
    false,
  )
})
