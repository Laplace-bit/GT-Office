import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  desktopApi,
  type GitStatusFile,
  type GitStatusResponse,
} from '@shell/integration/desktop-api'
import type { GitDiffScope, GitFileFilter } from './types'
import { hasStagedChanges, hasUnstagedChanges, resolveDiffScope } from './helpers'

interface OptimisticAction {
  type: 'stage' | 'unstage'
  paths: string[]
  seq: number
}

interface UseGitStatusInput {
  workspaceId: string | null
  repositoryPath: string | null
  isGitRepository: boolean
  summary: GitStatusResponse | null
  onRefreshSummary: (
    workspaceId: string | null,
    repositoryPath?: string | null,
  ) => Promise<void>
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
}

interface UseGitStatusResult {
  filter: GitFileFilter
  setFilter: (filter: GitFileFilter) => void
  selectedPath: string | null
  selectedDiffScope: GitDiffScope
  setSelectedDiffScope: (scope: GitDiffScope) => void
  selectPath: (path: string, scope?: GitDiffScope) => void
  stagedFiles: GitStatusFile[]
  unstagedFiles: GitStatusFile[]
  visibleFiles: GitStatusFile[]
  hasStagedFiles: boolean
  hasUnstagedFiles: boolean
  stagePath: (path: string) => Promise<void>
  unstagePath: (path: string) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  discardPath: (path: string, includeUntracked?: boolean) => Promise<void>
  refreshSummary: () => Promise<void>
  dismissRepositoryNotice: () => void
}

