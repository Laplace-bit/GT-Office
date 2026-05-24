import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isQuickCommandProviderId,
  normalizeQuickCommandVisibilityByProvider,
  resolveQuickCommandDescriptionKey,
  resolveQuickCommandDisabledReasonKey,
  resolveQuickCommandPreferenceId,
} from '../src/shell/state/quick-command-metadata.js'

test('normalizes quick command visibility for supported providers only', () => {
  assert.deepEqual(
    normalizeQuickCommandVisibilityByProvider({
      claude: false,
      codex: true,
      gemini: false,
    }),
    {
      claude: false,
      codex: true,
    },
  )
})

test('does not treat gemini as a supported quick-command provider', () => {
  assert.equal(isQuickCommandProviderId('gemini'), false)
  assert.equal(isQuickCommandProviderId('claude'), true)
  assert.equal(isQuickCommandProviderId('codex'), true)
})

test('recognizes quick-command providers and normalizes slash command ids', () => {
  assert.equal(isQuickCommandProviderId('shell'), false)
  assert.equal(resolveQuickCommandPreferenceId('/resume', 'codex-resume'), 'resume')
  assert.equal(resolveQuickCommandPreferenceId(undefined, 'claude-status'), 'status')
})

test('maps disabled reasons to translation keys for the terminal rail', () => {
  assert.equal(
    resolveQuickCommandDisabledReasonKey('codex', 'Detached windows are read only'),
    'quickCommands.rail.disabled.detachedReadonly',
  )
  assert.equal(
    resolveQuickCommandDisabledReasonKey('codex', 'Start a live Codex session first'),
    'quickCommands.rail.disabled.startCodexSession',
  )
  assert.equal(resolveQuickCommandDescriptionKey('codex', 'model'), 'quickCommands.command.runtime')
})
