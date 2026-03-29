import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendTerminalDebugRecord,
  formatTerminalDebugBody,
  formatTerminalDebugPreview,
  hydrateTerminalDebugRecordHumanText,
  type TerminalDebugRecord,
} from '../src/features/terminal/terminal-debug-model.js'

function createRecord(id: string, atMs: number): TerminalDebugRecord {
  return {
    id,
    atMs,
    stationId: 'station-1',
    sessionId: 'session-1',
    lane: 'event',
    kind: 'output',
    summary: `summary-${id}`,
    body: `body-${id}`,
  }
}

test('appendTerminalDebugRecord appends records in chronological order when limit is disabled', () => {
  const first = appendTerminalDebugRecord([], createRecord('1', 1), 0)
  const second = appendTerminalDebugRecord(first, createRecord('2', 2), 0)
  const third = appendTerminalDebugRecord(second, createRecord('3', 3), 0)

  assert.deepEqual(
    third.map((record) => record.id),
    ['1', '2', '3'],
  )
})

test('appendTerminalDebugRecord keeps the newest records within the limit', () => {
  const first = appendTerminalDebugRecord([], createRecord('1', 1), 2)
  const second = appendTerminalDebugRecord(first, createRecord('2', 2), 2)
  const third = appendTerminalDebugRecord(second, createRecord('3', 3), 2)

  assert.deepEqual(
    third.map((record) => record.id),
    ['2', '3'],
  )
})

test('formatTerminalDebugPreview normalizes control characters and truncates long chunks', () => {
  const preview = formatTerminalDebugPreview('line-1\r\nline-2\tsegment' + 'x'.repeat(80), 24)

  assert.equal(preview, 'line-1\\nline-2    seg...')
})

test('terminal debug formatting escapes ansi control bytes into readable markers', () => {
  const raw = '\u001b[32m成功\u001b[0m\u0007'

  assert.equal(formatTerminalDebugPreview(raw, 80), '\\x1b[32m成功\\x1b[0m\\x07')
  assert.equal(formatTerminalDebugBody(raw, 80), '\\x1b[32m成功\\x1b[0m\\x07')
})

test('formatTerminalDebugBody does not truncate when limit is disabled', () => {
  const raw = 'x'.repeat(200)

  assert.equal(formatTerminalDebugBody(raw, 0), raw)
})

test('hydrateTerminalDebugRecordHumanText updates the matching rendered screen record', () => {
  const records: TerminalDebugRecord[] = [
    {
      ...createRecord('screen-1', 1),
      lane: 'xterm',
      kind: 'screen',
      sessionId: 'session-1',
      screenRevision: 4,
      body: 'screen body',
    },
    {
      ...createRecord('screen-2', 2),
      lane: 'xterm',
      kind: 'screen',
      sessionId: 'session-1',
      screenRevision: 5,
      body: 'other screen body',
    },
  ]

  const updated = hydrateTerminalDebugRecordHumanText(records, 'session-1', 4, '稳定正文')

  assert.equal(updated[0]?.humanText, '稳定正文')
  assert.equal(updated[1]?.humanText, undefined)
})

test('hydrateTerminalDebugRecordHumanText keeps the original array when no record matches', () => {
  const records: TerminalDebugRecord[] = [
    {
      ...createRecord('screen-1', 1),
      lane: 'xterm',
      kind: 'screen',
      sessionId: 'session-1',
      screenRevision: 4,
      body: 'screen body',
    },
  ]

  const updated = hydrateTerminalDebugRecordHumanText(records, 'session-1', 9, '稳定正文')

  assert.equal(updated, records)
})
