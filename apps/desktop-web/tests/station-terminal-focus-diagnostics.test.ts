import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendStationTerminalFocusDiagnosticEvent,
  recordStationTerminalFocusDiagnostic,
  resolveStationTerminalPointerDownFocusPlan,
  type StationTerminalFocusDiagnosticEvent,
  STATION_TERMINAL_FOCUS_DIAGNOSTIC_STORAGE_KEY,
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

function createSessionStorageWindow() {
  const storage = new Map<string, string>()
  return {
    sessionStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null
      },
      setItem(key: string, value: string) {
        storage.set(key, value)
      },
    },
    readStoredEvents() {
      const raw = storage.get(STATION_TERMINAL_FOCUS_DIAGNOSTIC_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    },
  }
}

test('records focus diagnostics locally and mirrors them into the system logger', async () => {
  const targetWindow = createSessionStorageWindow()
  const mirrored: StationTerminalFocusDiagnosticEvent[] = []

  await recordStationTerminalFocusDiagnostic({
    targetWindow: targetWindow as unknown as Window,
    stationId: 'station-a',
    sessionId: 'session-a',
    kind: 'pointerdown',
    detail: 'active=0',
    appendSystemLog: async (entry: StationTerminalFocusDiagnosticEvent) => {
      mirrored.push(entry)
    },
  })

  assert.equal(mirrored.length, 1)
  assert.equal(mirrored[0]?.kind, 'pointerdown')
  assert.equal(targetWindow.readStoredEvents().length, 1)
  assert.equal(targetWindow.readStoredEvents()[0]?.stationId, 'station-a')
})

test('keeps local diagnostics even when the system logger append fails', async () => {
  const targetWindow = createSessionStorageWindow()

  await recordStationTerminalFocusDiagnostic({
    targetWindow: targetWindow as unknown as Window,
    stationId: 'station-a',
    sessionId: 'session-a',
    kind: 'focus-error',
    detail: 'focus boom',
    appendSystemLog: async () => {
      throw new Error('write failed')
    },
  })

  assert.equal(targetWindow.readStoredEvents().length, 1)
  assert.equal(targetWindow.readStoredEvents()[0]?.kind, 'focus-error')
})
