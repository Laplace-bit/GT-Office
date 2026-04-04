import type { BridgeClient } from './bridge_client.js'

interface ChannelPublishParams {
  workspaceId: string
  channel: {
    kind: string
    id: string
  }
  senderAgentId?: string | null
  targetAgentIds?: string[]
  type: string
  payload: Record<string, unknown>
  idempotencyKey?: string | null
}

interface ChannelListMessagesParams {
  workspaceId: string
  targetAgentId?: string
  senderAgentId?: string
  taskId?: string
  limit?: number
}

export function createChannelBackend(bridge: BridgeClient) {
  return {
    publish<T>(params: ChannelPublishParams) {
      return bridge.request<T>('channel.publish', params)
    },
    listMessages<T>(params: ChannelListMessagesParams) {
      return bridge.request<T>('channel.list_messages', params)
    },
  }
}
