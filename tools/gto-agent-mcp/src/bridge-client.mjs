import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const DEFAULT_TIMEOUT_MS = 8000

export class BridgeClientError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'BridgeClientError'
    this.code = code
    this.details = details
  }
}

export function resolveRuntimeFilePath() {
  const overridePath = process.env.GTO_MCP_RUNTIME_FILE
  if (overridePath && overridePath.trim()) {
    return path.resolve(overridePath.trim())
  }
  return path.join(os.homedir(), '.gtoffice', 'mcp', 'runtime.json')
}

export async function loadRuntimeConfig() {
  const runtimePath = resolveRuntimeFilePath()
  let raw
  try {
    raw = await fs.readFile(runtimePath, 'utf8')
  } catch (error) {
    throw new BridgeClientError(
      'MCP_BRIDGE_UNAVAILABLE',
      `runtime file not found: ${runtimePath}`,
      { runtimePath, cause: String(error?.message ?? error) },
    )
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new BridgeClientError(
      'MCP_BRIDGE_UNAVAILABLE',
      `runtime file is invalid JSON: ${runtimePath}`,
      { runtimePath, cause: String(error?.message ?? error) },
    )
  }

  const host = typeof parsed.host === 'string' && parsed.host ? parsed.host : '127.0.0.1'
  const port = Number(parsed.port)
  const token = typeof parsed.token === 'string' ? parsed.token : ''
  if (!Number.isInteger(port) || port <= 0 || !token) {
    throw new BridgeClientError('MCP_BRIDGE_UNAVAILABLE', 'runtime file missing host/port/token', {
      runtimePath,
    })
  }

  return {
    host,
    port,
    token,
    runtimePath,
    version: typeof parsed.version === 'string' ? parsed.version : 'unknown',
  }
}

export async function callBridge(method, params = {}, options = {}) {
  const config = await loadRuntimeConfig()
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const requestId = randomUUID()

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port })
    let settled = false
    let responseBuffer = ''

    const fail = (error) => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      reject(error)
    }

    const finish = (value) => {
      if (settled) {
        return
      }
      settled = true
      socket.end()
      resolve(value)
    }

    const timer = setTimeout(() => {
      fail(
        new BridgeClientError('MCP_BRIDGE_TIMEOUT', `bridge request timed out after ${timeoutMs}ms`, {
          method,
          timeoutMs,
        }),
      )
    }, timeoutMs)

    socket.once('connect', () => {
      const payload = JSON.stringify({
        id: requestId,
        token: config.token,
        method,
        params,
      })
      socket.write(`${payload}\n`)
    })

    socket.on('data', (chunk) => {
      responseBuffer += chunk.toString('utf8')
      const newlineIndex = responseBuffer.indexOf('\n')
      if (newlineIndex < 0) {
        return
      }
      const line = responseBuffer.slice(0, newlineIndex).trim()
      responseBuffer = responseBuffer.slice(newlineIndex + 1)

      clearTimeout(timer)

      let envelope
      try {
        envelope = JSON.parse(line)
      } catch (error) {
        fail(
          new BridgeClientError('MCP_BRIDGE_UNAVAILABLE', 'bridge returned invalid JSON line', {
            line,
            cause: String(error?.message ?? error),
          }),
        )
        return
      }

      if (!envelope || envelope.id !== requestId) {
        fail(
          new BridgeClientError('MCP_BRIDGE_UNAVAILABLE', 'bridge response id mismatch', {
            expectedId: requestId,
            actualId: envelope?.id,
          }),
        )
        return
      }

      if (envelope.ok === true) {
        finish(envelope.data ?? {})
        return
      }

      const code = envelope?.error?.code || 'MCP_BRIDGE_UNAVAILABLE'
      const message = envelope?.error?.message || 'bridge request failed'
      fail(new BridgeClientError(code, message, envelope?.error?.details))
    })

    socket.once('error', (error) => {
      clearTimeout(timer)
      fail(
        new BridgeClientError('MCP_BRIDGE_UNAVAILABLE', `bridge connection failed: ${error.message}`, {
          method,
          host: config.host,
          port: config.port,
        }),
      )
    })

    socket.once('close', () => {
      clearTimeout(timer)
      if (!settled) {
        fail(new BridgeClientError('MCP_BRIDGE_UNAVAILABLE', 'bridge closed connection unexpectedly'))
      }
    })
  })
}
