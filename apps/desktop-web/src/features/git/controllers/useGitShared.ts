import { useCallback, useRef, useState } from 'react'
import type { GitDiffStructuredResponse } from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { isNotGitRepositoryError } from '../git-error'
import { describeUnknownError } from './helpers'

// ============================================
// useGitShared — action runner + isGitRepository
// ============================================
interface UseGitSharedInput {
  locale: Locale
  setRepositoryNotice: (value: string | null) => void
  setErrorMessage: (value: string | null) => void
}

interface UseGitSharedResult {
  isGitRepository: boolean
  setIsGitRepository: (value: boolean) => void
  actionLoading: string | null
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
}

export function useGitShared({
  locale,
  setRepositoryNotice,
  setErrorMessage,
}: UseGitSharedInput): UseGitSharedResult {
  const [isGitRepository, setIsGitRepository] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const runAction = useCallback(
    async (actionKey: string, runner: () => Promise<void>) => {
      setActionLoading(actionKey)
      try {
        await runner()
        setRepositoryNotice(null)
        setErrorMessage(null)
      } catch (error) {
        if (isNotGitRepositoryError(error)) {
          setIsGitRepository(false)
          setRepositoryNotice(t(locale, 'git.info.notRepository'))
          setErrorMessage(null)
        } else {
          setRepositoryNotice(null)
          setErrorMessage(describeUnknownError(error))
        }
      } finally {
        setActionLoading(null)
      }
    },
    [locale, setRepositoryNotice, setErrorMessage],
  )

  return {
    isGitRepository,
    setIsGitRepository,
    actionLoading,
    runAction,
  }
}

// ============================================
// Diff Cache Infrastructure
// ============================================
export interface DiffCacheRefs {
  diffCacheRef: React.MutableRefObject<Map<string, GitDiffStructuredResponse>>
  pendingPreloadsRef: React.MutableRefObject<Set<string>>
  diffSeqRef: React.MutableRefObject<number>
  preloadTimerRef: React.MutableRefObject<number | null>
}

export function useDiffCacheRefs(): DiffCacheRefs {
  return {
    diffCacheRef: useRef(new Map<string, GitDiffStructuredResponse>()),
    pendingPreloadsRef: useRef(new Set<string>()),
    diffSeqRef: useRef(0),
    preloadTimerRef: useRef<number | null>(null),
  }
}
