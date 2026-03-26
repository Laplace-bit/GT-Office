import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveFileSearchEntries } from '../src/features/file-explorer/file-search-state.js'

test('keeps backend filename matches even when the tree has not loaded that directory', () => {
  assert.deepEqual(
    resolveFileSearchEntries([
      {
        path: 'nested/deep/target-file.ts',
        name: 'target-file.ts',
      },
    ]),
    [
      {
        path: 'nested/deep/target-file.ts',
        name: 'target-file.ts',
        kind: 'file',
      },
    ],
  )
})

test('deduplicates backend filename matches by path', () => {
  assert.deepEqual(
    resolveFileSearchEntries([
      {
        path: 'nested/deep/target-file.ts',
        name: 'target-file.ts',
      },
      {
        path: 'nested/deep/target-file.ts',
        name: 'target-file.ts',
      },
    ]),
    [
      {
        path: 'nested/deep/target-file.ts',
        name: 'target-file.ts',
        kind: 'file',
      },
    ],
  )
})
