import { memo, useMemo, useCallback } from 'react'
import type { AgentStation } from './station-model'
import { StationActionDock } from './StationActionDock'
import { StationActivityComet } from './StationActivityComet'
import { resolveStationActions } from './station-action-registry'
import type { StationActionDescriptor } from './station-action-model'
import { resolveStationTaskAckEmoji } from './station-task-ack-emoji'
import { useStationActivitySignal } from './useStationActivitySignal'
import type { StationTaskSignal } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import {
  StationXtermTerminal,
  type StationTerminalSinkBindingHandler,
} from '@features/terminal'
import { recordStationTerminalFocusDiagnostic } from '@features/terminal/station-terminal-focus-diagnostics'
import type { StationChannelBotBindingSummary } from '@features/tool-adapter'
import type { RenderedScreenSnapshot, ToolCommandSummary } from '@shell/integration/desktop-api'
import { SessionHistoryList, useSessionHistory, resolveStationSessionProvider } from '@features/session'
import { resolveAgentWorkdirAbs } from '@features/workspace/station-workdir-model'
import './TerminalStationPane.scss'

export interface WorkbenchStationRuntime {
  sessionId: string | null
  unreadCount: number
  stateRaw?: string
  shell?: string | null
  cwdMode?: 'workspace_root' | 'custom'
  resolvedCwd?: string | null
}

type PaneLaunchMode = 'workspace' | 'detached-readonly'

function roleLabel(locale: Locale, station: AgentStation): string {
  switch (station.role) {
    case 'orchestrator':
      return t(locale, 'station.role.orchestrator')
    case 'analyst':
      return t(locale, 'station.role.analyst')
    case 'generator':
      return t(locale, 'station.role.generator')
    case 'evaluator':
      return t(locale, 'station.role.evaluator')
    default:
      return station.roleName || station.role
  }
}

function stationChannelLabel(locale: Locale, channel: string): string {
  if (channel === 'telegram') {
    return 'Telegram'
  }
  if (channel === 'feishu') {
    return t(locale, '飞书', 'Feishu')
  }
  return channel
}

function sessionStateLabel(locale: Locale, hasTerminalSession: boolean): string {
  return hasTerminalSession ? t(locale, '实时会话', 'Live session') : t(locale, '待启动', 'Ready')
}

interface TerminalStationPaneProps {
  locale: Locale
  appearanceVersion: string
  station: AgentStation
  runtime?: WorkbenchStationRuntime
  workspaceId?: string | null
  workspaceCwd?: string | null
  onShouldConfirmInterrupt?: (stationId: string, sessionId: string) => Promise<boolean> | boolean
  taskSignal?: StationTaskSignal
  channelBotBindings?: StationChannelBotBindingSummary[]
  active: boolean
  launchMode?: PaneLaunchMode
  onSelectStation: (stationId: string) => void
  onLaunchStationTerminal: (stationId: string) => void
  onLaunchCliAgent: (stationId: string) => void
  onForceCloseTerminal?: (stationId: string) => void
  onSendInputData: (stationId: string, data: string) => void
  onResizeTerminal: (stationId: string, cols: number, rows: number) => void
  onBindTerminalSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onReturnToWorkspace?: () => void
  onRunAction: (station: AgentStation, action: StationActionDescriptor) => void
  onSessionRelaunch?: (request: import('@features/session').SessionRelaunchRequest) => void
  commands?: ToolCommandSummary[]
}

