import test from 'node:test'
import assert from 'node:assert/strict'
import {
  queueStationTerminalOutputFlush,
  STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT,
  STATION_TERMINAL_OUTPUT_FLUSH_BACKGROUND_CHAR_LIMIT,
  STATION_TERMINAL_OUTPUT_FLUSH_PENDING_CHUNK_LIMIT,
  STATION_TERMINAL_OUTPUT_FLUSH_PENDING_STATION_LIMIT,
  takeStationTerminalOutputFlushFrameEntries,
  takeStationTerminalOutputFlushEntries,
  type StationTerminalOutputFlushQueue,
} from '../src/features/terminal/station-terminal-output-flush.js'

test('coalesces repeated terminal output for one station into one flush entry', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', 'alpha'), true)
  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', 'beta'), true)
  assert.deepEqual(queue['station-1']?.chunks, ['alpha', 'beta'])
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-1',
      chunk: 'alphabeta',
      unreadDelta: 2,
    },
  ])
  assert.deepEqual(queue, {})
})

test('normalizes queued terminal output station ids and ignores blank station ids', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(queueStationTerminalOutputFlush(queue, '', 'ignored'), false)
  assert.equal(queueStationTerminalOutputFlush(queue, '   ', 'also ignored'), false)
  assert.equal(queueStationTerminalOutputFlush(queue, ' station-1 ', 'alpha'), true)
  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', 'beta'), true)

  assert.deepEqual(Object.keys(queue), ['station-1'])
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-1',
      chunk: 'alphabeta',
      unreadDelta: 2,
    },
  ])
})

test('targeted terminal output drain normalizes station ids without clearing all output for blank targets', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-1', 'one')
  queueStationTerminalOutputFlush(queue, 'station-2', 'two')

  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue, ' station-1 '), [
    {
      stationId: 'station-1',
      chunk: 'one',
      unreadDelta: 1,
    },
  ])
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue, '   '), [])
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-2',
      chunk: 'two',
      unreadDelta: 1,
    },
  ])
})

test('bounds pending terminal output fragments before flush entries are taken', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  for (let index = 0; index < 100; index += 1) {
    assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', String(index % 10), 0), true)
  }

  assert.ok((queue['station-1']?.chunks.length ?? 0) <= STATION_TERMINAL_OUTPUT_FLUSH_PENDING_CHUNK_LIMIT)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-1',
      chunk: '0123456789'.repeat(10),
      unreadDelta: 0,
    },
  ])
  assert.deepEqual(queue, {})
})

test('keeps station output batches isolated until each station is flushed', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-1', 'one')
  queueStationTerminalOutputFlush(queue, 'station-2', 'two')
  queueStationTerminalOutputFlush(queue, 'station-1', ' again')

  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue, 'station-1'), [
    {
      stationId: 'station-1',
      chunk: 'one again',
      unreadDelta: 2,
    },
  ])
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-2',
      chunk: 'two',
      unreadDelta: 1,
    },
  ])
})

test('bounds queued terminal output station keys before React flush work grows unbounded', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  for (let index = 0; index <= STATION_TERMINAL_OUTPUT_FLUSH_PENDING_STATION_LIMIT + 3; index += 1) {
    assert.equal(queueStationTerminalOutputFlush(queue, `station-${index}`, `${index}`), true)
  }

  assert.equal(Object.keys(queue).length, STATION_TERMINAL_OUTPUT_FLUSH_PENDING_STATION_LIMIT)
  assert.equal(queue['station-0'], undefined)
  assert.equal(queue['station-4']?.chunks[0], '4')
})

test('queued terminal output station limit preserves the active station backlog when evicting background work', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-active', 'active', 1, {
    stationLimit: 2,
    protectedStationId: 'station-active',
  })
  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'background one', 1, {
    stationLimit: 2,
    protectedStationId: 'station-active',
  })
  queueStationTerminalOutputFlush(queue, 'station-bg-2', 'background two', 1, {
    stationLimit: 2,
    protectedStationId: 'station-active',
  })

  assert.equal(queue['station-active']?.chunks[0], 'active')
  assert.equal(queue['station-bg-1'], undefined)
  assert.equal(queue['station-bg-2']?.chunks[0], 'background two')
})

test('queued terminal output station limit refuses background work instead of evicting protected active output', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(
    queueStationTerminalOutputFlush(queue, 'station-active', 'active', 1, {
      stationLimit: 1,
      protectedStationId: 'station-active',
    }),
    true,
  )
  assert.equal(
    queueStationTerminalOutputFlush(queue, 'station-bg', 'background', 1, {
      stationLimit: 1,
      protectedStationId: 'station-active',
    }),
    false,
  )

  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-active',
      chunk: 'active',
      unreadDelta: 1,
    },
  ])
})

