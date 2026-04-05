import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  BetweenHorizontalStart,
  BringToFront,
  Grid2x2,
  LayoutPanelLeft,
  MonitorUp,
  ArrowUpToLine,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
} from 'lucide-react'
import { StationCard } from './StationCard'
import { StationActivityComet } from './StationActivityComet'
import type { AgentStation, StationRole } from './station-model'
import type { WorkbenchContainer as WorkbenchContainerModel } from './workbench-container-model'
import {
  normalizeWorkbenchCustomLayout,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from './workbench-layout-model'
import { resolveWorkbenchLayoutPresetVisual } from './workbench-layout-preset-visuals'
import { useStationActivitySignal } from './useStationActivitySignal'
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
import { orderWorkbenchHeaderActions, type WorkbenchHeaderActionId } from './workbench-header-actions'
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
  performanceDebugEnabled?: boolean
  container: WorkbenchContainerModel
  containerIndex: number
  stations: AgentStation[]
  roleFilter?: StationRole | 'all'
  activeGlobalStationId: string
  terminalByStation: Record<string, WorkbenchStationRuntime>
  agentRunningByStationId?: Record<string, boolean>
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
  const activitySignal = useStationActivitySignal(unreadCount)

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
        {activitySignal ? (
          <StationActivityComet
            locale={locale}
            level={activitySignal}
            size="compact"
            className="focus-rail-item-comet"
          />
        ) : null}
      </div>
      <p className="focus-rail-item-path">{station.agentWorkdirRel}</p>
    </button>
  )
}

