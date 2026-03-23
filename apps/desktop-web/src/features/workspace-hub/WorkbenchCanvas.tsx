import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react'
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
import type { RenderedScreenSnapshot } from '@shell/integration/desktop-api'
import type { StationChannelBotBindingSummary } from '@features/tool-adapter'
import type { WorkbenchStationRuntime } from './TerminalStationPane'
import './WorkbenchCanvas.scss'

interface FloatingCanvasStyle extends CSSProperties {
  '--floating-layer-z'?: string
}

interface DockGridStyle extends CSSProperties {
  '--workbench-container-columns'?: string
  '--workbench-container-rows'?: string
}

type FloatingResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type FloatingInteractionState =
  | {
      kind: 'drag'
      containerId: string
      rect: DOMRect
      startX: number
      startY: number
      frame: WorkbenchContainerFrame
    }
  | {
      kind: 'resize'
      containerId: string
      direction: FloatingResizeDirection
      rect: DOMRect
      startX: number
      startY: number
      frame: WorkbenchContainerFrame
    }

interface StationPointerDragState {
  stationId: string
  sourceContainerId: string
  startX: number
  startY: number
  active: boolean
}

interface WorkbenchCanvasProps {
  locale: Locale
  appearanceVersion: string
  showStage?: boolean
  showFloatingPortal?: boolean
  floatingVisibility?: 'all' | 'topmost' | 'non_topmost'
  stations: AgentStation[]
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
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onLayoutModeChange: (containerId: string, mode: WorkbenchLayoutMode) => void
  onCustomLayoutChange: (containerId: string, layout: WorkbenchCustomLayout) => void
  onFloatContainer: (containerId: string) => void
  onDockContainer: (containerId: string) => void
  onDetachContainer: (containerId: string) => void
  onToggleContainerTopmost: (containerId: string) => void
  onCreateContainer: () => void
  onDeleteContainer: (containerId: string) => void
  onMoveStationToContainer: (stationId: string, targetContainerId: string) => void
  onMoveFloatingContainer: (containerId: string, input: { x: number; y: number }) => void
  onResizeFloatingContainer: (containerId: string, frame: WorkbenchContainerFrame) => void
  onFocusFloatingContainer: (containerId: string) => void
  onReclaimDetachedContainer: (containerId: string) => void
  scrollToStationId?: string | null
  onScrollToStationHandled?: (stationId: string) => void
  onOpenStationManage: () => void
  onOpenStationSearch: () => void
  onRemoveStation: (stationId: string) => void
}

const STATION_DRAG_MIME = 'application/x-gto-workbench-station'
const STATION_DRAG_FALLBACK_MIME = 'text/plain'
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

function parseDraggedStation(event: ReactDragEvent<HTMLElement>): { stationId: string; sourceContainerId: string } | null {
  for (const mimeType of [STATION_DRAG_MIME, STATION_DRAG_FALLBACK_MIME]) {
    const raw = event.dataTransfer.getData(mimeType)
    if (!raw) {
      continue
    }
    try {
      const parsed = JSON.parse(raw) as { stationId?: string; sourceContainerId?: string }
      if (!parsed.stationId || !parsed.sourceContainerId) {
        continue
      }
      return {
        stationId: parsed.stationId,
        sourceContainerId: parsed.sourceContainerId,
      }
    } catch {
      continue
    }
  }
  return null
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
    left: `${fallbackWidth * frame.x}px`,
    top: `${fallbackHeight * frame.y}px`,
    width: `${fallbackWidth * frame.width}px`,
    height: `${fallbackHeight * frame.height}px`,
    '--floating-layer-z': String(zIndex),
  }
}

