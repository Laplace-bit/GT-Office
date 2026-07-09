import { desktopApi } from '@shell/integration/desktop-api'
import type {
  DesignerCheckpointHistoryResult,
  DesignerCheckpointResult,
  DesignerCompileResult,
  DesignerCreateDocumentParams,
  DesignerDiffResult,
  DesignerDocumentDetail,
  DesignerExportResult,
  DesignerInitDocsRepoResponse,
  DesignerListDocumentsResponse,
} from '../model/designer-document'
import type {
  DesignerAgentCompletionDispatchResult,
  DesignerAgentPatch,
  DesignerAgentTaskPreview,
  DesignerPatchApplyResult,
  DesignerPatchValidationResult,
  DesignerRecoveredAgentPatchResult,
} from '../model/designer-patch'
import type {
  DesignerFreeformCompletionRequest,
  DesignerFreeformCompletionRun,
  DesignerFreeformCompletionRunLogRequest,
  DesignerFreeformCompletionRunLogResult,
  DesignerFreeformCompletionRunStatusRequest,
  DesignerFreeformCompletionRunsResult,
  DesignerRevertToCheckpointRequest,
} from '../model/designer-freeform-completion'
import type { DesignerValidationResult } from '../model/designer-validation'
import type {
  DesignerAgentStationResult,
  DesignerScenario,
  DesignerScenarioPromptResult,
} from '../model/designer-agent-station'

type ApiRecord = Record<string, unknown>

function apiRecord(): ApiRecord {
  return desktopApi as unknown as ApiRecord
}

function getApiMethod<TArgs extends unknown[], TResult>(
  names: string[],
): ((...args: TArgs) => Promise<TResult>) {
  const source = apiRecord()
  for (const name of names) {
    const candidate = source[name]
    if (typeof candidate === 'function') {
      return candidate.bind(desktopApi) as (...args: TArgs) => Promise<TResult>
    }
  }
  throw new Error(`Business Designer desktop API is not available: ${names.join(' / ')}`)
}

export function isBusinessDesignerRuntime(): boolean {
  return typeof desktopApi.isTauriRuntime === 'function' && desktopApi.isTauriRuntime()
}

export async function confirmDesignerDestructiveAction(
  title: string,
  message: string,
): Promise<boolean> {
  const source = apiRecord()
  const confirm = source.systemConfirm
  if (isBusinessDesignerRuntime() && typeof confirm === 'function') {
    return confirm.call(desktopApi, title, message) as Promise<boolean>
  }
  return window.confirm(message)
}

export function listDesignerDocuments(
  workspaceId: string,
  traceId?: string,
): Promise<DesignerListDocumentsResponse> {
  return getApiMethod<[string, string | undefined], DesignerListDocumentsResponse>([
    'businessDesignerListDocuments',
    'listBusinessDesignerDocuments',
  ])(workspaceId, traceId)
}

export function initDesignerDocsRepo(
  workspaceId: string,
  traceId?: string,
): Promise<DesignerInitDocsRepoResponse> {
  return getApiMethod<[string, string | undefined], DesignerInitDocsRepoResponse>([
    'businessDesignerInitDocsRepo',
    'initBusinessDesignerDocsRepo',
  ])(workspaceId, traceId)
}

export function createDesignerDocument(
  workspaceId: string,
  params: DesignerCreateDocumentParams,
  traceId?: string,
): Promise<DesignerDocumentDetail> {
  return getApiMethod<
    [string, DesignerCreateDocumentParams, string | undefined],
    DesignerDocumentDetail
  >([
    'businessDesignerCreateDocument',
    'createBusinessDesignerDocument',
  ])(workspaceId, params, traceId)
}

export function readDesignerDocument(
  workspaceId: string,
  documentId: string,
  traceId?: string,
): Promise<DesignerDocumentDetail> {
  return getApiMethod<[string, string, string | undefined], DesignerDocumentDetail>([
    'businessDesignerReadDocument',
    'readBusinessDesignerDocument',
  ])(workspaceId, documentId, traceId)
}

export function saveDesignerDocument(
  workspaceId: string,
  detail: DesignerDocumentDetail,
  traceId?: string,
): Promise<DesignerDocumentDetail> {
  return getApiMethod<[string, DesignerDocumentDetail, string | undefined], DesignerDocumentDetail>([
    'businessDesignerSaveDocument',
    'saveBusinessDesignerDocument',
  ])(workspaceId, detail, traceId)
}

export function validateDesignerDocument(
  workspaceId: string,
  documentId: string,
  traceId?: string,
): Promise<DesignerValidationResult> {
  return getApiMethod<[string, string, string | undefined], DesignerValidationResult>([
    'businessDesignerValidateDocument',
    'validateBusinessDesignerDocument',
  ])(workspaceId, documentId, traceId)
}

