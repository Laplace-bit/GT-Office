import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  BetweenHorizontalStart,
  Grid2x2,
  LayoutPanelLeft,
  MonitorUp,
  Pin,
  PinOff,
} from 'lucide-react'
import { StationCard } from './StationCard'
import type { AgentStation } from './station-model'
import type { WorkbenchContainer as WorkbenchContainerModel } from './workbench-container-model'
import {
  normalizeWorkbenchCustomLayout,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from './workbench-layout-model'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { StationTerminalSinkBindingHandler } from '@features/terminal'
import type {
  RenderedScreenSnapshot,
  StationTerminalRestoreStatePayload,
  ToolCommandSummary,
} from '@shell/integration/desktop-api'
import type { StationChannelBotBindingSummary } from '@features/tool-adapter'
import type { StationActionDescriptor } from './station-action-model'
import type { WorkbenchStationRuntime } from './TerminalStationPane'
import { WorkbenchUtilityActions } from './WorkbenchUtilityActions'
import './WorkbenchCanvas.scss'

interface WorkbenchLayoutPresetDefinition {
  id: WorkbenchLayoutMode
  labelKey: 'workbench.layoutPreset.auto' | 'workbench.layoutPreset.focus' | 'workbench.layoutPreset.custom'
}

interface WorkbenchGridStyle extends CSSProperties {
  '--station-grid-columns'?: string
  '--station-grid-rows'?: string
}

interface WorkbenchCanvasPanelProps {
  locale: Locale
  appearanceVersion: string
  container: WorkbenchContainerModel
  containerIndex: number
  stations: AgentStation[]
  activeGlobalStationId: string
  terminalByStation: Record<string, WorkbenchStationRuntime>
  taskSignalByStationId: Partial<Record<string, StationTaskSignal>>
  channelBotBindingsByStationId?: Record<string, StationChannelBotBindingSummary[]>
  dropActive?: boolean
  detachedReadonly?: boolean
  scrollToStationId?: string | null
  onScrollToStationHandled?: (stationId: string) => void
  onSelectStation: (containerId: string, stationId: string) => void
  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot?: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onRunStationAction: (station: AgentStation, action: StationActionDescriptor) => void
  toolCommandsByStationId?: Record<string, ToolCommandSummary[]>
  onRestoreStateCaptured?: (
    stationId: string,
    state: StationTerminalRestoreStatePayload,
    sourceSessionId: string | null,
  ) => void
  onRemoveStation: (stationId: string) => void
  onLayoutModeChange: (containerId: string, mode: WorkbenchLayoutMode) => void
  onCustomLayoutChange: (containerId: string, layout: WorkbenchCustomLayout) => void
  onFloatContainer: (containerId: string) => void
  onDockContainer: (containerId: string) => void
  onDetachContainer: (containerId: string) => void
  onToggleContainerTopmost: (containerId: string) => void
  onDeleteContainer?: (containerId: string) => void
  showUtilityBar?: boolean
  onCreateContainer?: () => void
  onBeginFloatingDrag?: (containerId: string, event: ReactPointerEvent<HTMLElement>) => void
  onStationDragStart?: (event: ReactDragEvent<HTMLElement>, stationId: string, sourceContainerId: string) => void
  onStationDragPointerStart?: (stationId: string, sourceContainerId: string, event: ReactPointerEvent<HTMLElement>) => void
  onStationDragEnd?: () => void
  onStationDragHover?: (containerId: string | null) => void
  onStationDrop?: (event: ReactDragEvent<HTMLElement>, targetContainerId: string) => void
  onBeginNativeWindowDrag?: (event: ReactPointerEvent<HTMLElement>) => void
  onReturnToWorkspace?: () => void
  onOpenStationManage?: () => void
  onOpenStationSearch?: () => void
  pinned?: boolean
  onTogglePinnedWorkbenchContainer?: (containerId: string) => void
}

const WORKBENCH_LAYOUT_PRESETS: WorkbenchLayoutPresetDefinition[] = [
  { id: 'auto', labelKey: 'workbench.layoutPreset.auto' },
  { id: 'focus', labelKey: 'workbench.layoutPreset.focus' },
  { id: 'custom', labelKey: 'workbench.layoutPreset.custom' },
]

function countLiveStations(
  stationIds: string[],
  terminalByStation: Record<string, WorkbenchStationRuntime>,
): number {
  return stationIds.filter((stationId) => Boolean(terminalByStation[stationId]?.sessionId)).length
}

function buildPanelTitle(
  locale: Locale,
  container: WorkbenchContainerModel,
  stations: AgentStation[],
  containerIndex: number,
): string {
  const activeStation =
    stations.find((station) => station.id === container.activeStationId) ??
    stations[0] ??
    null
  if (activeStation) {
    return activeStation.name
  }
  return t(locale, 'workbench.emptyCanvasTitle', { index: containerIndex + 1 })
}

function FocusRailItem({
  locale,
  station,
  unreadCount,
  onSelectStation,
}: {
  locale: Locale
  station: AgentStation
  unreadCount: number
  onSelectStation: (stationId: string) => void
}) {
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

function WorkbenchCanvasPanelView({
  locale,
  appearanceVersion,
  container,
  containerIndex,
  stations,
  activeGlobalStationId,
  terminalByStation,
  taskSignalByStationId,
  channelBotBindingsByStationId = {},
  dropActive = false,
  detachedReadonly = false,
  scrollToStationId = null,
  onScrollToStationHandled,
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRenderedScreenSnapshot,
  onRunStationAction,
  toolCommandsByStationId = {},
  onRestoreStateCaptured,
  onRemoveStation,
  onLayoutModeChange,
  onCustomLayoutChange,
  onFloatContainer,
  onDockContainer,
  onDetachContainer,
  onToggleContainerTopmost,
  onDeleteContainer,
  showUtilityBar = false,
  onCreateContainer,
  onBeginFloatingDrag,
  onStationDragStart,
  onStationDragPointerStart,
  onStationDragEnd,
  onStationDragHover,
  onStationDrop,
  onBeginNativeWindowDrag,
  onReturnToWorkspace,
  onOpenStationManage,
  onOpenStationSearch,
  pinned = false,
  onTogglePinnedWorkbenchContainer,
}: WorkbenchCanvasPanelProps) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [fullscreenStationIdRaw, setFullscreenStationIdRaw] = useState<string | null>(null)
  const normalizedCustomLayout = useMemo(
    () => normalizeWorkbenchCustomLayout(container.customLayout),
    [container.customLayout],
  )
  const selectedStationId = useMemo(
    () => container.activeStationId ?? stations[0]?.id ?? null,
    [container.activeStationId, stations],
  )
  const fullscreenStation = useMemo(
    () => stations.find((station) => station.id === fullscreenStationIdRaw) ?? null,
    [fullscreenStationIdRaw, stations],
  )
  const panelTitle = useMemo(
    () => buildPanelTitle(locale, container, stations, containerIndex),
    [container, containerIndex, locale, stations],
  )
  const liveCount = useMemo(
    () => countLiveStations(container.stationIds, terminalByStation),
    [container.stationIds, terminalByStation],
  )
  const modeLabel = useMemo(() => {
    if (container.mode === 'floating') {
      return t(locale, 'workbench.surfaceModeFloating')
    }
    if (container.mode === 'detached') {
      return t(locale, 'workbench.surfaceModeDetached')
    }
    return null
  }, [container.mode, locale])
  const canDetach = !detachedReadonly && stations.length > 0
  const canDeleteContainer = !detachedReadonly && stations.length === 0 && typeof onDeleteContainer === 'function'
  const gridStyle = useMemo<WorkbenchGridStyle | undefined>(() => {
    if (container.layoutMode === 'focus' || stations.length === 0) {
      return undefined
    }
    if (container.layoutMode === 'custom') {
      return {
        '--station-grid-columns': String(normalizedCustomLayout.columns),
        '--station-grid-rows': String(normalizedCustomLayout.rows),
      }
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(stations.length)))
    const rows = Math.max(1, Math.ceil(stations.length / columns))
    return {
      '--station-grid-columns': String(columns),
      '--station-grid-rows': String(rows),
    }
  }, [container.layoutMode, normalizedCustomLayout.columns, normalizedCustomLayout.rows, stations.length])
  const focusGridStyle = useMemo<CSSProperties | undefined>(() => {
    if (container.layoutMode !== 'focus' || stations.length <= 1) {
      return undefined
    }
    return {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(11rem, clamp(11rem, 28%, 22rem))',
      gridTemplateRows: 'minmax(0, 1fr)',
    }
  }, [container.layoutMode, stations.length])

  const updateCustomLayoutDimension = useCallback(
    (dimension: keyof WorkbenchCustomLayout, nextValue: number) => {
      const nextLayout = normalizeWorkbenchCustomLayout({
        ...normalizedCustomLayout,
        [dimension]: nextValue,
      })
      onCustomLayoutChange(container.id, nextLayout)
      if (container.layoutMode !== 'custom') {
        onLayoutModeChange(container.id, 'custom')
      }
    },
    [container.id, container.layoutMode, normalizedCustomLayout, onCustomLayoutChange, onLayoutModeChange],
  )

  const handleSelectStation = useCallback(
    (stationId: string) => {
      onSelectStation(container.id, stationId)
    },
    [container.id, onSelectStation],
  )

  const handleEnterFullscreen = useCallback(
    (stationId: string) => {
      handleSelectStation(stationId)
      setFullscreenStationIdRaw(stationId)
    },
    [handleSelectStation],
  )

  const handleExitFullscreen = useCallback(() => {
    setFullscreenStationIdRaw(null)
  }, [])

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

  useEffect(() => {
    if (!scrollToStationId || fullscreenStationIdRaw) {
      return
    }
    if (!stations.some((station) => station.id === scrollToStationId)) {
      return
    }
    window.requestAnimationFrame(() => {
      const target = gridRef.current?.querySelector<HTMLElement>(`.station-window[data-station-id="${scrollToStationId}"]`)
      if (!target) {
        return
      }
      target.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      })
      onScrollToStationHandled?.(scrollToStationId)
    })
  }, [fullscreenStationIdRaw, onScrollToStationHandled, scrollToStationId, stations])

  useEffect(() => {
    if (!fullscreenStationIdRaw) {
      return
    }
    if (stations.some((station) => station.id === fullscreenStationIdRaw)) {
      return
    }
    setFullscreenStationIdRaw(null)
  }, [fullscreenStationIdRaw, stations])

  const renderStationCard = useCallback(
    (station: AgentStation, options?: { focusHidden?: boolean; fullscreen?: boolean; fullscreenMode?: boolean }) => (
      <StationCard
        key={station.id}
        locale={locale}
        appearanceVersion={appearanceVersion}
        station={station}
        active={station.id === activeGlobalStationId}
        runtime={terminalByStation[station.id]}
        taskSignal={taskSignalByStationId[station.id]}
        channelBotBindings={channelBotBindingsByStationId[station.id]}
        isFullscreen={Boolean(options?.fullscreen)}
        isFullscreenMode={Boolean(options?.fullscreenMode)}
        isFocusHidden={Boolean(options?.focusHidden)}
        draggable={!detachedReadonly}
        onStationDragStart={
          onStationDragStart
            ? (event) => {
                onStationDragStart(event, station.id, container.id)
              }
            : undefined
        }
        onStationDragPointerStart={
          onStationDragPointerStart
            ? (event) => {
                onStationDragPointerStart(station.id, container.id, event)
              }
            : undefined
        }
        onStationDragEnd={onStationDragEnd}
        onSelectStation={handleSelectStation}
        onLaunchStationTerminal={onLaunchStationTerminal}
        onLaunchCliAgent={onLaunchCliAgent}
        onSendInputData={onSendInputData}
        onResizeTerminal={onResizeTerminal}
        onBindTerminalSink={onBindTerminalSink}
        onRenderedScreenSnapshot={onRenderedScreenSnapshot}
        onRunAction={onRunStationAction}
        commands={toolCommandsByStationId[station.id]}
        onRestoreStateCaptured={onRestoreStateCaptured}
        onRemoveStation={onRemoveStation}
        onEnterFullscreen={handleEnterFullscreen}
        onExitFullscreen={handleExitFullscreen}
      />
    ),
    [
      activeGlobalStationId,
      appearanceVersion,
      channelBotBindingsByStationId,
      container.id,
      detachedReadonly,
      handleEnterFullscreen,
      handleExitFullscreen,
      handleSelectStation,
      locale,
      onBindTerminalSink,
      onLaunchCliAgent,
      onLaunchStationTerminal,
      onRemoveStation,
      onRenderedScreenSnapshot,
      onRestoreStateCaptured,
      onResizeTerminal,
      onSendInputData,
      onStationDragStart,
      onStationDragPointerStart,
      onStationDragEnd,
      taskSignalByStationId,
      terminalByStation,
    ],
  )

  return (
    <section
      data-container-id={container.id}
      className={[
        'panel',
        'workbench-canvas',
        `mode-${container.mode}`,
        stations.some((station) => station.id === activeGlobalStationId) ? 'is-active-container' : '',
        dropActive ? 'is-drop-target' : '',
        detachedReadonly ? 'detached-readonly' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={
        onStationDrop
          ? (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              onStationDragHover?.(container.id)
            }
          : undefined
      }
      onDragLeave={
        onStationDragHover
          ? (event) => {
              const related = event.relatedTarget as Node | null
              if (related && event.currentTarget.contains(related)) {
                return
              }
              onStationDragHover(null)
            }
          : undefined
      }
      onDrop={
        onStationDrop
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              onStationDragHover?.(null)
              onStationDrop(event, container.id)
            }
          : undefined
      }
    >
      <header
        className={['canvas-header', container.mode === 'floating' && !detachedReadonly ? 'draggable' : ''].join(' ')}
        onPointerDown={
          (container.mode === 'floating' && !detachedReadonly && onBeginFloatingDrag) || onBeginNativeWindowDrag
            ? (event) => {
                const target = event.target as HTMLElement
                if (target.closest('button') || target.closest('input') || target.closest('label')) {
                  return
                }
                if (container.mode === 'floating' && !detachedReadonly && onBeginFloatingDrag) {
                  onBeginFloatingDrag(container.id, event)
                  return
                }
                if (container.mode === 'detached' && detachedReadonly) {
                  onBeginNativeWindowDrag?.(event)
                }
              }
            : undefined
        }
      >
        <div className="canvas-header-main">
          <div className="canvas-header-title">
            <div className="canvas-header-title-row">
              {modeLabel ? <span className={['canvas-mode-badge', container.mode].join(' ')}>{modeLabel}</span> : null}
              <h3>{panelTitle}</h3>
              <div className="canvas-header-meta" role="list" aria-label={t(locale, 'workbench.activeWindow')}>
                <span className="canvas-header-pill" role="listitem" title={t(locale, 'workbench.stationCount', { count: stations.length })}>
                  <AppIcon name="stations" className="canvas-header-pill-icon" aria-hidden="true" />
                  <strong className="canvas-header-pill-value">{stations.length}</strong>
                  <span className="vb-sr-only">{t(locale, 'workbench.stationCount', { count: stations.length })}</span>
                </span>
                <span className="canvas-header-pill" role="listitem" title={t(locale, 'workbench.containerLiveCount', { count: liveCount })}>
                  <AppIcon name="activity" className="canvas-header-pill-icon" aria-hidden="true" />
                  <strong className="canvas-header-pill-value">{liveCount}</strong>
                  <span className="vb-sr-only">{t(locale, 'workbench.containerLiveCount', { count: liveCount })}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="canvas-header-actions" role="group" aria-label={t(locale, 'workbench.activeWindow')}>
            <div className="canvas-layout-preset-group" role="group" aria-label={t(locale, 'workbench.layoutPreset')}>
              {WORKBENCH_LAYOUT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={['canvas-layout-preset-btn', preset.id === container.layoutMode ? 'active' : ''].join(' ')}
                  aria-label={t(locale, preset.labelKey)}
                  title={t(locale, preset.labelKey)}
                  onClick={() => onLayoutModeChange(container.id, preset.id)}
                >
                  {preset.id === 'focus' ? (
                    <LayoutPanelLeft className="canvas-layout-preset-icon" aria-hidden="true" strokeWidth={1.75} />
                  ) : preset.id === 'custom' ? (
                    <Grid2x2 className="canvas-layout-preset-icon" aria-hidden="true" strokeWidth={1.75} />
                  ) : (
                    <span className="canvas-layout-preset-auto" aria-hidden="true">
                      A
                    </span>
                  )}
                </button>
              ))}
            </div>

            {container.layoutMode === 'custom' ? (
              <div className="canvas-layout-custom-controls" role="group" aria-label={t(locale, 'workbench.layoutCustom')}>
                <label className="canvas-layout-custom-field">
                  <span>{t(locale, 'workbench.layoutColumns')}</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={normalizedCustomLayout.columns}
                    className="vb-input canvas-layout-custom-input"
                    onChange={(event) => updateCustomLayoutDimension('columns', Number(event.target.value))}
                  />
                </label>
                <label className="canvas-layout-custom-field">
                  <span>{t(locale, 'workbench.layoutRows')}</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={normalizedCustomLayout.rows}
                    className="vb-input canvas-layout-custom-input"
                    onChange={(event) => updateCustomLayoutDimension('rows', Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}

            {showUtilityBar && !detachedReadonly ? (
              <WorkbenchUtilityActions
                locale={locale}
                variant="header"
                onOpenStationSearch={onOpenStationSearch}
                onOpenStationManage={onOpenStationManage}
                pinned={pinned}
                pinDisabled={container.mode !== 'docked'}
                onTogglePinnedWorkbenchContainer={
                  onTogglePinnedWorkbenchContainer
                    ? () => {
                        onTogglePinnedWorkbenchContainer(container.id)
                      }
                    : undefined
                }
                onCreateContainer={onCreateContainer}
              />
            ) : null}

            {!detachedReadonly ? (
              <>
                {container.mode === 'floating' ? (
                  <button
                    type="button"
                    className="canvas-header-icon-button"
                    onClick={() => onDockContainer(container.id)}
                    aria-label={t(locale, 'workbench.dockContainer')}
                    title={t(locale, 'workbench.dockContainer')}
                  >
                    <BetweenHorizontalStart className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="canvas-header-icon-button"
                    onClick={() => onFloatContainer(container.id)}
                    aria-label={t(locale, 'workbench.pinContainer')}
                    title={t(locale, 'workbench.pinContainer')}
                  >
                    <Pin className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  type="button"
                  className="canvas-header-icon-button"
                  onClick={() => onDetachContainer(container.id)}
                  aria-label={canDetach ? t(locale, 'workbench.detachContainer') : t(locale, 'workbench.emptyCanvasDetail')}
                  title={canDetach ? t(locale, 'workbench.detachContainer') : t(locale, 'workbench.emptyCanvasDetail')}
                  disabled={!canDetach}
                >
                  <MonitorUp className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
                </button>
                {container.mode === 'detached' ? (
                  <button
                    type="button"
                    className={['canvas-header-icon-button', container.topmost ? 'active' : ''].join(' ')}
                    onClick={() => onToggleContainerTopmost(container.id)}
                    aria-label={container.topmost ? t(locale, 'workbench.unpinContainer') : t(locale, 'workbench.pinContainer')}
                    title={container.topmost ? t(locale, 'workbench.unpinContainer') : t(locale, 'workbench.pinContainer')}
                    aria-pressed={container.topmost}
                  >
                    {container.topmost ? (
                      <PinOff className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
                    ) : (
                      <Pin className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
                    )}
                  </button>
                ) : null}
                {canDeleteContainer ? (
                  <button
                    type="button"
                    className="canvas-header-icon-button is-danger"
                    onClick={() => onDeleteContainer?.(container.id)}
                    aria-label={t(locale, 'workbench.removeContainer')}
                    title={t(locale, 'workbench.removeContainer')}
                  >
                    <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={['canvas-header-icon-button', container.topmost ? 'active' : ''].join(' ')}
                  onClick={() => onToggleContainerTopmost(container.id)}
                  aria-label={container.topmost ? t(locale, 'workbench.unpinContainer') : t(locale, 'workbench.pinContainer')}
                  title={container.topmost ? t(locale, 'workbench.unpinContainer') : t(locale, 'workbench.pinContainer')}
                  aria-pressed={container.topmost}
                >
                  {container.topmost ? (
                    <PinOff className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
                  ) : (
                    <Pin className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
                  )}
                </button>
                <button
                  type="button"
                  className="canvas-header-icon-button"
                  onClick={onReturnToWorkspace}
                  aria-label={t(locale, 'workbench.returnToWorkspace')}
                  title={t(locale, 'workbench.returnToWorkspace')}
                >
                  <AppIcon name="rotate-ccw" className="vb-icon" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {stations.length > 0 ? (
        fullscreenStation ? (
          <div className="station-grid fullscreen-mode fullscreen-focus" ref={gridRef}>
            {renderStationCard(fullscreenStation, {
              fullscreen: true,
              fullscreenMode: true,
            })}
          </div>
        ) : container.layoutMode === 'focus' ? (
          <div className="station-grid focus-mode" ref={gridRef} style={focusGridStyle}>
            <div className="focus-main" style={stations.length > 1 ? { gridColumn: '1 / 2', gridRow: '1 / 2' } : undefined}>
              <div className="focus-main-stage">
                {stations.map((station) =>
                  renderStationCard(station, {
                    focusHidden: station.id !== selectedStationId,
                  }),
                )}
              </div>
            </div>
            {stations.length > 1 ? (
              <div className="focus-ring" style={{ gridColumn: '2 / 3', gridRow: '1 / 2' }}>
                {stations
                  .filter((station) => station.id !== selectedStationId)
                  .map((station) => (
                    <FocusRailItem
                      key={station.id}
                      locale={locale}
                      station={station}
                      unreadCount={terminalByStation[station.id]?.unreadCount ?? 0}
                      onSelectStation={(stationId) => onSelectStation(container.id, stationId)}
                    />
                  ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            ref={gridRef}
            className={['station-grid', container.layoutMode === 'custom' ? 'custom-layout' : 'auto-layout'].join(' ')}
            style={gridStyle}
            data-layout-mode={container.layoutMode === 'custom' ? 'fixed' : 'auto'}
            data-layout-preset={container.layoutMode}
          >
            {stations.map((station) => renderStationCard(station))}
          </div>
        )
      ) : (
        <div className="station-grid-empty">
          <div className="station-grid-empty-copy">
            <strong>{t(locale, 'workbench.emptyCanvasTitle', { index: containerIndex + 1 })}</strong>
            <p>{t(locale, 'workbench.emptyCanvasDetail')}</p>
          </div>
          {canDeleteContainer ? (
            <div className="station-grid-empty-actions">
              <button
                type="button"
                className="canvas-header-icon-button is-danger"
                onClick={() => onDeleteContainer?.(container.id)}
                aria-label={t(locale, 'workbench.removeContainer')}
                title={t(locale, 'workbench.removeContainer')}
              >
                <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

export const WorkbenchCanvasPanel = memo(WorkbenchCanvasPanelView)
