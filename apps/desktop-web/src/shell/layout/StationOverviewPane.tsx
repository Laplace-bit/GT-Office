import { memo, useMemo, useState } from 'react'
import type { AgentStation, StationRole } from './model'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import {
  buildOrganizationSnapshot,
  defaultStationOverviewState,
  filterStationsForOverview,
  organizationDepartmentOrder,
  type OrganizationDepartment,
  type StationOverviewState,
} from '@features/workspace'

interface StationOverviewPaneProps {
  locale: Locale
  stations: AgentStation[]
  activeStationId: string
  runtimeStateByStationId: Record<string, string>
  view: StationOverviewState
  onViewChange: (patch: Partial<StationOverviewState>) => void
  onSelectStation: (stationId: string) => void
  onOpenManageModal: () => void
  onRemoveStation: (stationId: string) => void
}

interface StationOverviewRowProps {
  locale: Locale
  station: AgentStation
  active: boolean
  onSelectStation: (stationId: string) => void
  onRemoveStation: (stationId: string) => void
}

const roleOptions: StationRole[] = ['manager', 'product', 'build', 'quality_release']

const roleKeyMap: Record<
  StationRole,
  | 'station.role.manager'
  | 'station.role.product'
  | 'station.role.build'
  | 'station.role.quality_release'
> = {
  manager: 'station.role.manager',
  product: 'station.role.product',
  build: 'station.role.build',
  quality_release: 'station.role.quality_release',
}

const departmentKeyMap: Record<
  OrganizationDepartment,
  | 'station.department.leadership'
  | 'station.department.product_management'
  | 'station.department.delivery_engineering'
  | 'station.department.quality_release'
> = {
  leadership: 'station.department.leadership',
  product_management: 'station.department.product_management',
  delivery_engineering: 'station.department.delivery_engineering',
  quality_release: 'station.department.quality_release',
}


function roleLabel(locale: Locale, role: StationRole): string {
  return t(locale, roleKeyMap[role])
}

function departmentLabel(locale: Locale, department: OrganizationDepartment): string {
  return t(locale, departmentKeyMap[department])
}



const StationOverviewRow = memo(function StationOverviewRow({
  locale,
  station,
  active,
  onSelectStation,
  onRemoveStation,
}: StationOverviewRowProps) {
  return (
    <li className={active ? 'station-overview-row active' : 'station-overview-row'}>
      <button
        type="button"
        className="station-overview-select"
        onClick={() => onSelectStation(station.id)}
      >
        <strong>{station.name}</strong>
        <span>{station.agentWorkdirRel}</span>
      </button>
      <div className="station-overview-row-actions">
        <button
          type="button"
          className="station-overview-remove"
          onClick={() => onRemoveStation(station.id)}
          aria-label={t(locale, 'workbench.removeStation')}
          title={t(locale, 'workbench.removeStation')}
        >
          <AppIcon name="close" className="vb-icon vb-icon-overview" aria-hidden="true" />
        </button>
      </div>
    </li>
  )
})

export function StationOverviewPane({
  locale,
  stations,
  activeStationId,
  runtimeStateByStationId,
  view,
  onViewChange,
  onSelectStation,
  onOpenManageModal,
  onRemoveStation,
}: StationOverviewPaneProps) {
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const snapshot = useMemo(
    () => buildOrganizationSnapshot(stations, runtimeStateByStationId),
    [runtimeStateByStationId, stations],
  )
  const filteredStations = useMemo(
    () => filterStationsForOverview(stations, runtimeStateByStationId, view),
    [runtimeStateByStationId, stations, view],
  )

  const localeIsZh = locale === 'zh-CN'

  return (
    <aside className="panel station-overview-pane">
      <header className="station-overview-header">
        <div>
          <h2>{t(locale, 'station.overview.title')}</h2>
          <p>{t(locale, 'station.overview.subtitle')}</p>
        </div>
        <button
          type="button"
          className="station-overview-toggle"
          onClick={onOpenManageModal}
          aria-label={t(locale, 'workbench.addStation')}
          title={t(locale, 'workbench.addStation')}
        >
          <AppIcon name="plus" className="vb-icon vb-icon-overview-toggle" aria-hidden="true" />
        </button>
      </header>

      <section className="station-overview-metrics" aria-label={localeIsZh ? '角色状态概览' : 'Role status overview'}>
        <article>
          <strong>{snapshot.total}</strong>
          <span>{t(locale, 'station.metrics.total')}</span>
        </article>
        <article>
          <strong>{snapshot.running}</strong>
          <span>{t(locale, 'station.metrics.running')}</span>
        </article>
        <article>
          <strong>{snapshot.blocked}</strong>
          <span>{t(locale, 'station.metrics.blocked')}</span>
        </article>
        <article>
          <strong>{snapshot.idle}</strong>
          <span>{t(locale, 'station.metrics.idle')}</span>
        </article>
      </section>

      <section className="station-overview-section">
        <button
          type="button"
          className="station-overview-section-toggle"
          onClick={() => setFiltersExpanded((prev) => !prev)}
          aria-expanded={filtersExpanded}
          aria-controls="station-overview-filters"
        >
          <span>{localeIsZh ? '角色筛选' : 'Role Filters'}</span>
          <small>{localeIsZh ? '仅管理维度' : 'Management only'}</small>
          <AppIcon
            name="chevron-right"
            className="vb-icon vb-icon-overview-toggle"
            aria-hidden="true"
          />
        </button>

        <div className={filtersExpanded ? 'station-overview-collapsible expanded' : 'station-overview-collapsible'}>
          <section id="station-overview-filters" className="station-overview-filters">
            <label>
              {t(locale, 'station.filter.role')}
              <select
                value={view.roleFilter}
                onChange={(event) => onViewChange({ roleFilter: event.target.value as StationRole | 'all' })}
              >
                <option value="all">{t(locale, 'station.filter.allRoles')}</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(locale, role)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t(locale, 'station.filter.department')}
              <select
                value={view.departmentFilter}
                onChange={(event) =>
                  onViewChange({
                    departmentFilter: event.target.value as OrganizationDepartment | 'all',
                  })
                }
              >
                <option value="all">{t(locale, 'station.filter.allDepartments')}</option>
                {organizationDepartmentOrder.map((department) => (
                  <option key={department} value={department}>
                    {departmentLabel(locale, department)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                onViewChange(defaultStationOverviewState)
              }}
            >
              {t(locale, 'station.filter.reset')}
            </button>
          </section>
        </div>
      </section>

      <ul className="station-overview-list">
        {filteredStations.map((station) => (
          <StationOverviewRow
            key={station.id}
            locale={locale}
            station={station}
            active={station.id === activeStationId}
            onSelectStation={onSelectStation}
            onRemoveStation={onRemoveStation}
          />
        ))}
      </ul>
    </aside>
  )
}
