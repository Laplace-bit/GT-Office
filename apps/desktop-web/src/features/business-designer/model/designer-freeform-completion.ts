export type DesignerFreeformCompletionScenario =
  | 'brief_to_design'
  | 'complete_entity'
  | 'complete_flow'
  | 'complete_api_contract'
  | 'expand_canvas'

export type DesignerFreeformCompletionProvider = 'codex' | 'claude'

export type DesignerFreeformCompletionRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface DesignerFreeformCompletionRequest {
  traceId: string
  documentId: string
  scenario: DesignerFreeformCompletionScenario
  hostBlockId?: string | null
  userPrompt?: string | null
  provider?: DesignerFreeformCompletionProvider | null
}

export interface DesignerFreeformCompletionRunStatusRequest {
  traceId: string
  documentId: string
  requestId: string
  status: DesignerFreeformCompletionRunStatus
}

export interface DesignerRevertToCheckpointRequest {
  traceId: string
  documentId: string
  checkpoint: string
}

export interface DesignerFreeformCompletionRun {
  requestId: string
  workspaceId: string
  documentId: string
  scenario: DesignerFreeformCompletionScenario
  hostBlockId?: string | null
  provider: DesignerFreeformCompletionProvider
  sessionId: string
  documentRoot: string
  checkpointBefore: string
  status: DesignerFreeformCompletionRunStatus
  createdAt: string
  updatedAt: string
  userPromptSummary?: string | null
}

export interface DesignerFreeformCompletionRunsResult {
  workspaceId: string
  documentId: string
  runs: DesignerFreeformCompletionRun[]
}
