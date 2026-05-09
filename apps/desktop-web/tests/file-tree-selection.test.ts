import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveExistingTreeSelectionPath } from '../src/features/file-explorer/file-tree-selection.js'

test('returns undefined when selection path is missing from the current tree', () => {
  const next = resolveExistingTreeSelectionPath('src/old.ts', {
    'src/new.ts': 'file',
    src: 'dir',
  })

  assert.equal(next, undefined)
})

test('returns the selection path when it exists in the current tree', () => {
  const next = resolveExistingTreeSelectionPath('src/new.ts', {
    'src/new.ts': 'file',
    src: 'dir',
  })

  assert.equal(next, 'src/new.ts')
})

test('returns undefined for empty selection values', () => {
  assert.equal(resolveExistingTreeSelectionPath('', { src: 'dir' }), undefined)
  assert.equal(resolveExistingTreeSelectionPath(null, { src: 'dir' }), undefined)
})
