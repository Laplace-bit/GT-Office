import test from 'node:test'
import assert from 'node:assert/strict'
import {
  captureWorkspacePresentationCacheEntry,
  putWorkspacePresentationCacheEntry,
  removeWorkspacePresentationCacheEntry,
  resolveWorkbenchSnapshotsForStations,
  takeWorkspacePresentationCacheEntry,
  type WorkspacePresentationCache,
} from '../src/shell/state/workspace-presentation-cache.js'

test('capture and take presentation cache entries by workspace id', () => {
  const cache: WorkspacePresentationCache = {}
  const entry = captureWorkspacePresentationCacheEntry({
    workspaceId: 'ws-1',
    workbenchContainers: [
      {
        id: 'main',
        stationIds: ['station-a', 'station-b'],
        activeStationId: 'station-b',
        layoutMode: 'focus',
      },
    ],
    pinnedWorkbenchContainerId: null,
    activeNavId: 'stations',
    activeStationId: 'station-b',
  })
  assert.ok(entry)
  putWorkspacePresentationCacheEntry(cache, entry)
  assert.equal(takeWorkspacePresentationCacheEntry(cache, 'ws-1')?.activeStationId, 'station-b')
  assert.deepEqual(
    takeWorkspacePresentationCacheEntry(cache, 'ws-1')?.workbenchContainers[0]?.stationIds,
    ['station-a', 'station-b'],
  )
})

test('resolveWorkbenchSnapshotsForStations returns cache when stations overlap', () => {
  const cache: WorkspacePresentationCache = {}
  putWorkspacePresentationCacheEntry(
    cache,
    captureWorkspacePresentationCacheEntry({
      workspaceId: 'ws-1',
      workbenchContainers: [
        {
          id: 'main',
          stationIds: ['station-a'],
          activeStationId: 'station-a',
          layoutMode: 'auto',
        },
      ],
      pinnedWorkbenchContainerId: 'main',
      activeNavId: 'stations',
      activeStationId: 'station-a',
    }),
  )

  const snapshots = resolveWorkbenchSnapshotsForStations(cache, 'ws-1', ['station-a', 'station-c'])
  assert.ok(snapshots)
  assert.equal(snapshots[0]?.layoutMode, 'auto')
  assert.equal(resolveWorkbenchSnapshotsForStations(cache, 'ws-2', ['station-a']), null)
})

test('removeWorkspacePresentationCacheEntry drops closed workspaces', () => {
  const cache: WorkspacePresentationCache = {}
  putWorkspacePresentationCacheEntry(
    cache,
    captureWorkspacePresentationCacheEntry({
      workspaceId: 'ws-1',
      workbenchContainers: [],
      pinnedWorkbenchContainerId: null,
      activeNavId: 'files',
      activeStationId: '',
    }),
  )
  removeWorkspacePresentationCacheEntry(cache, 'ws-1')
  assert.equal(takeWorkspacePresentationCacheEntry(cache, 'ws-1'), null)
})
