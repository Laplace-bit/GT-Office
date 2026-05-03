import { useCallback, useState } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'

interface UseGitMergeInput {
  workspaceId: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  onRefreshSummary: () => Promise<void>
  onRefreshMeta: () => Promise<void>
}

interface UseGitMergeResult {
  mergeConflicts: string[]
  isMerging: boolean
  startMerge: (source: string) => Promise<void>
  continueMerge: () => Promise<void>
  abortMerge: () => Promise<void>
}

export function useGitMerge({
  workspaceId,
  isGitRepository,
  runAction,
  onRefreshSummary,
  onRefreshMeta,
}: UseGitMergeInput): UseGitMergeResult {
  const [mergeConflicts, setMergeConflicts] = useState<string[]>([])
  const [isMerging, setIsMerging] = useState(false)

  const startMerge = useCallback(
    async (source: string) => {
      if (!workspaceId || !isGitRepository || !source.trim()) {
        return
      }
      await runAction('merge', async () => {
        setIsMerging(true)
        await desktopApi.gitMerge(workspaceId, source.trim())
        setMergeConflicts([])
        await Promise.all([onRefreshSummary(), onRefreshMeta()])
      })
    },
    [isGitRepository, onRefreshMeta, onRefreshSummary, runAction, workspaceId],
  )

  const continueMerge = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('merge-continue', async () => {
      await desktopApi.gitMergeContinue(workspaceId)
      setIsMerging(false)
      setMergeConflicts([])
      await Promise.all([onRefreshSummary(), onRefreshMeta()])
    })
  }, [isGitRepository, onRefreshMeta, onRefreshSummary, runAction, workspaceId])

  const abortMerge = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('merge-abort', async () => {
      await desktopApi.gitMergeAbort(workspaceId)
      setIsMerging(false)
      setMergeConflicts([])
      await Promise.all([onRefreshSummary(), onRefreshMeta()])
    })
  }, [isGitRepository, onRefreshMeta, onRefreshSummary, runAction, workspaceId])

  return {
    mergeConflicts,
    isMerging,
    startMerge,
    continueMerge,
    abortMerge,
  }
}