function resolveFloatingInteractionRect(_surfaceRect: DOMRect | null): DOMRect {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

function resolveContainerIdAtPoint(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  const target = document.elementFromPoint(clientX, clientY)
  if (!(target instanceof HTMLElement)) {
    return null
  }
  return target.closest<HTMLElement>('[data-container-id]')?.dataset.containerId ?? null
}

function WorkbenchCanvasView({
  locale,
  appearanceVersion,
  showStage = true,
  showFloatingPortal = true,
  floatingVisibility = 'all',
  stations,
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
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRenderedScreenSnapshot,
  onLayoutModeChange,
  onCustomLayoutChange,
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
  onRemoveStation,
}: WorkbenchCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const dockGridRef = useRef<HTMLDivElement | null>(null)
  const floatingInteractionRef = useRef<FloatingInteractionState | null>(null)
  const stationPointerDragRef = useRef<StationPointerDragState | null>(null)
  const [surfaceRect, setSurfaceRect] = useState<DOMRect | null>(null)
  const [dragTargetContainerId, setDragTargetContainerId] = useState<string | null>(null)
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
    const handlePointerMove = (event: PointerEvent) => {
      const stationDrag = stationPointerDragRef.current
      if (stationDrag) {
        if (!stationDrag.active) {
          const deltaX = Math.abs(event.clientX - stationDrag.startX)
          const deltaY = Math.abs(event.clientY - stationDrag.startY)
          if (deltaX >= 4 || deltaY >= 4) {
            stationDrag.active = true
          }
        }
        if (stationDrag.active) {
          const nextTargetContainerId = resolveContainerIdAtPoint(event.clientX, event.clientY)
          setDragTargetContainerId(
            nextTargetContainerId && nextTargetContainerId !== stationDrag.sourceContainerId
              ? nextTargetContainerId
              : null,
          )
        }
      }

      const interaction = floatingInteractionRef.current
      if (!interaction) {
        return
      }
      const dx = (event.clientX - interaction.startX) / Math.max(1, interaction.rect.width)
      const dy = (event.clientY - interaction.startY) / Math.max(1, interaction.rect.height)
      if (interaction.kind === 'drag') {
        onMoveFloatingContainer(
          interaction.containerId,
          clampFloatingFramePosition(interaction.frame, interaction.rect, {
            x: interaction.frame.x + dx,
            y: interaction.frame.y + dy,
          }),
        )
        return
      }
      onResizeFloatingContainer(
        interaction.containerId,
        resizeFloatingFrame(interaction.frame, interaction.direction, dx, dy, interaction.rect),
      )
    }
    const clearDrag = (event?: PointerEvent) => {
      const stationDrag = stationPointerDragRef.current
      if (stationDrag?.active && event) {
        const targetContainerId = resolveContainerIdAtPoint(event.clientX, event.clientY)
        if (targetContainerId && targetContainerId !== stationDrag.sourceContainerId) {
          onMoveStationToContainer(stationDrag.stationId, targetContainerId)
          onSelectStation(targetContainerId, stationDrag.stationId)
        }
      }
      stationPointerDragRef.current = null
      setDragTargetContainerId(null)
      floatingInteractionRef.current = null
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', clearDrag)
    window.addEventListener('pointercancel', clearDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', clearDrag)
      window.removeEventListener('pointercancel', clearDrag)
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
      window.requestAnimationFrame(() => {
        const target = dockGridRef.current?.querySelector<HTMLElement>(`[data-container-id="${container.id}"]`)
        target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      })
      return
    }
    onScrollToStationHandled?.(scrollToStationId)
  }, [containers, onReclaimDetachedContainer, onScrollToStationHandled, onSelectStation, scrollToStationId])

  const handleStationDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>, stationId: string, sourceContainerId: string) => {
      const payload = JSON.stringify({
        stationId,
        sourceContainerId,
      })
      event.dataTransfer.effectAllowed = 'move'
      // WKWebView may drop custom MIME payloads during DOM drag-and-drop, so keep a text fallback.
      event.dataTransfer.setData(STATION_DRAG_FALLBACK_MIME, payload)
      event.dataTransfer.setData(STATION_DRAG_MIME, payload)
    },
    [],
  )

  const handleContainerDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetContainerId: string) => {
      const dragged = parseDraggedStation(event)
      setDragTargetContainerId(null)
      if (!dragged || dragged.sourceContainerId === targetContainerId) {
        return
      }
      onMoveStationToContainer(dragged.stationId, targetContainerId)
      onSelectStation(targetContainerId, dragged.stationId)
    },
    [onMoveStationToContainer, onSelectStation],
  )

  const handleFloatingDragStart = useCallback(
    (containerId: string, event: ReactPointerEvent<HTMLElement>) => {
      const container = containers.find((item) => item.id === containerId)
      if (!container?.frame) {
        return
      }
      const rect = resolveFloatingInteractionRect(surfaceRect)
      event.preventDefault()
      onFocusFloatingContainer(containerId)
      floatingInteractionRef.current = {
        kind: 'drag',
        containerId,
        rect,
        startX: event.clientX,
        startY: event.clientY,
        frame: container.frame,
      }
    },
    [containers, onFocusFloatingContainer, surfaceRect],
  )

  const handleStationPointerDragStart = useCallback(
    (stationId: string, sourceContainerId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      stationPointerDragRef.current = {
        stationId,
        sourceContainerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      }
      setDragTargetContainerId(null)
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
      const rect = resolveFloatingInteractionRect(surfaceRect)
      event.preventDefault()
      event.stopPropagation()
      onFocusFloatingContainer(containerId)
      floatingInteractionRef.current = {
        kind: 'resize',
        containerId,
        direction,
        rect,
        startX: event.clientX,
        startY: event.clientY,
        frame: container.frame,
      }
    },
    [containers, onFocusFloatingContainer, surfaceRect],
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
                    container={container}
                    containerIndex={index}
                    stations={containerStations}
                    activeGlobalStationId={activeStationId}
                    terminalByStation={terminalByStation}
                    taskSignalByStationId={taskSignalByStationId}
                    channelBotBindingsByStationId={channelBotBindingsByStationId}
                    dropActive={dragTargetContainerId === container.id}
                    scrollToStationId={scrollToStationId && container.stationIds.includes(scrollToStationId) ? scrollToStationId : null}
                    onScrollToStationHandled={onScrollToStationHandled}
                    onSelectStation={onSelectStation}
                    onLaunchStationTerminal={onLaunchStationTerminal}
                    onLaunchCliAgent={onLaunchCliAgent}
                    onSendInputData={onSendInputData}
                    onResizeTerminal={onResizeTerminal}
                    onBindTerminalSink={onBindTerminalSink}
                    onRenderedScreenSnapshot={onRenderedScreenSnapshot}
                    onRemoveStation={onRemoveStation}
                    onLayoutModeChange={onLayoutModeChange}
                    onCustomLayoutChange={onCustomLayoutChange}
                    onFloatContainer={onFloatContainer}
                    onDockContainer={onDockContainer}
                    onDetachContainer={onDetachContainer}
                    onToggleContainerTopmost={onToggleContainerTopmost}
                    onDeleteContainer={onDeleteContainer}
                    showUtilityBar={container.id === utilityHostContainerId}
                    pinned={pinnedWorkbenchContainerId === container.id}
                    onTogglePinnedWorkbenchContainer={onTogglePinnedWorkbenchContainer}
                    onCreateContainer={onCreateContainer}
                    onStationDragStart={handleStationDragStart}
                    onStationDragPointerStart={handleStationPointerDragStart}
                    onStationDragEnd={() => setDragTargetContainerId(null)}
                    onStationDragHover={setDragTargetContainerId}
                    onStationDrop={(event, targetContainerId) => {
                      handleContainerDrop(event, targetContainerId)
                    }}
                    onOpenStationManage={onOpenStationManage}
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
                  className="workbench-floating-shell"
                  style={style}
                  onPointerDown={() => {
                    onFocusFloatingContainer(container.id)
                  }}
                >
                  <WorkbenchCanvasPanel
                    locale={locale}
                    appearanceVersion={appearanceVersion}
                    container={container}
                    containerIndex={dockedContainers.length + index}
                    stations={containerStations}
                    activeGlobalStationId={activeStationId}
                    terminalByStation={terminalByStation}
                    taskSignalByStationId={taskSignalByStationId}
                    channelBotBindingsByStationId={channelBotBindingsByStationId}
                    dropActive={dragTargetContainerId === container.id}
                    onSelectStation={onSelectStation}
                    onLaunchStationTerminal={onLaunchStationTerminal}
                    onLaunchCliAgent={onLaunchCliAgent}
                    onSendInputData={onSendInputData}
                    onResizeTerminal={onResizeTerminal}
                    onBindTerminalSink={onBindTerminalSink}
                    onRenderedScreenSnapshot={onRenderedScreenSnapshot}
                    onRemoveStation={onRemoveStation}
                    onLayoutModeChange={onLayoutModeChange}
                    onCustomLayoutChange={onCustomLayoutChange}
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
                    onStationDragStart={handleStationDragStart}
                    onStationDragPointerStart={handleStationPointerDragStart}
                    onStationDragEnd={() => setDragTargetContainerId(null)}
                    onStationDragHover={setDragTargetContainerId}
                    onStationDrop={(event, targetContainerId) => {
                      handleContainerDrop(event, targetContainerId)
                    }}
                    onOpenStationManage={onOpenStationManage}
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
