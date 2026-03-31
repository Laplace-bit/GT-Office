import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  desktopApi,
  type DaemonSearchBackpressurePayload,
  type DaemonSearchCancelledPayload,
  type DaemonSearchChunkPayload,
  type DaemonSearchDonePayload,
  type FsEntry,
  type FsSearchMatch,
} from '@shell/integration/desktop-api'
import { requestStandardModalClose } from '@/components/modal/standard-modal-close'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { resolveFileVisual } from './file-visuals'
import './FileSearchModal.scss'

const CONTENT_MATCH_MAX_RENDER = 200
const SEARCH_DEBOUNCE_MS = 240

type SearchMode = 'file' | 'content'

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function resolveFileSearchEntries(items: Array<{ path: string }>): FsEntry[] {
  return items.map((item) => {
    const segments = item.path.replace(/^\/+/, '').split('/')
    return {
      kind: 'file',
      name: segments[segments.length - 1] || 'file',
      path: item.path,
    }
  })
}

interface GlobalFileSearchModalProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  initialMode: SearchMode
  onClose: () => void
  onModeChange?: (mode: SearchMode) => void
  onSelectFile: (path: string, line?: number) => void
}

export function GlobalFileSearchModal({
  open,
  locale,
  workspaceId,
  initialMode,
  onClose,
  onModeChange,
  onSelectFile,
}: GlobalFileSearchModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [mode, setMode] = useState<SearchMode>(initialMode)
  const [query, setQuery] = useState('')
  const [fileMatches, setFileMatches] = useState<FsEntry[]>([])
  const [contentMatches, setContentMatches] = useState<FsSearchMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [droppedChunks, setDroppedChunks] = useState(0)

  const activeStreamSearchIdRef = useRef<string | null>(null)
  const searchRequestSeqRef = useRef(0)
  const trimmedQuery = query.trim()

  useEffect(() => {
    if (open) {
      setMode(initialMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const timerId = window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) {
        return
      }
      input.focus()
      input.select()
    })
    return () => window.cancelAnimationFrame(timerId)
  }, [open, mode])

  const cancelActiveStreamSearch = useCallback(() => {
    const activeSearchId = activeStreamSearchIdRef.current
    if (!activeSearchId) {
      return
    }
    activeStreamSearchIdRef.current = null
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    void desktopApi.fsSearchStreamCancel(activeSearchId).catch(() => {
      // ignore cancellation races
    })
  }, [])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let active = true
    let cleanup: (() => void) | null = null
    void desktopApi
      .subscribeDaemonSearchEvents({
        onChunk: (payload: DaemonSearchChunkPayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setContentMatches((prev) => {
            if (prev.length >= CONTENT_MATCH_MAX_RENDER) {
              return prev
            }
            const next = [...prev]
            for (const item of payload.items) {
              if (next.length >= CONTENT_MATCH_MAX_RENDER) {
                break
              }
              next.push({
                path: item.path,
                line: item.line,
                preview: item.preview,
              })
            }
            return next
          })
        },
        onBackpressure: (payload: DaemonSearchBackpressurePayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setDroppedChunks((prev) => prev + Math.max(0, payload.droppedChunks || 0))
        },
        onDone: (payload: DaemonSearchDonePayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setLoading(false)
          activeStreamSearchIdRef.current = null
        },
        onCancelled: (payload: DaemonSearchCancelledPayload) => {
          if (!active || payload.searchId !== activeStreamSearchIdRef.current) {
            return
          }
          setLoading(false)
          activeStreamSearchIdRef.current = null
        },
      })
      .then((unlisten) => {
        if (!active) {
          unlisten()
          return
        }
        cleanup = unlisten
      })

    return () => {
      active = false
      if (cleanup) {
        cleanup()
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      cancelActiveStreamSearch()
    }
  }, [cancelActiveStreamSearch])

  // Stream Search logic
  useEffect(() => {
    if (!open || !workspaceId || mode !== 'content') {
      cancelActiveStreamSearch()
      if (mode === 'content') {
        setLoading(false)
        setError(null)
      }
      return
    }

    if (!trimmedQuery) {
      cancelActiveStreamSearch()
      setLoading(false)
      setError(null)
      setContentMatches([])
      setDroppedChunks(0)
      return
    }

    const requestId = searchRequestSeqRef.current + 1
    searchRequestSeqRef.current = requestId
    setLoading(true)
    setError(null)
    setDroppedChunks(0)
    setContentMatches([])

    const timer = window.setTimeout(() => {
      const searchId = `search_${Date.now().toString(36)}_${requestId.toString(36)}`
      const previousSearchId = activeStreamSearchIdRef.current
      activeStreamSearchIdRef.current = searchId
      if (previousSearchId && previousSearchId !== searchId) {
        void desktopApi.fsSearchStreamCancel(previousSearchId).catch(() => {
          // ignore cancellation races
        })
      }
      void desktopApi
        .fsSearchStreamStart(workspaceId, {
          searchId,
          query: trimmedQuery,
          chunkSize: 64,
          maxResults: CONTENT_MATCH_MAX_RENDER,
        })
        .catch(async (err) => {
          if (
            searchRequestSeqRef.current !== requestId ||
            activeStreamSearchIdRef.current !== searchId
          ) {
            return
          }
          activeStreamSearchIdRef.current = null
          try {
            const response = await desktopApi.fsSearchText(workspaceId, trimmedQuery)
            if (searchRequestSeqRef.current !== requestId) {
              return
            }
            setContentMatches(response.matches.slice(0, CONTENT_MATCH_MAX_RENDER))
            setLoading(false)
          } catch (fallbackError) {
            if (searchRequestSeqRef.current !== requestId) {
              return
            }
            setLoading(false)
            setContentMatches([])
            setError(
              t(locale, 'fileTree.searchFailed', {
                detail: fallbackError instanceof Error ? fallbackError.message : describeUnknownError(err),
              }),
            )
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [cancelActiveStreamSearch, open, locale, mode, trimmedQuery, workspaceId])

  // File Search logic
  useEffect(() => {
    if (!open || !workspaceId || mode !== 'file') {
      if (mode === 'file') {
        setLoading(false)
        setError(null)
      }
      return
    }

    if (!trimmedQuery) {
      setFileMatches([])
      setLoading(false)
      setError(null)
      return
    }

    const requestId = searchRequestSeqRef.current + 1
    searchRequestSeqRef.current = requestId
    setLoading(true)
    setError(null)
    setFileMatches([])

    const timer = window.setTimeout(() => {
      void desktopApi
        .fsSearchFiles(workspaceId, trimmedQuery, 120)
        .then((response) => {
          if (searchRequestSeqRef.current !== requestId) {
            return
          }
          setFileMatches(resolveFileSearchEntries(response.matches))
          setLoading(false)
        })
        .catch((err) => {
          if (searchRequestSeqRef.current !== requestId) {
            return
          }
          setLoading(false)
          setFileMatches([])
          setError(
            t(locale, 'fileTree.searchFailed', {
              detail: err instanceof Error ? err.message : String(err),
            }),
          )
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [open, locale, mode, trimmedQuery, workspaceId])

  const activeResults = useMemo(
    () => (mode === 'file' ? fileMatches : contentMatches),
    [contentMatches, fileMatches, mode],
  )

  const handleModeChange = useCallback(
    (nextMode: SearchMode) => {
      setMode(nextMode)
      onModeChange?.(nextMode)
    },
    [onModeChange]
  )

  const handleSelectFile = useCallback(
    (path: string, line?: number) => {
      onSelectFile(path, line)
      onClose()
    },
    [onClose, onSelectFile]
  )

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className="settings-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestStandardModalClose('backdrop', onClose)
        }
      }}
    >
      <section className="settings-modal panel file-search-modal" role="dialog" aria-modal="true">
        <header className="settings-modal-header">
          <div className="file-search-heading">
            <div>
              <h2>{t(locale, 'fileSearch.title')}</h2>
              <p>{t(locale, 'fileSearch.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => requestStandardModalClose('explicit', onClose)}
            aria-label={t(locale, 'settingsModal.close')}
          >
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <div className="file-search-toolbar">
          <div className="file-search-mode" role="tablist" aria-label={t(locale, 'fileTree.searchMode')}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'file'}
              className={`file-search-mode-btn ${mode === 'file' ? 'active' : ''}`}
              onClick={() => handleModeChange('file')}
            >
              {t(locale, 'fileTree.searchModeFile')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'content'}
              className={`file-search-mode-btn ${mode === 'content' ? 'active' : ''}`}
              onClick={() => handleModeChange('content')}
            >
              {t(locale, 'fileTree.searchModeContent')}
            </button>
          </div>
          <label className="file-search-input-wrap">
            <AppIcon name="search" className="vb-icon vb-icon-tree-search" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (activeResults.length > 0) {
                    const first = activeResults[0]
                    if (mode === 'file' && 'name' in first) {
                      handleSelectFile(first.path)
                    } else if (mode === 'content' && 'line' in first) {
                      handleSelectFile(first.path, first.line)
                    }
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  if (query.trim()) {
                    setQuery('')
                    return
                  }
                  onClose()
                }
              }}
              placeholder={
                mode === 'file'
                  ? t(locale, 'fileTree.searchPlaceholderFile')
                  : t(locale, 'fileTree.searchPlaceholderContent')
              }
              disabled={!workspaceId}
            />
          </label>
          <p className="file-tree-search-summary file-search-summary-slot">
            {query.trim()
              ? loading
                ? t(locale, 'fileTree.searchLoading')
                : t(locale, 'fileTree.searchSummary', { count: activeResults.length })
              : '\u00a0'}
          </p>
        </div>

        <div className="file-search-body">
          {!workspaceId ? <p>{t(locale, 'fileTree.noWorkspace')}</p> : null}
          {error ? <p className="tree-error">{error}</p> : null}
          {droppedChunks > 0 ? (
            <p className="file-tree-search-summary">
              {t(locale, 'fileTree.searchBackpressure', { count: droppedChunks })}
            </p>
          ) : null}

          {workspaceId && query.trim() ? (
            <ul className="file-search-results">
              {mode === 'file'
                ? fileMatches.map((entry) => {
                    const visual = resolveFileVisual(entry.path, 'file')
                    const EntryIcon = visual.icon
                    return (
                      <li key={entry.path}>
                        <button
                          type="button"
                          onClick={() => handleSelectFile(entry.path)}
                          title={entry.path}
                          className="file-search-result-btn"
                        >
                          <span className={`file-search-result-icon file-search-result-icon--${visual.kind}`}>
                            <EntryIcon className="vb-icon" aria-hidden="true" />
                          </span>
                          <span className="file-search-result-text">
                            <strong>{entry.name}</strong>
                            <span>{entry.path}</span>
                          </span>
                          {visual.badge ? (
                            <span className="file-search-result-badge">{visual.badge}</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })
                : contentMatches.map((match) => {
                    const visual = resolveFileVisual(match.path, 'file')
                    const MatchIcon = visual.icon
                    return (
                      <li key={`${match.path}:${match.line}:${match.preview}`}>
                        <button
                          type="button"
                          onClick={() => handleSelectFile(match.path, match.line)}
                          title={match.path}
                          className="file-search-result-btn"
                        >
                          <span className={`file-search-result-icon file-search-result-icon--${visual.kind}`}>
                            <MatchIcon className="vb-icon" aria-hidden="true" />
                          </span>
                          <span className="file-search-result-text">
                            <strong>
                              {match.path}:{match.line}
                            </strong>
                            <span>{match.preview}</span>
                          </span>
                          {visual.badge ? (
                            <span className="file-search-result-badge">{visual.badge}</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
              {!loading && activeResults.length === 0 ? (
                <li className="file-tree-search-empty">{t(locale, 'fileTree.searchNoResults')}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  )
}
