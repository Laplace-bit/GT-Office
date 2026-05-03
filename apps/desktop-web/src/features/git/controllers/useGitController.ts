import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  desktopApi,
  type GitBranchEntry,
  type GitCommitEntry,
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
import { useGitStatus } from './useGitStatus'
import { useGitCommit } from './useGitCommit'
import { useGitBranch } from './useGitBranch'
import { useGitRemote } from './useGitRemote'
import { useGitStash } from './useGitStash'
import { useGitDiff } from './useGitDiff'
import { useGitMerge } from './useGitMerge'
import { useGitCommitActions } from './useGitCommitActions'

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

  // refreshMeta — defined here because it spans branch/stash/history state.
  // Uses composition-layer state directly (no circular dep).
  const refreshMeta = useCallback(async () => {
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
      setRepositoryNotice(null)
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
        setRepositoryNotice(t(locale, 'git.info.notRepository'))
        setErrorMessage(null)
        return
      }
      setIsGitRepository(true)
      setRepositoryNotice(null)
      setErrorMessage(t(locale, 'git.error.metaLoad', { detail: describeUnknownError(error) }))
    } finally {
      setMetaLoading(false)
    }
  }, [workspaceId, fetchHistoryPage, locale, setIsGitRepository, setRepositoryNotice, setErrorMessage])

  // Stable callback that delegates to latest refreshMeta via ref (breaks circular dep)
  const refreshMetaRef = useRef(refreshMeta)
  useEffect(() => {
    refreshMetaRef.current = refreshMeta
  }, [refreshMeta])
  const onRefreshMeta = useCallback(() => refreshMetaRef.current(), [])

  // Stable callbacks for refreshSummary and refreshHistoryLatest
  const refreshSummaryOnly = useCallback(async () => {
    await onRefreshSummary(workspaceId)
  }, [onRefreshSummary, workspaceId])

  const refreshHistoryLatest = useCallback(async () => {
    await fetchHistoryPage(0, 'replace')
  }, [fetchHistoryPage])

  // Sub-controllers
  const status = useGitStatus({
    workspaceId,
    isGitRepository,
    summary,
    onRefreshSummary,
    runAction,
    invalidateDiffCache,
  })

  const commit = useGitCommit({
    workspaceId,
    isGitRepository,
    runAction,
    invalidateDiffCache,
    onRefreshSummary: refreshSummaryOnly,
    onRefreshHistory: refreshHistoryLatest,
    onRefreshMeta,
  })

  const branch = useGitBranch({
    workspaceId,
    isGitRepository,
    locale,
    branches,
    checkoutTarget,
    setCheckoutTarget,
    runAction,
    invalidateDiffCache,
    onRefreshMeta,
    onRefreshSummary: refreshSummaryOnly,
    onRefreshHistory: refreshHistoryLatest,
  })

  const remote = useGitRemote({
    workspaceId,
    isGitRepository,
    runAction,
    invalidateDiffCache,
    onRefreshSummary: refreshSummaryOnly,
    onRefreshMeta,
    onRefreshHistory: refreshHistoryLatest,
  })

  const stash = useGitStash({
    workspaceId,
    isGitRepository,
    runAction,
    invalidateDiffCache,
    onRefreshSummary: refreshSummaryOnly,
    onRefreshMeta,
  })

  const diff = useGitDiff({
    workspaceId,
    isGitRepository,
    selectedPath: status.selectedPath,
    selectedDiffScope: status.selectedDiffScope,
    summaryFiles: summary?.files,
    cacheRefs,
  })

  // Merge sub-controller
  const merge = useGitMerge({
    workspaceId,
    isGitRepository,
    runAction,
    onRefreshSummary: refreshSummaryOnly,
    onRefreshMeta,
  })

  // Commit actions sub-controller (cherry-pick, revert, reset, create branch from commit)
  const commitActions = useGitCommitActions({
    workspaceId,
    isGitRepository,
    runAction,
    invalidateDiffCache,
    onRefreshSummary: refreshSummaryOnly,
    onRefreshMeta,
    onRefreshHistory: refreshHistoryLatest,
  })

  // Derived
  const graphCommits = useMemo(
    () => buildGraphCommits(logEntries, summary?.branch ?? 'main'),
    [logEntries, summary?.branch],
  )

  const selectedBranchEntry = useMemo(
    () => branches.find((item) => item.name === checkoutTarget) ?? null,
    [branches, checkoutTarget],
  )

  // refreshAll
  const refreshAll = useCallback(async () => {
    await onRefreshSummary(workspaceId)
    await refreshMeta()
  }, [onRefreshSummary, refreshMeta, workspaceId])

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
  }, [workspaceId])

  // dismissRepositoryNotice — delegates to composition-layer state
  const dismissRepositoryNotice = useCallback(() => {
    setRepositoryNotice(null)
  }, [])

  return {
    locale,
    workspaceId,
    isGitRepository,
    summary,
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
    stagePath: status.stagePath,
    unstagePath: status.unstagePath,
    stageAll: status.stageAll,
    unstageAll: status.unstageAll,
    discardPath: status.discardPath,
    commit: commit.commit,
    fetch: remote.fetch,
    pull: remote.pull,
    push: remote.push,
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
