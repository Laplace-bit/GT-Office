import { memo, useEffect, useMemo, useState } from 'react'
import type { TaskDispatchRecord } from '@features/task-center'
import type { Locale } from '@shell/i18n/ui-locale'
import type { ChannelRouteBinding } from '@shell/integration/desktop-api'
import type { UiFont } from '@shell/state/ui-preferences'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { ChannelMessageList } from './ChannelMessageList'
import './CommunicationChannelsPane.scss'

export type ExternalChannelEventItem = {
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

type ConversationGroup = {
  key: string
  label: string
  events: ExternalChannelEventItem[]
  latestTsMs: number
}

interface CommunicationChannelsPaneProps {
  appearanceVersion: string
  locale: Locale
  uiFont: UiFont
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
  appearanceVersion,
  locale,
  uiFont,
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

  return (
    <aside className="communication-channels-pane">
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
                >
                  <span className="communication-channels-tab-title">{group.label}</span>
                  <span className="communication-channels-tab-count">{group.events.length}</span>
                </button>
              )
            })}
          </div>
        ) : null}
        {activeEvents.length === 0 ? (
          <div className="communication-channels-feed-scroll">
            <div className="communication-channels-empty" role="status">
              <AppIcon name="channels" aria-hidden="true" />
              <p>{t(locale, 'taskCenter.external.events.empty')}</p>
            </div>
          </div>
        ) : (
          <ChannelMessageList
            appearanceVersion={appearanceVersion}
            conversationKey={activeConversation?.key ?? null}
            events={activeEvents}
            uiFont={uiFont}
          />
        )}
      </div>
    </aside>
  )
}

export const CommunicationChannelsPane = memo(CommunicationChannelsPaneView)
