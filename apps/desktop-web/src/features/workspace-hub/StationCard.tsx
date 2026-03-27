import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { GripHorizontal, Play } from 'lucide-react'
import type { AgentStation, StationRole } from './station-model'
import { StationActionDock } from './StationActionDock'
import { resolveStationActions } from './station-action-registry'
import type { StationActionDescriptor } from './station-action-model'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  StationXtermTerminal,
  type StationTerminalSink,
  type StationTerminalSinkBindingHandler,
} from '@features/terminal'
import {
  didStationTerminalRenderabilityChange,
  shouldAutoLaunchStationTerminalFromSurface,
  shouldRenderStationTerminal,
} from '@features/terminal/station-terminal-runtime-state'
import type { StationChannelBotBindingSummary } from '@features/tool-adapter'
import type {
  RenderedScreenSnapshot,
  StationTerminalRestoreStatePayload,
  ToolCommandSummary,
} from '@shell/integration/desktop-api'
import './StationCard.scss'

const TERMINAL_FOCUS_MAX_RETRY_FRAMES = 4
const STATION_CARD_COMPACT_WIDTH_PX = 360
const STATION_CARD_COMPACT_HEIGHT_PX = 392

const roleKeyMap: Record<
  StationRole,
  | 'station.role.manager'
  | 'station.role.product'
  | 'station.role.build'
  | 'station.role.quality_release'
> = {
  manager: 'station.role.manager',
  product: 'station.role.product',
  build: 'station.role.build',
  quality_release: 'station.role.quality_release',
}

function roleLabel(locale: Locale, role: StationRole): string {
  return t(locale, roleKeyMap[role])
}

type StationThroughputLevel = 'low' | 'medium' | 'high'

interface StationThroughputTelemetry {
  level: StationThroughputLevel
  ariaLabel: string
}

function resolveStationThroughputTelemetryLabel(
  locale: Locale,
  level: StationThroughputLevel,
): string {
  if (level === 'high') {
    return t(locale, '终端活动速率：高', 'Terminal activity speed: high')
  }
  if (level === 'medium') {
    return t(locale, '终端活动速率：中', 'Terminal activity speed: medium')
  }
  return t(locale, '终端活动速率：低', 'Terminal activity speed: low')
}

interface StationIconButtonProps {
  tooltip: string
  className?: string
  ariaLabel: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
  children: ReactNode
}

