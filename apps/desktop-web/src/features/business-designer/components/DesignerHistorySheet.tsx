import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { t, type Locale, type TranslationKey } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerDiffEntry } from '../model/designer-document'
import type { UseDesignerHistoryResult } from '../controllers/useDesignerHistory'

interface DesignerHistorySheetProps {
  locale: Locale
  history: UseDesignerHistoryResult
}

function statusLabel(locale: Locale, status: string): string {
  switch (status) {
    case 'added':
      return t(locale, 'designer.history.statusAdded')
    case 'modified':
      return t(locale, 'designer.history.statusModified')
    case 'deleted':
      return t(locale, 'designer.history.statusDeleted')
    case 'renamed':
      return t(locale, 'designer.history.statusRenamed')
    case 'untracked':
      return t(locale, 'designer.history.statusUntracked')
    default:
      return status
  }
}

function entryIcon(status: string): TranslationKey {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'designer.history.statusAdded'
    case 'deleted':
      return 'designer.history.statusDeleted'
    case 'renamed':
      return 'designer.history.statusRenamed'
    default:
      return 'designer.history.statusModified'
  }
}

/** A compact, native-feel checkpoint history + diff panel. Lists recent docs
 * repo checkpoints, lets the user compare a base commit against the working
 * tree (default) or against another checkpoint, and shows the structured diff. */
export function DesignerHistorySheet({ locale, history }: DesignerHistorySheetProps) {
  const { isOpen, close, entries, loading, error, diff, diffLoading } = history
  const panelRef = useRef<HTMLDivElement>(null)
  const modeGroupRef = useRef<HTMLDivElement>(null)

  // Close on Escape — Escape always does something meaningful (native feel).
  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [isOpen, close])

  const sortedEntries = useMemo(() => entries, [entries])
  const diffEntries: DesignerDiffEntry[] = diff?.entries ?? []
  const canCompare =
    history.mode === 'checkpoints'
      ? Boolean(history.baseCommit && history.headCommit)
      : true

  const setHistoryMode = (mode: UseDesignerHistoryResult['mode']) => {
    history.setMode(mode)
    window.requestAnimationFrame(() => {
      modeGroupRef.current
        ?.querySelector<HTMLButtonElement>(`[data-history-mode="${mode}"]`)
        ?.focus()
    })
  }

  const handleModeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return
    }
    event.preventDefault()
    const nextMode =
      event.key === 'ArrowLeft' || event.key === 'Home'
        ? 'workingTree'
        : 'checkpoints'
    setHistoryMode(nextMode)
  }

  if (!isOpen) {
    return null
  }

  return (
    <section
      className="designer-history-sheet"
      ref={panelRef}
      aria-label={t(locale, 'designer.history.title')}
    >
      <header className="designer-history-header">
        <div className="designer-history-heading">
          <AppIcon name="clock" aria-hidden="true" />
          <span>{t(locale, 'designer.history.title')}</span>
        </div>
        <button
          type="button"
          className="designer-icon-button"
          onClick={close}
          aria-label={t(locale, 'designer.history.close')}
        >
          <AppIcon name="x-mark" aria-hidden="true" />
        </button>
      </header>

      <div
        className="designer-history-mode"
        role="radiogroup"
        aria-label={t(locale, 'designer.history.mode')}
        ref={modeGroupRef}
        onKeyDown={handleModeKeyDown}
      >
        <button
          type="button"
          role="radio"
          aria-checked={history.mode === 'workingTree'}
          data-history-mode="workingTree"
          className={`designer-history-mode-option ${history.mode === 'workingTree' ? 'is-active' : ''}`}
          onClick={() => setHistoryMode('workingTree')}
        >
          {t(locale, 'designer.history.modeWorkingTree')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={history.mode === 'checkpoints'}
          data-history-mode="checkpoints"
          className={`designer-history-mode-option ${history.mode === 'checkpoints' ? 'is-active' : ''}`}
          onClick={() => setHistoryMode('checkpoints')}
        >
          {t(locale, 'designer.history.modeCheckpoints')}
        </button>
      </div>

      {loading ? (
        <p className="designer-history-empty">{t(locale, 'designer.loading')}</p>
      ) : sortedEntries.length === 0 ? (
        <p className="designer-history-empty">{t(locale, 'designer.history.empty')}</p>
      ) : (
        <div className="designer-history-selectors">
          <label className="designer-history-field">
            <span className="designer-history-field-label">{t(locale, 'designer.history.base')}</span>
            <select
              className="designer-history-select"
              value={history.baseCommit ?? ''}
              onChange={(event) => history.setBaseCommit(event.target.value || null)}
            >
              {sortedEntries.map((entry) => (
                <option key={entry.commit} value={entry.commit}>
                  {entry.shortCommit} — {entry.summary}
                </option>
              ))}
            </select>
          </label>
          {history.mode === 'checkpoints' ? (
            <label className="designer-history-field">
              <span className="designer-history-field-label">{t(locale, 'designer.history.head')}</span>
              <select
                className="designer-history-select"
                value={history.headCommit ?? ''}
                onChange={(event) => history.setHeadCommit(event.target.value || null)}
              >
                <option value="">{t(locale, 'designer.history.headPlaceholder')}</option>
                {sortedEntries.map((entry) => (
                  <option key={entry.commit} value={entry.commit}>
                    {entry.shortCommit} — {entry.summary}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      )}

      <div className="designer-history-actions">
        <button
          type="button"
          className="designer-tool-button designer-tool-button--accent designer-history-compare"
          onClick={() => {
            void history.runDiff()
          }}
          disabled={!canCompare || diffLoading || sortedEntries.length === 0}
        >
          <AppIcon name="refresh" aria-hidden="true" />
          <span>{diffLoading ? t(locale, 'designer.history.comparing') : t(locale, 'designer.history.compare')}</span>
        </button>
      </div>

      {error ? <p className="designer-history-error">{error}</p> : null}

      {diff ? (
        diffEntries.length === 0 ? (
          <p className="designer-history-empty">{t(locale, 'designer.history.noChanges')}</p>
        ) : (
          <ul className="designer-history-diff" role="list">
            {diffEntries.map((entry, index) => {
              const labelKey = entryIcon(entry.status)
              return (
                <li
                  key={`${entry.status}:${entry.path}:${index}`}
                  className={`designer-history-diff-item is-${entry.status}`}
                >
                  <span className="designer-history-diff-status">{t(locale, labelKey)}</span>
                  <span className="designer-history-diff-path" title={entry.path}>
                    {entry.path}
                  </span>
                  <span className="designer-history-diff-label">{statusLabel(locale, entry.status)}</span>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
    </section>
  )
}
