import { useCallback, useEffect, useState } from 'react'
import { desktopApi, type GitRemoteOperationPayload } from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'

interface UseGitRemoteInput {
  locale: Locale
  workspaceId: string | null
  repositoryPath: string | null
  isGitRepository: boolean
  invalidateDiffCache: () => void
  setRepositoryNotice: (value: string | null) => void
  setErrorMessage: (value: string | null) => void
  onRefreshBranches: () => Promise<void>
  onRefreshAll: () => Promise<void>
}

interface UseGitRemoteResult {
  remoteActionLoading: 'fetch' | 'pull' | 'push' | 'tagPush' | null
  fetch: () => Promise<void>
  pull: () => Promise<void>
  push: () => Promise<void>
  pushTag: (name: string, remote?: string) => Promise<void>
}

function describeRemoteOperation(
  locale: Locale,
  operation: GitRemoteOperationPayload['operation'],
  status: GitRemoteOperationPayload['status'],
): string {
  if (locale === 'zh-CN') {
    if (status === 'started') {
      if (operation === 'fetch') return '正在获取远端更新...'
      if (operation === 'pull') return '正在拉取远端更新...'
      if (operation === 'tagPush') return '正在推送标签到远端...'
      return '正在推送到远端...'
    }
    if (status === 'finished') {
      if (operation === 'fetch') return '已获取远端更新'
      if (operation === 'pull') return '已拉取远端更新'
      if (operation === 'tagPush') return '已推送标签到远端'
      return '已推送到远端'
    }
    if (operation === 'fetch') return '获取远端更新失败'
    if (operation === 'pull') return '拉取远端更新失败'
    if (operation === 'tagPush') return '推送标签到远端失败'
    return '推送到远端失败'
  }
  if (status === 'started') {
    if (operation === 'fetch') return 'Fetching remote updates...'
    if (operation === 'pull') return 'Pulling remote updates...'
    if (operation === 'tagPush') return 'Pushing tag to remote...'
    return 'Pushing to remote...'
  }
  if (status === 'finished') {
    if (operation === 'fetch') return 'Fetch completed.'
    if (operation === 'pull') return 'Pull completed.'
    if (operation === 'tagPush') return 'Tag push completed.'
    return 'Push completed.'
  }
  if (operation === 'fetch') return 'Fetch failed.'
  if (operation === 'pull') return 'Pull failed.'
  if (operation === 'tagPush') return 'Tag push failed.'
  return 'Push failed.'
}

export function useGitRemote({
  locale,
  workspaceId,
  repositoryPath,
  isGitRepository,
  invalidateDiffCache,
  setRepositoryNotice,
  setErrorMessage,
  onRefreshBranches,
  onRefreshAll,
}: UseGitRemoteInput): UseGitRemoteResult {
  const [remoteActionLoading, setRemoteActionLoading] = useState<
    'fetch' | 'pull' | 'push' | 'tagPush' | null
  >(null)

  useEffect(() => {
    setRemoteActionLoading(null)
    if (!workspaceId) {
      return
    }
    let disposed = false
    let teardown = () => {}
    void desktopApi.subscribeGitRemoteOperation((payload) => {
      if (disposed || payload.workspaceId !== workspaceId) {
        return
      }
      if ((payload.repositoryPath ?? null) !== (repositoryPath ?? null)) {
        return
      }
      if (payload.status === 'started') {
        setRemoteActionLoading(payload.operation)
        setErrorMessage(null)
        setRepositoryNotice(describeRemoteOperation(locale, payload.operation, payload.status))
        return
      }
      setRemoteActionLoading((current) => (current === payload.operation ? null : current))
      if (payload.status === 'finished') {
        setErrorMessage(null)
        setRepositoryNotice(describeRemoteOperation(locale, payload.operation, payload.status))
        if (payload.operation === 'fetch') {
          void onRefreshBranches()
        } else if (payload.operation === 'pull' || payload.operation === 'tagPush') {
          invalidateDiffCache()
          void onRefreshAll()
        }
        return
      }
      setRepositoryNotice(null)
      setErrorMessage(payload.error || describeRemoteOperation(locale, payload.operation, payload.status))
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      teardown = unlisten
    })
    return () => {
      disposed = true
      teardown()
    }
  }, [
    invalidateDiffCache,
    locale,
    onRefreshAll,
    onRefreshBranches,
    repositoryPath,
    setErrorMessage,
    setRepositoryNotice,
    workspaceId,
  ])

  const fetch = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    setErrorMessage(null)
    await desktopApi.gitFetch(workspaceId, { repositoryPath })
  }, [isGitRepository, repositoryPath, setErrorMessage, workspaceId])

  const pull = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    setErrorMessage(null)
    await desktopApi.gitPull(workspaceId, { repositoryPath })
  }, [isGitRepository, repositoryPath, setErrorMessage, workspaceId])

  const push = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    setErrorMessage(null)
    await desktopApi.gitPush(workspaceId, { repositoryPath })
  }, [isGitRepository, repositoryPath, setErrorMessage, workspaceId])

  const pushTag = useCallback(async (name: string, remote?: string) => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    setErrorMessage(null)
    await desktopApi.gitTagPush(workspaceId, name, remote, repositoryPath)
  }, [isGitRepository, repositoryPath, setErrorMessage, workspaceId])

  return { remoteActionLoading, fetch, pull, push, pushTag }
}
