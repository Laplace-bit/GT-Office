import test from 'node:test'
import assert from 'node:assert/strict'
import { selectStationTerminalReplaySource } from '../src/features/terminal/station-terminal-replay-source.js'

test('prefers restore state when it is at least as complete as the cached content', () => {
  const replay = selectStationTerminalReplaySource({
    cachedContent: 'short cache',
    restoreState: {
      content: '\u001b[32mlonger restore\u001b[0m',
      cols: 120,
      rows: 40,
    },
  })

  assert.equal(replay.kind, 'restore')
  if (replay.kind === 'restore') {
    assert.equal(replay.state.cols, 120)
  }
})

test('prefers cached content when it is substantially more complete than the restore state', () => {
  const replay = selectStationTerminalReplaySource({
    cachedContent: `history:${'x'.repeat(1200)}`,
    restoreState: {
      content: `tail:${'x'.repeat(120)}`,
      cols: 100,
      rows: 30,
    },
  })

  assert.deepEqual(replay, {
    kind: 'cache',
    content: `history:${'x'.repeat(1200)}`,
  })
})

test('falls back to cached content when no restore state exists', () => {
  assert.deepEqual(
    selectStationTerminalReplaySource({
      cachedContent: 'plain output cache',
      restoreState: null,
    }),
    {
      kind: 'cache',
      content: 'plain output cache',
    },
  )
})
