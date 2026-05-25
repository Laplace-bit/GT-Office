import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'
import type { SessionCard, SessionProvider } from '@shell/integration/desktop-api'
import type { SessionHistoryState } from './session-history-model'
import { initialSessionHistoryState } from './session-history-model'

export interface UseSessionHistoryOptions {
  /** Absolute path used for provider filesystem scan (station workdir). */
  discoverCwd?: string | null
  /** When set, only list/discover sessions for this provider (Claude vs Codex). */
  provider?: SessionProvider | null
}

export interface UseSessionHistoryResult {
  cards: SessionCard[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  discover: (workspaceId: string, cwd: string, force?: boolean) => Promise<void>
}

export function useSessionHistory(
  workspaceId: string | null,
  options: UseSessionHistoryOptions = {},
): UseSessionHistoryResult {
  const discoverCwd = options.discoverCwd ?? null
  const provider = options.provider ?? null
  const [state, setState] = useState<SessionHistoryState>(initialSessionHistoryState)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!workspaceId || !provider) {
      if (mountedRef.current) {
        setState({ cards: [], loading: false, error: null })
      }
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const result = await desktopApi.sessionList(workspaceId, provider)
      if (mountedRef.current) {
        setState({ cards: result.cards, loading: false, error: null })
      }
    } catch (err) {
      if (mountedRef.current) {
        setState((s) => ({ ...s, loading: false, error: String(err) }))
      }
    }
  }, [workspaceId, provider])

  const discover = useCallback(
    async (wsId: string, cwd: string, force = false) => {
      if (!provider) {
        if (mountedRef.current) {
          setState({ cards: [], loading: false, error: null })
        }
        return
      }
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        const result = await desktopApi.sessionDiscover(wsId, cwd, provider, force)
        if (mountedRef.current) {
          setState({ cards: result.cards, loading: false, error: null })
        }
      } catch (err) {
        if (mountedRef.current) {
          setState((s) => ({ ...s, loading: false, error: String(err) }))
        }
      }
    },
    [provider],
  )

  useEffect(() => {
    if (!workspaceId || !provider) {
      setState({ cards: [], loading: false, error: null })
      return
    }
    if (discoverCwd) {
      void discover(workspaceId, discoverCwd)
      return
    }
    void refresh()
  }, [workspaceId, discoverCwd, provider, refresh, discover])

  return useMemo(
    () => ({
      cards: state.cards,
      loading: state.loading,
      error: state.error,
      refresh,
      discover,
    }),
    [state.cards, state.loading, state.error, refresh, discover],
  )
}
