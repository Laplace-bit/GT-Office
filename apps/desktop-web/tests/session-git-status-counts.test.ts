import test from 'node:test'
import assert from 'node:assert/strict'

import {
  countCompleteGitStatusFiles,
  countGitStatusFiles,
} from '../src/features/session/git-status-counts.js'
import type { GitStatusFile } from '../src/shell/integration/desktop-api.js'

function statusFile(status: string, staged = false): GitStatusFile {
  return {
    path: `file-${status.trim() || 'modified'}`,
    staged,
    status,
    repositoryPath: '',
    repoRelativePath: 'file.txt',
    entryKind: 'file',
  }
}

test('counts stable two-column porcelain status entries', () => {
  const counts = countGitStatusFiles([
    statusFile('M ', true),
    statusFile(' M'),
    statusFile('MM', true),
    statusFile('??'),
  ])

  assert.deepEqual(counts, {
    stagedFiles: 2,
    unstagedFiles: 2,
    untrackedFiles: 1,
  })
})

test('uses staged as a fallback for legacy one-column status entries', () => {
  assert.deepEqual(countGitStatusFiles([statusFile('M', true), statusFile('M')]), {
    stagedFiles: 1,
    unstagedFiles: 1,
    untrackedFiles: 0,
  })
})

test('does not publish exact activity counts from a truncated status payload', () => {
  const files = [statusFile('M ', true)]

  assert.equal(countCompleteGitStatusFiles(files, true), null)
  assert.deepEqual(countCompleteGitStatusFiles(files, false), {
    stagedFiles: 1,
    unstagedFiles: 0,
    untrackedFiles: 0,
  })
})