function WorkbenchCanvasPanelView({
  locale,
  appearanceVersion,
  performanceDebugEnabled = false,
  container,
  containerIndex,
  stations,
  roleFilter = 'all',
  activeGlobalStationId,
  terminalByStation,
  agentRunningByStationId = {},
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
  const visibleStations = useMemo(
    () => stations.filter((station) => roleFilter === 'all' || station.role === roleFilter),
    [roleFilter, stations],
  )
  const selectedStationId = useMemo(
    () => {
      if (
        container.activeStationId &&
        visibleStations.some((station) => station.id === container.activeStationId)
      ) {
        return container.activeStationId
      }
      return visibleStations[0]?.id ?? null
    },
    [container.activeStationId, visibleStations],
  )
  const effectiveActiveStationId = useMemo(() => {
    if (roleFilter === 'all') {
      return activeGlobalStationId
    }
    if (visibleStations.some((station) => station.id === activeGlobalStationId)) {
      return activeGlobalStationId
    }
    return selectedStationId ?? activeGlobalStationId
  }, [activeGlobalStationId, roleFilter, selectedStationId, visibleStations])
  const fullscreenStation = useMemo(
    () =>
      stations.find(
        (station) =>
          station.id === fullscreenStationIdRaw &&
          (roleFilter === 'all' || station.role === roleFilter),
      ) ?? null,
    [fullscreenStationIdRaw, roleFilter, stations],
  )
  const panelTitle = useMemo(
    () => buildPanelTitle(locale, container, stations, containerIndex),
    [container, containerIndex, locale, stations],
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
  const orderedPrimaryHeaderActions = useMemo(() => {
    const actions: Array<{ id: WorkbenchHeaderActionId; element: ReactNode }> = []

    if (!detachedReadonly && container.mode === 'floating') {
      actions.push({
        id: 'dock',
        element: (
          <button
            key="dock"
            type="button"
            className="canvas-header-icon-button"
            onClick={() => onDockContainer(container.id)}
            aria-label={t(locale, 'workbench.dockContainer')}
            title={t(locale, 'workbench.dockContainer')}
          >
            <BetweenHorizontalStart className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
          </button>
        ),
      })
    }

    if (!detachedReadonly && container.mode !== 'floating') {
      actions.push({
        id: 'float',
        element: (
          <button
            key="float"
            type="button"
            className="canvas-header-icon-button"
            onClick={() => onFloatContainer(container.id)}
            aria-label={t(locale, 'workbench.floatContainer')}
            title={t(locale, 'workbench.floatContainer')}
          >
            <PictureInPicture2 className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
          </button>
        ),
      })
    }

    if (showUtilityBar && !detachedReadonly && onOpenStationSearch) {
      actions.push({
        id: 'search',
        element: (
          <button
            key="search"
            type="button"
            className="canvas-header-icon-button"
            onClick={onOpenStationSearch}
            aria-label={t(locale, 'station.filter.search')}
            title={t(locale, 'station.filter.search')}
          >
            <AppIcon name="search" className="vb-icon vb-icon-overview" aria-hidden="true" />
          </button>
        ),
      })
    }

    if (showUtilityBar && !detachedReadonly && onOpenStationManage) {
      actions.push({
        id: 'add_agent',
        element: (
          <button
            key="add-agent"
            type="button"
            className="canvas-header-icon-button"
            onClick={onOpenStationManage}
            aria-label={t(locale, 'workbench.addStation')}
            title={t(locale, 'workbench.addStation')}
          >
            <AppIcon name="user-pen" className="vb-icon vb-icon-overview" aria-hidden="true" />
          </button>
        ),
      })
    }

    if (showUtilityBar && !detachedReadonly && onCreateContainer) {
      actions.push({
        id: 'add_container',
        element: (
          <button
            key="add-container"
            type="button"
            className="canvas-header-icon-button"
            onClick={onCreateContainer}
            aria-label={t(locale, 'workbench.addContainer')}
            title={t(locale, 'workbench.addContainer')}
          >
            <AppIcon name="copy" className="vb-icon vb-icon-overview" aria-hidden="true" />
          </button>
        ),
      })
    }

    if (!detachedReadonly) {
      actions.push({
        id: 'detach',
        element: (
          <button
            key="detach"
            type="button"
            className="canvas-header-icon-button"
            onClick={() => onDetachContainer(container.id)}
            aria-label={canDetach ? t(locale, 'workbench.detachContainer') : t(locale, 'workbench.emptyCanvasDetail')}
            title={canDetach ? t(locale, 'workbench.detachContainer') : t(locale, 'workbench.emptyCanvasDetail')}
            disabled={!canDetach}
          >
            <MonitorUp className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
          </button>
        ),
      })
    }

    if (container.mode === 'detached') {
      actions.push({
        id: 'topmost',
        element: (
          <button
            key="topmost"
            type="button"
            className={['canvas-header-icon-button', container.topmost ? 'active' : ''].join(' ')}
            onClick={() => onToggleContainerTopmost(container.id)}
            aria-label={container.topmost ? t(locale, 'workbench.unpinContainer') : t(locale, 'workbench.pinContainer')}
            title={container.topmost ? t(locale, 'workbench.unpinContainer') : t(locale, 'workbench.pinContainer')}
            aria-pressed={container.topmost}
          >
            {container.topmost ? (
              <BringToFront className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
            ) : (
              <ArrowUpToLine className="vb-icon" aria-hidden="true" strokeWidth={1.75} />
            )}
          </button>
        ),
      })
    }

    if (showUtilityBar && !detachedReadonly && onTogglePinnedWorkbenchContainer) {
      actions.push({
        id: 'pin',
        element: (
          <button
            key="pin"
            type="button"
            className={['canvas-header-icon-button', pinned ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => onTogglePinnedWorkbenchContainer(container.id)}
            aria-label={pinned ? t(locale, 'workbench.unpinRightDock') : t(locale, 'workbench.pinRightDock')}
            title={pinned ? t(locale, 'workbench.unpinRightDock') : t(locale, 'workbench.pinRightDock')}
            aria-pressed={pinned}
            disabled={container.mode !== 'docked'}
          >
            {pinned ? (
              <PanelRightClose className="vb-icon vb-icon-overview" aria-hidden="true" strokeWidth={1.75} />
            ) : (
              <PanelRightOpen className="vb-icon vb-icon-overview" aria-hidden="true" strokeWidth={1.75} />
            )}
          </button>
        ),
      })
    }

    return orderWorkbenchHeaderActions(actions)
  }, [
    canDetach,
    container.id,
    container.mode,
    container.topmost,
    detachedReadonly,
    locale,
    onCreateContainer,
    onDetachContainer,
    onDockContainer,
    onFloatContainer,
    onOpenStationManage,
    onOpenStationSearch,
    onToggleContainerTopmost,
    onTogglePinnedWorkbenchContainer,
    pinned,
    showUtilityBar,
  ])
  const secondaryHeaderActions = useMemo(() => {
    const actions: ReactNode[] = []

    if (detachedReadonly) {
      actions.push(
        <button
          key="return-to-workspace"
          type="button"
          className="canvas-header-icon-button"
          onClick={onReturnToWorkspace}
          aria-label={t(locale, 'workbench.returnToWorkspace')}
          title={t(locale, 'workbench.returnToWorkspace')}
        >
          <AppIcon name="rotate-ccw" className="vb-icon" aria-hidden="true" />
        </button>,
      )
    }

    if (!detachedReadonly && canDeleteContainer) {
      actions.push(
        <button
          key="delete-container"
          type="button"
          className="canvas-header-icon-button is-danger"
          onClick={() => onDeleteContainer?.(container.id)}
          aria-label={t(locale, 'workbench.removeContainer')}
          title={t(locale, 'workbench.removeContainer')}
        >
          <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
        </button>,
      )
    }

    return actions
  }, [canDeleteContainer, container.id, detachedReadonly, locale, onDeleteContainer, onReturnToWorkspace])
  const gridStyle = useMemo<WorkbenchGridStyle | undefined>(() => {
    if (container.layoutMode === 'focus' || visibleStations.length === 0) {
      return undefined
    }
    if (container.layoutMode === 'custom') {
      return {
        '--station-grid-columns': String(normalizedCustomLayout.columns),
        '--station-grid-rows': String(normalizedCustomLayout.rows),
      }
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(visibleStations.length)))
    const rows = Math.max(1, Math.ceil(visibleStations.length / columns))
    return {
      '--station-grid-columns': String(columns),
      '--station-grid-rows': String(rows),
    }
  }, [
    container.layoutMode,
    normalizedCustomLayout.columns,
    normalizedCustomLayout.rows,
    visibleStations.length,
  ])
  const focusGridStyle = useMemo<CSSProperties | undefined>(() => {
    if (container.layoutMode !== 'focus' || visibleStations.length <= 1) {
      return undefined
    }
    return {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(11rem, clamp(11rem, 28%, 22rem))',
      gridTemplateRows: 'minmax(0, 1fr)',
    }
  }, [container.layoutMode, visibleStations.length])

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
    if (fullscreenStation) {
      return
    }
    setFullscreenStationIdRaw(null)
  }, [fullscreenStation, fullscreenStationIdRaw])

  const renderStationCard = useCallback(
    (station: AgentStation, options?: { focusHidden?: boolean; fullscreen?: boolean; fullscreenMode?: boolean }) => (
      <StationCard
        key={station.id}
        locale={locale}
        appearanceVersion={appearanceVersion}
        performanceDebugEnabled={performanceDebugEnabled}
        station={station}
        active={station.id === effectiveActiveStationId}
        runtime={terminalByStation[station.id]}
        agentRunning={agentRunningByStationId[station.id] ?? false}
        taskSignal={taskSignalByStationId[station.id]}
        channelBotBindings={channelBotBindingsByStationId[station.id]}
        isFullscreen={Boolean(options?.fullscreen)}
        isFullscreenMode={Boolean(options?.fullscreenMode)}
        isFocusHidden={Boolean(options?.focusHidden)}
        isRoleFilteredOut={roleFilter !== 'all' && station.role !== roleFilter}
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
      effectiveActiveStationId,
      agentRunningByStationId,
      appearanceVersion,
      performanceDebugEnabled,
      channelBotBindingsByStationId,
      container.id,
      detachedReadonly,
      handleEnterFullscreen,
      handleExitFullscreen,
      handleSelectStation,
      locale,
      roleFilter,
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
        stations.some((station) => station.id === effectiveActiveStationId) ? 'is-active-container' : '',
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
              </div>
            </div>
          </div>

          <div className="canvas-header-actions" role="group" aria-label={t(locale, 'workbench.activeWindow')}>
            <div className="canvas-layout-preset-group" role="group" aria-label={t(locale, 'workbench.layoutPreset')}>
              {WORKBENCH_LAYOUT_PRESETS.map((preset) => {
                const visual = resolveWorkbenchLayoutPresetVisual(preset.id)

                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={['canvas-layout-preset-btn', preset.id === container.layoutMode ? 'active' : ''].join(' ')}
                    aria-label={t(locale, preset.labelKey)}
                    title={t(locale, preset.labelKey)}
                    onClick={() => onLayoutModeChange(container.id, preset.id)}
                  >
                    {visual.kind === 'glyph' ? (
                      <span className="canvas-layout-preset-glyph" aria-hidden="true">
                        {visual.value}
                      </span>
                    ) : visual.value === 'focus' ? (
                      <LayoutPanelLeft className="canvas-layout-preset-icon" aria-hidden="true" strokeWidth={1.75} />
                    ) : (
                      <Grid2x2 className="canvas-layout-preset-icon" aria-hidden="true" strokeWidth={1.75} />
                    )}
                  </button>
                )
              })}
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

            {secondaryHeaderActions}
            {orderedPrimaryHeaderActions.map((action) => action.element)}
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
            <div
              className="focus-main"
              style={visibleStations.length > 1 ? { gridColumn: '1 / 2', gridRow: '1 / 2' } : undefined}
            >
              <div className="focus-main-stage">
                {stations.map((station) =>
                  renderStationCard(station, {
                    focusHidden: station.id !== selectedStationId,
                  }),
                )}
              </div>
            </div>
            {visibleStations.length > 1 ? (
              <div className="focus-ring" style={{ gridColumn: '2 / 3', gridRow: '1 / 2' }}>
                {visibleStations
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
