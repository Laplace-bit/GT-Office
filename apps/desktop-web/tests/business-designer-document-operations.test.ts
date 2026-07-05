import test from 'node:test'
import assert from 'node:assert/strict'

import type { DesignerBlock } from '../src/features/business-designer/model/designer-blocks.js'
import type { DesignerDocumentDetail } from '../src/features/business-designer/model/designer-document.js'
import type { DesignerValidationResult } from '../src/features/business-designer/model/designer-validation.js'
import {
  addDesignerBlockToDetail,
  BRIEF_BLOCK_ID,
  deleteDesignerBlockFromDetail,
  pruneDesignerValidationForDeletedBlock,
  setDesignerBlockPositionInDetail,
  updateDesignerBlockInDetail,
} from '../src/features/business-designer/model/designer-document-operations.js'

function at(ms: number): () => Date {
  return () => new Date(ms)
}

function block(id: string, kind: DesignerBlock['kind'], order: number): DesignerBlock<Record<string, unknown>> {
  return {
    id,
    kind,
    title: id,
    order,
    payload: {},
    links: [],
    validation: [],
    updatedAt: '2026-07-05T00:00:00.000Z',
  }
}

function detail(): DesignerDocumentDetail {
  const brief = block(BRIEF_BLOCK_ID, 'text', 0)
  brief.payload = { markdown: 'Initial brief' }
  const entity = block('entity-order', 'entityModel', 10)
  entity.payload = {
    entityName: 'Order',
    fields: [{ name: 'id', type: 'string' }],
  }
  const flow = block('flow-order', 'businessFlow', 20)
  flow.links = [{ targetBlockId: 'api-order', relation: 'uses' }]
  flow.payload = {
    states: [{ name: 'draft', entity: 'Order' }],
    transitions: [],
  }
  const api = block('api-order', 'apiContract', 30)
  api.payload = {
    endpoints: [{ method: 'POST', path: '/orders', errorCodes: ['ORDER_INVALID'] }],
  }
  return {
    workspaceId: 'ws-1',
    docsRoot: '.gtoffice/docs',
    manifest: {
      schemaVersion: 1,
      documentId: 'commerce',
      title: 'Commerce',
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
      entry: 'design.json',
      generated: {
        readme: 'README.md',
        agentBrief: 'generated/agent-brief.md',
        agentInput: 'generated/agent-input.json',
        previewHtml: 'generated/preview.html',
      },
      tags: [],
      status: 'draft',
      layout: {
        [BRIEF_BLOCK_ID]: { x: 40, y: 40 },
        'entity-order': { x: 320, y: 120 },
        'flow-order': { x: 620, y: 120 },
        'api-order': { x: 920, y: 120 },
      },
    },
    design: {
      schemaVersion: 1,
      documentId: 'commerce',
      revision: 'initial-revision',
      title: 'Commerce',
      blocks: [brief, entity, flow, api],
    },
    diagnostics: [
      { code: 'entity-warning', severity: 'warning', message: 'Entity warning', blockId: 'entity-order' },
      { code: 'api-warning', severity: 'warning', message: 'API warning', blockId: 'api-order' },
    ],
  }
}

function validation(): DesignerValidationResult {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    documentId: 'commerce',
    revision: 'initial-revision',
    diagnostics: [
      { code: 'entity-warning', severity: 'warning', message: 'Entity warning', blockId: 'entity-order' },
      { code: 'flow-warning', severity: 'warning', message: 'Flow warning', blockId: 'flow-order' },
    ],
    gaps: [
      {
        id: 'gap-entity',
        key: 'entity-order:no-pk',
        code: 'no-pk',
        blockId: 'entity-order',
        layer: 'intra',
        severity: 'error',
        message: 'Missing primary key',
        fixableByAgent: true,
      },
      {
        id: 'gap-flow',
        key: 'flow-order:dead-state',
        code: 'dead-state',
        blockId: 'flow-order',
        layer: 'intra',
        severity: 'warning',
        message: 'Dead state',
        fixableByAgent: true,
      },
    ],
    rulesRun: [
      { kind: 'entityModel', code: 'no-pk', blockId: 'entity-order', passed: false, gapCount: 1 },
      { kind: 'businessFlow', code: 'dead-state', blockId: 'flow-order', passed: false, gapCount: 1 },
    ],
    graphProjection: {
      links: [
        { fromBlockId: 'flow-order', toBlockId: 'entity-order', relation: 'consumes' },
        { fromBlockId: 'api-order', toBlockId: 'entity-order', relation: 'uses' },
      ],
    },
  }
}

