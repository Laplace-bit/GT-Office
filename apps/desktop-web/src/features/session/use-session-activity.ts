import { useState, useEffect, useCallback, useRef } from 'react'
import { desktopApi, type SessionActivityItem, type GitUpdatedPayload } from '@shell/integration/desktop-api'
import { countCompleteGitStatusFiles } from './git-status-counts'

export interface SessionActivityState {
  activities: SessionActivityItem[]
  lastRevision: number | null
}

export function useSessionActivity(workspaceId: string | null) {
  const [activities, setActivities] = useState<SessionActivityItem[]>([])
  const [lastRevision, setLastRevision] = useState<number | null>(null)
  const wsRef = useRef(workspaceId)

  useEffect(() => {
    wsRef.current = workspaceId
  }, [workspaceId])

  useEffect(() => {
    let destroyed = false
    let unsubActivity: (() => void) | null = null
    let unsubGit: (() => void) | null = null

    async function subscribe() {
      unsubActivity = await desktopApi.subscribeSessionActivity((payload) => {
        if (destroyed) return
        const relevant = payload.items.filter(
          (item) => !wsRef.current || item.workspaceId === wsRef.current,
        )
        if (relevant.length > 0) {
          setActivities((prev) => [...relevant, ...prev].slice(0, 50))
          setLastRevision(relevant[0].revision)
        }
      })

      unsubGit = await desktopApi.subscribeGitUpdated(async (payload: GitUpdatedPayload) => {
        if (destroyed) return
        if (wsRef.current && payload.workspaceId !== wsRef.current) return
        if (!payload.available) return
        if (
          payload.state === 'invalid' ||
          payload.repositories.some((repository) => repository.state === 'invalid')
        ) return
        try {
          const counts = countCompleteGitStatusFiles(payload.files, payload.truncated)
          if (!counts) return
          await desktopApi.sessionChangefeedPush({
            workspaceId: payload.workspaceId,
            branch: payload.branch,
            dirty: payload.dirty,
            ahead: payload.ahead,
            behind: payload.behind,
            stagedFiles: counts.stagedFiles,
            unstagedFiles: counts.unstagedFiles,
            untrackedFiles: counts.untrackedFiles,
            revision: payload.revision,
          })
        } catch {
          // changefeed push may fail in non-Tauri runtime
        }
      })
    }

    subscribe().catch(() => {})

    return () => {
      destroyed = true
      unsubActivity?.()
      unsubGit?.()
    }
  }, [workspaceId])

  const dismissActivity = useCallback((revision: number) => {
    setActivities((prev) => prev.filter((a) => a.revision !== revision))
  }, [])

  return { activities, lastRevision, dismissActivity }
}
