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
      viewportY: 18,
    },
  })

  assert.equal(replay.kind, 'restore')
  if (replay.kind === 'restore') {
    assert.equal(replay.state.cols, 120)
    assert.equal(replay.state.viewportY, 18)
  }
})

test('normalizes restore viewport before replaying a session-owned snapshot', () => {
  const replay = selectStationTerminalReplaySource({
    cachedContent: 'short cache',
    restoreState: {
      content: 'restore transcript',
      cols: 120,
      rows: 40,
      viewportY: 18.7,
    },
  })

  assert.equal(replay.kind, 'restore')
  if (replay.kind === 'restore') {
    assert.equal(replay.state.viewportY, 18)
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

test('falls back to cached content when restore dimensions cannot preserve scroll position', () => {
  assert.deepEqual(
    selectStationTerminalReplaySource({
      cachedContent: 'cached transcript',
      restoreState: {
        content: 'restore transcript',
        cols: 0,
        rows: 30,
        viewportY: 12,
      },
    }),
    {
      kind: 'cache',
      content: 'cached transcript',
    },
  )

  assert.deepEqual(
    selectStationTerminalReplaySource({
      cachedContent: 'cached transcript',
      restoreState: {
        content: 'restore transcript',
        cols: 100,
        rows: Number.NaN,
        viewportY: 12,
      },
    }),
    {
      kind: 'cache',
      content: 'cached transcript',
    },
  )
})

test('falls back to cached content when restore state has no visible terminal content', () => {
  assert.deepEqual(
    selectStationTerminalReplaySource({
      cachedContent: 'cached transcript',
      restoreState: {
        content: '\u001b[31m\u001b[0m',
        cols: 100,
        rows: 30,
        viewportY: 12,
      },
    }),
    {
      kind: 'cache',
      content: 'cached transcript',
    },
  )
})
