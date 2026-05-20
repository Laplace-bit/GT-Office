import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isStationTerminalInterruptKeyboardEvent,
  resolveStationTerminalInterruptConfirmKeyAction,
  resolveStationTerminalInterruptKeyAction,
} from '../src/features/terminal/station-terminal-interrupt-guard.js'

test('matches plain ctrl+c and ignores other modifier combinations', () => {
  assert.equal(
    isStationTerminalInterruptKeyboardEvent({
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    }),
    true,
  )
  assert.equal(
    isStationTerminalInterruptKeyboardEvent({
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    }),
    true,
  )
  assert.equal(
    isStationTerminalInterruptKeyboardEvent({
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: true,
    }),
    false,
  )
  assert.equal(
    isStationTerminalInterruptKeyboardEvent({
      key: 'c',
      code: 'KeyC',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    }),
    false,
  )
})

test('opens confirmation only for running agent terminals without an active selection', () => {
  assert.deepEqual(
    resolveStationTerminalInterruptKeyAction({
      event: {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
      },
      agentRunning: true,
      confirmOpen: false,
      hasSelection: false,
    }),
    { action: 'open-confirm', signalKind: 'sigint' },
  )
  assert.deepEqual(
    resolveStationTerminalInterruptKeyAction({
      event: {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
      },
      agentRunning: false,
      confirmOpen: false,
      hasSelection: false,
    }),
    { action: 'none', signalKind: null },
  )
  assert.deepEqual(
    resolveStationTerminalInterruptKeyAction({
      event: {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
      },
      agentRunning: true,
      confirmOpen: false,
      hasSelection: true,
    }),
    { action: 'none', signalKind: null },
  )
})

test('requires a fresh second matching control key before confirming the interrupt', () => {
  assert.deepEqual(
    resolveStationTerminalInterruptKeyAction({
      event: {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: false,
      },
      agentRunning: true,
      confirmOpen: true,
      pendingSignalKind: 'sigint',
      hasSelection: false,
    }),
    { action: 'confirm-interrupt', signalKind: 'sigint' },
  )
  assert.deepEqual(
    resolveStationTerminalInterruptKeyAction({
      event: {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: true,
      },
      agentRunning: true,
      confirmOpen: true,
      pendingSignalKind: 'sigint',
      hasSelection: false,
    }),
    { action: 'none', signalKind: 'sigint' },
  )
  assert.deepEqual(
    resolveStationTerminalInterruptKeyAction({
      event: {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: false,
      },
      agentRunning: true,
      confirmOpen: true,
      pendingSignalKind: 'sigint',
      hasSelection: false,
    }),
    { action: 'open-confirm', signalKind: 'sigtstp' },
  )
})

test('dialog keyboard shortcuts map escape to cancel and require the matching control key to confirm', () => {
  assert.equal(
    resolveStationTerminalInterruptConfirmKeyAction({
      key: 'Escape',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    }, 'sigint'),
    'cancel',
  )
  assert.equal(
    resolveStationTerminalInterruptConfirmKeyAction({
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    }, 'sigint'),
    'confirm',
  )
  assert.equal(
    resolveStationTerminalInterruptConfirmKeyAction({
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    }, 'sigint'),
    'none',
  )
  assert.equal(
    resolveStationTerminalInterruptConfirmKeyAction({
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    }, 'sigtstp'),
    'confirm',
  )
})
