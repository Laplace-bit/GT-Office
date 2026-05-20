import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isStationTerminalRuntimeLive,
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
