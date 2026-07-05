import type { DesignerBlock, DesignerBlockKind, DesignerBlockPatch } from './designer-blocks'
import type { DesignerDocumentDetail, DesignerLayoutPosition } from './designer-document'
import { normalizeDesignerNodePosition } from './designer-graph.js'
import type { DesignerValidationResult } from './designer-validation'

export const BRIEF_BLOCK_ID = 'brief'

export const AGENT_BLOCK_KINDS = new Set<string>([
  'entityModel',
  'apiContract',
  'businessFlow',
  'acceptanceCriteria',
  'openQuestions',
  'glossary',
  'ruleTable',
  'objectModel',
  'dataContract',
  'technicalStack',
  'nonFunctional',
  'decisionRecord',
  'pseudocode',
  'uiWorkflow',
  'agentInstruction',
])

export type DesignerCreateBlockKind = Extract<
  DesignerBlockKind,
  'entityModel' | 'businessFlow' | 'apiContract'
>

export const DESIGNER_BLOCK_CREATE_DEFAULTS: Record<
  DesignerCreateBlockKind,
  { title: string; payload: Record<string, unknown> }
> = {
  entityModel: {
    title: '新建实体',
    payload: { entityName: '新建实体', fields: [] },
  },
  businessFlow: {
    title: '新建流程',
    payload: { states: [], transitions: [] },
  },
  apiContract: {
    title: '新建契约',
    payload: { endpoints: [] },
  },
}

export interface DesignerDocumentOperationResult {
  detail: DesignerDocumentDetail
  changed: boolean
}

export interface DesignerAddBlockResult extends DesignerDocumentOperationResult {
  block: DesignerBlock
}

type DesignerClock = () => Date

function defaultClock(): Date {
  return new Date()
}

export function cloneDesignerDetail(detail: DesignerDocumentDetail): DesignerDocumentDetail {
  return structuredClone(detail) as DesignerDocumentDetail
}

export function cloneDesignerBlockPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return structuredClone(payload) as Record<string, unknown>
}

export function createDesignerRevision(date: Date = defaultClock()): string {
  return `web_ms_${date.getTime()}`
}

export function nextDesignerBlockId(blocks: DesignerBlock[], kind: DesignerCreateBlockKind): string {
  const existingIds = new Set(blocks.map((block) => block.id))
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `${kind}-${index}`
    if (!existingIds.has(candidate)) {
      return candidate
    }
  }
  return `${kind}-${defaultClock().getTime()}`
}

export function addDesignerBlockToDetail(
  detail: DesignerDocumentDetail,
  kind: DesignerCreateBlockKind,
  options: {
    position?: DesignerLayoutPosition
    title?: string
    payload?: Record<string, unknown>
    clock?: DesignerClock
  } = {},
): DesignerAddBlockResult {
  const next = cloneDesignerDetail(detail)
  const defaults = DESIGNER_BLOCK_CREATE_DEFAULTS[kind]
  const createdAt = (options.clock ?? defaultClock)()
  const newId = nextDesignerBlockId(next.design.blocks, kind)
  const block: DesignerBlock<Record<string, unknown>> = {
    id: newId,
    kind,
    title: options.title ?? defaults.title,
    order: next.design.blocks.length * 10 + 10,
    payload: cloneDesignerBlockPayload(options.payload ?? defaults.payload),
    links: [],
    validation: [],
    updatedAt: createdAt.toISOString(),
  }
  next.design.blocks = [...next.design.blocks, block]
  next.design.revision = createDesignerRevision(createdAt)
  if (options.position) {
    next.manifest.layout = {
      ...(next.manifest.layout ?? {}),
      [newId]: normalizeDesignerNodePosition(options.position),
    }
  }
  return { detail: next, block, changed: true }
}

export function updateDesignerBlockInDetail(
  detail: DesignerDocumentDetail,
  blockId: string,
  patch: DesignerBlockPatch,
  clock: DesignerClock = defaultClock,
): DesignerDocumentOperationResult {
  if (!detail.design.blocks.some((block) => block.id === blockId)) {
    return { detail, changed: false }
  }
  const updatedAt = clock()
  const next = cloneDesignerDetail(detail)
  next.design.blocks = next.design.blocks.map((block) =>
    block.id === blockId ? { ...block, ...patch } : block,
  )
  next.design.revision = createDesignerRevision(updatedAt)
  return { detail: next, changed: true }
}

export function deleteDesignerBlockFromDetail(
  detail: DesignerDocumentDetail,
  blockId: string,
  clock: DesignerClock = defaultClock,
): DesignerDocumentOperationResult {
  if (blockId === BRIEF_BLOCK_ID || !detail.design.blocks.some((block) => block.id === blockId)) {
    return { detail, changed: false }
  }
  const deletedAt = clock()
  const next = cloneDesignerDetail(detail)
  next.design.blocks = next.design.blocks
    .filter((block) => block.id !== blockId)
    .map((block) => ({
      ...block,
      links: block.links.filter((link) => link.targetBlockId !== blockId),
    }))
  next.diagnostics = next.diagnostics.filter((diagnostic) => diagnostic.blockId !== blockId)
  next.design.revision = createDesignerRevision(deletedAt)
  if (next.manifest.layout?.[blockId]) {
    const layout = { ...next.manifest.layout }
    delete layout[blockId]
    next.manifest.layout = layout
  }
  return { detail: next, changed: true }
}

export function setDesignerBlockPositionInDetail(
  detail: DesignerDocumentDetail,
  blockId: string,
  position: DesignerLayoutPosition,
): DesignerDocumentOperationResult {
  if (!detail.design.blocks.some((block) => block.id === blockId)) {
    return { detail, changed: false }
  }
  const next = cloneDesignerDetail(detail)
  next.manifest.layout = {
    ...(next.manifest.layout ?? {}),
    [blockId]: normalizeDesignerNodePosition(position),
  }
  return { detail: next, changed: true }
}

export function pruneDesignerValidationForDeletedBlock(
  validation: DesignerValidationResult | null,
  blockId: string,
): DesignerValidationResult | null {
  if (!validation) {
    return validation
  }
  return {
    ...validation,
    diagnostics: validation.diagnostics.filter((diagnostic) => diagnostic.blockId !== blockId),
    gaps: validation.gaps.filter((gap) => gap.blockId !== blockId),
    rulesRun: validation.rulesRun.filter((rule) => rule.blockId !== blockId),
    graphProjection: {
      ...validation.graphProjection,
      links: validation.graphProjection.links.filter(
        (link) => link.fromBlockId !== blockId && link.toBlockId !== blockId,
      ),
    },
  }
}
