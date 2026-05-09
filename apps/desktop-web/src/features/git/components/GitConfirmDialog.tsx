import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import { getFileName, type GitDiscardKind } from './git-helpers'

interface GitConfirmDialogProps {
  locale: 'zh-CN' | 'en-US'
  path: string
  discardKind: GitDiscardKind
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}

export const GitConfirmDialog = memo(function GitConfirmDialog({
  locale,
  path,
  discardKind,
  loading,
  onClose,
  onConfirm,
}: GitConfirmDialogProps) {
  const fileName = getFileName(path)
  const titleKey =
    discardKind === 'untracked'
      ? 'git.confirm.discardUntrackedTitle'
      : discardKind === 'index-new'
        ? 'git.confirm.discardIndexNewTitle'
        : 'git.confirm.discardTitle'
  const bodyKey =
    discardKind === 'untracked'
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
          <p>{t(locale, bodyKey)}</p>
          <div className="git-confirm-modal__path-card" title={path}>
            <strong className="git-confirm-modal__path-name">{fileName}</strong>
          </div>
        </div>
        <footer className="git-confirm-modal__footer">
          <button type="button" className="v-btn v-btn-secondary" onClick={onClose} disabled={loading}>
            {t(locale, 'git.action.cancel')}
          </button>
          <button
            type="button"
            className="v-btn v-btn-danger git-confirm-modal__danger-btn"
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
