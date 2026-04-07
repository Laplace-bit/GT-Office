import { createBridgeClient, type BridgeRequestLike } from '../../src/adapters/bridge_client.js'

export interface BridgeCall {
  method: string
  params: unknown
}

export interface FakeBridgeOptions {
  respond?<T>(method: string, params: unknown): T | Promise<T>
}

export function createFakeBridge(options: FakeBridgeOptions = {}) {
  const calls: BridgeCall[] = []

  const bridgeLike: BridgeRequestLike = {
    async request<T>(method: string, params?: unknown) {
      calls.push({ method, params })

      if (options.respond) {
        return options.respond<T>(method, params)
      }

      return undefined as T
    },
  }

  return {
    bridge: createBridgeClient(bridgeLike),
    calls,
  }
}