function StationIconButton({
  tooltip,
  className,
  ariaLabel,
  onClick,
  onPointerDown,
  draggable = false,
  onDragStart,
  onDragEnd,
  children,
}: StationIconButtonProps) {
  return (
    <button
      type="button"
      className={['station-icon-button', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      title={tooltip}
      onClick={onClick}
      onPointerDown={onPointerDown}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {children}
    </button>
  )
}

interface StationTerminalRuntime {
  sessionId: string | null
  unreadCount: number
  stateRaw?: string | null
}

interface StationCardProps {
  locale: Locale
  appearanceVersion: string
  station: AgentStation
  active: boolean
  runtime?: StationTerminalRuntime
  taskSignal?: StationTaskSignal
  channelBotBindings?: StationChannelBotBindingSummary[]
  isFullscreen?: boolean
  isFullscreenMode?: boolean
  isMiniature?: boolean
  isFocusHidden?: boolean
  onSelectStation: (stationId: string) => void

  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot?: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onRestoreStateCaptured?: (
    stationId: string,
    state: StationTerminalRestoreStatePayload,
    sourceSessionId: string | null,
  ) => void
  onRemoveStation: (stationId: string) => void
  onEnterFullscreen: (stationId: string) => void
  onExitFullscreen: () => void
  onRunAction: (station: AgentStation, action: StationActionDescriptor) => void
  commands?: ToolCommandSummary[]
  draggable?: boolean
  onStationDragStart?: (event: DragEvent<HTMLButtonElement>, stationId: string) => void
  onStationDragPointerStart?: (event: ReactPointerEvent<HTMLElement>, stationId: string) => void
  onStationDragEnd?: () => void
}

function buildTaskAckLine(locale: Locale, nonce: number): string {
  const zh = [
    '任务收到，终端已进入执行状态。',
    '收到，本工作站开始处理当前任务。',
    '已锁定任务，准备进入编码流程。',
  ]
  const en = [
    'Task received. Terminal is primed for execution.',
    'Acknowledged. This station is processing the task.',
    'Locked in. Entering the coding flow now.',
  ]
  const list = locale === 'zh-CN' ? zh : en
  return list[Math.abs(nonce) % list.length]
}

function StationCardView({
  locale,
  appearanceVersion,
  station,
  active,
  runtime,
  taskSignal,
  isFullscreen,
  isFullscreenMode,
  isMiniature,
  isFocusHidden,
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRenderedScreenSnapshot,
  onRestoreStateCaptured,
  onEnterFullscreen,
  onExitFullscreen,
  onRunAction,
  commands = [],
  draggable = false,
  onStationDragPointerStart,
}: StationCardProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const terminalSinkRef = useRef<StationTerminalSink | null>(null)
  const pendingTerminalFocusRef = useRef(false)
  const terminalFocusFrameRef = useRef<number | null>(null)
  const terminalFocusRetryBudgetRef = useRef(0)
  const activeRef = useRef(active)
  const previousUnreadCountRef = useRef(runtime?.unreadCount ?? 0)
  const throughputResetTimerRef = useRef<number | null>(null)
  const [compactLayout, setCompactLayout] = useState(false)
  const [throughputLevel, setThroughputLevel] = useState<StationThroughputLevel | null>(null)

  const cancelScheduledTerminalFocus = useCallback(() => {
    const frameId = terminalFocusFrameRef.current
    if (frameId === null) {
      return
    }
    terminalFocusFrameRef.current = null
    window.cancelAnimationFrame(frameId)
  }, [])

  const terminalHasDomFocus = useCallback(() => {
    const rootElement = rootRef.current
    if (!rootElement) {
      return false
    }
    const terminalShell = rootElement.querySelector<HTMLElement>('.station-terminal-shell')
    return terminalShell?.matches(':focus-within') ?? false
  }, [])

  const flushPendingTerminalFocus = useCallback(
    function retryFocus() {
      if (!pendingTerminalFocusRef.current || !activeRef.current) {
        return
      }
      const sink = terminalSinkRef.current
      if (!sink) {
        return
      }

      sink.focus()
      if (terminalHasDomFocus()) {
        pendingTerminalFocusRef.current = false
        terminalFocusRetryBudgetRef.current = 0
        cancelScheduledTerminalFocus()
        return
      }

      if (terminalFocusRetryBudgetRef.current <= 0) {
        pendingTerminalFocusRef.current = false
        return
      }

      if (terminalFocusFrameRef.current !== null) {
        return
      }

      terminalFocusRetryBudgetRef.current -= 1
      terminalFocusFrameRef.current = window.requestAnimationFrame(() => {
        terminalFocusFrameRef.current = null
        retryFocus()
      })
    },
    [cancelScheduledTerminalFocus, terminalHasDomFocus],
  )

  useEffect(() => {
    activeRef.current = active
    if (!active) {
      pendingTerminalFocusRef.current = false
      terminalFocusRetryBudgetRef.current = 0
      cancelScheduledTerminalFocus()
      return
    }
    flushPendingTerminalFocus()
  }, [active, cancelScheduledTerminalFocus, flushPendingTerminalFocus])

  useEffect(() => {
    return () => {
      pendingTerminalFocusRef.current = false
      terminalFocusRetryBudgetRef.current = 0
      cancelScheduledTerminalFocus()
      const timerId = throughputResetTimerRef.current
      if (timerId !== null) {
        window.clearTimeout(timerId)
        throughputResetTimerRef.current = null
      }
    }
  }, [cancelScheduledTerminalFocus])

  useEffect(() => {
    const element = rootRef.current
    if (!element) {
      return
    }
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const updateCompactLayout = () => {
      const nextCompact =
        element.clientWidth <= STATION_CARD_COMPACT_WIDTH_PX ||
        element.clientHeight <= STATION_CARD_COMPACT_HEIGHT_PX
      setCompactLayout((prev) => (prev === nextCompact ? prev : nextCompact))
    }
    updateCompactLayout()
    const observer = new ResizeObserver(updateCompactLayout)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const taskBubbleLine = taskSignal ? buildTaskAckLine(locale, taskSignal.nonce) : ''
  const hasTerminalSession = Boolean(runtime?.sessionId)
  const shouldRenderTerminal = shouldRenderStationTerminal(runtime)
  const shouldAutoLaunchTerminal = shouldAutoLaunchStationTerminalFromSurface(runtime)
  const roleText = roleLabel(locale, station.role)
  const runtimeStateLabel =
    runtime?.stateRaw === 'failed' || runtime?.stateRaw === 'killed'
      ? t(locale, '需处理', 'Attention')
      : runtime?.stateRaw === 'exited'
        ? t(locale, '已结束', 'Ended')
        : hasTerminalSession
          ? t(locale, '运行中', 'Live')
          : t(locale, '待命', 'Ready')
  const runtimeStateTone =
    runtime?.stateRaw === 'failed' || runtime?.stateRaw === 'killed'
      ? 'alert'
      : hasTerminalSession
        ? 'live'
        : 'idle'
  const semanticChipLabel = `${roleText} · ${runtimeStateLabel}`
  const throughputTelemetry = useMemo<StationThroughputTelemetry | null>(() => {
    if (!throughputLevel) {
      return null
    }
    return {
      level: throughputLevel,
      ariaLabel: resolveStationThroughputTelemetryLabel(locale, throughputLevel),
    }
  }, [locale, throughputLevel])
  const requestTerminalFocus = useCallback(() => {
    pendingTerminalFocusRef.current = true
    terminalFocusRetryBudgetRef.current = TERMINAL_FOCUS_MAX_RETRY_FRAMES
    flushPendingTerminalFocus()
  }, [flushPendingTerminalFocus])
  const stationActions = useMemo(
    () =>
      resolveStationActions({
        station,
        hasTerminalSession,
        detachedReadonly: false,
        commands,
      }),
    [commands, hasTerminalSession, station],
  )
  const handleRunAction = useCallback(
    (action: StationActionDescriptor) => {
      onRunAction(station, action)
      requestTerminalFocus()
    },
    [onRunAction, requestTerminalFocus, station],
  )
  const dockCompact = compactLayout || isMiniature
  const activateStationAndFocusTerminal = useCallback(() => {
    onSelectStation(station.id)
    requestTerminalFocus()
  }, [onSelectStation, requestTerminalFocus, station.id])
  const activateStationAndOpenTerminal = useCallback(() => {
    activateStationAndFocusTerminal()
    if (shouldAutoLaunchTerminal) {
      onLaunchStationTerminal(station.id)
    }
  }, [activateStationAndFocusTerminal, onLaunchStationTerminal, shouldAutoLaunchTerminal, station.id])
  const activateStationFromTerminal = useCallback(() => {
    onSelectStation(station.id)
    if (shouldAutoLaunchTerminal) {
      onLaunchStationTerminal(station.id)
    }
  }, [onLaunchStationTerminal, onSelectStation, shouldAutoLaunchTerminal, station.id])
  const activateStationOnly = useCallback(() => {
    onSelectStation(station.id)
  }, [onSelectStation, station.id])

  const handleBindSink = useCallback<StationTerminalSinkBindingHandler>(
    (stationId, sink, meta) => {
      terminalSinkRef.current = sink
      onBindTerminalSink(stationId, sink, meta)
      if (sink) {
        flushPendingTerminalFocus()
      }
    },
    [flushPendingTerminalFocus, onBindTerminalSink],
  )

  useEffect(() => {
    const nextUnreadCount = runtime?.unreadCount ?? 0
    const previousUnreadCount = previousUnreadCountRef.current
    previousUnreadCountRef.current = nextUnreadCount
    const delta = Math.max(0, nextUnreadCount - previousUnreadCount)

    if (nextUnreadCount === 0) {
      const timerId = throughputResetTimerRef.current
      if (timerId !== null) {
        window.clearTimeout(timerId)
        throughputResetTimerRef.current = null
      }
      setThroughputLevel(null)
      return
    }

    if (delta <= 0) {
      return
    }

    const nextLevel: StationThroughputLevel = delta >= 6 ? 'high' : delta >= 3 ? 'medium' : 'low'
    setThroughputLevel(nextLevel)

    const timerId = throughputResetTimerRef.current
    if (timerId !== null) {
      window.clearTimeout(timerId)
    }
    throughputResetTimerRef.current = window.setTimeout(() => {
      throughputResetTimerRef.current = null
      setThroughputLevel(null)
    }, nextLevel === 'high' ? 780 : nextLevel === 'medium' ? 960 : 1180)
  }, [runtime?.unreadCount])

  useEffect(() => {
    const element = rootRef.current
    if (!element) {
      return
    }
    const handleGestureChange = (event: Event) => {
      const gestureEvent = event as Event & { scale?: number }
      if (typeof gestureEvent.scale !== 'number') {
        return
      }
      if (gestureEvent.scale > 1.04) {
        onEnterFullscreen(station.id)
        event.preventDefault()
        return
      }
      if (gestureEvent.scale < 0.96) {
        onExitFullscreen()
        event.preventDefault()
      }
    }
    element.addEventListener('gesturechange', handleGestureChange as EventListener, {
      passive: false,
    })
    return () => {
      element.removeEventListener('gesturechange', handleGestureChange as EventListener)
    }
  }, [onEnterFullscreen, onExitFullscreen, station.id])

  return (
    <article
      ref={rootRef}
      data-station-id={station.id}
      className={[
        'station-window',
        active ? 'active' : '',
        isMiniature ? 'is-miniature' : '',
        isFocusHidden ? 'focus-hidden' : '',
        compactLayout ? 'station-window-compact' : '',
        isFullscreen ? 'fullscreen' : '',
        isFullscreenMode && !isFullscreen ? 'background-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        // Clicking card body only switches active station.
        const target = event.target as HTMLElement
        if (target.closest('.station-terminal-shell')) {
          return
        }
        activateStationOnly()
      }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.station-terminal-shell')) {
          return
        }
        onEnterFullscreen(station.id)
      }}
    >
      {taskSignal ? (
        <div key={taskSignal.nonce} className="station-task-ack-bubble" role="status" aria-live="polite">
          <strong>{locale === 'zh-CN' ? '任务收到啦' : 'Task received'}</strong>
          <p>{taskBubbleLine}</p>
          <span>{taskSignal.taskId}</span>
        </div>
      ) : null}

      <header className="station-window-header">
        <div
          className={['station-window-title-wrap', draggable ? 'station-window-drag-source' : ''].join(' ')}
          onPointerDown={
            draggable && onStationDragPointerStart
              ? (event) => {
                  const target = event.target as HTMLElement
                  if (target.closest('button') || target.closest('input') || target.closest('label')) {
                    return
                  }
                  onStationDragPointerStart(event, station.id)
                }
              : undefined
          }
        >
          <div className="station-window-title-row">
            <h3 title={station.name}>{station.name}</h3>
            <span
              className={['station-window-semantic-pill', runtimeStateTone].join(' ')}
              title={semanticChipLabel}
              aria-label={semanticChipLabel}
            >
              <span className="station-window-semantic-pill-dot" aria-hidden="true" />
              <span className="station-window-semantic-pill-text">{semanticChipLabel}</span>
            </span>
          </div>
          <div className="station-window-title-subline">
            <p className="station-window-meta-text" title={station.agentWorkdirRel}>
              {station.agentWorkdirRel}
            </p>
            <span className="station-window-tool-pill" title={station.tool}>
              {station.tool}
            </span>
          </div>
        </div>
        {throughputTelemetry ? (
          <div
            className={['station-throughput-monitor', throughputTelemetry.level].join(' ')}
            role="img"
            aria-label={throughputTelemetry.ariaLabel}
            title={throughputTelemetry.ariaLabel}
          >
            <span className="station-throughput-rotor" aria-hidden="true" />
            <span className="station-throughput-bars" aria-hidden="true">
              <span className="station-throughput-bar" />
              <span className="station-throughput-bar" />
              <span className="station-throughput-bar" />
            </span>
          </div>
        ) : null}
        <div className="station-window-header-actions">
          {draggable ? (
            <StationIconButton
              className="station-drag-handle"
              tooltip={t(locale, 'workbench.dragStation')}
              ariaLabel={t(locale, 'workbench.dragStation')}
              onPointerDown={
                onStationDragPointerStart
                  ? (event) => {
                      event.stopPropagation()
                      onStationDragPointerStart(event, station.id)
                    }
                  : undefined
              }
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              <GripHorizontal className="vb-icon vb-icon-station-button" aria-hidden="true" strokeWidth={1.75} />
            </StationIconButton>
          ) : null}
          <StationIconButton
            tooltip={t(locale, 'workbench.launchTerminal')}
            ariaLabel={t(locale, 'workbench.launchTerminal')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndOpenTerminal()
            }}
          >
            <Play className="vb-icon vb-icon-station-button station-play-icon" aria-hidden="true" strokeWidth={1.9} />
          </StationIconButton>
          <StationIconButton
            tooltip={t(locale, 'workbench.launchCliAgent')}
            ariaLabel={t(locale, 'workbench.launchCliAgent')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndFocusTerminal()
              onLaunchCliAgent(station.id)
            }}
          >
            <AppIcon name="sparkles" className="vb-icon vb-icon-station-button" aria-hidden="true" />
          </StationIconButton>
          <StationIconButton
            className="station-fullscreen-btn"
            tooltip={t(locale, isFullscreen ? 'workbench.exitFullscreen' : 'workbench.fullscreen')}
            ariaLabel={t(locale, isFullscreen ? 'workbench.exitFullscreen' : 'workbench.fullscreen')}
            onClick={(event) => {
              event.stopPropagation()
              if (isFullscreen) {
                onExitFullscreen()
                return
              }
              onEnterFullscreen(station.id)
            }}
          >
            <AppIcon
              name={isFullscreen ? 'fullscreen-exit' : 'fullscreen-enter'}
              className="vb-icon vb-icon-station-button"
              aria-hidden="true"
            />
          </StationIconButton>
        </div>
      </header>
      {shouldRenderTerminal ? (
        <>
          <StationXtermTerminal
            stationId={station.id}
            sessionId={runtime?.sessionId ?? null}
            appearanceVersion={appearanceVersion}
            onActivateStation={activateStationFromTerminal}
            onData={onSendInputData}
            onResize={onResizeTerminal}
            onBindSink={handleBindSink}
            onRenderedScreenSnapshot={onRenderedScreenSnapshot}
            onRestoreStateCaptured={onRestoreStateCaptured}
          />
        </>
      ) : (
        <div className="station-terminal-idle-state">
          <div className="station-terminal-idle-copy">
            <strong>{t(locale, '终端尚未启动', 'Terminal idle')}</strong>
            <p>
              {t(
                locale,
                '先启动终端会话，再进入 CLI 或执行任务派发。',
                'Launch the terminal session before opening a CLI agent or dispatching tasks.',
              )}
            </p>
          </div>
          <div className="station-terminal-idle-actions">
            <button
              type="button"
              className="station-terminal-idle-button primary"
              onClick={(event) => {
                event.stopPropagation()
                activateStationAndOpenTerminal()
              }}
            >
              <Play
                className="vb-icon vb-icon-station-button station-play-icon"
                aria-hidden="true"
                strokeWidth={1.9}
              />
              <span>{t(locale, 'workbench.launchTerminal')}</span>
            </button>
            <button
              type="button"
              className="station-terminal-idle-button"
              onClick={(event) => {
                event.stopPropagation()
                activateStationAndFocusTerminal()
                onLaunchCliAgent(station.id)
              }}
            >
              <AppIcon name="sparkles" className="vb-icon vb-icon-station-button" aria-hidden="true" />
              <span>{t(locale, 'workbench.launchCliAgent')}</span>
            </button>
          </div>
        </div>
      )}
      <StationActionDock actions={stationActions} compact={dockCompact} onAction={handleRunAction} />

    </article>
  )
}

