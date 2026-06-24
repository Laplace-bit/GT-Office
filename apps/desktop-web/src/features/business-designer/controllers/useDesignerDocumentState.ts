import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  desktopApi,
  type AgentProfile,
  type FilesystemChangedPayload,
} from '@shell/integration/desktop-api'
import type { DesignerBlock, DesignerBlockPatch } from '../model/designer-blocks'
import type {
  DesignerCheckpointResult,
  DesignerCompileResult,
  DesignerDiagnostic,
  DesignerDocumentDetail,
  DesignerExportFormat,
  DesignerExportResult,
  DesignerLayoutPosition,
} from '../model/designer-document'
import type {
  DesignerAgentCompletionDispatchResult,
  DesignerAgentTaskPreview,
  DesignerGapResolution,
  DesignerPatchApplyResult,
  DesignerPatchValidationResult,
} from '../model/designer-patch'
import type {
  DesignerDerivedEdge,
  DesignerGap,
  DesignerRuleRun,
  DesignerValidationResult,
} from '../model/designer-validation'
import {
  applyDesignerAgentPatch,
  compileDesignerDocument,
  createDesignerCheckpoint,
  exportDesignerDocumentToFile,
  isBusinessDesignerRuntime,
  previewDesignerAgentTask,
  readDesignerDocument,
  recoverDesignerAgentPatchFromTask,
  revertDesignerToCheckpoint,
  runDesignerAgentCompletion,
  runMockDesignerAgentCompletion,
  saveDesignerDocument,
  validateDesignerDocument,
} from './designerDesktopApi'
import { traceDesignerIpc } from './designerIpcTrace'

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
  | 'recover'
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
  /** v1: machine-detected unmet rules anchored to host blocks. */
  gaps: DesignerGap[]
  /** v1: edges derived by backend validation from payload references. */
  derivedEdges: DesignerDerivedEdge[]
  /** v1: full rule run audit trail. */
  rulesRun: DesignerRuleRun[]
  /** v1: most recent gap resolution from apply_agent_patch. */
  gapResolution: DesignerGapResolution | null
  /** v1: id of the currently selected node, drives inspector + drill panel. */
  selectedBlockId: string | null
  /** v1: id of the block whose drill sheet is open (separate from selection). */
  drillBlockId: string | null
  /** v1: host-anchored Agent preview shown before confirm/dispatch. */
  agentPreview: DesignerAgentTaskPreview | null
  /** v1: known workspace agents that can receive real-provider dispatches. */
  agents: AgentProfile[]
  /** v1: most recent real-provider dispatch result. */
  agentDispatch: DesignerAgentCompletionDispatchResult | null
  patchValidation: DesignerPatchValidationResult | null
  validation: DesignerValidationResult | null
  compileResult: DesignerCompileResult | null
  checkpointResult: DesignerCheckpointResult | null
  exportResult: DesignerExportResult | null
  loadDocument: () => Promise<void>
  replaceDetail: (detail: DesignerDocumentDetail | null, markDirty?: boolean) => void
  /** Patch the brief block (markdown body) or any other block by id. */
  updateBlock: (blockId: string, patch: DesignerBlockPatch) => void
  /** v1: remove a block and its layout entry from the document. */
  deleteBlock: (blockId: string) => void
  /** v1: write a node's canvas position into manifest.layout (no IPC). */
  setBlockPosition: (blockId: string, position: DesignerLayoutPosition) => void
  selectBlock: (blockId: string | null) => void
  openDrill: (blockId: string | null) => void
  save: () => Promise<void>
  discardLocalAndReload: () => Promise<void>
  validate: () => Promise<void>
  compile: () => Promise<void>
  createCheckpoint: (message: string) => Promise<void>
  previewAgentTask: (params: {
    provider?: 'mock' | 'codex' | 'claude' | string
    hostBlockId: string
    gapCodes: string[]
    scope: 'single' | 'block'
  }) => Promise<void>
  runAgentCompletion: (params: {
    provider?: 'mock' | 'codex' | 'claude' | string
    targetAgentIds?: string[]
    hostBlockId: string
    gapCodes: string[]
    scope: 'single' | 'block'
  }) => Promise<void>
  recoverAgentPatchFromTask: (taskId: string) => Promise<void>
  revertToCheckpoint: (checkpoint: string) => Promise<void>
  applyPatch: (acceptedChangeIndices?: number[] | null) => Promise<void>
  exportDocument: (format: DesignerExportFormat) => Promise<void>
  /** Discard the current Agent patch without applying it (hides the review sheet). */
  clearPatchValidation: () => void
  clearAgentPreview: () => void
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

