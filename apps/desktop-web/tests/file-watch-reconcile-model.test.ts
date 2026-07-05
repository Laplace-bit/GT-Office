import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeWatchPath,
  resolveOpenedEditorPathsForWatchEvent,
  watchPathAffectsOpenedPath,
} from '../src/shell/layout/file-watch-reconcile-model.js'

const openedFiles = [
  { path: 'src/app.ts', hydrated: true, viewType: 'editor' as const },
  { path: 'src/nested/view.tsx', hydrated: true, viewType: 'editor' as const },
  { path: 'README.md', hydrated: true, viewType: 'editor' as const },
  { path: 'media/screenshot.png', hydrated: true, viewType: 'preview' as const },
  { path: 'docs/lazy.md', hydrated: false, viewType: 'editor' as const },
]

test('normalizes watcher paths into workspace-relative paths', () => {
  assert.equal(normalizeWatchPath('./src/app.ts'), 'src/app.ts')
  assert.equal(normalizeWatchPath('src/app.ts/'), 'src/app.ts')
  assert.equal(normalizeWatchPath('.'), '.')
  assert.equal(normalizeWatchPath(''), '.')
})

test('matches exact files, parent directories, and root events', () => {
  assert.equal(watchPathAffectsOpenedPath('src/app.ts', 'src/app.ts'), true)
  assert.equal(watchPathAffectsOpenedPath('src', 'src/app.ts'), true)
  assert.equal(watchPathAffectsOpenedPath('.', 'src/app.ts'), true)
  assert.equal(watchPathAffectsOpenedPath('src/app', 'src/app.ts'), false)
  assert.equal(watchPathAffectsOpenedPath('source', 'src/app.ts'), false)
})

test('resolves watcher payload paths to hydrated editor files that need stat reconciliation', () => {
  assert.deepEqual(
    resolveOpenedEditorPathsForWatchEvent(openedFiles, ['src']),
    ['src/app.ts', 'src/nested/view.tsx'],
  )
  assert.deepEqual(
    resolveOpenedEditorPathsForWatchEvent(openedFiles, ['./README.md']),
    ['README.md'],
  )
  assert.deepEqual(
    resolveOpenedEditorPathsForWatchEvent(openedFiles, ['.']),
    ['src/app.ts', 'src/nested/view.tsx', 'README.md'],
  )
  assert.deepEqual(resolveOpenedEditorPathsForWatchEvent(openedFiles, ['media']), [])
  assert.deepEqual(resolveOpenedEditorPathsForWatchEvent(openedFiles, ['docs']), [])
})
