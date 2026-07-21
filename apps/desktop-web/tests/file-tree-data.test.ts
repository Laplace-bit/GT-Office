import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isWorkspaceNotFoundError,
  sanitizeDirectoryEntries,
} from '../src/features/file-explorer/file-tree-data.js'

test('sanitizeDirectoryEntries drops invalid, duplicate, and mismatched entries', () => {
  const result = sanitizeDirectoryEntries(
    [
      { path: 'src/main.ts', name: 'main.ts', kind: 'file' },
      { path: 'src/main.ts', name: 'main.ts', kind: 'file' },
      { path: 'src/child/util.ts', name: 'util.ts', kind: 'file' },
      { path: 'src/README.md', name: 'WRONG.md', kind: 'file' },
      { path: 'src/assets', name: 'assets', kind: 'dir' },
      { path: '', name: 'empty', kind: 'file' },
    ],
    'src',
  )

  assert.deepEqual(result, [
    { path: 'src/main.ts', name: 'main.ts', kind: 'file' },
    { path: 'src/assets', name: 'assets', kind: 'dir' },
  ])
})

test('recognizes a stale directory request after its workspace was closed', () => {
  assert.equal(isWorkspaceNotFoundError(new Error('workspace not found: ws:closed')), true)
  assert.equal(isWorkspaceNotFoundError('WORKSPACE NOT FOUND: ws:closed'), true)
  assert.equal(isWorkspaceNotFoundError(new Error('permission denied')), false)
})
