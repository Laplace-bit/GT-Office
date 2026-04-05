interface TaskDispatchResponseShape {
  batchId?: string
  results?: Array<{
    targetAgentId?: string
    taskId?: string
    status?: string
    detail?: string | null
  }>
}

interface ChannelPublishResponseShape {
  acceptedTargets?: string[]
  failedTargets?: Array<{
    agentId?: string
    reason?: string | null
  }>
}

export interface TaskBackend {
  dispatchBatch<T>(params: {
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
  }): Promise<T>
  publish<T>(params: {
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
  }): Promise<T>
  listThreads<T>(params: { workspaceId: string; agentId?: string | null; limit?: number }): Promise<T>
  getThread<T>(params: { workspaceId: string; taskId: string }): Promise<T>
}

function buildSender(agentId?: string | null) {
  if (agentId && agentId.trim()) {
    return {
      type: 'agent' as const,
      agentId: agentId.trim(),
    }
  }

  return {
    type: 'human' as const,
    agentId: null,
  }
}

function directChannelId(targetAgentIds: string[]) {
  return targetAgentIds[0] ?? 'direct'
}

function readPrimaryTaskId(response: TaskDispatchResponseShape) {
  return response.results?.[0]?.taskId ?? null
}

function ensurePublishAccepted(response: ChannelPublishResponseShape) {
  const failed = response.failedTargets?.find((item) => typeof item?.reason === 'string' && item.reason.trim())
  if (failed?.reason) {
    const error = new Error(failed.reason.trim()) as Error & { code: string }
    error.code = 'CHANNEL_DELIVERY_FAILED'
    throw error
  }
  if ((response.acceptedTargets?.length ?? 0) < 1) {
    const error = new Error('No target accepted the message') as Error & { code: string }
    error.code = 'CHANNEL_DELIVERY_FAILED'
    throw error
  }
}

export function createTaskCommands(backend: TaskBackend) {
  return {
    async sendTask<T>(params: {
      workspaceId: string
      senderAgentId?: string | null
      targetAgentIds: string[]
      title: string
      markdown: string
    }) {
      const response = await backend.dispatchBatch<TaskDispatchResponseShape>({
        workspaceId: params.workspaceId,
        sender: buildSender(params.senderAgentId),
        targets: params.targetAgentIds,
        title: params.title,
        markdown: params.markdown,
        attachments: [],
        submitSequences: {},
      })

      return {
        ...response,
        taskId: readPrimaryTaskId(response),
        targetAgentIds: params.targetAgentIds,
        title: params.title,
      } as T
    },

    async replyStatus<T>(params: {
      workspaceId: string
      senderAgentId?: string | null
      targetAgentIds: string[]
      taskId: string
      detail: string
    }) {
      const response = await backend.publish<T & ChannelPublishResponseShape>({
        workspaceId: params.workspaceId,
        channel: {
          kind: 'direct',
          id: directChannelId(params.targetAgentIds),
        },
        senderAgentId: params.senderAgentId ?? null,
        targetAgentIds: params.targetAgentIds,
        type: 'status',
        payload: {
          taskId: params.taskId,
          detail: params.detail,
        },
        idempotencyKey: null,
      })
      ensurePublishAccepted(response)

      return {
        ...(response as Record<string, unknown>),
        taskId: params.taskId,
        targetAgentIds: params.targetAgentIds,
      } as T
    },

    async handover<T>(params: {
      workspaceId: string
      senderAgentId?: string | null
      targetAgentIds: string[]
      taskId: string
      summary: string
      blockers: string[]
      nextSteps: string[]
    }) {
      const response = await backend.publish<T & ChannelPublishResponseShape>({
        workspaceId: params.workspaceId,
        channel: {
          kind: 'direct',
          id: directChannelId(params.targetAgentIds),
        },
        senderAgentId: params.senderAgentId ?? null,
        targetAgentIds: params.targetAgentIds,
        type: 'handover',
        payload: {
          taskId: params.taskId,
          summary: params.summary,
          blockers: params.blockers,
          nextSteps: params.nextSteps,
        },
        idempotencyKey: null,
      })
      ensurePublishAccepted(response)

      return {
        ...(response as Record<string, unknown>),
        taskId: params.taskId,
        targetAgentIds: params.targetAgentIds,
      } as T
    },

    inbox<T>(params: { workspaceId: string; agentId?: string | null; limit?: number }) {
      return backend.listThreads<T>(params)
    },

    taskThread<T>(params: { workspaceId: string; taskId: string }) {
      return backend.getThread<T>(params)
    },
  }
}
