import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { isNotGitRepositoryError } from '@features/git'
import { desktopApi, type GitStatusResponse } from '../integration/desktop-api'
import {
  WORKSPACE_AUTO_OPEN_DEBOUNCE_MS,
  describeError,
  forgetRememberedWorkspacePath,
  gitSummaryFromUpdatedPayload,
  loadRememberedWorkspacePath,
  normalizeFsPath,
  rememberWorkspacePath,
} from './ShellRoot.shared'
import {
  areWorkspaceGitSummariesEquivalent,
  resolveCachedWorkspaceGitSummary,
  shouldAdoptActiveWorkspace,
  shouldApplyWorkspaceGitSummaryRefreshResult,
  shouldClearWorkspaceStateForCloseResult,
  shouldClearWorkspaceStateForClosedEvent,
} from './workspace-git-summary-model'

const GIT_RECONCILE_INTERVAL_MS = 10_000
const GIT_RECONCILE_MIN_GAP_MS = 1_000

function isWorkspaceNotFoundError(error: unknown): boolean {
  return describeError(error).toLowerCase().includes('workspace not found')
}

type ConnectionState =
  | { code: 'checking'; detail?: string }
  | { code: 'web-preview'; detail?: string }
  | { code: 'tauri-connected'; detail?: string }
  | { code: 'workspace-read-failed'; detail?: string }
  | { code: 'git-read-failed'; detail?: string }
  | { code: 'input-required'; detail?: string }
  | { code: 'not-tauri'; detail?: string }
  | { code: 'open-failed'; detail?: string }
  | { code: 'bound'; detail?: string }

export interface ShellWorkspaceController {
  workspacePathInput: string
  setWorkspacePathInput: Dispatch<SetStateAction<string>>
  activeWorkspaceId: string | null
  activeWorkspaceRoot: string | null
  setActiveWorkspaceRoot: Dispatch<SetStateAction<string | null>>
  connectionState: ConnectionState
  gitSummary: GitStatusResponse | null
  refreshGit: (workspaceId: string | null) => Promise<void>
  adoptActiveWorkspace: (
    workspaceId: string | null,
    closedWorkspaceId?: string | null,
  ) => Promise<void>
  openWorkspaceAtPath: (
    path: string,
    reason?: 'manual' | 'restore' | 'picker' | 'debounce',
  ) => Promise<void>
}

