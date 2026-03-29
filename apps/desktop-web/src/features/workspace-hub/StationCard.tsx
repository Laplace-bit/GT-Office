import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Circle, GripHorizontal, Play } from 'lucide-react'
import type { AgentStation } from './station-model'
import {
  buildStationCardIdentityMeta,
  handleStationCardPrimaryLaunch,
  resolveStationCardLaunchIcon,
  resolveStationCardLaunchState,
} from './station-card-header-model'
import { StationActionDock } from './StationActionDock'
import { StationActivityComet } from './StationActivityComet'
import { resolveStationActions } from './station-action-registry'
import type { StationActionDescriptor } from './station-action-model'
import { useStationActivitySignal } from './useStationActivitySignal'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  clearStationTerminalDebugRecords,
  TerminalDebugPanel,
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

function roleLabel(locale: Locale, station: AgentStation): string {
  switch (station.role) {
    case 'manager':
      return t(locale, 'station.role.manager')
    case 'product':
      return t(locale, 'station.role.product')
    case 'build':
      return t(locale, 'station.role.build')
    case 'quality_release':
      return t(locale, 'station.role.quality_release')
    default:
      return station.roleName || station.role
  }
}

interface StationIconButtonProps {
  tooltip: string
  className?: string
  ariaLabel: string
  ariaPressed?: boolean
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
  ariaPressed,
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
      aria-pressed={ariaPressed}
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
  agentRunning?: boolean
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
  agentRunning = false,
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
  const [compactLayout, setCompactLayout] = useState(false)
  const [terminalDebugHidden, setTerminalDebugHidden] = useState(true)
  const activitySignal = useStationActivitySignal(active ? 0 : runtime?.unreadCount)

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
  const roleText = roleLabel(locale, station)
  const identityMeta = useMemo(
    () => buildStationCardIdentityMeta(roleText, station.tool),
    [roleText, station.tool],
  )
  const launchState = resolveStationCardLaunchState({
    sessionId: runtime?.sessionId ?? null,
    stateRaw: runtime?.stateRaw ?? null,
    agentRunning,
  })
  const launchIcon = resolveStationCardLaunchIcon(launchState)
  const primaryLaunchButtonLabel =
    launchState === 'live'
      ? t(locale, 'workbench.focusCliAgent')
      : launchState === 'alert'
        ? t(locale, 'workbench.relaunchCliAgent')
        : t(locale, 'workbench.launchCliAgent')
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
  const handlePrimaryLaunch = useCallback(() => {
    handleStationCardPrimaryLaunch({
      stationId: station.id,
      sessionId: runtime?.sessionId ?? null,
      agentRunning,
      onSelectStation,
      requestTerminalFocus,
      onLaunchCliAgent,
    })
  }, [agentRunning, onLaunchCliAgent, onSelectStation, requestTerminalFocus, runtime?.sessionId, station.id])
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
            {identityMeta.map((item) => (
              <span
                key={`${station.id}:${item.kind}`}
                className={['station-window-context-pill', `is-${item.kind}`].join(' ')}
                title={item.label}
              >
                {item.label}
              </span>
            ))}
          </div>
          <div className="station-window-title-subline">
            <p className="station-window-meta-text" title={station.agentWorkdirRel}>
              {station.agentWorkdirRel}
            </p>
          </div>
        </div>
        {!active && activitySignal ? (
          <StationActivityComet
            locale={locale}
            level={activitySignal}
            className="station-window-activity-comet"
          />
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
            className={['station-primary-launch-btn', launchState].join(' ')}
            tooltip={primaryLaunchButtonLabel}
            ariaLabel={primaryLaunchButtonLabel}
            ariaPressed={launchState === 'live'}
            onClick={(event) => {
              event.stopPropagation()
              handlePrimaryLaunch()
            }}
          >
            {launchIcon === 'circle' ? (
              <Circle
                className="vb-icon vb-icon-station-button station-live-icon"
                aria-hidden="true"
                strokeWidth={1.9}
              />
            ) : (
              <Play
                className="vb-icon vb-icon-station-button station-play-icon"
                aria-hidden="true"
                strokeWidth={1.9}
              />
            )}
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
            onRenderedScreenSnapshot={active && !terminalDebugHidden ? onRenderedScreenSnapshot : undefined}
            onRestoreStateCaptured={onRestoreStateCaptured}
          />
          {active ? (
            <TerminalDebugPanel
              stationId={station.id}
              locale={locale}
              hidden={terminalDebugHidden}
              onHiddenChange={setTerminalDebugHidden}
              onClear={() => clearStationTerminalDebugRecords(station.id)}
            />
          ) : null}
        </>
      ) : (
        <div className="station-terminal-idle-state">
          <div className="station-terminal-idle-copy">
            <strong>{t(locale, '当前 Agent 尚未启动', 'Agent idle')}</strong>
            <p>
              {t(
                locale,
                '直接启动当前 CLI Agent，或先进入纯终端会话。',
                'Launch the current CLI agent directly, or open a plain terminal session first.',
              )}
            </p>
          </div>
          <div className="station-terminal-idle-actions">
            <button
              type="button"
              className="station-terminal-idle-button primary"
              onClick={(event) => {
                event.stopPropagation()
                handlePrimaryLaunch()
              }}
            >
              <Play
                className="vb-icon vb-icon-station-button station-play-icon"
                aria-hidden="true"
                strokeWidth={1.9}
              />
              <span>{t(locale, 'workbench.launchCliAgent')}</span>
            </button>
            <button
              type="button"
              className="station-terminal-idle-button"
              onClick={(event) => {
                event.stopPropagation()
                activateStationAndOpenTerminal()
              }}
            >
              <AppIcon name="terminal" className="vb-icon vb-icon-station-button" aria-hidden="true" />
              <span>{t(locale, 'workbench.launchTerminal')}</span>
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
    prev.agentRunning === next.agentRunning &&
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
