import type { DesignerBlock } from './designer-blocks'

/**
 * Wire contract types for the business designer.
 *
 * These mirror the serde structs in
 * apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs and are
 * consumed by the typed desktop-api adapter. Keep field names in camelCase to
 * match the Rust `#[serde(rename_all = "camelCase")]` shape.
 */

export type DesignerDocumentStatus = 'draft' | 'readyForAgent' | 'needsReview' | 'archived' | string

export interface DesignerDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  path?: string | null
  blockId?: string | null
}

export interface DesignerDocumentSummary {
  documentId: string
  title: string
  module?: string | null
  status: DesignerDocumentStatus
  path: string
  updatedAt?: string | null
  blockCount: number
  tags: string[]
}

export interface DesignerListDocumentsResponse {
  workspaceId: string
  docsRoot: string
  scaffoldInitialized: boolean
  repoInitialized: boolean
  documents: DesignerDocumentSummary[]
  diagnostics: DesignerDiagnostic[]
}

export interface DesignerInitDocsRepoResponse {
  workspaceId: string
  docsRoot: string
  scaffoldCreated: boolean
  repoInitialized: boolean
  gitInitialized: boolean
  templatesWritten: boolean
}

export interface DesignerGeneratedPaths {
  readme: string
  agentBrief: string
  agentInput: string
  previewHtml: string
}

export interface DesignerManifest {
  schemaVersion: number
  documentId: string
  title: string
  module?: string | null
  createdAt: string
  updatedAt: string
  entry: string
  generated: DesignerGeneratedPaths
  tags: string[]
  status: DesignerDocumentStatus
}

export interface DesignerDesignGraph {
  schemaVersion: number
  documentId: string
  revision: string
  title: string
  blocks: DesignerBlock[]
}

export interface DesignerDocumentDetail {
  workspaceId: string
  docsRoot: string
  manifest: DesignerManifest
  design: DesignerDesignGraph
  diagnostics: DesignerDiagnostic[]
}

export interface DesignerCreateDocumentParams {
  documentId: string
  title: string
  module?: string | null
}

export interface DesignerCompileResult {
  workspaceId: string
  documentId: string
  revision: string
  generated: DesignerGeneratedPaths
  files: string[]
  diagnostics: DesignerDiagnostic[]
}

export interface DesignerCheckpointResult {
  workspaceId: string
  documentId: string
  commit?: string | null
  committed: boolean
  message: string
}

export interface DesignerCheckpointEntry {
  commit: string
  shortCommit: string
  authoredAt: string
  summary: string
}

export interface DesignerCheckpointHistoryResult {
  workspaceId: string
  documentId?: string | null
  entries: DesignerCheckpointEntry[]
}

export interface DesignerDiffEntry {
  status: string
  path: string
}

export interface DesignerDiffResult {
  workspaceId: string
  documentId?: string | null
  base?: string | null
  head?: string | null
  entries: DesignerDiffEntry[]
}

export interface DesignerExportResult {
  workspaceId: string
  documentId: string
  format: string
  suggestedFileName: string
  mimeType: string
  content: string
  sourcePath: string
  savedPath?: string | null
  cancelled?: boolean | null
}

export const DESIGNER_SCHEMA_VERSION = 1

/** Export formats supported by the backend export command. */
export const DESIGNER_EXPORT_FORMATS = ['markdown', 'html', 'json', 'agentBundle'] as const
export type DesignerExportFormat = (typeof DESIGNER_EXPORT_FORMATS)[number]