test('queued terminal output rejects new stations when the station limit is exhausted', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', 'one', 1, { stationLimit: 0 }), false)
  assert.deepEqual(queue, {})

  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', 'one', 1, { stationLimit: 1 }), true)
  assert.equal(queueStationTerminalOutputFlush(queue, 'station-2', 'two', 1, { stationLimit: Number.NaN }), false)
  assert.deepEqual(Object.keys(queue), ['station-1'])
})

test('flush frame prioritizes the active station and defers background station output', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'background one')
  queueStationTerminalOutputFlush(queue, 'station-active', 'active one')
  queueStationTerminalOutputFlush(queue, 'station-bg-2', 'background two')
  queueStationTerminalOutputFlush(queue, 'station-active', ' active two')

  const frame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: false,
  })

  assert.deepEqual(frame.entries, [
    {
      stationId: 'station-active',
      chunk: 'active one active two',
      unreadDelta: 2,
    },
  ])
  assert.equal(frame.hasDeferredActive, false)
  assert.equal(frame.hasDeferredBackground, true)
  assert.deepEqual(Object.keys(queue).sort(), ['station-bg-1', 'station-bg-2'])
})

test('flush frame can skip active output while draining only background stations', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-active', 'active backlog', 2)
  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'background one')
  queueStationTerminalOutputFlush(queue, 'station-bg-2', 'background two')

  const frame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeActive: false,
    includeBackground: true,
    backgroundEntryLimit: 2,
  })

  assert.deepEqual(frame.entries, [
    {
      stationId: 'station-bg-1',
      chunk: 'background one',
      unreadDelta: 1,
    },
    {
      stationId: 'station-bg-2',
      chunk: 'background two',
      unreadDelta: 1,
    },
  ])
  assert.equal(frame.hasDeferredActive, true)
  assert.equal(frame.hasDeferredBackground, false)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-active',
      chunk: 'active backlog',
      unreadDelta: 2,
    },
  ])
})

test('flush frame keeps active output enabled by default when draining background stations', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-active', 'active backlog', 2)
  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'background one')

  const frame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 1,
  })

  assert.deepEqual(frame.entries, [
    {
      stationId: 'station-active',
      chunk: 'active backlog',
      unreadDelta: 2,
    },
    {
      stationId: 'station-bg-1',
      chunk: 'background one',
      unreadDelta: 1,
    },
  ])
  assert.equal(frame.hasDeferredActive, false)
  assert.equal(frame.hasDeferredBackground, false)
  assert.deepEqual(queue, {})
})

test('active flush frame respects the character budget and drains overflow on later frames', () => {
  const queue: StationTerminalOutputFlushQueue = {}
  const oversizedChunk = 'a'.repeat(STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT + 5)

  queueStationTerminalOutputFlush(queue, 'station-active', oversizedChunk, 4)

  const firstFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    activeCharLimit: STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT,
    includeBackground: false,
  })

  assert.deepEqual(firstFrame.entries, [
    {
      stationId: 'station-active',
      chunk: 'a'.repeat(STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT),
      unreadDelta: 4,
    },
  ])
  assert.equal(firstFrame.hasDeferredActive, true)
  assert.equal(firstFrame.hasDeferredBackground, false)

  const secondFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    activeCharLimit: STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT,
    includeBackground: false,
  })

  assert.deepEqual(secondFrame.entries, [
    {
      stationId: 'station-active',
      chunk: 'a'.repeat(5),
      unreadDelta: 0,
    },
  ])
  assert.equal(secondFrame.hasDeferredActive, false)
  assert.deepEqual(queue, {})
})

test('active flush frame defers output when the frame character budget is exhausted', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-active', 'deferred active output', 2)

  const exhaustedFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    activeCharLimit: 0,
    includeBackground: false,
  })

  assert.deepEqual(exhaustedFrame.entries, [])
  assert.equal(exhaustedFrame.hasDeferredActive, true)
  assert.equal(exhaustedFrame.hasDeferredBackground, false)

  const nextFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    activeCharLimit: 1024,
    includeBackground: false,
  })

  assert.deepEqual(nextFrame.entries, [
    {
      stationId: 'station-active',
      chunk: 'deferred active output',
      unreadDelta: 2,
    },
  ])
  assert.equal(nextFrame.hasDeferredActive, false)
  assert.deepEqual(queue, {})
})

test('active flush frame treats invalid character budgets as exhausted', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-active', 'deferred invalid budget output', 2)

  const invalidFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    activeCharLimit: Number.NaN,
    includeBackground: false,
  })

  assert.deepEqual(invalidFrame.entries, [])
  assert.equal(invalidFrame.hasDeferredActive, true)
  assert.equal(invalidFrame.hasDeferredBackground, false)

  const nextFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    activeCharLimit: Number.POSITIVE_INFINITY,
    includeBackground: false,
  })

  assert.deepEqual(nextFrame.entries, [
    {
      stationId: 'station-active',
      chunk: 'deferred invalid budget output',
      unreadDelta: 2,
    },
  ])
  assert.equal(nextFrame.hasDeferredActive, false)
  assert.deepEqual(queue, {})
})

