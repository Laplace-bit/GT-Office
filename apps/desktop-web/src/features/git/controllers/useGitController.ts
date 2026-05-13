import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  desktopApi,
  type GitBranchEntry,
  type GitCommitEntry,
  type GitRepositorySummary,
  type GitStashEntry,
} from '@shell/integration/desktop-api'
import { t } from '@shell/i18n/ui-locale'
import { isNotGitRepositoryError } from '../git-error'
import type {
  GitWorkspaceController,
  UseGitWorkspaceControllerInput,
} from './types'
import { HISTORY_PAGE_SIZE, STASH_LIMIT } from './types'
import { buildGraphCommits, describeUnknownError } from './helpers'
import { useGitShared, useDiffCacheRefs } from './useGitShared'
import {
  resolveActiveRepositoryPath,
  restoreScopedRepositorySelection,
  shouldAdoptResolvedRepositorySelection,
} from './repository-selection-model'
import { useGitStatus } from './useGitStatus'
import { useGitCommit } from './useGitCommit'
import { useGitBranch } from './useGitBranch'
import { useGitRemote } from './useGitRemote'
import { useGitStash } from './useGitStash'
import { useGitDiff } from './useGitDiff'
import { useGitMerge } from './useGitMerge'
import { useGitCommitActions } from './useGitCommitActions'

interface GitMetaCacheEntry {
  branches: GitBranchEntry[]
  stashEntries: GitStashEntry[]
  logEntries: GitCommitEntry[]
  hasMoreHistory: boolean
  historySkip: number
  checkoutTarget: string
}

function buildRepositoryScopeKey(workspaceId: string | null, repositoryPath: string | null): string {
  return `${workspaceId ?? ''}:${repositoryPath ?? ''}`
}

