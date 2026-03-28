import type { BridgeClient } from './bridge_client.js'

interface AgentCreateParams {
  workspaceId: string
  agentId?: string
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

interface RoleSaveParams {
  workspaceId: string
  roleId?: string
  roleKey?: string
  roleName: string
  scope?: unknown
  status?: unknown
  charterPath?: unknown
  policyJson?: unknown
}

interface RoleDeleteParams {
  workspaceId: string
  roleId: string
  scope?: string
}

export function createAgentBackend(bridge: BridgeClient) {
  return {
    list<T>(params: { workspaceId: string }) {
      return bridge.request<T>('agent.list', params)
    },
    roleList<T>(params: { workspaceId: string }) {
      return bridge.request<T>('agent.role_list', params)
    },
    create<T>(params: AgentCreateParams) {
      return bridge.request<T>('agent.create', params)
    },
    update<T>(params: AgentUpdateParams) {
      return bridge.request<T>('agent.update', params)
    },
    delete<T>(params: { workspaceId: string; agentId: string }) {
      return bridge.request<T>('agent.delete', params)
    },
    promptRead<T>(params: { workspaceId: string; agentId: string }) {
      return bridge.request<T>('agent.prompt_read', params)
    },
    roleSave<T>(params: RoleSaveParams) {
      return bridge.request<T>('agent.role_save', params)
    },
    roleDelete<T>(params: RoleDeleteParams) {
      return bridge.request<T>('agent.role_delete', params)
    },
  }
}
