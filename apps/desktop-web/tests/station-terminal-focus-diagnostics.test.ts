import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendStationTerminalFocusDiagnosticEvent,
  resolveStationTerminalPointerDownFocusPlan,
} from '../src/features/terminal/station-terminal-focus-diagnostics.js'

test('defers pointerdown focus for inactive terminals on macOS WebKit', () => {
  assert.deepEqual(
    resolveStationTerminalPointerDownFocusPlan({
      isActive: false,
      isMacOsWebKitEnvironment: true,
    }),
    {
      activateStation: true,
      focusStrategy: 'defer-until-active',
    },
  )
})

test('keeps immediate pointerdown focus for active or non-WebKit terminals', () => {
  assert.deepEqual(
    resolveStationTerminalPointerDownFocusPlan({
      isActive: true,
      isMacOsWebKitEnvironment: true,
    }),
    {
      activateStation: true,
      focusStrategy: 'immediate',
    },
  )

  assert.deepEqual(
    resolveStationTerminalPointerDownFocusPlan({
      isActive: false,
      isMacOsWebKitEnvironment: false,
    }),
    {
      activateStation: true,
      focusStrategy: 'immediate',
    },
  )
})

test('focus diagnostics keep only the newest events within the configured limit', () => {
  const events = [
    {
      atMs: 100,
      stationId: 'station-a',
      sessionId: 'session-a',
      kind: 'pointerdown',
      detail: 'first',
    },
    {
      atMs: 200,
      stationId: 'station-a',
      sessionId: 'session-a',
      kind: 'focus-request',
      detail: 'second',
    },
    {
      atMs: 300,
      stationId: 'station-a',
      sessionId: 'session-a',
      kind: 'focus-deferred',
      detail: 'third',
    },
  ] as const

  const limited = events.reduce(
    (current, event) => appendStationTerminalFocusDiagnosticEvent(current, event, 2),
    [] as Array<(typeof events)[number]>,
  )

  assert.deepEqual(limited, [events[1], events[2]])
})
