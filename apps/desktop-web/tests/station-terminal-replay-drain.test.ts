import test from 'node:test'
import assert from 'node:assert/strict'
import {
  drainStationTerminalPendingReplayOps,
} from '../src/features/terminal/station-terminal-replay-drain.js'
import type { StationTerminalSink } from '../src/features/terminal/station-terminal-sink-types.js'

function createRecordingSink(events: string[]): StationTerminalSink {
  return {
    write: async (chunk: string) => {
      events.push(`write:${chunk}`)
    },
    reset: async (content?: string) => {
      events.push(`reset:${content ?? ''}`)
    },
    restore: async (content: string) => {
      events.push(`restore:${content}`)
    },
    focus: () => {
      events.push('focus')
    },
    submit: () => {
      events.push('submit')
      return true
    },
  }
}

test('drains terminal pending replay ops in order', async () => {
  const events: string[] = []
  const sink = createRecordingSink(events)

  await drainStationTerminalPendingReplayOps(
    sink,
    [
      { kind: 'reset', content: 'screen' },
      { kind: 'write', chunk: 'one' },
      { kind: 'write', chunk: 'two' },
    ],
    {
      shouldContinue: () => true,
    },
  )

  assert.deepEqual(events, ['reset:screen', 'write:one', 'write:two'])
})

test('drains terminal pending replay ops with a frame yield between chunks', async () => {
  const events: string[] = []
  const sink = createRecordingSink(events)

  await drainStationTerminalPendingReplayOps(
    sink,
    [
      { kind: 'write', chunk: 'one' },
      { kind: 'write', chunk: 'two' },
      { kind: 'write', chunk: 'three' },
    ],
    {
      shouldContinue: () => true,
      yieldBetweenWrites: async () => {
        events.push('yield')
      },
    },
  )

  assert.deepEqual(events, ['write:one', 'yield', 'write:two', 'yield', 'write:three'])
})

test('stops draining terminal pending replay when the sink is no longer current', async () => {
  const events: string[] = []
  const sink = createRecordingSink(events)
  let current = true

  await drainStationTerminalPendingReplayOps(
    sink,
    [
      { kind: 'write', chunk: 'one' },
      { kind: 'write', chunk: 'stale' },
    ],
    {
      shouldContinue: () => current,
      yieldBetweenWrites: async () => {
        current = false
      },
    },
  )

  assert.deepEqual(events, ['write:one'])
})

test('skips the replay frame yield when the sink becomes stale after a write', async () => {
  const events: string[] = []
  let current = true
  const sink: StationTerminalSink = {
    ...createRecordingSink(events),
    write: async (chunk: string) => {
      events.push(`write:${chunk}`)
      current = false
    },
  }

  await drainStationTerminalPendingReplayOps(
    sink,
    [
      { kind: 'write', chunk: 'one' },
      { kind: 'write', chunk: 'stale' },
    ],
    {
      shouldContinue: () => current,
      yieldBetweenWrites: async () => {
        events.push('yield')
      },
    },
  )

  assert.deepEqual(events, ['write:one'])
})
