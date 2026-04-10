import { memo, useMemo, useState, useCallback } from 'react'
import { GripHorizontal } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
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
  onReorderStations?: (orderedIds: string[]) => void
}

interface SortableRowProps {
  locale: Locale
  station: AgentStation
  active: boolean
  showDragHandle: boolean
  onSelectStation: (stationId: string) => void
  onEditStation: (station: AgentStation) => void
}

function roleLabel(locale: Locale, station: AgentStation): string {
  switch (station.role) {
    case 'orchestrator':
      return t(locale, 'station.role.orchestrator')
    case 'analyst':
      return t(locale, 'station.role.analyst')
    case 'generator':
      return t(locale, 'station.role.generator')
    case 'evaluator':
      return t(locale, 'station.role.evaluator')
    default:
      return station.roleName || station.role
  }
}

const SortableRow = memo(function SortableRow({
  locale,
  station,
  active,
  showDragHandle,
  onSelectStation,
  onEditStation,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: station.id })

  const style = transform
    ? {
      transform: `translate3d(0, ${transform.y}px, 0)`,
      transition,
    }
    : { transition }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'station-overview-row',
        active && 'active',
        isDragging && 'station-overview-row--dragging',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelectStation(station.id)}
    >
      {showDragHandle && (
        <span
          className="station-overview-drag-handle"
          aria-hidden="true"
          {...attributes}
          {...listeners}
        >
          <GripHorizontal className="vb-icon" strokeWidth={1.75} />
        </span>
      )}
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
  onReorderStations,
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
  const canDrag = !!onReorderStations

  // Local order state for optimistic reordering
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const orderedStations = useMemo(() => {
    if (!localOrder) return filteredStations
    const stationMap = new Map(filteredStations.map((s) => [s.id, s]))
    const reordered = localOrder
      .map((id) => stationMap.get(id))
      .filter((s): s is AgentStation => s !== null)
    const remaining = filteredStations.filter((s) => !localOrder.includes(s.id))
    return [...reordered, ...remaining]
  }, [localOrder, filteredStations])

  const sensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: 4,
    },
  })

  const sensors = useSensors(sensor)

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !onReorderStations) {
        setLocalOrder(null)
        return
      }

      const currentIds = orderedStations.map((s) => s.id)
      const oldIndex = currentIds.indexOf(String(active.id))
      const newIndex = currentIds.indexOf(String(over.id))

      if (oldIndex === -1 || newIndex === -1) {
        setLocalOrder(null)
        return
      }

      const reordered = arrayMove(currentIds, oldIndex, newIndex)
      setLocalOrder(reordered)
      onReorderStations(reordered)
    },
    [onReorderStations, orderedStations],
  )

  const handleDragCancel = useCallback(() => {
    setLocalOrder(null)
  }, [])

  const stationIds = useMemo(
    () => orderedStations.map((s) => s.id),
    [orderedStations],
  )

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

      {canDrag ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={stationIds} strategy={verticalListSortingStrategy}>
            <ul className="station-overview-list">
              {orderedStations.map((station) => (
                <SortableRow
                  key={station.id}
                  locale={locale}
                  station={station}
                  active={station.id === activeStationId}
                  showDragHandle
                  onSelectStation={onSelectStation}
                  onEditStation={onEditStation}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="station-overview-list">
          {orderedStations.map((station) => (
            <li
              key={station.id}
              className={[
                'station-overview-row',
                station.id === activeStationId && 'active',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectStation(station.id)}
            >
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
                aria-label={localeIsZh ? '编辑角色' : 'Edit Role'}
                title={localeIsZh ? '编辑角色' : 'Edit Role'}
              >
                <AppIcon name="user-pen" className="vb-icon" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