function TerminalStationPaneView({
  locale,
  appearanceVersion,
  station,
  runtime,
  workspaceId,
  workspaceCwd,
  onShouldConfirmInterrupt,
  taskSignal,
  channelBotBindings,
  active,
  launchMode = 'workspace',
  onSelectStation,
  onLaunchStationTerminal,
  onLaunchCliAgent,
  onForceCloseTerminal,
  onSendInputData,
  onResizeTerminal,
  onBindTerminalSink,
  onRenderedScreenSnapshot,
  onReturnToWorkspace,
  onRunAction,
  onSessionRelaunch,
  commands = [],
}: TerminalStationPaneProps) {
  const taskAckEmoji = taskSignal ? resolveStationTaskAckEmoji(taskSignal.nonce) : ''
  const hasTerminalSession = Boolean(runtime?.sessionId)
  const activitySignal = useStationActivitySignal(active ? 0 : runtime?.unreadCount)
  const visibleChannelBindingSummaries = (channelBotBindings ?? []).slice(0, 2)
  const hiddenChannelBindingCount = Math.max(0, (channelBotBindings ?? []).length - visibleChannelBindingSummaries.length)
  const sessionLabel = sessionStateLabel(locale, hasTerminalSession)
  const detachedReadonly = launchMode === 'detached-readonly'
  const stationActions = useMemo(
    () =>
      resolveStationActions({
        station,
        hasTerminalSession,
        detachedReadonly,
        commands,
      }),
    [commands, detachedReadonly, hasTerminalSession, station],
  )
  const handleRunAction = useMemo(
    () => (action: StationActionDescriptor) => onRunAction(station, action),
    [onRunAction, station],
  )
  const sessionProvider = resolveStationSessionProvider(station)
  const discoverCwd = useMemo(() => {
    if (!workspaceCwd) {
      return null
    }
    return resolveAgentWorkdirAbs(workspaceCwd, station.agentWorkdirRel)
  }, [workspaceCwd, station.agentWorkdirRel])
  const sessionHistory = useSessionHistory(
    !hasTerminalSession && workspaceId && sessionProvider ? workspaceId : null,
    { discoverCwd, provider: sessionProvider },
  )
  const handleSessionDiscover = useCallback(() => {
    if (workspaceId && discoverCwd) {
      void sessionHistory.discover(workspaceId, discoverCwd, true)
    } else {
      void sessionHistory.refresh()
    }
  }, [workspaceId, discoverCwd, sessionHistory])
  const recordStationUiDiagnostic = useMemo(
    () => (detail: string) => {
      if (typeof window === 'undefined') {
        return
      }
      void recordStationTerminalFocusDiagnostic({
        targetWindow: window,
        stationId: station.id,
        sessionId: runtime?.sessionId ?? null,
        kind: 'ui-control-event',
        detail,
      })
    },
    [runtime?.sessionId, station.id],
  )

  return (
    <section className={['terminal-station-pane', active ? 'active' : ''].join(' ')}>
      {taskSignal ? (
        <div key={taskSignal.nonce} className="terminal-station-pane-task-bubble" role="status" aria-live="polite">
          <strong aria-label={locale === 'zh-CN' ? '任务收到' : 'Task received'}>{taskAckEmoji}</strong>
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        className="terminal-station-pane-meta"
        onClick={() => onSelectStation(station.id)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return
          }
          event.preventDefault()
          onSelectStation(station.id)
        }}
      >
        <div className="terminal-station-pane-meta-row">
          <div className="terminal-station-pane-title">
            <strong>{station.name}</strong>
            <span>{roleLabel(locale, station)}</span>
          </div>
          {activitySignal ? (
            <StationActivityComet
              locale={locale}
              level={activitySignal}
              size="compact"
              className="terminal-station-pane-comet"
            />
          ) : null}
          {hasTerminalSession && onForceCloseTerminal ? (
            <button
              type="button"
              className="terminal-station-pane-force-close"
              aria-label={t(locale, 'terminal.forceClose.button')}
              title={t(locale, 'terminal.forceClose.button')}
              onPointerDown={() => {
                recordStationUiDiagnostic('terminal-pane:force-close:pointerdown')
              }}
              onClick={(event) => {
                event.stopPropagation()
                recordStationUiDiagnostic('terminal-pane:force-close:click')
                onForceCloseTerminal(station.id)
              }}
            >
              <AppIcon name="close" className="vb-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="terminal-station-pane-meta-row terminal-station-pane-meta-row-secondary">
          <span className="terminal-station-pane-chip" title={station.tool}>
            {station.tool}
          </span>
          <span className={['terminal-station-pane-chip', hasTerminalSession ? 'live' : 'idle'].join(' ')}>
            {sessionLabel}
          </span>
          {visibleChannelBindingSummaries.map((summary) => (
            <span
              key={`${station.id}:${summary.channel}:${summary.accountId}`}
              className="terminal-station-pane-chip muted"
              title={t(locale, 'station.channelBindings.botRoute', {
                channel: stationChannelLabel(locale, summary.channel),
                accountId: summary.accountId,
                count: summary.routeCount,
              })}
            >
              {summary.accountId}
            </span>
          ))}
          {hiddenChannelBindingCount > 0 ? (
            <span className="terminal-station-pane-chip muted">
              {t(locale, 'station.channelBindings.more', { count: hiddenChannelBindingCount })}
            </span>
          ) : null}
        </div>
      </div>

      {hasTerminalSession ? (
        <>
          <StationXtermTerminal
            locale={locale}
            stationId={station.id}
            sessionId={runtime?.sessionId ?? null}
            isActive={active}
            onShouldConfirmInterrupt={onShouldConfirmInterrupt}
            appearanceVersion={appearanceVersion}
            onActivateStation={() => onSelectStation(station.id)}
            onData={onSendInputData}
            onResize={onResizeTerminal}
            onBindSink={onBindTerminalSink}
            onRenderedScreenSnapshot={onRenderedScreenSnapshot}
          />
        </>
      ) : (
        <div className="terminal-station-pane-idle-state">
          {workspaceId && sessionProvider ? (
            <StationSessionHistoryPanel
              locale={locale}
              workspaceId={workspaceId}
              discoverCwd={discoverCwd}
              provider={sessionProvider}
              onRelaunch={onSessionRelaunch}
            />
          ) : null}
          <div className="terminal-station-pane-idle-actions">
            <button
              type="button"
              className="terminal-station-pane-idle-button primary"
              onClick={() => onLaunchStationTerminal(station.id)}
            >
              <AppIcon name="terminal" className="vb-icon vb-icon-station-button" aria-hidden="true" />
              <span>{t(locale, 'workbench.stationLaunchTerminal')}</span>
            </button>
            <button
              type="button"
              className="terminal-station-pane-idle-button"
              onClick={() => onLaunchCliAgent(station.id)}
            >
              <AppIcon name="sparkles" className="vb-icon vb-icon-station-button" aria-hidden="true" />
              <span>{t(locale, 'workbench.stationLaunchAgent')}</span>
            </button>
            {detachedReadonly && onReturnToWorkspace ? (
              <button
                type="button"
                className="terminal-station-pane-idle-button"
                onClick={onReturnToWorkspace}
              >
                <AppIcon name="fullscreen-exit" className="vb-icon vb-icon-station-button" aria-hidden="true" />
                <span>{t(locale, 'workbench.returnToWorkspace')}</span>
              </button>
            ) : null}
          </div>
        </div>
      )}
      <StationActionDock actions={stationActions} onAction={handleRunAction} />
    </section>
  )
}

export const TerminalStationPane = memo(TerminalStationPaneView)
