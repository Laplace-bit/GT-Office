import { memo } from 'react'
import type { TaskDispatchRecord } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import './CommunicationChannelsPane.scss'

type ExternalChannelEventItem = {
  id: string
  tsMs: number
  kind: 'inbound' | 'routed' | 'dispatch' | 'reply' | 'outbound' | 'error'
  primary: string
  channel?: string
  status?: 'received' | 'sent' | 'failed'
  secondary?: string
  detail?: string
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

function externalChannelLabel(locale: Locale, channel: string): string {
  if (channel === 'telegram') {
    return 'Telegram'
  }
  if (channel === 'feishu') {
    return t(locale, '飞书', 'Feishu')
  }
  return channel
}

function eventStatusLabel(locale: Locale, event: ExternalChannelEventItem): string {
  if (event.status === 'failed' || event.kind === 'error') {
    return t(locale, 'taskCenter.status.failed')
  }
  if (event.status === 'sent' || event.kind === 'outbound') {
    return t(locale, 'taskCenter.status.sent')
  }
  return t(locale, 'taskCenter.external.events.kind.inbound')
}

function eventStatusClass(event: ExternalChannelEventItem): string {
  if (event.status === 'failed' || event.kind === 'error') {
    return 'failed'
  }
  if (event.status === 'sent' || event.kind === 'outbound') {
    return 'sent'
  }
  return 'received'
}

function eventStatusIcon(event: ExternalChannelEventItem): 'arrow-down' | 'check' | 'x-mark' {
  if (event.status === 'failed' || event.kind === 'error') {
    return 'x-mark'
  }
  if (event.status === 'sent' || event.kind === 'outbound') {
    return 'check'
  }
  return 'arrow-down'
}

function eventChannelIcon(channel: string): 'telegram' | 'feishu' | 'external' {
  if (channel === 'telegram') {
    return 'telegram'
  }
  if (channel === 'feishu') {
    return 'feishu'
  }
  return 'external'
}

function resolveEventContent(event: ExternalChannelEventItem): string {
  return event.primary.trim() || event.secondary?.trim() || event.detail?.trim() || '-'
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
  void dispatchHistory
  void retryingTaskId
  void onRetryDispatchTask
  void onRefreshExternalStatus

  return (
    <aside className="panel communication-channels-pane">
      <header className="communication-channels-header">
        <h2>{t(locale, 'pane.channels.title')}</h2>
      </header>

      <section className="communication-channels-surface">
        <div className="communication-channels-feed">
          <header className="communication-channels-feed-header">
            <div>
              <h3>{t(locale, 'taskCenter.external.events.title')}</h3>
            </div>
          </header>
          {externalEvents.length === 0 ? (
            <p className="communication-channels-empty">
              {t(locale, 'taskCenter.external.events.empty')}
            </p>
          ) : (
            <ul>
              {externalEvents.map((event) => {
                const content = resolveEventContent(event)
                const channel =
                  event.channel ?? externalStatus.configuredChannels?.[0] ?? 'external'
                const channelLabel = externalChannelLabel(locale, channel)
                const statusLabel = eventStatusLabel(locale, event)

                return (
                <li key={event.id} className="communication-channels-message-row">
                  <div className="communication-channels-message-copy">
                    <p className="communication-channels-message-content" title={content}>
                      {content}
                    </p>
                    {event.detail && event.status === 'failed' ? (
                      <p className="communication-channels-message-detail" title={event.detail}>
                        {event.detail}
                      </p>
                    ) : null}
                  </div>
                  <div className="communication-channels-message-meta">
                    <span
                      className="communication-channels-message-time"
                      title={formatTimestamp(event.tsMs)}
                    >
                      <AppIcon name="clock" aria-hidden="true" />
                      <span>{formatTimestamp(event.tsMs)}</span>
                    </span>
                    <span
                      className="communication-channels-message-channel"
                      title={channelLabel}
                    >
                      <AppIcon name={eventChannelIcon(channel)} aria-hidden="true" />
                      <span>{channelLabel}</span>
                    </span>
                    <span
                      className={`communication-channels-message-status ${eventStatusClass(event)}`}
                      title={statusLabel}
                    >
                      <AppIcon name={eventStatusIcon(event)} aria-hidden="true" />
                      <span>{statusLabel}</span>
                    </span>
                  </div>
                </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </aside>
  )
}

export const CommunicationChannelsPane = memo(CommunicationChannelsPaneView)
