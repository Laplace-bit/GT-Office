import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveStationTerminalFocusRequest,
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
