import { useCallback, useEffect, useState } from 'react'
import { desktopApi, type GitConflictFile } from '@shell/integration/desktop-api'
import {
  IDLE_GIT_MERGE_UI_STATE,
  resolveGitMergeUiStateFromMergeStateResponse,
  resolveGitMergeUiStateFromStartMergeResult,
} from './git-merge-state'

interface UseGitMergeInput {
  workspaceId: string | null
  repositoryPath: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  onRefreshAll: () => Promise<void>
}

interface UseGitMergeResult {
  mergeConflicts: GitConflictFile[]
  isMerging: boolean
  startMerge: (source: string) => Promise<void>
  resolveConflict: (path: string, side: 'ours' | 'theirs') => Promise<void>
  continueMerge: () => Promise<void>
  abortMerge: () => Promise<void>
  refreshMergeState: () => Promise<void>
}

export function useGitMerge({
  workspaceId,
  repositoryPath,
  isGitRepository,
  runAction,
  onRefreshAll,
}: UseGitMergeInput): UseGitMergeResult {
  const [mergeConflicts, setMergeConflicts] = useState<GitConflictFile[]>([])
  const [isMerging, setIsMerging] = useState(false)

  const applyUiState = useCallback((nextState: { isMerging: boolean; mergeConflicts: GitConflictFile[] }) => {
    setIsMerging(nextState.isMerging)
    setMergeConflicts(nextState.mergeConflicts)
  }, [])

  const refreshMergeState = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      applyUiState(IDLE_GIT_MERGE_UI_STATE)
      return
    }
    const result = await desktopApi.gitMergeState(workspaceId, repositoryPath)
    applyUiState(resolveGitMergeUiStateFromMergeStateResponse(result))
  }, [applyUiState, isGitRepository, repositoryPath, workspaceId])

  const startMerge = useCallback(
    async (source: string) => {
      if (!workspaceId || !isGitRepository || !source.trim()) {
        return
      }
      await runAction('merge', async () => {
        const result = await desktopApi.gitMerge(workspaceId, source.trim(), { repositoryPath })
        applyUiState(resolveGitMergeUiStateFromStartMergeResult(result))
        await onRefreshAll()
      })
    },
    [applyUiState, isGitRepository, onRefreshAll, repositoryPath, runAction, workspaceId],
  )

  const continueMerge = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('merge-continue', async () => {
      await desktopApi.gitMergeContinue(workspaceId, repositoryPath)
      applyUiState(IDLE_GIT_MERGE_UI_STATE)
      await onRefreshAll()
    })
  }, [applyUiState, isGitRepository, onRefreshAll, repositoryPath, runAction, workspaceId])

  const resolveConflict = useCallback(
    async (path: string, side: 'ours' | 'theirs') => {
      if (!workspaceId || !isGitRepository) {
        return
      }
      await runAction('merge-resolve-conflict', async () => {
        const result = await desktopApi.gitConflictResolve(workspaceId, path, side, repositoryPath)
        applyUiState({ isMerging: true, mergeConflicts: result.conflicts })
        await onRefreshAll()
      })
    },
    [applyUiState, isGitRepository, onRefreshAll, repositoryPath, runAction, workspaceId],
  )

  const abortMerge = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('merge-abort', async () => {
      await desktopApi.gitMergeAbort(workspaceId, repositoryPath)
      applyUiState(IDLE_GIT_MERGE_UI_STATE)
      await onRefreshAll()
    })
  }, [applyUiState, isGitRepository, onRefreshAll, repositoryPath, runAction, workspaceId])

  useEffect(() => {
    void refreshMergeState()
  }, [refreshMergeState])

  return {
    mergeConflicts,
    isMerging,
    startMerge,
    resolveConflict,
    continueMerge,
    abortMerge,
    refreshMergeState,
  }
}
