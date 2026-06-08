import test from 'node:test'
import assert from 'node:assert/strict'
import {
  queueStationTerminalOutputFlush,
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

test('defers terminal output string compaction until flush entries are taken', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  for (let index = 0; index < 100; index += 1) {
    assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', String(index % 10), 0), true)
  }

  assert.equal(queue['station-1']?.chunks.length, 100)
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
  assert.equal(frame.hasDeferredBackground, true)
  assert.deepEqual(Object.keys(queue).sort(), ['station-bg-1', 'station-bg-2'])
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

test('ignores empty station output chunks without scheduling work', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', ''), false)
  assert.equal(queueStationTerminalOutputFlush(queue, '', 'content'), false)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [])
})
