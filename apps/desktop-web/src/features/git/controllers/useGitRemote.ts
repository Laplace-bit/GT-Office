import { useCallback } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'

interface UseGitRemoteInput {
  workspaceId: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
  onRefreshBranches: () => Promise<void>
  onRefreshAll: () => Promise<void>
}

interface UseGitRemoteResult {
  fetch: () => Promise<void>
  pull: () => Promise<void>
  push: () => Promise<void>
}

export function useGitRemote({
  workspaceId,
  isGitRepository,
  runAction,
  invalidateDiffCache,
  onRefreshBranches,
  onRefreshAll,
}: UseGitRemoteInput): UseGitRemoteResult {
  const fetch = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('fetch', async () => {
      await desktopApi.gitFetch(workspaceId)
      await onRefreshBranches()
    })
  }, [isGitRepository, onRefreshBranches, runAction, workspaceId])

  const pull = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('pull', async () => {
      await desktopApi.gitPull(workspaceId)
      invalidateDiffCache()
      await onRefreshAll()
    })
  }, [
    invalidateDiffCache,
    isGitRepository,
    onRefreshAll,
    runAction,
    workspaceId,
  ])

  const push = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('push', async () => {
      await desktopApi.gitPush(workspaceId)
    })
  }, [isGitRepository, runAction, workspaceId])

  return { fetch, pull, push }
}
