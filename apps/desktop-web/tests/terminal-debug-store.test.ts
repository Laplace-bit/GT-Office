import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendStationTerminalDebugRecord,
  clearStationTerminalDebugRecords,
  hydrateStationTerminalDebugHumanText,
  isStationTerminalDebugEnabled,
  readStationTerminalDebugRecords,
  resetTerminalDebugStoreForTests,
  setStationTerminalDebugEnabled,
} from '../src/features/terminal/terminal-debug-store.js'
import type { TerminalDebugRecord } from '../src/features/terminal/terminal-debug-model.js'

function createRecord(id: string, stationId: string, screenRevision?: number): TerminalDebugRecord {
  return {
    id,
    atMs: 1,
    stationId,
    sessionId: 'session-1',
    lane: 'xterm',
    kind: 'screen',
    screenRevision: screenRevision ?? null,
    source: 'rendered_screen',
    summary: `summary-${id}`,
    body: `body-${id}`,
  }
}

test.beforeEach(() => {
  resetTerminalDebugStoreForTests()
})

test('terminal debug store isolates records by station', () => {
  appendStationTerminalDebugRecord('station-a', createRecord('a1', 'station-a'), 0)
  appendStationTerminalDebugRecord('station-b', createRecord('b1', 'station-b'), 0)

  assert.deepEqual(
    readStationTerminalDebugRecords('station-a').map((record) => record.id),
    ['a1'],
  )
  assert.deepEqual(
    readStationTerminalDebugRecords('station-b').map((record) => record.id),
    ['b1'],
  )
})

test('terminal debug store hydrates human text without touching other records', () => {
  appendStationTerminalDebugRecord('station-a', createRecord('a1', 'station-a', 4), 0)
  appendStationTerminalDebugRecord('station-a', createRecord('a2', 'station-a', 5), 0)

  hydrateStationTerminalDebugHumanText('station-a', 'session-1', 4, '稳定正文')

  const records = readStationTerminalDebugRecords('station-a')
  assert.equal(records[0]?.humanText, '稳定正文')
  assert.equal(records[1]?.humanText, undefined)
})

test('terminal debug store supports detached screen hydration alongside xterm writes', () => {
  appendStationTerminalDebugRecord(
    'station-a',
    {
      id: 'write-1',
      atMs: 1,
      stationId: 'station-a',
      sessionId: 'session-1',
      lane: 'xterm',
      kind: 'write',
      source: 'detached_terminal_output_append',
      summary: 'partial reply',
      body: '你好，',
    },
    0,
  )
  appendStationTerminalDebugRecord(
    'station-a',
    {
      id: 'screen-1',
      atMs: 2,
      stationId: 'station-a',
      sessionId: 'session-1',
      lane: 'xterm',
      kind: 'screen',
      screenRevision: 7,
      source: 'rendered_screen',
      summary: '完整屏幕',
      body: '你好，世界',
    },
    0,
  )

  hydrateStationTerminalDebugHumanText('station-a', 'session-1', 7, '你好，世界')

  const records = readStationTerminalDebugRecords('station-a')
  assert.equal(records.length, 2)
  assert.equal(records[0]?.kind, 'write')
  assert.equal(records[1]?.kind, 'screen')
  assert.equal(records[1]?.humanText, '你好，世界')
})

test('terminal debug store clears a single station without affecting others', () => {
  appendStationTerminalDebugRecord('station-a', createRecord('a1', 'station-a'), 0)
  appendStationTerminalDebugRecord('station-b', createRecord('b1', 'station-b'), 0)

  clearStationTerminalDebugRecords('station-a')

  assert.deepEqual(readStationTerminalDebugRecords('station-a'), [])
  assert.deepEqual(
    readStationTerminalDebugRecords('station-b').map((record) => record.id),
    ['b1'],
  )
})

test('terminal debug store keeps collection disabled by default and toggles per station', () => {
  assert.equal(isStationTerminalDebugEnabled('station-a'), false)
  assert.equal(isStationTerminalDebugEnabled('station-b'), false)

  setStationTerminalDebugEnabled('station-a', true)
  assert.equal(isStationTerminalDebugEnabled('station-a'), true)
  assert.equal(isStationTerminalDebugEnabled('station-b'), false)

  setStationTerminalDebugEnabled('station-a', false)
  assert.equal(isStationTerminalDebugEnabled('station-a'), false)
})
