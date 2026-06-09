import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendStationTerminalPendingReplayOp,
  compactStationTerminalPendingReplayOps,
  type StationTerminalPendingReplay,
} from '../src/features/terminal/station-terminal-pending-replay.js'

test('coalesces pending replay writes while a terminal sink is restoring', () => {
  const pendingReplay: StationTerminalPendingReplay = {
    version: 1,
    ops: [],
  }

  for (let index = 0; index < 100; index += 1) {
    appendStationTerminalPendingReplayOp(pendingReplay, {
      kind: 'write',
      chunk: String(index % 10),
    })
  }

  assert.deepEqual(pendingReplay.ops, [
    {
      kind: 'write',
      chunk: '0123456789'.repeat(10),
    },
  ])
})

test('reset pending replay drops older writes but preserves later writes', () => {
  const pendingReplay: StationTerminalPendingReplay = {
    version: 1,
    ops: [],
  }

  appendStationTerminalPendingReplayOp(pendingReplay, { kind: 'write', chunk: 'stale' })
  appendStationTerminalPendingReplayOp(pendingReplay, { kind: 'reset', content: 'fresh' })
  appendStationTerminalPendingReplayOp(pendingReplay, { kind: 'write', chunk: ' tail' })

  assert.deepEqual(pendingReplay.ops, [
    { kind: 'reset', content: 'fresh' },
    { kind: 'write', chunk: ' tail' },
  ])
})

test('append pending replay can split writes before restore catch-up drains', () => {
  const pendingReplay: StationTerminalPendingReplay = {
    version: 1,
    ops: [],
  }

  appendStationTerminalPendingReplayOp(
    pendingReplay,
    { kind: 'write', chunk: 'abcdef' },
    { writeChunkCharLimit: 2 },
  )
  appendStationTerminalPendingReplayOp(
    pendingReplay,
    { kind: 'write', chunk: 'gh' },
    { writeChunkCharLimit: 2 },
  )

  assert.deepEqual(pendingReplay.ops, [
    { kind: 'write', chunk: 'ab' },
    { kind: 'write', chunk: 'cd' },
    { kind: 'write', chunk: 'ef' },
    { kind: 'write', chunk: 'gh' },
  ])
})

test('append pending replay split keeps reset semantics and code points intact', () => {
  const pendingReplay: StationTerminalPendingReplay = {
    version: 1,
    ops: [],
  }

  appendStationTerminalPendingReplayOp(
    pendingReplay,
    { kind: 'write', chunk: 'stale' },
    { writeChunkCharLimit: 2 },
  )
  appendStationTerminalPendingReplayOp(pendingReplay, { kind: 'reset', content: 'fresh' })
  appendStationTerminalPendingReplayOp(
    pendingReplay,
    { kind: 'write', chunk: 'a🙂b' },
    { writeChunkCharLimit: 2 },
  )

  assert.deepEqual(pendingReplay.ops, [
    { kind: 'reset', content: 'fresh' },
    { kind: 'write', chunk: 'a🙂' },
    { kind: 'write', chunk: 'b' },
  ])
})

test('compact pending replay keeps reset semantics and ignores empty writes', () => {
  assert.deepEqual(
    compactStationTerminalPendingReplayOps([
      { kind: 'write', chunk: 'old' },
      { kind: 'write', chunk: '' },
      { kind: 'reset', content: 'new' },
      { kind: 'write', chunk: ' one' },
      { kind: 'write', chunk: ' two' },
    ]),
    [
      { kind: 'reset', content: 'new' },
      { kind: 'write', chunk: ' one two' },
    ],
  )
})

test('compact pending replay preserves the default single write behavior', () => {
  assert.deepEqual(
    compactStationTerminalPendingReplayOps([
      { kind: 'write', chunk: 'alpha' },
      { kind: 'write', chunk: 'beta' },
    ]),
    [
      { kind: 'write', chunk: 'alphabeta' },
    ],
  )
})

test('compact pending replay splits large writes by character budget for smoother restore catch-up', () => {
  assert.deepEqual(
    compactStationTerminalPendingReplayOps(
      [
        { kind: 'write', chunk: 'abcd' },
        { kind: 'write', chunk: 'ef' },
      ],
      { writeChunkCharLimit: 2 },
    ),
    [
      { kind: 'write', chunk: 'ab' },
      { kind: 'write', chunk: 'cd' },
      { kind: 'write', chunk: 'ef' },
    ],
  )
})

test('compact pending replay splits writes after reset without preserving stale output', () => {
  assert.deepEqual(
    compactStationTerminalPendingReplayOps(
      [
        { kind: 'write', chunk: 'stale' },
        { kind: 'reset', content: 'fresh' },
        { kind: 'write', chunk: 'abcdef' },
      ],
      { writeChunkCharLimit: 3 },
    ),
    [
      { kind: 'reset', content: 'fresh' },
      { kind: 'write', chunk: 'abc' },
      { kind: 'write', chunk: 'def' },
    ],
  )
})

test('compact pending replay splits by code point instead of cutting surrogate pairs', () => {
  assert.deepEqual(
    compactStationTerminalPendingReplayOps(
      [
        { kind: 'write', chunk: 'a🙂b🙂c' },
      ],
      { writeChunkCharLimit: 2 },
    ),
    [
      { kind: 'write', chunk: 'a🙂' },
      { kind: 'write', chunk: 'b🙂' },
      { kind: 'write', chunk: 'c' },
    ],
  )
})
