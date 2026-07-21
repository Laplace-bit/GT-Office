import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DESIGNER_TOOLBAR_ACTION_ORDER,
  DESIGNER_TOOLBAR_MUTATING_ACTIONS,
  isDesignerToolbarBusy,
  resolveDesignerToolbarActionStates,
} from '../src/features/business-designer/model/designer-toolbar-actions.js'
import type { DesignerOperation } from '../src/features/business-designer/model/designer-operation.js'

test('business designer toolbar keeps stable native action order', () => {
  assert.deepEqual(DESIGNER_TOOLBAR_ACTION_ORDER, [
    'save',
    'createEntity',
    'createFlow',
    'createApi',
    'export',
    'checkpoint',
    'history',
  ])
  assert.deepEqual(DESIGNER_TOOLBAR_MUTATING_ACTIONS, [
    'save',
    'createEntity',
    'createFlow',
    'createApi',
    'export',
    'checkpoint',
  ])
  assert.equal(DESIGNER_TOOLBAR_ACTION_ORDER.includes('history'), true)
  assert.equal((DESIGNER_TOOLBAR_MUTATING_ACTIONS as readonly string[]).includes('history'), false)
})

test('business designer toolbar enables write actions only when the document is editable and idle', () => {
  const idle = resolveDesignerToolbarActionStates({
    canEdit: true,
    operation: null,
  })

  for (const action of DESIGNER_TOOLBAR_ACTION_ORDER) {
    assert.equal(idle[action].disabled, false, `${action} should be enabled while editable and idle`)
    assert.equal(idle[action].busy, false, `${action} should not be busy while idle`)
  }

  const readonly = resolveDesignerToolbarActionStates({
    canEdit: false,
    operation: null,
  })

  for (const action of DESIGNER_TOOLBAR_ACTION_ORDER) {
    assert.equal(readonly[action].disabled, true, `${action} should be disabled without edit permission`)
  }
})

test('business designer toolbar blocks mutating actions while a document operation is active', () => {
  for (const operation of ['save', 'export', 'checkpoint', 'agent'] satisfies DesignerOperation[]) {
    const states = resolveDesignerToolbarActionStates({
      canEdit: true,
      operation,
    })

    assert.equal(isDesignerToolbarBusy({ canEdit: true, operation }), true)
    for (const action of DESIGNER_TOOLBAR_MUTATING_ACTIONS) {
      assert.equal(states[action].disabled, true, `${action} should be disabled during ${operation}`)
    }
    assert.equal(states.history.disabled, false, `history should remain inspectable during ${operation}`)
  }
})

test('business designer toolbar exposes precise busy labels for long-running document actions', () => {
  assert.equal(
    resolveDesignerToolbarActionStates({ canEdit: true, operation: 'save' }).save.busy,
    true,
  )
  assert.equal(
    resolveDesignerToolbarActionStates({ canEdit: true, operation: 'export' }).export.busy,
    true,
  )
  assert.equal(
    resolveDesignerToolbarActionStates({ canEdit: true, operation: 'checkpoint' }).checkpoint.busy,
    true,
  )
})
