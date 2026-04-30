import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { motion } from 'motion/react'
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
  workspaceTransitioning?: boolean
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

const ROLE_FILTER_EXIT_MS = 160
const ROLE_FILTER_ENTER_MS = 180

interface ExitingStationSnapshot {
  stationId: string
  top: number
  left: number
  width: number
  height: number
}

export function resolveFocusStageStationVisibility(
  stationId: string,
  selectedStationId: string | null,
  slotMode: 'stable' | 'entering' | 'exiting' | 'parked',
): { focusHidden: boolean; inert: boolean } {
  const focusHidden = slotMode !== 'parked' && stationId !== selectedStationId
  return {
    focusHidden,
    inert: focusHidden && slotMode !== 'exiting',
  }
}

export function resolveRenderedActiveStationId(
  layoutMode: WorkbenchLayoutMode,
  selectedStationId: string | null,
  effectiveActiveStationId: string | null,
): string | null {
  if (layoutMode === 'focus') {
    return selectedStationId ?? effectiveActiveStationId
  }
  return effectiveActiveStationId
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mediaQueryList = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setPrefersReducedMotion(mediaQueryList.matches)
    sync()
    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', sync)
      return () => {
        mediaQueryList.removeEventListener('change', sync)
      }
    }
    mediaQueryList.addListener(sync)
    return () => {
      mediaQueryList.removeListener(sync)
    }
  }, [])

  return prefersReducedMotion
}

function isSameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
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

