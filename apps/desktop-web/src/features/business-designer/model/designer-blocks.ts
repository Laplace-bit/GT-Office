/**
 * Block model for the business designer.
 *
 * The redesigned UI treats the whole design as one natural-language document.
 * Users edit a single `text` block (the brief); the Agent returns structured
 * blocks (entityModel, apiContract, ...) which render as read-only inline
 * sections. There are no per-kind table editors anymore.
 *
 * The contract here is the wire shape shared with the Rust backend
 * (see commands/business_designer/mod.rs). Keep it in lock-step with serde.
 */

export type DesignerBlockKind =
  | 'text'
  | 'glossary'
  | 'entityModel'
  | 'businessFlow'
  | 'ruleTable'
  | 'pseudocode'
  | 'objectModel'
  | 'apiContract'
  | 'dataContract'
  | 'uiWorkflow'
  | 'technicalStack'
  | 'nonFunctional'
  | 'acceptanceCriteria'
  | 'openQuestions'
  | 'agentInstruction'
  | 'decisionRecord'

export interface DesignerBlockLink {
  targetBlockId: string
  relation: string
}

export interface DesignerBlockValidation {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface DesignerBlock<TPayload = unknown> {
  id: string
  kind: DesignerBlockKind
  title: string
  order: number
  payload: TPayload
  links: DesignerBlockLink[]
  validation: DesignerBlockValidation[]
  updatedAt: string
}

/** Patch applied to a block by user edits in the brief surface. */
export type DesignerBlockPatch = Partial<Omit<DesignerBlock, 'id'>>
