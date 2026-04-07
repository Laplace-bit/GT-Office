import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listStationTaskAckEmojis,
  resolveStationTaskAckEmoji,
} from '../src/features/workspace-hub/station-task-ack-emoji.js'

test('station task ack emoji pool includes at least ten options', () => {
  const emojis = listStationTaskAckEmojis()

  assert.ok(emojis.length >= 10)
  assert.ok(emojis.includes('👌🏻'))
})

test('station task ack emoji selection is stable for the same nonce', () => {
  assert.equal(resolveStationTaskAckEmoji(7), resolveStationTaskAckEmoji(7))
  assert.equal(resolveStationTaskAckEmoji(-7), resolveStationTaskAckEmoji(7))
})

test('station task ack emoji selection stays within the emoji pool', () => {
  const emojis = new Set(listStationTaskAckEmojis())

  for (const nonce of [0, 1, 2, 9, 10, 11, 25, 99]) {
    assert.ok(emojis.has(resolveStationTaskAckEmoji(nonce)))
  }
})
