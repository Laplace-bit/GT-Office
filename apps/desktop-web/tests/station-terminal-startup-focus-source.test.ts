import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readTerminalSource(): string {
  return readFileSync(
    resolve(process.cwd(), 'src/features/terminal/StationXtermTerminal.tsx'),
    'utf8',
  )
}

test('retries a pending startup terminal focus request when the window wakes', () => {
  const source = readTerminalSource()

  assert.match(
    source,
    /const handleWindowWake = \(\) => \{[\s\S]*?pendingAutoFocusRef\.current[\s\S]*?focusTerminalRequestRef\.current\?\.\(\)[\s\S]*?scheduleViewportWake\('window-wake'\)/,
  )
})

test('retries terminal focus when the current session becomes input-ready', () => {
  const source = readTerminalSource()

  assert.match(
    source,
    /inputReady: shouldAcceptStationTerminalLocalInput\(\{ sessionId, stateRaw \}\)[\s\S]*?\}, \[isActive, sessionId, stateRaw\]\)/,
  )
})