export function useGitStatus({
  workspaceId,
  repositoryPath,
  isGitRepository,
  summary,
  onRefreshSummary,
  runAction,
  invalidateDiffCache,
}: UseGitStatusInput): UseGitStatusResult {
  const [filter, setFilter] = useState<GitFileFilter>('staged')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedDiffScope, setSelectedDiffScope] = useState<GitDiffScope>('unstaged')

  // Optimistic overlay for stage/unstage
  const [pendingActions, setPendingActions] = useState<OptimisticAction[]>([])
  const optimisticSeqRef = useRef(0)

  // When summary changes (real state arrives from git/updated event),
  // discard all optimistic overlays — the server state is authoritative.
  useEffect(() => {
    if (pendingActions.length > 0) {
      setPendingActions([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.files])

  // Apply optimistic overlays to derive effective file list
  const effectiveFiles = useMemo(() => {
    const base = summary?.files ?? []
    if (pendingActions.length === 0) return base
    return base.map((file) => {
      for (let i = pendingActions.length - 1; i >= 0; i--) {
        const action = pendingActions[i]
        if (!action.paths.includes(file.path)) continue
        if (action.type === 'stage') {
          if (file.status.startsWith('??')) {
            // Untracked -> staged: show as added in index
            return { ...file, staged: true, status: `A ${file.status.slice(2) || ''}`.trimEnd() || 'A ' }
          }
          // Modified file staged: index column gets the current worktree status
          const worktreeChar = file.status.length >= 2 ? file.status[1] : ' '
          return { ...file, staged: true, status: `${worktreeChar}${worktreeChar}` }
        }
        if (action.type === 'unstage') {
          if (file.staged) {
            const indexChar = file.status.length >= 1 ? file.status[0] : ' '
            return { ...file, staged: false, status: ` ${indexChar}` }
          }
        }
      }
      return file
    })
  }, [summary?.files, pendingActions])

  // Derived
  const stagedFiles = useMemo(
    () => effectiveFiles.filter((item) => hasStagedChanges(item)),
    [effectiveFiles],
  )
  const unstagedFiles = useMemo(
    () => effectiveFiles.filter((item) => hasUnstagedChanges(item)),
    [effectiveFiles],
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
    return effectiveFiles
  }, [filter, stagedFiles, summary, unstagedFiles, effectiveFiles])

  const hasStagedFiles = stagedFiles.length > 0
  const hasUnstagedFiles = unstagedFiles.length > 0

  // Actions
  const refreshSummaryOnly = useCallback(async () => {
    await onRefreshSummary(workspaceId, repositoryPath)
  }, [onRefreshSummary, repositoryPath, workspaceId])

  const stagePath = useCallback(
    async (path: string) => {
      if (!workspaceId || !isGitRepository || !path) {
        return
      }
      const seq = ++optimisticSeqRef.current
      setPendingActions((prev) => [...prev, { type: 'stage', paths: [path], seq }])
      try {
        await runAction('stage', async () => {
          await desktopApi.gitStage(workspaceId, [path], repositoryPath)
          invalidateDiffCache()
        })
      } finally {
        setPendingActions((prev) => prev.filter((a) => a.seq !== seq))
      }
    },
    [invalidateDiffCache, isGitRepository, repositoryPath, runAction, workspaceId],
  )

  const unstagePath = useCallback(
    async (path: string) => {
      if (!workspaceId || !isGitRepository || !path) {
        return
      }
      const seq = ++optimisticSeqRef.current
      setPendingActions((prev) => [...prev, { type: 'unstage', paths: [path], seq }])
      try {
        await runAction('unstage', async () => {
          await desktopApi.gitUnstage(workspaceId, [path], repositoryPath)
          invalidateDiffCache()
        })
      } finally {
        setPendingActions((prev) => prev.filter((a) => a.seq !== seq))
      }
    },
    [invalidateDiffCache, isGitRepository, repositoryPath, runAction, workspaceId],
  )

  const stageAll = useCallback(async () => {
    if (!workspaceId || !isGitRepository || unstagedFiles.length === 0) {
      return
    }
    const paths = unstagedFiles.map((item) => item.path)
    const seq = ++optimisticSeqRef.current
    setPendingActions((prev) => [...prev, { type: 'stage', paths, seq }])
    try {
      await runAction('stage-all', async () => {
        await desktopApi.gitStage(workspaceId, paths, repositoryPath)
        invalidateDiffCache()
      })
    } finally {
      setPendingActions((prev) => prev.filter((a) => a.seq !== seq))
    }
  }, [invalidateDiffCache, isGitRepository, repositoryPath, runAction, unstagedFiles, workspaceId])

  const unstageAll = useCallback(async () => {
    if (!workspaceId || !isGitRepository || stagedFiles.length === 0) {
      return
    }
    const paths = stagedFiles.map((item) => item.path)
    const seq = ++optimisticSeqRef.current
    setPendingActions((prev) => [...prev, { type: 'unstage', paths, seq }])
    try {
      await runAction('unstage-all', async () => {
        await desktopApi.gitUnstage(workspaceId, paths, repositoryPath)
        invalidateDiffCache()
      })
    } finally {
      setPendingActions((prev) => prev.filter((a) => a.seq !== seq))
    }
  }, [invalidateDiffCache, isGitRepository, repositoryPath, runAction, stagedFiles, workspaceId])

  const discardPath = useCallback(
    async (path: string, includeUntracked = false) => {
      if (!workspaceId || !isGitRepository || !path) {
        return
      }
      await runAction('discard', async () => {
        await desktopApi.gitDiscard(workspaceId, [path], includeUntracked, repositoryPath)
        invalidateDiffCache()
      })
    },
    [invalidateDiffCache, isGitRepository, repositoryPath, runAction, workspaceId],
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

  // dismissRepositoryNotice is a no-op at this level; the composition layer
  // delegates to the shared state's dismiss. Kept for interface compatibility.
  const dismissRepositoryNotice = useCallback(() => {
    // no-op — handled by composition layer
  }, [])

  // Effects
  useEffect(() => {
    setFilter('staged')
    setSelectedPath(null)
    if (!workspaceId) {
      return
    }
  }, [repositoryPath, workspaceId])

  useEffect(() => {
    if (!summary || summary.files.length === 0) {
      setSelectedPath(null)
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

  return {
    filter,
    setFilter,
    selectedPath,
    selectedDiffScope,
    setSelectedDiffScope,
    selectPath,
    stagedFiles,
    unstagedFiles,
    visibleFiles,
    hasStagedFiles,
    hasUnstagedFiles,
    stagePath,
    unstagePath,
    stageAll,
    unstageAll,
    discardPath,
    refreshSummary: refreshSummaryOnly,
    dismissRepositoryNotice,
  }
}
