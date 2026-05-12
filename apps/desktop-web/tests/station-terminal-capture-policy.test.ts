import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTerminalSerializeDelayMs } from '../src/features/terminal/station-terminal-capture-policy.js'

test('serializes immediately before the first capture', () => {
  assert.equal(resolveTerminalSerializeDelayMs(0, 5_000, 1_000), 0)
})

test('throttles repeated serialize requests until the minimum interval elapses', () => {
  assert.equal(resolveTerminalSerializeDelayMs(10_000, 10_250, 1_000), 750)
  assert.equal(resolveTerminalSerializeDelayMs(10_000, 11_000, 1_000), 0)
})

test('treats clock skew as no elapsed time instead of scheduling a negative delay', () => {
  assert.equal(resolveTerminalSerializeDelayMs(10_000, 9_500, 1_000), 1_000)
})
