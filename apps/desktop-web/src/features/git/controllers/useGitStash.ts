import { useCallback, useState } from 'react'
import {
  desktopApi,
} from '@shell/integration/desktop-api'

interface UseGitStashInput {
  workspaceId: string | null
  isGitRepository: boolean
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
  onRefreshStashes: () => Promise<void>
}

interface UseGitStashResult {
  stashMessage: string
  setStashMessage: (message: string) => void
  stashPush: () => Promise<void>
  stashPop: (stash: string | null) => Promise<void>
}

export function useGitStash({
  workspaceId,
  isGitRepository,
  runAction,
  invalidateDiffCache,
  onRefreshStashes,
}: UseGitStashInput): UseGitStashResult {
  const [stashMessage, setStashMessage] = useState('')

  const stashPush = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('stash-push', async () => {
      await desktopApi.gitStashPush(workspaceId, {
        message: stashMessage.trim() || null,
      })
      setStashMessage('')
      invalidateDiffCache()
      await onRefreshStashes()
    })
  }, [invalidateDiffCache, isGitRepository, onRefreshStashes, runAction, stashMessage, workspaceId])

  const stashPop = useCallback(
    async (stash: string | null) => {
      if (!workspaceId || !isGitRepository) {
        return
      }
      await runAction('stash-pop', async () => {
        await desktopApi.gitStashPop(workspaceId, stash)
        invalidateDiffCache()
        await onRefreshStashes()
      })
    },
    [invalidateDiffCache, isGitRepository, onRefreshStashes, runAction, workspaceId],
  )

  return {
    stashMessage,
    setStashMessage,
    stashPush,
    stashPop,
  }
}
