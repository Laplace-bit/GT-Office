export interface BusinessDesignerDiagnostic {
  code: string;
  severity: "info" | "warning" | "error" | string;
  message: string;
  blockId?: string | null;
  path?: string | null;
}

export interface BusinessDesignerBlockLink {
  targetBlockId: string;
  relation: string;
}

export interface BusinessDesignerBlock {
  id: string;
  kind: string;
  title: string;
  order: number;
  payload: unknown;
  links: BusinessDesignerBlockLink[];
  validation: BusinessDesignerDiagnostic[];
  updatedAt: string;
}

export interface BusinessDesignerGap {
  id: string;
  key: string;
  code: string;
  blockId: string;
  layer: "intra" | "inter";
  severity: "warning" | "error";
  message: string;
  fixableByAgent: boolean;
  locator?: Record<string, string> | null;
}

export interface BusinessDesignerRuleRun {
  kind: string;
  code: string;
  blockId: string;
  passed: boolean;
  gapCount: number;
}

export interface BusinessDesignerDerivedEdge {
  fromBlockId: string;
  toBlockId: string;
  relation: "dependsOn" | "produces" | "consumes" | "uses" | "extends";
  sourceField?: string | null;
}

export interface BusinessDesignerGraphProjection {
  links: BusinessDesignerDerivedEdge[];
}

export interface BusinessDesignerValidationResult {
  schemaVersion: number;
  workspaceId: string;
  documentId: string;
  revision: string;
  diagnostics: BusinessDesignerDiagnostic[];
  gaps: BusinessDesignerGap[];
  rulesRun: BusinessDesignerRuleRun[];
  graphProjection: BusinessDesignerGraphProjection;
}

export interface BusinessDesignerAgentTaskPreviewRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  selectedBlockIds: string[];
  provider: string;
  hostBlockId: string;
  gapCodes: string[];
  scope: "single" | "block";
  baseRevision: string;
}

export interface BusinessDesignerAgentCompletionRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  targetAgentIds: string[];
  hostBlockId: string;
  gapCodes: string[];
  scope: "single" | "block";
  baseRevision: string;
}

export interface BusinessDesignerAgentTaskPreview {
  workspaceId: string;
  documentId: string;
  requestId: string;
  provider: string;
  status: "ready" | "no_agent_fixable_gaps" | string;
  schemaVersion: number;
  selectedBlockIds: string[];
  revision: string;
  contextPath: string;
  outputContract: string;
  lifecycle: string;
  hostBlockId: string;
  gapCodes: string[];
  targetGapKeys: string[];
  scope: "single" | "block";
  targetGaps: BusinessDesignerGap[];
  contextGaps: BusinessDesignerGap[];
  hostBlock?: BusinessDesignerBlock | null;
  adjacency?: BusinessDesignerDerivedEdge[] | null;
}

export interface BusinessDesignerGapResolution {
  targetGapKeys: string[];
  resolved: string[];
  unresolved: string[];
  incidentalResolved: string[];
  introduced: BusinessDesignerGap[];
}

export interface BusinessDesignerAgentPatchBlock {
  id: string;
  kind: string;
  title: string;
  order?: number | null;
  payload: Record<string, unknown>;
}

export interface BusinessDesignerPatchOperation {
  op: "updateBlock";
  blockId: string;
  patch: Partial<Omit<BusinessDesignerAgentPatchBlock, "id">>;
}

export interface BusinessDesignerAgentPatch {
  schemaVersion: number;
  documentId: string;
  baseRevision: string;
  summary: string;
  changes: BusinessDesignerPatchOperation[];
  openQuestions: string[];
  hostBlockId: string;
  gapCodes: string[];
  targetGapKeys: string[];
  scope?: "single" | "block" | null;
}

export interface BusinessDesignerPatchPreviewChange {
  op: string;
  blockId: string;
  title?: string | null;
  kind?: string | null;
  destructive: boolean;
  summary: string;
}

