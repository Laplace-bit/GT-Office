import { useState, useCallback, useEffect } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'
import type { GitTagEntry } from '@shell/integration/desktop-api'

export function useGitTags(workspaceId: string | null, isGitRepository: boolean) {
  const [tags, setTags] = useState<GitTagEntry[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspaceId || !isGitRepository) return
    setLoading(true)
    try {
      const result = await desktopApi.gitTagList(workspaceId)
      setTags(result.entries)
    } finally {
      setLoading(false)
    }
  }, [workspaceId, isGitRepository])

  useEffect(() => { refresh() }, [refresh])

  const createTag = useCallback(async (name: string, target: string, annotated: boolean, message?: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagCreate(workspaceId, name, target, { annotated, message })
    await refresh()
  }, [workspaceId, refresh])

  const deleteTag = useCallback(async (name: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagDelete(workspaceId, name)
    await refresh()
  }, [workspaceId, refresh])

  const pushTag = useCallback(async (name: string, remote?: string) => {
    if (!workspaceId) return
    await desktopApi.gitTagPush(workspaceId, name, remote)
  }, [workspaceId])

  return { tags, loading, refresh, createTag, deleteTag, pushTag }
}
