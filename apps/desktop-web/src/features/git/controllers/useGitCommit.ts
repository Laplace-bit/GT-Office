import { useCallback, useState } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'

interface UseGitCommitInput {
  workspaceId: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
  onRefreshSummary: () => Promise<void>
  onRefreshHistory: () => Promise<void>
  onRefreshMeta: () => Promise<void>
}

interface UseGitCommitResult {
  commitMessage: string
  setCommitMessage: (message: string) => void
  commit: () => Promise<void>
}

export function useGitCommit({
  workspaceId,
  isGitRepository,
  runAction,
  invalidateDiffCache,
  onRefreshSummary,
  onRefreshHistory,
  onRefreshMeta,
}: UseGitCommitInput): UseGitCommitResult {
  const [commitMessage, setCommitMessage] = useState('')

  const commit = useCallback(async () => {
    const trimmed = commitMessage.trim()
    if (!workspaceId || !isGitRepository || !trimmed) {
      return
    }
    await runAction('commit', async () => {
      await desktopApi.gitCommit(workspaceId, trimmed)
      setCommitMessage('')
      invalidateDiffCache()
      await Promise.all([
        onRefreshSummary(),
        onRefreshHistory(),
        onRefreshMeta(),
      ])
    })
  }, [
    commitMessage,
    invalidateDiffCache,
    isGitRepository,
    onRefreshHistory,
    onRefreshMeta,
    onRefreshSummary,
    runAction,
    workspaceId,
  ])

  return {
    commitMessage,
    setCommitMessage,
    commit,
  }
}
