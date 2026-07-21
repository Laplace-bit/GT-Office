import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveVisibleWorkspaceTabs,
  resolveWorkspaceAfterClose,
} from '../src/shell/state/workspace-tab-visibility.js'

test('resolveVisibleWorkspaceTabs shows active workspace in main window when list is empty', () => {
  const result = resolveVisibleWorkspaceTabs({
    isSingleWorkspaceMode: false,
    workspaceTabs: [],
    activeWorkspaceId: 'ws-1',
    activeWorkspaceRoot: '/tmp/my-project',
  })

  assert.deepEqual(result, [
    {
      workspaceId: 'ws-1',
      name: 'my-project',
      root: '/tmp/my-project',
      active: true,
      windowLabel: null,
      detached: false,
    },
  ])
})

test('resolveVisibleWorkspaceTabs hides detached tabs in main window but keeps active docked tab', () => {
  const result = resolveVisibleWorkspaceTabs({
    isSingleWorkspaceMode: false,
    workspaceTabs: [
      {
        workspaceId: 'ws-1',
        name: 'Detached',
        root: '/tmp/one',
        active: true,
        windowLabel: 'workspace-ws-1',
        detached: true,
      },
    ],
    activeWorkspaceId: 'ws-1',
    activeWorkspaceRoot: '/tmp/one',
  })

  assert.equal(result.length, 1)
  assert.equal(result[0]?.workspaceId, 'ws-1')
  assert.equal(result[0]?.windowLabel, null)
})

test('resolveVisibleWorkspaceTabs filters to workspace window id in single-workspace mode', () => {
  const result = resolveVisibleWorkspaceTabs({
    isSingleWorkspaceMode: true,
    workspaceWindowId: 'ws-2',
    workspaceTabs: [
      { workspaceId: 'ws-1', name: 'One', root: '/tmp/one', active: false },
      { workspaceId: 'ws-2', name: 'Two', root: '/tmp/two', active: true },
    ],
    activeWorkspaceId: 'ws-2',
    activeWorkspaceRoot: '/tmp/two',
  })

  assert.deepEqual(result, [
    { workspaceId: 'ws-2', name: 'Two', root: '/tmp/two', active: true },
  ])
})

test('resolveWorkspaceAfterClose prefers the right neighbor, then the left', () => {
  const tabs = [
    { workspaceId: 'ws-a' },
    { workspaceId: 'ws-b' },
    { workspaceId: 'ws-c' },
  ]

  assert.equal(
    resolveWorkspaceAfterClose({
      tabs,
      closedWorkspaceId: 'ws-b',
      activeWorkspaceId: 'ws-b',
    }),
    'ws-c',
  )
  assert.equal(
    resolveWorkspaceAfterClose({
      tabs,
      closedWorkspaceId: 'ws-c',
      activeWorkspaceId: 'ws-c',
    }),
    'ws-b',
  )
})

test('resolveWorkspaceAfterClose keeps the active workspace when closing an inactive tab', () => {
  assert.equal(
    resolveWorkspaceAfterClose({
      tabs: [{ workspaceId: 'ws-a' }, { workspaceId: 'ws-b' }],
      closedWorkspaceId: 'ws-b',
      activeWorkspaceId: 'ws-a',
    }),
    'ws-a',
  )
})
