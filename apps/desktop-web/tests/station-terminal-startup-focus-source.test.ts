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

test('waits for the helper textarea to anchor on-screen before programmatic focus', () => {
  const source = readTerminalSource()

  // xterm parks its helper textarea off-screen (left: -9999em) until _syncTextArea
  // runs. Focusing it there sets activeElement without dispatching the focus event,
  // so keydown for control keys (Enter, arrows) is never delivered even though
  // insertText input events still reach xterm. The focus attempt must wait for the
  // textarea to be anchored on-screen before focusing.
  const attemptFocusBlock =
    source.match(/const attemptFocus = \(\) => \{[\s\S]*?terminal\.focus\(\)/)?.[0] ?? ''

  assert.notEqual(attemptFocusBlock, '', 'terminal focus attempt block should exist')
  assert.match(
    attemptFocusBlock,
    /isHelperTextareaAnchored\(\)[\s\S]*?terminal\.focus\(\)/,
    'focus attempt must wait for the helper textarea to anchor before focusing',
  )
})

test('parks live xterm hosts across workspace switches instead of disposing them', () => {
  const source = readTerminalSource()

  assert.match(source, /reclaimStationTerminalHost/)
  assert.match(source, /parkStationTerminalHost/)
  assert.match(source, /preserveLiveBuffer:\s*preservedLiveBuffer/)
  assert.match(source, /parkLiveBuffer:\s*true/)
  assert.match(
    source,
    /forceDisposeTerminalRef\.current\s*=\s*true/,
    'renderer recovery must force dispose rather than park a corrupted host',
  )
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{\s*const host = hostRef\.current/,
    'parked hosts must reparent before paint via useLayoutEffect',
  )
  assert.match(
    source,
    /shouldPrioritizeStationTerminalRuntimeInit\(\s*isActive,\s*stateRaw,\s*sessionId,?\s*\)/,
    'live sessions must prioritize runtime init on first paint after workspace switch',
  )
})
