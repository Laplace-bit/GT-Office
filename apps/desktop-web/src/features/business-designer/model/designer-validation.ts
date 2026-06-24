/**
 * v1: validate_document returns four streams now.
 *
 * - `diagnostics` is reserved for lint/format/schema problems only (it stops
 *   carrying gap codes — gaps live in their own field).
 * - `gaps` are first-class: machine-detected unmet rules anchored to a host
 *   block, with semantic keys for before/after comparison.
 * - `rulesRun` is the audit trail.
 * - `graphProjection` is the graph computed by the backend (users do not draw
 *   or derive semantic edges in the frontend).
 */

import type { DesignerBlockKind } from './designer-blocks'

export type DesignerDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface DesignerValidationDiagnostic {
  code: string
  severity: DesignerDiagnosticSeverity
  message: string
  blockId?: string | null
}

export interface DesignerGap {
  id: string
  key: string
  code: string
  blockId: string
  layer: 'intra' | 'inter'
  severity: 'warning' | 'error'
  message: string
  fixableByAgent: boolean
  locator?: Record<string, string> | null
}

export interface DesignerRuleRun {
  kind: DesignerBlockKind | string
  code: string
  blockId: string
  passed: boolean
  gapCount: number
}

/** v1: closed relation vocabulary — see §5.6 of the spec. */
export type DesignerEdgeRelation =
  | 'dependsOn'
  | 'produces'
  | 'consumes'
  | 'uses'
  | 'extends'

export interface DesignerDerivedEdge {
  fromBlockId: string
  toBlockId: string
  relation: DesignerEdgeRelation
  sourceField?: string | null
}

export interface DesignerGraphProjection {
  links: DesignerDerivedEdge[]
}

export interface DesignerValidationResult {
  schemaVersion: number
  workspaceId: string
  documentId: string
  revision: string
  diagnostics: DesignerValidationDiagnostic[]
  gaps: DesignerGap[]
  rulesRun: DesignerRuleRun[]
  graphProjection: DesignerGraphProjection
}
