import type {
  BusinessDesignerAgentCompletionRequest,
  BusinessDesignerAgentCompletionDispatchResult,
  BusinessDesignerApplyAgentPatchRequest,
  BusinessDesignerAgentPatch,
  BusinessDesignerAgentTaskPreview,
  BusinessDesignerAgentTaskPreviewRequest,
  BusinessDesignerFreeformCompletionRequest,
  BusinessDesignerFreeformCompletionRun,
  BusinessDesignerFreeformCompletionRunLogRequest,
  BusinessDesignerFreeformCompletionRunLogResult,
  BusinessDesignerFreeformCompletionRunsResult,
  BusinessDesignerGap,
  BusinessDesignerMockAgentCompletionRequest,
  BusinessDesignerRecoverAgentPatchRequest,
  BusinessDesignerPatchApplyResult,
  BusinessDesignerPatchValidationResult,
  BusinessDesignerRecoveredAgentPatchResult,
  BusinessDesignerRuleRun,
  BusinessDesignerValidateAgentPatchRequest,
  BusinessDesignerValidationResult,
} from "./business-designer.js";

const gapSample = {
  id: "gap_1",
  key: "domain-model|no-fields",
  code: "no-fields",
  blockId: "domain-model",
  layer: "intra",
  severity: "error",
  message: "实体没有字段。",
  fixableByAgent: true,
  locator: { fieldIndex: "0" },
} satisfies BusinessDesignerGap;

const ruleRunSample = {
  kind: "entityModel",
  code: "no-fields",
  blockId: "domain-model",
  passed: false,
  gapCount: 1,
} satisfies BusinessDesignerRuleRun;

const validationResultSample = {
  schemaVersion: 1,
  workspaceId: "ws-1",
  documentId: "order-system",
  revision: "rev-1",
  diagnostics: [],
  gaps: [gapSample],
  rulesRun: [ruleRunSample],
  graphProjection: {
    links: [
      {
        fromBlockId: "api-contract",
        toBlockId: "domain-model",
        relation: "dependsOn",
        sourceField: "response",
      },
    ],
  },
} satisfies BusinessDesignerValidationResult;

const agentTaskPreviewRequestSample = {
  traceId: "designer-ipc-1",
  workspaceId: "ws-1",
  documentId: "order-system",
  selectedBlockIds: [],
  provider: "mock",
  hostBlockId: "domain-model",
  gapCodes: ["no-fields"],
  scope: "single",
  baseRevision: "rev-1",
} satisfies BusinessDesignerAgentTaskPreviewRequest;

const agentCompletionRequestSample = {
  traceId: "designer-ipc-2",
  workspaceId: "ws-1",
  documentId: "order-system",
  targetAgentIds: ["codex-1"],
  hostBlockId: "domain-model",
  gapCodes: ["no-fields"],
  scope: "single",
  baseRevision: "rev-1",
} satisfies BusinessDesignerAgentCompletionRequest;

const agentTaskPreviewSample = {
  workspaceId: "ws-1",
  documentId: "order-system",
  requestId: "bdreq_0123456789abcdef",
  provider: "mock",
  status: "ready",
  schemaVersion: 1,
  selectedBlockIds: [],
  revision: "rev-1",
  contextPath: ".gtoffice/docs/documents/order-system/design.json",
  outputContract: "DesignerAgentPatch",
  lifecycle:
    "preview -> validate -> confirm -> dispatch -> receive patch -> validate patch -> review -> apply -> compile -> checkpoint",
  hostBlockId: "domain-model",
  gapCodes: ["no-fields"],
  targetGapKeys: [gapSample.key],
  scope: "single",
  targetGaps: [gapSample],
  contextGaps: [],
  hostBlock: {
    id: "domain-model",
    kind: "entityModel",
    title: "Order",
    order: 20,
    payload: { entityName: "Order", fields: [] },
    links: [],
    validation: [],
    updatedAt: "2026-06-18T00:00:00.000Z",
  },
  adjacency: [
    {
      fromBlockId: "api-contract",
      toBlockId: "domain-model",
      relation: "dependsOn",
      sourceField: "response",
    },
  ],
} satisfies BusinessDesignerAgentTaskPreview;

const agentPatchSample = {
  schemaVersion: 1,
  documentId: "order-system",
  baseRevision: "rev-1",
  summary: "Fill Order fields",
  changes: [
    {
      op: "updateBlock",
      blockId: "domain-model",
      patch: {
        payload: {
          entityName: "Order",
          fields: [{ name: "id", type: "string", required: true }],
        },
      },
    },
  ],
  openQuestions: [],
  hostBlockId: "domain-model",
  gapCodes: ["no-fields"],
  targetGapKeys: [gapSample.key],
  scope: "single",
} satisfies BusinessDesignerAgentPatch;

const patchValidationSample = {
  workspaceId: "ws-1",
  documentId: "order-system",
  patchPath: "documents/order-system/patches/agent-patch-task-recovered-1.json",
  patch: agentPatchSample,
  diagnostics: [],
  changes: [
    {
      op: "updateBlock",
      blockId: "domain-model",
      title: "Order",
      kind: "entityModel",
      destructive: false,
      summary: "Update block 'domain-model'",
    },
  ],
  valid: true,
} satisfies BusinessDesignerPatchValidationResult;

