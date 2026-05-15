import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { Locale } from '@shell/i18n/ui-locale'

export interface MergeConflictFile {
  path: string
  status: string
}

interface MergeConflictPanelProps {
  conflicts: MergeConflictFile[]
  onResolve: (path: string, side: 'ours' | 'theirs') => void
  onContinue: () => void
  onAbort: () => void
  locale: Locale
}

export const MergeConflictPanel = memo(function MergeConflictPanel({
  conflicts,
  onResolve,
  onContinue,
  onAbort,
  locale,
}: MergeConflictPanelProps) {
  return (
    <div className="git-merge-conflict-panel">
      <div className="git-merge-conflict-header">
        <span className="git-merge-conflict-title">{t(locale, 'git.merge.conflicts')}</span>
        <span className="git-merge-conflict-count">
          {conflicts.length} {conflicts.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      <div className="git-merge-conflict-files">
        {conflicts.map((file) => (
          <div key={file.path} className="git-merge-conflict-file">
            <span className={`conflict-status conflict-status--${file.status.toLowerCase()}`}>
              {file.status}
            </span>
            <span className="conflict-path">{file.path}</span>
            <div className="git-merge-conflict-resolve-actions">
              <button
                type="button"
                className="git-icon-btn"
                onClick={() => onResolve(file.path, 'ours')}
              >
                {t(locale, 'git.merge.acceptOurs')}
              </button>
              <button
                type="button"
                className="git-icon-btn"
                onClick={() => onResolve(file.path, 'theirs')}
              >
                {t(locale, 'git.merge.acceptTheirs')}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="git-merge-conflict-actions">
        <button
          type="button"
          className="git-merge-continue-btn git-icon-btn git-icon-btn--success"
          onClick={onContinue}
          disabled={conflicts.length > 0}
        >
          {t(locale, 'git.merge.continue')}
        </button>
        <button
          type="button"
          className="git-merge-abort-btn git-icon-btn git-icon-btn--danger"
          onClick={onAbort}
        >
          {t(locale, 'git.merge.abort')}
        </button>
      </div>
      <p className="git-merge-conflict-hint">
        Resolve conflicts in your editor, then stage the resolved files. Click &quot;Continue
        Merge&quot; when all conflicts are resolved.
      </p>
    </div>
  )
})
