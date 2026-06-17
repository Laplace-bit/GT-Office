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
  DesignerAgentPatch,
  DesignerPatchApplyResult,
  DesignerPatchValidationResult,
} from '../model/designer-patch'
import type { DesignerValidationResult } from '../model/designer-validation'

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

export function listDesignerDocuments(workspaceId: string): Promise<DesignerListDocumentsResponse> {
  return getApiMethod<[string], DesignerListDocumentsResponse>([
    'businessDesignerListDocuments',
    'listBusinessDesignerDocuments',
  ])(workspaceId)
}

export function initDesignerDocsRepo(workspaceId: string): Promise<DesignerInitDocsRepoResponse> {
  return getApiMethod<[string], DesignerInitDocsRepoResponse>([
    'businessDesignerInitDocsRepo',
    'initBusinessDesignerDocsRepo',
  ])(workspaceId)
}

export function createDesignerDocument(
  workspaceId: string,
  params: DesignerCreateDocumentParams,
): Promise<DesignerDocumentDetail> {
  return getApiMethod<[string, DesignerCreateDocumentParams], DesignerDocumentDetail>([
    'businessDesignerCreateDocument',
    'createBusinessDesignerDocument',
  ])(workspaceId, params)
}

export function readDesignerDocument(
  workspaceId: string,
  documentId: string,
): Promise<DesignerDocumentDetail> {
  return getApiMethod<[string, string], DesignerDocumentDetail>([
    'businessDesignerReadDocument',
    'readBusinessDesignerDocument',
  ])(workspaceId, documentId)
}

export function saveDesignerDocument(
  workspaceId: string,
  detail: DesignerDocumentDetail,
): Promise<DesignerDocumentDetail> {
  return getApiMethod<[string, DesignerDocumentDetail], DesignerDocumentDetail>([
    'businessDesignerSaveDocument',
    'saveBusinessDesignerDocument',
  ])(workspaceId, detail)
}

export function validateDesignerDocument(
  workspaceId: string,
  documentId: string,
): Promise<DesignerValidationResult> {
  return getApiMethod<[string, string], DesignerValidationResult>([
    'businessDesignerValidateDocument',
    'validateBusinessDesignerDocument',
  ])(workspaceId, documentId)
}

export function compileDesignerDocument(
  workspaceId: string,
  documentId: string,
): Promise<DesignerCompileResult> {
  return getApiMethod<[string, string], DesignerCompileResult>([
    'businessDesignerCompileDocument',
    'compileBusinessDesignerDocument',
  ])(workspaceId, documentId)
}

export function createDesignerCheckpoint(
  workspaceId: string,
  documentId: string,
  message: string,
): Promise<DesignerCheckpointResult> {
  return getApiMethod<[string, string, string], DesignerCheckpointResult>([
    'businessDesignerCreateCheckpoint',
    'createBusinessDesignerCheckpoint',
  ])(workspaceId, documentId, message)
}

export function listDesignerCheckpoints(
  workspaceId: string,
  documentId: string,
): Promise<DesignerCheckpointHistoryResult> {
  return getApiMethod<[string, { documentId: string }], DesignerCheckpointHistoryResult>([
    'businessDesignerListCheckpoints',
    'listBusinessDesignerCheckpoints',
  ])(workspaceId, { documentId })
}

export function diffDesignerWorkingTree(
  workspaceId: string,
  documentId: string,
  base?: string | null,
): Promise<DesignerDiffResult> {
  return getApiMethod<
    [string, { documentId: string; base?: string | null }],
    DesignerDiffResult
  >([
    'businessDesignerDiffCheckpoint',
    'diffBusinessDesignerCheckpoint',
  ])(workspaceId, { documentId, base: base ?? null })
}

export function compareDesignerCheckpoints(
  workspaceId: string,
  documentId: string,
  base: string,
  head: string,
): Promise<DesignerDiffResult> {
  return getApiMethod<
    [string, { documentId: string; base: string; head: string }],
    DesignerDiffResult
  >([
    'businessDesignerCompareCheckpoints',
    'compareBusinessDesignerCheckpoints',
  ])(workspaceId, { documentId, base, head })
}

export function runDesignerAgentCompletion(
  workspaceId: string,
  params: { documentId: string; selectedBlockIds: string[]; provider: string },
): Promise<DesignerPatchValidationResult> {
  return getApiMethod<
    [string, { documentId: string; selectedBlockIds: string[]; provider: string }],
    DesignerPatchValidationResult
  >([
    'businessDesignerRunAgentCompletion',
    'runBusinessDesignerAgentCompletion',
  ])(workspaceId, params)
}

export function applyDesignerAgentPatch(
  workspaceId: string,
  documentId: string,
  patch: DesignerAgentPatch,
  acceptedChangeIndices?: number[] | null,
): Promise<DesignerPatchApplyResult> {
  return getApiMethod<
    [string, string, DesignerAgentPatch, number[] | null | undefined],
    DesignerPatchApplyResult
  >([
    'businessDesignerApplyAgentPatch',
    'applyBusinessDesignerAgentPatch',
  ])(workspaceId, documentId, patch, acceptedChangeIndices)
}

export function exportDesignerDocumentToFile(
  workspaceId: string,
  documentId: string,
  format: string,
): Promise<DesignerExportResult> {
  return getApiMethod<[string, string, string], DesignerExportResult>([
    'businessDesignerExportDocumentToFile',
    'exportBusinessDesignerDocumentToFile',
  ])(workspaceId, documentId, format)
}
