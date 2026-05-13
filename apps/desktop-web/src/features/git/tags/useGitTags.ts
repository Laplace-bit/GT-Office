import { useState, useCallback, useEffect } from 'react'
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

  const refresh = useCallback(async () => {
    if (!enabled || !workspaceId || !isGitRepository) return
    setLoading(true)
    try {
      const result = await desktopApi.gitTagList(workspaceId, repositoryPath)
      setTags(result.entries)
    } finally {
      setLoading(false)
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
    setTags([])
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
