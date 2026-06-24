import { useCallback, useEffect, useState } from 'react'
import type {
  DesignerCheckpointEntry,
  DesignerDiffResult,
} from '../model/designer-document'
import {
  compareDesignerCheckpoints,
  diffDesignerWorkingTree,
  isBusinessDesignerRuntime,
  listDesignerCheckpoints,
} from './designerDesktopApi'
import { traceDesignerIpc } from './designerIpcTrace'

/** What the history sheet compares against. */
export type DesignerHistoryMode = 'workingTree' | 'checkpoints'

interface UseDesignerHistoryInput {
  workspaceId: string | null
  documentId: string | null
  active: boolean
}

export interface UseDesignerHistoryResult {
  entries: DesignerCheckpointEntry[]
  loading: boolean
  error: string | null
  diff: DesignerDiffResult | null
  diffLoading: boolean
  mode: DesignerHistoryMode
  baseCommit: string | null
  headCommit: string | null
  /** Open the sheet and refresh history for the active document. */
  open: () => void
  openDiffFromCheckpoint: (checkpoint: string) => void
  close: () => void
  isOpen: boolean
  setMode: (mode: DesignerHistoryMode) => void
  setBaseCommit: (commit: string | null) => void
  setHeadCommit: (commit: string | null) => void
  refresh: () => Promise<void>
  runDiff: () => Promise<void>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useDesignerHistory({
  workspaceId,
  documentId,
  active,
}: UseDesignerHistoryInput): UseDesignerHistoryResult {
  const [isOpen, setIsOpen] = useState(false)
  const [entries, setEntries] = useState<DesignerCheckpointEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState<DesignerDiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [mode, setMode] = useState<DesignerHistoryMode>('workingTree')
  const [baseCommit, setBaseCommit] = useState<string | null>(null)
  const [headCommit, setHeadCommit] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId || !documentId || !isBusinessDesignerRuntime()) {
      setEntries([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await traceDesignerIpc('business_designer.list_checkpoints.history', (traceId) =>
        listDesignerCheckpoints(workspaceId, documentId, traceId),
      )
      setEntries(result.entries)
      // Default base = most recent checkpoint; head stays null = working tree.
      const latest = result.entries[0]?.commit ?? null
      setBaseCommit((current) => current ?? latest)
      setHeadCommit(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, documentId])

  const open = useCallback(() => {
    setIsOpen(true)
    setDiff(null)
  }, [])

  const openDiffFromCheckpoint = useCallback((checkpoint: string) => {
    setMode('workingTree')
    setBaseCommit(checkpoint)
    setHeadCommit(null)
    setIsOpen(true)
    setDiff(null)
    if (!workspaceId || !documentId || !isBusinessDesignerRuntime()) {
      return
    }
    setDiffLoading(true)
    setError(null)
    void traceDesignerIpc('business_designer.diff_checkpoint.history', (traceId) =>
      diffDesignerWorkingTree(workspaceId, documentId, checkpoint, traceId),
    )
      .then((result) => {
        setDiff(result)
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err))
      })
      .finally(() => {
        setDiffLoading(false)
      })
  }, [documentId, workspaceId])

  const close = useCallback(() => {
    setIsOpen(false)
    setDiff(null)
    setError(null)
  }, [])

  // Refresh history whenever the sheet opens or the active document changes.
  useEffect(() => {
    if (!active || !isOpen) {
      return
    }
    void refresh()
  }, [active, isOpen, refresh])

  // Reset selections when switching documents.
  useEffect(() => {
    setEntries([])
    setDiff(null)
    setBaseCommit(null)
    setHeadCommit(null)
    setError(null)
  }, [documentId])

  const runDiff = useCallback(async () => {
    if (!workspaceId || !documentId || !isBusinessDesignerRuntime()) {
      return
    }
    setDiffLoading(true)
    setError(null)
    try {
      const result =
        mode === 'checkpoints' && baseCommit && headCommit
          ? await traceDesignerIpc('business_designer.compare_checkpoints.history', (traceId) =>
              compareDesignerCheckpoints(workspaceId, documentId, baseCommit, headCommit, traceId),
            )
          : await traceDesignerIpc('business_designer.diff_checkpoint.history', (traceId) =>
              diffDesignerWorkingTree(workspaceId, documentId, baseCommit, traceId),
            )
      setDiff(result)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setDiffLoading(false)
    }
  }, [workspaceId, documentId, mode, baseCommit, headCommit])

  return {
    entries,
    loading,
    error,
    diff,
    diffLoading,
    mode,
    baseCommit,
    headCommit,
    open,
    openDiffFromCheckpoint,
    close,
    isOpen,
    setMode,
    setBaseCommit,
    setHeadCommit,
    refresh,
    runDiff,
  }
}
