import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { getFileName, type GitDiscardKind } from './git-helpers'

interface GitConfirmDialogProps {
  locale: 'zh-CN' | 'en-US'
  path?: string
  discardKind?: GitDiscardKind
  bulkCount?: number
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}

export const GitConfirmDialog = memo(function GitConfirmDialog({
  locale,
  path,
  discardKind,
  bulkCount,
  loading,
  onClose,
  onConfirm,
}: GitConfirmDialogProps) {
  const isBulkDiscard = typeof bulkCount === 'number'
  const fileName = path ? getFileName(path) : ''
  const titleKey = isBulkDiscard
    ? 'git.confirm.discardAllTitle'
    : discardKind === 'untracked'
      ? 'git.confirm.discardUntrackedTitle'
      : discardKind === 'index-new'
        ? 'git.confirm.discardIndexNewTitle'
        : 'git.confirm.discardTitle'
  const bodyKey = isBulkDiscard
    ? 'git.confirm.discardAllBody'
    : discardKind === 'untracked'
      ? 'git.confirm.discardUntrackedBody'
      : discardKind === 'index-new'
        ? 'git.confirm.discardIndexNewBody'
        : 'git.confirm.discardTrackedBody'
  return (
    <div className="git-confirm-modal-overlay" onClick={loading ? undefined : onClose}>
      <section
        className="git-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-discard-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="git-confirm-modal__header">
          <span className="git-confirm-modal__eyebrow">{t(locale, 'git.confirm.discardEyebrow')}</span>
          <h3 id="git-discard-confirm-title">{t(locale, titleKey)}</h3>
        </header>
        <div className="git-confirm-modal__body">
          <p>{isBulkDiscard ? t(locale, bodyKey, { count: bulkCount }) : t(locale, bodyKey)}</p>
          {isBulkDiscard ? (
            <div className="git-confirm-modal__path-card">
              <strong className="git-confirm-modal__path-name">{t(locale, 'git.files.count', { count: bulkCount })}</strong>
            </div>
          ) : path ? (
            <div className="git-confirm-modal__path-card" title={path}>
              <strong className="git-confirm-modal__path-name">{fileName}</strong>
            </div>
          ) : null}
        </div>
        <footer className="git-confirm-modal__footer">
          <button type="button" className="gto-btn gto-btn--secondary" onClick={onClose} disabled={loading}>
            {t(locale, 'git.action.cancel')}
          </button>
          <button
            type="button"
            className="gto-btn gto-btn--danger git-confirm-modal__danger-btn"
            onClick={onConfirm}
            disabled={loading}
          >
            <span className="git-confirm-modal__danger-signal" aria-hidden="true" />
            {t(locale, 'git.action.discard')}
          </button>
        </footer>
      </section>
    </div>
  )
})
