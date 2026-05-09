import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeDirectoryEntries } from '../src/features/file-explorer/file-tree-data.js'

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