export function useGitController({
  locale,
  workspaceId,
  summary,
  onRefreshSummary,
}: UseGitWorkspaceControllerInput): GitWorkspaceController {
  // Composition-layer owned state for notices/errors (single source of truth)
  const [repositoryNotice, setRepositoryNotice] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Meta state (history — owned here because refreshMeta needs it)
  const [logEntries, setLogEntries] = useState<GitCommitEntry[]>([])
  const [historySkip, setHistorySkip] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [metaLoading, setMetaLoading] = useState(false)

  // Branch/stash state — owned here because refreshMeta needs to set them
  const [branches, setBranches] = useState<GitBranchEntry[]>([])
  const [stashEntries, setStashEntries] = useState<GitStashEntry[]>([])
  const [checkoutTarget, setCheckoutTarget] = useState<string>('')
  const [currentRepositoryPath, setCurrentRepositoryPath] = useState<string | null>(null)
  const metaCacheRef = useRef<Map<string, GitMetaCacheEntry>>(new Map())
  const metaRefreshSeqRef = useRef(0)
  const repositorySelectionRef = useRef<Map<string, string | null>>(new Map())

  const repositories = useMemo<GitRepositorySummary[]>(
    () => summary?.repositories ?? [],
    [summary],
  )

  const activeRepositoryPath = useMemo(() => {
    return resolveActiveRepositoryPath(
      currentRepositoryPath,
      repositories,
      summary?.primaryRepositoryPath,
    )
  }, [currentRepositoryPath, repositories, summary?.primaryRepositoryPath])

  const setScopedCurrentRepositoryPath = useCallback(
    (repositoryPath: string | null) => {
      setCurrentRepositoryPath(repositoryPath)
      repositorySelectionRef.current.set(
        workspaceId ?? '',
        repositoryPath,
      )
    },
    [workspaceId],
  )

  const activeSummary = useMemo(() => {
    if (!summary) {
      return null
    }
    const repository =
      repositories.find((item) => item.repositoryPath === activeRepositoryPath) ??
      repositories[0] ??
      null
    if (!repository) {
      return summary
    }
    return {
      workspaceId: summary.workspaceId,
      primaryRepositoryPath: repository.repositoryPath,
      branch: repository.branch,
      ahead: repository.ahead,
      behind: repository.behind,
      files: repository.files,
      repositories,
    }
  }, [activeRepositoryPath, repositories, summary])

  // Diff cache refs (shared infrastructure)
  const cacheRefs = useDiffCacheRefs()

  // Shared: action runner + isGitRepository
  const { isGitRepository, setIsGitRepository, actionLoading, runAction } = useGitShared({
    locale,
    setRepositoryNotice,
    setErrorMessage,
  })

  // Invalidate diff cache bound to current workspaceId
  const invalidateDiffCache = useCallback(() => {
    const { diffCacheRef, pendingPreloadsRef, preloadTimerRef } = cacheRefs
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
  }, [workspaceId, cacheRefs])

  // History fetch
  const fetchHistoryPage = useCallback(
    async (skip: number, mode: 'replace' | 'append') => {
      if (!workspaceId) {
        setLogEntries([])
        setHasMoreHistory(false)
        setHistorySkip(0)
        return
      }
      setHistoryLoading(true)
      const scopeKey = buildRepositoryScopeKey(workspaceId, activeRepositoryPath)
      try {
        const response = await desktopApi.gitLog(workspaceId, {
          limit: HISTORY_PAGE_SIZE,
          skip,
          repositoryPath: activeRepositoryPath,
        })
        setLogEntries((prev) => {
          const nextEntries =
            mode === 'append' ? [...prev, ...response.entries] : response.entries
          const cached = metaCacheRef.current.get(scopeKey)
          metaCacheRef.current.set(scopeKey, {
            branches: cached?.branches ?? [],
            stashEntries: cached?.stashEntries ?? [],
            logEntries: nextEntries,
            hasMoreHistory: response.entries.length === HISTORY_PAGE_SIZE,
            historySkip: skip,
            checkoutTarget: cached?.checkoutTarget ?? '',
          })
          return nextEntries
        })
        setHasMoreHistory(response.entries.length === HISTORY_PAGE_SIZE)
        setHistorySkip(skip)
      } finally {
        setHistoryLoading(false)
      }
    },
    [activeRepositoryPath, workspaceId],
  )

  // refreshMeta — defined here because it spans branch/stash/history state.
  // Uses composition-layer state directly (no circular dep).
  const refreshMeta = useCallback(async () => {
    const scopeKey = buildRepositoryScopeKey(workspaceId, activeRepositoryPath)
    if (!workspaceId) {
      setLogEntries([])
      setBranches([])
      setStashEntries([])
      setHasMoreHistory(false)
      setHistorySkip(0)
      setIsGitRepository(true)
      setRepositoryNotice(null)
      return
    }

    const cached = metaCacheRef.current.get(scopeKey)
    if (cached) {
      setBranches(cached.branches)
      setStashEntries(cached.stashEntries)
      setLogEntries(cached.logEntries)
      setHasMoreHistory(cached.hasMoreHistory)
      setHistorySkip(cached.historySkip)
      setCheckoutTarget(cached.checkoutTarget)
    } else {
      setBranches([])
      setStashEntries([])
      setLogEntries([])
      setHasMoreHistory(false)
      setHistorySkip(0)
      setCheckoutTarget('')
    }

    const seq = metaRefreshSeqRef.current + 1
    metaRefreshSeqRef.current = seq
    setMetaLoading(true)
    try {
      const [branchResponse, stashResponse, historyResponse] = await Promise.all([
        desktopApi.gitListBranches(workspaceId, false, activeRepositoryPath),
        desktopApi.gitStashList(workspaceId, STASH_LIMIT, activeRepositoryPath),
        desktopApi.gitLog(workspaceId, {
          limit: HISTORY_PAGE_SIZE,
          skip: 0,
          repositoryPath: activeRepositoryPath,
        }),
      ])
      if (metaRefreshSeqRef.current !== seq) {
        return
      }
      setBranches(branchResponse.branches)
      setStashEntries(stashResponse.entries)
      setLogEntries(historyResponse.entries)
      setHasMoreHistory(historyResponse.entries.length === HISTORY_PAGE_SIZE)
      setHistorySkip(0)
      const currentBranch =
        branchResponse.branches.find((item) => item.current)?.name ??
        branchResponse.branches[0]?.name ??
        ''
      setCheckoutTarget(currentBranch)
      metaCacheRef.current.set(scopeKey, {
        branches: branchResponse.branches,
        stashEntries: stashResponse.entries,
        logEntries: historyResponse.entries,
        hasMoreHistory: historyResponse.entries.length === HISTORY_PAGE_SIZE,
        historySkip: 0,
        checkoutTarget: currentBranch,
      })
      setIsGitRepository(true)
      setRepositoryNotice(null)
      setErrorMessage(null)
    } catch (error) {
      if (metaRefreshSeqRef.current !== seq) {
        return
      }
      if (isNotGitRepositoryError(error)) {
        setLogEntries([])
        setBranches([])
        setStashEntries([])
        setHasMoreHistory(false)
        setHistorySkip(0)
        setCheckoutTarget('')
        setIsGitRepository(false)
        setRepositoryNotice(t(locale, 'git.info.notRepository'))
        setErrorMessage(null)
        return
      }
      setIsGitRepository(true)
      setRepositoryNotice(null)
      setErrorMessage(t(locale, 'git.error.metaLoad', { detail: describeUnknownError(error) }))
    } finally {
      if (metaRefreshSeqRef.current === seq) {
        setMetaLoading(false)
      }
    }
  }, [activeRepositoryPath, locale, setErrorMessage, setIsGitRepository, setRepositoryNotice, workspaceId])

  // Stable callback that delegates to latest refreshMeta via ref (breaks circular dep)
  const refreshMetaRef = useRef(refreshMeta)
  useEffect(() => {
    refreshMetaRef.current = refreshMeta
  }, [refreshMeta])

  // Scoped refresh callbacks — only refresh what changed
  const onRefreshBranches = useCallback(async () => {
    if (!workspaceId) {
      setBranches([])
      return
    }
    try {
      const response = await desktopApi.gitListBranches(workspaceId, false, activeRepositoryPath)
      setBranches(response.branches)
      const currentBranch =
        response.branches.find((item) => item.current)?.name ??
        response.branches[0]?.name ??
        ''
      setCheckoutTarget(currentBranch)
      const scopeKey = buildRepositoryScopeKey(workspaceId, activeRepositoryPath)
      const cached = metaCacheRef.current.get(scopeKey)
      metaCacheRef.current.set(scopeKey, {
        branches: response.branches,
        stashEntries: cached?.stashEntries ?? [],
        logEntries: cached?.logEntries ?? [],
        hasMoreHistory: cached?.hasMoreHistory ?? false,
        historySkip: cached?.historySkip ?? 0,
        checkoutTarget: currentBranch,
      })
      setIsGitRepository(true)
      setRepositoryNotice(null)
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        setBranches([])
        setIsGitRepository(false)
        setRepositoryNotice(t(locale, 'git.info.notRepository'))
      } else {
        setErrorMessage(t(locale, 'git.error.metaLoad', { detail: describeUnknownError(error) }))
      }
    }
  }, [activeRepositoryPath, locale, setErrorMessage, setIsGitRepository, setRepositoryNotice, workspaceId])

  const onRefreshStashes = useCallback(async () => {
    if (!workspaceId) {
      setStashEntries([])
      return
    }
    try {
      const response = await desktopApi.gitStashList(workspaceId, STASH_LIMIT, activeRepositoryPath)
      setStashEntries(response.entries)
      const scopeKey = buildRepositoryScopeKey(workspaceId, activeRepositoryPath)
      const cached = metaCacheRef.current.get(scopeKey)
      metaCacheRef.current.set(scopeKey, {
        branches: cached?.branches ?? [],
        stashEntries: response.entries,
        logEntries: cached?.logEntries ?? [],
        hasMoreHistory: cached?.hasMoreHistory ?? false,
        historySkip: cached?.historySkip ?? 0,
        checkoutTarget: cached?.checkoutTarget ?? '',
      })
    } catch {
      setStashEntries([])
    }
  }, [activeRepositoryPath, workspaceId])

  // Stable callbacks for refreshSummary and refreshHistoryLatest
  const refreshSummaryOnly = useCallback(async () => {
    await onRefreshSummary(workspaceId, activeRepositoryPath)
  }, [activeRepositoryPath, onRefreshSummary, workspaceId])

  const refreshHistoryLatest = useCallback(async () => {
    await fetchHistoryPage(0, 'replace')
  }, [fetchHistoryPage])

  // refreshAll — defined before sub-controllers so it can be passed as a prop
  const refreshAll = useCallback(async () => {
    await Promise.all([onRefreshSummary(workspaceId, activeRepositoryPath), refreshMeta()])
  }, [activeRepositoryPath, onRefreshSummary, refreshMeta, workspaceId])

  // Alias for sub-controllers that need full refresh
  const onRefreshAll = useCallback(() => refreshAll(), [refreshAll])

  // Sub-controllers
  const status = useGitStatus({
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    summary: activeSummary,
    onRefreshSummary,
    runAction,
    invalidateDiffCache,
  })

  const commit = useGitCommit({
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    runAction,
    invalidateDiffCache,
    onRefreshHistory: refreshHistoryLatest,
    onRefreshBranches,
  })

  const branch = useGitBranch({
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    locale,
    branches,
    checkoutTarget,
    setCheckoutTarget,
    runAction,
    invalidateDiffCache,
    onRefreshBranches,
    onRefreshAll,
  })

  const remote = useGitRemote({
    locale,
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    invalidateDiffCache,
    setRepositoryNotice,
    setErrorMessage,
    onRefreshBranches,
    onRefreshAll,
  })

  const stash = useGitStash({
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    runAction,
    invalidateDiffCache,
    onRefreshStashes,
  })

  const diff = useGitDiff({
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    selectedPath: status.selectedPath,
    selectedDiffScope: status.selectedDiffScope,
    summaryFiles: activeSummary?.files,
    cacheRefs,
  })

  // Merge sub-controller
  const merge = useGitMerge({
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    runAction,
    onRefreshAll,
  })

  // Commit actions sub-controller (cherry-pick, revert, reset, create branch from commit)
  const commitActions = useGitCommitActions({
    workspaceId,
    repositoryPath: activeRepositoryPath,
    isGitRepository,
    runAction,
    invalidateDiffCache,
    onRefreshBranches,
    onRefreshHistory: refreshHistoryLatest,
    onRefreshAll,
  })

  // Derived
  const graphCommits = useMemo(
    () => buildGraphCommits(logEntries, activeSummary?.branch ?? 'main'),
    [activeSummary?.branch, logEntries],
  )

  const selectedBranchEntry = useMemo(
    () => branches.find((item) => item.name === checkoutTarget) ?? null,
    [branches, checkoutTarget],
  )

  // History pagination
  const loadOlderHistory = useCallback(async () => {
    if (!workspaceId || historyLoading || !hasMoreHistory) {
      return
    }
    await fetchHistoryPage(historySkip + HISTORY_PAGE_SIZE, 'append')
  }, [fetchHistoryPage, hasMoreHistory, historyLoading, historySkip, workspaceId])

  const resetToLatestHistory = useCallback(async () => {
    await fetchHistoryPage(0, 'replace')
  }, [fetchHistoryPage])

  // Workspace change — meta refresh + repo state reset
  useEffect(() => {
    if (!workspaceId) {
      setCurrentRepositoryPath(null)
      return
    }
    setCurrentRepositoryPath(restoreScopedRepositorySelection(workspaceId, repositorySelectionRef.current))
  }, [workspaceId])

  useEffect(() => {
    setIsGitRepository(true)
    setRepositoryNotice(null)
    invalidateDiffCache()
    if (!workspaceId) {
      setLogEntries([])
      setBranches([])
      setStashEntries([])
      return
    }
    void refreshMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepositoryPath, workspaceId])

  useEffect(() => {
    if (!shouldAdoptResolvedRepositorySelection({
      activeRepositoryPath,
      currentRepositoryPath,
      repositories,
    })) {
      return
    }

    if (!repositories.length) {
      setCurrentRepositoryPath(null)
      return
    }

    setCurrentRepositoryPath(activeRepositoryPath)
    repositorySelectionRef.current.set(workspaceId ?? '', activeRepositoryPath)
  }, [activeRepositoryPath, currentRepositoryPath, repositories, workspaceId])

  // dismissRepositoryNotice — delegates to composition-layer state
  const dismissRepositoryNotice = useCallback(() => {
    setRepositoryNotice(null)
  }, [])

  return {
    locale,
    workspaceId,
    isGitRepository,
    summary: activeSummary,
    repositories,
    currentRepositoryPath: activeRepositoryPath,
    setCurrentRepositoryPath: setScopedCurrentRepositoryPath,
    stagedFiles: status.stagedFiles,
    unstagedFiles: status.unstagedFiles,
    visibleFiles: status.visibleFiles,
    hasStagedFiles: status.hasStagedFiles,
    hasUnstagedFiles: status.hasUnstagedFiles,
    filter: status.filter,
    setFilter: status.setFilter,
    selectedPath: status.selectedPath,
    selectedDiffScope: status.selectedDiffScope,
    selectPath: status.selectPath,
    diffLoading: diff.diffLoading,
    structuredDiff: diff.structuredDiff,
    diffViewMode: diff.diffViewMode,
    setDiffViewMode: diff.setDiffViewMode,
    showDiffView: diff.showDiffView,
    setShowDiffView: diff.setShowDiffView,
    preloadDiff: diff.preloadDiff,
    metaLoading,
    actionLoading,
    remoteActionLoading: remote.remoteActionLoading,
    errorMessage,
    repositoryNotice,
    dismissRepositoryNotice,
    commitMessage: commit.commitMessage,
    setCommitMessage: commit.setCommitMessage,
    amendMode: commit.amendMode,
    setAmendMode: commit.setAmendMode,
    stashMessage: stash.stashMessage,
    setStashMessage: stash.setStashMessage,
    checkoutTarget,
    setCheckoutTarget,
    newBranchName: branch.newBranchName,
    setNewBranchName: branch.setNewBranchName,
    selectedBranchEntry,
    logEntries,
    historyLoading,
    hasMoreHistory,
    branches,
    stashEntries,
    graphCommits,
    refreshAll,
    refreshSummary: refreshSummaryOnly,
    invalidateDiffCache,
    stagePath: status.stagePath,
    unstagePath: status.unstagePath,
    stageAll: status.stageAll,
    unstageAll: status.unstageAll,
    discardPath: status.discardPath,
    commit: commit.commit,
    fetch: remote.fetch,
    pull: remote.pull,
    push: remote.push,
    pushTag: remote.pushTag,
    checkout: branch.checkout,
    checkoutTo: branch.checkoutTo,
    createBranch: branch.createBranch,
    deleteBranch: branch.deleteBranch,
    stashPush: stash.stashPush,
    stashPop: stash.stashPop,
    loadOlderHistory,
    resetToLatestHistory,
    cherryPick: commitActions.cherryPick,
    revert: commitActions.revert,
    reset: commitActions.reset,
    createBranchFromCommit: commitActions.createBranchFromCommit,
    mergeConflicts: merge.mergeConflicts,
    isMerging: merge.isMerging,
    startMerge: merge.startMerge,
    continueMerge: merge.continueMerge,
    abortMerge: merge.abortMerge,
  }
}
