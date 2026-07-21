import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compactExpandedDiff,
  compactStructuredDiff,
  getLruCacheValue,
  setLruCacheValue,
} from '../src/features/git/controllers/git-cache-model.js'
import type {
  GitDiffExpansionResponse,
  GitDiffStructuredResponse,
} from '../src/shell/integration/desktop-api.js'

function buildDiff(patch: string): GitDiffStructuredResponse {
  return {
    workspaceId: 'ws-a',
    path: 'src/main.ts',
    isBinary: false,
    tooLarge: false,
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    oldPath: null,
    additions: 1,
    deletions: 0,
    hunks: [],
    patch,
  }
}

test('bounded LRU cache evicts the least recently used entry', () => {
  const cache = new Map<string, number>()
  setLruCacheValue(cache, 'a', 1, 2)
  setLruCacheValue(cache, 'b', 2, 2)
  assert.equal(getLruCacheValue(cache, 'a'), 1)

  setLruCacheValue(cache, 'c', 3, 2)

  assert.deepEqual([...cache.keys()], ['a', 'c'])
  assert.equal(cache.has('b'), false)
})

test('cached diff payloads discard unused raw patches', () => {
  const structured = compactStructuredDiff(buildDiff('raw patch'))
  assert.equal(structured.patch, '')

  const expanded: GitDiffExpansionResponse = {
    workspaceId: 'ws-a',
    path: 'src/main.ts',
    oldPath: null,
    isBinary: false,
    tooLarge: false,
    oldExists: true,
    newExists: true,
    fullDiff: buildDiff('full raw patch'),
  }
  assert.equal(compactExpandedDiff(expanded).fullDiff?.patch, '')
})