export function compileDesignerDocument(
  workspaceId: string,
  documentId: string,
  traceId?: string,
): Promise<DesignerCompileResult> {
  return getApiMethod<[string, string, string | undefined], DesignerCompileResult>([
    'businessDesignerCompileDocument',
    'compileBusinessDesignerDocument',
  ])(workspaceId, documentId, traceId)
}

export function createDesignerCheckpoint(
  workspaceId: string,
  documentId: string,
  message: string,
  traceId?: string,
): Promise<DesignerCheckpointResult> {
  return getApiMethod<[string, string, string, string | undefined], DesignerCheckpointResult>([
    'businessDesignerCreateCheckpoint',
    'createBusinessDesignerCheckpoint',
  ])(workspaceId, documentId, message, traceId)
}

export function listDesignerCheckpoints(
  workspaceId: string,
  documentId: string,
  traceId?: string,
): Promise<DesignerCheckpointHistoryResult> {
  return getApiMethod<
    [string, { documentId: string }, string | undefined],
    DesignerCheckpointHistoryResult
  >([
    'businessDesignerListCheckpoints',
    'listBusinessDesignerCheckpoints',
  ])(workspaceId, { documentId }, traceId)
}

export function diffDesignerWorkingTree(
  workspaceId: string,
  documentId: string,
  base?: string | null,
  traceId?: string,
): Promise<DesignerDiffResult> {
  return getApiMethod<
    [string, { documentId: string; base?: string | null }, string | undefined],
    DesignerDiffResult
  >([
    'businessDesignerDiffCheckpoint',
    'diffBusinessDesignerCheckpoint',
  ])(workspaceId, { documentId, base: base ?? null }, traceId)
}

export function compareDesignerCheckpoints(
  workspaceId: string,
  documentId: string,
  base: string,
  head: string,
  traceId?: string,
): Promise<DesignerDiffResult> {
  return getApiMethod<
    [string, { documentId: string; base: string; head: string }, string | undefined],
    DesignerDiffResult
  >([
    'businessDesignerCompareCheckpoints',
    'compareBusinessDesignerCheckpoints',
  ])(workspaceId, { documentId, base, head }, traceId)
}

export function previewDesignerAgentTask(
  workspaceId: string,
  params: {
    traceId: string
    documentId: string
    selectedBlockIds: string[]
    provider: string
    hostBlockId: string
    gapCodes: string[]
    scope: 'single' | 'block'
    baseRevision: string
  },
): Promise<DesignerAgentTaskPreview> {
  return getApiMethod<
    [
      string,
      {
        traceId: string
        documentId: string
        selectedBlockIds: string[]
        provider: string
        hostBlockId: string
        gapCodes: string[]
        scope: 'single' | 'block'
        baseRevision: string
      },
    ],
    DesignerAgentTaskPreview
  >([
    'businessDesignerPreviewAgentTask',
    'previewBusinessDesignerAgentTask',
  ])(workspaceId, params)
}

export function runDesignerAgentCompletion(
  workspaceId: string,
  params: {
    traceId: string
    documentId: string
    targetAgentIds: string[]
    hostBlockId: string
    gapCodes: string[]
    scope: 'single' | 'block'
    baseRevision: string
  },
): Promise<DesignerAgentCompletionDispatchResult> {
  return getApiMethod<
    [
      string,
      {
        traceId: string
        documentId: string
        targetAgentIds: string[]
        hostBlockId: string
        gapCodes: string[]
        scope: 'single' | 'block'
        baseRevision: string
      },
    ],
    DesignerAgentCompletionDispatchResult
  >([
    'businessDesignerRunAgentCompletion',
    'runBusinessDesignerAgentCompletion',
])(workspaceId, params)
}

export function startDesignerFreeformCompletion(
  workspaceId: string,
  params: DesignerFreeformCompletionRequest,
): Promise<DesignerFreeformCompletionRun> {
  return getApiMethod<
    [string, DesignerFreeformCompletionRequest],
    DesignerFreeformCompletionRun
  >([
    'businessDesignerStartFreeformCompletion',
    'startBusinessDesignerFreeformCompletion',
  ])(workspaceId, params)
}

export function listDesignerFreeformCompletionRuns(
  workspaceId: string,
  documentId: string,
  traceId?: string,
): Promise<DesignerFreeformCompletionRunsResult> {
  return getApiMethod<
    [string, string, string | undefined],
    DesignerFreeformCompletionRunsResult
  >([
    'businessDesignerListFreeformCompletionRuns',
    'listBusinessDesignerFreeformCompletionRuns',
  ])(workspaceId, documentId, traceId)
}

export function updateDesignerFreeformCompletionRunStatus(
  workspaceId: string,
  params: DesignerFreeformCompletionRunStatusRequest,
): Promise<DesignerFreeformCompletionRun> {
  return getApiMethod<
    [string, DesignerFreeformCompletionRunStatusRequest],
    DesignerFreeformCompletionRun
  >([
    'businessDesignerUpdateFreeformCompletionRunStatus',
    'updateBusinessDesignerFreeformCompletionRunStatus',
  ])(workspaceId, params)
}

