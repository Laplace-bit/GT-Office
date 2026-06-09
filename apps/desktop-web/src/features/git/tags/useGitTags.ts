import { useState, useCallback, useEffect, useRef } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'
import type { GitTagEntry } from '@shell/integration/desktop-api'

export function useGitTags(
  workspaceId: string | null,
  repositoryPath: string | null,
  isGitRepository: boolean,
  enabled = true,
) {
  const [tags, setTags] = useState<GitTagEntry[]>([])
  const [loading, setLoading] = useState(false)
  const refreshSeqRef = useRef(0)
  const scopeRef = useRef({ workspaceId, repositoryPath })
  scopeRef.current = { workspaceId, repositoryPath }

  const refresh = useCallback(async () => {
    if (!enabled || !workspaceId || !isGitRepository) {
      refreshSeqRef.current += 1
      return
    }
    const requestWorkspaceId = workspaceId
    const requestRepositoryPath = repositoryPath
    const seq = refreshSeqRef.current + 1
    refreshSeqRef.current = seq
    const shouldApply = () =>
      refreshSeqRef.current === seq &&
      scopeRef.current.workspaceId === requestWorkspaceId &&
      scopeRef.current.repositoryPath === requestRepositoryPath
    setLoading(true)
    try {
      const result = await desktopApi.gitTagList(requestWorkspaceId, requestRepositoryPath)
      if (!shouldApply()) {
        return
      }
      setTags(result.entries)
    } finally {
      if (shouldApply()) {
        setLoading(false)
      }
    }
  }, [enabled, isGitRepository, repositoryPath, workspaceId])

  useEffect(() => {
    if (!enabled) {
      return
    }
    void refresh()
  }, [enabled, refresh])

  useEffect(() => {
    if (enabled && workspaceId && isGitRepository) {
      return
    }
    refreshSeqRef.current += 1
    setTags([])
    setLoading(false)
  }, [enabled, isGitRepository, repositoryPath, workspaceId])

  const createTag = useCallback(async (name: string, target: string, annotated: boolean, message?: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagCreate(workspaceId, name, target, {
      annotated,
      message,
      repositoryPath,
    })
    await refresh()
  }, [repositoryPath, workspaceId, refresh])

  const deleteTag = useCallback(async (name: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagDelete(workspaceId, name, repositoryPath)
    await refresh()
  }, [repositoryPath, workspaceId, refresh])

  return { tags, loading, refresh, createTag, deleteTag }
}
