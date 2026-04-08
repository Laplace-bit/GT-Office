import test from 'node:test'
import assert from 'node:assert/strict'
import { isImageLoaded } from '../src/features/file-preview/previewers/image-load-state.js'

test('treats a completed image with pixels as loaded', () => {
  assert.equal(isImageLoaded({ complete: true, naturalWidth: 1280 }), true)
})

test('treats an incomplete image as not loaded', () => {
  assert.equal(isImageLoaded({ complete: false, naturalWidth: 1280 }), false)
})

test('treats a broken image as not loaded', () => {
  assert.equal(isImageLoaded({ complete: true, naturalWidth: 0 }), false)
})
