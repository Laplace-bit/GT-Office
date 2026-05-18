import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldContinueStationTerminalFocusAttempt,
  resolveStationTerminalFocusRequest,
  shouldConsumeInactiveStationTerminalMouseGesture,
  shouldFlushPendingStationTerminalFocus,
} from '../src/features/terminal/station-terminal-focus-runtime.js'

test('defers terminal focus requests until runtime helpers are ready', () => {
  assert.deepEqual(
    resolveStationTerminalFocusRequest({
      focusRuntimeReady: false,
    }),
    {
      shouldDispatch: false,
      shouldPersistPending: true,
    },
  )
})

test('dispatches terminal focus requests once runtime helpers are ready', () => {
  assert.deepEqual(
    resolveStationTerminalFocusRequest({
      focusRuntimeReady: true,
    }),
    {
      shouldDispatch: true,
      shouldPersistPending: false,
    },
  )
})

test('flushes pending terminal focus only after runtime helpers are ready', () => {
  assert.equal(
    shouldFlushPendingStationTerminalFocus({
      pendingAutoFocus: true,
      focusRuntimeReady: false,
    }),
    false,
  )

  assert.equal(
    shouldFlushPendingStationTerminalFocus({
      pendingAutoFocus: true,
      focusRuntimeReady: true,
    }),
    true,
  )

  assert.equal(
    shouldFlushPendingStationTerminalFocus({
      pendingAutoFocus: false,
      focusRuntimeReady: true,
    }),
    false,
  )
})

test('stops terminal focus retries once the station is no longer active or mounted', () => {
  assert.equal(
    shouldContinueStationTerminalFocusAttempt({
      componentMounted: true,
      stationActive: true,
    }),
    true,
  )

  assert.equal(
    shouldContinueStationTerminalFocusAttempt({
      componentMounted: true,
      stationActive: false,
    }),
    false,
  )

  assert.equal(
    shouldContinueStationTerminalFocusAttempt({
      componentMounted: false,
      stationActive: true,
    }),
    false,
  )
})

test('consumes the first primary mouse gesture while the terminal is inactive', () => {
  assert.equal(
    shouldConsumeInactiveStationTerminalMouseGesture({
      isActive: false,
      button: 0,
    }),
    true,
  )

  assert.equal(
    shouldConsumeInactiveStationTerminalMouseGesture({
      isActive: true,
      button: 0,
    }),
    false,
  )

  assert.equal(
    shouldConsumeInactiveStationTerminalMouseGesture({
      isActive: false,
      button: 1,
    }),
    false,
  )
})
