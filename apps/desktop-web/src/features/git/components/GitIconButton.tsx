import { memo } from 'react'
import { AppIcon, type AppIconName } from '@shell/ui/icons'

export interface GitIconButtonProps {
  icon: AppIconName
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'success' | 'danger'
  size?: 'sm' | 'md'
  showLabel?: boolean
  title?: string
}

export const GitIconButton = memo(function GitIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  variant = 'default',
  size = 'md',
  showLabel = false,
  title,
}: GitIconButtonProps) {
  return (
    <button
      type="button"
      className={`git-icon-btn git-icon-btn--${variant} git-icon-btn--${size}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
    >
      <AppIcon name={icon} className="git-icon-btn__icon" />
      {showLabel && <span className="git-icon-btn__label">{label}</span>}
    </button>
  )
})
