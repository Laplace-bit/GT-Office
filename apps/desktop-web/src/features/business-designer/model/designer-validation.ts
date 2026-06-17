export type DesignerDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface DesignerValidationDiagnostic {
  code: string
  severity: DesignerDiagnosticSeverity
  message: string
  blockId?: string | null
}

export interface DesignerValidationResult {
  schemaVersion: number
  documentId: string
  revision: string
  diagnostics: DesignerValidationDiagnostic[]
}
