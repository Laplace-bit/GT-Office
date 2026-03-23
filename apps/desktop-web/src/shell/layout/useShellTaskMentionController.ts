import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FsSearchFileMatch } from '../integration/desktop-api'
import { desktopApi } from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'
import { describeError } from './ShellRoot.shared'

interface UseShellTaskMentionControllerInput {
  activeWorkspaceId: string | null
  localeRef: MutableRefObject<Locale>
}

export interface ShellTaskMentionController {
  taskMentionCandidates: FsSearchFileMatch[]
  taskMentionLoading: boolean
  taskMentionError: string | null
  clearTaskMentionSearch: () => void
  searchTaskMentionFiles: (rawQuery: string) => void
}

export function useShellTaskMentionController({
  activeWorkspaceId,
  localeRef,
}: UseShellTaskMentionControllerInput): ShellTaskMentionController {
  const [taskMentionCandidates, setTaskMentionCandidates] = useState<FsSearchFileMatch[]>([])
  const [taskMentionLoading, setTaskMentionLoading] = useState(false)
  const [taskMentionError, setTaskMentionError] = useState<string | null>(null)
  const taskMentionSearchSeqRef = useRef(0)
  const taskMentionSearchTimerRef = useRef<number | null>(null)
  const taskMentionLastQueryRef = useRef('')

  const clearTaskMentionSearch = useCallback(() => {
    if (typeof taskMentionSearchTimerRef.current === 'number') {
      window.clearTimeout(taskMentionSearchTimerRef.current)
    }
    taskMentionSearchTimerRef.current = null
    taskMentionSearchSeqRef.current += 1
    taskMentionLastQueryRef.current = ''
    setTaskMentionCandidates([])
    setTaskMentionLoading(false)
    setTaskMentionError(null)
  }, [])

  const searchTaskMentionFiles = useCallback(
    (rawQuery: string) => {
      const query = rawQuery.trim()
      if (!query || !activeWorkspaceId || !desktopApi.isTauriRuntime()) {
        clearTaskMentionSearch()
        return
      }
      if (query === taskMentionLastQueryRef.current) {
        return
      }
      taskMentionLastQueryRef.current = query

      if (typeof taskMentionSearchTimerRef.current === 'number') {
        window.clearTimeout(taskMentionSearchTimerRef.current)
      }
      const requestSeq = taskMentionSearchSeqRef.current + 1
      taskMentionSearchSeqRef.current = requestSeq
      setTaskMentionLoading(true)
      setTaskMentionError(null)

      taskMentionSearchTimerRef.current = window.setTimeout(() => {
        void desktopApi
          .fsSearchFiles(activeWorkspaceId, query, 80)
          .then((response) => {
            if (taskMentionSearchSeqRef.current !== requestSeq) {
              return
            }
            setTaskMentionCandidates(response.matches.slice(0, 10))
            setTaskMentionError(null)
          })
          .catch((error) => {
            if (taskMentionSearchSeqRef.current !== requestSeq) {
              return
            }
            setTaskMentionCandidates([])
            setTaskMentionError(
              t(localeRef.current, 'taskCenter.mentionSearchFailed', {
                detail: describeError(error),
              }),
            )
          })
          .finally(() => {
            if (taskMentionSearchSeqRef.current !== requestSeq) {
              return
            }
            setTaskMentionLoading(false)
          })
      }, 64)
    },
    [activeWorkspaceId, clearTaskMentionSearch, localeRef],
  )

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) {
        return
      }
      clearTaskMentionSearch()
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, clearTaskMentionSearch])

  useEffect(() => {
    return () => {
      if (typeof taskMentionSearchTimerRef.current === 'number') {
        window.clearTimeout(taskMentionSearchTimerRef.current)
      }
      taskMentionSearchTimerRef.current = null
      taskMentionSearchSeqRef.current += 1
      taskMentionLastQueryRef.current = ''
    }
  }, [])

  return {
    taskMentionCandidates,
    taskMentionLoading,
    taskMentionError,
    clearTaskMentionSearch,
    searchTaskMentionFiles,
  }
}
