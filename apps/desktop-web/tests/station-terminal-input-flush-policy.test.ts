import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldFlushStationInputImmediately,
} from '../src/features/terminal/station-terminal-input-flush-policy.js'

test('terminal input flush policy keeps short printable input buffered', () => {
  assert.equal(shouldFlushStationInputImmediately('abc'), false)
})

test('terminal input flush policy flushes submit and control input immediately', () => {
  assert.equal(shouldFlushStationInputImmediately('echo ok\r'), true)
  assert.equal(shouldFlushStationInputImmediately('\u001b[A'), true)
})

test('terminal input flush policy uses utf-8 bytes for pasted multibyte input', () => {
  assert.equal(shouldFlushStationInputImmediately('你好你好你好你好'), true)
})

test('terminal input flush policy keeps short multibyte input buffered under the byte threshold', () => {
  assert.equal(shouldFlushStationInputImmediately('你好'), false)
})
