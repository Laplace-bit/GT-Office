import test from 'node:test'
import assert from 'node:assert/strict'

import type { DesignerBlock } from '../src/features/business-designer/model/designer-blocks.js'
import {
  buildGraphView,
  NODE_HEIGHT,
  NODE_HSPACING,
  NODE_VSPACING,
  NODE_WIDTH,
  normalizeDesignerNodePosition,
  pickColumnCount,
} from '../src/features/business-designer/model/designer-graph.js'

function block(id: string, order: number): DesignerBlock {
  return {
    id,
    kind: 'entityModel',
    title: id,
    order,
    payload: {},
    links: [],
    validation: [],
    updatedAt: '2026-07-05T00:00:00.000Z',
  }
}

function overlap(
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean {
  return !(
    left.x + NODE_WIDTH <= right.x ||
    right.x + NODE_WIDTH <= left.x ||
    left.y + NODE_HEIGHT <= right.y ||
    right.y + NODE_HEIGHT <= left.y
  )
}

test('business designer graph fallback layout keeps generated blocks separated', () => {
  const blocks = Array.from({ length: 12 }, (_, index) => block(`block-${index + 1}`, index))
  const view = buildGraphView(blocks, [], [], null)

  assert.equal(view.nodes.length, blocks.length)
  assert.equal(pickColumnCount(blocks.length), 4)

  for (let left = 0; left < view.nodes.length; left += 1) {
    for (let right = left + 1; right < view.nodes.length; right += 1) {
      assert.equal(
        overlap(view.nodes[left].position, view.nodes[right].position),
        false,
        `${view.nodes[left].block.id} should not overlap ${view.nodes[right].block.id}`,
      )
    }
  }

  const uniquePositions = new Set(view.nodes.map((node) => `${node.position.x}:${node.position.y}`))
  assert.equal(uniquePositions.size, view.nodes.length)
  assert.ok(view.nodes[1].position.x - view.nodes[0].position.x >= NODE_WIDTH + NODE_HSPACING)
  assert.ok(view.nodes[4].position.y - view.nodes[0].position.y >= NODE_HEIGHT + NODE_VSPACING)
})

test('business designer graph honors dragged layout and excludes dangling edges', () => {
  const blocks = [block('entity-user', 0), block('flow-signup', 1), block('api-create-user', 2)]
  const view = buildGraphView(
    blocks,
    [
      {
        id: 'gap-1',
        key: 'flow-signup:missing-step',
        code: 'missing-step',
        blockId: 'flow-signup',
        layer: 'intra',
        severity: 'error',
        message: 'Missing step',
        fixableByAgent: true,
      },
    ],
    [
      {
        fromBlockId: 'flow-signup',
        toBlockId: 'entity-user',
        relation: 'consumes',
        sourceField: 'entity',
      },
      {
        fromBlockId: 'flow-signup',
        toBlockId: 'missing-block',
        relation: 'produces',
        sourceField: 'result',
      },
    ],
    {
      'flow-signup': { x: 512, y: 224 },
    },
  )

  assert.deepEqual(view.nodes.find((node) => node.block.id === 'flow-signup')?.position, {
    x: 512,
    y: 224,
  })
  assert.equal(view.nodes.find((node) => node.block.id === 'flow-signup')?.gapCount, 1)
  assert.equal(view.nodes.find((node) => node.block.id === 'flow-signup')?.hasError, true)
  assert.deepEqual(
    view.edges.map((edge) => [edge.from.id, edge.to.id, edge.relation, edge.sourceField]),
    [['flow-signup', 'entity-user', 'consumes', 'entity']],
  )
})

test('business designer graph bounds cover every node with native scroll padding', () => {
  const blocks = [block('brief', 0), block('entity', 1), block('flow', 2)]
  const view = buildGraphView(blocks, [], [], {
    brief: { x: 32, y: 40 },
    entity: { x: 960, y: 80 },
    flow: { x: 480, y: 720 },
  })

  for (const node of view.nodes) {
    assert.ok(view.bounds.width >= node.position.x + NODE_WIDTH + NODE_HSPACING)
    assert.ok(view.bounds.height >= node.position.y + NODE_HEIGHT + NODE_VSPACING)
  }
  assert.ok(Number.isFinite(view.bounds.width))
  assert.ok(Number.isFinite(view.bounds.height))
  assert.ok(view.bounds.width >= 800)
  assert.ok(view.bounds.height >= 480)
})

test('business designer graph keeps dragged nodes inside the scrollable canvas origin', () => {
  assert.deepEqual(normalizeDesignerNodePosition({ x: -72, y: -18 }), { x: 0, y: 0 })
  assert.deepEqual(normalizeDesignerNodePosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY }), {
    x: 0,
    y: 0,
  })

  const blocks = [block('entity', 0), block('flow', 1)]
  const view = buildGraphView(blocks, [], [], {
    entity: { x: -80, y: -12 },
    flow: { x: 320, y: 160 },
  })

  assert.deepEqual(view.nodes.find((node) => node.block.id === 'entity')?.position, {
    x: 0,
    y: 0,
  })
  for (const node of view.nodes) {
    assert.ok(node.position.x >= 0)
    assert.ok(node.position.y >= 0)
    assert.ok(view.bounds.width >= node.position.x + NODE_WIDTH + NODE_HSPACING)
    assert.ok(view.bounds.height >= node.position.y + NODE_HEIGHT + NODE_VSPACING)
  }
})
