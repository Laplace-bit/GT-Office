import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AgentStation } from './station-model'
import { WorkbenchCanvasPanel } from './WorkbenchCanvasPanel'
import { WorkbenchUtilityActions } from './WorkbenchUtilityActions'
import {
  findContainerByStationId,
  sortFloatingContainers,
  WORKBENCH_FLOATING_MAX_HEIGHT,
  WORKBENCH_FLOATING_MAX_WIDTH,
  WORKBENCH_FLOATING_MAX_X,
  WORKBENCH_FLOATING_MAX_Y,
  WORKBENCH_FLOATING_MIN_HEIGHT,
  WORKBENCH_FLOATING_MIN_WIDTH,
  WORKBENCH_FLOATING_MIN_X,
  WORKBENCH_FLOATING_MIN_Y,
  type WorkbenchContainer as WorkbenchContainerModel,
  type WorkbenchContainerFrame,
} from './workbench-container-model'
import type { WorkbenchCustomLayout, WorkbenchLayoutMode } from './workbench-layout-model'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import type { StationTerminalSinkBindingHandler } from '@features/terminal'
import type { RenderedScreenSnapshot, ToolCommandSummary } from '@shell/integration/desktop-api'
import type { TerminalFileDropPayload } from '@shell/utils/terminal-file-drop'
import type { StationChannelBotBindingSummary } from '@features/tool-adapter'
import type { StationActionDescriptor } from './station-action-model'
import type { WorkbenchStationRuntime } from './TerminalStationPane'
import { createStationTerminalFrameFlushScheduler } from '@features/terminal/station-terminal-frame-flush-scheduler'
import { scheduleStationScrollFrame } from './station-scroll-frame'
import './WorkbenchCanvas.scss'

interface FloatingCanvasStyle extends CSSProperties {
  '--floating-layer-z'?: string
  '--workbench-floating-x'?: string
  '--workbench-floating-y'?: string
  '--workbench-floating-width'?: string
  '--workbench-floating-height'?: string
}

interface DockGridStyle extends CSSProperties {
  '--workbench-container-columns'?: string
  '--workbench-container-rows'?: string
}

const STATION_SCROLL_FRAME_FALLBACK_MS = 48

type FloatingResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type FloatingInteractionState =
  | {
      kind: 'drag'
      containerId: string
      rect: DOMRect
      startX: number
      startY: number
      frame: WorkbenchContainerFrame
      previewFrame: WorkbenchContainerFrame
      active: boolean
    }
  | {
      kind: 'resize'
      containerId: string
      direction: FloatingResizeDirection
      rect: DOMRect
      startX: number
      startY: number
      frame: WorkbenchContainerFrame
      previewFrame: WorkbenchContainerFrame
      active: boolean
    }

interface StationPointerDragState {
  stationId: string
  sourceContainerId: string
  startX: number
  startY: number
  active: boolean
}

interface StationDropTarget {
  containerId: string
  anchorStationId: string | null
  placement: 'before' | 'after'
}

interface FloatingInteractionPresentation {
  containerId: string
  kind: FloatingInteractionState['kind']
}

interface StationDragPresentation {
  stationId: string
  target: StationDropTarget | null
}

