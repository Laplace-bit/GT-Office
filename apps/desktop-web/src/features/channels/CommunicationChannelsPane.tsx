import { memo, useState } from 'react'
import type { TaskDispatchRecord } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import './CommunicationChannelsPane.scss'

type ExternalChannelEventItem = {
  id: string
  tsMs: number
  kind: 'inbound' | 'routed' | 'dispatch' | 'reply' | 'error'
  primary: string
  secondary?: string
}

interface CommunicationChannelsPaneProps {
  locale: Locale
  dispatchHistory: TaskDispatchRecord[]
  retryingTaskId: string | null
  externalStatus: {
    loading: boolean
    running: boolean
    doctorOk: boolean | null
    runtimeBaseUrl: string | null
    feishuWebhook: string | null
    telegramWebhook: string | null
    summary: {
      routeBindings: number
      allowlistEntries: number
      pairingPending: number
      idempotencyEntries: number
    } | null
    lastSyncAtMs: number | null
    error: string | null
    bindings?: Array<{ channel: string }>
    configuredChannels?: string[]
  }
  externalEvents: ExternalChannelEventItem[]
  onRetryDispatchTask: (taskId: string) => void
  onRefreshExternalStatus: () => void
}

function statusLabel(locale: Locale, status: TaskDispatchRecord['status']): string {
  if (status === 'sending') {
    return t(locale, 'taskCenter.status.sending')
  }
  if (status === 'sent') {
    return t(locale, 'taskCenter.status.sent')
  }
  return t(locale, 'taskCenter.status.failed')
}

function externalEventKindLabel(
  locale: Locale,
  kind: ExternalChannelEventItem['kind'],
): string {
  if (kind === 'inbound') {
    return t(locale, 'taskCenter.external.events.kind.inbound')
  }
  if (kind === 'routed') {
    return t(locale, 'taskCenter.external.events.kind.routed')
  }
  if (kind === 'dispatch') {
    return t(locale, 'taskCenter.external.events.kind.dispatch')
  }
  if (kind === 'reply') {
    return t(locale, 'taskCenter.external.events.kind.reply')
  }
  return t(locale, 'taskCenter.external.events.kind.error')
}

function externalChannelLabel(locale: Locale, channel: string): string {
  if (channel === 'telegram') {
    return 'Telegram'
  }
  if (channel === 'feishu') {
    return t(locale, '飞书', 'Feishu')
  }
  return channel
}

