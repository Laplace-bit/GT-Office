import type { NavItem, NavItemId } from './navigation-model'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import './ActivityRail.scss'

interface ActivityRailProps {
  items: NavItem[]
  activeId: NavItemId
  onSelect: (id: NavItemId) => void
  locale: Locale
}

function activityIconName(id: NavItemId) {
  switch (id) {
    case 'stations':
      return 'stations' as const
    case 'tasks':
      return 'tasks' as const
    case 'files':
      return 'files' as const
    case 'git':
      return 'git' as const
    case 'hooks':
      return 'hooks' as const
    case 'channels':
      return 'channels' as const
    case 'policy':
      return 'policy' as const
    default:
      return null
  }
}

export function ActivityRail({ items, activeId, onSelect, locale }: ActivityRailProps) {
  return (
    <nav className="activity-rail" aria-label={t(locale, 'activityRail.ariaLabel')}>
      {items.map((item) => {
        const iconName = activityIconName(item.id)
        return (
          <button
            key={item.id}
            type="button"
            className={`activity-rail-icon-btn ${item.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            <span className="activity-rail-icon">
              {iconName ? <AppIcon name={iconName} className="vb-icon vb-icon-rail" aria-hidden="true" /> : null}
            </span>
            <span className="sr-only">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