test('business designer document operations create isolated entity flow and contract blocks', () => {
  const base = detail()

  const entityResult = addDesignerBlockToDetail(base, 'entityModel', {
    position: { x: -360, y: 160 },
    title: 'Invoice',
    payload: { entityName: 'Invoice', fields: [] },
    clock: at(1000),
  })
  const flowResult = addDesignerBlockToDetail(entityResult.detail, 'businessFlow', {
    clock: at(2000),
  })
  const apiResult = addDesignerBlockToDetail(flowResult.detail, 'apiContract', {
    clock: at(3000),
  })

  assert.equal(entityResult.block.id, 'entityModel-1')
  assert.equal(flowResult.block.id, 'businessFlow-1')
  assert.equal(apiResult.block.id, 'apiContract-1')
  assert.equal(apiResult.detail.design.revision, 'web_ms_3000')
  assert.deepEqual(apiResult.detail.manifest.layout?.['entityModel-1'], { x: 0, y: 160 })
  assert.equal(base.design.blocks.length, 4, 'base detail should remain immutable')

  const entityPayload = entityResult.block.payload as { fields: unknown[] }
  entityPayload.fields.push({ name: 'mutated', type: 'string' })
  const secondEntity = addDesignerBlockToDetail(base, 'entityModel', { clock: at(4000) })
  assert.deepEqual((secondEntity.block.payload as { fields: unknown[] }).fields, [])
})

test('business designer document operations update payloads and drag layout locally', () => {
  const base = detail()
  const updated = updateDesignerBlockInDetail(
    base,
    'entity-order',
    {
      title: 'Order Aggregate',
      payload: {
        entityName: 'Order',
        fields: [
          { name: 'id', type: 'string' },
          { name: 'status', type: 'OrderStatus' },
        ],
      },
    },
    at(5000),
  )

  assert.equal(updated.changed, true)
  assert.equal(updated.detail.design.revision, 'web_ms_5000')
  assert.equal(updated.detail.design.blocks.find((item) => item.id === 'entity-order')?.title, 'Order Aggregate')
  assert.equal(base.design.blocks.find((item) => item.id === 'entity-order')?.title, 'entity-order')

  const moved = setDesignerBlockPositionInDetail(updated.detail, 'entity-order', { x: 444, y: 222 })
  assert.equal(moved.changed, true)
  assert.equal(moved.detail.design.revision, 'web_ms_5000', 'dragging should not churn content revision')
  assert.deepEqual(moved.detail.manifest.layout?.['entity-order'], { x: 444, y: 222 })

  const clamped = setDesignerBlockPositionInDetail(moved.detail, 'entity-order', {
    x: -24,
    y: Number.POSITIVE_INFINITY,
  })
  assert.equal(clamped.changed, true)
  assert.deepEqual(clamped.detail.manifest.layout?.['entity-order'], { x: 0, y: 0 })

  const missing = setDesignerBlockPositionInDetail(clamped.detail, 'missing-block', { x: 1, y: 2 })
  assert.equal(missing.changed, false)
  assert.equal(missing.detail.manifest.layout?.['missing-block'], undefined)
})

test('business designer document operations delete blocks and prune derived state', () => {
  const base = detail()
  const deleted = deleteDesignerBlockFromDetail(base, 'entity-order', at(6000))

  assert.equal(deleted.changed, true)
  assert.equal(deleted.detail.design.revision, 'web_ms_6000')
  assert.deepEqual(
    deleted.detail.design.blocks.map((item) => item.id),
    [BRIEF_BLOCK_ID, 'flow-order', 'api-order'],
  )
  assert.equal(deleted.detail.manifest.layout?.['entity-order'], undefined)
  assert.equal(
    deleted.detail.design.blocks
      .find((item) => item.id === 'flow-order')
      ?.links.some((link) => link.targetBlockId === 'entity-order'),
    false,
  )
  assert.equal(
    deleted.detail.diagnostics.some((diagnostic) => diagnostic.blockId === 'entity-order'),
    false,
  )

  const pruned = pruneDesignerValidationForDeletedBlock(validation(), 'entity-order')
  assert.ok(pruned)
  assert.deepEqual(pruned.diagnostics.map((item) => item.blockId), ['flow-order'])
  assert.deepEqual(pruned.gaps.map((item) => item.blockId), ['flow-order'])
  assert.deepEqual(pruned.rulesRun.map((item) => item.blockId), ['flow-order'])
  assert.deepEqual(pruned.graphProjection.links, [])

  const briefDelete = deleteDesignerBlockFromDetail(base, BRIEF_BLOCK_ID, at(7000))
  assert.equal(briefDelete.changed, false)
  assert.equal(briefDelete.detail, base)
})