interface WorkbenchCanvasProps {
  locale: Locale
  appearanceVersion: string
  performanceDebugEnabled?: boolean
  workspaceId?: string | null
  workspaceCwd?: string | null
  showStage?: boolean
  showFloatingPortal?: boolean
  floatingVisibility?: 'all' | 'topmost' | 'non_topmost'
  minimizedDockPortalTarget?: HTMLElement | null
  workspaceTransitioning?: boolean
  stations: AgentStation[]
  roleFilter?: string
  containers: WorkbenchContainerModel[]
  activeStationId: string
  terminalByStation: Record<string, WorkbenchStationRuntime>
  taskSignalByStationId: Partial<Record<string, StationTaskSignal>>
  channelBotBindingsByStationId?: Record<string, StationChannelBotBindingSummary[]>
  pinnedWorkbenchContainerId?: string | null
  onTogglePinnedWorkbenchContainer?: (containerId: string) => void
  onSelectStation: (containerId: string, stationId: string) => void
  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onSessionRelaunch?: (
    stationId: string,
    request: import('@features/session').SessionRelaunchRequest,
  ) => void
  onForceCloseTerminal?: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onDropFilePath?: (stationId: string, payload: TerminalFileDropPayload) => Promise<void> | void
  onRunStationAction: (station: AgentStation, action: StationActionDescriptor) => void
  toolCommandsByStationId?: Record<string, ToolCommandSummary[]>
  onLayoutModeChange: (containerId: string, mode: WorkbenchLayoutMode) => void
  onCustomLayoutChange: (containerId: string, layout: WorkbenchCustomLayout) => void
  onFullscreenStationChange: (containerId: string, stationId: string | null) => void
  onMinimizedStationIdsChange: (containerId: string, stationIds: string[]) => void
  onFloatContainer: (containerId: string) => void
  onDockContainer: (containerId: string) => void
  onDetachContainer: (containerId: string) => void
  onToggleContainerTopmost: (containerId: string) => void
  onCreateContainer: () => void
  onDeleteContainer: (containerId: string) => void
  onMoveStationToContainer: (
    stationId: string,
    targetContainerId: string,
    anchorStationId?: string | null,
    placement?: 'before' | 'after',
  ) => void
  onMoveFloatingContainer: (containerId: string, input: { x: number; y: number }) => void
  onResizeFloatingContainer: (containerId: string, frame: WorkbenchContainerFrame) => void
  onFocusFloatingContainer: (containerId: string) => void
  onReclaimDetachedContainer: (containerId: string) => void
  scrollToStationId?: string | null
  onScrollToStationHandled?: (stationId: string) => void
  onOpenStationManage: () => void
  onOpenStationSearch: () => void
  onEditStation: (station: AgentStation) => void
  onRemoveStation: (stationId: string) => void
}

const FLOATING_RESIZE_DIRECTIONS: readonly FloatingResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const FLOATING_EDGE_GUTTER_PX = 12

function clampFrameValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveFloatingEdgeGutter(rect: DOMRect): { x: number; y: number } {
  return {
    x: Math.min(FLOATING_EDGE_GUTTER_PX / Math.max(1, rect.width), 0.5),
    y: Math.min(FLOATING_EDGE_GUTTER_PX / Math.max(1, rect.height), 0.5),
  }
}

function clampFloatingFramePosition(
  frame: WorkbenchContainerFrame,
  rect: DOMRect,
  input: { x: number; y: number },
): { x: number; y: number } {
  const gutter = resolveFloatingEdgeGutter(rect)
  return {
    x: clampFrameValue(
      input.x,
      WORKBENCH_FLOATING_MIN_X,
      Math.max(WORKBENCH_FLOATING_MIN_X, WORKBENCH_FLOATING_MAX_X - gutter.x - frame.width),
    ),
    y: clampFrameValue(
      input.y,
      WORKBENCH_FLOATING_MIN_Y,
      Math.max(WORKBENCH_FLOATING_MIN_Y, WORKBENCH_FLOATING_MAX_Y - gutter.y - frame.height),
    ),
  }
}

