import { useCallback, useState } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'

interface UseGitCommitInput {
  workspaceId: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
  onRefreshHistory: () => Promise<void>
  onRefreshBranches: () => Promise<void>
}

interface UseGitCommitResult {
  commitMessage: string
  setCommitMessage: (message: string) => void
  amendMode: boolean
  setAmendMode: (amend: boolean) => void
  commit: () => Promise<void>
}

export function useGitCommit({
  workspaceId,
  isGitRepository,
  runAction,
  invalidateDiffCache,
  onRefreshHistory,
  onRefreshBranches,
}: UseGitCommitInput): UseGitCommitResult {
  const [commitMessage, setCommitMessage] = useState('')
  const [amendMode, setAmendMode] = useState(false)

  const commit = useCallback(async () => {
    const trimmed = commitMessage.trim()
    if (!workspaceId || !isGitRepository || !trimmed) {
      return
    }
    await runAction('commit', async () => {
      await desktopApi.gitCommit(workspaceId, trimmed, amendMode ? { amend: true } : undefined)
      setCommitMessage('')
      setAmendMode(false)
      invalidateDiffCache()
      await Promise.all([onRefreshHistory(), onRefreshBranches()])
    })
  }, [
    amendMode,
    commitMessage,
    invalidateDiffCache,
    isGitRepository,
    onRefreshHistory,
    onRefreshBranches,
    runAction,
    workspaceId,
  ])

  return {
    commitMessage,
    setCommitMessage,
    amendMode,
    setAmendMode,
    commit,
  }
}
