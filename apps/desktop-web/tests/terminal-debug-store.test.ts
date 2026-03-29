import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearStationTerminalDebugRecords,
  isStationTerminalDebugEnabled,
  readStationTerminalDebugHumanLog,
  resetTerminalDebugStoreForTests,
  setStationTerminalDebugEnabled,
  setStationTerminalDebugHumanLog,
} from '../src/features/terminal/terminal-debug-store.js'

test.beforeEach(() => {
  resetTerminalDebugStoreForTests()
})

test('terminal debug store isolates human logs by station', () => {
  setStationTerminalDebugHumanLog('station-a', {
    entries: [{ atMs: 1, text: 'A' }],
    eventCount: 1,
  })
  setStationTerminalDebugHumanLog('station-b', {
    entries: [{ atMs: 2, text: 'B' }],
    eventCount: 1,
  })

  assert.deepEqual(readStationTerminalDebugHumanLog('station-a').entries, [{ atMs: 1, text: 'A' }])
  assert.deepEqual(readStationTerminalDebugHumanLog('station-b').entries, [{ atMs: 2, text: 'B' }])
})

test('terminal debug store replaces the station human log snapshot atomically', () => {
  setStationTerminalDebugHumanLog('station-a', {
    entries: [{ atMs: 1, text: '第一条' }],
    eventCount: 1,
  })
  setStationTerminalDebugHumanLog('station-a', {
    entries: [
      { atMs: 1, text: '第一条' },
      { atMs: 2, text: '第二条' },
    ],
    eventCount: 2,
  })

  const log = readStationTerminalDebugHumanLog('station-a')
  assert.equal(log.eventCount, 2)
  assert.deepEqual(log.entries.map((entry) => entry.text), ['第一条', '第二条'])
})

test('terminal debug store clears a single station without affecting others', () => {
  setStationTerminalDebugHumanLog('station-a', {
    entries: [{ atMs: 1, text: 'A' }],
    eventCount: 1,
  })
  setStationTerminalDebugHumanLog('station-b', {
    entries: [{ atMs: 2, text: 'B' }],
    eventCount: 1,
  })

  clearStationTerminalDebugRecords('station-a')

  assert.deepEqual(readStationTerminalDebugHumanLog('station-a').entries, [])
  assert.deepEqual(readStationTerminalDebugHumanLog('station-b').entries, [{ atMs: 2, text: 'B' }])
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
