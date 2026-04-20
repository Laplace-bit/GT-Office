import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  type ChannelMessagePayload,
  type ExternalChannelDispatchProgressPayload,
  type ExternalChannelInboundPayload,
  type ExternalChannelOutboundResultPayload,
  type ExternalChannelRoutedPayload,
  type ChannelRouteBinding,
  desktopApi,
} from '../integration/desktop-api'
import { buildStationChannelBotBindingMap, resolveConnectorAccounts } from '@features/tool-adapter'
import type { AgentStation } from '@features/workspace-hub'
import type { StationTaskSignal } from '@features/task-center'
import {
  buildExternalConversationKey,
  buildExternalEndpointKey,
  describeError,
  EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT,
  EXTERNAL_CHANNEL_STATUS_POLL_MS,
  normalizeExternalChannel,
  readNumber,
  readRecord,
  readString,
  STATION_TASK_SIGNAL_VISIBLE_MS,
  summarizeExternalChannelText,
  TELEGRAM_DEBUG_TOAST_VISIBLE_MS,
  type ExternalChannelEventItem,
  type ExternalTraceContext,
  type TelegramInboundDebugToast,
} from './ShellRoot.shared'
import type { NavItemId } from './navigation-model'

export interface ExternalChannelStatusState {
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

interface UseShellExternalChannelControllerInput {
  activeWorkspaceId: string | null
  tauriRuntime: boolean
  stationsRef: MutableRefObject<AgentStation[]>
  activeNavId: NavItemId
  isChannelStudioOpen: boolean
}

export interface ShellExternalChannelController {
  externalChannelStatus: ExternalChannelStatusState
  externalChannelEvents: ExternalChannelEventItem[]
  telegramDebugToast: TelegramInboundDebugToast | null
  stationTaskSignals: Record<string, StationTaskSignal>
  refreshExternalChannelStatus: () => Promise<void>
  bindExternalTraceTarget: (traceId: string, targetAgentId: string) => void
  dismissTelegramDebugToast: () => void
  handleRefreshExternalChannelStatus: () => void
  resetExternalChannelState: () => void
  clearStationTaskSignals: () => void
  removeStationTaskSignal: (stationId: string) => void
  pruneStationTaskSignals: (validStationIds: Set<string>) => void
  channelBotBindingsByStationId: (stations: Array<{ id: string; role: string }>) => ReturnType<typeof buildStationChannelBotBindingMap>
}

const INITIAL_EXTERNAL_CHANNEL_STATUS: ExternalChannelStatusState = {
  loading: false,
  running: false,
  doctorOk: null,
  runtimeBaseUrl: null,
  feishuWebhook: null,
  telegramWebhook: null,
  summary: null,
  lastSyncAtMs: null,
  error: null,
  bindings: [],
}

export function useShellExternalChannelController({
  activeWorkspaceId,
  tauriRuntime,
  stationsRef,
  activeNavId,
  isChannelStudioOpen,
}: UseShellExternalChannelControllerInput): ShellExternalChannelController {
  const [externalChannelStatus, setExternalChannelStatus] = useState<ExternalChannelStatusState>(
    INITIAL_EXTERNAL_CHANNEL_STATUS,
  )
  const [externalChannelEvents, setExternalChannelEvents] = useState<ExternalChannelEventItem[]>([])
  const [telegramDebugToast, setTelegramDebugToast] = useState<TelegramInboundDebugToast | null>(null)
  const [stationTaskSignals, setStationTaskSignals] = useState<Record<string, StationTaskSignal>>({})

  const stationTaskSignalTimerRef = useRef<Record<string, number | null>>({})
  const stationTaskSignalNonceRef = useRef<Record<string, number>>({})
  const externalChannelEventSeqRef = useRef(0)
  const externalTraceContextRef = useRef<Record<string, ExternalTraceContext>>({})
  const telegramDebugToastTimerRef = useRef<number | null>(null)

  const clearStationTaskSignalTimer = useCallback((stationId: string) => {
    const timerId = stationTaskSignalTimerRef.current[stationId]
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId)
    }
    stationTaskSignalTimerRef.current[stationId] = null
  }, [])

  const scheduleStationTaskSignalDismiss = useCallback(
    (stationId: string, nonce: number) => {
      clearStationTaskSignalTimer(stationId)
      stationTaskSignalTimerRef.current[stationId] = window.setTimeout(() => {
        stationTaskSignalTimerRef.current[stationId] = null
        if ((stationTaskSignalNonceRef.current[stationId] ?? 0) !== nonce) {
          return
        }
        setStationTaskSignals((prev) => {
          const current = prev[stationId]
          if (!current || current.nonce !== nonce) {
            return prev
          }
          const next = { ...prev }
          delete next[stationId]
          return next
        })
      }, STATION_TASK_SIGNAL_VISIBLE_MS)
    },
    [clearStationTaskSignalTimer],
  )

  const emitStationTaskSignal = useCallback(
    (input: { stationId: string; taskId: string; title: string; receivedAtMs: number }) => {
      const nextNonce = (stationTaskSignalNonceRef.current[input.stationId] ?? 0) + 1
      stationTaskSignalNonceRef.current[input.stationId] = nextNonce
      setStationTaskSignals((prev) => ({
        ...prev,
        [input.stationId]: {
          nonce: nextNonce,
          taskId: input.taskId,
          title: input.title,
          receivedAtMs: input.receivedAtMs,
        },
      }))
      scheduleStationTaskSignalDismiss(input.stationId, nextNonce)
    },
    [scheduleStationTaskSignalDismiss],
  )

  const bindExternalTraceTarget = useCallback((traceId: string, targetAgentId: string) => {
    const normalizedTraceId = traceId.trim()
    const normalizedTargetAgentId = targetAgentId.trim()
    if (!normalizedTraceId || !normalizedTargetAgentId) {
      return
    }
    const context = externalTraceContextRef.current[normalizedTraceId]
    if (context) {
      context.targetAgentId = normalizedTargetAgentId
    }
    setExternalChannelEvents((prev) =>
      prev.map((event) => {
        if (event.traceId !== normalizedTraceId) {
          return event
        }
        const endpointKey =
          event.endpointKey ??
          context?.endpointKey ??
          buildExternalEndpointKey({
            channel: event.channel,
            accountId: event.accountId,
            peerKind: event.peerKind,
            peerId: event.peerId,
          })
        return {
          ...event,
          targetAgentId: normalizedTargetAgentId,
          conversationKey: buildExternalConversationKey(endpointKey, normalizedTargetAgentId),
        }
      }),
    )
  }, [])

  const appendExternalChannelEvent = useCallback(
    (input: Omit<ExternalChannelEventItem, 'id' | 'tsMs'> & { tsMs?: number }) => {
      externalChannelEventSeqRef.current += 1
      const nextEvent: ExternalChannelEventItem = {
        id: `ext_evt_${Date.now().toString(16)}_${externalChannelEventSeqRef.current.toString(16)}`,
        tsMs: input.tsMs ?? Date.now(),
        kind: input.kind,
        primary: input.primary,
        channel: input.channel,
        status: input.status,
        secondary: input.secondary,
        detail: input.detail,
        mergeKey: input.mergeKey,
        traceId: input.traceId,
        accountId: input.accountId,
        peerKind: input.peerKind,
        peerId: input.peerId,
        senderId: input.senderId,
        targetAgentId: input.targetAgentId,
        endpointKey: input.endpointKey,
        conversationKey: input.conversationKey,
      }
      setExternalChannelEvents((prev) => {
        if (!nextEvent.mergeKey) {
          return [nextEvent, ...prev].slice(0, EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT)
        }
        const existingIndex = prev.findIndex(
          (event) => event.mergeKey === nextEvent.mergeKey && event.kind === nextEvent.kind,
        )
        if (existingIndex === -1) {
          return [nextEvent, ...prev].slice(0, EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT)
        }
        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex],
          tsMs: nextEvent.tsMs,
          primary: nextEvent.primary,
          channel: nextEvent.channel,
          status: nextEvent.status,
          secondary: nextEvent.secondary,
          detail: nextEvent.detail,
          traceId: nextEvent.traceId,
          accountId: nextEvent.accountId,
          peerKind: nextEvent.peerKind,
          peerId: nextEvent.peerId,
          senderId: nextEvent.senderId,
          targetAgentId: nextEvent.targetAgentId,
          endpointKey: nextEvent.endpointKey,
          conversationKey: nextEvent.conversationKey,
        }
        return updated
      })
    },
    [],
  )

  const emitTelegramInboundDebugToast = useCallback((payload: ExternalChannelInboundPayload) => {
    if (payload.channel.trim().toLowerCase() !== 'telegram') {
      return
    }
    const normalizedText = (payload.text ?? '').trim()
    const textPreview =
      normalizedText.length > 280 ? `${normalizedText.slice(0, 280)}...` : normalizedText
    const nonce = Date.now()
    const nextToast: TelegramInboundDebugToast = {
      nonce,
      receivedAtMs: nonce,
      accountId: payload.accountId || 'default',
      senderId: payload.senderId || 'unknown',
      senderName: payload.senderName ?? null,
      peerId: payload.peerId || 'unknown',
      messageId: payload.messageId || 'unknown',
      text: textPreview,
    }
    setTelegramDebugToast(nextToast)

    const previousTimer = telegramDebugToastTimerRef.current
    if (typeof previousTimer === 'number') {
      window.clearTimeout(previousTimer)
    }
    telegramDebugToastTimerRef.current = window.setTimeout(() => {
      telegramDebugToastTimerRef.current = null
      setTelegramDebugToast((current) => {
        if (!current || current.nonce !== nonce) {
          return current
        }
        return null
      })
    }, TELEGRAM_DEBUG_TOAST_VISIBLE_MS)
  }, [])

  const refreshExternalChannelStatus = useCallback(async () => {
    if (!tauriRuntime) {
      return
    }
    setExternalChannelStatus((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }))
    try {
      const [adapterStatus, doctorStatus, bindingsResponse] = await Promise.all([
        desktopApi.channelAdapterStatus(),
        desktopApi.systemGtoDoctor(),
        activeWorkspaceId ? desktopApi.channelBindingList(activeWorkspaceId) : Promise.resolve({ bindings: [] }),
      ])
      const connectorAccounts = await resolveConnectorAccounts(adapterStatus, (channel) =>
        desktopApi.channelConnectorAccountList(channel),
      )

      const runtimeRecord = readRecord(adapterStatus.runtime)
      const snapshotRecord = readRecord(adapterStatus.snapshot)
      const doctorRecord = readRecord(doctorStatus)
      const summaryRecord = readRecord(snapshotRecord)
      const doctorOk = typeof doctorRecord?.ok === 'boolean' ? doctorRecord.ok : null

      const feishuWebHit = readString(runtimeRecord?.feishuWebhook)
      const telegramWebHit = readString(runtimeRecord?.telegramWebhook)

      const activeSet = new Set<string>()
      bindingsResponse.bindings.forEach((binding) => activeSet.add(binding.channel))
      connectorAccounts.forEach((account) => {
        if (account.enabled || account.hasBotToken || account.hasWebhookSecret) {
          activeSet.add(account.channel)
        }
      })
      if (feishuWebHit) activeSet.add('feishu')
      if (telegramWebHit) {
        activeSet.add('telegram')
      }

      setExternalChannelStatus({
        loading: false,
        running: Boolean(adapterStatus.running),
        doctorOk,
        runtimeBaseUrl: readString(runtimeRecord?.baseUrl),
        feishuWebhook: feishuWebHit,
        telegramWebhook: telegramWebHit,
        summary: summaryRecord
          ? {
              routeBindings: Math.max(0, readNumber(summaryRecord.routeBindings) ?? 0),
              allowlistEntries: Math.max(0, readNumber(summaryRecord.allowlistEntries) ?? 0),
              pairingPending: Math.max(0, readNumber(summaryRecord.pairingPending) ?? 0),
              idempotencyEntries: Math.max(0, readNumber(summaryRecord.idempotencyEntries) ?? 0),
            }
          : null,
        lastSyncAtMs: Date.now(),
        error: null,
        bindings: bindingsResponse.bindings,
        configuredChannels: Array.from(activeSet),
      })
    } catch (error) {
      setExternalChannelStatus((prev) => ({
        ...prev,
        loading: false,
        error: describeError(error),
        lastSyncAtMs: Date.now(),
      }))
    }
  }, [activeWorkspaceId, tauriRuntime])

  // Channel status polling effect: refresh on mount and when nav/channel-studio changes
  useEffect(() => {
    if (!tauriRuntime) {
      return
    }
    if (activeNavId !== 'channels' && !isChannelStudioOpen) {
      return
    }
    void refreshExternalChannelStatus()
  }, [activeNavId, isChannelStudioOpen, refreshExternalChannelStatus, tauriRuntime])

  // Task signal dismiss timer cleanup effect
  useEffect(() => {
    return () => {
      Object.entries(stationTaskSignalTimerRef.current).forEach(([stationId]) => {
        clearStationTaskSignalTimer(stationId)
      })
      stationTaskSignalTimerRef.current = {}
      stationTaskSignalNonceRef.current = {}
    }
  }, [clearStationTaskSignalTimer])

  // Telegram debug toast timer cleanup effect
  useEffect(() => {
    return () => {
      const timerId = telegramDebugToastTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      telegramDebugToastTimerRef.current = null
    }
  }, [])

  // Channel status polling effect: poll when on tasks nav
  useEffect(() => {
    if (!tauriRuntime) {
      return
    }
    let disposed = false
    let timerId: number | null = null

    const poll = async () => {
      if (disposed) {
        return
      }
      await refreshExternalChannelStatus()
      if (disposed || activeNavId !== 'tasks') {
        return
      }
      timerId = window.setTimeout(() => {
        void poll()
      }, EXTERNAL_CHANNEL_STATUS_POLL_MS)
    }

    if (activeNavId === 'tasks') {
      void poll()
    }

    return () => {
      disposed = true
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
    }
  }, [activeNavId, refreshExternalChannelStatus, tauriRuntime])

  // Channel events subscription effect
  useEffect(() => {
    if (!tauriRuntime) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null

    void desktopApi
      .subscribeChannelEvents({
        onMessage: (payload: ChannelMessagePayload) => {
          if (disposed) {
            return
          }
          const station = stationsRef.current.find(
            (item) => item.id === payload.targetAgentId,
          )
          if (!station) {
            return
          }
          const rawPayload = payload.payload
          const taskId =
            typeof rawPayload.taskId === 'string' ? rawPayload.taskId : payload.messageId
          const title =
            typeof rawPayload.title === 'string' ? rawPayload.title : payload.type

          emitStationTaskSignal({
            stationId: station.id,
            taskId,
            title,
            receivedAtMs: payload.tsMs,
          })
        },
        onAck: () => {
          // Ack events are tracked in task center history records.
        },
        onDispatchProgress: () => {
          // Progress events are consumed by the dispatch command response in current UI.
        },
        onExternalInbound: (payload: ExternalChannelInboundPayload) => {
          const channel = normalizeExternalChannel(payload.channel)
          const accountId = payload.accountId?.trim() || 'default'
          const peerKind = payload.peerKind
          const peerId = payload.peerId?.trim() || 'unknown-peer'
          const senderId = payload.senderId?.trim() || 'unknown-sender'
          const endpointKey = buildExternalEndpointKey({
            channel,
            accountId,
            peerKind,
            peerId,
          })
          const previousTraceContext = externalTraceContextRef.current[payload.traceId]
          const traceContext: ExternalTraceContext = {
            channel,
            accountId,
            peerKind,
            peerId,
            senderId,
            endpointKey,
            targetAgentId: previousTraceContext?.targetAgentId,
          }
          externalTraceContextRef.current[payload.traceId] = traceContext
          const textPreview = summarizeExternalChannelText(payload.text)
          appendExternalChannelEvent({
            kind: 'inbound',
            primary: textPreview ?? `${channel} · ${senderId}`,
            channel,
            status: 'received',
            secondary: `${channel} · ${senderId}`,
            detail: `peer=${payload.peerId} · msg=${payload.messageId}`,
            traceId: payload.traceId,
            accountId,
            peerKind,
            peerId,
            senderId,
            targetAgentId: traceContext.targetAgentId,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, traceContext.targetAgentId),
          })
          emitTelegramInboundDebugToast(payload)
        },
        onExternalRouted: (payload: ExternalChannelRoutedPayload) => {
          const resolvedTarget =
            payload.resolvedTargets?.find((value) => typeof value === 'string' && value.trim().length > 0) ??
            payload.targetAgentId
          bindExternalTraceTarget(payload.traceId, resolvedTarget)
        },
        onExternalDispatchProgress: (payload: ExternalChannelDispatchProgressPayload) => {
          bindExternalTraceTarget(payload.traceId, payload.targetAgentId)
          if (payload.status !== 'failed') {
            return
          }
          const traceContext = externalTraceContextRef.current[payload.traceId]
          const endpointKey =
            traceContext?.endpointKey ??
            buildExternalEndpointKey({
              channel: traceContext?.channel,
              accountId: traceContext?.accountId,
              peerKind: traceContext?.peerKind,
              peerId: traceContext?.peerId,
            })
          appendExternalChannelEvent({
            kind: 'error',
            primary: payload.detail?.trim() || 'Dispatch failed',
            channel: traceContext?.channel,
            status: 'failed',
            detail: payload.detail ?? 'Dispatch failed',
            mergeKey: `dispatch-failed:${payload.traceId}:${payload.targetAgentId}`,
            traceId: payload.traceId,
            accountId: traceContext?.accountId,
            peerKind: traceContext?.peerKind,
            peerId: traceContext?.peerId,
            senderId: traceContext?.senderId,
            targetAgentId: payload.targetAgentId,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, payload.targetAgentId),
          })
        },
        onExternalReply: () => {
          // `external/channel_reply` is an internal channel ack mirrored from task dispatch,
          // not a real external provider send result. Do not show it in recent external events.
        },
        onExternalOutboundResult: (payload: ExternalChannelOutboundResultPayload) => {
          if (payload.relayMode === 'dispatch-ack') {
            return
          }
          const textPreview = summarizeExternalChannelText(payload.textPreview)
          const traceContext =
            payload.traceId && payload.traceId.trim()
              ? externalTraceContextRef.current[payload.traceId]
              : undefined
          if (payload.traceId && traceContext) {
            traceContext.targetAgentId = payload.targetAgentId
          }
          const endpointKey =
            traceContext?.endpointKey ??
            buildExternalEndpointKey({
              channel: payload.channel ?? traceContext?.channel,
              accountId: traceContext?.accountId,
              peerKind: traceContext?.peerKind,
              peerId: traceContext?.peerId,
            })
          const targetAgentId = payload.targetAgentId || traceContext?.targetAgentId
          const failureMergeKey =
            payload.status === 'failed'
              ? `outbound-failed:${payload.traceId ?? payload.messageId}:${payload.targetAgentId}:${payload.textPreview ?? ''}`
              : undefined
          appendExternalChannelEvent({
            kind: 'outbound',
            primary: textPreview ?? `${payload.targetAgentId} · ${payload.status}`,
            channel: payload.channel ?? traceContext?.channel ?? undefined,
            status: payload.status === 'failed' ? 'failed' : 'sent',
            secondary: `${payload.targetAgentId} · ${payload.status}`,
            detail: payload.status === 'failed' ? payload.detail ?? undefined : undefined,
            mergeKey: failureMergeKey,
            tsMs: payload.tsMs,
            traceId: payload.traceId ?? undefined,
            accountId: traceContext?.accountId,
            peerKind: traceContext?.peerKind,
            peerId: traceContext?.peerId,
            senderId: traceContext?.senderId,
            targetAgentId: targetAgentId ?? undefined,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, targetAgentId),
          })
        },
        onExternalError: () => {},
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanup = unlisten
      })

    return () => {
      disposed = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [
    appendExternalChannelEvent,
    bindExternalTraceTarget,
    emitStationTaskSignal,
    emitTelegramInboundDebugToast,
  ])

  const dismissTelegramDebugToast = useCallback(() => {
    const timerId = telegramDebugToastTimerRef.current
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId)
    }
    telegramDebugToastTimerRef.current = null
    setTelegramDebugToast(null)
  }, [])

  const handleRefreshExternalChannelStatus = useCallback(() => {
    void refreshExternalChannelStatus()
  }, [refreshExternalChannelStatus])

  const resetExternalChannelState = useCallback(() => {
    setExternalChannelEvents([])
    externalChannelEventSeqRef.current = 0
    externalTraceContextRef.current = {}
    Object.entries(stationTaskSignalTimerRef.current).forEach(([stationId]) => {
      clearStationTaskSignalTimer(stationId)
    })
    stationTaskSignalTimerRef.current = {}
    stationTaskSignalNonceRef.current = {}
  }, [clearStationTaskSignalTimer])

  const removeStationTaskSignal = useCallback((stationId: string) => {
    clearStationTaskSignalTimer(stationId)
    delete stationTaskSignalNonceRef.current[stationId]
    setStationTaskSignals((prev) => {
      if (!prev[stationId]) {
        return prev
      }
      const next = { ...prev }
      delete next[stationId]
      return next
    })
  }, [clearStationTaskSignalTimer])

  const clearStationTaskSignals = useCallback(() => {
    setStationTaskSignals({})
  }, [])

  const pruneStationTaskSignals = useCallback((validStationIds: Set<string>) => {
    Object.keys(stationTaskSignalTimerRef.current).forEach((stationId) => {
      if (!validStationIds.has(stationId)) {
        clearStationTaskSignalTimer(stationId)
        delete stationTaskSignalTimerRef.current[stationId]
        delete stationTaskSignalNonceRef.current[stationId]
      }
    })
  }, [clearStationTaskSignalTimer])

  const channelBotBindingsByStationId = useCallback(
    (stations: Array<{ id: string; role: string }>) =>
      buildStationChannelBotBindingMap(
        stations,
        externalChannelStatus.bindings ?? [],
      ),
    [externalChannelStatus.bindings],
  )

  return {
    externalChannelStatus,
    externalChannelEvents,
    telegramDebugToast,
    stationTaskSignals,
    refreshExternalChannelStatus,
    bindExternalTraceTarget,
    dismissTelegramDebugToast,
    handleRefreshExternalChannelStatus,
    resetExternalChannelState,
    clearStationTaskSignals,
    removeStationTaskSignal,
    pruneStationTaskSignals,
    channelBotBindingsByStationId,
  }
}