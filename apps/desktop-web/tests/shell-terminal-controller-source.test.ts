import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const controllerSource = readFileSync(
  resolve(process.cwd(), 'src/shell/layout/useShellTerminalController.ts'),
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

test('station terminal creation skips shell profiles so the new session becomes interactive promptly', () => {
  const ensureSessionBlock =
    controllerSource.match(/const ensureStationTerminalSession = useMemo\([\s\S]*?\n  const focusStationTerminal/m)?.[0] ?? ''

  assert.notEqual(ensureSessionBlock, '', 'station terminal launch path should exist')
  assert.match(
    ensureSessionBlock,
    /desktopApi\.terminalCreate\([\s\S]*?loginShell: false/,
    'manual station terminal launch must not wait for user login-shell profiles',
  )
})

test('created terminal sessions are published through React state before input is accepted', () => {
  const ensureSessionBlock =
    controllerSource.match(/const ensureStationTerminalSession = useMemo\([\s\S]*?\n  const focusStationTerminal/m)?.[0] ?? ''
  const createdSessionBlock =
    ensureSessionBlock.match(/sessionStationRef\.current\[session\.sessionId\][\s\S]*?return session\.sessionId/)?.[0] ?? ''

  assert.notEqual(createdSessionBlock, '', 'created terminal session result path should exist')
  assert.match(
    createdSessionBlock,
    /setStationTerminalState\(stationId, \{[\s\S]*?sessionId: session\.sessionId[\s\S]*?stateRaw: 'running'/,
    'the created session must be published to the terminal component',
  )
  assert.doesNotMatch(
    createdSessionBlock,
    /stationTerminalsRef\.current\s*=/,
    'mutating the runtime ref first makes the state publisher treat the session patch as a no-op',
  )
})

test('shell terminal controller skips full restore when rebinding a preserved live terminal buffer', () => {
  assert.match(controllerSource, /preserveLiveBuffer/)
  assert.match(controllerSource, /parkLiveBuffer/)
  assert.match(
    controllerSource,
    /if \(preserveLiveBuffer\) \{[\s\S]*?return\n\s*\}/,
    'reclaimed workspace-switch hosts must skip full restore/reset',
  )
  assert.match(
    controllerSource,
    /meta\?\.parkLiveBuffer/,
    'parked keep-alive unbind must retain restore state for document cache fallback',
  )
})

test('shell terminal controller can present a cached terminal document synchronously for workspace switches', () => {
  assert.match(controllerSource, /const presentWorkspaceTerminalDocument = useCallback/)
  assert.match(
    controllerSource,
    /setStationTerminals\(\{ \.\.\.stationTerminalsRef\.current \}\)/,
    'presentation must publish live runtimes to React state before paint',
  )
  assert.match(
    controllerSource,
    /cachedDocument\?\.stationTerminals\[station\.id\]/,
    'station seed path must prefer cached live runtimes over fresh idle shells',
  )
})

test('cached background terminal output is also written to parked keep-alive hosts', () => {
  const flushCachedBlock =
    controllerSource.match(
      /const flushCachedTerminalOutputAppendQueue = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\)/,
    )?.[0] ?? ''

  assert.notEqual(flushCachedBlock, '', 'cached terminal output flush path should exist')
  assert.match(flushCachedBlock, /peekParkedStationTerminalHost/)
  assert.match(flushCachedBlock, /parkedHost\.sink\.write/)
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