function resizeFloatingFrame(
  frame: WorkbenchContainerFrame,
  direction: FloatingResizeDirection,
  deltaX: number,
  deltaY: number,
  rect: DOMRect,
): WorkbenchContainerFrame {
  const gutter = resolveFloatingEdgeGutter(rect)
  const maxRight = WORKBENCH_FLOATING_MAX_X - gutter.x
  const maxBottom = WORKBENCH_FLOATING_MAX_Y - gutter.y
  let left = frame.x
  let top = frame.y
  let right = frame.x + frame.width
  let bottom = frame.y + frame.height

  if (direction.includes('e')) {
    right = clampFrameValue(
      right + deltaX,
      left + WORKBENCH_FLOATING_MIN_WIDTH,
      Math.min(maxRight, left + WORKBENCH_FLOATING_MAX_WIDTH),
    )
  }
  if (direction.includes('w')) {
    left = clampFrameValue(
      left + deltaX,
      Math.max(WORKBENCH_FLOATING_MIN_X, right - WORKBENCH_FLOATING_MAX_WIDTH),
      right - WORKBENCH_FLOATING_MIN_WIDTH,
    )
  }
  if (direction.includes('s')) {
    bottom = clampFrameValue(
      bottom + deltaY,
      top + WORKBENCH_FLOATING_MIN_HEIGHT,
      Math.min(maxBottom, top + WORKBENCH_FLOATING_MAX_HEIGHT),
    )
  }
  if (direction.includes('n')) {
    top = clampFrameValue(
      top + deltaY,
      Math.max(WORKBENCH_FLOATING_MIN_Y, bottom - WORKBENCH_FLOATING_MAX_HEIGHT),
      bottom - WORKBENCH_FLOATING_MIN_HEIGHT,
    )
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function buildFloatingCanvasStyle(
  container: WorkbenchContainerModel,
  _surfaceRect: DOMRect | null,
  zIndex: number,
): FloatingCanvasStyle {
  const fallbackWidth = window.innerWidth
  const fallbackHeight = window.innerHeight
  const frame = container.frame ?? { x: 0.08, y: 0.08, width: 0.44, height: 0.52 }
  return {
    '--floating-layer-z': String(zIndex),
    '--workbench-floating-x': `${fallbackWidth * frame.x}px`,
    '--workbench-floating-y': `${fallbackHeight * frame.y}px`,
    '--workbench-floating-width': `${fallbackWidth * frame.width}px`,
    '--workbench-floating-height': `${fallbackHeight * frame.height}px`,
  }
}

function resolveFloatingInteractionRect(): DOMRect {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

function applyFloatingFramePreview(
  element: HTMLElement | undefined,
  rect: DOMRect,
  frame: WorkbenchContainerFrame,
) {
  if (!element) {
    return
  }
  element.style.setProperty('--workbench-floating-x', `${rect.width * frame.x}px`)
  element.style.setProperty('--workbench-floating-y', `${rect.height * frame.y}px`)
  element.style.setProperty('--workbench-floating-width', `${rect.width * frame.width}px`)
  element.style.setProperty('--workbench-floating-height', `${rect.height * frame.height}px`)
}

function resolveFloatingPreviewFrame(
  interaction: FloatingInteractionState,
  clientX: number,
  clientY: number,
): WorkbenchContainerFrame {
  const deltaX = (clientX - interaction.startX) / Math.max(1, interaction.rect.width)
  const deltaY = (clientY - interaction.startY) / Math.max(1, interaction.rect.height)
  if (interaction.kind === 'drag') {
    const position = clampFloatingFramePosition(interaction.frame, interaction.rect, {
      x: interaction.frame.x + deltaX,
      y: interaction.frame.y + deltaY,
    })
    return {
      ...interaction.frame,
      ...position,
    }
  }
  return resizeFloatingFrame(interaction.frame, interaction.direction, deltaX, deltaY, interaction.rect)
}

function hasPointerCrossedDragThreshold(startX: number, startY: number, clientX: number, clientY: number): boolean {
  return Math.abs(clientX - startX) >= 4 || Math.abs(clientY - startY) >= 4
}

function stationDropTargetsMatch(
  left: StationDropTarget | null,
  right: StationDropTarget | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.containerId === right.containerId &&
      left.anchorStationId === right.anchorStationId &&
      left.placement === right.placement)
  )
}

function resolveStationDropTargetAtPoint(clientX: number, clientY: number): StationDropTarget | null {
  if (typeof document === 'undefined') {
    return null
  }
  const target = document.elementFromPoint(clientX, clientY)
  if (!(target instanceof HTMLElement)) {
    return null
  }
  const container = target.closest<HTMLElement>('[data-container-id]')
  const containerId = container?.dataset.containerId ?? null
  if (!containerId) {
    return null
  }
  const station = target.closest<HTMLElement>('[data-station-id]')
  const anchorStationId = station?.dataset.stationId ?? null
  if (!station || !anchorStationId || !container?.contains(station)) {
    return { containerId, anchorStationId: null, placement: 'after' }
  }
  const rect = station.getBoundingClientRect()
  return {
    containerId,
    anchorStationId,
    placement: clientY < rect.top + rect.height / 2 ? 'before' : 'after',
  }
}

function isMovableStationDropTarget(
  stationDrag: StationPointerDragState,
  target: StationDropTarget | null,
): target is StationDropTarget {
  if (!target) {
    return false
  }
  return target.containerId !== stationDrag.sourceContainerId || target.anchorStationId !== stationDrag.stationId
}

function WorkbenchCanvasView({
  locale,
  appearanceVersion,
  performanceDebugEnabled = false,
  workspaceId = null,
  workspaceCwd = null,
  showStage = true,
  showFloatingPortal = true,
  floatingVisibility = 'all',
  minimizedDockPortalTarget = null,
  workspaceTransitioning = false,
  stations,
  roleFilter = 'all',
  containers,
  activeStationId,
  terminalByStation,
  taskSignalByStationId,
  channelBotBindingsByStationId = {},
  pinnedWorkbenchContainerId = null,
  onTogglePinnedWorkbenchContainer,
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSessionRelaunch,
  onForceCloseTerminal,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRenderedScreenSnapshot,
  onDropFilePath,
  onRunStationAction,
  toolCommandsByStationId = {},
  onLayoutModeChange,
  onCustomLayoutChange,
  onFullscreenStationChange,
  onMinimizedStationIdsChange,
  onFloatContainer,
  onDockContainer,
  onDetachContainer,
  onToggleContainerTopmost,
  onCreateContainer,
  onDeleteContainer,
  onMoveStationToContainer,
  onMoveFloatingContainer,
  onResizeFloatingContainer,
  onFocusFloatingContainer,
  onReclaimDetachedContainer,
  scrollToStationId = null,
  onScrollToStationHandled,
  onOpenStationManage,
  onOpenStationSearch,
  onEditStation,
  onRemoveStation,
}: WorkbenchCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const dockGridRef = useRef<HTMLDivElement | null>(null)
  const floatingShellsRef = useRef(new Map<string, HTMLDivElement>())
  const floatingInteractionRef = useRef<FloatingInteractionState | null>(null)
  const floatingPreviewAnimationFrameRef = useRef<number | null>(null)
  const latestFloatingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const floatingSettleTimerRef = useRef<number | null>(null)
  const stationPointerDragRef = useRef<StationPointerDragState | null>(null)
  const stationDropCompletionTimerRef = useRef<number | null>(null)
  const [surfaceRect, setSurfaceRect] = useState<DOMRect | null>(null)
  const [dragTargetContainerId, setDragTargetContainerId] = useState<string | null>(null)
  const [floatingInteractionPresentation, setFloatingInteractionPresentation] =
    useState<FloatingInteractionPresentation | null>(null)
  const [settledFloatingContainerId, setSettledFloatingContainerId] = useState<string | null>(null)
  const [stationDragPresentation, setStationDragPresentation] = useState<StationDragPresentation | null>(null)
  const [completedStationDropId, setCompletedStationDropId] = useState<string | null>(null)
  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations])
  const dockedContainers = useMemo(() => containers.filter((container) => container.mode === 'docked'), [containers])
  const floatingContainers = useMemo(
    () =>
      sortFloatingContainers(
        containers.filter(
          (container) =>
            container.mode === 'floating' &&
            (floatingVisibility === 'all' ||
              (floatingVisibility === 'topmost' && container.topmost) ||
              (floatingVisibility === 'non_topmost' && !container.topmost)),
        ),
      ),
    [containers, floatingVisibility],
  )
  const utilityHostContainerId = useMemo(() => {
    const activeDockedContainer = activeStationId
      ? findContainerByStationId(dockedContainers, activeStationId)
      : null
    return activeDockedContainer?.id ?? dockedContainers[0]?.id ?? floatingContainers[0]?.id ?? null
  }, [activeStationId, dockedContainers, floatingContainers])

  useEffect(() => {
    if (!showStage) {
      setSurfaceRect(null)
      return
    }
    const element = surfaceRef.current
    if (!element) {
      return
    }
    const updateRect = () => {
      setSurfaceRect(element.getBoundingClientRect())
    }
    updateRect()
    const observer = new ResizeObserver(updateRect)
    observer.observe(element)
    window.addEventListener('resize', updateRect)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateRect)
    }
  }, [showStage])

  useEffect(() => {
    return () => {
      if (floatingPreviewAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingPreviewAnimationFrameRef.current)
      }
      if (floatingSettleTimerRef.current !== null) {
        window.clearTimeout(floatingSettleTimerRef.current)
      }
      if (stationDropCompletionTimerRef.current !== null) {
        window.clearTimeout(stationDropCompletionTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const cancelFloatingPreviewFrame = () => {
      if (floatingPreviewAnimationFrameRef.current === null) {
        return
      }
      window.cancelAnimationFrame(floatingPreviewAnimationFrameRef.current)
      floatingPreviewAnimationFrameRef.current = null
    }
    const updateFloatingPreview = (
      interaction: FloatingInteractionState,
      clientX: number,
      clientY: number,
    ) => {
      const previewFrame = resolveFloatingPreviewFrame(interaction, clientX, clientY)
      interaction.previewFrame = previewFrame
      applyFloatingFramePreview(
        floatingShellsRef.current.get(interaction.containerId),
        interaction.rect,
        previewFrame,
      )
      return previewFrame
    }
    const handlePointerMove = (event: PointerEvent) => {
      const stationDrag = stationPointerDragRef.current
      if (stationDrag) {
        if (
          !stationDrag.active &&
          hasPointerCrossedDragThreshold(
            stationDrag.startX,
            stationDrag.startY,
            event.clientX,
            event.clientY,
          )
        ) {
          stationDrag.active = true
        }
        if (stationDrag.active) {
          const target = resolveStationDropTargetAtPoint(event.clientX, event.clientY)
          const movableTarget = isMovableStationDropTarget(stationDrag, target) ? target : null
          setDragTargetContainerId(movableTarget?.containerId ?? null)
          setStationDragPresentation((previous) => {
            if (
              previous?.stationId === stationDrag.stationId &&
              stationDropTargetsMatch(previous.target, movableTarget)
            ) {
              return previous
            }
            return { stationId: stationDrag.stationId, target: movableTarget }
          })
        }
      }

      const interaction = floatingInteractionRef.current
      if (!interaction) {
        return
      }
      if (
        !interaction.active &&
        hasPointerCrossedDragThreshold(
          interaction.startX,
          interaction.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        interaction.active = true
        setFloatingInteractionPresentation({
          containerId: interaction.containerId,
          kind: interaction.kind,
        })
      }
      if (!interaction.active) {
        return
      }
      latestFloatingPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
      if (floatingPreviewAnimationFrameRef.current !== null) {
        return
      }
      const scheduledInteraction = interaction
      floatingPreviewAnimationFrameRef.current = window.requestAnimationFrame(() => {
        floatingPreviewAnimationFrameRef.current = null
        if (floatingInteractionRef.current !== scheduledInteraction) {
          return
        }
        const latestPointer = latestFloatingPointerRef.current
        if (!latestPointer) {
          return
        }
        updateFloatingPreview(scheduledInteraction, latestPointer.clientX, latestPointer.clientY)
      })
    }
    const clearDrag = (event?: PointerEvent, commit = true) => {
      const stationDrag = stationPointerDragRef.current
      let completedStationId: string | null = null
      if (commit && stationDrag?.active && event) {
        const target = resolveStationDropTargetAtPoint(event.clientX, event.clientY)
        if (isMovableStationDropTarget(stationDrag, target)) {
          onMoveStationToContainer(
            stationDrag.stationId,
            target.containerId,
            target.anchorStationId,
            target.placement,
          )
          onSelectStation(target.containerId, stationDrag.stationId)
          completedStationId = stationDrag.stationId
        }
      }
      stationPointerDragRef.current = null
      setDragTargetContainerId(null)
      setStationDragPresentation(null)

      if (completedStationId) {
        if (stationDropCompletionTimerRef.current !== null) {
          window.clearTimeout(stationDropCompletionTimerRef.current)
        }
        setCompletedStationDropId(completedStationId)
        stationDropCompletionTimerRef.current = window.setTimeout(() => {
          setCompletedStationDropId(null)
          stationDropCompletionTimerRef.current = null
        }, 180)
      }

      const interaction = floatingInteractionRef.current
      cancelFloatingPreviewFrame()
      if (interaction) {
        if (commit && interaction.active && event) {
          const previewFrame = updateFloatingPreview(interaction, event.clientX, event.clientY)
          if (interaction.kind === 'drag') {
            onMoveFloatingContainer(interaction.containerId, { x: previewFrame.x, y: previewFrame.y })
          } else {
            onResizeFloatingContainer(interaction.containerId, previewFrame)
          }
          if (floatingSettleTimerRef.current !== null) {
            window.clearTimeout(floatingSettleTimerRef.current)
          }
          setSettledFloatingContainerId(interaction.containerId)
          floatingSettleTimerRef.current = window.setTimeout(() => {
            setSettledFloatingContainerId(null)
            floatingSettleTimerRef.current = null
          }, 180)
        } else if (!commit && interaction.active) {
          applyFloatingFramePreview(
            floatingShellsRef.current.get(interaction.containerId),
            interaction.rect,
            interaction.frame,
          )
        }
      }
      floatingInteractionRef.current = null
      latestFloatingPointerRef.current = null
      setFloatingInteractionPresentation(null)
    }
    const cancelDrag = () => {
      clearDrag(undefined, false)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', clearDrag)
    window.addEventListener('pointercancel', cancelDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', clearDrag)
      window.removeEventListener('pointercancel', cancelDrag)
    }
  }, [onMoveFloatingContainer, onMoveStationToContainer, onResizeFloatingContainer, onSelectStation])

  useEffect(() => {
    if (!scrollToStationId) {
      return
    }
    const container = findContainerByStationId(containers, scrollToStationId)
    if (!container) {
      onScrollToStationHandled?.(scrollToStationId)
      return
    }
    if (container.mode === 'detached') {
      onReclaimDetachedContainer(container.id)
    }
    onSelectStation(container.id, scrollToStationId)
    if (container.mode === 'docked') {
      const scrollFrame = scheduleStationScrollFrame({
        scheduler: createStationTerminalFrameFlushScheduler(window),
        fallbackDelayMs: STATION_SCROLL_FRAME_FALLBACK_MS,
        scroll: () => {
          const target = dockGridRef.current?.querySelector<HTMLElement>(`[data-container-id="${container.id}"]`)
          target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
        },
      })
      return () => {
        scrollFrame.cancel()
      }
    }
    onScrollToStationHandled?.(scrollToStationId)
  }, [containers, onReclaimDetachedContainer, onScrollToStationHandled, onSelectStation, scrollToStationId])

  const handleFloatingDragStart = useCallback(
    (containerId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }
      const container = containers.find((item) => item.id === containerId)
      if (!container?.frame) {
        return
      }
      const rect = resolveFloatingInteractionRect()
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      onFocusFloatingContainer(containerId)
      if (floatingSettleTimerRef.current !== null) {
        window.clearTimeout(floatingSettleTimerRef.current)
        floatingSettleTimerRef.current = null
      }
      setSettledFloatingContainerId(null)
      floatingInteractionRef.current = {
        kind: 'drag',
        containerId,
        rect,
        startX: event.clientX,
        startY: event.clientY,
        frame: container.frame,
        previewFrame: container.frame,
        active: false,
      }
    },
    [containers, onFocusFloatingContainer],
  )

  const handleStationPointerDragStart = useCallback(
    (stationId: string, sourceContainerId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      stationPointerDragRef.current = {
        stationId,
        sourceContainerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      }
      setDragTargetContainerId(null)
      setStationDragPresentation(null)
    },
    [],
  )

  const handleFloatingResizeStart = useCallback(
    (containerId: string, direction: FloatingResizeDirection, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }
      const container = containers.find((item) => item.id === containerId)
      if (!container?.frame) {
        return
      }
      const rect = resolveFloatingInteractionRect()
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      onFocusFloatingContainer(containerId)
      if (floatingSettleTimerRef.current !== null) {
        window.clearTimeout(floatingSettleTimerRef.current)
        floatingSettleTimerRef.current = null
      }
      setSettledFloatingContainerId(null)
      floatingInteractionRef.current = {
        kind: 'resize',
        containerId,
        direction,
        rect,
        startX: event.clientX,
        startY: event.clientY,
        frame: container.frame,
        previewFrame: container.frame,
        active: false,
      }
    },
    [containers, onFocusFloatingContainer],
  )

  const floatingEntries = useMemo(
    () =>
      floatingContainers.map((container, index) => ({
        container,
        stations: container.stationIds
          .map((stationId) => stationById.get(stationId))
          .filter((station): station is AgentStation => Boolean(station)),
        style: buildFloatingCanvasStyle(container, surfaceRect, 1200 + index + (container.topmost ? 1400 : 0)),
      })),
    [floatingContainers, stationById, surfaceRect],
  )

  const dockGridStyle = useMemo<DockGridStyle | undefined>(() => {
    const count = dockedContainers.length
    if (count <= 0) {
      return undefined
    }
    const surfaceWidth = surfaceRect?.width ?? 0
    const forceSingleColumn = surfaceWidth > 0 && surfaceWidth < 980
    const columns = forceSingleColumn ? 1 : Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count))))
    const rows = Math.max(1, Math.ceil(count / columns))
    return {
      '--workbench-container-columns': String(columns),
      '--workbench-container-rows': String(rows),
    }
  }, [dockedContainers.length, surfaceRect])

  return (
    <>
      {showStage ? (
        <section className="workbench-stage">
          <div ref={surfaceRef} className="workbench-stage-surface">
            <div ref={dockGridRef} className="workbench-stage-grid" style={dockGridStyle}>
              {dockedContainers.map((container, index) => {
                const containerStations = container.stationIds
                  .map((stationId) => stationById.get(stationId))
                  .filter((station): station is AgentStation => Boolean(station))
                return (
                  <WorkbenchCanvasPanel
                    key={container.id}
                    locale={locale}
                    appearanceVersion={appearanceVersion}
                    performanceDebugEnabled={performanceDebugEnabled}
                    workspaceId={workspaceId}
                    workspaceCwd={workspaceCwd}
                    container={container}
                    containerIndex={index}
                    stations={containerStations}
                    roleFilter={roleFilter}
                    activeGlobalStationId={activeStationId}
                    terminalByStation={terminalByStation}
                    taskSignalByStationId={taskSignalByStationId}
                    channelBotBindingsByStationId={channelBotBindingsByStationId}
                    dropActive={dragTargetContainerId === container.id}
                    stationDragSourceId={stationDragPresentation?.stationId ?? null}
                    stationDropAnchorId={
                      stationDragPresentation?.target?.containerId === container.id
                        ? stationDragPresentation.target.anchorStationId
                        : null
                    }
                    stationDropPlacement={
                      stationDragPresentation?.target?.containerId === container.id
                        ? stationDragPresentation.target.placement
                        : null
                    }
                    stationDropCompletionId={completedStationDropId}
                    workspaceTransitioning={workspaceTransitioning}
                    scrollToStationId={scrollToStationId && container.stationIds.includes(scrollToStationId) ? scrollToStationId : null}
                    onScrollToStationHandled={onScrollToStationHandled}
                    onSelectStation={onSelectStation}
                    onLaunchStationTerminal={onLaunchStationTerminal}
                    onLaunchCliAgent={onLaunchCliAgent}
                    onSessionRelaunch={onSessionRelaunch}
                    onForceCloseTerminal={onForceCloseTerminal}
            onSendInputData={onSendInputData}
            onResizeTerminal={onResizeTerminal}
                    onBindTerminalSink={onBindTerminalSink}
                    onRenderedScreenSnapshot={onRenderedScreenSnapshot}
                    onDropFilePath={onDropFilePath}
                    onRunStationAction={onRunStationAction}
            toolCommandsByStationId={toolCommandsByStationId}
                    onRemoveStation={onRemoveStation}
                    onLayoutModeChange={onLayoutModeChange}
                    onCustomLayoutChange={onCustomLayoutChange}
                    onFullscreenStationChange={onFullscreenStationChange}
                    onMinimizedStationIdsChange={onMinimizedStationIdsChange}
                    onFloatContainer={onFloatContainer}
                    onDockContainer={onDockContainer}
                    onDetachContainer={onDetachContainer}
                    onToggleContainerTopmost={onToggleContainerTopmost}
                    onDeleteContainer={onDeleteContainer}
                    showUtilityBar={container.id === utilityHostContainerId}
                    pinned={pinnedWorkbenchContainerId === container.id}
                    onTogglePinnedWorkbenchContainer={onTogglePinnedWorkbenchContainer}
                    minimizedDockPortalTarget={minimizedDockPortalTarget}
                    onCreateContainer={onCreateContainer}
                    onStationDragPointerStart={handleStationPointerDragStart}
                    onOpenStationManage={onOpenStationManage}
                    onEditStation={onEditStation}
                  />
                )
              })}

              {dockedContainers.length === 0 && floatingContainers.length === 0 ? (
                <div className="workbench-stage-empty">
                  <strong>{t(locale, 'workbench.emptyContainersTitle')}</strong>
                  <p>{t(locale, 'workbench.emptyContainersDetail')}</p>
                  <WorkbenchUtilityActions
                    locale={locale}
                    onOpenStationSearch={onOpenStationSearch}
                    onOpenStationManage={onOpenStationManage}
                    onCreateContainer={onCreateContainer}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {showFloatingPortal && (showStage ? Boolean(surfaceRect) : true) && typeof document !== 'undefined'
        ? createPortal(
            <div className="workbench-floating-portal">
              {floatingEntries.map(({ container, stations: containerStations, style }, index) => (
                <div
                  key={container.id}
                  ref={(element) => {
                    if (element) {
                      floatingShellsRef.current.set(container.id, element)
                      return
                    }
                    floatingShellsRef.current.delete(container.id)
                  }}
                  className={[
                    'workbench-floating-shell',
                    floatingInteractionPresentation?.containerId === container.id &&
                    floatingInteractionPresentation.kind === 'drag'
                      ? 'is-floating-dragging'
                      : '',
                    floatingInteractionPresentation?.containerId === container.id &&
                    floatingInteractionPresentation.kind === 'resize'
                      ? 'is-floating-resizing'
                      : '',
                    settledFloatingContainerId === container.id ? 'is-floating-settled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={style}
                  onPointerDown={() => {
                    onFocusFloatingContainer(container.id)
                  }}
                >
                  <WorkbenchCanvasPanel
                    locale={locale}
                    appearanceVersion={appearanceVersion}
                    performanceDebugEnabled={performanceDebugEnabled}
                    workspaceId={workspaceId}
                    workspaceCwd={workspaceCwd}
                    container={container}
                    containerIndex={dockedContainers.length + index}
                    stations={containerStations}
                    roleFilter={roleFilter}
                    activeGlobalStationId={activeStationId}
                    terminalByStation={terminalByStation}
                    taskSignalByStationId={taskSignalByStationId}
                    channelBotBindingsByStationId={channelBotBindingsByStationId}
                    dropActive={dragTargetContainerId === container.id}
                    stationDragSourceId={stationDragPresentation?.stationId ?? null}
                    stationDropAnchorId={
                      stationDragPresentation?.target?.containerId === container.id
                        ? stationDragPresentation.target.anchorStationId
                        : null
                    }
                    stationDropPlacement={
                      stationDragPresentation?.target?.containerId === container.id
                        ? stationDragPresentation.target.placement
                        : null
                    }
                    stationDropCompletionId={completedStationDropId}
                    workspaceTransitioning={workspaceTransitioning}
                    minimizedDockPortalTarget={minimizedDockPortalTarget}
                    onSelectStation={onSelectStation}
                    onLaunchStationTerminal={onLaunchStationTerminal}
                    onLaunchCliAgent={onLaunchCliAgent}
                    onSessionRelaunch={onSessionRelaunch}
                    onForceCloseTerminal={onForceCloseTerminal}
            onSendInputData={onSendInputData}
            onResizeTerminal={onResizeTerminal}
                    onBindTerminalSink={onBindTerminalSink}
                    onRenderedScreenSnapshot={onRenderedScreenSnapshot}
                    onDropFilePath={onDropFilePath}
                    onRunStationAction={onRunStationAction}
            toolCommandsByStationId={toolCommandsByStationId}
                    onRemoveStation={onRemoveStation}
                    onLayoutModeChange={onLayoutModeChange}
                    onCustomLayoutChange={onCustomLayoutChange}
                    onFullscreenStationChange={onFullscreenStationChange}
                    onMinimizedStationIdsChange={onMinimizedStationIdsChange}
                    onFloatContainer={onFloatContainer}
                    onDockContainer={onDockContainer}
                    onDetachContainer={onDetachContainer}
                    onToggleContainerTopmost={onToggleContainerTopmost}
                    onDeleteContainer={onDeleteContainer}
                    showUtilityBar={container.id === utilityHostContainerId}
                    pinned={pinnedWorkbenchContainerId === container.id}
                    onTogglePinnedWorkbenchContainer={onTogglePinnedWorkbenchContainer}
                    onCreateContainer={onCreateContainer}
                    onBeginFloatingDrag={handleFloatingDragStart}
                    onStationDragPointerStart={handleStationPointerDragStart}
                    onOpenStationManage={onOpenStationManage}
                    onEditStation={onEditStation}
                  />
                  {FLOATING_RESIZE_DIRECTIONS.map((direction) => (
                    <div
                      key={direction}
                      className={['workbench-floating-resize-handle', `dir-${direction}`].join(' ')}
                      onPointerDown={(event) => {
                        handleFloatingResizeStart(container.id, direction, event)
                      }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export const WorkbenchCanvas = memo(WorkbenchCanvasView)
export type { WorkbenchCustomLayout, WorkbenchLayoutMode } from './workbench-layout-model'
