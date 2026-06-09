import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStationTerminalCachedOutputQueueKey,
  queueStationTerminalCachedOutputAppend,
  STATION_TERMINAL_CACHED_OUTPUT_PENDING_BASE64_CHAR_LIMIT,
  STATION_TERMINAL_CACHED_OUTPUT_PENDING_CHUNK_LIMIT,
  STATION_TERMINAL_CACHED_OUTPUT_PENDING_QUEUE_KEY_LIMIT,
  type StationTerminalCachedOutputAppendQueue,
} from '../src/features/terminal/station-terminal-cached-output-queue.js'

test('cached terminal output queue ignores empty work', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}

  assert.deepEqual(
    queueStationTerminalCachedOutputAppend(queue, {
      workspaceId: 'workspace-1',
      stationId: 'station-1',
      sessionId: 'session-1',
    }),
    {
      queued: false,
      shouldFlush: false,
      queueKey: null,
    },
  )
  assert.deepEqual(queue, {})
})

test('cached terminal output queue accumulates unread-only deltas', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}

  const result = queueStationTerminalCachedOutputAppend(queue, {
    workspaceId: 'workspace-1',
    stationId: 'station-1',
    sessionId: 'session-1',
    unreadDelta: 1000,
  })

  assert.equal(result.queued, true)
  assert.equal(result.shouldFlush, false)
  assert.deepEqual(queue[result.queueKey ?? ''], {
    workspaceId: 'workspace-1',
    stationId: 'station-1',
    sessionId: 'session-1',
    base64Chunks: [],
    encodedLength: 0,
    unreadDelta: 999,
  })
})

test('cached terminal output queue requests flush at the chunk count limit', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}
  let result = queueStationTerminalCachedOutputAppend(queue, {
    workspaceId: 'workspace-1',
    stationId: 'station-1',
    sessionId: 'session-1',
    base64Chunk: 'YQ==',
  })

  for (let index = 1; index < STATION_TERMINAL_CACHED_OUTPUT_PENDING_CHUNK_LIMIT; index += 1) {
    result = queueStationTerminalCachedOutputAppend(queue, {
      workspaceId: 'workspace-1',
      stationId: 'station-1',
      sessionId: 'session-1',
      base64Chunk: 'YQ==',
    })
  }

  assert.equal(result.queued, true)
  assert.equal(result.shouldFlush, true)
  assert.equal(queue[result.queueKey ?? '']?.base64Chunks.length, STATION_TERMINAL_CACHED_OUTPUT_PENDING_CHUNK_LIMIT)
})

test('cached terminal output queue requests flush at the encoded length limit', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}
  const result = queueStationTerminalCachedOutputAppend(queue, {
    workspaceId: 'workspace-1',
    stationId: 'station-1',
    sessionId: 'session-1',
    base64Chunk: 'A'.repeat(STATION_TERMINAL_CACHED_OUTPUT_PENDING_BASE64_CHAR_LIMIT),
  })

  assert.equal(result.queued, true)
  assert.equal(result.shouldFlush, true)
  assert.equal(
    queue[result.queueKey ?? '']?.encodedLength,
    STATION_TERMINAL_CACHED_OUTPUT_PENDING_BASE64_CHAR_LIMIT,
  )
})

test('cached terminal output queue bounds pending session keys before persistence work grows unbounded', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}

  for (let index = 0; index <= STATION_TERMINAL_CACHED_OUTPUT_PENDING_QUEUE_KEY_LIMIT + 3; index += 1) {
    const result = queueStationTerminalCachedOutputAppend(queue, {
      workspaceId: 'workspace-1',
      stationId: `station-${index}`,
      sessionId: `session-${index}`,
      base64Chunk: `${index}`,
    })
    assert.equal(result.queued, true)
  }

  assert.equal(Object.keys(queue).length, STATION_TERMINAL_CACHED_OUTPUT_PENDING_QUEUE_KEY_LIMIT)
  assert.equal(
    queue[buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-0', 'session-0')],
    undefined,
  )
  assert.equal(
    queue[buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-4', 'session-4')]?.base64Chunks[0],
    '4',
  )
})

