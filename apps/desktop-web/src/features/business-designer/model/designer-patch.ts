import type { DesignerBlock } from './designer-blocks'
import type { DesignerDiagnostic, DesignerDocumentDetail } from './designer-document'

/**
 * Agent patch contract for the business designer.
 *
 * The Agent never edits the design directly; it returns a typed patch that the
 * user reviews and selectively applies. Mirrors the serde structs in
 * commands/business_designer/mod.rs (camelCase wire shape).
 */

export interface DesignerAgentPatchBlock {
  id: string
  kind: string
  title: string
  order?: number | null
  payload: Record<string, unknown>
  links?: DesignerBlock['links']
}

export type DesignerPatchOperation =
  | {
      op: 'addBlock'
      afterBlockId?: string | null
      block: DesignerAgentPatchBlock
    }
  | {
      op: 'updateBlock'
      blockId: string
      patch: Partial<Omit<DesignerAgentPatchBlock, 'id'>>
    }
  | {
      op: 'deleteBlock'
      blockId: string
    }

export interface DesignerAgentPatch {
  schemaVersion: number
  documentId: string
  baseRevision: string
  summary: string
  changes: DesignerPatchOperation[]
  openQuestions: string[]
}

export interface DesignerPatchPreviewChange {
  op: string
  blockId: string
  title?: string | null
  kind?: string | null
  destructive: boolean
  summary: string
}

export interface DesignerPatchValidationResult {
  workspaceId: string
  documentId: string
  patchPath?: string | null
  patch: DesignerAgentPatch
  diagnostics: DesignerDiagnostic[]
  changes: DesignerPatchPreviewChange[]
  valid: boolean
}

export interface DesignerPatchApplyResult {
  workspaceId: string
  documentId: string
  appliedRevision: string
  patchPath: string
  acceptedChanges: number[]
  skippedChanges: number[]
  detail: DesignerDocumentDetail
  diagnostics: DesignerDiagnostic[]
}
