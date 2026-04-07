import type { BridgeClient } from './bridge_client.js'

interface DispatchBatchParams {
  workspaceId: string
  sender: {
    type: 'human' | 'agent'
    agentId?: string | null
  }
  targets: string[]
  title: string
  markdown: string
  attachments: Array<{ path: string; name: string; category: string }>
  submitSequences?: Record<string, string>
}

interface ChannelPublishParams {
  workspaceId: string
  channel: {
    kind: 'direct' | 'group' | 'broadcast'
    id: string
  }
  senderAgentId?: string | null
  targetAgentIds?: string[]
  type: 'task_instruction' | 'status' | 'handover'
  payload: Record<string, unknown>
  idempotencyKey?: string | null
}

interface TaskListThreadsParams {
  workspaceId: string
  agentId?: string | null
  limit?: number
}

interface TaskGetThreadParams {
  workspaceId: string
  taskId: string
}

export function createTaskBackend(bridge: BridgeClient) {
  return {
    dispatchBatch<T>(params: DispatchBatchParams) {
      return bridge.request<T>('task.dispatch_batch', params)
    },
    publish<T>(params: ChannelPublishParams) {
      return bridge.request<T>('channel.publish', params)
    },
    listThreads<T>(params: TaskListThreadsParams) {
      return bridge.request<T>('task.list_threads', params)
    },
    getThread<T>(params: TaskGetThreadParams) {
      return bridge.request<T>('task.get_thread', params)
    },
  }
}
