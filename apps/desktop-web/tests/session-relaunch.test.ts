import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSessionRelaunchLaunchCommand } from '../src/features/session/session-relaunch.js'

test('buildSessionRelaunchLaunchCommand claude resume with id', () => {
  assert.equal(
    buildSessionRelaunchLaunchCommand('resume', 'claude', '550e8400-e29b-41d4-a716-446655440000'),
    'claude --resume 550e8400-e29b-41d4-a716-446655440000',
  )
})

test('buildSessionRelaunchLaunchCommand codex continue last', () => {
  assert.equal(buildSessionRelaunchLaunchCommand('continueLast', 'codex'), 'codex resume --last')
})

test('buildSessionRelaunchLaunchCommand claude fork last', () => {
  assert.equal(
    buildSessionRelaunchLaunchCommand('forkLast', 'claude'),
    'claude --fork-session --continue',
  )
})
