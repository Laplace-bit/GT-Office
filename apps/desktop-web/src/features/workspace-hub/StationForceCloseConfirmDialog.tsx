import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import './StationForceCloseConfirmDialog.scss'

interface StationForceCloseConfirmDialogProps {
  open: boolean
  locale: Locale
  stationName: string
  onClose: () => void
  onConfirm: () => void
}

export function StationForceCloseConfirmDialog({
  open,
  locale,
  stationName,
  onClose,
  onConfirm,
}: StationForceCloseConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        cancelButtonRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose],
  )

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose],
  )

  if (!open) return null

  return (
    <div
      className="station-force-close-dialog-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="station-force-close-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'terminal.forceClose.confirmTitle')}
      >
        <div className="station-force-close-dialog-header">
          <AppIcon name="info" className="station-force-close-dialog-icon" aria-hidden="true" />
          <h3 className="station-force-close-dialog-title">
            {t(locale, 'terminal.forceClose.confirmTitle')}
          </h3>
        </div>

        <div className="station-force-close-dialog-body">
          <p className="station-force-close-dialog-message">
            {t(locale, 'terminal.forceClose.confirmMessage', { name: stationName })}
          </p>
        </div>

        <div className="station-force-close-dialog-footer">
          <button
            ref={cancelButtonRef}
            type="button"
            className="station-force-close-dialog-btn station-force-close-dialog-btn-cancel"
            onClick={onClose}
          >
            {t(locale, 'terminal.forceClose.confirmCancel')}
          </button>
          <button
            type="button"
            className="station-force-close-dialog-btn station-force-close-dialog-btn-danger"
            onClick={onConfirm}
          >
            {t(locale, 'terminal.forceClose.confirmAction')}
          </button>
        </div>
      </div>
    </div>
  )
}