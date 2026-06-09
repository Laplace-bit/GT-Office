import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendDetachedTerminalOutput,
  buildDetachedTerminalOutputAppendKey,
  DETACHED_TERMINAL_OUTPUT_APPEND_MESSAGE_CHAR_LIMIT,
  DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS,
  normalizeDetachedTerminalUnreadDelta,
  queueDetachedTerminalOutputAppendDraft,
  takeDetachedTerminalOutputAppendDrafts,
  type DetachedTerminalOutputAppendDraft,
} from '../src/features/workspace-hub/detached-terminal-bridge.js'

test('appends terminal output without trimming under the cache limit', () => {
  assert.equal(appendDetachedTerminalOutput('hello ', 'world'), 'hello world')
})

test('keeps the previous cache when the appended chunk is empty', () => {
  assert.equal(appendDetachedTerminalOutput('existing output', ''), 'existing output')
  assert.equal(appendDetachedTerminalOutput(undefined, ''), '')
})

test('trims the previous cache before appending large terminal output chunks', () => {
  const previous = 'a'.repeat(DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS)
  const chunk = 'b'.repeat(128)
  const output = appendDetachedTerminalOutput(previous, chunk)

  assert.equal(output.length, DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS)
  assert.equal(output, `${'a'.repeat(DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS - chunk.length)}${chunk}`)
})

test('keeps only the tail when one appended chunk exceeds the cache limit', () => {
  const chunk = `${'x'.repeat(32)}${'z'.repeat(DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS)}`
  const output = appendDetachedTerminalOutput('discarded', chunk)

  assert.equal(output.length, DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS)
  assert.equal(output, 'z'.repeat(DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS))
})

test('normalizes detached terminal unread deltas without inflating split output fragments', () => {
  assert.equal(normalizeDetachedTerminalUnreadDelta(undefined), 1)
  assert.equal(normalizeDetachedTerminalUnreadDelta(null), 1)
  assert.equal(normalizeDetachedTerminalUnreadDelta(0), 0)
  assert.equal(normalizeDetachedTerminalUnreadDelta(2.8), 2)
  assert.equal(normalizeDetachedTerminalUnreadDelta(Number.NaN), 0)
  assert.equal(normalizeDetachedTerminalUnreadDelta(-4), 0)
})

test('keeps split detached output fragments from incrementing unread more than once', () => {
  const forwardedDeltas = [3, 0, 0].map((delta) => normalizeDetachedTerminalUnreadDelta(delta))

  assert.deepEqual(forwardedDeltas, [3, 0, 0])
})

test('coalesces detached terminal output append drafts by workspace container and station', () => {
  const queue: Record<string, DetachedTerminalOutputAppendDraft> = {}
  const firstKey = queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace:one',
    containerId: 'container:one',
    stationId: 'station:one',
    chunk: 'one',
    unreadDelta: 1,
  })
  const secondKey = queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace:one',
    containerId: 'container:one',
    stationId: 'station:one',
    chunk: 'two',
    unreadDelta: 2,
  })

  assert.equal(firstKey, buildDetachedTerminalOutputAppendKey({
    workspaceId: 'workspace:one',
    containerId: 'container:one',
    stationId: 'station:one',
  }))
  assert.equal(secondKey, firstKey)
  assert.equal(Object.keys(queue).length, 1)
  assert.deepEqual(queue[firstKey ?? ''], {
    kind: 'detached_terminal_output_append',
    workspaceId: 'workspace:one',
    containerId: 'container:one',
    stationId: 'station:one',
    chunk: 'onetwo',
    unreadDelta: 3,
  })
})

test('keeps detached terminal output append draft keys collision-resistant', () => {
  assert.notEqual(
    buildDetachedTerminalOutputAppendKey({
      workspaceId: 'a:b',
      containerId: 'c',
      stationId: 'd',
    }),
    buildDetachedTerminalOutputAppendKey({
      workspaceId: 'a',
      containerId: 'b:c',
      stationId: 'd',
    }),
  )
})

test('caps detached terminal output append draft unread deltas and ignores invalid input', () => {
  const queue: Record<string, DetachedTerminalOutputAppendDraft> = {}
  assert.equal(queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: '',
    containerId: 'container',
    stationId: 'station',
    chunk: 'ignored',
  }), null)
  assert.equal(queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
    chunk: '',
  }), null)

  const key = queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
    chunk: 'chunk',
    unreadDelta: 1200,
  })
  assert.equal(key, buildDetachedTerminalOutputAppendKey({
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
  }))
  assert.equal(queue[key ?? '']?.unreadDelta, 999)

  queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
    chunk: 'more',
    unreadDelta: Number.NaN,
  })
  assert.equal(queue[key ?? '']?.unreadDelta, 999)
})

