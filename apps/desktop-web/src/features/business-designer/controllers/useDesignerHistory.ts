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
      const result = await listDesignerCheckpoints(workspaceId, documentId)
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
          ? await compareDesignerCheckpoints(workspaceId, documentId, baseCommit, headCommit)
          : await diffDesignerWorkingTree(workspaceId, documentId, baseCommit)
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
    close,
    isOpen,
    setMode,
    setBaseCommit,
    setHeadCommit,
    refresh,
    runDiff,
  }
}
