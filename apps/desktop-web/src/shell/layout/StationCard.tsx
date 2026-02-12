import { memo, useCallback, useEffect, useRef } from 'react'
import type { AgentStation } from './model'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import { StationXtermTerminal, type StationTerminalSink } from './StationXtermTerminal'

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
  previewText: string
  renderTerminal: boolean
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
  previewText,
  renderTerminal,
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
  const taskBubbleLine = taskSignal ? buildTaskAckLine(locale, taskSignal.nonce) : ''
  const unreadLabel =
    runtime && runtime.unreadCount > 0 ? (runtime.unreadCount > 99 ? '99+' : String(runtime.unreadCount)) : null
  const requestTerminalFocus = useCallback(() => {
    pendingTerminalFocusRef.current = true
    if (!active || !renderTerminal) {
      return
    }
    window.requestAnimationFrame(() => {
      if (!pendingTerminalFocusRef.current) {
        return
      }
      terminalSinkRef.current?.focus()
      pendingTerminalFocusRef.current = false
    })
  }, [active, renderTerminal])
  const activateStationAndFocusTerminal = useCallback(() => {
    onSelectStation(station.id)
    requestTerminalFocus()
  }, [onSelectStation, requestTerminalFocus, station.id])

  const handleBindSink = useCallback(
    (stationId: string, sink: StationTerminalSink | null) => {
      terminalSinkRef.current = sink
      onBindTerminalSink(stationId, sink)
      if (sink && pendingTerminalFocusRef.current && active && renderTerminal) {
        window.requestAnimationFrame(() => {
          if (!pendingTerminalFocusRef.current) {
            return
          }
          sink.focus()
          pendingTerminalFocusRef.current = false
        })
      }
    },
    [active, onBindTerminalSink, renderTerminal],
  )

  useEffect(() => {
    if (!active || !renderTerminal || !pendingTerminalFocusRef.current) {
      return
    }
    window.requestAnimationFrame(() => {
      if (!pendingTerminalFocusRef.current) {
        return
      }
      terminalSinkRef.current?.focus()
      pendingTerminalFocusRef.current = false
    })
  }, [active, renderTerminal])

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
        isFullscreen ? 'fullscreen' : '',
        isFullscreenMode && !isFullscreen ? 'background-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        // Let terminal own its internal click handling; card click should activate+focus terminal.
        const target = event.target as HTMLElement
        if (target.closest('.station-terminal-shell')) {
          return
        }
        activateStationAndFocusTerminal()
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
          <p>{station.role}</p>
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
          <button
            type="button"
            className="station-icon-button station-launch-terminal-btn"
            data-tooltip={t(locale, 'workbench.launchTerminal')}
            aria-label={t(locale, 'workbench.launchTerminal')}
            title={t(locale, 'workbench.launchTerminal')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndFocusTerminal()
              onLaunchStationTerminal(station.id)
            }}
          >
            <AppIcon name="terminal" className="vb-icon vb-icon-station-button" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="station-icon-button station-launch-cli-btn"
            data-tooltip={t(locale, 'workbench.launchCliAgent')}
            aria-label={t(locale, 'workbench.launchCliAgent')}
            title={t(locale, 'workbench.launchCliAgent')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndFocusTerminal()
              onLaunchCliAgent(station.id)
            }}
          >
            <AppIcon name="sparkles" className="vb-icon vb-icon-station-button" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="station-icon-button station-fullscreen-toggle"
            data-tooltip={isFullscreen ? t(locale, 'workbench.exitFullscreen') : t(locale, 'workbench.fullscreen')}
            aria-label={isFullscreen ? t(locale, 'workbench.exitFullscreen') : t(locale, 'workbench.fullscreen')}
            title={isFullscreen ? t(locale, 'workbench.exitFullscreen') : t(locale, 'workbench.fullscreen')}
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
          </button>
          <button
            type="button"
            className="station-icon-button station-remove-btn"
            data-tooltip={t(locale, 'workbench.removeStation')}
            aria-label={t(locale, 'workbench.removeStation')}
            title={t(locale, 'workbench.removeStation')}
            onClick={(event) => {
              event.stopPropagation()
              activateStationAndFocusTerminal()
              onRemoveStation(station.id)
            }}
          >
            <AppIcon name="close" className="vb-icon vb-icon-station-button" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="station-meta-compact">
        <p>{station.agentWorkdirRel}</p>
        <p>{station.tool}</p>
      </div>

      {renderTerminal ? (
        <StationXtermTerminal
          stationId={station.id}
          sessionId={runtime?.sessionId ?? null}
          appearanceVersion={appearanceVersion}
          onData={onSendInputData}
          onResize={onResizeTerminal}
          onBindSink={handleBindSink}
        />
      ) : (
        <div
          className="station-terminal-preview-shell"
          aria-label={t(locale, '终端预览', 'Terminal preview')}
        >
          <pre>{previewText || t(locale, 'workbench.noLiveOutput')}</pre>
        </div>
      )}
    </article>
  )
}

function areStationCardPropsEqual(prev: StationCardProps, next: StationCardProps): boolean {
  return (
    prev.locale === next.locale &&
    prev.appearanceVersion === next.appearanceVersion &&
    prev.station === next.station &&
    prev.active === next.active &&
    prev.previewText === next.previewText &&
    prev.renderTerminal === next.renderTerminal &&
    prev.isFullscreen === next.isFullscreen &&
    prev.isFullscreenMode === next.isFullscreenMode &&
    (prev.runtime?.sessionId ?? null) === (next.runtime?.sessionId ?? null) &&
    (prev.runtime?.unreadCount ?? 0) === (next.runtime?.unreadCount ?? 0) &&
    (prev.taskSignal?.nonce ?? null) === (next.taskSignal?.nonce ?? null) &&
    (prev.taskSignal?.taskId ?? null) === (next.taskSignal?.taskId ?? null)
  )
}

export const StationCard = memo(StationCardView, areStationCardPropsEqual)