const dispatchResultSample = {
  workspaceId: "ws-1",
  documentId: "order-system",
  requestId: "bdreq_0123456789abcdef",
  dispatch: {
    batchId: "batch-1",
    results: [
      {
        targetAgentId: "codex-1",
        taskId: "task-1",
        status: "sent",
        detail: null,
        taskFilePath: "tasks/task-1.json",
      },
    ],
  },
} satisfies BusinessDesignerAgentCompletionDispatchResult;

const freeformCompletionRequestSample = {
  traceId: "designer-ipc-freeform-1",
  workspaceId: "ws-1",
  documentId: "order-system",
  scenario: "complete_entity",
  hostBlockId: "domain-model",
  userPrompt: "Prefer event-sourced order lifecycle fields.",
  provider: "codex",
} satisfies BusinessDesignerFreeformCompletionRequest;

const freeformCompletionRunSample = {
  requestId: "bdfree_0123456789abcdef",
  workspaceId: "ws-1",
  documentId: "order-system",
  scenario: "complete_entity",
  hostBlockId: "domain-model",
  provider: "codex",
  sessionId: "term-1",
  documentRoot: "/workspace/.gtoffice/docs/documents/order-system",
  checkpointBefore: "abc123",
  status: "running",
  createdAt: "2026-06-21T00:00:00.000Z",
  updatedAt: "2026-06-21T00:00:00.000Z",
  userPromptSummary: "Prefer event-sourced order lifecycle fields.",
} satisfies BusinessDesignerFreeformCompletionRun;

const freeformCompletionRunsResultSample = {
  workspaceId: "ws-1",
  documentId: "order-system",
  runs: [freeformCompletionRunSample],
} satisfies BusinessDesignerFreeformCompletionRunsResult;

const freeformCompletionRunLogRequestSample = {
  traceId: "designer-ipc-freeform-log-1",
  workspaceId: "ws-1",
  documentId: "order-system",
  requestId: "bdfree_0123456789abcdef",
} satisfies BusinessDesignerFreeformCompletionRunLogRequest;

const freeformCompletionRunLogResultSample = {
  workspaceId: "ws-1",
  documentId: "order-system",
  requestId: "bdfree_0123456789abcdef",
  log: "Starting codex freeform completion\n",
} satisfies BusinessDesignerFreeformCompletionRunLogResult;

const mockAgentCompletionRequestSample = {
  traceId: "designer-ipc-3",
  workspaceId: "ws-1",
  documentId: "order-system",
  hostBlockId: "domain-model",
  gapCodes: ["no-fields"],
  scope: "single",
  baseRevision: "rev-1",
  selectedBlockIds: ["domain-model"],
} satisfies BusinessDesignerMockAgentCompletionRequest;

const validateAgentPatchRequestSample = {
  traceId: "designer-ipc-4",
  workspaceId: "ws-1",
  documentId: "order-system",
  patch: agentPatchSample,
} satisfies BusinessDesignerValidateAgentPatchRequest;

const recoverAgentPatchRequestSample = {
  traceId: "designer-ipc-5",
  workspaceId: "ws-1",
  documentId: "order-system",
  taskId: "task-1",
} satisfies BusinessDesignerRecoverAgentPatchRequest;

const applyAgentPatchRequestSample = {
  traceId: "designer-ipc-6",
  workspaceId: "ws-1",
  documentId: "order-system",
  patch: agentPatchSample,
  acceptedChangeIndices: [0],
} satisfies BusinessDesignerApplyAgentPatchRequest;

const recoveredPatchSample = {
  workspaceId: "ws-1",
  documentId: "order-system",
  taskId: "task-1",
  sourceMessageId: "msg-1",
  sourceAgentId: "codex-1",
  sourceMessageType: "handover",
  validation: patchValidationSample,
} satisfies BusinessDesignerRecoveredAgentPatchResult;

const patchApplyResultSample = {
  workspaceId: "ws-1",
  documentId: "order-system",
  appliedRevision: "rev-2",
  patchPath: "documents/order-system/patches/agent-patch-1.json",
  acceptedChanges: [0],
  skippedChanges: [],
  detail: {
    workspaceId: "ws-1",
    manifest: { documentId: "order-system" },
    design: { revision: "rev-2" },
  },
  diagnostics: [],
  gapResolution: {
    targetGapKeys: [gapSample.key],
    resolved: [gapSample.key],
    unresolved: [],
    incidentalResolved: [],
    introduced: [],
  },
  gaps: [],
  rulesRun: [
    {
      kind: "entityModel",
      code: "no-fields",
      blockId: "domain-model",
      passed: true,
      gapCount: 0,
    },
  ],
  graphProjection: {
    links: [],
  },
} satisfies BusinessDesignerPatchApplyResult;

void ruleRunSample;
void validationResultSample;
void agentTaskPreviewRequestSample;
void agentTaskPreviewSample;
void agentCompletionRequestSample;
void dispatchResultSample;
void freeformCompletionRequestSample;
void freeformCompletionRunSample;
void freeformCompletionRunsResultSample;
void mockAgentCompletionRequestSample;
void validateAgentPatchRequestSample;
void recoverAgentPatchRequestSample;
void applyAgentPatchRequestSample;
void recoveredPatchSample;
void patchApplyResultSample;
