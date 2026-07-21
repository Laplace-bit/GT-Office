import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCompactPathTail,
  getCompactRepoLabel,
  getDirectoryLabel,
  getRepositoryDisplayLabel,
  hasStagedChanges,
  hasUnstagedChanges,
  resolveDiffScope,
  resolveDiscardKind,
} from '../src/features/git/components/git-helpers.js'

test('repository display helpers keep multi-repo labels compact and stable', () => {
  assert.equal(getCompactRepoLabel('packages/alpha'), 'packages/alpha')
  assert.equal(getCompactRepoLabel('/workspace/packages/alpha/'), 'packages/alpha')
  assert.equal(getCompactRepoLabel('alpha'), 'alpha')
  assert.equal(getCompactRepoLabel(''), 'Workspace')

  assert.equal(
    getRepositoryDisplayLabel('packages/alpha', false, 'Workspace Root'),
    'packages/alpha',
  )
  assert.equal(
    getRepositoryDisplayLabel('packages/alpha', true, 'Workspace Root'),
    'Workspace Root',
  )
  assert.equal(getDirectoryLabel('src/features/panel.tsx'), 'src/features')
  assert.equal(getDirectoryLabel('panel.tsx'), '.')
  assert.equal(getCompactPathTail('src/features/panel'), 'features/panel')
  assert.equal(getCompactPathTail('src/features/deeper/panel', '.', 3), 'features/deeper/panel')
  assert.equal(getCompactPathTail('.'), '.')
})

test('git file helpers keep staged and unstaged actions repo-safe', () => {
  const mixedFile = {
    path: 'packages/alpha/src/index.ts',
    repoRelativePath: 'src/index.ts',
    repositoryPath: 'packages/alpha',
    status: 'MM',
    staged: true,
    entryKind: 'file' as const,
  }
  const stagedFile = {
    path: 'packages/alpha/src/index.ts',
    repoRelativePath: 'src/index.ts',
    repositoryPath: 'packages/alpha',
    status: 'M ',
    staged: true,
    entryKind: 'file' as const,
  }
  const untrackedFile = {
    path: 'packages/alpha/src/new.ts',
    repoRelativePath: 'src/new.ts',
    repositoryPath: 'packages/alpha',
    status: '??',
    staged: false,
    entryKind: 'file' as const,
  }
  const indexNewFile = {
    path: 'packages/alpha/src/new.ts',
    repoRelativePath: 'src/new.ts',
    repositoryPath: 'packages/alpha',
    status: 'A ',
    staged: true,
    entryKind: 'file' as const,
  }
  const indexNewWithWorktreeChanges = {
    ...indexNewFile,
    status: 'AM',
  }

  assert.equal(hasStagedChanges(mixedFile), true)
  assert.equal(hasUnstagedChanges(mixedFile), true)
  assert.equal(resolveDiffScope(mixedFile, 'unstaged'), 'unstaged')

  assert.equal(hasStagedChanges(stagedFile), true)
  assert.equal(hasUnstagedChanges(stagedFile), false)
  assert.equal(resolveDiffScope(stagedFile, 'staged'), 'staged')

  assert.equal(hasStagedChanges(untrackedFile), false)
  assert.equal(hasUnstagedChanges(untrackedFile), true)
  assert.equal(resolveDiscardKind(untrackedFile), 'untracked')

  assert.equal(resolveDiscardKind(indexNewFile), 'index-new')
  assert.equal(resolveDiscardKind(indexNewWithWorktreeChanges), 'tracked')
  assert.equal(resolveDiscardKind(stagedFile), 'tracked')
})