export interface BusinessDesignerPatchValidationResult {
  workspaceId: string;
  documentId: string;
  patchPath?: string | null;
  patch: BusinessDesignerAgentPatch;
  diagnostics: BusinessDesignerDiagnostic[];
  changes: BusinessDesignerPatchPreviewChange[];
  valid: boolean;
}

export interface BusinessDesignerTaskDispatchBatchResult {
  targetAgentId: string;
  taskId: string;
  status: "sent" | "failed" | string;
  detail?: string | null;
  taskFilePath?: string | null;
}

export interface BusinessDesignerTaskDispatchBatchResponse {
  batchId: string;
  results: BusinessDesignerTaskDispatchBatchResult[];
}

export interface BusinessDesignerAgentCompletionDispatchResult {
  workspaceId: string;
  documentId: string;
  requestId: string;
  dispatch: BusinessDesignerTaskDispatchBatchResponse;
}

export type BusinessDesignerFreeformCompletionScenario =
  | "brief_to_design"
  | "complete_entity"
  | "complete_flow"
  | "complete_api_contract"
  | "expand_canvas";

export type BusinessDesignerFreeformCompletionProvider = "codex" | "claude";

export type BusinessDesignerFreeformCompletionRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface BusinessDesignerFreeformCompletionRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  scenario: BusinessDesignerFreeformCompletionScenario;
  hostBlockId?: string | null;
  userPrompt?: string | null;
  provider?: BusinessDesignerFreeformCompletionProvider | null;
}

export interface BusinessDesignerFreeformCompletionRunStatusRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  requestId: string;
  status: BusinessDesignerFreeformCompletionRunStatus;
}

export interface BusinessDesignerRevertToCheckpointRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  checkpoint: string;
}

export interface BusinessDesignerFreeformCompletionRun {
  requestId: string;
  workspaceId: string;
  documentId: string;
  scenario: BusinessDesignerFreeformCompletionScenario;
  hostBlockId?: string | null;
  provider: BusinessDesignerFreeformCompletionProvider;
  sessionId: string;
  documentRoot: string;
  checkpointBefore: string;
  status: BusinessDesignerFreeformCompletionRunStatus;
  createdAt: string;
  updatedAt: string;
  userPromptSummary?: string | null;
}

export interface BusinessDesignerFreeformCompletionRunsResult {
  workspaceId: string;
  documentId: string;
  runs: BusinessDesignerFreeformCompletionRun[];
}

export interface BusinessDesignerMockAgentCompletionRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  hostBlockId: string;
  gapCodes: string[];
  scope: "single" | "block";
  baseRevision: string;
  selectedBlockIds: string[];
}

export interface BusinessDesignerValidateAgentPatchRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  patch: BusinessDesignerAgentPatch;
}

export interface BusinessDesignerRecoverAgentPatchRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  taskId: string;
}

export interface BusinessDesignerApplyAgentPatchRequest {
  traceId?: string | null;
  workspaceId: string;
  documentId: string;
  patch: BusinessDesignerAgentPatch;
  acceptedChangeIndices?: number[] | null;
}

export interface BusinessDesignerRecoveredAgentPatchResult {
  workspaceId: string;
  documentId: string;
  taskId: string;
  sourceMessageId: string;
  sourceAgentId: string;
  sourceMessageType: string;
  validation: BusinessDesignerPatchValidationResult;
}

export interface BusinessDesignerPatchApplyResult {
  workspaceId: string;
  documentId: string;
  appliedRevision: string;
  patchPath: string;
  acceptedChanges: number[];
  skippedChanges: number[];
  detail: unknown;
  diagnostics: BusinessDesignerDiagnostic[];
  gapResolution: BusinessDesignerGapResolution;
  gaps: BusinessDesignerGap[];
  rulesRun: BusinessDesignerRuleRun[];
  graphProjection: BusinessDesignerGraphProjection;
}
