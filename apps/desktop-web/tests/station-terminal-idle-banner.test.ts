import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStationTerminalIdleBanner } from '../src/features/terminal/station-terminal-idle-banner.js'

test('buildStationTerminalIdleBanner stays empty in production', () => {
  assert.equal(buildStationTerminalIdleBanner(), '')
})
