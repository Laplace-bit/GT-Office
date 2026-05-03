import { useCallback } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'

interface UseGitRemoteInput {
  workspaceId: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
  onRefreshSummary: () => Promise<void>
  onRefreshMeta: () => Promise<void>
  onRefreshHistory: () => Promise<void>
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
  onRefreshSummary,
  onRefreshMeta,
  onRefreshHistory,
}: UseGitRemoteInput): UseGitRemoteResult {
  const fetch = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('fetch', async () => {
      await desktopApi.gitFetch(workspaceId)
      await Promise.all([onRefreshSummary(), onRefreshMeta()])
    })
  }, [isGitRepository, onRefreshMeta, onRefreshSummary, runAction, workspaceId])

  const pull = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('pull', async () => {
      await desktopApi.gitPull(workspaceId)
      invalidateDiffCache()
      await Promise.all([onRefreshSummary(), onRefreshMeta(), onRefreshHistory()])
    })
  }, [
    invalidateDiffCache,
    isGitRepository,
    onRefreshHistory,
    onRefreshMeta,
    onRefreshSummary,
    runAction,
    workspaceId,
  ])

  const push = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('push', async () => {
      await desktopApi.gitPush(workspaceId)
      await onRefreshSummary()
    })
  }, [isGitRepository, onRefreshSummary, runAction, workspaceId])

  return { fetch, pull, push }
}
