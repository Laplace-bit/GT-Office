import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendDetachedTerminalOutput,
  DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS,
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
