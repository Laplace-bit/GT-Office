import { memo, type ReactNode } from 'react'
import { AppIcon } from '@shell/ui/icons'

interface GitSectionHeaderProps {
  title: string
  count?: number
  countLabel?: string
  countVariant?: 'default' | 'tag'
  collapsed?: boolean
  onToggle?: () => void
  actions?: ReactNode
}

export const GitSectionHeader = memo(function GitSectionHeader({
  title,
  count,
  countLabel,
  countVariant = 'default',
  collapsed,
  onToggle,
  actions,
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
        <span
          className={`git-section-header__count ${countVariant === 'tag' ? 'git-section-header__count--tag' : ''}`}
        >
          {count}
          {countLabel ? ` ${countLabel}` : ''}
        </span>
      )}
      {actions ? (
        <div
          className="git-section-header__actions"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
})
