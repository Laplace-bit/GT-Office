import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLeftPaneSlotClassName } from '../src/shell/layout/left-pane-layout.js'

test('uses the stretch slot class when the pane is visible', () => {
  assert.equal(resolveLeftPaneSlotClassName(true), 'shell-left-pane-slot')
})

test('keeps the stretch slot class while marking hidden slots as hidden', () => {
  assert.equal(
    resolveLeftPaneSlotClassName(false),
    'shell-left-pane-slot shell-left-pane-slot--hidden',
  )
})
