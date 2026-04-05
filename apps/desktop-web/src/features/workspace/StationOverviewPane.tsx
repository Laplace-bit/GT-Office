import { memo, useMemo } from 'react'
import type { AgentStation, StationRole } from '@features/workspace-hub'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import './StationOverviewPane.scss'
import {
  buildOrganizationSnapshot,
  filterStationsForOverview,
  type StationOverviewState,
} from './station-overview-model'

interface StationOverviewPaneProps {
  locale: Locale
  stations: AgentStation[]
  activeStationId: string
  runtimeStateByStationId: Record<string, string>
  view: StationOverviewState
  onViewChange: (patch: Partial<StationOverviewState>) => void
  onSelectStation: (stationId: string) => void
  onEditStation: (station: AgentStation) => void
}

interface StationOverviewRowProps {
  locale: Locale
  station: AgentStation
  active: boolean
  state: string
  onSelectStation: (stationId: string) => void
  onEditStation: (station: AgentStation) => void
}

function roleLabel(locale: Locale, station: AgentStation): string {
  switch (station.role) {
    case 'manager':
      return t(locale, 'station.role.manager')
    case 'product':
      return t(locale, 'station.role.product')
    case 'build':
      return t(locale, 'station.role.build')
    case 'quality_release':
      return t(locale, 'station.role.quality_release')
    default:
      return station.roleName || station.role
  }
}



const StationOverviewRow = memo(function StationOverviewRow({
  locale,
  station,
  active,
  state,
  onSelectStation,
  onEditStation,
}: StationOverviewRowProps) {
  return (
    <li
      className={active ? 'station-overview-row active' : 'station-overview-row'}
      onClick={() => onSelectStation(station.id)}
    >
      <span
        className="station-overview-state-indicator"
        data-state={state}
        aria-hidden="true"
      />
      <div className="station-overview-select">
        <strong>{station.name}</strong>
        <span>{roleLabel(locale, station)} · {station.agentWorkdirRel}</span>
      </div>
      <button
        type="button"
        className="station-overview-edit"
        onClick={(e) => {
          e.stopPropagation()
          onEditStation(station)
        }}
        aria-label={locale === 'zh-CN' ? '编辑角色' : 'Edit Role'}
        title={locale === 'zh-CN' ? '编辑角色' : 'Edit Role'}
      >
        <AppIcon name="user-pen" className="vb-icon" aria-hidden="true" />
      </button>
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
  onEditStation,
}: StationOverviewPaneProps) {
  const snapshot = useMemo(
    () => buildOrganizationSnapshot(stations, runtimeStateByStationId),
    [runtimeStateByStationId, stations],
  )
  const filteredStations = useMemo(
    () => filterStationsForOverview(stations, runtimeStateByStationId, view),
    [runtimeStateByStationId, stations, view],
  )
  const roleOptions = useMemo(
    () => {
      const roleMap = new Map<StationRole, string>()
      stations.forEach((station) => {
        if (!roleMap.has(station.role)) {
          roleMap.set(station.role, roleLabel(locale, station))
        }
      })
      return [...roleMap.entries()]
    },
    [locale, stations],
  )

  const localeIsZh = locale === 'zh-CN'

  return (
    <aside className="station-overview-pane">
      <section className="station-overview-aggregated-metrics" aria-label={localeIsZh ? '角色状态概览' : 'Role status overview'}>
        <div className="metrics-summary-card">
          <div className="metrics-item">
            <strong>{snapshot.total}</strong>
            <span>{t(locale, 'station.metrics.total')}</span>
          </div>
          <div className="metrics-divider" />
          <div className="metrics-item">
            <strong className="status-running">{snapshot.running}</strong>
            <span>{t(locale, 'station.metrics.running')}</span>
          </div>
          <div className="metrics-divider" />
          <div className="metrics-item">
            <strong className="status-blocked">{snapshot.blocked}</strong>
            <span>{t(locale, 'station.metrics.blocked')}</span>
          </div>
          <div className="metrics-divider" />
          <div className="metrics-item">
            <strong>{snapshot.idle}</strong>
            <span>{t(locale, 'station.metrics.idle')}</span>
          </div>
        </div>
      </section>

      <section className="station-overview-section">
        <section id="station-overview-filters" className="station-overview-filters station-overview-filters--inline">
          <label className="station-overview-inline-filter">
            <span>{localeIsZh ? '角色' : 'Role'}</span>
            <div className="station-overview-inline-filter__select-wrap">
              <select
                value={view.roleFilter}
                onChange={(event) => onViewChange({ roleFilter: event.target.value as StationRole | 'all' })}
              >
                <option value="all">{t(locale, 'station.filter.allRoles')}</option>
                {roleOptions.map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="station-overview-inline-filter__clear"
                aria-label={localeIsZh ? '清除角色筛选' : 'Clear role filter'}
                title={localeIsZh ? '清除角色筛选' : 'Clear role filter'}
                disabled={view.roleFilter === 'all'}
                onClick={() => {
                  onViewChange({ roleFilter: 'all' })
                }}
              >
                ×
              </button>
            </div>
          </label>
        </section>
      </section>

      <ul className="station-overview-list">
        {filteredStations.map((station) => (
          <StationOverviewRow
            key={station.id}
            locale={locale}
            station={station}
            active={station.id === activeStationId}
            state={runtimeStateByStationId[station.id] ?? 'idle'}
            onSelectStation={onSelectStation}
            onEditStation={onEditStation}
          />
        ))}
      </ul>

    </aside>
  )
}
