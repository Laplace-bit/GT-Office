import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { AgentStation } from './model'
import type { StationTaskSignal } from './task-center-model'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import type { StationTerminalSink } from './StationXtermTerminal'
import { StationCard } from './StationCard'
import { AppIcon } from '../ui/icons'

interface StationTerminalRuntime {
  sessionId: string | null
  unreadCount: number
}

interface WorkbenchCanvasProps {
  locale: Locale
  appearanceVersion: string
  stations: AgentStation[]
  activeStationId: string
  terminalByStation: Record<string, StationTerminalRuntime>
  terminalPreviewByStation: Record<string, string>
  taskSignalByStationId: Partial<Record<string, StationTaskSignal>>
  onSelectStation: (stationId: string) => void
  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: (stationId: string, sink: StationTerminalSink | null) => void
  onOpenStationManage: () => void
  onOpenStationSearch: () => void
  onRemoveStation: (stationId: string) => void
}

const GRID_GAP_PX = 12
const STATION_CARD_MIN_WIDTH_PX = 280
const STATION_ROW_ESTIMATE_HEIGHT_PX = 396
const STATION_ROW_OVERSCAN = 2
const STATION_VIRTUALIZE_THRESHOLD = 18

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
  terminalPreviewByStation,
  taskSignalByStationId,
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onOpenStationManage,
  onOpenStationSearch,
  onRemoveStation,
}: WorkbenchCanvasProps) {
  const [fullscreenStationIdRaw, setFullscreenStationIdRaw] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [gridWidth, setGridWidth] = useState(0)
  const fullscreenStationId = useMemo(() => {
    if (!fullscreenStationIdRaw) {
      return null
    }
    return stations.some((station) => station.id === fullscreenStationIdRaw)
      ? fullscreenStationIdRaw
      : null
  }, [fullscreenStationIdRaw, stations])

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

  useEffect(() => {
    const element = gridRef.current
    if (!element || !shouldVirtualize) {
      return
    }
    const updateWidth = () => {
      setGridWidth(element.clientWidth)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [shouldVirtualize, stations.length])

  const columns = useMemo(() => {
    if (!shouldVirtualize) {
      return 1
    }
    if (gridWidth <= 0) {
      return 1
    }
    return Math.max(1, Math.floor((gridWidth + GRID_GAP_PX) / (STATION_CARD_MIN_WIDTH_PX + GRID_GAP_PX)))
  }, [gridWidth, shouldVirtualize])

  const virtualRows = useMemo(
    () => (shouldVirtualize ? chunkStations(stations, columns) : []),
    [columns, shouldVirtualize, stations],
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? virtualRows.length : 0,
    getScrollElement: () => gridRef.current,
    estimateSize: () => STATION_ROW_ESTIMATE_HEIGHT_PX,
    overscan: STATION_ROW_OVERSCAN,
    isScrollingResetDelay: 120,
    useScrollendEvent: true,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    enabled: shouldVirtualize,
  })

  return (
    <section className="panel workbench-canvas">
      <header className="canvas-header">
        <div className="canvas-header-main">
          <h2>{t(locale, 'workbench.title')}</h2>
          <p>{t(locale, 'workbench.description')}</p>
        </div>
        <div className="canvas-header-actions" role="group" aria-label={t(locale, 'workbench.activeWindow')}>
          <p className="canvas-header-pill">
            <span>{t(locale, 'workbench.activeWindow')}</span>
            <strong>{active ? active.name : '-'}</strong>
          </p>
          <p className="canvas-header-pill">
            <strong>{t(locale, 'workbench.stationCount', { count: stations.length })}</strong>
          </p>
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
          >
            <StationCard
              key={fullscreenStation.id}
              locale={locale}
              appearanceVersion={appearanceVersion}
              station={fullscreenStation}
              active={fullscreenStation.id === activeStationId}
              runtime={terminalByStation[fullscreenStation.id]}
              previewText={terminalPreviewByStation[fullscreenStation.id] ?? ''}
              renderTerminal
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
            data-scrolling={rowVirtualizer.isScrolling ? 'true' : 'false'}
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
                        previewText={terminalPreviewByStation[station.id] ?? ''}
                        renderTerminal={station.id === activeStationId}
                        taskSignal={taskSignalByStationId[station.id]}
                        isFullscreen={false}
                        isFullscreenMode={false}
                        onSelectStation={onSelectStation}
                        onLaunchStationTerminal={onLaunchStationTerminal}
                        onLaunchCliAgent={onLaunchCliAgent}
                        onSendInputData={onSendInputData}
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
          >
            {stations.map((station) => (
              <StationCard
                key={station.id}
                locale={locale}
                appearanceVersion={appearanceVersion}
                station={station}
                active={station.id === activeStationId}
                runtime={terminalByStation[station.id]}
                previewText={terminalPreviewByStation[station.id] ?? ''}
                renderTerminal={station.id === activeStationId}
                taskSignal={taskSignalByStationId[station.id]}
                isFullscreen={false}
                isFullscreenMode={false}
                onSelectStation={onSelectStation}
                onLaunchStationTerminal={onLaunchStationTerminal}
                onLaunchCliAgent={onLaunchCliAgent}
                onSendInputData={onSendInputData}
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