export function readDesignerFreeformCompletionRunLog(
  workspaceId: string,
  params: DesignerFreeformCompletionRunLogRequest,
): Promise<DesignerFreeformCompletionRunLogResult> {
  return getApiMethod<
    [string, DesignerFreeformCompletionRunLogRequest],
    DesignerFreeformCompletionRunLogResult
  >([
    'businessDesignerReadFreeformCompletionRunLog',
    'readBusinessDesignerFreeformCompletionRunLog',
  ])(workspaceId, params)
}

export function revertDesignerToCheckpoint(
  workspaceId: string,
  params: DesignerRevertToCheckpointRequest,
): Promise<DesignerDocumentDetail> {
  return getApiMethod<
    [string, DesignerRevertToCheckpointRequest],
    DesignerDocumentDetail
  >([
    'businessDesignerRevertToCheckpoint',
    'revertBusinessDesignerToCheckpoint',
  ])(workspaceId, params)
}

export function runMockDesignerAgentCompletion(
  workspaceId: string,
  params: {
    traceId: string
    documentId: string
    selectedBlockIds?: string[]
    hostBlockId: string
    gapCodes: string[]
    scope: 'single' | 'block'
    baseRevision: string
  },
): Promise<DesignerPatchValidationResult> {
  return getApiMethod<
    [
      string,
      {
        traceId: string
        documentId: string
        hostBlockId: string
        gapCodes: string[]
        scope: 'single' | 'block'
        baseRevision: string
        selectedBlockIds?: string[]
      },
    ],
    DesignerPatchValidationResult
  >([
    'businessDesignerRunMockAgentCompletion',
    'runBusinessDesignerMockAgentCompletion',
  ])(workspaceId, {
    traceId: params.traceId,
    documentId: params.documentId,
    hostBlockId: params.hostBlockId,
    gapCodes: params.gapCodes,
    scope: params.scope,
    baseRevision: params.baseRevision,
    selectedBlockIds: params.selectedBlockIds ?? [],
  })
}

export function applyDesignerAgentPatch(
  workspaceId: string,
  documentId: string,
  patch: DesignerAgentPatch,
  acceptedChangeIndices?: number[] | null,
  traceId?: string,
): Promise<DesignerPatchApplyResult> {
  return getApiMethod<
    [string, string, DesignerAgentPatch, number[] | null | undefined, string | undefined],
    DesignerPatchApplyResult
  >([
    'businessDesignerApplyAgentPatch',
    'applyBusinessDesignerAgentPatch',
  ])(workspaceId, documentId, patch, acceptedChangeIndices, traceId)
}

export function recoverDesignerAgentPatchFromTask(
  workspaceId: string,
  documentId: string,
  taskId: string,
  traceId?: string,
): Promise<DesignerRecoveredAgentPatchResult> {
  return getApiMethod<[string, string, string, string | undefined], DesignerRecoveredAgentPatchResult>([
    'businessDesignerRecoverAgentPatchFromTask',
    'recoverBusinessDesignerAgentPatchFromTask',
  ])(workspaceId, documentId, taskId, traceId)
}

export function exportDesignerDocumentToFile(
  workspaceId: string,
  documentId: string,
  format: string,
  traceId?: string,
): Promise<DesignerExportResult> {
  return getApiMethod<[string, string, string, string | undefined], DesignerExportResult>([
    'businessDesignerExportDocumentToFile',
    'exportBusinessDesignerDocumentToFile',
  ])(workspaceId, documentId, format, traceId)
}

export function ensureDesignerAgentStation(
  workspaceId: string,
  traceId?: string,
): Promise<DesignerAgentStationResult> {
  return getApiMethod<[string, string | undefined], DesignerAgentStationResult>([
    'businessDesignerEnsureAgentStation',
    'ensureBusinessDesignerAgentStation',
  ])(workspaceId, traceId)
}

export function renderDesignerScenarioPrompt(
  workspaceId: string,
  documentId: string,
  scenario: DesignerScenario,
  hostBlockId: string | null,
  userPrompt: string | null,
  traceId?: string,
): Promise<DesignerScenarioPromptResult> {
  return getApiMethod<
    [string, string, DesignerScenario, string | null, string | null, string | undefined],
    DesignerScenarioPromptResult
  >([
    'businessDesignerRenderScenarioPrompt',
    'renderBusinessDesignerScenarioPrompt',
  ])(workspaceId, documentId, scenario, hostBlockId, userPrompt, traceId)
}

export function checkpointDesignerTurn(
  workspaceId: string,
  documentId: string,
  message: string | null,
  traceId?: string,
): Promise<DesignerCheckpointResult> {
  return getApiMethod<[string, string, string | null, string | undefined], DesignerCheckpointResult>(
    ['businessDesignerCheckpointTurn', 'checkpointBusinessDesignerTurn'],
  )(workspaceId, documentId, message, traceId)
}
