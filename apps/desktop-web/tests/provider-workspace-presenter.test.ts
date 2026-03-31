import test from 'node:test'
import assert from 'node:assert/strict'

import {
  filterSavedProviders,
  resolveSavedProviderFacts,
  resolveSavedProviderMeta,
} from '../src/features/settings/ai-providers/shared/provider-workspace-presenter.js'

test('builds compact meta pills for Gemini providers', () => {
  const meta = resolveSavedProviderMeta('en-US', 'gemini', {
    savedProviderId: 'gemini-oauth',
    mode: 'preset',
    providerId: 'google-official',
    providerName: 'Gemini Official',
    baseUrl: null,
    model: 'gemini-2.5-pro',
    authMode: 'oauth',
    selectedType: 'oauth-personal',
    hasSecret: true,
    isActive: false,
    createdAtMs: 1,
    updatedAtMs: 2,
    lastAppliedAtMs: 3,
  })

  assert.deepEqual(meta, ['Preset', 'gemini-2.5-pro', 'Secret vaulted', 'OAuth'])
})

test('falls back to CLI-managed copy when an official provider has no endpoint', () => {
  const facts = resolveSavedProviderFacts('en-US', {
    savedProviderId: 'claude-official',
    mode: 'official',
    providerId: 'anthropic-official',
    providerName: 'Anthropic',
    baseUrl: null,
    model: null,
    authScheme: 'anthropic_api_key',
    hasSecret: false,
    isActive: true,
    createdAtMs: 1,
    updatedAtMs: 2,
    lastAppliedAtMs: 3,
  })

  assert.equal(facts[0]?.label, 'Endpoint')
  assert.equal(facts[0]?.value, 'Managed natively by the CLI')
  assert.equal(facts[1]?.label, 'Last applied')
})

test('filters saved providers by provider name, model, or endpoint', () => {
  const filtered = filterSavedProviders(
    'en-US',
    [
      {
        savedProviderId: 'one',
        mode: 'preset',
        providerId: 'deepseek',
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        configToml: null,
        hasSecret: true,
        isActive: false,
        createdAtMs: 1,
        updatedAtMs: 2,
        lastAppliedAtMs: 3,
      },
      {
        savedProviderId: 'two',
        mode: 'custom',
        providerId: 'custom-gateway',
        providerName: 'Local Proxy',
        baseUrl: 'http://localhost:4000',
        model: 'gpt-4.1-mini',
        configToml: null,
        hasSecret: false,
        isActive: false,
        createdAtMs: 1,
        updatedAtMs: 2,
        lastAppliedAtMs: 3,
      },
    ],
    'localhost',
  )

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]?.savedProviderId, 'two')
})