function StationCardSlot({
  stationId,
  mode,
  snapshot,
  inert = false,
  transitionSuspended = false,
  children,
}: {
  stationId: string
  mode: 'stable' | 'entering' | 'exiting' | 'parked'
  snapshot?: ExitingStationSnapshot | null
  inert?: boolean
  transitionSuspended?: boolean
  children: ReactNode
}) {
  const reducedMotion = usePrefersReducedMotion()
  const isParked = mode === 'parked'
  const isExiting = mode === 'exiting'
  const motionDisabled = reducedMotion || transitionSuspended

  return (
    <motion.div
      data-station-slot-id={stationId}
      className={[
        'station-card-slot',
        isParked ? 'station-card-slot--parked' : '',
        mode === 'entering' ? 'station-card-slot--entering' : '',
        mode === 'exiting' ? 'station-card-slot--exiting' : '',
        inert ? 'station-card-slot--inert' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      layout={!motionDisabled && !isParked && !isExiting}
      initial={false}
      animate={isParked || mode === 'exiting' ? { opacity: 0 } : { opacity: 1 }}
      transition={{
        opacity: {
          duration: motionDisabled
            ? 0
            : (mode === 'entering' ? ROLE_FILTER_ENTER_MS : ROLE_FILTER_EXIT_MS) / 1000,
          ease: [0.32, 0.72, 0, 1],
          delay: 0,
        },
        layout: motionDisabled
          ? { duration: 0 }
          : { type: 'spring', stiffness: 320, damping: 30, mass: 0.88 },
      }}
      style={{
        pointerEvents: isParked || isExiting || inert ? 'none' : undefined,
        willChange: isParked ? undefined : 'transform, opacity',
        top: isExiting ? snapshot?.top : undefined,
        left: isExiting ? snapshot?.left : undefined,
        width: isExiting ? snapshot?.width : undefined,
        height: isExiting ? snapshot?.height : undefined,
        zIndex: inert ? 0 : isExiting ? 2 : 1,
      }}
    >
      {children}
    </motion.div>
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
  workspaceTransitioning = false,
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
  const roleFilterExitTimerRef = useRef<number | null>(null)
  const roleFilterEnterTimerRef = useRef<number | null>(null)
  const [fullscreenStationIdRaw, setFullscreenStationIdRaw] = useState<string | null>(null)
  const normalizedCustomLayout = useMemo(
    () => normalizeWorkbenchCustomLayout(container.customLayout),
    [container.customLayout],
  )
  const targetVisibleStations = useMemo(
    () => stations.filter((station) => roleFilter === 'all' || station.role === roleFilter),
    [roleFilter, stations],
  )
  const targetVisibleStationIds = useMemo(
    () => targetVisibleStations.map((station) => station.id),
    [targetVisibleStations],
  )
  const [displayedStationIds, setDisplayedStationIds] = useState<string[]>(() =>
    targetVisibleStationIds,
  )
  const displayedStationIdsRef = useRef(displayedStationIds)
  const [exitingStationSnapshots, setExitingStationSnapshots] = useState<ExitingStationSnapshot[]>([])
  const [enteringStationIds, setEnteringStationIds] = useState<string[]>([])
  const stationById = useMemo(
    () => new Map(stations.map((station) => [station.id, station])),
    [stations],
  )
  const displayedStations = useMemo(
    () =>
      displayedStationIds
        .map((stationId) => stationById.get(stationId))
        .filter((station): station is AgentStation => Boolean(station)),
    [displayedStationIds, stationById],
  )
  const displayedStationIdSet = useMemo(
    () => new Set(displayedStationIds),
    [displayedStationIds],
  )
  const exitingStationSnapshotById = useMemo(
    () => new Map(exitingStationSnapshots.map((snapshot) => [snapshot.stationId, snapshot])),
    [exitingStationSnapshots],
  )
  const enteringStationIdSet = useMemo(
    () => new Set(enteringStationIds),
    [enteringStationIds],
  )
  const captureExitingStationSnapshots = useCallback((stationIds: string[]): ExitingStationSnapshot[] => {
    const gridElement = gridRef.current
    if (!gridElement || stationIds.length === 0) {
      return []
    }
    const gridRect = gridElement.getBoundingClientRect()
    return stationIds
      .map((stationId) => {
        const slotElement = gridElement.querySelector<HTMLElement>(`[data-station-slot-id="${stationId}"]`)
        if (!slotElement) {
          return null
        }
        const slotRect = slotElement.getBoundingClientRect()
        return {
          stationId,
          top: slotRect.top - gridRect.top,
          left: slotRect.left - gridRect.left,
          width: slotRect.width,
          height: slotRect.height,
        }
      })
      .filter((snapshot): snapshot is ExitingStationSnapshot => Boolean(snapshot))
  }, [])
  const clearRoleFilterTimers = useCallback(() => {
    if (roleFilterEnterTimerRef.current !== null) {
      window.clearTimeout(roleFilterEnterTimerRef.current)
      roleFilterEnterTimerRef.current = null
    }
    if (roleFilterExitTimerRef.current !== null) {
      window.clearTimeout(roleFilterExitTimerRef.current)
      roleFilterExitTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    displayedStationIdsRef.current = displayedStationIds
  }, [displayedStationIds])

  useLayoutEffect(() => {
    clearRoleFilterTimers()

    const availableStationIds = new Set(stations.map((station) => station.id))
    const currentDisplayedStationIds = displayedStationIdsRef.current.filter((stationId) =>
      availableStationIds.has(stationId),
    )
    const nextDisplayedStationIds = targetVisibleStationIds.filter((stationId) =>
      availableStationIds.has(stationId),
    )

    if (!isSameStringArray(currentDisplayedStationIds, displayedStationIdsRef.current)) {
      displayedStationIdsRef.current = currentDisplayedStationIds
      setDisplayedStationIds(currentDisplayedStationIds)
    }

    if (isSameStringArray(currentDisplayedStationIds, nextDisplayedStationIds)) {
      setExitingStationSnapshots([])
      setEnteringStationIds([])
      return
    }

    const exitingIds = currentDisplayedStationIds.filter(
      (stationId) => !nextDisplayedStationIds.includes(stationId),
    )
    const enteringIds = nextDisplayedStationIds.filter(
      (stationId) => !currentDisplayedStationIds.includes(stationId),
    )

    displayedStationIdsRef.current = nextDisplayedStationIds
    setDisplayedStationIds(nextDisplayedStationIds)
    setExitingStationSnapshots(captureExitingStationSnapshots(exitingIds))
    if (enteringIds.length > 0) {
      setEnteringStationIds(enteringIds)
      roleFilterEnterTimerRef.current = window.setTimeout(() => {
        setEnteringStationIds([])
        roleFilterEnterTimerRef.current = null
      }, ROLE_FILTER_ENTER_MS)
    }
    if (enteringIds.length === 0) {
      setEnteringStationIds([])
    }
    if (exitingIds.length > 0) {
      roleFilterExitTimerRef.current = window.setTimeout(() => {
        setExitingStationSnapshots([])
        roleFilterExitTimerRef.current = null
      }, ROLE_FILTER_EXIT_MS)
    } else {
      setExitingStationSnapshots([])
    }
  }, [captureExitingStationSnapshots, clearRoleFilterTimers, stations, targetVisibleStationIds])

  useEffect(() => {
    return () => {
      clearRoleFilterTimers()
    }
  }, [clearRoleFilterTimers])

  const selectedStationId = useMemo(
    () => {
      if (
        container.activeStationId &&
        displayedStations.some((station) => station.id === container.activeStationId)
      ) {
        return container.activeStationId
      }
      return displayedStations[0]?.id ?? null
    },
    [container.activeStationId, displayedStations],
  )
  const effectiveActiveStationId = useMemo(() => {
    if (displayedStations.some((station) => station.id === activeGlobalStationId)) {
      return activeGlobalStationId
    }
    return selectedStationId ?? activeGlobalStationId
  }, [activeGlobalStationId, displayedStations, selectedStationId])
  const renderedActiveStationId = useMemo(
    () =>
      resolveRenderedActiveStationId(
        fullscreenStationIdRaw ? 'focus' : container.layoutMode,
        fullscreenStationIdRaw ?? selectedStationId,
        effectiveActiveStationId,
      ),
    [container.layoutMode, effectiveActiveStationId, fullscreenStationIdRaw, selectedStationId],
  )
  const fullscreenStation = useMemo(
    () => displayedStations.find((station) => station.id === fullscreenStationIdRaw) ?? null,
    [displayedStations, fullscreenStationIdRaw],
  )
  const panelTitle = useMemo(
    () =>
      buildPanelTitle(
        locale,
        container,
        displayedStations.length > 0 ? displayedStations : stations,
        containerIndex,
      ),
    [container, containerIndex, displayedStations, locale, stations],
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

    if (!detachedReadonly && onTogglePinnedWorkbenchContainer) {
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
    if (container.layoutMode === 'focus' || displayedStations.length === 0) {
      return undefined
    }
    if (container.layoutMode === 'custom') {
      return {
        '--station-grid-columns': String(normalizedCustomLayout.columns),
        '--station-grid-rows': String(normalizedCustomLayout.rows),
      }
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(displayedStations.length)))
    const rows = Math.max(1, Math.ceil(displayedStations.length / columns))
    return {
      '--station-grid-columns': String(columns),
      '--station-grid-rows': String(rows),
    }
  }, [
    container.layoutMode,
    displayedStations.length,
    normalizedCustomLayout.columns,
    normalizedCustomLayout.rows,
  ])
  const focusGridStyle = useMemo<CSSProperties | undefined>(() => {
    if (container.layoutMode !== 'focus' || displayedStations.length <= 1) {
      return undefined
    }
    return {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(11rem, clamp(11rem, 28%, 22rem))',
      gridTemplateRows: 'minmax(0, 1fr)',
    }
  }, [container.layoutMode, displayedStations.length])

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

  const resolveStationSlotMode = useCallback(
    (stationId: string): 'stable' | 'entering' | 'exiting' | 'parked' => {
      if (!displayedStationIdSet.has(stationId)) {
        return exitingStationSnapshotById.has(stationId) ? 'exiting' : 'parked'
      }
      if (enteringStationIdSet.has(stationId)) {
        return 'entering'
      }
      return 'stable'
    },
    [displayedStationIdSet, enteringStationIdSet, exitingStationSnapshotById],
  )

  const renderStationCard = useCallback(
    (
      station: AgentStation,
      options?: {
        focusHidden?: boolean
        inert?: boolean
        fullscreen?: boolean
        fullscreenMode?: boolean
        slotMode?: 'stable' | 'entering' | 'exiting' | 'parked'
      },
    ) => {
      return (
        <StationCardSlot
          key={station.id}
          stationId={station.id}
          mode={options?.slotMode ?? 'stable'}
          snapshot={exitingStationSnapshotById.get(station.id) ?? null}
          inert={Boolean(options?.inert)}
          transitionSuspended={workspaceTransitioning}
        >
          <StationCard
            locale={locale}
            appearanceVersion={appearanceVersion}
            performanceDebugEnabled={performanceDebugEnabled}
            station={station}
            active={station.id === renderedActiveStationId}
            runtime={terminalByStation[station.id]}
            agentRunning={agentRunningByStationId[station.id] ?? false}
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
        </StationCardSlot>
      )
    },
    [
      effectiveActiveStationId,
      renderedActiveStationId,
      agentRunningByStationId,
      appearanceVersion,
      performanceDebugEnabled,
      channelBotBindingsByStationId,
      container.id,
      detachedReadonly,
      exitingStationSnapshotById,
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
      workspaceTransitioning,
    ],
  )

  return (
    <section
      data-container-id={container.id}
      className={[
        'panel',
        'workbench-canvas',
        `mode-${container.mode}`,
        displayedStations.some((station) => station.id === effectiveActiveStationId) ? 'is-active-container' : '',
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
                <span className="canvas-header-pill" role="listitem" title={t(locale, 'workbench.stationCount', { count: displayedStations.length })}>
                  <AppIcon name="stations" className="canvas-header-pill-icon" aria-hidden="true" />
                  <strong className="canvas-header-pill-value">{displayedStations.length}</strong>
                  <span className="vb-sr-only">{t(locale, 'workbench.stationCount', { count: displayedStations.length })}</span>
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
              slotMode: resolveStationSlotMode(fullscreenStation.id),
            })}
          </div>
        ) : displayedStations.length === 0 ? (
          <div className="station-grid-empty">
            <div className="station-grid-empty-copy">
              <strong>{locale === 'zh-CN' ? '没有匹配角色' : 'No Matching Roles'}</strong>
              <p>{locale === 'zh-CN' ? '当前筛选条件下没有匹配的角色。' : 'No roles match the current filter.'}</p>
            </div>
            {stations.map((station) =>
              renderStationCard(station, {
                slotMode: resolveStationSlotMode(station.id),
              }),
            )}
          </div>
        ) : container.layoutMode === 'focus' ? (
          <div className="station-grid focus-mode" ref={gridRef} style={focusGridStyle}>
            <div
              className="focus-main"
              style={displayedStations.length > 1 ? { gridColumn: '1 / 2', gridRow: '1 / 2' } : undefined}
            >
              <div className="focus-main-stage">
                {stations.map((station) => {
                  const slotMode = resolveStationSlotMode(station.id)
                  const visibility = resolveFocusStageStationVisibility(station.id, selectedStationId, slotMode)
                  return renderStationCard(station, {
                    focusHidden: visibility.focusHidden,
                    inert: visibility.inert,
                    slotMode,
                  })
                })}
              </div>
            </div>
            {displayedStations.length > 1 ? (
              <div className="focus-ring" style={{ gridColumn: '2 / 3', gridRow: '1 / 2' }}>
                {displayedStations
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
            {stations.map((station) =>
              renderStationCard(station, {
                slotMode: resolveStationSlotMode(station.id),
              }),
            )}
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
