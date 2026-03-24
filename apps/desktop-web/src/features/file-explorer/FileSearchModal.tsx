import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { FsEntry, FsSearchMatch } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { resolveFileVisual } from './file-visuals'
import './FileSearchModal.scss'

interface FileSearchModalProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  mode: 'file' | 'content'
  query: string
  fileMatches: FsEntry[]
  contentMatches: FsSearchMatch[]
  loading: boolean
  error: string | null
  droppedChunks?: number
  onClose: () => void
  onModeChange: (mode: 'file' | 'content') => void
  onQueryChange: (query: string) => void
  onSelectFile: (path: string, line?: number) => void
  onSubmit: () => void
}

export function FileSearchModal({
  open,
  locale,
  workspaceId,
  mode,
  query,
  fileMatches,
  contentMatches,
  loading,
  error,
  droppedChunks = 0,
  onClose,
  onModeChange,
  onQueryChange,
  onSelectFile,
  onSubmit,
}: FileSearchModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) {
        return
      }
      input.focus()
      input.select()
    })
  }, [open, mode])

  const activeResults = useMemo(
    () => (mode === 'file' ? fileMatches : contentMatches),
    [contentMatches, fileMatches, mode],
  )

  if (!open) {
    return null
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className="settings-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
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
          <button type="button" onClick={onClose} aria-label={t(locale, 'settingsModal.close')}>
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
              onClick={() => onModeChange('file')}
            >
              {t(locale, 'fileTree.searchModeFile')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'content'}
              className={`file-search-mode-btn ${mode === 'content' ? 'active' : ''}`}
              onClick={() => onModeChange('content')}
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
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSubmit()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  if (query.trim()) {
                    onQueryChange('')
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
                          onClick={() => onSelectFile(entry.path)}
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
                          onClick={() => onSelectFile(match.path, match.line)}
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
