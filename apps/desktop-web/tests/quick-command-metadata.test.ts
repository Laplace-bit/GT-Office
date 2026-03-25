import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isQuickCommandProviderId,
  normalizeQuickCommandVisibilityByProvider,
  resolveQuickCommandDescriptionKey,
  resolveQuickCommandDisabledReasonKey,
  resolveQuickCommandPreferenceId,
} from '../src/shell/state/quick-command-metadata.js'

test('normalizes quick command visibility for Gemini alongside existing providers', () => {
  assert.deepEqual(
    normalizeQuickCommandVisibilityByProvider({
      claude: false,
      codex: true,
      gemini: false,
    }),
    {
      claude: false,
      codex: true,
      gemini: false,
    },
  )
})

test('falls back to the localized Gemini command description group', () => {
  assert.equal(resolveQuickCommandDescriptionKey('gemini', 'model'), 'quickCommands.command.runtime')
  assert.equal(
    resolveQuickCommandDescriptionKey('gemini', 'totally-unknown-command'),
    'quickCommands.command.genericGemini',
  )
})

test('recognizes quick-command providers and normalizes slash command ids', () => {
  assert.equal(isQuickCommandProviderId('gemini'), true)
  assert.equal(isQuickCommandProviderId('shell'), false)
  assert.equal(resolveQuickCommandPreferenceId('/tools desc', 'gemini-tools-desc'), 'tools-desc')
  assert.equal(resolveQuickCommandPreferenceId(undefined, 'gemini-tools-desc'), 'tools-desc')
})

test('maps disabled reasons to translation keys for the terminal rail', () => {
  assert.equal(
    resolveQuickCommandDisabledReasonKey('gemini', 'Detached windows are read only'),
    'quickCommands.rail.disabled.detachedReadonly',
  )
  assert.equal(
    resolveQuickCommandDisabledReasonKey('gemini', 'Start a live Gemini session first'),
    'quickCommands.rail.disabled.startGeminiSession',
  )
  assert.equal(resolveQuickCommandDisabledReasonKey('gemini', 'Something custom'), null)
})
