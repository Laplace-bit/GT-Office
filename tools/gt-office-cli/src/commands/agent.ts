import { CliError } from '../core/errors.js'

export interface AgentRecord {
  id: string
  workspaceId?: string
  name?: string
  roleId?: string
  tool?: string | null
  workdir?: string | null
  customWorkdir?: boolean
  employeeNo?: string | null
  state?: string | null
  promptFileName?: string | null
  promptContent?: string | null
  [key: string]: unknown
}

export interface AgentListResponse {
  agents?: AgentRecord[]
  items?: AgentRecord[]
}

interface AgentCreateParams {
  workspaceId: string
  name: string
  roleId: string
  tool?: string | null
  workdir?: string | null
  customWorkdir?: boolean
  employeeNo?: string | null
  state?: string | null
  promptFileName?: string | null
  promptContent?: string | null
}

interface AgentUpdateParams extends AgentCreateParams {
  agentId: string
}

export interface AgentBackend {
  list<T>(params: { workspaceId: string }): Promise<T>
  create<T>(params: AgentCreateParams): Promise<T>
  update<T>(params: AgentUpdateParams): Promise<T>
  delete<T>(params: { workspaceId: string; agentId: string }): Promise<T>
  promptRead<T>(params: { workspaceId: string; agentId: string }): Promise<T>
}

function getAgentItems(result: AgentListResponse) {
  return result.agents ?? result.items ?? []
}

async function getCurrentAgent(backend: AgentBackend, workspaceId: string, agentId: string) {
  const result = await backend.list<AgentListResponse>({ workspaceId })
  const agent = getAgentItems(result).find((item) => item.id === agentId)

  if (!agent) {
    throw new CliError('AGENT_NOT_FOUND', `Agent not found: ${agentId}`)
  }

  return agent
}

function asString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value) {
    throw new CliError('INVALID_ARGUMENT', `Option ${fieldName} is required`)
  }

  return value
}

function toAgentCreateParams(workspaceId: string, payload: Record<string, unknown>): AgentCreateParams {
  return {
    workspaceId,
    name: asString(payload.name, '--name'),
    roleId: asString(payload.roleId, '--role-id'),
    tool: typeof payload.tool === 'string' ? payload.tool : null,
    workdir: typeof payload.workdir === 'string' ? payload.workdir : null,
    customWorkdir: typeof payload.customWorkdir === 'boolean' ? payload.customWorkdir : false,
    employeeNo: typeof payload.employeeNo === 'string' ? payload.employeeNo : null,
    state: typeof payload.state === 'string' ? payload.state : null,
    promptFileName: typeof payload.promptFileName === 'string' ? payload.promptFileName : null,
    promptContent: typeof payload.promptContent === 'string' ? payload.promptContent : null,
  }
}

function toAgentUpdateParams(
  workspaceId: string,
  agentId: string,
  payload: Record<string, unknown>,
  explicitPayload: Record<string, unknown>,
): AgentUpdateParams {
  const params: AgentUpdateParams = {
    agentId,
    workspaceId,
    name: asString(payload.name, '--name'),
    roleId: asString(payload.roleId, '--role-id'),
    tool: typeof payload.tool === 'string' ? payload.tool : null,
    workdir: typeof payload.workdir === 'string' ? payload.workdir : null,
    customWorkdir: typeof payload.customWorkdir === 'boolean' ? payload.customWorkdir : false,
    employeeNo: typeof payload.employeeNo === 'string' ? payload.employeeNo : null,
    state: typeof payload.state === 'string' ? payload.state : null,
  }

  if (Object.prototype.hasOwnProperty.call(explicitPayload, 'promptFileName')) {
    params.promptFileName = typeof payload.promptFileName === 'string' ? payload.promptFileName : null
  }

  if (Object.prototype.hasOwnProperty.call(explicitPayload, 'promptContent')) {
    params.promptContent = typeof payload.promptContent === 'string' ? payload.promptContent : null
  }

  return params
}

export function createAgentCommands(backend: AgentBackend) {
  return {
    list<T>(params: { workspaceId: string }) {
      return backend.list<T>(params)
    },
    async get(params: { workspaceId: string; agentId: string }) {
      return getCurrentAgent(backend, params.workspaceId, params.agentId)
    },
    create<T>(params: { workspaceId: string; payload: unknown }) {
      return backend.create<T>(toAgentCreateParams(params.workspaceId, params.payload as Record<string, unknown>))
    },
    async update<T>(params: { workspaceId: string; agentId: string; payload: Record<string, unknown> }) {
      const current = await getCurrentAgent(backend, params.workspaceId, params.agentId)
      const merged = {
        ...current,
        ...params.payload,
        id: current.id,
        workspaceId: current.workspaceId ?? params.workspaceId,
      }

      return backend.update<T>(toAgentUpdateParams(params.workspaceId, params.agentId, merged, params.payload))
    },
    remove<T>(params: { workspaceId: string; agentId: string }) {
      return backend.delete<T>(params)
    },
    promptRead<T>(params: { workspaceId: string; agentId: string }) {
      return backend.promptRead<T>(params)
    },
  }
}
