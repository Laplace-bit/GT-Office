import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  getStationTerminalInterruptShortcut,
  resolveStationTerminalInterruptConfirmKeyAction,
  resolveStationTerminalInterruptSignalKind,
  type StationTerminalInterruptSignalKind,
} from './station-terminal-interrupt-guard'
import './StationTerminalInterruptConfirm.scss'

interface StationTerminalInterruptConfirmProps {
  open: boolean
  locale: Locale
  signalKind: StationTerminalInterruptSignalKind | null
  onClose: () => void
  onConfirm: () => void
  onSignalKindChange?: (signalKind: StationTerminalInterruptSignalKind) => void
}

export function StationTerminalInterruptConfirm({
  open,
  locale,
  signalKind,
  onClose,
  onConfirm,
  onSignalKindChange,
}: StationTerminalInterruptConfirmProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const hintId = useId()

  useEffect(() => {
    if (!open) {
      return
    }
    const timer = window.setTimeout(() => {
      cancelButtonRef.current?.focus()
    }, 32)
    return () => {
      window.clearTimeout(timer)
    }
  }, [open])

  const handleBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation()
      if (event.target === event.currentTarget) {
        onClose()
      }
    },
    [onClose],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const action = resolveStationTerminalInterruptConfirmKeyAction(event, signalKind)
      if (action === 'cancel') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (action === 'confirm') {
        event.preventDefault()
        event.stopPropagation()
        onConfirm()
        return
      }
      const nextSignalKind = resolveStationTerminalInterruptSignalKind(event)
      if (nextSignalKind && nextSignalKind !== signalKind && !event.repeat && onSignalKindChange) {
        event.preventDefault()
        event.stopPropagation()
        onSignalKindChange(nextSignalKind)
      }
    },
    [onClose, onConfirm, onSignalKindChange, signalKind],
  )

  if (!open || !signalKind) {
    return null
  }

  const shortcut = getStationTerminalInterruptShortcut(signalKind)
  const bodyKey =
    signalKind === 'sigtstp'
      ? 'terminal.interruptConfirm.body.suspend'
      : 'terminal.interruptConfirm.body.interrupt'

  return (
    <div
      className="station-terminal-interrupt-confirm-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <section
        className="station-terminal-interrupt-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${bodyId} ${hintId}`}
      >
        <div className="station-terminal-interrupt-confirm__header">
          <AppIcon name="info" className="station-terminal-interrupt-confirm__icon" aria-hidden="true" />
          <h3 id={titleId} className="station-terminal-interrupt-confirm__title">
            {t(locale, 'terminal.interruptConfirm.title', { shortcut })}
          </h3>
        </div>
        <p id={bodyId} className="station-terminal-interrupt-confirm__body">
          {t(locale, bodyKey, { shortcut })}
        </p>
        <p id={hintId} className="station-terminal-interrupt-confirm__hint">
          {t(locale, 'terminal.interruptConfirm.hint', { shortcut })}
        </p>
        <div className="station-terminal-interrupt-confirm__footer">
          <button
            ref={cancelButtonRef}
            type="button"
            className="station-terminal-interrupt-confirm__button station-terminal-interrupt-confirm__button--secondary"
            onClick={onClose}
          >
            {t(locale, 'terminal.interruptConfirm.cancel')}
          </button>
          <button
            type="button"
            className="station-terminal-interrupt-confirm__button station-terminal-interrupt-confirm__button--danger"
            onClick={onConfirm}
          >
            {t(locale, 'terminal.interruptConfirm.confirm', { shortcut })}
          </button>
        </div>
      </section>
    </div>
  )
}