test('takes detached terminal output append drafts with projection sequence and clears the queue', () => {
  const queue: Record<string, DetachedTerminalOutputAppendDraft> = {}
  queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station-a',
    chunk: 'a',
    unreadDelta: 1,
  })
  queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station-b',
    chunk: 'b',
    unreadDelta: 0,
  })

  const stationSeqs: string[] = []
  const messages = takeDetachedTerminalOutputAppendDrafts(queue, {
    nextProjectionSeq: (stationId) => {
      stationSeqs.push(stationId)
      return stationSeqs.length
    },
  })

  assert.deepEqual(stationSeqs, ['station-a', 'station-b'])
  assert.deepEqual(messages, [
    {
      kind: 'detached_terminal_output_append',
      workspaceId: 'workspace',
      containerId: 'container',
      stationId: 'station-a',
      chunk: 'a',
      unreadDelta: 1,
      projectionSeq: 1,
    },
    {
      kind: 'detached_terminal_output_append',
      workspaceId: 'workspace',
      containerId: 'container',
      stationId: 'station-b',
      chunk: 'b',
      unreadDelta: 0,
      projectionSeq: 2,
    },
  ])
  assert.deepEqual(queue, {})
})

test('splits large detached terminal output append drafts into bounded projection messages', () => {
  const queue: Record<string, DetachedTerminalOutputAppendDraft> = {}
  queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
    chunk: 'abcdefg',
    unreadDelta: 4,
  })

  let nextSeq = 0
  const messages = takeDetachedTerminalOutputAppendDrafts(queue, {
    messageCharLimit: 3,
    nextProjectionSeq: (stationId) => {
      assert.equal(stationId, 'station')
      nextSeq += 1
      return nextSeq
    },
  })

  assert.deepEqual(messages.map((message) => message.chunk), ['abc', 'def', 'g'])
  assert.deepEqual(messages.map((message) => message.unreadDelta), [4, 0, 0])
  assert.deepEqual(messages.map((message) => message.projectionSeq), [1, 2, 3])
  assert.deepEqual(queue, {})
})

test('splits detached terminal output append drafts by code point without breaking emoji', () => {
  const queue: Record<string, DetachedTerminalOutputAppendDraft> = {}
  queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
    chunk: 'a🙂b🙂c',
    unreadDelta: 1,
  })

  let nextSeq = 0
  const messages = takeDetachedTerminalOutputAppendDrafts(queue, {
    messageCharLimit: 2,
    nextProjectionSeq: () => {
      nextSeq += 1
      return nextSeq
    },
  })

  assert.deepEqual(messages.map((message) => message.chunk), ['a🙂', 'b🙂', 'c'])
  assert.deepEqual(messages.map((message) => message.projectionSeq), [1, 2, 3])
})

test('uses the detached terminal output append default message limit', () => {
  const queue: Record<string, DetachedTerminalOutputAppendDraft> = {}
  queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
    chunk: `${'x'.repeat(DETACHED_TERMINAL_OUTPUT_APPEND_MESSAGE_CHAR_LIMIT)}y`,
    unreadDelta: 2,
  })

  let nextSeq = 0
  const messages = takeDetachedTerminalOutputAppendDrafts(queue, {
    nextProjectionSeq: () => {
      nextSeq += 1
      return nextSeq
    },
  })

  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.chunk.length, DETACHED_TERMINAL_OUTPUT_APPEND_MESSAGE_CHAR_LIMIT)
  assert.equal(messages[1]?.chunk, 'y')
  assert.deepEqual(messages.map((message) => message.unreadDelta), [2, 0])
})

test('drops detached terminal output append drafts when message limit is invalid', () => {
  const queue: Record<string, DetachedTerminalOutputAppendDraft> = {}
  queueDetachedTerminalOutputAppendDraft(queue, {
    workspaceId: 'workspace',
    containerId: 'container',
    stationId: 'station',
    chunk: 'output',
    unreadDelta: 1,
  })

  const messages = takeDetachedTerminalOutputAppendDrafts(queue, {
    messageCharLimit: Number.NaN,
    nextProjectionSeq: () => 1,
  })

  assert.deepEqual(messages, [])
  assert.deepEqual(queue, {})
})
