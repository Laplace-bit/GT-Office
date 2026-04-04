import type { BridgeClient } from './bridge_client.js'

export function createDirectoryBackend(bridge: BridgeClient) {
  return {
    snapshot<T>(params: { workspaceId: string }) {
      return bridge.request<T>('directory.get', { workspaceId: params.workspaceId })
    },
  }
}
