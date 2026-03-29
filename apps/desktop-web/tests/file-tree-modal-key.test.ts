import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFileTreeModalKey } from '../src/features/file-explorer/file-tree-modal-key.js'

test('file tree modal keys remain unique even when both modals are closed and empty', () => {
  const promptKey = buildFileTreeModalKey('prompt', false, '', '')
  const confirmKey = buildFileTreeModalKey('confirm', false, '', '')

  assert.equal(promptKey, 'prompt:closed::')
  assert.equal(confirmKey, 'confirm:closed::')
  assert.notEqual(promptKey, confirmKey)
})
