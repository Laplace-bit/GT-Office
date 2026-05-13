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
  gitSummaryFromUpdatedPayload,
  loadRememberedWorkspacePath,
  normalizeFsPath,
  rememberWorkspacePath,
} from './ShellRoot.shared'
import {
  resolveCachedWorkspaceGitSummary,
  shouldApplyWorkspaceGitSummaryRefreshResult,
} from './workspace-git-summary-model'

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
  const gitRefreshSeqRef = useRef(0)
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

  const refreshGit = useMemo(
    () => async (workspaceId: string | null) => {
      if (!workspaceId) {
        setGitSummary(null)
        return
      }

      const requestId = gitRefreshSeqRef.current + 1
      gitRefreshSeqRef.current = requestId

      try {
        const summary = await desktopApi.gitStatus(workspaceId)
        gitSummaryCacheRef.current.set(workspaceId, summary)
        if (
          shouldApplyWorkspaceGitSummaryRefreshResult({
            workspaceId,
            activeWorkspaceId: activeWorkspaceIdRef.current,
            requestId,
            latestRequestId: gitRefreshSeqRef.current,
          })
        ) {
          setGitSummary(summary)
        }
      } catch (error) {
        gitSummaryCacheRef.current.set(workspaceId, null)
        if (
          shouldApplyWorkspaceGitSummaryRefreshResult({
            workspaceId,
            activeWorkspaceId: activeWorkspaceIdRef.current,
            requestId,
            latestRequestId: gitRefreshSeqRef.current,
          })
        ) {
          setGitSummary(null)
        }
        if (isNotGitRepositoryError(error)) {
          return
        }
        if (
          shouldApplyWorkspaceGitSummaryRefreshResult({
            workspaceId,
            activeWorkspaceId: activeWorkspaceIdRef.current,
            requestId,
            latestRequestId: gitRefreshSeqRef.current,
          })
        ) {
          setConnectionState({
            code: 'git-read-failed',
            detail: describeError(error),
          })
        }
      }
    },
    [],
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
        void refreshGit(opened.workspaceId)
      } catch (error) {
        setConnectionState({
          code: 'open-failed',
          detail: describeError(error),
        })
      } finally {
        workspaceOpenInFlightRef.current = false
      }
    },
    [refreshGit],
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

    void desktopApi
      .subscribeWorkspaceEvents({
        onActiveChanged: (payload) => {
          if (disposed) return
          if (!payload.workspaceId) return
          if (lockedWorkspaceId) {
            return
          }
          if (payload.workspaceId === activeWorkspaceIdRef.current) return
          activeWorkspaceIdRef.current = payload.workspaceId
          setActiveWorkspaceId(payload.workspaceId)
          setActiveWorkspaceName(payload.workspaceId)
          setGitSummary(
            resolveCachedWorkspaceGitSummary(gitSummaryCacheRef.current, payload.workspaceId),
          )
          void desktopApi
            .workspaceGetContext(payload.workspaceId)
            .then((context) => {
              if (disposed) return
              setActiveWorkspaceRoot(context.root)
              setWorkspacePathInput(context.root)
              rememberWorkspacePath({
                path: context.root,
                workspaceId: payload.workspaceId,
                name: payload.workspaceId,
              })
            })
            .catch(() => {})
          void refreshGit(payload.workspaceId)
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
        if (!payload.available) {
          gitSummaryCacheRef.current.set(payload.workspaceId, null)
          setGitSummary(null)
          return
        }
        const summary = gitSummaryFromUpdatedPayload(payload)
        gitSummaryCacheRef.current.set(payload.workspaceId, summary)
        setGitSummary(summary)
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
      for (const fn of cleanups) {
        fn()
      }
      const timerId = gitRefreshTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      gitRefreshTimerRef.current = null
    }
  }, [lockedWorkspaceId, refreshGit])

  return {
    workspacePathInput,
    setWorkspacePathInput,
    activeWorkspaceId,
    activeWorkspaceRoot,
    setActiveWorkspaceRoot,
    connectionState,
    gitSummary,
    refreshGit,
    openWorkspaceAtPath,
  }
}
