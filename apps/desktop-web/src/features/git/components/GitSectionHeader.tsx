import { memo } from 'react'
import { AppIcon } from '@shell/ui/icons'

interface GitSectionHeaderProps {
  title: string
  count?: number
  countLabel?: string
  collapsed?: boolean
  onToggle?: () => void
}

export const GitSectionHeader = memo(function GitSectionHeader({
  title,
  count,
  countLabel,
  collapsed,
  onToggle,
}: GitSectionHeaderProps) {
  return (
    <header className="git-section-header" onClick={onToggle}>
      {onToggle && (
        <AppIcon
          name={collapsed ? 'chevron-right' : 'chevron-down'}
          className="git-section-header__toggle"
        />
      )}
      <strong className="git-section-header__title">{title}</strong>
      {count !== undefined && (
        <span className="git-section-header__count">
          {count} {countLabel}
        </span>
      )}
    </header>
  )
})
