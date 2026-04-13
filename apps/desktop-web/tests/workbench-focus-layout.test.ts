import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveFocusStageStationVisibility,
  resolveRenderedActiveStationId,
} from '../src/features/workspace-hub/WorkbenchCanvasPanel.js'

test('focus layout makes non-selected stage slots inert so they cannot block terminal interaction', () => {
  assert.deepEqual(resolveFocusStageStationVisibility('station-b', 'station-a', 'stable'), {
    focusHidden: true,
    inert: true,
  })
  assert.deepEqual(resolveFocusStageStationVisibility('station-b', 'station-a', 'entering'), {
    focusHidden: true,
    inert: true,
  })
})

test('focus layout keeps the selected stage slot interactive', () => {
  assert.deepEqual(resolveFocusStageStationVisibility('station-a', 'station-a', 'stable'), {
    focusHidden: false,
    inert: false,
  })
})

test('focus layout does not treat parked or exiting slots as interactive blockers', () => {
  assert.deepEqual(resolveFocusStageStationVisibility('station-b', 'station-a', 'parked'), {
    focusHidden: false,
    inert: false,
  })
  assert.deepEqual(resolveFocusStageStationVisibility('station-b', 'station-a', 'exiting'), {
    focusHidden: true,
    inert: false,
  })
})

test('focus layout renders the selected station as active even when the global active station differs', () => {
  assert.equal(resolveRenderedActiveStationId('focus', 'station-a', 'station-b'), 'station-a')
})

test('non-focus layouts keep following the effective active station', () => {
  assert.equal(resolveRenderedActiveStationId('auto', 'station-a', 'station-b'), 'station-b')
  assert.equal(resolveRenderedActiveStationId('custom', 'station-a', 'station-b'), 'station-b')
})
