import { callBridge } from '../../../gto-agent-mcp/src/bridge-client.mjs'

export interface BridgeClient {
  request<T>(method: string, params?: unknown): Promise<T>
}

export interface BridgeRequestLike {
  request<T>(method: string, params?: unknown): Promise<T>
}

function readWorkspaceId(params?: unknown): string | undefined {
  if (!params || typeof params !== 'object') {
    return undefined
  }

  if ('workspaceId' in params && typeof params.workspaceId === 'string') {
    return params.workspaceId
  }

  if ('workspace_id' in params && typeof params.workspace_id === 'string') {
    return params.workspace_id
  }

  return undefined
}

export function createBridgeClient(bridge: BridgeRequestLike): BridgeClient {
  return {
    request<T>(method: string, params?: unknown) {
      return bridge.request<T>(method, params)
    },
  }
}

export function createDefaultBridgeClient(): BridgeClient {
  return {
    request<T>(method: string, params?: unknown) {
      return callBridge(method, params as Record<string, unknown> | undefined, {
        workspaceId: readWorkspaceId(params),
      }) as Promise<T>
    },
  }
}
