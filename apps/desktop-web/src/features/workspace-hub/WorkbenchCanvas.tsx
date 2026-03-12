import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Grid2x2, LayoutPanelLeft, type LucideIcon } from 'lucide-react'
import type { AgentStation } from './station-model'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import type { StationTerminalSinkBindingHandler } from '@features/terminal'
import type { RenderedScreenSnapshot } from '@shell/integration/desktop-api'
import { StationCard } from './StationCard'
import { AppIcon } from '@shell/ui/icons'
import type { StationChannelBotBindingSummary } from '@features/tool-adapter'
import './WorkbenchCanvas.scss'

interface StationTerminalRuntime {
  sessionId: string | null
  unreadCount: number
}

export type WorkbenchLayoutMode = 'auto' | 'focus' | 'custom'

export interface WorkbenchCustomLayout {
  columns: number
  rows: number
}

interface WorkbenchLayoutPresetDefinition {
  id: WorkbenchLayoutMode
  labelKey: 'workbench.layoutPreset.auto' | 'workbench.layoutPreset.focus' | 'workbench.layoutPreset.custom'
  icon?: LucideIcon
}

interface WorkbenchCanvasProps {
  locale: Locale
  appearanceVersion: string
  stations: AgentStation[]
  activeStationId: string
  terminalByStation: Record<string, StationTerminalRuntime>
  taskSignalByStationId: Partial<Record<string, StationTaskSignal>>
  channelBotBindingsByStationId?: Record<string, StationChannelBotBindingSummary[]>
  onSelectStation: (stationId: string) => void
  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  layoutMode: WorkbenchLayoutMode
  customLayout: WorkbenchCustomLayout
  onLayoutModeChange: (mode: WorkbenchLayoutMode) => void
  onCustomLayoutChange: (layout: WorkbenchCustomLayout) => void
  scrollToStationId?: string | null
  onScrollToStationHandled?: (stationId: string) => void
  onOpenStationManage: () => void
  onOpenStationSearch: () => void
  onRemoveStation: (stationId: string) => void
}

const GRID_GAP_PX = 12
const STATION_CARD_MIN_WIDTH_PX = 280
const STATION_ROW_MIN_HEIGHT_PX = 260
const STATION_ROW_ESTIMATE_HEIGHT_PX = 396
const STATION_ROW_OVERSCAN = 2
const STATION_VIRTUALIZE_THRESHOLD = 18
const CUSTOM_LAYOUT_MIN = 1
const CUSTOM_LAYOUT_MAX = 8

const WORKBENCH_LAYOUT_PRESETS: WorkbenchLayoutPresetDefinition[] = [
  { id: 'auto', labelKey: 'workbench.layoutPreset.auto' },
  { id: 'focus', labelKey: 'workbench.layoutPreset.focus', icon: LayoutPanelLeft },
  { id: 'custom', labelKey: 'workbench.layoutPreset.custom', icon: Grid2x2 },
]

function clampCustomLayoutValue(value: number): number {
  return Math.max(CUSTOM_LAYOUT_MIN, Math.min(CUSTOM_LAYOUT_MAX, Math.round(value)))
}

function normalizeCustomLayout(layout: WorkbenchCustomLayout): WorkbenchCustomLayout {
  return {
    columns: clampCustomLayoutValue(layout.columns),
    rows: clampCustomLayoutValue(layout.rows),
  }
}

interface WorkbenchGridStyle extends CSSProperties {
  '--station-grid-columns'?: string
  '--station-grid-rows'?: string
  '--station-row-height'?: string
}

interface FocusRailItemProps {
  locale: Locale
  station: AgentStation
  unreadCount: number
  onSelectStation: (stationId: string) => void
}

function FocusRailItem({ locale, station, unreadCount, onSelectStation }: FocusRailItemProps) {
  const unreadLabel = unreadCount > 99 ? '99+' : unreadCount > 0 ? String(unreadCount) : null

  return (
    <button
      type="button"
      className="focus-rail-item"
      onClick={() => onSelectStation(station.id)}
      aria-label={t(locale, 'workbench.activeWindow')}
      title={station.name}
    >
      <div className="focus-rail-item-header">
        <div className="focus-rail-item-title">
          <strong>{station.name}</strong>
          <span>{station.tool}</span>
        </div>
        {unreadLabel ? <span className="focus-rail-item-unread">{unreadLabel}</span> : null}
      </div>
      <p className="focus-rail-item-path">{station.agentWorkdirRel}</p>
    </button>
  )
}

