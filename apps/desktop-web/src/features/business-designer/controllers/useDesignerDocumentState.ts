import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DesignerBlock, DesignerBlockPatch } from '../model/designer-blocks'
import type {
  DesignerCheckpointResult,
  DesignerCompileResult,
  DesignerDiagnostic,
  DesignerDocumentDetail,
  DesignerExportFormat,
  DesignerExportResult,
} from '../model/designer-document'
import type {
  DesignerPatchApplyResult,
  DesignerPatchValidationResult,
} from '../model/designer-patch'
import type { DesignerValidationResult } from '../model/designer-validation'
import {
  applyDesignerAgentPatch,
  compileDesignerDocument,
  createDesignerCheckpoint,
  exportDesignerDocumentToFile,
  isBusinessDesignerRuntime,
  readDesignerDocument,
  runDesignerAgentCompletion,
  saveDesignerDocument,
  validateDesignerDocument,
} from './designerDesktopApi'

/** Id of the single editable natural-language brief block. */
export const BRIEF_BLOCK_ID = 'brief'

/** Block kinds the Agent produces; rendered as read-only inline sections. */
export const AGENT_BLOCK_KINDS = new Set<string>([
  'entityModel',
  'apiContract',
  'businessFlow',
  'acceptanceCriteria',
  'openQuestions',
  'glossary',
  'ruleTable',
  'objectModel',
  'dataContract',
  'technicalStack',
  'nonFunctional',
  'decisionRecord',
  'pseudocode',
  'uiWorkflow',
  'agentInstruction',
])

export type DesignerOperation =
  | 'load'
  | 'save'
  | 'validate'
  | 'compile'
  | 'checkpoint'
  | 'agent'
  | 'apply'
  | 'export'

export interface DesignerNotice {
  kind: 'info' | 'success' | 'warning' | 'error'
  text: string
}

interface UseDesignerDocumentStateInput {
  workspaceId: string | null
  selectedDocumentId: string | null
  active: boolean
}

interface UseDesignerDocumentStateResult {
  detail: DesignerDocumentDetail | null
  loading: boolean
  dirty: boolean
  operation: DesignerOperation | null
  error: string | null
  notice: DesignerNotice | null
  /** The single editable brief block, or null when no document is open. */
  brief: DesignerBlock | null
  /** Agent-produced blocks rendered as read-only inline sections. */
  agentBlocks: DesignerBlock[]
  diagnostics: DesignerDiagnostic[]
  patchValidation: DesignerPatchValidationResult | null
  validation: DesignerValidationResult | null
  compileResult: DesignerCompileResult | null
  checkpointResult: DesignerCheckpointResult | null
  exportResult: DesignerExportResult | null
  loadDocument: () => Promise<void>
  replaceDetail: (detail: DesignerDocumentDetail | null, markDirty?: boolean) => void
  /** Patch the brief block (markdown body) or any other block by id. */
  updateBlock: (blockId: string, patch: DesignerBlockPatch) => void
  save: () => Promise<void>
  validate: () => Promise<void>
  compile: () => Promise<void>
  createCheckpoint: (message: string) => Promise<void>
  runAgentCompletion: (provider: string) => Promise<void>
  applyPatch: (acceptedChangeIndices?: number[] | null) => Promise<void>
  exportDocument: (format: DesignerExportFormat) => Promise<void>
  /** Discard the current Agent patch without applying it (hides the review sheet). */
  clearPatchValidation: () => void
  clearNotice: () => void
}

function cloneDetail(detail: DesignerDocumentDetail): DesignerDocumentDetail {
  return structuredClone(detail)
}

