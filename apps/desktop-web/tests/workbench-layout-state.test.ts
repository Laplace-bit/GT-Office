import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createWorkbenchContainer,
  reconcileWorkbenchContainers,
  restoreWorkbenchContainers,
} from '../src/features/workspace-hub/workbench-container-model.js'
import {
  applyWorkbenchContainerCustomLayoutChange,
  applyWorkbenchContainerLayoutModeChange,
} from '../src/features/workspace-hub/workbench-container-layout-state.js'
import { DEFAULT_WORKBENCH_CUSTOM_LAYOUT } from '../src/features/workspace-hub/workbench-layout-model.js'

const stations = [
  {
    id: 'station-1',
  },
]

test('workbench layout state restore keeps existing containers decoupled from canvas defaults', () => {
  const restored = restoreWorkbenchContainers(
    [
      {
        id: 'container-1',
        stationIds: ['station-1'],
      },
    ],
    stations,
    () => 'generated-container-id',
    {
      mode: 'focus',
      customLayout: { columns: 6, rows: 4 },
    },
  )

  assert.equal(restored.length, 1)
  assert.equal(restored[0]?.layoutMode, 'auto')
  assert.deepEqual(restored[0]?.customLayout, DEFAULT_WORKBENCH_CUSTOM_LAYOUT)
})

test('workbench layout state reconcile preserves container-local layout after default changes', () => {
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
    {
      mode: 'focus',
      customLayout: { columns: 4, rows: 2 },
    },
  )

  assert.equal(reconciled.length, 1)
  assert.equal(reconciled[0]?.layoutMode, 'custom')
  assert.deepEqual(reconciled[0]?.customLayout, { columns: 1, rows: 3 })
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
