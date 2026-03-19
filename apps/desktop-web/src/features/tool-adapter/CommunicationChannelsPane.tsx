import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskDispatchRecord } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import type { ChannelRouteBinding } from '@shell/integration/desktop-api'
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
  accountId?: string
  peerKind?: 'direct' | 'group'
  peerId?: string
  senderId?: string
  targetAgentId?: string
  endpointKey?: string
  conversationKey?: string
}

type EventDirection = 'inbound' | 'outbound'
type ConversationGroup = {
  key: string
  label: string
  events: ExternalChannelEventItem[]
  latestTsMs: number
}

interface CommunicationChannelsPaneProps {
  locale: Locale
  agentNameMap: Record<string, string>
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
    bindings?: ChannelRouteBinding[]
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

function eventStatusClass(event: ExternalChannelEventItem): string {
  if (event.status === 'failed' || event.kind === 'error') {
    return 'failed'
  }
  if (event.status === 'sent' || event.kind === 'outbound') {
    return 'sent'
  }
  return 'received'
}

function resolveEventDirection(event: ExternalChannelEventItem): EventDirection {
  if (event.kind === 'inbound' || event.status === 'received') {
    return 'inbound'
  }
  return 'outbound'
}

function resolveEventContent(event: ExternalChannelEventItem): string {
  return event.primary.trim() || event.secondary?.trim() || event.detail?.trim() || '-'
}

function shouldShowFailureDetail(event: ExternalChannelEventItem): boolean {
  return Boolean(event.detail && (event.status === 'failed' || event.kind === 'error'))
}

function resolveConversationKey(event: ExternalChannelEventItem): string {
  if (event.conversationKey?.trim()) {
    return event.conversationKey.trim()
  }
  const endpointKey =
    event.endpointKey?.trim() ||
    `${event.channel?.trim().toLowerCase() || 'external'}::${event.peerId?.trim() || 'unknown-peer'}`
  const targetAgentId = event.targetAgentId?.trim() || 'pending'
  return `${endpointKey}::${targetAgentId}`
}

function normalizeBindingToken(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase()
  return normalized || fallback
}

function resolveConversationBinding(
  event: ExternalChannelEventItem,
  bindings: ChannelRouteBinding[],
): ChannelRouteBinding | null {
  if (bindings.length === 0) {
    return null
  }
  const eventChannel = normalizeBindingToken(event.channel, 'external')
  const eventTarget = event.targetAgentId?.trim() || null
  const eventAccount = normalizeBindingToken(event.accountId, 'default')
  const eventPeerKind = normalizeBindingToken(event.peerKind, 'direct')
  const candidates = bindings.filter((binding) => {
    if (normalizeBindingToken(binding.channel, 'external') !== eventChannel) {
      return false
    }
    if (eventTarget && binding.targetAgentId.trim() !== eventTarget) {
      return false
    }
    return true
  })
  if (candidates.length === 0) {
    return null
  }
  const sorted = [...candidates].sort((left, right) => {
    const leftAccount = normalizeBindingToken(left.accountId, 'default')
    const rightAccount = normalizeBindingToken(right.accountId, 'default')
    const leftPeerKind = normalizeBindingToken(left.peerKind, 'direct')
    const rightPeerKind = normalizeBindingToken(right.peerKind, 'direct')
    const leftScore = Number(leftAccount === eventAccount) * 2 + Number(leftPeerKind === eventPeerKind)
    const rightScore = Number(rightAccount === eventAccount) * 2 + Number(rightPeerKind === eventPeerKind)
    return rightScore - leftScore
  })
  return sorted[0] ?? null
}

function resolveConversationDisplayLabel(
  locale: Locale,
  event: ExternalChannelEventItem,
  bindings: ChannelRouteBinding[],
  agentNameMap: Record<string, string>,
): string {
  const channel = event.channel ?? 'external'
  const channelLabel = externalChannelLabel(locale, channel)
  const matchedBinding = resolveConversationBinding(event, bindings)
  const botName = matchedBinding?.botName?.trim() || `${channelLabel} Bot`
  const botLabel = botName.toLowerCase().includes(channelLabel.toLowerCase())
    ? botName
    : `${channelLabel} ${botName}`
  const targetAgentId = event.targetAgentId?.trim() || matchedBinding?.targetAgentId?.trim() || null
  const agentName = targetAgentId
    ? agentNameMap[targetAgentId]?.trim() || t(locale, '未命名 Agent', 'Unlabeled Agent')
    : t(locale, '待路由 Agent', 'Pending Agent')
  return `${botLabel} - ${agentName}`
}

function CommunicationChannelsPaneView({
  locale,
  agentNameMap,
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

  const feedScrollRef = useRef<HTMLDivElement | null>(null)
  const hasInitialAutoScrollRef = useRef(false)
  const [activeConversationKey, setActiveConversationKey] = useState<string | null>(null)
  const orderedEvents = useMemo(
    () => [...externalEvents].sort((left, right) => left.tsMs - right.tsMs),
    [externalEvents],
  )
  const conversationGroups = useMemo<ConversationGroup[]>(() => {
    const grouped = new Map<string, ConversationGroup>()
    orderedEvents.forEach((event) => {
      const key = resolveConversationKey(event)
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          key,
          label: resolveConversationDisplayLabel(
            locale,
            event,
            externalStatus.bindings ?? [],
            agentNameMap,
          ),
          events: [event],
          latestTsMs: event.tsMs,
        })
        return
      }
      existing.events.push(event)
      existing.latestTsMs = Math.max(existing.latestTsMs, event.tsMs)
      if (event.targetAgentId?.trim()) {
        existing.label = resolveConversationDisplayLabel(
          locale,
          event,
          externalStatus.bindings ?? [],
          agentNameMap,
        )
      }
    })
    return [...grouped.values()].sort((left, right) => right.latestTsMs - left.latestTsMs)
  }, [agentNameMap, externalStatus.bindings, locale, orderedEvents])
  const activeConversation = useMemo(() => {
    if (conversationGroups.length === 0) {
      return null
    }
    if (activeConversationKey) {
      const matched = conversationGroups.find((group) => group.key === activeConversationKey)
      if (matched) {
        return matched
      }
    }
    return conversationGroups[0]
  }, [activeConversationKey, conversationGroups])
  const activeEvents = activeConversation?.events ?? []
  const latestEvent = activeEvents.length ? activeEvents[activeEvents.length - 1] : null

  useEffect(() => {
    if (conversationGroups.length === 0) {
      setActiveConversationKey(null)
      return
    }
    setActiveConversationKey((current) => {
      if (current && conversationGroups.some((group) => group.key === current)) {
        return current
      }
      return conversationGroups[0]?.key ?? null
    })
  }, [conversationGroups])

  useEffect(() => {
    hasInitialAutoScrollRef.current = false
  }, [activeConversation?.key])

  useEffect(() => {
    const host = feedScrollRef.current
    if (!host) {
      return
    }
    if (!latestEvent) {
      hasInitialAutoScrollRef.current = false
      return
    }

    if (!hasInitialAutoScrollRef.current) {
      host.scrollTop = host.scrollHeight
      hasInitialAutoScrollRef.current = true
      return
    }

    const distanceFromBottom = host.scrollHeight - host.scrollTop - host.clientHeight
    if (distanceFromBottom <= 96) {
      host.scrollTop = host.scrollHeight
    }
  }, [latestEvent?.id, latestEvent?.tsMs])

  return (
    <aside className="panel communication-channels-pane">
      <header className="communication-channels-header">
        <h2>{t(locale, 'pane.channels.title')}</h2>
      </header>

      <section className="communication-channels-surface">
        <div className="communication-channels-feed">
          {conversationGroups.length > 0 ? (
            <div className="communication-channels-tabs" role="tablist" aria-label={t(locale, '双端会话', 'Conversations')}>
              {conversationGroups.map((group) => {
                const isActive = group.key === activeConversation?.key
                return (
                  <button
                    key={group.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`communication-channels-tab ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      setActiveConversationKey(group.key)
                    }}
                    title={group.label}
                  >
                    <span className="communication-channels-tab-title">{group.label}</span>
                    <span className="communication-channels-tab-count">{group.events.length}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
          <div className="communication-channels-feed-scroll" ref={feedScrollRef}>
            {activeEvents.length === 0 ? (
              <div className="communication-channels-empty" role="status">
                <AppIcon name="channels" aria-hidden="true" />
                <p>{t(locale, 'taskCenter.external.events.empty')}</p>
              </div>
            ) : (
              <ol className="communication-channels-message-list">
                {activeEvents.map((event) => {
                  const content = resolveEventContent(event)
                  const statusClass = eventStatusClass(event)
                  const direction = resolveEventDirection(event)

                  return (
                    <li key={event.id} className={`communication-channels-message-row is-${direction}`}>
                      <article
                        className={`communication-channels-bubble ${statusClass === 'failed' ? 'is-failed' : ''}`}
                        title={content}
                      >
                        <p className="communication-channels-message-content">{content}</p>
                        {shouldShowFailureDetail(event) ? (
                          <p className="communication-channels-message-detail" title={event.detail}>
                            {event.detail}
                          </p>
                        ) : null}
                      </article>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>
      </section>
    </aside>
  )
}

export const CommunicationChannelsPane = memo(CommunicationChannelsPaneView)
