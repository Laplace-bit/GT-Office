import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isSingleStationFocusLayout,
  preserveFocusTabOrder,
  resolveFocusStageStationVisibility,
  resolveRenderedActiveStationId,
  shouldUseSingleStationFillLayout,
} from '../src/features/workspace-hub/workbench-focus-layout-model.js'

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

test('focus tabs retain the container order when a different station becomes active', () => {
  const visible = new Set(['station-a', 'station-b', 'station-c'])

  assert.deepEqual(
    preserveFocusTabOrder(['station-b', 'station-a', 'station-c'], visible),
    ['station-b', 'station-a', 'station-c'],
  )
})

test('a single visible station uses the full-size focus stage', () => {
  assert.equal(isSingleStationFocusLayout('focus', 1), true)
  assert.equal(isSingleStationFocusLayout('focus', 2), false)
  assert.equal(isSingleStationFocusLayout('auto', 1), false)
})

test('any layout with one visible station fills the stage like maximize', () => {
  assert.equal(shouldUseSingleStationFillLayout(1), true)
  assert.equal(shouldUseSingleStationFillLayout(0), false)
  assert.equal(shouldUseSingleStationFillLayout(2), false)
})

test('focus layout renders the selected station as active even when the global active station differs', () => {
  assert.equal(resolveRenderedActiveStationId('focus', 'station-a', 'station-b'), 'station-a')
})

test('non-focus layouts keep following the effective active station', () => {
  assert.equal(resolveRenderedActiveStationId('auto', 'station-a', 'station-b'), 'station-b')
  assert.equal(resolveRenderedActiveStationId('custom', 'station-a', 'station-b'), 'station-b')
})