test('active flush frame splits by code point without breaking emoji', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-active', 'a🙂b', 1)

  const frame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    activeCharLimit: 2,
    includeBackground: false,
  })

  assert.deepEqual(frame.entries, [
    {
      stationId: 'station-active',
      chunk: 'a🙂',
      unreadDelta: 1,
    },
  ])
  assert.equal(frame.hasDeferredActive, true)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-active',
      chunk: 'b',
      unreadDelta: 0,
    },
  ])
})

test('background flush frame takes a bounded number of stations per pass', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'one')
  queueStationTerminalOutputFlush(queue, 'station-bg-2', 'two')
  queueStationTerminalOutputFlush(queue, 'station-bg-3', 'three')

  const frame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 2,
  })

  assert.deepEqual(frame.entries.map((entry) => entry.stationId), ['station-bg-1', 'station-bg-2'])
  assert.equal(frame.hasDeferredBackground, true)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-bg-3',
      chunk: 'three',
      unreadDelta: 1,
    },
  ])
})

test('background flush frame respects the character budget and leaves overflow queued', () => {
  const queue: StationTerminalOutputFlushQueue = {}
  const oversizedChunk = 'a'.repeat(STATION_TERMINAL_OUTPUT_FLUSH_BACKGROUND_CHAR_LIMIT + 8)

  queueStationTerminalOutputFlush(queue, 'station-bg-1', oversizedChunk, 3)
  queueStationTerminalOutputFlush(queue, 'station-bg-2', 'deferred')

  const frame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 2,
    backgroundCharLimit: STATION_TERMINAL_OUTPUT_FLUSH_BACKGROUND_CHAR_LIMIT,
  })

  assert.deepEqual(frame.entries, [
    {
      stationId: 'station-bg-1',
      chunk: 'a'.repeat(STATION_TERMINAL_OUTPUT_FLUSH_BACKGROUND_CHAR_LIMIT),
      unreadDelta: 3,
    },
  ])
  assert.equal(frame.hasDeferredBackground, true)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-bg-1',
      chunk: 'a'.repeat(8),
      unreadDelta: 0,
    },
    {
      stationId: 'station-bg-2',
      chunk: 'deferred',
      unreadDelta: 1,
    },
  ])
})

test('background flush frame defers output when the frame character budget is exhausted', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'background output', 3)

  const exhaustedFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 1,
    backgroundCharLimit: 0,
  })

  assert.deepEqual(exhaustedFrame.entries, [])
  assert.equal(exhaustedFrame.hasDeferredActive, false)
  assert.equal(exhaustedFrame.hasDeferredBackground, true)

  const nextFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 1,
    backgroundCharLimit: 1024,
  })

  assert.deepEqual(nextFrame.entries, [
    {
      stationId: 'station-bg-1',
      chunk: 'background output',
      unreadDelta: 3,
    },
  ])
  assert.equal(nextFrame.hasDeferredBackground, false)
  assert.deepEqual(queue, {})
})

test('background flush frame treats invalid character budgets as exhausted', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'deferred invalid background output', 3)

  const invalidFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 1,
    backgroundCharLimit: Number.NaN,
  })

  assert.deepEqual(invalidFrame.entries, [])
  assert.equal(invalidFrame.hasDeferredActive, false)
  assert.equal(invalidFrame.hasDeferredBackground, true)

  const nextFrame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 1,
    backgroundCharLimit: Number.POSITIVE_INFINITY,
  })

  assert.deepEqual(nextFrame.entries, [
    {
      stationId: 'station-bg-1',
      chunk: 'deferred invalid background output',
      unreadDelta: 3,
    },
  ])
  assert.equal(nextFrame.hasDeferredBackground, false)
  assert.deepEqual(queue, {})
})

test('background flush frame splits by code point without breaking emoji', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  queueStationTerminalOutputFlush(queue, 'station-bg-1', 'a🙂b', 1)

  const frame = takeStationTerminalOutputFlushFrameEntries(queue, {
    activeStationId: 'station-active',
    includeBackground: true,
    backgroundEntryLimit: 1,
    backgroundCharLimit: 2,
  })

  assert.deepEqual(frame.entries, [
    {
      stationId: 'station-bg-1',
      chunk: 'a🙂',
      unreadDelta: 1,
    },
  ])
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-bg-1',
      chunk: 'b',
      unreadDelta: 0,
    },
  ])
})

test('ignores empty station output chunks without scheduling work', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', ''), false)
  assert.equal(queueStationTerminalOutputFlush(queue, '', 'content'), false)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [])
})
