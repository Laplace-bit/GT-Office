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

test('shell terminal controller exposes launch state before terminal creation and failure state on rejection', () => {
  const ensureSessionBlock =
    controllerSource.match(/const ensureStationTerminalSession = useMemo\([\s\S]*?\n  const focusStationTerminal/m)?.[0] ?? ''

  assert.notEqual(ensureSessionBlock, '', 'station terminal launch path should exist')
  assert.match(ensureSessionBlock, /setStationTerminalState\(stationId, \{\s*stateRaw: 'launching'/)
  assert.match(ensureSessionBlock, /resetStationTerminalOutput\(stationId, t\(locale, 'system\.terminalLaunching'\)\)/)
  assert.match(ensureSessionBlock, /setStationTerminalState\(stationId, \{ stateRaw: 'failed' \}\)/)
})

test('terminal and agent launches immediately replace stale output and activate their target station', () => {
  const launchTerminalBlock =
    controllerSource.match(/const launchStationTerminal = useMemo\([\s\S]*?\n  \)\n\n  \/\/ ── Send station terminal input/m)?.[0] ?? ''
  const launchProfileBlock =
    controllerSource.match(/const launchToolProfileForStation = useCallback\([\s\S]*?\n  \)\n\n  const launchCliInStationTerminal/m)?.[0] ?? ''

  assert.notEqual(launchTerminalBlock, '', 'public terminal launch path should exist')
  assert.match(launchTerminalBlock, /setActiveStationId\(stationId\)/)
  assert.notEqual(launchProfileBlock, '', 'agent profile launch path should exist')
  assert.match(launchProfileBlock, /setStationTerminalState\(station\.id, \{\s*stateRaw: 'launching'/)
  assert.match(launchProfileBlock, /resetStationTerminalOutput\(station\.id, t\(locale, 'system\.terminalLaunching'\)\)/)
  assert.match(launchProfileBlock, /loginShell: false/)
})