function areStationChannelBindingsEqual(
  prev: StationChannelBotBindingSummary[] | undefined,
  next: StationChannelBotBindingSummary[] | undefined,
): boolean {
  const prevItems = prev ?? []
  const nextItems = next ?? []
  if (prevItems.length !== nextItems.length) {
    return false
  }
  for (let index = 0; index < prevItems.length; index += 1) {
    const prevItem = prevItems[index]
    const nextItem = nextItems[index]
    if (
      prevItem.channel !== nextItem.channel ||
      prevItem.accountId !== nextItem.accountId ||
      prevItem.routeCount !== nextItem.routeCount
    ) {
      return false
    }
  }
  return true
}

function areStationCardPropsEqual(prev: StationCardProps, next: StationCardProps): boolean {
  return (
    prev.locale === next.locale &&
    prev.appearanceVersion === next.appearanceVersion &&
    prev.station === next.station &&
    prev.active === next.active &&
    prev.isFullscreen === next.isFullscreen &&
    prev.isFullscreenMode === next.isFullscreenMode &&
    prev.isMiniature === next.isMiniature &&
    prev.isFocusHidden === next.isFocusHidden &&
    prev.draggable === next.draggable &&
    prev.onSelectStation === next.onSelectStation &&
    prev.onLaunchStationTerminal === next.onLaunchStationTerminal &&
    prev.onLaunchCliAgent === next.onLaunchCliAgent &&
    prev.onSendInputData === next.onSendInputData &&
    prev.onResizeTerminal === next.onResizeTerminal &&
    prev.onBindTerminalSink === next.onBindTerminalSink &&
    prev.onRenderedScreenSnapshot === next.onRenderedScreenSnapshot &&
    prev.onRestoreStateCaptured === next.onRestoreStateCaptured &&
    prev.onRemoveStation === next.onRemoveStation &&
    prev.onEnterFullscreen === next.onEnterFullscreen &&
    prev.onExitFullscreen === next.onExitFullscreen &&
    prev.onRunAction === next.onRunAction &&
    prev.commands === next.commands &&
    prev.onStationDragStart === next.onStationDragStart &&
    prev.onStationDragPointerStart === next.onStationDragPointerStart &&
    prev.onStationDragEnd === next.onStationDragEnd &&
    (prev.runtime?.sessionId ?? null) === (next.runtime?.sessionId ?? null) &&
    (prev.runtime?.stateRaw ?? null) === (next.runtime?.stateRaw ?? null) &&
    !didStationTerminalRenderabilityChange(prev.runtime, next.runtime) &&
    (prev.runtime?.unreadCount ?? 0) === (next.runtime?.unreadCount ?? 0) &&
    (prev.taskSignal?.nonce ?? null) === (next.taskSignal?.nonce ?? null) &&
    (prev.taskSignal?.taskId ?? null) === (next.taskSignal?.taskId ?? null) &&
    areStationChannelBindingsEqual(prev.channelBotBindings, next.channelBotBindings)
  )
}

export const StationCard = memo(StationCardView, areStationCardPropsEqual)