export function useShellWorkspaceController(
  workspaceWindowId?: string,
): ShellWorkspaceController {
  const lockedWorkspaceId = workspaceWindowId?.trim() || null
  const [workspacePathInput, setWorkspacePathInput] = useState(
    () => loadRememberedWorkspacePath() ?? '',
  )
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null)
  const [activeWorkspaceRoot, setActiveWorkspaceRoot] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(() =>
    desktopApi.isTauriRuntime() ? { code: 'checking' } : { code: 'web-preview' },
  )
  const [gitSummary, setGitSummary] = useState<GitStatusResponse | null>(null)
  const gitRefreshTimerRef = useRef<number | null>(null)
  const gitSummaryCacheRef = useRef<Map<string, GitStatusResponse | null>>(new Map())
  const gitRefreshInFlightRef = useRef<Set<string>>(new Set())
  const gitRefreshPendingRef = useRef<Set<string>>(new Set())
  const gitRefreshSeqRef = useRef(0)
  const gitLastRefreshStartedAtRef = useRef(0)
  const workspaceOpenInFlightRef = useRef(false)
  const workspaceAutoOpenTimerRef = useRef<number | null>(null)
  const lastAutoOpenedPathRef = useRef<string | null>(loadRememberedWorkspacePath())
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId)
  const activeWorkspaceNameRef = useRef(activeWorkspaceName)
  const activeWorkspaceRootRef = useRef(activeWorkspaceRoot)

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  useEffect(() => {
    activeWorkspaceNameRef.current = activeWorkspaceName
  }, [activeWorkspaceName])

  useEffect(() => {
    activeWorkspaceRootRef.current = activeWorkspaceRoot
  }, [activeWorkspaceRoot])

  const clearClosedWorkspaceState = useCallback((closedWorkspaceId: string) => {
    const closedWorkspaceRoot = activeWorkspaceRootRef.current
    gitRefreshSeqRef.current += 1
    gitSummaryCacheRef.current.delete(closedWorkspaceId)
    gitRefreshPendingRef.current.delete(closedWorkspaceId)
    activeWorkspaceIdRef.current = null
    activeWorkspaceNameRef.current = null
    activeWorkspaceRootRef.current = null
    lastAutoOpenedPathRef.current = null
    gitLastRefreshStartedAtRef.current = 0
    setActiveWorkspaceId(null)
    setActiveWorkspaceName(null)
    setActiveWorkspaceRoot(null)
    setWorkspacePathInput('')
    setGitSummary(null)
    setConnectionState({ code: 'input-required' })
    forgetRememberedWorkspacePath({
      workspaceId: closedWorkspaceId,
      path: closedWorkspaceRoot,
    })
  }, [])

  const refreshGit = useMemo(() => {
    const runRefresh = async (workspaceId: string | null): Promise<void> => {
      if (!workspaceId) {
        gitRefreshSeqRef.current += 1
        gitRefreshPendingRef.current.clear()
        setGitSummary(null)
        return
      }

      if (gitRefreshInFlightRef.current.has(workspaceId)) {
        gitRefreshPendingRef.current.add(workspaceId)
        return
      }
      gitRefreshInFlightRef.current.add(workspaceId)

      gitLastRefreshStartedAtRef.current = Date.now()
      const requestId = gitRefreshSeqRef.current + 1
      gitRefreshSeqRef.current = requestId

      try {
        const summary = await desktopApi.gitStatus(workspaceId)
        const shouldApply =
          summary.workspaceId === workspaceId &&
          shouldApplyWorkspaceGitSummaryRefreshResult({
            workspaceId,
            activeWorkspaceId: activeWorkspaceIdRef.current,
            requestId,
            latestRequestId: gitRefreshSeqRef.current,
          })
        if (!shouldApply) {
          return
        }
        const cachedSummary = gitSummaryCacheRef.current.get(workspaceId) ?? null
        if (areWorkspaceGitSummariesEquivalent(cachedSummary, summary)) {
          return
        }
        gitSummaryCacheRef.current.set(workspaceId, summary)
        setGitSummary(summary)
      } catch (error) {
        const shouldApply = shouldApplyWorkspaceGitSummaryRefreshResult({
          workspaceId,
          activeWorkspaceId: activeWorkspaceIdRef.current,
          requestId,
          latestRequestId: gitRefreshSeqRef.current,
        })
        if (!shouldApply) {
          return
        }
        if (isWorkspaceNotFoundError(error)) {
          clearClosedWorkspaceState(workspaceId)
          return
        }
        gitSummaryCacheRef.current.set(workspaceId, null)
        setGitSummary(null)
        if (isNotGitRepositoryError(error)) {
          return
        }
        setConnectionState({
          code: 'git-read-failed',
          detail: describeError(error),
        })
      } finally {
        gitRefreshInFlightRef.current.delete(workspaceId)
        const shouldRefreshAgain = gitRefreshPendingRef.current.delete(workspaceId)
        if (shouldRefreshAgain && activeWorkspaceIdRef.current === workspaceId) {
          void runRefresh(workspaceId)
        }
      }
    }

    return runRefresh
  }, [clearClosedWorkspaceState])

  const adoptActiveWorkspace = useCallback(
    async (workspaceId: string | null, closedWorkspaceId: string | null = null) => {
      if (!workspaceId) {
        const currentActiveWorkspaceId = activeWorkspaceIdRef.current
        if (
          closedWorkspaceId &&
          shouldClearWorkspaceStateForCloseResult({
            closedWorkspaceId,
            activeWorkspaceId: currentActiveWorkspaceId,
            nextActiveWorkspaceId: workspaceId,
          })
        ) {
          clearClosedWorkspaceState(closedWorkspaceId)
        }
        return
      }
      if (
        !shouldAdoptActiveWorkspace({
          requestedWorkspaceId: workspaceId,
          activeWorkspaceId: activeWorkspaceIdRef.current,
        })
      ) {
        return
      }
      activeWorkspaceIdRef.current = workspaceId
      activeWorkspaceNameRef.current = workspaceId
      activeWorkspaceRootRef.current = null
      setActiveWorkspaceId(workspaceId)
      setActiveWorkspaceName(workspaceId)
      setActiveWorkspaceRoot(null)
      setWorkspacePathInput('')
      setGitSummary(resolveCachedWorkspaceGitSummary(gitSummaryCacheRef.current, workspaceId))

      try {
        const context = await desktopApi.workspaceGetContext(workspaceId)
        if (activeWorkspaceIdRef.current !== workspaceId) {
          return
        }
        activeWorkspaceRootRef.current = context.root
        setActiveWorkspaceRoot(context.root)
        setWorkspacePathInput(context.root)
        rememberWorkspacePath({
          path: context.root,
          workspaceId,
          name: workspaceId,
        })
        lastAutoOpenedPathRef.current = context.root
        setConnectionState({ code: 'bound', detail: context.root })
      } catch (error) {
        if (activeWorkspaceIdRef.current !== workspaceId) {
          return
        }
        if (isWorkspaceNotFoundError(error)) {
          clearClosedWorkspaceState(workspaceId)
          return
        }
        setActiveWorkspaceRoot(null)
      }
    },
    [clearClosedWorkspaceState],
  )

  const openWorkspaceAtPath = useCallback(
    async (path: string, reason: 'manual' | 'restore' | 'picker' | 'debounce' = 'manual') => {
      const normalized = normalizeFsPath(path)
      if (!normalized) {
        setConnectionState({ code: 'input-required' })
        return
      }

      if (!desktopApi.isTauriRuntime()) {
        setConnectionState({ code: 'not-tauri' })
        return
      }

      if (workspaceOpenInFlightRef.current) {
        return
      }

      const currentRoot = activeWorkspaceRootRef.current
      const activeRootNormalized = currentRoot ? normalizeFsPath(currentRoot) : null
      if (activeRootNormalized && normalized === activeRootNormalized) {
        rememberWorkspacePath({
          path: normalized,
          workspaceId: activeWorkspaceIdRef.current,
          name: activeWorkspaceNameRef.current,
        })
        lastAutoOpenedPathRef.current = normalized
        return
      }

      workspaceOpenInFlightRef.current = true
      setConnectionState({ code: 'checking', detail: reason })

      try {
        const opened = await desktopApi.workspaceOpen(normalized)
        activeWorkspaceIdRef.current = opened.workspaceId
        setActiveWorkspaceId(opened.workspaceId)
        setActiveWorkspaceName(opened.name)
        setActiveWorkspaceRoot(opened.root)
        setWorkspacePathInput(opened.root)
        setGitSummary(
          resolveCachedWorkspaceGitSummary(gitSummaryCacheRef.current, opened.workspaceId),
        )
        rememberWorkspacePath({
          path: opened.root,
          workspaceId: opened.workspaceId,
          name: opened.name,
        })
        lastAutoOpenedPathRef.current = opened.root
        setConnectionState({ code: 'bound', detail: opened.root })
      } catch (error) {
        setConnectionState({
          code: 'open-failed',
          detail: describeError(error),
        })
      } finally {
        workspaceOpenInFlightRef.current = false
      }
    },
    [],
  )

  const bootstrapRanRef = useRef(false)
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (bootstrapRanRef.current) {
      return
    }
    bootstrapRanRef.current = true

    const bootstrapWorkspace = async () => {
      setConnectionState({ code: 'tauri-connected' })
      if (lockedWorkspaceId) {
        const context = await desktopApi.workspaceGetContext(lockedWorkspaceId)
        activeWorkspaceIdRef.current = lockedWorkspaceId
        setActiveWorkspaceId(lockedWorkspaceId)
        setActiveWorkspaceName(lockedWorkspaceId)
        setActiveWorkspaceRoot(context.root)
        setWorkspacePathInput(context.root)
        setGitSummary(
          resolveCachedWorkspaceGitSummary(gitSummaryCacheRef.current, lockedWorkspaceId),
        )
        setConnectionState({ code: 'bound', detail: context.root })
        void refreshGit(lockedWorkspaceId)
        return
      }
      const response = await desktopApi.workspaceGetWindowActive()
      if (response.workspaceId) {
        let workspaceRoot: string | null = null
        try {
          const context = await desktopApi.workspaceGetContext(response.workspaceId)
          workspaceRoot = context.root
        } catch {
          workspaceRoot = null
        }
        activeWorkspaceIdRef.current = response.workspaceId
        setActiveWorkspaceId(response.workspaceId)
        setActiveWorkspaceName(response.workspaceId)
        setActiveWorkspaceRoot(workspaceRoot)
        setGitSummary(
          resolveCachedWorkspaceGitSummary(gitSummaryCacheRef.current, response.workspaceId),
        )
        if (workspaceRoot) {
          setWorkspacePathInput(workspaceRoot)
          rememberWorkspacePath({
            path: workspaceRoot,
            workspaceId: response.workspaceId,
            name: response.workspaceId,
          })
          lastAutoOpenedPathRef.current = workspaceRoot
          setConnectionState({ code: 'bound', detail: workspaceRoot })
        }
        void refreshGit(response.workspaceId)
        return
      }

      const remembered = loadRememberedWorkspacePath()
      if (remembered) {
        setWorkspacePathInput(remembered)
        await openWorkspaceAtPath(remembered, 'restore')
        void refreshGit(activeWorkspaceIdRef.current)
        return
      }
      setConnectionState({ code: 'input-required' })
    }

    void bootstrapWorkspace().catch((error) => {
      setConnectionState({
        code: 'workspace-read-failed',
        detail: describeError(error),
      })
    })
  }, [lockedWorkspaceId, openWorkspaceAtPath, refreshGit])

  const openWorkspaceAtPathRef = useRef(openWorkspaceAtPath)
  useEffect(() => {
    openWorkspaceAtPathRef.current = openWorkspaceAtPath
  }, [openWorkspaceAtPath])

  useEffect(() => {
    if (lockedWorkspaceId) {
      return
    }
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    const normalized = normalizeFsPath(workspacePathInput)
    const currentRoot = activeWorkspaceRootRef.current
    const activeRootNormalized = currentRoot ? normalizeFsPath(currentRoot) : null
    if (
      !normalized ||
      normalized === activeRootNormalized ||
      normalized === lastAutoOpenedPathRef.current
    ) {
      return
    }
    const timerId = window.setTimeout(() => {
      workspaceAutoOpenTimerRef.current = null
      lastAutoOpenedPathRef.current = normalized
      void openWorkspaceAtPathRef.current(normalized, 'debounce')
    }, WORKSPACE_AUTO_OPEN_DEBOUNCE_MS)
    workspaceAutoOpenTimerRef.current = timerId
    return () => {
      const pending = workspaceAutoOpenTimerRef.current
      if (typeof pending === 'number') {
        window.clearTimeout(pending)
      }
      workspaceAutoOpenTimerRef.current = null
    }
  }, [lockedWorkspaceId, workspacePathInput])

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }
    if (activeWorkspaceRootRef.current) {
      return
    }
    let cancelled = false
    void desktopApi
      .workspaceGetContext(activeWorkspaceId)
      .then((context) => {
        if (cancelled) {
          return
        }
        setActiveWorkspaceRoot(context.root)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setActiveWorkspaceRoot(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    let disposed = false
    const cleanups: (() => void)[] = []
    const reconcileActiveWorkspaceGit = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const workspaceId = activeWorkspaceIdRef.current
      if (!workspaceId) {
        return
      }
      if (Date.now() - gitLastRefreshStartedAtRef.current < GIT_RECONCILE_MIN_GAP_MS) {
        return
      }
      void refreshGit(workspaceId)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconcileActiveWorkspaceGit()
      }
    }
    window.addEventListener('focus', reconcileActiveWorkspaceGit)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    gitRefreshTimerRef.current = window.setInterval(
      reconcileActiveWorkspaceGit,
      GIT_RECONCILE_INTERVAL_MS,
    )
    void desktopApi
      .subscribeWorkspaceEvents({
        onUpdated: (payload) => {
          if (disposed || payload.kind !== 'closed') {
            return
          }
          gitSummaryCacheRef.current.delete(payload.workspaceId)
          if (
            shouldClearWorkspaceStateForClosedEvent({
              closedWorkspaceId: payload.workspaceId,
              activeWorkspaceId: activeWorkspaceIdRef.current,
              lockedWorkspaceId,
            })
          ) {
            clearClosedWorkspaceState(payload.workspaceId)
          }
        },
        onActiveChanged: (payload) => {
          if (disposed) return
          if (lockedWorkspaceId) {
            const lockedWorkspaceWasClosed =
              payload.workspaceId === null && payload.previousWorkspaceId === lockedWorkspaceId
            if (!lockedWorkspaceWasClosed) {
              return
            }
          }
          if (!payload.workspaceId) {
            const closedWorkspaceId =
              payload.previousWorkspaceId ?? activeWorkspaceIdRef.current
            if (!closedWorkspaceId) {
              return
            }
            if (
              shouldClearWorkspaceStateForClosedEvent({
                closedWorkspaceId,
                activeWorkspaceId: activeWorkspaceIdRef.current,
                lockedWorkspaceId,
              })
            ) {
              clearClosedWorkspaceState(closedWorkspaceId)
            }
            return
          }
          if (
            payload.workspaceId === activeWorkspaceIdRef.current &&
            activeWorkspaceRootRef.current
          ) return
          void adoptActiveWorkspace(payload.workspaceId)
        },
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanups.push(unlisten)
      })

    void desktopApi
      .subscribeGitUpdated((payload) => {
        if (disposed) {
          return
        }
        const currentActiveWorkspaceId = activeWorkspaceIdRef.current
        if (!currentActiveWorkspaceId || payload.workspaceId !== currentActiveWorkspaceId) {
          return
        }
        gitRefreshSeqRef.current += 1
        gitLastRefreshStartedAtRef.current = Date.now()
        if (!payload.available) {
          gitSummaryCacheRef.current.set(payload.workspaceId, null)
          setGitSummary(null)
          return
        }
        const summary = gitSummaryFromUpdatedPayload(payload)
        const cachedSummary = gitSummaryCacheRef.current.get(payload.workspaceId) ?? null
        gitSummaryCacheRef.current.set(payload.workspaceId, summary)
        if (!areWorkspaceGitSummariesEquivalent(cachedSummary, summary)) {
          setGitSummary(summary)
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanups.push(unlisten)
      })
    return () => {
      disposed = true
      window.removeEventListener('focus', reconcileActiveWorkspaceGit)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      for (const fn of cleanups) {
        fn()
      }
      const timerId = gitRefreshTimerRef.current
      if (typeof timerId === 'number') {
        window.clearInterval(timerId)
      }
      gitRefreshTimerRef.current = null
    }
  }, [adoptActiveWorkspace, clearClosedWorkspaceState, lockedWorkspaceId, refreshGit])

  return {
    workspacePathInput,
    setWorkspacePathInput,
    activeWorkspaceId,
    activeWorkspaceRoot,
    setActiveWorkspaceRoot,
    connectionState,
    gitSummary,
    refreshGit,
    adoptActiveWorkspace,
    openWorkspaceAtPath,
  }
}
