import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { motion } from 'motion/react'
import { Circle, GripHorizontal, Play } from 'lucide-react'
import type { AgentStation } from './station-model'
import {
  buildStationCardIdentityMeta,
  handleStationCardPrimaryLaunch,
  resolveStationCardLaunchIcon,
  resolveStationCardLaunchState,
  resolveStationCardStatusMeta,
} from './station-card-header-model'
import { StationActionDock } from './StationActionDock'
import { resolveStationActions } from './station-action-registry'
import type { StationActionDescriptor } from './station-action-model'
import { resolveStationTaskAckEmoji } from './station-task-ack-emoji'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  StationXtermTerminal,
  type StationTerminalSink,
  type StationTerminalSinkBindingHandler,
} from '@features/terminal'
import { createStationTerminalFrameFlushScheduler } from '@features/terminal/station-terminal-frame-flush-scheduler'
import {
  scheduleStationTerminalFocusRetryFrame,
  type StationTerminalFocusRetryFrame,
} from '@features/terminal/station-terminal-focus-runtime'
import { recordStationTerminalFocusDiagnostic } from '@features/terminal/station-terminal-focus-diagnostics'
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
import type { TerminalFileDropPayload } from '@shell/utils/terminal-file-drop'
import { SessionHistoryList, useSessionHistory, resolveStationSessionProvider } from '@features/session'
import { resolveAgentWorkdirAbs } from '@features/workspace/station-workdir-model'
import { STATION_MOTION } from './station-motion-spec'
import './StationCard.scss'

const TERMINAL_FOCUS_MAX_RETRY_FRAMES = 4
const TERMINAL_FOCUS_RETRY_FRAME_FALLBACK_MS = 48
const STATION_CARD_COMPACT_WIDTH_PX = 360
const STATION_CARD_COMPACT_HEIGHT_PX = 392

interface StationIconButtonProps {
  tooltip: string
  className?: string
  ariaLabel: string
  ariaPressed?: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  children: ReactNode
}

