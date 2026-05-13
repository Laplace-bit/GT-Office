import { useCallback, useEffect, useState } from 'react'
import {
  desktopApi,
  type GitDiffStructuredResponse,
} from '@shell/integration/desktop-api'
import type { GitDiffScope } from './types'
import { DIFF_CACHE_SIZE, DIFF_PRELOAD_DELAY_MS } from './types'
import type { DiffCacheRefs } from './useGitShared'

interface UseGitDiffInput {
  workspaceId: string | null
  repositoryPath: string | null
  isGitRepository: boolean
  selectedPath: string | null
  selectedDiffScope: GitDiffScope
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaryFiles: any[] | undefined
  cacheRefs: DiffCacheRefs
}

interface UseGitDiffResult {
  structuredDiff: GitDiffStructuredResponse | null
  diffViewMode: 'split' | 'unified'
  setDiffViewMode: (mode: 'split' | 'unified') => void
  showDiffView: boolean
  setShowDiffView: (show: boolean) => void
  diffLoading: boolean
  preloadDiff: (path: string, scope?: GitDiffScope) => void
}

export function useGitDiff({
  workspaceId,
  repositoryPath,
  isGitRepository,
  selectedPath,
  selectedDiffScope,
  summaryFiles,
  cacheRefs,
}: UseGitDiffInput): UseGitDiffResult {
  const [structuredDiff, setStructuredDiff] = useState<GitDiffStructuredResponse | null>(null)
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('split')
  const [showDiffView, setShowDiffView] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)

  const { diffCacheRef, pendingPreloadsRef, diffSeqRef, preloadTimerRef } = cacheRefs

  // Diff fetch effect with cache logic
  useEffect(() => {
    if (!workspaceId || !isGitRepository || !selectedPath) {
      setStructuredDiff(null)
      return undefined
    }

    // Check cache first for instant loading
    const cacheKey = `${workspaceId}:${repositoryPath ?? ''}:${selectedPath}:${selectedDiffScope}`
    const cached = diffCacheRef.current.get(cacheKey)
    if (cached) {
      // Move to end of map for LRU behavior
      diffCacheRef.current.delete(cacheKey)
      diffCacheRef.current.set(cacheKey, cached)
      setStructuredDiff(cached)
      setShowDiffView(true)
      // No loading state needed - instant
      return undefined
    }

    const seq = diffSeqRef.current + 1
    diffSeqRef.current = seq
    setDiffLoading(true)

    // Use high-performance structured diff API
    void desktopApi
      .gitDiffFileStructured(
        workspaceId,
        selectedPath,
        selectedDiffScope === 'staged',
        repositoryPath,
      )
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
        setShowDiffView(true)
      })
      .catch(() => {
        if (diffSeqRef.current !== seq) {
          return
        }
        setStructuredDiff(null)
      })
      .finally(() => {
        if (diffSeqRef.current === seq) {
          setDiffLoading(false)
        }
      })

    return undefined
  }, [diffCacheRef, diffSeqRef, isGitRepository, repositoryPath, selectedDiffScope, selectedPath, summaryFiles, workspaceId])

  // Preload diff for hover preview with debounce to avoid flooding background workers.
  const preloadDiff = useCallback(
    (path: string, scope: GitDiffScope = 'unstaged') => {
      if (!workspaceId || !isGitRepository || !path) return

      const cacheKey = `${workspaceId}:${repositoryPath ?? ''}:${path}:${scope}`
      // Skip if already cached or pending
      if (diffCacheRef.current.has(cacheKey) || pendingPreloadsRef.current.has(cacheKey)) return

      if (typeof preloadTimerRef.current === 'number') {
        window.clearTimeout(preloadTimerRef.current)
      }

      preloadTimerRef.current = window.setTimeout(() => {
        pendingPreloadsRef.current.add(cacheKey)
        void desktopApi
          .gitDiffFileStructured(workspaceId, path, scope === 'staged', repositoryPath)
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
    [diffCacheRef, isGitRepository, pendingPreloadsRef, preloadTimerRef, repositoryPath, workspaceId],
  )

  // Cleanup preload timer on unmount
  useEffect(() => {
    return () => {
      if (typeof preloadTimerRef.current === 'number') {
        window.clearTimeout(preloadTimerRef.current)
      }
    }
  }, [preloadTimerRef])

  return {
    structuredDiff,
    diffViewMode,
    setDiffViewMode,
    showDiffView,
    setShowDiffView,
    diffLoading,
    preloadDiff,
  }
}
