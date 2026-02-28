import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent, MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentStation, StationRole } from './model'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import { StationXtermTerminal, type StationTerminalSink } from './StationXtermTerminal'

const TERMINAL_FOCUS_MAX_RETRY_FRAMES = 4
const STATION_CARD_COMPACT_WIDTH_PX = 360
const STATION_CARD_COMPACT_HEIGHT_PX = 392
const STATION_TOOLTIP_OFFSET_PX = 6

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

interface StationIconButtonProps {
  tooltip: string
  className?: string
  ariaLabel: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}

function StationIconButton({ tooltip, className, ariaLabel, onClick, children }: StationIconButtonProps) {
  const tooltipId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null)

  const updateTooltipPosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) {
      return
    }
    const rect = button.getBoundingClientRect()
    setTooltipPosition({
      top: rect.top - STATION_TOOLTIP_OFFSET_PX,
      left: rect.left + rect.width / 2,
    })
  }, [])

  useLayoutEffect(() => {
    if (!tooltipOpen) {
      return
    }
    updateTooltipPosition()
  }, [tooltipOpen, updateTooltipPosition, tooltip])

  useEffect(() => {
    if (!tooltipOpen) {
      return
    }
    let frameId: number | null = null
    const scheduleUpdate = () => {
      if (frameId !== null) {
        return
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        updateTooltipPosition()
      })
    }
    const handleScroll = () => scheduleUpdate()
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [tooltipOpen, updateTooltipPosition])

  const handleMouseEnter = () => {
    setTooltipOpen(true)
  }

  const handleMouseLeave = () => {
    setTooltipOpen(false)
  }

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.matches(':focus-visible')) {
      return
    }
    setTooltipOpen(true)
  }

  const handleBlur = () => {
    setTooltipOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={['station-icon-button', className].filter(Boolean).join(' ')}
        aria-label={ariaLabel}
        aria-describedby={tooltipOpen ? tooltipId : undefined}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {children}
      </button>
      {tooltipOpen && tooltipPosition
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              className="station-icon-tooltip"
              style={{
                top: tooltipPosition.top,
                left: tooltipPosition.left,
              }}
            >
              {tooltip}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

interface StationTerminalRuntime {
  sessionId: string | null
  unreadCount: number
}

interface StationCardProps {
  locale: Locale
  appearanceVersion: string
  station: AgentStation
  active: boolean
  runtime?: StationTerminalRuntime
  taskSignal?: StationTaskSignal
  isFullscreen: boolean
  isFullscreenMode: boolean
  onSelectStation: (stationId: string) => void
  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: (stationId: string, sink: StationTerminalSink | null) => void
  onRemoveStation: (stationId: string) => void
  onEnterFullscreen: (stationId: string) => void
  onExitFullscreen: () => void
}

function buildTaskAckLine(locale: Locale, nonce: number): string {
  const zh = [
    '任务收到，键盘已经热身完成 😄⌨️',
    '收到老板，我先喝口咖啡就开工 ☕😎',
    '安排上了，这就开始啪啪打字 🚀',
  ]
  const en = [
    'Task received. Keyboard warmed up 😄⌨️',
    'Roger that. Coffee sip, then coding ☕😎',
    'Locked in. Typing noises incoming 🚀',
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
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRemoveStation,
  onEnterFullscreen,
  onExitFullscreen,
}: StationCardProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const terminalSinkRef = useRef<StationTerminalSink | null>(null)
  const pendingTerminalFocusRef = useRef(false)
  const terminalFocusFrameRef = useRef<number | null>(null)
  const terminalFocusRetryBudgetRef = useRef(0)
  const activeRef = useRef(active)
  const [compactLayout, setCompactLayout] = useState(false)

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

  const flushPendingTerminalFocus = useCallback(() => {
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
      flushPendingTerminalFocus()
    })
  }, [cancelScheduledTerminalFocus, terminalHasDomFocus])

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
  const unreadLabel =
    runtime && runtime.unreadCount > 0 ? (runtime.unreadCount > 99 ? '99+' : String(runtime.unreadCount)) : null
  const requestTerminalFocus = useCallback(() => {
    pendingTerminalFocusRef.current = true
    terminalFocusRetryBudgetRef.current = TERMINAL_FOCUS_MAX_RETRY_FRAMES
    flushPendingTerminalFocus()
  }, [flushPendingTerminalFocus])
  const activateStationAndFocusTerminal = useCallback(() => {
    onSelectStation(station.id)
    requestTerminalFocus()
  }, [onSelectStation, requestTerminalFocus, station.id])
  const activateStationAndOpenTerminal = useCallback(() => {
    activateStationAndFocusTerminal()
    if (!runtime?.sessionId) {
      onLaunchStationTerminal(station.id)
    }
  }, [activateStationAndFocusTerminal, onLaunchStationTerminal, runtime?.sessionId, station.id])
  const activateStationFromTerminal = useCallback(() => {
    onSelectStation(station.id)
    if (!runtime?.sessionId) {
      onLaunchStationTerminal(station.id)
    }
  }, [onLaunchStationTerminal, onSelectStation, runtime?.sessionId, station.id])
  const activateStationOnly = useCallback(() => {
    onSelectStation(station.id)
  }, [onSelectStation, station.id])

  const handleBindSink = useCallback(
    (stationId: string, sink: StationTerminalSink | null) => {
      terminalSinkRef.current = sink
      onBindTerminalSink(stationId, sink)
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
        <div className="station-window-title-wrap">
          <h3>{station.name}</h3>
          <p>{roleLabel(locale, station.role)}</p>
        </div>
        {unreadLabel ? (
          <span
            className="station-unread-badge"
            aria-label={t(locale, '未读终端活动', 'Unread terminal activity')}
          >
            {unreadLabel}
          </span>
        ) : null}
        <div className="station-window-header-actions">
          <StationIconButton
            className="station-launch-terminal-btn"
            tooltip={t(locale, 'workbench.launchTerminal')}
            ariaLabel={t(locale, 'workbench.launchTerminal')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndOpenTerminal()
            }}
          >
            <AppIcon name="terminal" className="vb-icon vb-icon-station-button" aria-hidden="true" />
          </StationIconButton>
          <StationIconButton
            className="station-launch-cli-btn"
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
            className="station-fullscreen-toggle"
            tooltip={isFullscreen ? t(locale, 'workbench.exitFullscreen') : t(locale, 'workbench.fullscreen')}
            ariaLabel={isFullscreen ? t(locale, 'workbench.exitFullscreen') : t(locale, 'workbench.fullscreen')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndFocusTerminal()
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
          <StationIconButton
            className="station-remove-btn"
            tooltip={t(locale, 'workbench.removeStation')}
            ariaLabel={t(locale, 'workbench.removeStation')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndFocusTerminal()
              onRemoveStation(station.id)
            }}
          >
            <AppIcon name="close" className="vb-icon vb-icon-station-button" aria-hidden="true" />
          </StationIconButton>
        </div>
      </header>

      <div className="station-meta-compact">
        <p>{station.agentWorkdirRel}</p>
        <p>{station.tool}</p>
      </div>

      <StationXtermTerminal
        stationId={station.id}
        sessionId={runtime?.sessionId ?? null}
        appearanceVersion={appearanceVersion}
        onActivateStation={activateStationFromTerminal}
        onData={onSendInputData}
        onResize={onResizeTerminal}
        onBindSink={handleBindSink}
      />

    </article>
  )
}

function areStationCardPropsEqual(prev: StationCardProps, next: StationCardProps): boolean {
  return (
    prev.locale === next.locale &&
    prev.appearanceVersion === next.appearanceVersion &&
    prev.station === next.station &&
    prev.active === next.active &&
    prev.isFullscreen === next.isFullscreen &&
    prev.isFullscreenMode === next.isFullscreenMode &&
    (prev.runtime?.sessionId ?? null) === (next.runtime?.sessionId ?? null) &&
    (prev.runtime?.unreadCount ?? 0) === (next.runtime?.unreadCount ?? 0) &&
    (prev.taskSignal?.nonce ?? null) === (next.taskSignal?.nonce ?? null) &&
    (prev.taskSignal?.taskId ?? null) === (next.taskSignal?.taskId ?? null)
  )
}

export const StationCard = memo(StationCardView, areStationCardPropsEqual)
