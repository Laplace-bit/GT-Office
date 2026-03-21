import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  desktopApi,
  type GitBranchEntry,
  type GitCommitEntry,
  type GitDiffStructuredResponse,
  type GitStashEntry,
  type GitStatusFile,
  type GitStatusResponse,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { isNotGitRepositoryError } from './git-error'

// ============================================
// Types
// ============================================
export type GitFileFilter = 'all' | 'staged' | 'unstaged'
export type GitDiffScope = 'staged' | 'unstaged'

export interface UseGitWorkspaceControllerInput {
  locale: Locale
  workspaceId: string | null
  summary: GitStatusResponse | null
  onRefreshSummary: (workspaceId: string | null) => Promise<void>
}

export interface GitGraphCommitView {
  branch: string
  hash: string
  subject: string
  author: string
  refs: string[]
}

export interface GitWorkspaceController {
  locale: Locale
  workspaceId: string | null
  isGitRepository: boolean
  summary: GitStatusResponse | null
  stagedFiles: GitStatusFile[]
  unstagedFiles: GitStatusFile[]
  visibleFiles: GitStatusFile[]
  hasStagedFiles: boolean
  hasUnstagedFiles: boolean
  filter: GitFileFilter
  setFilter: (filter: GitFileFilter) => void
  selectedPath: string | null
  selectPath: (path: string, scope?: GitDiffScope) => void
  diffLoading: boolean
  /** Structured diff data for high-performance rendering */
  structuredDiff: GitDiffStructuredResponse | null
  /** Diff view mode: 'split' for side-by-side, 'unified' for inline */
  diffViewMode: 'split' | 'unified'
  setDiffViewMode: (mode: 'split' | 'unified') => void
  /** Whether diff view is currently active (hides history) */
  showDiffView: boolean
  setShowDiffView: (show: boolean) => void
  /** Preload diff for a path (hover preloading) */
  preloadDiff: (path: string, scope?: GitDiffScope) => void
  metaLoading: boolean
  actionLoading: string | null
  errorMessage: string | null
  commitMessage: string
  setCommitMessage: (message: string) => void
  stashMessage: string
  setStashMessage: (message: string) => void
  checkoutTarget: string
  setCheckoutTarget: (target: string) => void
  newBranchName: string
  setNewBranchName: (name: string) => void
  selectedBranchEntry: GitBranchEntry | null
  logEntries: GitCommitEntry[]
  historyLoading: boolean
  hasMoreHistory: boolean
  branches: GitBranchEntry[]
  stashEntries: GitStashEntry[]
  graphCommits: GitGraphCommitView[]
  refreshAll: () => Promise<void>
  refreshSummary: () => Promise<void>
  stagePath: (path: string) => Promise<void>
  unstagePath: (path: string) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  discardPath: (path: string, includeUntracked?: boolean) => Promise<void>
  commit: () => Promise<void>
  fetch: () => Promise<void>
  pull: () => Promise<void>
  push: () => Promise<void>
  checkout: () => Promise<void>
  checkoutTo: (target: string) => Promise<void>
  createBranch: () => Promise<void>
  deleteBranch: () => Promise<void>
  stashPush: () => Promise<void>
  stashPop: (stash: string | null) => Promise<void>
  loadOlderHistory: () => Promise<void>
  resetToLatestHistory: () => Promise<void>
}

// ============================================
// Constants
// ============================================
export const ROW_HEIGHT = 30
export const OVERSCAN_ROWS = 25
const HISTORY_PAGE_SIZE = 80
const STASH_LIMIT = 30
const DIFF_CACHE_SIZE = 30
const DIFF_PRELOAD_DELAY_MS = 140

// ============================================
// Helper Functions
// ============================================
function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return 'unknown'
}

function hasStagedChanges(file: GitStatusFile): boolean {
  if (file.status.startsWith('??')) {
    return false
  }
  if (file.status.length >= 2) {
    const indexStatus = file.status[0] ?? ' '
    return indexStatus !== ' ' && indexStatus !== '?'
  }
  return file.staged
}

function hasUnstagedChanges(file: GitStatusFile): boolean {
  if (file.status.startsWith('??')) {
    return true
  }
  if (file.status.length >= 2) {
    const worktreeStatus = file.status[1] ?? ' '
    return worktreeStatus !== ' '
  }
  return !file.staged && file.status.trim().length > 0
}