function formatTimestamp(value: number): string {
  const date = new Date(value)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

function CommunicationChannelsPaneView({
  locale,
  dispatchHistory,
  retryingTaskId,
  externalStatus,
  externalEvents,
  onRetryDispatchTask,
  onRefreshExternalStatus,
}: CommunicationChannelsPaneProps) {
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true)

  return (
    <aside className="panel communication-channels-pane">
      <header className="communication-channels-header">
        <h2>{t(locale, 'pane.channels.title')}</h2>
        <p>{t(locale, 'pane.channels.subtitle')}</p>
      </header>

      <section className="communication-channels-card">
        <header className="communication-channels-card-header">
          <div>
            <h3>{t(locale, 'taskCenter.external.title')}</h3>
            <p>{t(locale, 'taskCenter.external.subtitle')}</p>
          </div>
          <div className="communication-channels-card-controls">
            <span
              className={`communication-channels-runtime-pill ${
                externalStatus.running ? 'running' : 'stopped'
              }`}
            >
              {externalStatus.running
                ? t(locale, 'taskCenter.external.runtime.running')
                : t(locale, 'taskCenter.external.runtime.stopped')}
            </span>
            <button
              type="button"
              onClick={onRefreshExternalStatus}
              disabled={externalStatus.loading}
            >
              {externalStatus.loading
                ? t(locale, 'taskCenter.external.refreshing')
                : t(locale, 'taskCenter.external.refresh')}
            </button>
          </div>
        </header>

        {externalStatus.configuredChannels && externalStatus.configuredChannels.length > 0 ? (
          <div className="communication-channels-summary-pills">
            {externalStatus.configuredChannels.map((channel) => (
              <span key={channel}>{externalChannelLabel(locale, channel)}</span>
            ))}
          </div>
        ) : (
          <div className="communication-channels-summary-empty">
            <span>{t(locale, 'taskCenter.external.configuredEmpty')}</span>
          </div>
        )}

        {externalStatus.summary ? (
          <div className="communication-channels-stats">
            <span>
              {t(locale, 'taskCenter.external.summary.routeBindings', {
                count: externalStatus.summary.routeBindings,
              })}
            </span>
            <span>
              {t(locale, 'taskCenter.external.summary.allowlistEntries', {
                count: externalStatus.summary.allowlistEntries,
              })}
            </span>
            <span>
              {t(locale, 'taskCenter.external.summary.pairingPending', {
                count: externalStatus.summary.pairingPending,
              })}
            </span>
            <span>
              {t(locale, 'taskCenter.external.summary.idempotencyEntries', {
                count: externalStatus.summary.idempotencyEntries,
              })}
            </span>
          </div>
        ) : null}

        <div className="communication-channels-meta">
          {externalStatus.lastSyncAtMs ? (
            <span>
              {t(locale, 'taskCenter.external.lastSyncAt', {
                time: formatTimestamp(externalStatus.lastSyncAtMs),
              })}
            </span>
          ) : null}
          {externalStatus.doctorOk === false ? (
            <span className="communication-channels-meta-warn">
              {t(locale, 'taskCenter.external.doctorWarn')}
            </span>
          ) : null}
          {externalStatus.error ? (
            <span className="communication-channels-meta-error">{externalStatus.error}</span>
          ) : null}
        </div>

        <div className="communication-channels-event-list">
          <h4>{t(locale, 'taskCenter.external.events.title')}</h4>
          {externalEvents.length === 0 ? (
            <p className="communication-channels-empty">
              {t(locale, 'taskCenter.external.events.empty')}
            </p>
          ) : (
            <ul>
              {externalEvents.map((event) => (
                <li key={event.id}>
                  <div className="communication-channels-event-row">
                    <span className={`communication-channels-event-kind ${event.kind}`}>
                      {externalEventKindLabel(locale, event.kind)}
                    </span>
                    <span>{formatTimestamp(event.tsMs)}</span>
                  </div>
                  <p>{event.primary}</p>
                  {event.secondary ? <p>{event.secondary}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="communication-channels-card communication-channels-history">
        <header
          className="communication-channels-history-header"
          onClick={() => setIsHistoryExpanded((prev) => !prev)}
        >
          <h3>{t(locale, 'taskCenter.history')}</h3>
          <AppIcon
            name="chevron-down"
            className={isHistoryExpanded ? 'communication-channels-chevron expanded' : 'communication-channels-chevron'}
          />
        </header>

        <div
          className={
            isHistoryExpanded
              ? 'communication-channels-history-body expanded'
              : 'communication-channels-history-body'
          }
        >
          <div className="communication-channels-history-inner">
            {dispatchHistory.length === 0 ? (
              <p className="communication-channels-empty">{t(locale, 'taskCenter.historyEmpty')}</p>
            ) : (
              <ul>
                {dispatchHistory.map((record) => (
                  <li key={`${record.batchId}:${record.taskId}`}>
                    <div className="communication-channels-history-title-row">
                      <strong>{record.title}</strong>
                      <span className={`communication-channels-status ${record.status}`}>
                        {statusLabel(locale, record.status)}
                      </span>
                    </div>
                    <p>
                      {record.taskId} · {record.targetStationName} ·{' '}
                      {formatTimestamp(record.createdAtMs)}
                    </p>
                    <p>
                      <code>{record.taskFilePath}</code>
                    </p>
                    {record.status === 'failed' ? (
                      <div className="communication-channels-history-actions">
                        <button
                          type="button"
                          onClick={() => onRetryDispatchTask(record.taskId)}
                          disabled={Boolean(retryingTaskId)}
                        >
                          {retryingTaskId === record.taskId
                            ? t(locale, 'taskCenter.retrying')
                            : t(locale, 'taskCenter.retryFailed')}
                        </button>
                      </div>
                    ) : null}
                    {record.detail ? (
                      <p className="communication-channels-history-detail">{record.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </aside>
  )
}

export const CommunicationChannelsPane = memo(CommunicationChannelsPaneView)
