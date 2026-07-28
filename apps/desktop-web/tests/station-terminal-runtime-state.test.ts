import test from 'node:test'
import assert from 'node:assert/strict'
import {
  doesStationTerminalRuntimePatchChangeState,
  isStationTerminalRuntimeLive,
  shouldPrioritizeStationTerminalRuntimeInit,
  shouldRenderStationTerminal,
} from '../src/features/terminal/station-terminal-runtime-state.js'

test('treats only bound live sessions as running agent runtimes', () => {
  assert.equal(
    isStationTerminalRuntimeLive({
      sessionId: 'ts_live',
      stateRaw: 'running',
    }),
    true,
  )
  assert.equal(
    isStationTerminalRuntimeLive({
      sessionId: 'ts_failed',
      stateRaw: 'failed',
    }),
    false,
  )
  assert.equal(
    isStationTerminalRuntimeLive({
      sessionId: null,
      stateRaw: 'running',
    }),
    false,
  )
})

test('keeps exited sessions renderable for transcript playback', () => {
  assert.equal(
    shouldRenderStationTerminal({
      sessionId: null,
      stateRaw: 'exited',
    }),
    true,
  )
  assert.equal(
    shouldRenderStationTerminal({
      sessionId: null,
      stateRaw: 'idle',
    }),
    false,
  )
})

test('prioritizes launching runtimes and any station that already owns a live session', () => {
  assert.equal(shouldPrioritizeStationTerminalRuntimeInit(false, 'launching'), true)
  assert.equal(shouldPrioritizeStationTerminalRuntimeInit(false, 'running'), false)
  assert.equal(shouldPrioritizeStationTerminalRuntimeInit(true, 'running'), true)
  assert.equal(
    shouldPrioritizeStationTerminalRuntimeInit(false, 'running', 'session-1'),
    true,
    'workspace-switch keep-alive must mount live sessions on first paint',
  )
})

test('detects no-op runtime patches before shell React state updates', () => {
  const runtime = {
    sessionId: 'session-1',
    stateRaw: 'running',
    unreadCount: 2,
    shell: 'zsh',
    cwdMode: 'custom' as const,
    resolvedCwd: '/workspace/agent',
  }

  assert.equal(
    doesStationTerminalRuntimePatchChangeState(runtime, {
      sessionId: 'session-1',
      stateRaw: 'running',
      unreadCount: 2,
      shell: 'zsh',
      cwdMode: 'custom',
      resolvedCwd: '/workspace/agent',
    }),
    false,
  )

  assert.equal(
    doesStationTerminalRuntimePatchChangeState(runtime, {
      unreadCount: 3,
    }),
    true,
  )

  assert.equal(
    doesStationTerminalRuntimePatchChangeState(runtime, {
      cwdMode: undefined,
    }),
    true,
  )
})
