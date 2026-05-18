import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWorkspaceSessionSnapshot,
  parseWorkspaceSessionSnapshot,
} from '../src/features/workspace/workspace-session-model.js'

test('workspace session snapshot preserves terminal session ids', () => {
  const snapshot = buildWorkspaceSessionSnapshot({
    updatedAtMs: 1,
    windows: [{ activeNavId: 'workspace', pinnedWorkbenchContainerId: null }],
    tabs: [{ path: 'README.md', active: true }],
    terminals: [
      {
        stationId: 'station-1',
        sessionId: 'sess-1',
        shell: '/bin/zsh',
        cwdMode: 'custom',
        resolvedCwd: '/tmp/repo',
        active: true,
      },
    ],
    workbenchContainers: [
      {
        id: 'container-1',
        stationIds: ['station-1'],
        activeStationId: 'station-1',
        fullscreenStationId: 'station-1',
        layoutMode: 'auto',
        customLayout: { columns: 1, rows: 1 },
        mode: 'docked',
        resumeMode: 'docked',
        topmost: false,
        frame: null,
      },
    ],
  })

  const parsed = parseWorkspaceSessionSnapshot(JSON.stringify(snapshot))
  assert.ok(parsed)
  assert.deepEqual(parsed.terminals, [
    {
      stationId: 'station-1',
      sessionId: 'sess-1',
      shell: '/bin/zsh',
      cwdMode: 'custom',
      resolvedCwd: '/tmp/repo',
      active: true,
    },
  ])
  assert.equal(parsed.workbenchContainers[0]?.fullscreenStationId, 'station-1')
})