function resolveDiffScope(file: GitStatusFile, filter: GitFileFilter): GitDiffScope {
  if (filter === 'staged') {
    return 'staged'
  }
  if (filter === 'unstaged') {
    return 'unstaged'
  }
  return hasUnstagedChanges(file) ? 'unstaged' : 'staged'
}

export function formatGitTimestamp(value: string, locale: Locale): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function parseBranchNamesFromRefs(refs: string[]): string[] {
  const localRefs: string[] = []
  for (const ref of refs) {
    const trimmed = ref.trim()
    if (!trimmed) {
      continue
    }
    if (trimmed.startsWith('tag: ')) {
      continue
    }
    if (trimmed.startsWith('HEAD -> ')) {
      const target = trimmed.slice('HEAD -> '.length).trim()
      if (target && !target.includes('/')) {
        localRefs.push(target)
      }
      continue
    }
    if (!trimmed.includes('/')) {
      localRefs.push(trimmed)
    }
  }
  return localRefs
}

function buildGraphCommits(
  entries: GitCommitEntry[],
  primaryBranch: string,
): GitGraphCommitView[] {
  if (entries.length === 0) {
    return []
  }
  const chronological = [...entries].reverse()
  const hashBranchMap = new Map<string, string>()
  const graph: GitGraphCommitView[] = []

  for (const entry of chronological) {
    const localRefs = parseBranchNamesFromRefs(entry.refs)
    const parentBranch = entry.parents[0] ? hashBranchMap.get(entry.parents[0]) : null
    const branch = localRefs[0] ?? parentBranch ?? (primaryBranch || 'main')
    hashBranchMap.set(entry.commit, branch)
    graph.push({
      branch,
      hash: entry.shortCommit,
      subject: entry.summary,
      author: entry.authorName,
      refs: entry.refs,
    })
  }

  return graph
}

