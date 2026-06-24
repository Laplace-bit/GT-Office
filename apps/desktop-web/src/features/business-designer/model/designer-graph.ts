/**
 * Graph model helpers for the business designer canvas.
 *
 * v1 puts blocks on a 2D plane. Coordinates live in `manifest.layout`; if the
 * field is missing (legacy Phase 6 documents) the canvas computes a grid
 * fallback so the very first render is non-empty. Edges are not stored — they
 * are derived from payload references by the backend.
 */

import type { DesignerBlock } from './designer-blocks'
import type { DesignerLayoutPosition } from './designer-document'
import type { DesignerDerivedEdge, DesignerEdgeRelation, DesignerGap } from './designer-validation'

/** Width / height for a node card in canvas (math) units. */
export const NODE_WIDTH = 200
export const NODE_HEIGHT = 96
export const NODE_HSPACING = 64
export const NODE_VSPACING = 56

/** Resolve a canvas position for a block, falling back to a grid layout. */
export function resolveNodePosition(
  block: DesignerBlock,
  layout: Record<string, DesignerLayoutPosition> | null | undefined,
  index: number,
  columns: number,
): DesignerLayoutPosition {
  const stored = layout?.[block.id]
  if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
    return stored
  }
  const col = index % columns
  const row = Math.floor(index / columns)
  return {
    x: col * (NODE_WIDTH + NODE_HSPACING) + NODE_HSPACING,
    y: row * (NODE_HEIGHT + NODE_VSPACING) + NODE_VSPACING,
  }
}

/** Pick a column count that keeps the graph reasonably square for N nodes. */
export function pickColumnCount(blockCount: number): number {
  if (blockCount <= 1) return 1
  if (blockCount <= 4) return 2
  if (blockCount <= 9) return 3
  return Math.ceil(Math.sqrt(blockCount))
}

/** Group a gap list by host blockId. */
export function groupGapsByBlock(gaps: DesignerGap[]): Map<string, DesignerGap[]> {
  const map = new Map<string, DesignerGap[]>()
  for (const gap of gaps) {
    const list = map.get(gap.blockId) ?? []
    list.push(gap)
    map.set(gap.blockId, list)
  }
  return map
}

/** Filter edges incident to a block. */
export function edgesForBlock(
  edges: DesignerDerivedEdge[],
  blockId: string,
): DesignerDerivedEdge[] {
  return edges.filter((e) => e.fromBlockId === blockId || e.toBlockId === blockId)
}

/**
 * v1 graph view-state — what the canvas has to know to draw itself.
 * Pure data: building it from `(blocks, gaps, edges)` is cheap and idempotent,
 * so we recompute on each render rather than thread mutable state.
 */
export interface DesignerGraphView {
  nodes: DesignerGraphNode[]
  edges: DesignerGraphEdge[]
  bounds: { width: number; height: number }
}

export interface DesignerGraphNode {
  block: DesignerBlock
  position: DesignerLayoutPosition
  gapCount: number
  hasError: boolean
}

export interface DesignerGraphEdge {
  from: { id: string; position: DesignerLayoutPosition }
  to: { id: string; position: DesignerLayoutPosition }
  relation: DesignerEdgeRelation
  sourceField?: string | null
}

export function buildGraphView(
  blocks: DesignerBlock[],
  gaps: DesignerGap[],
  edges: DesignerDerivedEdge[],
  layout: Record<string, DesignerLayoutPosition> | null | undefined,
): DesignerGraphView {
  const columns = pickColumnCount(blocks.length)
  const positions = new Map<string, DesignerLayoutPosition>()
  blocks.forEach((block, index) => {
    positions.set(block.id, resolveNodePosition(block, layout, index, columns))
  })
  const gapsByBlock = groupGapsByBlock(gaps)

  let maxX = 0
  let maxY = 0
  const nodes: DesignerGraphNode[] = blocks.map((block) => {
    const position = positions.get(block.id) ?? { x: 0, y: 0 }
    maxX = Math.max(maxX, position.x + NODE_WIDTH)
    maxY = Math.max(maxY, position.y + NODE_HEIGHT)
    const blockGaps = gapsByBlock.get(block.id) ?? []
    return {
      block,
      position,
      gapCount: blockGaps.length,
      hasError: blockGaps.some((g) => g.severity === 'error'),
    }
  })

  const edgeViews: DesignerGraphEdge[] = []
  for (const edge of edges) {
    const from = positions.get(edge.fromBlockId)
    const to = positions.get(edge.toBlockId)
    if (!from || !to) continue
    edgeViews.push({
      from: { id: edge.fromBlockId, position: from },
      to: { id: edge.toBlockId, position: to },
      relation: edge.relation,
      sourceField: edge.sourceField ?? null,
    })
  }

  return {
    nodes,
    edges: edgeViews,
    bounds: {
      width: Math.max(maxX + NODE_HSPACING, 800),
      height: Math.max(maxY + NODE_VSPACING, 480),
    },
  }
}
