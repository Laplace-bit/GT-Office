import { useCallback } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'

interface UseGitCommitActionsInput {
  workspaceId: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
  onRefreshBranches: () => Promise<void>
  onRefreshHistory: () => Promise<void>
  onRefreshAll: () => Promise<void>
}

interface UseGitCommitActionsResult {
  cherryPick: (commit: string) => Promise<void>
  revert: (commit: string) => Promise<void>
  reset: (commit: string, mode: 'soft' | 'mixed' | 'hard') => Promise<void>
  createBranchFromCommit: (commit: string) => Promise<void>
}

export function useGitCommitActions({
  workspaceId,
  isGitRepository,
  runAction,
  invalidateDiffCache,
  onRefreshBranches,
  onRefreshHistory,
  onRefreshAll,
}: UseGitCommitActionsInput): UseGitCommitActionsResult {
  const cherryPick = useCallback(
    async (commit: string) => {
      if (!workspaceId || !isGitRepository || !commit) {
        return
      }
      await runAction('cherry-pick', async () => {
        await desktopApi.gitCherryPick(workspaceId, commit)
        invalidateDiffCache()
        await Promise.all([onRefreshHistory(), onRefreshBranches()])
      })
    },
    [invalidateDiffCache, isGitRepository, onRefreshBranches, onRefreshHistory, runAction, workspaceId],
  )

  const revert = useCallback(
    async (commit: string) => {
      if (!workspaceId || !isGitRepository || !commit) {
        return
      }
      await runAction('revert', async () => {
        await desktopApi.gitRevert(workspaceId, commit)
        invalidateDiffCache()
        await Promise.all([onRefreshHistory(), onRefreshBranches()])
      })
    },
    [invalidateDiffCache, isGitRepository, onRefreshBranches, onRefreshHistory, runAction, workspaceId],
  )

  const reset = useCallback(
    async (commit: string, mode: 'soft' | 'mixed' | 'hard') => {
      if (!workspaceId || !isGitRepository || !commit) {
        return
      }
      await runAction('reset', async () => {
        await desktopApi.gitReset(workspaceId, commit, mode)
        invalidateDiffCache()
        await onRefreshAll()
      })
    },
    [invalidateDiffCache, isGitRepository, onRefreshAll, runAction, workspaceId],
  )

  const createBranchFromCommit = useCallback(
    async (commit: string) => {
      if (!workspaceId || !isGitRepository || !commit) {
        return
      }
      await runAction('create-branch-from-commit', async () => {
        const branchName = window.prompt('Branch name:')
        if (!branchName?.trim()) {
          return
        }
        await desktopApi.gitCreateBranch(workspaceId, branchName.trim(), commit)
        await Promise.all([onRefreshBranches(), onRefreshHistory()])
      })
    },
    [isGitRepository, onRefreshBranches, onRefreshHistory, runAction, workspaceId],
  )

  return { cherryPick, revert, reset, createBranchFromCommit }
}
