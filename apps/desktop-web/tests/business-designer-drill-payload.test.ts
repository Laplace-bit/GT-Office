import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addApiEndpoint,
  addEntityField,
  addFlowState,
  addFlowTransition,
  formatEndpointErrors,
  nextFlowStateName,
  parseList,
  removeApiEndpoint,
  removeEntityField,
  removeFlowState,
  removeFlowTransition,
  renameEntityModel,
  renameFlowState,
  updateApiEndpoint,
  updateApiEndpointErrors,
  updateEntityField,
  updateFlowStateEntity,
  updateFlowTransition,
  type ApiContractPayload,
  type BusinessFlowPayload,
  type EntityModelPayload,
} from '../src/features/business-designer/model/designer-drill-payload.js'

test('business designer entity drill payload edits are immutable and preserve metadata', () => {
  const source: EntityModelPayload = {
    entityName: 'Order',
    fields: [{ name: 'id', type: 'uuid', isPrimaryKey: true }],
    owner: 'sales',
  }

  const added = addEntityField(source)
  assert.notEqual(added, source)
  assert.deepEqual(source.fields, [{ name: 'id', type: 'uuid', isPrimaryKey: true }])
  assert.deepEqual(added.fields, [
    { name: 'id', type: 'uuid', isPrimaryKey: true },
    { name: '', type: 'string' },
  ])
  assert.equal(added.owner, 'sales')

  const updated = updateEntityField(added, 1, {
    name: 'total',
    type: 'decimal',
    description: 'Order total',
  })
  assert.deepEqual(updated.fields?.[1], {
    name: 'total',
    type: 'decimal',
    description: 'Order total',
  })
  assert.deepEqual(added.fields?.[1], { name: '', type: 'string' })

  const renamed = renameEntityModel(updated, 'Invoice')
  assert.equal(renamed.entityName, 'Invoice')
  assert.equal(renamed.owner, 'sales')

  const removed = removeEntityField(renamed, 0)
  assert.deepEqual(removed.fields, [
    { name: 'total', type: 'decimal', description: 'Order total' },
  ])
})

test('business designer flow drill keeps transitions consistent across state edits', () => {
  const source: BusinessFlowPayload = {
    states: [
      { name: 'draft', initial: true },
      { name: 'paid', target: 'Order' },
      { name: 'shipped', terminal: true },
    ],
    transitions: [
      { from: 'draft', to: 'paid' },
      { from: 'paid', to: 'shipped' },
    ],
    owner: 'ops',
  }

  const renamed = renameFlowState(source, 1, 'settled')
  assert.deepEqual(source.transitions, [
    { from: 'draft', to: 'paid' },
    { from: 'paid', to: 'shipped' },
  ])
  assert.deepEqual(renamed.transitions, [
    { from: 'draft', to: 'settled' },
    { from: 'settled', to: 'shipped' },
  ])
  assert.equal(renamed.owner, 'ops')

  const retargeted = updateFlowStateEntity(renamed, 1, 'Invoice')
  assert.equal(retargeted.states?.[1]?.entity, 'Invoice')
  assert.equal(retargeted.states?.[1]?.target, undefined)

  const withState = addFlowState(retargeted)
  assert.deepEqual(withState.states?.at(-1), { name: 'state4' })
  assert.equal(nextFlowStateName([{ name: 'state2' }, { name: 'state3' }]), 'state4')

  const withTransition = addFlowTransition(withState)
  const lastTransitionIndex = (withTransition.transitions?.length ?? 1) - 1
  const updatedTransition = updateFlowTransition(withTransition, lastTransitionIndex, {
    from: 'shipped',
    to: 'draft',
  })
  assert.deepEqual(updatedTransition.transitions?.at(-1), { from: 'shipped', to: 'draft' })

  const removedTransition = removeFlowTransition(updatedTransition, lastTransitionIndex)
  assert.equal(removedTransition.transitions?.length, 2)

  const removedState = removeFlowState(removedTransition, 1)
  assert.deepEqual(removedState.states?.map((state) => state.name), ['draft', 'shipped', 'state4'])
  assert.deepEqual(removedState.transitions, [])
})

test('business designer api drill payload edits normalize endpoint errors', () => {
  const source: ApiContractPayload = {
    endpoints: [{ method: 'GET', path: '/orders', errors: ['LEGACY_ERROR'] }],
    owner: 'platform',
  }

  assert.equal(formatEndpointErrors(source.endpoints?.[0] ?? {}), 'LEGACY_ERROR')
  assert.deepEqual(parseList(' BAD_REQUEST, , CONFLICT '), ['BAD_REQUEST', 'CONFLICT'])

  const added = addApiEndpoint(source)
  assert.equal(added.endpoints?.length, 2)
  assert.deepEqual(added.endpoints?.[1], {
    method: 'GET',
    path: '',
    request: '',
    response: '',
    errorCodes: [],
  })
  assert.equal(added.owner, 'platform')
  assert.equal(source.endpoints?.length, 1)

  const updated = updateApiEndpoint(added, 1, {
    method: 'POST',
    path: '/orders',
    request: 'CreateOrderRequest',
    response: 'Order',
  })
  assert.deepEqual(updated.endpoints?.[1], {
    method: 'POST',
    path: '/orders',
    request: 'CreateOrderRequest',
    response: 'Order',
    errorCodes: [],
  })

  const normalized = updateApiEndpointErrors(updated, 0, 'BAD_REQUEST, CONFLICT')
  assert.deepEqual(normalized.endpoints?.[0]?.errorCodes, ['BAD_REQUEST', 'CONFLICT'])
  assert.equal(normalized.endpoints?.[0]?.errors, undefined)

  const removed = removeApiEndpoint(normalized, 1)
  assert.deepEqual(removed.endpoints?.map((endpoint) => endpoint.path), ['/orders'])
})
