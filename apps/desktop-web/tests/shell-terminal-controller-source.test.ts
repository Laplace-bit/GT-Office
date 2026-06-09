import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const controllerSource = readFileSync(
  resolve(testDir, '../../src/shell/layout/useShellTerminalController.ts'),
  'utf8',
)

test('shell terminal controller reuses cached unread delta normalization before queueing', () => {
  assert.match(controllerSource, /normalizeStationTerminalCachedOutputUnreadDelta/)
  assert.doesNotMatch(controllerSource, /Math\.max\(0,\s*input\.unreadDelta\)/)
})

test('shell terminal controller normalizes cached output sequence checks before queueing', () => {
  const cachedPayloadQueueBlock =
    controllerSource.match(/const queueCachedTerminalOutputPayload = \([\s\S]*?\n    \}/)?.[0] ?? ''

  assert.notEqual(cachedPayloadQueueBlock, '', 'cached output payload queue path should exist')
  assert.match(cachedPayloadQueueBlock, /resolveTerminalOutputSequenceAction\(payload\.seq,\s*seq\)/)
  assert.doesNotMatch(cachedPayloadQueueBlock, /payload\.seq\s*<=\s*seq/)
})