const DESIGNER_AUTOSAVE_DEBOUNCE_MS = 1500

/**
 * Map raw backend error strings to friendly i18n keys when we recognize them.
 * Returns the i18n key to look up, or null if no special handling — the
 * pane should fall back to the raw message.
 */
export function classifyDesignerError(message: string): string | null {
  if (message.includes('patch_base_revision_stale') || message.includes('baseRevision')) {
    return 'designer.error.staleRevision'
  }
  return null
}

function normalizeWatcherPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function isDesignerDocumentReloadPath(documentId: string, path: string): boolean {
  const normalized = normalizeWatcherPath(path)
  const prefix = `.gtoffice/docs/documents/${documentId}/`
  if (normalized === `.gtoffice/docs/documents/${documentId}`) {
    return true
  }
  if (!normalized.startsWith(prefix)) {
    return false
  }
  const relative = normalized.slice(prefix.length)
  if (
    relative.startsWith('.agent-runs/') ||
    relative.startsWith('logs/') ||
    relative.includes('/logs/') ||
    relative.endsWith('.log') ||
    relative.endsWith('.tmp') ||
    relative.endsWith('~')
  ) {
    return false
  }
  return true
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

function hasBlock(detail: DesignerDocumentDetail | null, blockId: string | null): boolean {
  return Boolean(blockId && detail?.design.blocks.some((block) => block.id === blockId))
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
  const [gapResolution, setGapResolution] = useState<DesignerGapResolution | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [drillBlockId, setDrillBlockId] = useState<string | null>(null)
  const [agentPreview, setAgentPreview] = useState<DesignerAgentTaskPreview | null>(null)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [agentDispatch, setAgentDispatch] = useState<DesignerAgentCompletionDispatchResult | null>(null)

  // Refs for the autosave / auto-validate debounce chain (§12.5 IPC contract):
  // brief / form edits → debounce 1500ms before save_document → on success
  // run validate_document. Drag-driven layout changes also flow through here
  // because they call setBlockPosition once on pointerup.
  const detailRef = useRef<DesignerDocumentDetail | null>(null)
  detailRef.current = detail
  const selectedBlockIdRef = useRef<string | null>(selectedBlockId)
  selectedBlockIdRef.current = selectedBlockId
  const drillBlockIdRef = useRef<string | null>(drillBlockId)
  drillBlockIdRef.current = drillBlockId
  const workspaceIdRef = useRef<string | null>(workspaceId)
  workspaceIdRef.current = workspaceId
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const saveTimerRef = useRef<number | null>(null)

  const preserveBlockFocus = useCallback((ready: DesignerDocumentDetail | null) => {
    setSelectedBlockId((current) =>
      hasBlock(ready, current)
        ? current
        : hasBlock(ready, selectedBlockIdRef.current)
          ? selectedBlockIdRef.current
          : ready
            ? BRIEF_BLOCK_ID
            : null,
    )
    setDrillBlockId((current) =>
      hasBlock(ready, current)
        ? current
        : hasBlock(ready, drillBlockIdRef.current)
          ? drillBlockIdRef.current
          : null,
    )
  }, [])

  useEffect(() => {
    if (!workspaceId || !active || !isBusinessDesignerRuntime()) {
      setAgents([])
      return
    }
    let cancelled = false
    traceDesignerIpc('agent.list.business_designer_targets', () =>
      desktopApi.agentList(workspaceId),
    )
      .then((response) => {
        if (!cancelled) {
          setAgents(response.agents)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, active])

  const loadDocument = useCallback(async () => {
    if (!workspaceId || !selectedDocumentId || !isBusinessDesignerRuntime()) {
      setDetail(null)
      setDirty(false)
      setAgentPreview(null)
      setPatchValidation(null)
      setValidation(null)
      setCompileResult(null)
      setCheckpointResult(null)
      setExportResult(null)
      setGapResolution(null)
      setAgentDispatch(null)
      setSelectedBlockId(null)
      setDrillBlockId(null)
      return
    }
    setLoading(true)
    setOperation('load')
    setError(null)
    try {
      const loaded = await traceDesignerIpc('business_designer.read_document', (traceId) =>
        readDesignerDocument(workspaceId, selectedDocumentId, traceId),
      )
      const ready = ensureBriefBlock(loaded)
      const isSameDocument = detailRef.current?.manifest.documentId === ready.manifest.documentId
      setDetail(ready)
      setDirty(false)
      setAgentPreview(null)
      setPatchValidation(null)
      setAgentDispatch(null)
      if (isSameDocument) {
        preserveBlockFocus(ready)
      } else {
        // Opening a different document auto-focuses the brief node so the
        // inspector has stable context, but the drill panel stays user-invoked.
        setSelectedBlockId(BRIEF_BLOCK_ID)
        setDrillBlockId(null)
      }
      // Kick off a validate on initial load so gaps populate immediately.
      try {
        const result = await traceDesignerIpc(
          'business_designer.validate_document.initial_load',
          (traceId) => validateDesignerDocument(workspaceId, ready.manifest.documentId, traceId),
        )
        setValidation(result)
      } catch (err) {
        // Validation errors here aren't fatal — surface but don't block load.
        setError(getErrorMessage(err))
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
      setOperation(null)
    }
  }, [workspaceId, selectedDocumentId, preserveBlockFocus])

  useEffect(() => {
    if (!active) {
      return
    }
    void loadDocument()
  }, [active, loadDocument])

  useEffect(() => {
    if (!workspaceId || !selectedDocumentId || !active || !desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null
    let reloadTimer: ReturnType<typeof setTimeout> | null = null

    const clearReloadTimer = () => {
      if (reloadTimer) {
        window.clearTimeout(reloadTimer)
        reloadTimer = null
      }
    }

    const scheduleDocumentReload = () => {
      clearReloadTimer()
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null
        if (disposed || dirtyRef.current) {
          return
        }
        void loadDocument()
      }, 180)
    }

    const handleFilesystemChanged = (payload: FilesystemChangedPayload) => {
      if (payload.workspaceId !== workspaceId) {
        return
      }
      if (!payload.paths.some((path) => isDesignerDocumentReloadPath(selectedDocumentId, path))) {
        return
      }
      if (dirtyRef.current || payload.kind === 'removed') {
        setNotice({ kind: 'warning', text: 'externalChangePending' })
        return
      }
      scheduleDocumentReload()
    }

    void desktopApi.subscribeFilesystemEvents(handleFilesystemChanged).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    })

    return () => {
      disposed = true
      clearReloadTimer()
      cleanup?.()
    }
  }, [active, loadDocument, selectedDocumentId, workspaceId])

  const replaceDetail = useCallback((next: DesignerDocumentDetail | null, markDirty = false) => {
    const ready = next ? ensureBriefBlock(next) : null
    const isSameDocument =
      ready && detailRef.current?.manifest.documentId === ready.manifest.documentId
    setDetail(ready)
    setDirty(markDirty)
    if (isSameDocument) {
      preserveBlockFocus(ready)
    } else {
      setSelectedBlockId(ready ? BRIEF_BLOCK_ID : null)
      setDrillBlockId(null)
    }
  }, [preserveBlockFocus])

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

  const deleteBlock = useCallback((blockId: string) => {
    if (blockId === BRIEF_BLOCK_ID) {
      setError('Brief root cannot be deleted')
      return
    }
    setDetail((current) => {
      if (!current || !current.design.blocks.some((block) => block.id === blockId)) {
        return current
      }
      const next = cloneDetail(current)
      next.design.blocks = next.design.blocks.filter((block) => block.id !== blockId)
      next.design.blocks = next.design.blocks.map((block) => ({
        ...block,
        links: block.links.filter((link) => link.targetBlockId !== blockId),
      }))
      next.diagnostics = next.diagnostics.filter((diagnostic) => diagnostic.blockId !== blockId)
      next.design.revision = nowRevision()
      if (next.manifest.layout?.[blockId]) {
        const layout = { ...next.manifest.layout }
        delete layout[blockId]
        next.manifest.layout = layout
      }
      return next
    })
    setSelectedBlockId((current) => (current === blockId ? null : current))
    setDrillBlockId((current) => (current === blockId ? null : current))
    setAgentPreview(null)
    setPatchValidation(null)
    setValidation((current) =>
      current
        ? {
            ...current,
            diagnostics: current.diagnostics.filter((diagnostic) => diagnostic.blockId !== blockId),
            gaps: current.gaps.filter((gap) => gap.blockId !== blockId),
            rulesRun: current.rulesRun.filter((rule) => rule.blockId !== blockId),
            graphProjection: {
              ...current.graphProjection,
              links: current.graphProjection.links.filter(
                (link) => link.fromBlockId !== blockId && link.toBlockId !== blockId,
              ),
            },
          }
        : current,
    )
    setGapResolution(null)
    setDirty(true)
  }, [])

  /**
   * v1: write a node's canvas position into manifest.layout. We never include
   * coordinates in `updateBlock` because layout is per-document view metadata,
   * not block content — keeps `block.updatedAt` from churning on every drag.
   */
  const setBlockPosition = useCallback(
    (blockId: string, position: DesignerLayoutPosition) => {
      setDetail((current) => {
        if (!current) {
          return current
        }
        const next = cloneDetail(current)
        const layout = { ...(next.manifest.layout ?? {}), [blockId]: position }
        next.manifest.layout = layout
        return next
      })
      setDirty(true)
    },
    [],
  )

  const selectBlock = useCallback((blockId: string | null) => {
    setSelectedBlockId(blockId)
  }, [])

  const openDrill = useCallback((blockId: string | null) => {
    setDrillBlockId(blockId)
    if (blockId) {
      setSelectedBlockId(blockId)
    }
  }, [])

  const save = useCallback(async () => {
    if (!workspaceId || !detail) {
      return
    }
    setOperation('save')
    setError(null)
    try {
      const saved = await traceDesignerIpc('business_designer.save_document', (traceId) =>
        saveDesignerDocument(workspaceId, detail, traceId),
      )
      const ready = ensureBriefBlock(saved)
      setDetail(ready)
      setDirty(false)
      setNotice({ kind: 'success', text: 'saved' })
      // Save → validate chain (§12.5): the only post-save IPC, no separate
      // debounce.
      try {
        const result = await traceDesignerIpc('business_designer.validate_document.after_save', (traceId) =>
          validateDesignerDocument(workspaceId, ready.manifest.documentId, traceId),
        )
        setValidation(result)
      } catch (err) {
        // non-fatal
        // eslint-disable-next-line no-console
        console.warn('designer.validate.after_save', err)
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setOperation(null)
    }
  }, [workspaceId, detail])

  const discardLocalAndReload = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    dirtyRef.current = false
    setDirty(false)
    setNotice(null)
    await loadDocument()
  }, [loadDocument])

  const validate = useCallback(async () => {
    if (!workspaceId || !detail) {
      return
    }
    setOperation('validate')
    setError(null)
    try {
      const result = await traceDesignerIpc('business_designer.validate_document.manual', (traceId) =>
        validateDesignerDocument(workspaceId, detail.manifest.documentId, traceId),
      )
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
      const result = await traceDesignerIpc('business_designer.compile_document', (traceId) =>
        compileDesignerDocument(workspaceId, detail.manifest.documentId, traceId),
      )
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
        const result = await traceDesignerIpc(
          'business_designer.create_checkpoint',
          (traceId) =>
            createDesignerCheckpoint(
              workspaceId,
              detail.manifest.documentId,
              message.trim() || detail.manifest.title,
              traceId,
            ),
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

  const previewAgentTask = useCallback(
    async (params: {
      provider?: 'mock' | 'codex' | 'claude' | string
      hostBlockId: string
      gapCodes: string[]
      scope: 'single' | 'block'
    }) => {
      if (!workspaceId || !detail) {
        return
      }
      setOperation('agent')
      setError(null)
      try {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        if (dirtyRef.current) {
          const saved = await traceDesignerIpc(
            'business_designer.save_document.flush_before_preview',
            (traceId) => saveDesignerDocument(workspaceId, detailRef.current!, traceId),
          )
          const ready = ensureBriefBlock(saved)
          setDetail(ready)
          setDirty(false)
          dirtyRef.current = false
          detailRef.current = ready
        }
        const preview = await traceDesignerIpc('business_designer.preview_agent_task', (traceId) =>
          previewDesignerAgentTask(workspaceId, {
            traceId,
            documentId: detailRef.current!.manifest.documentId,
            selectedBlockIds: [],
            provider: params.provider ?? 'mock',
            hostBlockId: params.hostBlockId,
            gapCodes: params.gapCodes,
            scope: params.scope,
            baseRevision: detailRef.current!.design.revision,
          }),
        )
        setAgentPreview(preview)
        setPatchValidation(null)
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setOperation(null)
      }
    },
    [workspaceId, detail],
  )

  const runAgentCompletion = useCallback(
    async (params: {
      provider?: 'mock' | 'codex' | 'claude' | string
      targetAgentIds?: string[]
      hostBlockId: string
      gapCodes: string[]
      scope: 'single' | 'block'
    }) => {
      if (!workspaceId || !detail) {
        return
      }
      const provider = params?.provider ?? 'mock'
      const targetAgentIds = params.targetAgentIds ?? []
      const hostBlockId = params.hostBlockId
      const gapCodes = params.gapCodes
      const scope = params.scope
      setOperation('agent')
      setError(null)
      try {
        // Flush any pending autosave first. Otherwise the mock provider
        // captures a `baseRevision` from the in-memory detail, the
        // debounced autosave races us to the backend, and the patch we
        // get back is stale → apply rejects with `patch_base_revision_stale`.
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        if (dirtyRef.current) {
          // Inline save — same call save() makes, but we await it here so
          // the dispatch sees the post-save revision.
          const saved = await traceDesignerIpc(
            'business_designer.save_document.flush_before_agent',
            (traceId) => saveDesignerDocument(workspaceId, detailRef.current!, traceId),
          )
          const ready = ensureBriefBlock(saved)
          setDetail(ready)
          setDirty(false)
          dirtyRef.current = false
          detailRef.current = ready
        }
        if (provider === 'mock') {
          const result = await traceDesignerIpc('business_designer.run_mock_agent_completion', (traceId) =>
            runMockDesignerAgentCompletion(workspaceId, {
              traceId,
              documentId: detailRef.current!.manifest.documentId,
              selectedBlockIds: [],
              hostBlockId,
              gapCodes,
              scope,
              baseRevision: detailRef.current!.design.revision,
            }),
          )
          setAgentPreview(null)
          setPatchValidation(result)
          setAgentDispatch(null)
          setNotice({ kind: 'info', text: 'agentReady' })
        } else {
          const result = await traceDesignerIpc('business_designer.run_agent_completion', (traceId) =>
            runDesignerAgentCompletion(workspaceId, {
              traceId,
              documentId: detailRef.current!.manifest.documentId,
              targetAgentIds,
              hostBlockId,
              gapCodes,
              scope,
              baseRevision: detailRef.current!.design.revision,
            }),
          )
          setPatchValidation(null)
          setAgentDispatch(result)
          setNotice({ kind: 'info', text: 'agentDispatched' })
        }
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setOperation(null)
      }
    },
    [workspaceId, detail],
  )

  const recoverAgentPatchFromTask = useCallback(
    async (taskId: string) => {
      if (!workspaceId || !detail) {
        return
      }
      setOperation('recover')
      setError(null)
      try {
        const result = await traceDesignerIpc(
          'business_designer.recover_agent_patch_from_task',
          (traceId) =>
            recoverDesignerAgentPatchFromTask(
              workspaceId,
              detail.manifest.documentId,
              taskId,
              traceId,
            ),
        )
        setPatchValidation(result.validation)
        setAgentPreview(null)
        setNotice({ kind: 'info', text: 'agentReady' })
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setOperation(null)
      }
    },
    [workspaceId, detail],
  )

  const revertToCheckpoint = useCallback(
    async (checkpoint: string) => {
      if (!workspaceId || !detail) {
        return
      }
      setOperation('load')
      setError(null)
      try {
        const restored = await traceDesignerIpc(
          'business_designer.revert_to_checkpoint',
          (traceId) =>
            revertDesignerToCheckpoint(workspaceId, {
              traceId,
              documentId: detail.manifest.documentId,
              checkpoint,
            }),
        )
        const ready = ensureBriefBlock(restored)
        setDetail(ready)
        setDirty(false)
        dirtyRef.current = false
        detailRef.current = ready
        setAgentPreview(null)
        setPatchValidation(null)
        setAgentDispatch(null)
        setGapResolution(null)
        setNotice({ kind: 'success', text: 'checkpointReverted' })
        try {
          const result = await traceDesignerIpc(
            'business_designer.validate_document.after_revert',
            (traceId) => validateDesignerDocument(workspaceId, ready.manifest.documentId, traceId),
          )
          setValidation(result)
        } catch (err) {
          console.warn('designer.validate.after_revert', err)
        }
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
        // Flush pending autosave first (same race as runAgentCompletion):
        // if a debounced save fires between dispatch and apply, the patch's
        // baseRevision goes stale and apply rejects.
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        if (dirtyRef.current) {
          const saved = await traceDesignerIpc(
            'business_designer.save_document.flush_before_apply',
            (traceId) => saveDesignerDocument(workspaceId, detailRef.current!, traceId),
          )
          const ready = ensureBriefBlock(saved)
          setDetail(ready)
          setDirty(false)
          dirtyRef.current = false
          detailRef.current = ready
        }
        const result: DesignerPatchApplyResult = await traceDesignerIpc(
          'business_designer.apply_agent_patch',
          (traceId) =>
            applyDesignerAgentPatch(
              workspaceId,
              detail.manifest.documentId,
              patchValidation.patch,
              acceptedChangeIndices ?? undefined,
              traceId,
            ),
        )
        setDetail(ensureBriefBlock(result.detail))
        setDirty(false)
        setAgentPreview(null)
        setGapResolution(result.gapResolution ?? null)
        // Refresh validation state from the apply result so the inspector
        // and statusbar reflect the new gap set without a separate IPC.
        setValidation((prev) => ({
          schemaVersion: prev?.schemaVersion ?? 1,
          workspaceId,
          documentId: result.documentId,
          revision: result.appliedRevision,
          diagnostics: prev?.diagnostics ?? [],
          gaps: result.gaps ?? [],
          rulesRun: result.rulesRun ?? [],
          graphProjection: result.graphProjection ?? prev?.graphProjection ?? { links: [] },
        }))
        // Keep the patch sheet visible for one more frame so the user sees
        // the three-tier verdict; the consumer is responsible for dismissing.
        setPatchValidation((current) => current)
        setNotice({ kind: 'success', text: 'applied' })
        // Re-run a full validate to refresh derivedEdges (apply result only
        // ships gaps + rulesRun).
        try {
          const refreshed = await traceDesignerIpc(
            'business_designer.validate_document.after_apply',
            (traceId) => validateDesignerDocument(workspaceId, result.documentId, traceId),
          )
          setValidation(refreshed)
        } catch (err) {
          // non-fatal
          // eslint-disable-next-line no-console
          console.warn('designer.validate.after_apply', err)
        }
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
        const result = await traceDesignerIpc(
          'business_designer.export_document',
          (traceId) =>
            exportDesignerDocumentToFile(
              workspaceId,
              detail.manifest.documentId,
              format,
              traceId,
            ),
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

  const clearPatchValidation = useCallback(() => {
    setPatchValidation(null)
  }, [])

  const clearAgentPreview = useCallback(() => {
    setAgentPreview(null)
  }, [])

  // §12.5 autosave debounce — `dirty` rising edge schedules a save after
  // DESIGNER_AUTOSAVE_DEBOUNCE_MS. Subsequent edits during that window cancel
  // the prior timer. The brief textarea, form edits, and node drag (mouseup)
  // all funnel through here, so the IPC contract is enforced at one place.
  useEffect(() => {
    if (!dirty || !workspaceId || !detail) {
      return
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      // Only save when still dirty — guard against races where a manual save
      // already fired.
      if (!dirtyRef.current) return
      void save()
    }, DESIGNER_AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [dirty, workspaceId, detail, save])

  // Cleanup any in-flight timers on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
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
  const gaps = useMemo(() => validation?.gaps ?? [], [validation])
  const derivedEdges = useMemo(() => validation?.graphProjection.links ?? [], [validation])
  const rulesRun = useMemo(() => validation?.rulesRun ?? [], [validation])

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
      gaps,
      derivedEdges,
      rulesRun,
      gapResolution,
      selectedBlockId,
      drillBlockId,
      agentPreview,
      agents,
      agentDispatch,
      patchValidation,
      validation,
      compileResult,
      checkpointResult,
      exportResult,
      loadDocument,
      replaceDetail,
      updateBlock,
      deleteBlock,
      setBlockPosition,
      selectBlock,
      openDrill,
      save,
      discardLocalAndReload,
      validate,
      compile,
      createCheckpoint,
      previewAgentTask,
      runAgentCompletion,
      recoverAgentPatchFromTask,
      revertToCheckpoint,
      applyPatch,
      exportDocument,
      clearPatchValidation,
      clearAgentPreview,
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
      gaps,
      derivedEdges,
      rulesRun,
      gapResolution,
      selectedBlockId,
      drillBlockId,
      agentPreview,
      agents,
      agentDispatch,
      patchValidation,
      validation,
      compileResult,
      checkpointResult,
      exportResult,
      loadDocument,
      replaceDetail,
      updateBlock,
      deleteBlock,
      setBlockPosition,
      selectBlock,
      openDrill,
      save,
      discardLocalAndReload,
      validate,
      compile,
      createCheckpoint,
      previewAgentTask,
      runAgentCompletion,
      recoverAgentPatchFromTask,
      revertToCheckpoint,
      applyPatch,
      exportDocument,
      clearPatchValidation,
      clearAgentPreview,
    ],
  )
}
