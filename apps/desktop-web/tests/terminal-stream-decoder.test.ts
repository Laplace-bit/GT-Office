import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTerminalChunkDecoder,
  decodeTerminalBase64Chunk,
} from '../src/features/terminal/terminal-stream-decoder.js'

test('decodeTerminalBase64Chunk preserves utf-8 characters split across chunks', () => {
  const decoder = createTerminalChunkDecoder()
  const first = decodeTerminalBase64Chunk(decoder, '5Lg=', true)
  const second = decodeTerminalBase64Chunk(decoder, 'rQ==', true)

  assert.equal(first, '')
  assert.equal(second, '中')
})

test('decodeTerminalBase64Chunk can reset decoder state before decoding a fresh snapshot', () => {
  const decoder = createTerminalChunkDecoder()
  const partial = decodeTerminalBase64Chunk(decoder, '5Lg=', true)
  const snapshot = decodeTerminalBase64Chunk(decoder, '5Lit', false)

  assert.equal(partial, '')
  assert.equal(snapshot, '中')
})
