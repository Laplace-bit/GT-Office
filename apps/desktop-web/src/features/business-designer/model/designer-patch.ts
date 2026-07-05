import type { DesignerBlock } from './designer-blocks'
import type { DesignerDiagnostic, DesignerDocumentDetail } from './designer-document'
import type {
  DesignerDerivedEdge,
  DesignerGap,
  DesignerGraphProjection,
  DesignerRuleRun,
} from './designer-validation'

/**
 * Agent patch contract for mock/recovered business designer suggestions.
 *
 * The mock provider and legacy task recovery return a typed patch that the user
 * reviews and selectively applies. Real CLI Agent dispatches edit design files
 * directly and the workbench reloads them from disk. Mirrors the serde structs
 * in commands/business_designer/mod.rs (camelCase wire shape).
 *
 * v1 carries `hostBlockId` / `gapCodes` / `targetGapKeys` / `scope` so apply_agent_patch can
 * enforce host-anchoring and produce a three-tier verdict (resolved /
 * unresolved / incidentalResolved / introduced) by rerunning gap_rules.
 */

export interface DesignerAgentPatchBlock {
  id: string
  kind: string
  title: string
  order?: number | null
  payload: Record<string, unknown>
}

export interface DesignerPatchOperation {
  op: 'updateBlock'
  blockId: string
  patch: Partial<Omit<DesignerAgentPatchBlock, 'id'>>
}

export interface DesignerAgentPatch {
  schemaVersion: number
  documentId: string
  baseRevision: string
  summary: string
  changes: DesignerPatchOperation[]
  openQuestions: string[]
  /** v1: every change must update this block. */
  hostBlockId: string
  /** v1: gap codes the patch is supposed to resolve. */
  gapCodes: string[]
  /** v1: exact target gap fingerprints captured at preview/dispatch time. */
  targetGapKeys: string[]
  /** v1: `single` = one gap, `block` = all gaps in host. */
  scope?: 'single' | 'block' | null
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

export interface DesignerAgentCompletionDispatchResult {
  workspaceId: string
  documentId: string
  requestId: string
  dispatch: DesignerTaskDispatchBatchResponse
}

export interface DesignerTaskDispatchBatchResult {
  targetAgentId: string
  taskId: string
  status: 'sent' | 'failed' | string
  detail?: string | null
  taskFilePath?: string | null
}

export interface DesignerTaskDispatchBatchResponse {
  batchId: string
  results: DesignerTaskDispatchBatchResult[]
}

export interface DesignerRecoveredAgentPatchResult {
  workspaceId: string
  documentId: string
  taskId: string
  sourceMessageId: string
  sourceAgentId: string
  sourceMessageType: string
  validation: DesignerPatchValidationResult
}

export interface DesignerAgentTaskPreview {
  workspaceId: string
  documentId: string
  requestId: string
  provider: string
  status: 'ready' | 'no_agent_fixable_gaps' | string
  schemaVersion: number
  selectedBlockIds: string[]
  revision: string
  contextPath: string
  outputContract: string
  lifecycle: string
  hostBlockId: string
  gapCodes: string[]
  targetGapKeys: string[]
  scope: 'single' | 'block'
  targetGaps: DesignerGap[]
  contextGaps: DesignerGap[]
  hostBlock?: DesignerBlock | null
  adjacency?: DesignerDerivedEdge[] | null
}

export interface DesignerGapResolution {
  targetGapKeys: string[]
  resolved: string[]
  unresolved: string[]
  incidentalResolved: string[]
  introduced: DesignerGap[]
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
  gapResolution: DesignerGapResolution
  gaps: DesignerGap[]
  rulesRun: DesignerRuleRun[]
  graphProjection: DesignerGraphProjection
}
