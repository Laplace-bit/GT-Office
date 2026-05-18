import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDefaultAgentWorkdir,
  isWorkspaceRootAgentWorkdir,
  resolveAvailableAgentProviders,
  resolvePromptFileRelativePathForProvider,
  resolvePromptFileNameForProvider,
} from '../src/features/workspace-hub/agent-management-model.js'

test('builds the new shallow default agent workdir', () => {
  assert.equal(buildDefaultAgentWorkdir('My Product Agent'), '.')
  assert.equal(buildDefaultAgentWorkdir('  Claude负责人  '), '.')
})

test('maps providers to the correct system prompt filenames', () => {
  assert.equal(resolvePromptFileNameForProvider('claude'), 'CLAUDE.md')
  assert.equal(resolvePromptFileNameForProvider('codex'), 'AGENTS.md')
  assert.equal(resolvePromptFileNameForProvider('gemini'), 'GEMINI.md')
})

test('resolves prompt file paths against the selected workdir', () => {
  assert.equal(resolvePromptFileRelativePathForProvider('codex', '.'), 'AGENTS.md')
  assert.equal(resolvePromptFileRelativePathForProvider('claude', '.gtoffice/research'), '.gtoffice/research/CLAUDE.md')
  assert.equal(resolvePromptFileRelativePathForProvider('gemini', 'notes'), 'notes/GEMINI.md')
})

test('recognizes workspace-root agent workdirs', () => {
  assert.equal(isWorkspaceRootAgentWorkdir('.'), true)
  assert.equal(isWorkspaceRootAgentWorkdir(''), true)
  assert.equal(isWorkspaceRootAgentWorkdir('.gtoffice/research'), false)
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