export function useGitWorkspaceController({
  locale,
  workspaceId,
  summary,
  onRefreshSummary,
}: UseGitWorkspaceControllerInput): GitWorkspaceController {
  const [filter, setFilter] = useState<GitFileFilter>('all')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedDiffScope, setSelectedDiffScope] = useState<GitDiffScope>('unstaged')
  const [, setDiffPatch] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [metaLoading, setMetaLoading] = useState(false)
  const [isGitRepository, setIsGitRepository] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [checkoutTarget, setCheckoutTarget] = useState<string>('')
  const [stashMessage, setStashMessage] = useState('')
  const [logEntries, setLogEntries] = useState<GitCommitEntry[]>([])
  const [historySkip, setHistorySkip] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [branches, setBranches] = useState<GitBranchEntry[]>([])
  const [stashEntries, setStashEntries] = useState<GitStashEntry[]>([])
  const diffSeqRef = useRef(0)

  // New structured diff state for high-performance rendering
  const [structuredDiff, setStructuredDiff] = useState<GitDiffStructuredResponse | null>(null)
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('split')
  const [showDiffView, setShowDiffView] = useState(false)

  // Diff cache for preloading and instant switching (LRU cache)
  const diffCacheRef = useRef<Map<string, GitDiffStructuredResponse>>(new Map())

  // Pending preload requests to avoid duplicate fetches
  const pendingPreloadsRef = useRef<Set<string>>(new Set())
  const preloadTimerRef = useRef<number | null>(null)

  const stagedFiles = useMemo(
    () => (summary?.files ?? []).filter((item) => hasStagedChanges(item)),
    [summary?.files],
  )
  const unstagedFiles = useMemo(
    () => (summary?.files ?? []).filter((item) => hasUnstagedChanges(item)),
    [summary?.files],
  )
  const visibleFiles = useMemo(() => {
    if (!summary) {
      return []
    }
    if (filter === 'staged') {
      return stagedFiles
    }
    if (filter === 'unstaged') {
      return unstagedFiles
    }
    return summary.files
  }, [filter, stagedFiles, summary, unstagedFiles])

  const hasStagedFiles = stagedFiles.length > 0
  const hasUnstagedFiles = unstagedFiles.length > 0
  const selectedBranchEntry = useMemo(
    () => branches.find((item) => item.name === checkoutTarget) ?? null,
    [branches, checkoutTarget],
  )

  const graphCommits = useMemo(
    () => buildGraphCommits(logEntries, summary?.branch ?? 'main'),
    [logEntries, summary?.branch],
  )

  const fetchHistoryPage = useCallback(
    async (skip: number, mode: 'replace' | 'append') => {
      if (!workspaceId) {
        setLogEntries([])
        setHasMoreHistory(false)
        setHistorySkip(0)
        return
      }
      setHistoryLoading(true)
      try {
        const response = await desktopApi.gitLog(workspaceId, {
          limit: HISTORY_PAGE_SIZE,
          skip,
        })
        setLogEntries((prev) =>
          mode === 'append' ? [...prev, ...response.entries] : response.entries,
        )
        setHasMoreHistory(response.entries.length === HISTORY_PAGE_SIZE)
        setHistorySkip(skip)
      } finally {
        setHistoryLoading(false)
      }
    },
    [workspaceId],
  )

  const refreshMeta = useCallback(async () => {
    if (!workspaceId) {
      setLogEntries([])
      setBranches([])
      setStashEntries([])
      setHasMoreHistory(false)
      setHistorySkip(0)
      setIsGitRepository(true)
      return
    }
    setMetaLoading(true)
    try {
      const [branchResponse, stashResponse] = await Promise.all([
        desktopApi.gitListBranches(workspaceId, false),
        desktopApi.gitStashList(workspaceId, STASH_LIMIT),
      ])
      setBranches(branchResponse.branches)
      setStashEntries(stashResponse.entries)
      const currentBranch =
        branchResponse.branches.find((item) => item.current)?.name ??
        branchResponse.branches[0]?.name ??
        ''
      setCheckoutTarget((prev) => prev || currentBranch)
      await fetchHistoryPage(0, 'replace')
      setIsGitRepository(true)
      setErrorMessage(null)
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        setLogEntries([])
        setBranches([])
        setStashEntries([])
        setHasMoreHistory(false)
        setHistorySkip(0)
        setCheckoutTarget('')
        setIsGitRepository(false)
        setErrorMessage(t(locale, 'git.info.notRepository'))
        return
      }
      setIsGitRepository(true)
      setErrorMessage(t(locale, 'git.error.metaLoad', { detail: describeUnknownError(error) }))
    } finally {
      setMetaLoading(false)
    }
  }, [fetchHistoryPage, locale, workspaceId])

  const refreshAll = useCallback(async () => {
    await onRefreshSummary(workspaceId)
    await refreshMeta()
  }, [onRefreshSummary, refreshMeta, workspaceId])

  const refreshSummaryOnly = useCallback(async () => {
    await onRefreshSummary(workspaceId)
  }, [onRefreshSummary, workspaceId])

  const refreshHistoryLatest = useCallback(async () => {
    await fetchHistoryPage(0, 'replace')
  }, [fetchHistoryPage])

  const invalidateDiffCache = useCallback(() => {
    if (!workspaceId) {
      diffCacheRef.current.clear()
      return
    }
    const prefix = `${workspaceId}:`
    for (const key of diffCacheRef.current.keys()) {
      if (key.startsWith(prefix)) {
        diffCacheRef.current.delete(key)
      }
    }
    for (const key of pendingPreloadsRef.current) {
      if (key.startsWith(prefix)) {
        pendingPreloadsRef.current.delete(key)
      }
    }
    if (typeof preloadTimerRef.current === 'number') {
      window.clearTimeout(preloadTimerRef.current)
      preloadTimerRef.current = null
    }
  }, [workspaceId])

  const runAction = useCallback(
    async (actionKey: string, runner: () => Promise<void>) => {
      setActionLoading(actionKey)
      try {
        await runner()
        setErrorMessage(null)
      } catch (error) {
        if (isNotGitRepositoryError(error)) {
          setIsGitRepository(false)
          setErrorMessage(t(locale, 'git.info.notRepository'))
        } else {
          setErrorMessage(describeUnknownError(error))
        }
      } finally {
        setActionLoading(null)
      }
    },
    [locale],
  )

  const stagePath = useCallback(
    async (path: string) => {
      if (!workspaceId || !isGitRepository || !path) {
        return
      }
      await runAction('stage', async () => {
        await desktopApi.gitStage(workspaceId, [path])
        invalidateDiffCache()
        await refreshSummaryOnly()
      })
    },
    [invalidateDiffCache, isGitRepository, refreshSummaryOnly, runAction, workspaceId],
  )

  const unstagePath = useCallback(
    async (path: string) => {
      if (!workspaceId || !isGitRepository || !path) {
        return
      }
      await runAction('unstage', async () => {
        await desktopApi.gitUnstage(workspaceId, [path])
        invalidateDiffCache()
        await refreshSummaryOnly()
      })
    },
    [invalidateDiffCache, isGitRepository, refreshSummaryOnly, runAction, workspaceId],
  )

  const stageAll = useCallback(async () => {
    if (!workspaceId || !isGitRepository || unstagedFiles.length === 0) {
      return
    }
    await runAction('stage-all', async () => {
      await desktopApi.gitStage(
        workspaceId,
        unstagedFiles.map((item) => item.path),
      )
      invalidateDiffCache()
      await refreshSummaryOnly()
    })
  }, [invalidateDiffCache, isGitRepository, refreshSummaryOnly, runAction, unstagedFiles, workspaceId])

  const unstageAll = useCallback(async () => {
    if (!workspaceId || !isGitRepository || stagedFiles.length === 0) {
      return
    }
    await runAction('unstage-all', async () => {
      await desktopApi.gitUnstage(
        workspaceId,
        stagedFiles.map((item) => item.path),
      )
      invalidateDiffCache()
      await refreshSummaryOnly()
    })
  }, [invalidateDiffCache, isGitRepository, refreshSummaryOnly, runAction, stagedFiles, workspaceId])

  const discardPath = useCallback(
    async (path: string, includeUntracked = false) => {
      if (!workspaceId || !isGitRepository || !path) {
        return
      }
      await runAction('discard', async () => {
        await desktopApi.gitDiscard(workspaceId, [path], includeUntracked)
        invalidateDiffCache()
        await refreshSummaryOnly()
      })
    },
    [invalidateDiffCache, isGitRepository, refreshSummaryOnly, runAction, workspaceId],
  )

  const commit = useCallback(async () => {
    const trimmed = commitMessage.trim()
    if (!workspaceId || !isGitRepository || !trimmed) {
      return
    }
    await runAction('commit', async () => {
      await desktopApi.gitCommit(workspaceId, trimmed)
      setCommitMessage('')
      invalidateDiffCache()
      await Promise.all([
        refreshSummaryOnly(),
        refreshHistoryLatest(),
        refreshMeta(),
      ])
    })
  }, [
    commitMessage,
    invalidateDiffCache,
    isGitRepository,
    refreshHistoryLatest,
    refreshMeta,
    refreshSummaryOnly,
    runAction,
    workspaceId,
  ])

  const fetch = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('fetch', async () => {
      await desktopApi.gitFetch(workspaceId)
      await Promise.all([refreshSummaryOnly(), refreshMeta()])
    })
  }, [isGitRepository, refreshMeta, refreshSummaryOnly, runAction, workspaceId])

  const pull = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('pull', async () => {
      await desktopApi.gitPull(workspaceId)
      invalidateDiffCache()
      await Promise.all([refreshSummaryOnly(), refreshMeta(), refreshHistoryLatest()])
    })
  }, [
    invalidateDiffCache,
    isGitRepository,
    refreshHistoryLatest,
    refreshMeta,
    refreshSummaryOnly,
    runAction,
    workspaceId,
  ])

  const push = useCallback(async () => {
    if (!workspaceId || !isGitRepository) {
      return
    }
    await runAction('push', async () => {
      await desktopApi.gitPush(workspaceId)
      await refreshSummaryOnly()
    })
  }, [isGitRepository, refreshSummaryOnly, runAction, workspaceId])

  const checkoutTo = useCallback(async (target: string) => {
    const nextTarget = target.trim()
    if (!workspaceId || !isGitRepository || !nextTarget) {
      return
    }
    setCheckoutTarget(nextTarget)
    await runAction('checkout', async () => {
      await desktopApi.gitCheckout(workspaceId, nextTarget, { create: false })
      invalidateDiffCache()
      await Promise.all([refreshSummaryOnly(), refreshMeta(), refreshHistoryLatest()])
    })
  }, [
    invalidateDiffCache,
    isGitRepository,
    refreshHistoryLatest,
    refreshMeta,
    refreshSummaryOnly,
    runAction,
    workspaceId,
  ])

  const checkout = useCallback(async () => {
    await checkoutTo(checkoutTarget)
  }, [checkoutTarget, checkoutTo])

  const createBranch = useCallback(async () => {
    const branch = newBranchName.trim()
    if (!workspaceId || !isGitRepository || !branch) {
      return
    }
    await runAction('create-branch', async () => {
      await desktopApi.gitCreateBranch(workspaceId, branch, null)
      setNewBranchName('')
      setCheckoutTarget(branch)
      await refreshMeta()
    })
  }, [isGitRepository, newBranchName, refreshMeta, runAction, workspaceId])

  const deleteBranch = useCallback(async () => {
    if (!workspaceId || !isGitRepository || !checkoutTarget.trim()) {
      return
    }
    if (selectedBranchEntry?.current) {
      return
    }
    if (!window.confirm(t(locale, 'git.confirm.deleteBranch', { branch: checkoutTarget }))) {
      return
    }
    await runAction('delete-branch', async () => {
      await desktopApi.gitDeleteBranch(workspaceId, checkoutTarget, false)
      await refreshMeta()
    })
  }, [
    checkoutTarget,
    isGitRepository,
    locale,
    refreshMeta,
    runAction,
    selectedBranchEntry?.current,
    workspaceId,
  ])

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
      await Promise.all([refreshSummaryOnly(), refreshMeta()])
    })
  }, [invalidateDiffCache, isGitRepository, refreshMeta, refreshSummaryOnly, runAction, stashMessage, workspaceId])

  const stashPop = useCallback(
    async (stash: string | null) => {
      if (!workspaceId || !isGitRepository) {
        return
      }
      await runAction('stash-pop', async () => {
        await desktopApi.gitStashPop(workspaceId, stash)
        invalidateDiffCache()
        await Promise.all([refreshSummaryOnly(), refreshMeta()])
      })
    },
    [invalidateDiffCache, isGitRepository, refreshMeta, refreshSummaryOnly, runAction, workspaceId],
  )

  const loadOlderHistory = useCallback(async () => {
    if (!workspaceId || historyLoading || !hasMoreHistory) {
      return
    }
    await fetchHistoryPage(historySkip + HISTORY_PAGE_SIZE, 'append')
  }, [fetchHistoryPage, hasMoreHistory, historyLoading, historySkip, workspaceId])

  const resetToLatestHistory = useCallback(async () => {
    await fetchHistoryPage(0, 'replace')
  }, [fetchHistoryPage])

  useEffect(() => {
    setFilter('all')
    setSelectedPath(null)
    setDiffPatch('')
    setCommitMessage('')
    setNewBranchName('')
    setStashMessage('')
    setCheckoutTarget('')
    setHistorySkip(0)
    setHasMoreHistory(false)
    setIsGitRepository(true)
    setStructuredDiff(null)
    setShowDiffView(false)
    invalidateDiffCache()
    if (!workspaceId) {
      setLogEntries([])
      setBranches([])
      setStashEntries([])
      return
    }
    void refreshMeta()
  }, [invalidateDiffCache, refreshMeta, workspaceId])

  useEffect(() => {
    if (!summary || summary.files.length === 0) {
      setSelectedPath(null)
      setDiffPatch('')
      return
    }
    if (selectedPath && summary.files.some((item) => item.path === selectedPath)) {
      return
    }
    setSelectedPath(summary.files[0].path)
    setSelectedDiffScope(resolveDiffScope(summary.files[0], filter))
  }, [filter, selectedPath, summary])

  useEffect(() => {
    if (!summary || !selectedPath) {
      return
    }
    const selectedFile = summary.files.find((item) => item.path === selectedPath)
    if (!selectedFile) {
      return
    }
    const nextScope = resolveDiffScope(selectedFile, filter)
    setSelectedDiffScope((current) => (current === nextScope ? current : nextScope))
  }, [filter, selectedPath, summary])

  useEffect(() => {
    if (!workspaceId || !isGitRepository || !selectedPath) {
      setDiffPatch('')
      setStructuredDiff(null)
      return
    }

    // Check cache first for instant loading
    const cacheKey = `${workspaceId}:${selectedPath}:${selectedDiffScope}`
    const cached = diffCacheRef.current.get(cacheKey)
    if (cached) {
      // Move to end of map for LRU behavior
      diffCacheRef.current.delete(cacheKey)
      diffCacheRef.current.set(cacheKey, cached)
      setStructuredDiff(cached)
      setDiffPatch(cached.patch)
      setShowDiffView(true)
      // No loading state needed - instant
      return
    }

    const seq = diffSeqRef.current + 1
    diffSeqRef.current = seq
    setDiffLoading(true)

    // Use high-performance structured diff API
    void desktopApi
      .gitDiffFileStructured(workspaceId, selectedPath, selectedDiffScope === 'staged')
      .then((response) => {
        if (diffSeqRef.current !== seq) {
          return
        }

        // Cache the result (LRU with max items)
        const cache = diffCacheRef.current
        if (cache.size >= DIFF_CACHE_SIZE) {
          // Remove oldest entry (first key)
          const firstKey = cache.keys().next().value
          if (firstKey) cache.delete(firstKey)
        }
        cache.set(cacheKey, response)

        setStructuredDiff(response)
        setDiffPatch(response.patch)
        setShowDiffView(true)
      })
      .catch((error) => {
        if (diffSeqRef.current !== seq) {
          return
        }
        setStructuredDiff(null)
        setDiffPatch(`-- ${describeUnknownError(error)} --`)
      })
      .finally(() => {
        if (diffSeqRef.current === seq) {
          setDiffLoading(false)
        }
      })
  }, [isGitRepository, selectedDiffScope, selectedPath, summary?.files, workspaceId])

  // Preload diff for hover preview with debounce to avoid flooding background workers.
  const preloadDiff = useCallback(
    (path: string, scope: GitDiffScope = 'unstaged') => {
      if (!workspaceId || !isGitRepository || !path) return

      const cacheKey = `${workspaceId}:${path}:${scope}`
      // Skip if already cached or pending
      if (diffCacheRef.current.has(cacheKey) || pendingPreloadsRef.current.has(cacheKey)) return

      if (typeof preloadTimerRef.current === 'number') {
        window.clearTimeout(preloadTimerRef.current)
      }

      preloadTimerRef.current = window.setTimeout(() => {
        pendingPreloadsRef.current.add(cacheKey)
        void desktopApi
          .gitDiffFileStructured(workspaceId, path, scope === 'staged')
          .then((response) => {
            const cache = diffCacheRef.current
            if (cache.size >= DIFF_CACHE_SIZE) {
              const firstKey = cache.keys().next().value
              if (firstKey) cache.delete(firstKey)
            }
            cache.set(cacheKey, response)
          })
          .catch(() => {
            // Ignore preload errors
          })
          .finally(() => {
            pendingPreloadsRef.current.delete(cacheKey)
          })
      }, DIFF_PRELOAD_DELAY_MS)
    },
    [isGitRepository, workspaceId],
  )

  const selectPath = useCallback(
    (path: string, scope?: GitDiffScope) => {
      setSelectedPath(path)
      if (scope) {
        setSelectedDiffScope(scope)
      }
    },
    [],
  )

  useEffect(() => {
    return () => {
      if (typeof preloadTimerRef.current === 'number') {
        window.clearTimeout(preloadTimerRef.current)
      }
    }
  }, [])

  return {
    locale,
    workspaceId,
    isGitRepository,
    summary,
    stagedFiles,
    unstagedFiles,
    visibleFiles,
    hasStagedFiles,
    hasUnstagedFiles,
    filter,
    setFilter,
    selectedPath,
    selectPath,
    diffLoading,
    structuredDiff,
    diffViewMode,
    setDiffViewMode,
    showDiffView,
    setShowDiffView,
    preloadDiff,
    metaLoading,
    actionLoading,
    errorMessage,
    commitMessage,
    setCommitMessage,
    stashMessage,
    setStashMessage,
    checkoutTarget,
    setCheckoutTarget,
    newBranchName,
    setNewBranchName,
    selectedBranchEntry,
    logEntries,
    historyLoading,
    hasMoreHistory,
    branches,
    stashEntries,
    graphCommits,
    refreshAll,
    refreshSummary: refreshSummaryOnly,
    stagePath,
    unstagePath,
    stageAll,
    unstageAll,
    discardPath,
    commit,
    fetch,
    pull,
    push,
    checkout,
    checkoutTo,
    createBranch,
    deleteBranch,
    stashPush,
    stashPop,
    loadOlderHistory,
    resetToLatestHistory,
  }
}
