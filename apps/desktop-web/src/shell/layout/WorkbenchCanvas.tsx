import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { AgentStation } from './model'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import type { StationTerminalSink } from './StationXtermTerminal'
import { StationCard } from './StationCard'
import { AppIcon } from '../ui/icons'

interface StationTerminalRuntime {
  sessionId: string | null
  unreadCount: number
}

export type WorkbenchLayoutPreset = 'auto' | '1*1' | '1*2' | '2*1' | '2*2' | '3*2' | '4*2'

type FixedLayoutPresetLabelKey =
  | 'workbench.layoutPreset.1x1'
  | 'workbench.layoutPreset.1x2'
  | 'workbench.layoutPreset.2x1'
  | 'workbench.layoutPreset.2x2'
  | 'workbench.layoutPreset.3x2'
  | 'workbench.layoutPreset.4x2'

interface WorkbenchLayoutPresetDefinition {
  id: WorkbenchLayoutPreset
  columns: number | null
  rows: number | null
  labelKey: 'workbench.layoutPreset.auto' | FixedLayoutPresetLabelKey
}

interface WorkbenchCanvasProps {
  locale: Locale
  appearanceVersion: string
  stations: AgentStation[]
  activeStationId: string
  terminalByStation: Record<string, StationTerminalRuntime>
  taskSignalByStationId: Partial<Record<string, StationTaskSignal>>
  onSelectStation: (stationId: string) => void
  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: (stationId: string, sink: StationTerminalSink | null) => void
  layoutPreset: WorkbenchLayoutPreset
  onLayoutPresetChange: (preset: WorkbenchLayoutPreset) => void
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

const WORKBENCH_LAYOUT_PRESETS: WorkbenchLayoutPresetDefinition[] = [
  { id: 'auto', columns: null, rows: null, labelKey: 'workbench.layoutPreset.auto' },
  { id: '1*1', columns: 1, rows: 1, labelKey: 'workbench.layoutPreset.1x1' },
  { id: '1*2', columns: 1, rows: 2, labelKey: 'workbench.layoutPreset.1x2' },
  { id: '2*1', columns: 2, rows: 1, labelKey: 'workbench.layoutPreset.2x1' },
  { id: '2*2', columns: 2, rows: 2, labelKey: 'workbench.layoutPreset.2x2' },
  { id: '3*2', columns: 3, rows: 2, labelKey: 'workbench.layoutPreset.3x2' },
  { id: '4*2', columns: 4, rows: 2, labelKey: 'workbench.layoutPreset.4x2' },
]

interface WorkbenchGridStyle extends CSSProperties {
  '--station-grid-columns'?: string
  '--station-row-height'?: string
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
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  layoutPreset,
  onLayoutPresetChange,
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
  const fullscreenStationId = useMemo(() => {
    if (!fullscreenStationIdRaw) {
      return null
    }
    return stations.some((station) => station.id === fullscreenStationIdRaw)
      ? fullscreenStationIdRaw
      : null
  }, [fullscreenStationIdRaw, stations])
  const activeLayoutPreset = useMemo(
    () => WORKBENCH_LAYOUT_PRESETS.find((preset) => preset.id === layoutPreset) ?? WORKBENCH_LAYOUT_PRESETS[0],
    [layoutPreset],
  )
  const fixedLayoutRequested = activeLayoutPreset.columns !== null && activeLayoutPreset.rows !== null

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
    if (!fixedLayoutRequested || activeLayoutPreset.columns === null) {
      return null
    }
    return Math.max(1, Math.min(activeLayoutPreset.columns, maxColumnsByWidth))
  }, [activeLayoutPreset.columns, fixedLayoutRequested, maxColumnsByWidth])
  const fixedRows = fixedLayoutRequested ? activeLayoutPreset.rows : null
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
    if (!hasFixedLayout || fixedColumns === null) {
      return undefined
    }
    return {
      '--station-grid-columns': String(fixedColumns),
      '--station-row-height': `${rowEstimateHeight}px`,
    }
  }, [fixedColumns, hasFixedLayout, rowEstimateHeight])

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
                className={`canvas-layout-preset-btn ${preset.id === layoutPreset ? 'active' : ''}`}
                aria-label={t(locale, preset.labelKey)}
                title={t(locale, preset.labelKey)}
                onClick={() => onLayoutPresetChange(preset.id)}
              >
                {preset.columns && preset.rows ? (
                  <span
                    className="canvas-layout-preset-glyph"
                    style={{
                      gridTemplateColumns: `repeat(${preset.columns}, minmax(0, 1fr))`,
                    }}
                    aria-hidden="true"
                  >
                    {Array.from({ length: preset.columns * preset.rows }).map((_, index) => (
                      <span key={`${preset.id}-${index}`} />
                    ))}
                  </span>
                ) : (
                  <span className="canvas-layout-preset-auto" aria-hidden="true">
                    A
                  </span>
                )}
              </button>
            ))}
          </div>
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
            data-layout-preset={layoutPreset}
          >
            <StationCard
              key={fullscreenStation.id}
              locale={locale}
              appearanceVersion={appearanceVersion}
              station={fullscreenStation}
              active={fullscreenStation.id === activeStationId}
              runtime={terminalByStation[fullscreenStation.id]}
              taskSignal={taskSignalByStationId[fullscreenStation.id]}
              isFullscreen
              isFullscreenMode
              onSelectStation={onSelectStation}
              onLaunchStationTerminal={onLaunchStationTerminal}
              onLaunchCliAgent={onLaunchCliAgent}
              onSendInputData={onSendInputData}
              onResizeTerminal={onResizeTerminal}
              onBindTerminalSink={onBindTerminalSink}
              onRemoveStation={onRemoveStation}
              onEnterFullscreen={handleEnterFullscreen}
              onExitFullscreen={handleExitFullscreen}
            />
          </div>
        ) : shouldVirtualize ? (
          <div
            ref={gridRef}
            className="station-grid station-grid-virtual"
            role="list"
            aria-label={t(locale, 'workbench.ariaLabel')}
            data-station-count={stations.length}
            data-layout-mode={hasFixedLayout ? 'fixed' : 'auto'}
            data-layout-preset={layoutPreset}
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
                        isFullscreen={false}
                        isFullscreenMode={false}
                        onSelectStation={onSelectStation}
                        onLaunchStationTerminal={onLaunchStationTerminal}
                        onLaunchCliAgent={onLaunchCliAgent}
                        onSendInputData={onSendInputData}
                        onResizeTerminal={onResizeTerminal}
                        onBindTerminalSink={onBindTerminalSink}
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
            ref={gridRef}
            className="station-grid"
            role="list"
            aria-label={t(locale, 'workbench.ariaLabel')}
            data-station-count={stations.length}
            data-layout-mode={hasFixedLayout ? 'fixed' : 'auto'}
            data-layout-preset={layoutPreset}
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
                isFullscreen={false}
                isFullscreenMode={false}
                onSelectStation={onSelectStation}
                onLaunchStationTerminal={onLaunchStationTerminal}
                onLaunchCliAgent={onLaunchCliAgent}
                onSendInputData={onSendInputData}
                onResizeTerminal={onResizeTerminal}
                onBindTerminalSink={onBindTerminalSink}
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
