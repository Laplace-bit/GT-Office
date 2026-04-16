import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { t, type Locale } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import './WorkspaceCloseDialog.scss'

interface WorkspaceCloseDialogProps {
  open: boolean
  locale: Locale
  workspaceName?: string
  workspacePath: string
  activeTerminalCount: number
  onClose: () => void
  onConfirm: () => void
  submitting?: boolean
}

export function WorkspaceCloseDialog({
  open,
  locale,
  workspaceName,
  workspacePath,
  activeTerminalCount,
  onClose,
  onConfirm,
  submitting = false,
}: WorkspaceCloseDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      // Auto-focus cancel button on open for keyboard users
      const timer = setTimeout(() => {
        cancelButtonRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (submitting) return
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [submitting, onClose],
  )

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.stopPropagation()
        onClose()
      }
    },
    [submitting, onClose],
  )

  if (!open) return null

  const hasTerminals = activeTerminalCount > 0

  return (
    <div
      className="workspace-close-dialog-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="workspace-close-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'workspaceTab.closeConfirm.title')}
      >
        <div className="workspace-close-dialog-header">
          <AppIcon name="info" className="workspace-close-dialog-icon" aria-hidden="true" />
          <h3 className="workspace-close-dialog-title">
            {workspaceName
              ? `${t(locale, 'workspaceTab.closeConfirm.title')} — ${workspaceName}`
              : t(locale, 'workspaceTab.closeConfirm.title')}
          </h3>
        </div>

        <div className="workspace-close-dialog-body">
          <p className="workspace-close-dialog-message">
            {t(locale, 'workspaceTab.closeConfirm.message')}
          </p>
          <div className="workspace-close-dialog-path" title={workspacePath}>
            {workspacePath}
          </div>
          {hasTerminals && (
            <div className="workspace-close-dialog-warning">
              <AppIcon name="terminal" className="workspace-close-dialog-warning-icon" aria-hidden="true" />
              <span>
                {t(locale, 'workspaceTab.closeConfirm.terminalWarning', { count: String(activeTerminalCount) })}
              </span>
            </div>
          )}
        </div>

        <div className="workspace-close-dialog-footer">
          <button
            ref={cancelButtonRef}
            type="button"
            className="workspace-close-dialog-btn workspace-close-dialog-btn-cancel"
            onClick={onClose}
            disabled={submitting}
          >
            {t(locale, 'workspaceTab.closeConfirm.cancel')}
          </button>
          <button
            type="button"
            className="workspace-close-dialog-btn workspace-close-dialog-btn-danger"
            onClick={onConfirm}
            disabled={submitting}
          >
            {t(locale, 'workspaceTab.closeConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}