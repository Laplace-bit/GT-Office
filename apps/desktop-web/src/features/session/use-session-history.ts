import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { desktopApi } from '@shell/integration/desktop-api'
import type { SessionCard, SessionProvider } from '@shell/integration/desktop-api'
import type { SessionHistoryState } from './session-history-model'
import { initialSessionHistoryState } from './session-history-model'
import {
  buildSessionHistoryCacheKey,
  createSessionHistoryCache,
  getCachedSessionHistory,
  resolveCachedSessionHistory,
} from './session-history-cache'

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

const sessionHistoryCache = createSessionHistoryCache()

export function useSessionHistory(
  workspaceId: string | null,
  options: UseSessionHistoryOptions = {},
): UseSessionHistoryResult {
  const discoverCwd = options.discoverCwd ?? null
  const provider = options.provider ?? null
  const [state, setState] = useState<SessionHistoryState>(initialSessionHistoryState)
  const mountedRef = useRef(true)
  const requestSequenceRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const runRequest = useCallback(async (
    key: string,
    force: boolean,
    load: () => Promise<SessionCard[]>,
  ) => {
    const requestSequence = ++requestSequenceRef.current
    const cached = force ? null : getCachedSessionHistory(sessionHistoryCache, key)
    if (cached) {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setState({ cards: cached, loading: false, error: null })
      }
      return
    }

    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const cards = await resolveCachedSessionHistory(sessionHistoryCache, key, force, load)
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setState({ cards, loading: false, error: null })
      }
    } catch (err) {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setState((current) => ({ ...current, loading: false, error: String(err) }))
      }
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!workspaceId || !provider) {
      if (mountedRef.current) {
        requestSequenceRef.current += 1
        setState({ cards: [], loading: false, error: null })
      }
      return
    }
    const key = buildSessionHistoryCacheKey(workspaceId, provider, null)
    await runRequest(key, true, async () => (await desktopApi.sessionList(workspaceId, provider)).cards)
  }, [provider, runRequest, workspaceId])

  const discover = useCallback(
    async (wsId: string, cwd: string, force = false) => {
      if (!provider) {
        if (mountedRef.current) {
          requestSequenceRef.current += 1
          setState({ cards: [], loading: false, error: null })
        }
        return
      }
      const key = buildSessionHistoryCacheKey(wsId, provider, cwd)
      await runRequest(
        key,
        force,
        async () => (await desktopApi.sessionDiscover(wsId, cwd, provider, force)).cards,
      )
    },
    [provider, runRequest],
  )

  useEffect(() => {
    if (!workspaceId || !provider) {
      requestSequenceRef.current += 1
      setState({ cards: [], loading: false, error: null })
      return
    }
    if (discoverCwd) {
      void discover(workspaceId, discoverCwd)
      return
    }
    const key = buildSessionHistoryCacheKey(workspaceId, provider, null)
    void runRequest(key, false, async () => (await desktopApi.sessionList(workspaceId, provider)).cards)
  }, [workspaceId, discoverCwd, provider, discover, runRequest])

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
