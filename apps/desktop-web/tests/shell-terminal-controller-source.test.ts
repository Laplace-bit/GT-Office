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
