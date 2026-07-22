import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldUseStationTerminalWebglRenderer } from '../src/features/terminal/station-terminal-renderer-policy.js'

test('keeps macOS WebKit terminals on the stable default renderer', () => {
  assert.equal(shouldUseStationTerminalWebglRenderer(true), false)
})

test('keeps WebGL enabled for non-macOS-WebKit terminals', () => {
  assert.equal(shouldUseStationTerminalWebglRenderer(false), true)
})
