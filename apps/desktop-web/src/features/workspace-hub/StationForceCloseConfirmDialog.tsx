import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { trapModalTabFocus } from '@/components/modal/modal-focus-trap'
import { createStationTerminalFrameFlushScheduler } from '../terminal/station-terminal-frame-flush-scheduler'
import { scheduleStationModalFocusFrame } from './station-modal-focus-frame'
import './StationForceCloseConfirmDialog.scss'

const STATION_FORCE_CLOSE_DIALOG_FOCUS_FALLBACK_DELAY_MS = 48

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      const focusFrame = scheduleStationModalFocusFrame({
        scheduler: createStationTerminalFrameFlushScheduler(window),
        fallbackDelayMs: STATION_FORCE_CLOSE_DIALOG_FOCUS_FALLBACK_DELAY_MS,
        focus: () => {
          cancelButtonRef.current?.focus()
        },
      })
      return focusFrame.cancel
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
      if (e.key !== 'Escape' && e.key !== 'Tab') {
        return
      }
      if (e.nativeEvent.isComposing) {
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      const dialog = dialogRef.current
      if (!dialog) {
        return
      }
      e.stopPropagation()
      trapModalTabFocus(e.nativeEvent, dialog)
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
        ref={dialogRef}
        className="station-force-close-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="station-force-close-dialog-title"
        aria-describedby="station-force-close-dialog-message"
      >
        <div className="station-force-close-dialog-header">
          <AppIcon name="info" className="station-force-close-dialog-icon" aria-hidden="true" />
          <h3 id="station-force-close-dialog-title" className="station-force-close-dialog-title">
            {t(locale, 'terminal.forceClose.confirmTitle')}
          </h3>
        </div>

        <div className="station-force-close-dialog-body">
          <p id="station-force-close-dialog-message" className="station-force-close-dialog-message">
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
