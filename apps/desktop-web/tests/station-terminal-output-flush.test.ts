import test from 'node:test'
import assert from 'node:assert/strict'
import {
  queueStationTerminalOutputFlush,
  takeStationTerminalOutputFlushEntries,
  type StationTerminalOutputFlushQueue,
} from '../src/features/terminal/station-terminal-output-flush.js'

test('coalesces repeated terminal output for one station into one flush entry', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', 'alpha'), true)
  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', 'beta'), true)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [
    {
      stationId: 'station-1',
      chunk: 'alphabeta',
      unreadDelta: 2,
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

test('ignores empty station output chunks without scheduling work', () => {
  const queue: StationTerminalOutputFlushQueue = {}

  assert.equal(queueStationTerminalOutputFlush(queue, 'station-1', ''), false)
  assert.equal(queueStationTerminalOutputFlush(queue, '', 'content'), false)
  assert.deepEqual(takeStationTerminalOutputFlushEntries(queue), [])
})