function StationIconButton({
  tooltip,
  className,
  ariaLabel,
  ariaPressed,
  onClick,
  onPointerDown,
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
  performanceDebugEnabled?: boolean
  station: AgentStation
  active: boolean
  runtime?: StationTerminalRuntime
  taskSignal?: StationTaskSignal
  channelBotBindings?: StationChannelBotBindingSummary[]
  isFullscreen?: boolean
  isFullscreenMode?: boolean
  isMiniature?: boolean
  isFocusHidden?: boolean
  workspaceId?: string | null
  workspaceCwd?: string | null
  onSelectStation: (stationId: string) => void
  onEditStation?: (station: AgentStation) => void

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
  onRenderedScreenSnapshot?: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onDropFilePath?: (stationId: string, payload: TerminalFileDropPayload) => Promise<void> | void
  onRestoreStateCaptured?: (
    stationId: string,
    state: StationTerminalRestoreStatePayload,
    sourceSessionId: string | null,
  ) => void
  onRemoveStation: (stationId: string) => void
  onEnterFullscreen: (stationId: string) => void
  onExitFullscreen: () => void
  onMinimizeStation?: (stationId: string, sourceRect: DOMRect) => void
  onRunAction: (station: AgentStation, action: StationActionDescriptor) => void
  commands?: ToolCommandSummary[]
  draggable?: boolean
  onStationDragPointerStart?: (event: ReactPointerEvent<HTMLElement>, stationId: string) => void
}

function StationCardView({
  locale,
  appearanceVersion,
  performanceDebugEnabled = false,
  station,
  active,
  runtime,
  taskSignal,
  isFullscreen,
  isFullscreenMode,
  isMiniature,
  isFocusHidden,
  workspaceId,
  workspaceCwd,
  onSelectStation,
  onEditStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSessionRelaunch,
  onForceCloseTerminal,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRenderedScreenSnapshot,
  onDropFilePath,
  onRestoreStateCaptured,
  onEnterFullscreen,
  onExitFullscreen,
  onMinimizeStation,
  onRunAction,
  commands = [],
  draggable = false,
  onStationDragPointerStart,
}: StationCardProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const terminalSinkRef = useRef<StationTerminalSink | null>(null)
  const pendingTerminalFocusRef = useRef(false)
  const terminalFocusRetryFrameRef = useRef<StationTerminalFocusRetryFrame | null>(null)
  const terminalFocusRetryBudgetRef = useRef(0)
  const activeRef = useRef(active)
  const [compactLayout, setCompactLayout] = useState(false)

  const recordStationUiDiagnostic = useCallback(
    (kind: 'ui-control-event', detail: string) => {
      if (typeof window === 'undefined') {
        return
      }
      void recordStationTerminalFocusDiagnostic({
        targetWindow: window,
        workspaceId,
        stationId: station.id,
        sessionId: runtime?.sessionId ?? null,
        kind,
        detail,
      })
    },
    [runtime?.sessionId, station.id, workspaceId],
  )

  const cancelScheduledTerminalFocus = useCallback(() => {
    const retryFrame = terminalFocusRetryFrameRef.current
    if (retryFrame === null) {
      return
    }
    terminalFocusRetryFrameRef.current = null
    retryFrame.cancel()
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

      if (terminalFocusRetryFrameRef.current !== null) {
        return
      }

      terminalFocusRetryBudgetRef.current -= 1
      terminalFocusRetryFrameRef.current = scheduleStationTerminalFocusRetryFrame({
        scheduler: createStationTerminalFrameFlushScheduler(window),
        fallbackDelayMs: TERMINAL_FOCUS_RETRY_FRAME_FALLBACK_MS,
        retry: () => {
          terminalFocusRetryFrameRef.current = null
          retryFocus()
        },
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

  const taskAckEmoji = taskSignal ? resolveStationTaskAckEmoji(taskSignal.nonce) : ''
  const hasTerminalSession = Boolean(runtime?.sessionId)
  const shouldRenderTerminal = shouldRenderStationTerminal(runtime)
  const sessionProvider = resolveStationSessionProvider(station)
  const discoverCwd = useMemo(() => {
    if (!workspaceCwd) {
      return null
    }
    return resolveAgentWorkdirAbs(workspaceCwd, station.agentWorkdirRel)
  }, [workspaceCwd, station.agentWorkdirRel])
  const sessionHistoryWorkspaceId = !shouldRenderTerminal && workspaceId && sessionProvider ? workspaceId : null
  const sessionHistory = useSessionHistory(
    sessionHistoryWorkspaceId,
    { discoverCwd, provider: sessionProvider },
  )
  const handleSessionDiscover = useCallback(() => {
    if (workspaceId && discoverCwd) {
      void sessionHistory.discover(workspaceId, discoverCwd, true)
    } else {
      void sessionHistory.refresh()
    }
  }, [workspaceId, discoverCwd, sessionHistory])
  const handleSessionRelaunch = useCallback(
    (request: import('@features/session').SessionRelaunchRequest) => {
      onSessionRelaunch?.(station.id, request)
    },
    [onSessionRelaunch, station.id],
  )
  const shouldAutoLaunchTerminal = shouldAutoLaunchStationTerminalFromSurface(runtime)

  const identityMeta = useMemo(
    () => buildStationCardIdentityMeta(station.name, station.tool),
    [station.name, station.tool],
  )
  const identityTitle = useMemo(() => identityMeta.map((item) => item.label).join(' · '), [identityMeta])
  const agentRunningForDisplay = hasTerminalSession
  const launchState = resolveStationCardLaunchState({
    sessionId: runtime?.sessionId ?? null,
    stateRaw: runtime?.stateRaw ?? null,
    agentRunning: agentRunningForDisplay,
  })
  const statusMeta = resolveStationCardStatusMeta({
    sessionId: runtime?.sessionId ?? null,
    stateRaw: runtime?.stateRaw ?? null,
    stationState: station.state,
  })
  const statusLabel = t(locale, statusMeta.labelKey)
  const statusDescription = t(locale, statusMeta.descriptionKey)
  const statusTitle = t(locale, '{agent}：{status}。{detail}', '{agent}: {status}. {detail}', {
    agent: station.name,
    status: statusLabel,
    detail: statusDescription,
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
      agentRunning: agentRunningForDisplay,
      onSelectStation,
      requestTerminalFocus,
      onLaunchCliAgent,
    })
  }, [agentRunningForDisplay, onLaunchCliAgent, onSelectStation, requestTerminalFocus, runtime?.sessionId, station.id])
  const activateStationAndOpenTerminal = useCallback(() => {
    activateStationAndFocusTerminal()
    onLaunchStationTerminal(station.id)
  }, [activateStationAndFocusTerminal, onLaunchStationTerminal, station.id])
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
    <motion.article
      ref={rootRef}
      layout="position"
      layoutId={`station-card:${station.id}`}
      transition={STATION_MOTION.cardLayoutTransition}
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
    >
      {taskSignal ? (
        <motion.div
          key={taskSignal.nonce}
          className="station-task-ack-bubble"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={STATION_MOTION.taskAckTransition}
        >
          <strong aria-label={locale === 'zh-CN' ? '任务收到' : 'Task received'}>{taskAckEmoji}</strong>
        </motion.div>
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
            <div className="station-window-identity-pill" title={identityTitle}>
              {identityMeta.map((item) => (
                <span
                  key={`${station.id}:${item.kind}`}
                  className={['station-window-identity-segment', `is-${item.kind}`].join(' ')}
                >
                  {item.label}
                </span>
              ))}
            </div>
            <span
              className={['station-runtime-status', `is-${statusMeta.tone}`].join(' ')}
              title={statusTitle}
              aria-label={statusTitle}
              data-status-key={statusMeta.key}
            >
              <span className="station-runtime-status-dot" aria-hidden="true" />
              <span className="station-runtime-status-label">{statusLabel}</span>
            </span>
          </div>
        </div>
        <div className="station-window-header-actions">
          <div className="station-window-action-group">
            <StationIconButton
              className={['station-primary-launch-btn', launchState].join(' ')}
              tooltip={primaryLaunchButtonLabel}
              ariaLabel={primaryLaunchButtonLabel}
              ariaPressed={launchState === 'live'}
              onPointerDown={(event) => {
                event.preventDefault()
              }}
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
              className="station-terminal-launch-btn"
              tooltip={t(locale, 'workbench.stationLaunchTerminal')}
              ariaLabel={t(locale, 'workbench.stationLaunchTerminal')}
              onPointerDown={(event) => {
                activateStationAndFocusTerminal()
                event.preventDefault()
              }}
              onClick={(event) => {
                event.stopPropagation()
                activateStationAndOpenTerminal()
              }}
            >
              <AppIcon name="terminal" className="vb-icon vb-icon-station-button" aria-hidden="true" />
            </StationIconButton>
            {onEditStation ? (
              <StationIconButton
                className="station-edit-btn"
                tooltip={t(locale, 'station.overview.editRole')}
                ariaLabel={t(locale, 'station.overview.editRole')}
                onClick={(event) => {
                  event.stopPropagation()
                  onEditStation(station)
                }}
              >
                <AppIcon name="user-pen" className="vb-icon vb-icon-station-button" aria-hidden="true" />
              </StationIconButton>
            ) : null}
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
          </div>
          <div className="station-window-action-group station-window-controls">
            <StationIconButton
              className="station-minimize-btn"
              tooltip={t(locale, 'workbench.minimizeStation')}
              ariaLabel={t(locale, 'workbench.minimizeStation')}
              onPointerDown={() => {
                recordStationUiDiagnostic('ui-control-event', 'station-card:minimize:pointerdown')
              }}
              onClick={(event) => {
                event.stopPropagation()
                recordStationUiDiagnostic('ui-control-event', 'station-card:minimize:click')
                const sourceRect = rootRef.current?.getBoundingClientRect()
                if (sourceRect) {
                  onMinimizeStation?.(station.id, sourceRect)
                } else {
                  onMinimizeStation?.(station.id, event.currentTarget.getBoundingClientRect())
                }
              }}
            >
              <AppIcon name="minus" className="vb-icon vb-icon-station-button" aria-hidden="true" />
            </StationIconButton>
            <StationIconButton
              className="station-fullscreen-btn"
              tooltip={t(locale, isFullscreen ? 'workbench.exitFullscreen' : 'workbench.fullscreen')}
              ariaLabel={t(locale, isFullscreen ? 'workbench.exitFullscreen' : 'workbench.fullscreen')}
              onPointerDown={() => {
                recordStationUiDiagnostic(
                  'ui-control-event',
                  `station-card:${isFullscreen ? 'fullscreen-exit' : 'fullscreen-enter'}:pointerdown`,
                )
              }}
              onClick={(event) => {
                event.stopPropagation()
                recordStationUiDiagnostic(
                  'ui-control-event',
                  `station-card:${isFullscreen ? 'fullscreen-exit' : 'fullscreen-enter'}:click`,
                )
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
            {runtime?.sessionId && onForceCloseTerminal ? (
              <StationIconButton
                className="station-force-close-btn"
                tooltip={t(locale, 'terminal.forceClose.button')}
                ariaLabel={t(locale, 'terminal.forceClose.button')}
                onPointerDown={() => {
                  recordStationUiDiagnostic('ui-control-event', 'station-card:force-close:pointerdown')
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  recordStationUiDiagnostic('ui-control-event', 'station-card:force-close:click')
                  onForceCloseTerminal(station.id)
                }}
              >
                <AppIcon name="close" className="vb-icon vb-icon-station-button" aria-hidden="true" />
              </StationIconButton>
            ) : null}
          </div>
        </div>
      </header>
      {shouldRenderTerminal ? (
        <>
          <StationXtermTerminal
            locale={locale}
            workspaceId={workspaceId}
            stationId={station.id}
            sessionId={runtime?.sessionId ?? null}
            stateRaw={runtime?.stateRaw ?? null}
            isActive={active}
            appearanceVersion={appearanceVersion}
            performanceDebugEnabled={performanceDebugEnabled}
            onActivateStation={activateStationFromTerminal}
            onData={onSendInputData}
            onResize={onResizeTerminal}
            onBindSink={handleBindSink}
            onRenderedScreenSnapshot={onRenderedScreenSnapshot}
            onDropFilePath={onDropFilePath}
            onRestoreStateCaptured={onRestoreStateCaptured}
          />
        </>
      ) : (
        <div className="station-terminal-idle-state">
          {sessionHistoryWorkspaceId ? (
            <SessionHistoryList
              locale={locale}
              cards={sessionHistory.cards}
              loading={sessionHistory.loading}
              error={sessionHistory.error}
              onDiscover={handleSessionDiscover}
              onRelaunch={onSessionRelaunch ? handleSessionRelaunch : undefined}
            />
          ) : null}
        </div>
      )}
      <StationActionDock actions={stationActions} compact={dockCompact} onAction={handleRunAction} />

    </motion.article>
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
    prev.performanceDebugEnabled === next.performanceDebugEnabled &&
    prev.station === next.station &&
    prev.active === next.active &&
    prev.isFullscreen === next.isFullscreen &&
    prev.isFullscreenMode === next.isFullscreenMode &&
    prev.isMiniature === next.isMiniature &&
    prev.isFocusHidden === next.isFocusHidden &&
    prev.draggable === next.draggable &&
    prev.onSelectStation === next.onSelectStation &&
    prev.onEditStation === next.onEditStation &&
    prev.onLaunchStationTerminal === next.onLaunchStationTerminal &&
    prev.onLaunchCliAgent === next.onLaunchCliAgent &&
    prev.workspaceId === next.workspaceId &&
    prev.workspaceCwd === next.workspaceCwd &&
    prev.onSessionRelaunch === next.onSessionRelaunch &&
    prev.onForceCloseTerminal === next.onForceCloseTerminal &&
    prev.onSendInputData === next.onSendInputData &&
    prev.onResizeTerminal === next.onResizeTerminal &&
    prev.onBindTerminalSink === next.onBindTerminalSink &&
    prev.onRenderedScreenSnapshot === next.onRenderedScreenSnapshot &&
    prev.onDropFilePath === next.onDropFilePath &&
    prev.onRestoreStateCaptured === next.onRestoreStateCaptured &&
    prev.onRemoveStation === next.onRemoveStation &&
    prev.onEnterFullscreen === next.onEnterFullscreen &&
    prev.onExitFullscreen === next.onExitFullscreen &&
    prev.onMinimizeStation === next.onMinimizeStation &&
    prev.onRunAction === next.onRunAction &&
    prev.commands === next.commands &&
    prev.onStationDragPointerStart === next.onStationDragPointerStart &&
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