function chunkStations(stations: AgentStation[], columns: number): AgentStation[][] {
  const rows: AgentStation[][] = []
  const safeColumns = Math.max(1, columns)
  for (let index = 0; index < stations.length; index += safeColumns) {
    rows.push(stations.slice(index, index + safeColumns))
  }
  return rows
}

function WorkbenchCanvasView({
  locale,
  appearanceVersion,
  stations,
  activeStationId,
  terminalByStation,
  taskSignalByStationId,
  channelBotBindingsByStationId = {},
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRenderedScreenSnapshot,
  layoutMode,
  customLayout,
  onLayoutModeChange,
  onCustomLayoutChange,
  scrollToStationId = null,
  onScrollToStationHandled,
  onOpenStationManage,
  onOpenStationSearch,
  onRemoveStation,
}: WorkbenchCanvasProps) {
  const [fullscreenStationIdRaw, setFullscreenStationIdRaw] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [gridWidth, setGridWidth] = useState(0)
  const [gridHeight, setGridHeight] = useState(0)
  const normalizedCustomLayout = useMemo(() => normalizeCustomLayout(customLayout), [customLayout])
  const fullscreenStationId = useMemo(() => {
    if (!fullscreenStationIdRaw) {
      return null
    }
    return stations.some((station) => station.id === fullscreenStationIdRaw)
      ? fullscreenStationIdRaw
      : null
  }, [fullscreenStationIdRaw, stations])
  const fixedLayoutRequested = layoutMode === 'custom'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreenStationIdRaw(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const active = useMemo(
    () => stations.find((station) => station.id === activeStationId) ?? stations[0],
    [activeStationId, stations],
  )
  const fullscreenStation = useMemo(
    () => (fullscreenStationId ? stations.find((station) => station.id === fullscreenStationId) ?? null : null),
    [fullscreenStationId, stations],
  )
  const handleEnterFullscreen = useCallback(
    (stationId: string) => {
      onSelectStation(stationId)
      setFullscreenStationIdRaw(stationId)
    },
    [onSelectStation],
  )
  const handleExitFullscreen = useCallback(() => {
    setFullscreenStationIdRaw(null)
  }, [])
  const shouldVirtualize = !fullscreenStationId && stations.length >= STATION_VIRTUALIZE_THRESHOLD
  const shouldObserveGridSize = shouldVirtualize || (fixedLayoutRequested && !fullscreenStationId)

  useEffect(() => {
    const element = gridRef.current
    if (!element || !shouldObserveGridSize) {
      return
    }
    const updateSize = () => {
      setGridWidth(element.clientWidth)
      setGridHeight(element.clientHeight)
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [shouldObserveGridSize, stations.length])

  const maxColumnsByWidth = useMemo(() => {
    if (gridWidth <= 0) {
      return 1
    }
    return Math.max(1, Math.floor((gridWidth + GRID_GAP_PX) / (STATION_CARD_MIN_WIDTH_PX + GRID_GAP_PX)))
  }, [gridWidth])

  const fixedColumns = useMemo(() => {
    if (!fixedLayoutRequested) {
      return null
    }
    return Math.max(1, Math.min(normalizedCustomLayout.columns, maxColumnsByWidth))
  }, [fixedLayoutRequested, maxColumnsByWidth, normalizedCustomLayout.columns])
  const fixedRows = fixedLayoutRequested ? normalizedCustomLayout.rows : null
  const hasFixedLayout = !fullscreenStationId && fixedColumns !== null && fixedRows !== null

  const columns = useMemo(() => {
    if (hasFixedLayout && fixedColumns !== null) {
      return fixedColumns
    }
    if (!shouldVirtualize) {
      return 1
    }
    if (gridWidth <= 0) {
      return 1
    }
    return Math.max(1, Math.floor((gridWidth + GRID_GAP_PX) / (STATION_CARD_MIN_WIDTH_PX + GRID_GAP_PX)))
  }, [fixedColumns, gridWidth, hasFixedLayout, shouldVirtualize])

  const rowEstimateHeight = useMemo(() => {
    if (!hasFixedLayout || !fixedRows) {
      return STATION_ROW_ESTIMATE_HEIGHT_PX
    }
    if (gridHeight <= 0) {
      return STATION_ROW_ESTIMATE_HEIGHT_PX
    }
    const totalGap = GRID_GAP_PX * Math.max(0, fixedRows - 1)
    const availableHeight = gridHeight - totalGap
    if (availableHeight <= 0) {
      return STATION_ROW_MIN_HEIGHT_PX
    }
    return Math.max(STATION_ROW_MIN_HEIGHT_PX, Math.floor(availableHeight / fixedRows))
  }, [fixedRows, gridHeight, hasFixedLayout])

  const virtualRows = useMemo(
    () => (shouldVirtualize ? chunkStations(stations, columns) : []),
    [columns, shouldVirtualize, stations],
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? virtualRows.length : 0,
    getScrollElement: () => gridRef.current,
    estimateSize: () => rowEstimateHeight,
    overscan: STATION_ROW_OVERSCAN,
    isScrollingResetDelay: 120,
    useScrollendEvent: true,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    enabled: shouldVirtualize,
  })

  const gridStyle = useMemo<WorkbenchGridStyle | undefined>(() => {
    if (stations.length === 0) return undefined

    const count = stations.length
    let cols = 1
    let rows = 1

    if (layoutMode === 'focus') {
      return undefined // Focus mode handles its own layout
    }

    if (layoutMode === 'auto') {
      cols = Math.ceil(Math.sqrt(count))
      rows = Math.ceil(count / cols)
    } else {
      cols = normalizedCustomLayout.columns
      rows = normalizedCustomLayout.rows
    }

    return {
      '--station-grid-columns': String(cols),
      '--station-grid-rows': String(rows),
      '--station-row-height': `${100 / rows}%`,
    }
  }, [layoutMode, normalizedCustomLayout.columns, normalizedCustomLayout.rows, stations.length])

  const updateCustomLayoutDimension = useCallback(
    (dimension: keyof WorkbenchCustomLayout, nextValue: number) => {
      const nextLayout = normalizeCustomLayout({
        ...normalizedCustomLayout,
        [dimension]: nextValue,
      })
      onCustomLayoutChange(nextLayout)
      if (layoutMode !== 'custom') {
        onLayoutModeChange('custom')
      }
    },
    [layoutMode, normalizedCustomLayout, onCustomLayoutChange, onLayoutModeChange],
  )

  const scrollStationCardIntoView = useCallback((stationId: string) => {
    const container = gridRef.current
    if (!container) {
      return false
    }
    const target = Array.from(
      container.querySelectorAll<HTMLElement>('.station-window[data-station-id]'),
    ).find((card) => card.dataset.stationId === stationId)
    if (!target) {
      return false
    }
    target.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    })
    return true
  }, [])

  const settleScrollToStation = useCallback(
    (stationId: string, maxAttempts = 8) => {
      if (scrollStationCardIntoView(stationId)) {
        onScrollToStationHandled?.(stationId)
        return
      }
      if (maxAttempts <= 0) {
        onScrollToStationHandled?.(stationId)
        return
      }
      window.requestAnimationFrame(() => {
        settleScrollToStation(stationId, maxAttempts - 1)
      })
    },
    [onScrollToStationHandled, scrollStationCardIntoView],
  )

  useEffect(() => {
    if (scrollToStationId && fullscreenStationIdRaw) {
      setFullscreenStationIdRaw(null)
    }
  }, [fullscreenStationIdRaw, scrollToStationId])

  useEffect(() => {
    if (!scrollToStationId || fullscreenStationId) {
      return
    }
    if (shouldVirtualize && !hasFixedLayout && gridWidth <= 0) {
      return
    }
    const targetIndex = stations.findIndex((station) => station.id === scrollToStationId)
    if (targetIndex < 0) {
      onScrollToStationHandled?.(scrollToStationId)
      return
    }
    if (shouldVirtualize) {
      const targetRow = Math.floor(targetIndex / Math.max(1, columns))
      rowVirtualizer.scrollToIndex(targetRow, {
        align: 'center',
      })
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          settleScrollToStation(scrollToStationId)
        })
      })
      return
    }
    settleScrollToStation(scrollToStationId)
  }, [
    columns,
    fullscreenStationId,
    rowVirtualizer,
    scrollToStationId,
    settleScrollToStation,
    gridWidth,
    hasFixedLayout,
    shouldVirtualize,
    stations,
  ])

  return (
    <section className="panel workbench-canvas">
      <header className="canvas-header">
        <div className="canvas-header-actions" role="group" aria-label={t(locale, 'workbench.activeWindow')}>
          <p className="canvas-header-pill">
            <span>{t(locale, 'workbench.activeWindow')}</span>
            <strong>{active ? active.name : '-'}</strong>
          </p>
          <p className="canvas-header-pill">
            <strong>{t(locale, 'workbench.stationCount', { count: stations.length })}</strong>
          </p>
          <div className="canvas-layout-preset-group" role="group" aria-label={t(locale, 'workbench.layoutPreset')}>
            {WORKBENCH_LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`canvas-layout-preset-btn ${preset.id === layoutMode ? 'active' : ''}`}
                aria-label={t(locale, preset.labelKey)}
                title={t(locale, preset.labelKey)}
                onClick={() => onLayoutModeChange(preset.id)}
              >
                {preset.icon ? (
                  <preset.icon className="canvas-layout-preset-icon" aria-hidden="true" strokeWidth={1.75} />
                ) : (
                  <span className="canvas-layout-preset-auto" aria-hidden="true">
                    A
                  </span>
                )}
              </button>
            ))}
          </div>
          {layoutMode === 'custom' ? (
            <div className="canvas-layout-custom-controls" role="group" aria-label={t(locale, 'workbench.layoutCustom')}>
              <label className="canvas-layout-custom-field">
                <span>{t(locale, 'workbench.layoutColumns')}</span>
                <input
                  type="number"
                  min={CUSTOM_LAYOUT_MIN}
                  max={CUSTOM_LAYOUT_MAX}
                  value={normalizedCustomLayout.columns}
                  className="vb-input canvas-layout-custom-input"
                  onChange={(event) => updateCustomLayoutDimension('columns', Number(event.target.value))}
                />
              </label>
              <label className="canvas-layout-custom-field">
                <span>{t(locale, 'workbench.layoutRows')}</span>
                <input
                  type="number"
                  min={CUSTOM_LAYOUT_MIN}
                  max={CUSTOM_LAYOUT_MAX}
                  value={normalizedCustomLayout.rows}
                  className="vb-input canvas-layout-custom-input"
                  onChange={(event) => updateCustomLayoutDimension('rows', Number(event.target.value))}
                />
              </label>
            </div>
          ) : null}
          <button
            type="button"
            className="canvas-header-icon-button"
            onClick={onOpenStationSearch}
            aria-label={t(locale, 'station.filter.search')}
            title={t(locale, 'station.filter.search')}
          >
            <AppIcon name="search" className="vb-icon vb-icon-overview" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="canvas-header-icon-button canvas-header-add"
            onClick={onOpenStationManage}
            aria-label={t(locale, 'workbench.addStation')}
            title={t(locale, 'workbench.addStation')}
          >
            <AppIcon name="plus" className="vb-icon vb-icon-overview" aria-hidden="true" />
          </button>
        </div>
      </header>

      {stations.length > 0 ? (
        fullscreenStation ? (
          <div
            className="station-grid fullscreen-mode fullscreen-focus"
            role="list"
            aria-label={t(locale, 'workbench.ariaLabel')}
            data-station-count={1}
            data-layout-mode="auto"
            data-layout-preset={layoutMode}
          >
            <StationCard
              key={fullscreenStation.id}
              locale={locale}
              appearanceVersion={appearanceVersion}
              station={fullscreenStation}
              active={fullscreenStation.id === activeStationId}
              runtime={terminalByStation[fullscreenStation.id]}
              taskSignal={taskSignalByStationId[fullscreenStation.id]}
              channelBotBindings={channelBotBindingsByStationId[fullscreenStation.id]}
              isFullscreen
              isFullscreenMode
              onSelectStation={onSelectStation}
              onLaunchStationTerminal={onLaunchStationTerminal}
              onLaunchCliAgent={onLaunchCliAgent}
              onSendInputData={onSendInputData}
              onResizeTerminal={onResizeTerminal}
              onBindTerminalSink={onBindTerminalSink}
              onRenderedScreenSnapshot={onRenderedScreenSnapshot}
              onRemoveStation={onRemoveStation}
              onEnterFullscreen={handleEnterFullscreen}
              onExitFullscreen={handleExitFullscreen}
            />
          </div>
        ) : layoutMode === 'focus' ? (
          <div
            className="station-grid focus-mode"
            role="list"
            aria-label={t(locale, 'workbench.ariaLabel')}
            data-layout-preset="focus"
          >
            <div className="focus-main">
              <div className="focus-main-stage">
                {stations.map((station) => {
                  const isActive = station.id === activeStationId
                  return (
                    <StationCard
                      key={station.id}
                      locale={locale}
                      appearanceVersion={appearanceVersion}
                      station={station}
                      active={isActive}
                      runtime={terminalByStation[station.id]}
                      taskSignal={taskSignalByStationId[station.id]}
                      channelBotBindings={channelBotBindingsByStationId[station.id]}
                      isFullscreen={false}
                      isFullscreenMode={false}
                      isFocusHidden={!isActive}
                      onSelectStation={onSelectStation}
                      onLaunchStationTerminal={onLaunchStationTerminal}
                      onLaunchCliAgent={onLaunchCliAgent}
                      onSendInputData={onSendInputData}
                      onResizeTerminal={onResizeTerminal}
                      onBindTerminalSink={onBindTerminalSink}
                      onRenderedScreenSnapshot={onRenderedScreenSnapshot}
                      onRemoveStation={onRemoveStation}
                      onEnterFullscreen={handleEnterFullscreen}
                      onExitFullscreen={handleExitFullscreen}
                    />
                  )
                })}
              </div>
            </div>
            {stations.length > 1 && (
              <div className="focus-ring">
                {stations
                  .filter((s) => s.id !== activeStationId)
                  .map((station) => (
                    <FocusRailItem
                      key={station.id}
                      locale={locale}
                      station={station}
                      unreadCount={terminalByStation[station.id]?.unreadCount ?? 0}
                      onSelectStation={onSelectStation}
                    />
                  ))}
              </div>
            )}
          </div>
        ) : shouldVirtualize ? (
          <div
            ref={gridRef}
            className="station-grid station-grid-virtual"
            role="list"
            aria-label={t(locale, 'workbench.ariaLabel')}
            data-station-count={stations.length}
            data-layout-mode={hasFixedLayout ? 'fixed' : 'auto'}
            data-layout-preset={layoutMode}
            data-scrolling={rowVirtualizer.isScrolling ? 'true' : 'false'}
            style={gridStyle}
          >
            <div
              className="station-grid-virtual-inner"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((rowItem) => {
                const rowStations = virtualRows[rowItem.index] ?? []
                return (
                  <div
                    key={rowItem.key}
                    data-index={rowItem.index}
                    className="station-grid-virtual-row"
                    style={{
                      transform: `translate3d(0, ${rowItem.start}px, 0)`,
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    }}
                  >
                    {rowStations.map((station) => (
                      <StationCard
                        key={station.id}
                        locale={locale}
                        appearanceVersion={appearanceVersion}
                        station={station}
                        active={station.id === activeStationId}
                        runtime={terminalByStation[station.id]}
                        taskSignal={taskSignalByStationId[station.id]}
                        channelBotBindings={channelBotBindingsByStationId[station.id]}
                        isFullscreen={false}
                        isFullscreenMode={false}
                        onSelectStation={onSelectStation}
                        onLaunchStationTerminal={onLaunchStationTerminal}
                        onLaunchCliAgent={onLaunchCliAgent}
                        onSendInputData={onSendInputData}
                        onResizeTerminal={onResizeTerminal}
                        onBindTerminalSink={onBindTerminalSink}
                        onRenderedScreenSnapshot={onRenderedScreenSnapshot}
                        onRemoveStation={onRemoveStation}
                        onEnterFullscreen={handleEnterFullscreen}
                        onExitFullscreen={handleExitFullscreen}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div
            className="station-grid"
            role="list"
            aria-label={t(locale, 'workbench.ariaLabel')}
            data-station-count={stations.length}
            data-layout-mode={hasFixedLayout ? 'fixed' : 'auto'}
            data-layout-preset={layoutMode}
            style={gridStyle}
          >
            {stations.map((station) => (
              <StationCard
                key={station.id}
                locale={locale}
                appearanceVersion={appearanceVersion}
                station={station}
                active={station.id === activeStationId}
                runtime={terminalByStation[station.id]}
                taskSignal={taskSignalByStationId[station.id]}
                channelBotBindings={channelBotBindingsByStationId[station.id]}
                isFullscreen={false}
                isFullscreenMode={false}
                onSelectStation={onSelectStation}
                onLaunchStationTerminal={onLaunchStationTerminal}
                onLaunchCliAgent={onLaunchCliAgent}
                onSendInputData={onSendInputData}
                onResizeTerminal={onResizeTerminal}
                onBindTerminalSink={onBindTerminalSink}
                onRenderedScreenSnapshot={onRenderedScreenSnapshot}
                onRemoveStation={onRemoveStation}
                onEnterFullscreen={handleEnterFullscreen}
                onExitFullscreen={handleExitFullscreen}
              />
            ))}
          </div>
        )
      ) : (
        <div className="station-grid-empty">
          <p>{t(locale, 'workbench.emptyStations')}</p>
          <button type="button" className="canvas-header-icon-button canvas-header-add" onClick={onOpenStationManage}>
            <AppIcon name="plus" className="vb-icon vb-icon-overview" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  )
}

export const WorkbenchCanvas = memo(WorkbenchCanvasView)
