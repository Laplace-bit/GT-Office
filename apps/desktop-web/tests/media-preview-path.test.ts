import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveMediaPreviewPath } from '../src/features/file-preview/previewers/media-preview-path.js'

test('defers workspace-relative preview paths until the workspace root is available', () => {
  assert.equal(
    resolveMediaPreviewPath(null, 'docs/image.png'),
    null,
  )
})

test('resolves workspace-relative preview paths against a posix workspace root', () => {
  assert.equal(
    resolveMediaPreviewPath('/Users/dzlin/work/GT-Office', 'docs/image.png'),
    '/Users/dzlin/work/GT-Office/docs/image.png',
  )
})

test('keeps absolute posix preview paths unchanged', () => {
  assert.equal(
    resolveMediaPreviewPath('/Users/dzlin/work/GT-Office', '/tmp/image.png'),
    '/tmp/image.png',
  )
})

test('resolves workspace-relative preview paths against a windows workspace root', () => {
  assert.equal(
    resolveMediaPreviewPath('C:\\workspace\\project', 'assets\\image.png'),
    'C:\\workspace\\project\\assets\\image.png',
  )
})
