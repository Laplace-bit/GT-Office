import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDefaultAgentWorkdir,
  resolveAvailableAgentProviders,
  resolvePromptFileNameForProvider,
} from '../src/features/workspace-hub/agent-management-model.js'

test('builds the new shallow default agent workdir', () => {
  assert.equal(buildDefaultAgentWorkdir('My Product Agent'), '.gtoffice/my-product-agent')
  assert.equal(buildDefaultAgentWorkdir('  Claude负责人  '), '.gtoffice/claude')
})

test('maps providers to the correct system prompt filenames', () => {
  assert.equal(resolvePromptFileNameForProvider('claude'), 'CLAUDE.md')
  assert.equal(resolvePromptFileNameForProvider('codex'), 'AGENTS.md')
  assert.equal(resolvePromptFileNameForProvider('gemini'), 'GEMINI.md')
})

test('only exposes configured or installed providers for the agent form', () => {
  const providers = resolveAvailableAgentProviders([
    {
      agent: 'claude',
      installStatus: {
        installed: true,
      },
      configStatus: 'guidance_only',
    },
    {
      agent: 'codex',
      installStatus: {
        installed: false,
      },
      configStatus: 'configured',
    },
    {
      agent: 'gemini',
      installStatus: {
        installed: false,
      },
      configStatus: 'guidance_only',
    },
  ])

  assert.deepEqual(
    providers.map((item) => item.key),
    ['claude', 'codex'],
  )
})
