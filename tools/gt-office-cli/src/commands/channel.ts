import { parseJsonOption } from '../core/errors.js'

export interface ChannelBackend {
  publish<T>(params: {
    workspaceId: string
    channel: { kind: string; id: string }
    senderAgentId?: string | null
    targetAgentIds?: string[]
    type: string
    payload: Record<string, unknown>
    idempotencyKey?: string | null
  }): Promise<T>
  listMessages<T>(params: {
    workspaceId: string
    targetAgentId?: string
    senderAgentId?: string
    taskId?: string
    limit?: number
  }): Promise<T>
}

function normalizePayload(payload: unknown) {
  if (typeof payload === 'string') {
    return parseJsonOption(payload)
  }

  return payload
}

export function createChannelCommands(backend: ChannelBackend) {
  return {
    send<T>(params: {
      workspaceId: string
      channelKind: string
      channelId: string
      senderAgentId?: string
      targetAgentIds?: string[]
      messageType: string
      payload: unknown
      idempotencyKey?: string
    }) {
      return backend.publish<T>({
        workspaceId: params.workspaceId,
        channel: {
          kind: params.channelKind,
          id: params.channelId,
        },
        senderAgentId: params.senderAgentId ?? null,
        targetAgentIds: params.targetAgentIds ?? [],
        type: params.messageType,
        payload: normalizePayload(params.payload) as Record<string, unknown>,
        idempotencyKey: params.idempotencyKey ?? null,
      })
    },
    listMessages<T>(params: {
      workspaceId: string
      targetAgentId?: string
      senderAgentId?: string
      taskId?: string
      limit?: number
    }) {
      return backend.listMessages<T>(params)
    },
  }
}
