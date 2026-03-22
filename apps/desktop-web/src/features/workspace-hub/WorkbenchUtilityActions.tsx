import { memo } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

interface WorkbenchUtilityActionsProps {
  locale: Locale
  onOpenStationSearch?: () => void
  onOpenStationManage?: () => void
  onCreateContainer?: () => void
  variant?: 'header' | 'empty'
}

function WorkbenchUtilityActionsView({
  locale,
  onOpenStationSearch,
  onOpenStationManage,
  onCreateContainer,
  variant = 'empty',
}: WorkbenchUtilityActionsProps) {
  const isHeader = variant === 'header'
  return (
    <div
      className={['canvas-utility-actions', isHeader ? 'is-header' : 'is-empty'].join(' ')}
      role="toolbar"
      aria-label={t(locale, 'workbench.title')}
    >
      {onOpenStationSearch ? (
        <button
          type="button"
          className={isHeader ? 'canvas-header-icon-button' : 'canvas-utility-action'}
          onClick={onOpenStationSearch}
          aria-label={t(locale, 'station.filter.search')}
          title={t(locale, 'station.filter.search')}
        >
          <AppIcon name="search" className="vb-icon vb-icon-overview" aria-hidden="true" />
          {isHeader ? null : <span>{t(locale, 'station.filter.search')}</span>}
        </button>
      ) : null}
      {onOpenStationManage ? (
        <button
          type="button"
          className={isHeader ? 'canvas-header-icon-button' : 'canvas-utility-action'}
          onClick={onOpenStationManage}
          aria-label={t(locale, 'workbench.addStation')}
          title={t(locale, 'workbench.addStation')}
        >
          <AppIcon name="user-pen" className="vb-icon vb-icon-overview" aria-hidden="true" />
          {isHeader ? null : <span>{t(locale, 'workbench.addStation')}</span>}
        </button>
      ) : null}
      {onCreateContainer ? (
        <button
          type="button"
          className={isHeader ? 'canvas-header-icon-button' : 'canvas-utility-action'}
          onClick={onCreateContainer}
          aria-label={t(locale, 'workbench.addContainer')}
          title={t(locale, 'workbench.addContainer')}
        >
          <AppIcon name="copy" className="vb-icon vb-icon-overview" aria-hidden="true" />
          {isHeader ? null : <span>{t(locale, 'workbench.addContainer')}</span>}
        </button>
      ) : null}
    </div>
  )
}

export const WorkbenchUtilityActions = memo(WorkbenchUtilityActionsView)
