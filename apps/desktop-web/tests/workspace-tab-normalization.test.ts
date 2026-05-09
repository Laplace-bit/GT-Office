import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkspaceTabsResponse } from '../src/shell/state/workspace-tab-normalization.js'

test('normalizeWorkspaceTabsResponse drops invalid and duplicate workspace items', () => {
  const result = normalizeWorkspaceTabsResponse({
    workspaces: [
      { workspaceId: 'ws-1', name: 'One', root: '/tmp/one', active: true },
      { workspaceId: 'ws-1', name: 'Duplicate', root: '/tmp/dup', active: false },
      { workspaceId: '', name: 'Missing id', root: '/tmp/missing', active: false },
      { workspaceId: 'ws-2', name: 'Two', root: '/tmp/two', active: false },
    ],
  })

  assert.deepEqual(result, [
    { workspaceId: 'ws-1', name: 'One', root: '/tmp/one', active: true },
    { workspaceId: 'ws-2', name: 'Two', root: '/tmp/two', active: false },
  ])
})