test('cached terminal output queue preserves protected active key when evicting stale background work', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}
  const activeKey = buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-active', 'session-active')

  queueStationTerminalCachedOutputAppend(
    queue,
    {
      workspaceId: 'workspace-1',
      stationId: 'station-active',
      sessionId: 'session-active',
      base64Chunk: 'active',
    },
    { queueKeyLimit: 2, protectedQueueKey: activeKey },
  )
  queueStationTerminalCachedOutputAppend(
    queue,
    {
      workspaceId: 'workspace-1',
      stationId: 'station-bg-1',
      sessionId: 'session-bg-1',
      base64Chunk: 'background one',
    },
    { queueKeyLimit: 2, protectedQueueKey: activeKey },
  )
  queueStationTerminalCachedOutputAppend(
    queue,
    {
      workspaceId: 'workspace-1',
      stationId: 'station-bg-2',
      sessionId: 'session-bg-2',
      base64Chunk: 'background two',
    },
    { queueKeyLimit: 2, protectedQueueKey: activeKey },
  )

  assert.equal(queue[activeKey]?.base64Chunks[0], 'active')
  assert.equal(
    queue[buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-bg-1', 'session-bg-1')],
    undefined,
  )
  assert.equal(
    queue[buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-bg-2', 'session-bg-2')]?.base64Chunks[0],
    'background two',
  )
})

test('cached terminal output queue refuses new background key instead of evicting protected active key', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}
  const activeKey = buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-active', 'session-active')

  assert.equal(
    queueStationTerminalCachedOutputAppend(
      queue,
      {
        workspaceId: 'workspace-1',
        stationId: 'station-active',
        sessionId: 'session-active',
        base64Chunk: 'active',
      },
      { queueKeyLimit: 1, protectedQueueKey: activeKey },
    ).queued,
    true,
  )

  const rejected = queueStationTerminalCachedOutputAppend(
    queue,
    {
      workspaceId: 'workspace-1',
      stationId: 'station-bg',
      sessionId: 'session-bg',
      base64Chunk: 'background',
    },
    { queueKeyLimit: 1, protectedQueueKey: activeKey },
  )

  assert.equal(rejected.queued, false)
  assert.equal(rejected.queueKey, buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-bg', 'session-bg'))
  assert.deepEqual(Object.keys(queue), [activeKey])
  assert.equal(queue[activeKey]?.base64Chunks[0], 'active')
})

test('cached terminal output queue rejects new keys when the key limit is exhausted', () => {
  const queue: StationTerminalCachedOutputAppendQueue = {}

  const rejected = queueStationTerminalCachedOutputAppend(
    queue,
    {
      workspaceId: 'workspace-1',
      stationId: 'station-1',
      sessionId: 'session-1',
      base64Chunk: 'one',
    },
    { queueKeyLimit: 0 },
  )
  assert.equal(rejected.queued, false)
  assert.deepEqual(queue, {})

  const queued = queueStationTerminalCachedOutputAppend(
    queue,
    {
      workspaceId: 'workspace-1',
      stationId: 'station-1',
      sessionId: 'session-1',
      base64Chunk: 'one',
    },
    { queueKeyLimit: 1 },
  )
  assert.equal(queued.queued, true)

  const nanLimitRejected = queueStationTerminalCachedOutputAppend(
    queue,
    {
      workspaceId: 'workspace-1',
      stationId: 'station-2',
      sessionId: 'session-2',
      base64Chunk: 'two',
    },
    { queueKeyLimit: Number.NaN },
  )
  assert.equal(nanLimitRejected.queued, false)
  assert.deepEqual(Object.keys(queue), [
    buildStationTerminalCachedOutputQueueKey('workspace-1', 'station-1', 'session-1'),
  ])
})
