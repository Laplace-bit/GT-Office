import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@shell/ui/icons'
import './AiConfigOverlay.scss'

interface AiConfigOverlayProps {
  title: string
  subtitle?: string
  children: ReactNode
  leftAction?: ReactNode
  rightAction?: ReactNode
  footer?: ReactNode
  onClose: () => void
}

export function AiConfigOverlay({
  title,
  subtitle,
  children,
  leftAction,
  rightAction,
  footer,
  onClose,
}: AiConfigOverlayProps) {
  const content = (
    <div className="ai-config-overlay-backdrop" onClick={onClose}>
      <div className="ai-config-overlay-container" onClick={(e) => e.stopPropagation()}>
        <header className="ai-config-overlay-header">
          <div className="header-info">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">
            <AppIcon name="close" />
          </button>
        </header>

        <div className="ai-config-overlay-main">
          {leftAction && (
            <div className="ai-config-side-action is-left">{leftAction}</div>
          )}

          <div className="ai-config-overlay-body">{children}</div>

          {rightAction && (
            <div className="ai-config-side-action is-right">{rightAction}</div>
          )}
        </div>

        {footer && <div className="ai-config-overlay-footer">{footer}</div>}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
