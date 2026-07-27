import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialWorkbenchContainers,
  createWorkbenchContainer,
  reconcileWorkbenchContainers,
  restoreWorkbenchContainers,
} from '../src/features/workspace-hub/workbench-container-model.js'
import {
  applyWorkbenchContainerCustomLayoutChange,
  applyWorkbenchContainerFullscreenStationChange,
  applyWorkbenchContainerLayoutModeChange,
  applyWorkbenchStationMove,
} from '../src/features/workspace-hub/workbench-container-layout-state.js'
import { DEFAULT_WORKBENCH_CUSTOM_LAYOUT } from '../src/features/workspace-hub/workbench-layout-model.js'

const stations = [
  {
    id: 'station-1',
  },
]

test('workbench layout state restore defaults missing container layout to auto', () => {
  const restored = restoreWorkbenchContainers(
    [
      {
        id: 'container-1',
        stationIds: ['station-1'],
      },
    ],
    stations,
    () => 'generated-container-id',
  )

  assert.equal(restored.length, 1)
  assert.equal(restored[0]?.layoutMode, 'auto')
  assert.deepEqual(restored[0]?.customLayout, DEFAULT_WORKBENCH_CUSTOM_LAYOUT)
})

test('new workbench containers default to auto layout', () => {
  const containers = createInitialWorkbenchContainers(stations, () => 'generated-container-id')

  assert.equal(containers[0]?.layoutMode, 'auto')
  assert.deepEqual(containers[0]?.customLayout, DEFAULT_WORKBENCH_CUSTOM_LAYOUT)
})

test('workbench restore keeps a saved layout mode over the auto default', () => {
  const restored = restoreWorkbenchContainers(
    [
      {
        id: 'container-1',
        stationIds: ['station-1'],
        layoutMode: 'focus',
      },
    ],
    stations,
    () => 'generated-container-id',
  )

  assert.equal(restored[0]?.layoutMode, 'focus')
})

test('workbench layout state reconcile preserves container-local layout', () => {
  const container = createWorkbenchContainer({
    id: 'container-1',
    stationIds: ['station-1'],
    activeStationId: 'station-1',
    layoutMode: 'custom',
    customLayout: { columns: 1, rows: 3 },
  })

  const reconciled = reconcileWorkbenchContainers(
    [container],
    stations,
    () => 'generated-container-id',
  )

  assert.equal(reconciled.length, 1)
  assert.equal(reconciled[0]?.layoutMode, 'custom')
  assert.deepEqual(reconciled[0]?.customLayout, { columns: 1, rows: 3 })
})

test('reconciliation retains a container station order across inventory refreshes', () => {
  const container = createWorkbenchContainer({
    id: 'container-1',
    stationIds: ['station-2', 'station-1'],
    activeStationId: 'station-2',
  })

  const reconciled = reconcileWorkbenchContainers(
    [container],
    [{ id: 'station-1' }, { id: 'station-2' }],
    () => 'generated-container-id',
  )

  assert.deepEqual(reconciled[0]?.stationIds, ['station-2', 'station-1'])
})

test('layout mode changes stay local to the targeted container', () => {
  const containers = [
    createWorkbenchContainer({
      id: 'container-1',
      stationIds: ['station-1'],
      activeStationId: 'station-1',
      layoutMode: 'auto',
    }),
    createWorkbenchContainer({
      id: 'container-2',
      layoutMode: 'focus',
    }),
  ]

  const next = applyWorkbenchContainerLayoutModeChange(containers, 'container-1', 'custom')

  assert.equal(next[0]?.layoutMode, 'custom')
  assert.equal(next[1]?.layoutMode, 'focus')
})

test('custom layout changes do not mutate other containers', () => {
  const containers = [
    createWorkbenchContainer({
      id: 'container-1',
      stationIds: ['station-1'],
      activeStationId: 'station-1',
      layoutMode: 'auto',
    }),
    createWorkbenchContainer({
      id: 'container-2',
      layoutMode: 'focus',
    }),
  ]

  const next = applyWorkbenchContainerCustomLayoutChange(containers, 'container-1', {
    columns: 3,
    rows: 2,
  })

  assert.equal(next[0]?.layoutMode, 'custom')
  assert.deepEqual(next[0]?.customLayout, { columns: 3, rows: 2 })
  assert.equal(next[1]?.layoutMode, 'focus')
})

test('fullscreen station changes stay local to the targeted container', () => {
  const containers = [
    createWorkbenchContainer({
      id: 'container-1',
      stationIds: ['station-1'],
      activeStationId: 'station-1',
    }),
    createWorkbenchContainer({
      id: 'container-2',
      stationIds: ['station-2'],
      activeStationId: 'station-2',
      fullscreenStationId: null,
    }),
  ]

  const next = applyWorkbenchContainerFullscreenStationChange(containers, 'container-1', 'station-1')

  assert.equal(next[0]?.fullscreenStationId, 'station-1')
  assert.equal(next[1]?.fullscreenStationId, null)
})

test('workbench restore preserves valid fullscreen station ids', () => {
  const restored = restoreWorkbenchContainers(
    [
      {
        id: 'container-1',
        stationIds: ['station-1'],
        activeStationId: 'station-1',
        fullscreenStationId: 'station-1',
      },
    ],
    stations,
    () => 'generated-container-id',
  )

  assert.equal(restored[0]?.fullscreenStationId, 'station-1')
})

test('station drag can reorder stations within its current workbench container', () => {
  const containers = [
    createWorkbenchContainer({
      id: 'container-1',
      stationIds: ['station-1', 'station-2', 'station-3'],
      activeStationId: 'station-2',
    }),
  ]

  const next = applyWorkbenchStationMove(containers, 'station-1', {
    containerId: 'container-1',
    anchorStationId: 'station-3',
    placement: 'after',
  })

  assert.deepEqual(next[0]?.stationIds, ['station-2', 'station-3', 'station-1'])
  assert.equal(next[0]?.activeStationId, 'station-1')
})

test('station drag inserts into another container at the hovered station', () => {
  const containers = [
    createWorkbenchContainer({
      id: 'container-1',
      stationIds: ['station-1', 'station-2'],
      activeStationId: 'station-1',
      fullscreenStationId: 'station-1',
      minimizedStationIds: ['station-1'],
    }),
    createWorkbenchContainer({
      id: 'container-2',
      stationIds: ['station-3', 'station-4'],
      activeStationId: 'station-3',
    }),
  ]

  const next = applyWorkbenchStationMove(containers, 'station-1', {
    containerId: 'container-2',
    anchorStationId: 'station-4',
    placement: 'before',
  })

  assert.deepEqual(next[0]?.stationIds, ['station-2'])
  assert.equal(next[0]?.activeStationId, 'station-2')
  assert.equal(next[0]?.fullscreenStationId, null)
  assert.deepEqual(next[0]?.minimizedStationIds, [])
  assert.deepEqual(next[1]?.stationIds, ['station-3', 'station-1', 'station-4'])
  assert.equal(next[1]?.activeStationId, 'station-1')
})
