import test from 'node:test'
import assert from 'node:assert/strict'
import {
  orderWorkbenchHeaderActions,
  type WorkbenchHeaderActionId,
} from '../src/features/workspace-hub/workbench-header-actions.js'

test('orders container header actions to match the requested right-edge priority', () => {
  const ordered = orderWorkbenchHeaderActions<WorkbenchHeaderActionId>([
    'detach',
    'search',
    'topmost',
    'float',
    'pin',
    'add_container',
    'add_agent',
  ])

  assert.deepEqual(ordered, [
    'search',
    'add_agent',
    'add_container',
    'detach',
    'topmost',
    'float',
    'pin',
  ])
})

test('keeps add agent directly to the left of add container in the header toolbar', () => {
  const ordered = orderWorkbenchHeaderActions<WorkbenchHeaderActionId>([
    'add_container',
    'detach',
    'add_agent',
    'float',
    'pin',
  ])

  assert.deepEqual(ordered, ['add_agent', 'add_container', 'detach', 'float', 'pin'])
})

test('keeps dock controls immediately to the left of pin controls for floating surfaces', () => {
  const ordered = orderWorkbenchHeaderActions<WorkbenchHeaderActionId>([
    'dock',
    'search',
    'pin',
  ])

  assert.deepEqual(ordered, ['search', 'dock', 'pin'])
})