function nowRevision(): string {
  return `web_ms_${Date.now()}`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Ensure the design has a single editable brief text block. New documents
 * seeded by the backend use an `overview` text block; we adopt whichever text
 * block is first as the brief surface, renaming its id so the Agent can target
 * it deterministically. If no text block exists, insert one. */
export function ensureBriefBlock(detail: DesignerDocumentDetail): DesignerDocumentDetail {
  const next = cloneDetail(detail)
  const blocks = next.design.blocks
  const existing = blocks.find((block) => block.id === BRIEF_BLOCK_ID)
  if (existing) {
    return next
  }
  const firstTextIndex = blocks.findIndex((block) => block.kind === 'text')
  if (firstTextIndex >= 0) {
    blocks[firstTextIndex] = { ...blocks[firstTextIndex], id: BRIEF_BLOCK_ID }
  } else {
    blocks.unshift({
      id: BRIEF_BLOCK_ID,
      kind: 'text',
      title: '',
      order: 0,
      payload: { markdown: '' },
      links: [],
      validation: [],
      updatedAt: next.design.revision,
    })
  }
  next.design.blocks = blocks
  return next
}

export function useDesignerDocumentState({
  workspaceId,
  selectedDocumentId,
  active,
}: UseDesignerDocumentStateInput): UseDesignerDocumentStateResult {
  const [detail, setDetail] = useState<DesignerDocumentDetail | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [operation, setOperation] = useState<DesignerOperation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<DesignerNotice | null>(null)
  const [patchValidation, setPatchValidation] = useState<DesignerPatchValidationResult | null>(null)
  const [validation, setValidation] = useState<DesignerValidationResult | null>(null)
  const [compileResult, setCompileResult] = useState<DesignerCompileResult | null>(null)
  const [checkpointResult, setCheckpointResult] = useState<DesignerCheckpointResult | null>(null)
  const [exportResult, setExportResult] = useState<DesignerExportResult | null>(null)

  const loadDocument = useCallback(async () => {
    if (!workspaceId || !selectedDocumentId || !isBusinessDesignerRuntime()) {
      setDetail(null)
      setDirty(false)
      setPatchValidation(null)
      setValidation(null)
      setCompileResult(null)
      setCheckpointResult(null)
      setExportResult(null)
      return
    }
    setLoading(true)
    setOperation('load')
    setError(null)
    try {
      const loaded = await readDesignerDocument(workspaceId, selectedDocumentId)
      setDetail(ensureBriefBlock(loaded))
      setDirty(false)
      setPatchValidation(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
      setOperation(null)
    }
  }, [workspaceId, selectedDocumentId])

  useEffect(() => {
    if (!active) {
      return
    }
    void loadDocument()
  }, [active, loadDocument])

  const replaceDetail = useCallback((next: DesignerDocumentDetail | null, markDirty = false) => {
    setDetail(next ? ensureBriefBlock(next) : null)
    setDirty(markDirty)
  }, [])

  const updateBlock = useCallback((blockId: string, patch: DesignerBlockPatch) => {
    setDetail((current) => {
      if (!current) {
        return current
      }
      const next = cloneDetail(current)
      next.design.blocks = next.design.blocks.map((block) =>
        block.id === blockId ? { ...block, ...patch } : block,
      )
      next.design.revision = nowRevision()
      return next
    })
    setDirty(true)
  }, [])

  const save = useCallback(async () => {
    if (!workspaceId || !detail) {
      return
    }
    setOperation('save')
    setError(null)
    try {
      const saved = await saveDesignerDocument(workspaceId, detail)
      setDetail(ensureBriefBlock(saved))
      setDirty(false)
      setNotice({ kind: 'success', text: 'saved' })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setOperation(null)
    }
  }, [workspaceId, detail])

  const validate = useCallback(async () => {
    if (!workspaceId || !detail) {
      return
    }
    setOperation('validate')
    setError(null)
    try {
      const result = await validateDesignerDocument(workspaceId, detail.manifest.documentId)
      setValidation(result)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setOperation(null)
    }
  }, [workspaceId, detail])

  const compile = useCallback(async () => {
    if (!workspaceId || !detail) {
      return
    }
    setOperation('compile')
    setError(null)
    try {
      const result = await compileDesignerDocument(workspaceId, detail.manifest.documentId)
      setCompileResult(result)
      setNotice({ kind: 'success', text: 'compiled' })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setOperation(null)
    }
  }, [workspaceId, detail])

  const createCheckpoint = useCallback(
    async (message: string) => {
      if (!workspaceId || !detail) {
        return
      }
      setOperation('checkpoint')
      setError(null)
      try {
        const result = await createDesignerCheckpoint(
          workspaceId,
          detail.manifest.documentId,
          message.trim() || detail.manifest.title,
        )
        setCheckpointResult(result)
        setNotice({ kind: 'success', text: 'checkpointed' })
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setOperation(null)
      }
    },
    [workspaceId, detail],
  )

  const runAgentCompletion = useCallback(
    async (provider: string) => {
      if (!workspaceId || !detail) {
        return
      }
      setOperation('agent')
      setError(null)
      try {
        const result = await runDesignerAgentCompletion(workspaceId, {
          documentId: detail.manifest.documentId,
          selectedBlockIds: [],
          provider,
        })
        setPatchValidation(result)
        setNotice({ kind: 'info', text: 'agentReady' })
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setOperation(null)
      }
    },
    [workspaceId, detail],
  )

  const applyPatch = useCallback(
    async (acceptedChangeIndices?: number[] | null) => {
      if (!workspaceId || !detail || !patchValidation?.patch) {
        return
      }
      setOperation('apply')
      setError(null)
      try {
        const result: DesignerPatchApplyResult = await applyDesignerAgentPatch(
          workspaceId,
          detail.manifest.documentId,
          patchValidation.patch,
          acceptedChangeIndices ?? undefined,
        )
        setDetail(ensureBriefBlock(result.detail))
        setPatchValidation(null)
        setDirty(false)
        setNotice({ kind: 'success', text: 'applied' })
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setOperation(null)
      }
    },
    [workspaceId, detail, patchValidation],
  )

  const exportDocument = useCallback(
    async (format: DesignerExportFormat) => {
      if (!workspaceId || !detail) {
        return
      }
      setOperation('export')
      setError(null)
      try {
        const result = await exportDesignerDocumentToFile(
          workspaceId,
          detail.manifest.documentId,
          format,
        )
        setExportResult(result)
        if (result.cancelled) {
          setNotice({ kind: 'info', text: 'exportCancelled' })
        } else {
          setNotice({ kind: 'success', text: 'exported' })
        }
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setOperation(null)
      }
    },
    [workspaceId, detail],
  )

  const clearNotice = useCallback(() => setNotice(null), [])

  const clearPatchValidation = useCallback(() => {
    setPatchValidation(null)
  }, [])

  const brief = useMemo(
    () => detail?.design.blocks.find((block) => block.id === BRIEF_BLOCK_ID) ?? null,
    [detail],
  )
  const agentBlocks = useMemo(
    () =>
      (detail?.design.blocks ?? [])
        .filter((block) => block.id !== BRIEF_BLOCK_ID && AGENT_BLOCK_KINDS.has(block.kind))
        .sort((a, b) => a.order - b.order),
    [detail],
  )
  const diagnostics = useMemo(() => {
    const fromDetail = detail?.diagnostics ?? []
    const fromValidation = validation?.diagnostics ?? []
    const fromPatch = patchValidation?.diagnostics ?? []
    return [...fromDetail, ...fromValidation, ...fromPatch]
  }, [detail, validation, patchValidation])

  return useMemo(
    () => ({
      detail,
      loading,
      dirty,
      operation,
      error,
      notice,
      brief,
      agentBlocks,
      diagnostics,
      patchValidation,
      validation,
      compileResult,
      checkpointResult,
      exportResult,
      loadDocument,
      replaceDetail,
      updateBlock,
      save,
      validate,
      compile,
      createCheckpoint,
      runAgentCompletion,
      applyPatch,
      exportDocument,
      clearPatchValidation,
      clearNotice,
    }),
    [
      detail,
      loading,
      dirty,
      operation,
      error,
      notice,
      brief,
      agentBlocks,
      diagnostics,
      patchValidation,
      validation,
      compileResult,
      checkpointResult,
      exportResult,
      loadDocument,
      replaceDetail,
      updateBlock,
      save,
      validate,
      compile,
      createCheckpoint,
      runAgentCompletion,
      applyPatch,
      exportDocument,
      clearPatchValidation,
      clearNotice,
    ],
  )
}
