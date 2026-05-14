import { memo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon, type AppIconName } from '@shell/ui/icons'

interface GitFeatureDialogProps {
  open: boolean
  onClose: () => void
  title: string
  icon: AppIconName
  locale: Locale
  children: ReactNode
}

export const GitFeatureDialog = memo(function GitFeatureDialog({
  open,
  onClose,
  title,
  icon,
  locale,
  children,
}: GitFeatureDialogProps) {
  if (!open) return null

  return createPortal(
    <div className="git-feature-dialog-overlay" onClick={onClose}>
      <section
        className="git-feature-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="git-feature-dialog__header">
          <AppIcon name={icon} className="git-feature-dialog__icon" />
          <h2 className="git-feature-dialog__title">{title}</h2>
          <button
            type="button"
            className="git-feature-dialog__close"
            onClick={onClose}
            aria-label={t(locale, 'git.dialog.close')}
            title={t(locale, 'git.dialog.close')}
          >
            <AppIcon name="close" className="git-feature-dialog__close-icon" />
          </button>
        </header>
        <div className="git-feature-dialog__body">{children}</div>
      </section>
    </div>,
    document.body,
  )
})