import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  desktopApi,
  type GitStatusFile,
  type GitStatusResponse,
} from '@shell/integration/desktop-api'
import type { GitDiffScope, GitFileFilter } from './types'
import { hasStagedChanges, hasUnstagedChanges, resolveDiffScope } from './helpers'

interface UseGitStatusInput {
  workspaceId: string | null
  isGitRepository: boolean
  summary: GitStatusResponse | null
  onRefreshSummary: (workspaceId: string | null) => Promise<void>
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
  isGitRepository,
  summary,
  onRefreshSummary,
  runAction,
  invalidateDiffCache,
}: UseGitStatusInput): UseGitStatusResult {
  const [filter, setFilter] = useState<GitFileFilter>('all')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedDiffScope, setSelectedDiffScope] = useState<GitDiffScope>('unstaged')

  // Derived
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

  // Actions
  const refreshSummaryOnly = useCallback(async () => {
    await onRefreshSummary(workspaceId)
  }, [onRefreshSummary, workspaceId])

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
    setFilter('all')
    setSelectedPath(null)
    if (!workspaceId) {
      return
    }
  }, [workspaceId])

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
