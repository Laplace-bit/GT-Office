import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRepositoryScopeKey,
  resolveActiveRepositoryPath,
  restoreScopedRepositorySelection,
  shouldAdoptResolvedRepositorySelection,
} from '../src/features/git/controllers/repository-selection-model.js'
import type { GitRepositorySummary } from '../src/shell/integration/desktop-api.js'

function buildRepositorySummary(
  repositoryPath: string,
  overrides: Partial<GitRepositorySummary> = {},
): GitRepositorySummary {
  return {
    repositoryPath,
    root: repositoryPath.length === 0,
    branch: 'main',
    ahead: 0,
    behind: 0,
    files: [],
    ...overrides,
  }
}

test('prefers the remembered repository when it still exists in the workspace summary', () => {
  const repositories = [
    buildRepositorySummary(''),
    buildRepositorySummary('packages/alpha'),
    buildRepositorySummary('packages/beta'),
  ]

  assert.equal(
    resolveActiveRepositoryPath('packages/beta', repositories, ''),
    'packages/beta',
  )
})

test('keeps an explicit workspace-root repository selection as a valid scope', () => {
  const repositories = [
    buildRepositorySummary(''),
    buildRepositorySummary('packages/alpha'),
  ]

  assert.equal(
    resolveActiveRepositoryPath('', repositories, 'packages/alpha'),
    '',
  )
})

test('falls back to the primary repository when the remembered repository disappears', () => {
  const repositories = [
    buildRepositorySummary(''),
    buildRepositorySummary('packages/alpha'),
  ]

  assert.equal(
    resolveActiveRepositoryPath('packages/beta', repositories, 'packages/alpha'),
    'packages/alpha',
  )
})

test('restores repository selection per workspace and clears it when no workspace is active', () => {
  const selections = new Map<string, string | null>([
    ['ws-a', 'packages/alpha'],
    ['ws-b', null],
  ])

  assert.equal(
    restoreScopedRepositorySelection('ws-a', selections),
    'packages/alpha',
  )
  assert.equal(restoreScopedRepositorySelection('ws-b', selections), null)
  assert.equal(restoreScopedRepositorySelection(null, selections), null)
})

test('adopts the resolved repository only when controller state is out of sync', () => {
  const repositories = [buildRepositorySummary(''), buildRepositorySummary('packages/alpha')]

  assert.equal(
    shouldAdoptResolvedRepositorySelection({
      activeRepositoryPath: 'packages/alpha',
      currentRepositoryPath: '',
      repositories,
    }),
    true,
  )

  assert.equal(
    shouldAdoptResolvedRepositorySelection({
      activeRepositoryPath: 'packages/alpha',
      currentRepositoryPath: 'packages/alpha',
      repositories,
    }),
    false,
  )

  assert.equal(
    shouldAdoptResolvedRepositorySelection({
      activeRepositoryPath: null,
      currentRepositoryPath: 'packages/alpha',
      repositories: [],
    }),
    true,
  )
})

test('repository scope keys distinguish auto resolution from explicit workspace root', () => {
  assert.equal(buildRepositoryScopeKey('ws-a', null), 'ws-a:<auto>')
  assert.equal(buildRepositoryScopeKey('ws-a', ''), 'ws-a:')
  assert.notEqual(
    buildRepositoryScopeKey('ws-a', null),
    buildRepositoryScopeKey('ws-a', ''),
  )
})
