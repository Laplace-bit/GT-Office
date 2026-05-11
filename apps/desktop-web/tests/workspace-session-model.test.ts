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
    workbenchContainers: [],
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
})
