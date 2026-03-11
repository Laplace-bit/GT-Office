import fs from 'node:fs/promises'
import fsSync from 'node:fs'
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
  return (
    resolveStateCandidates()
      .sort(compareStateCandidates)
      .map((candidate) => candidate.runtimePath)[0] || path.join(os.homedir(), '.gtoffice', 'mcp', 'runtime.json')
  )
}

export function resolveDirectoryFilePath() {
  return (
    resolveStateCandidates()
      .sort(compareStateCandidates)
      .map((candidate) => candidate.directoryPath)[0] || path.join(os.homedir(), '.gtoffice', 'mcp', 'directory.json')
  )
}

export function resolveStateCandidates() {
  const overridePath = process.env.GTO_MCP_DIRECTORY_FILE
  const runtimeOverridePath = process.env.GTO_MCP_RUNTIME_FILE
  if ((overridePath && overridePath.trim()) || (runtimeOverridePath && runtimeOverridePath.trim())) {
    const directoryPath = overridePath?.trim()
      ? path.resolve(overridePath.trim())
      : path.join(path.dirname(path.resolve(runtimeOverridePath.trim())), 'directory.json')
    const runtimePath = runtimeOverridePath?.trim()
      ? path.resolve(runtimeOverridePath.trim())
      : path.join(path.dirname(path.resolve(overridePath.trim())), 'runtime.json')
    return [
      {
        key: `override:${path.dirname(runtimePath)}`,
        runtimePath,
        directoryPath,
      },
    ]
  }

  const candidates = []
  const pushCandidate = (value) => {
    if (!value) {
      return
    }
    const basePath = path.resolve(value)
    if (!candidates.some((candidate) => candidate.key === basePath)) {
      candidates.push({
        key: basePath,
        runtimePath: path.join(basePath, 'runtime.json'),
        directoryPath: path.join(basePath, 'directory.json'),
      })
    }
  }

  pushCandidate(path.join(os.homedir(), '.gtoffice', 'mcp'))

  if (process.env.WSL_DISTRO_NAME) {
    pushCandidate(path.join('/mnt/c/Users', os.userInfo().username, '.gtoffice', 'mcp'))
  }

  if (process.env.USERPROFILE && process.env.USERPROFILE.trim()) {
    pushCandidate(path.join(process.env.USERPROFILE.trim(), '.gtoffice', 'mcp'))
  }

  return candidates
}

export function compareStateCandidates(left, right) {
  return stateCandidateFreshness(right) - stateCandidateFreshness(left)
}

export function stateCandidateFreshness(candidate) {
  return Math.max(safeMtimeMs(candidate.runtimePath), safeMtimeMs(candidate.directoryPath))
}

function safeMtimeMs(filePath) {
  try {
    return fsSync.statSync(filePath).mtimeMs || 0
  } catch {
    return 0
  }
}

async function tryReadDirectoryWorkspaces(directoryPath) {
  try {
    const raw = await fs.readFile(directoryPath, 'utf8')
    const parsed = JSON.parse(raw)
    const workspaces = parsed?.workspaces
    if (!workspaces || typeof workspaces !== 'object') {
      return {}
    }
    return workspaces
  } catch {
    return {}
  }
}

async function resolveRuntimeCandidates(preferredWorkspaceId) {
  const candidates = resolveStateCandidates()
  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      const workspaces = await tryReadDirectoryWorkspaces(candidate.directoryPath)
      const matchesWorkspace = preferredWorkspaceId
        ? Object.prototype.hasOwnProperty.call(workspaces, preferredWorkspaceId)
        : false
      return {
        ...candidate,
        matchesWorkspace,
      }
    }),
  )

  scored.sort((left, right) => {
    if (left.matchesWorkspace !== right.matchesWorkspace) {
      return left.matchesWorkspace ? -1 : 1
    }
    return compareStateCandidates(left, right)
  })
  return scored
}

export async function loadRuntimeConfig(options = {}) {
  const preferredWorkspaceId =
    typeof options.workspaceId === 'string' && options.workspaceId.trim() ? options.workspaceId.trim() : ''
  const candidates = await resolveRuntimeCandidates(preferredWorkspaceId)
  const failures = []

  for (const candidate of candidates) {
    const runtimePath = candidate.runtimePath
    let raw
    try {
      raw = await fs.readFile(runtimePath, 'utf8')
    } catch (error) {
      failures.push({ runtimePath, cause: String(error?.message ?? error) })
      continue
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      failures.push({ runtimePath, cause: String(error?.message ?? error) })
      continue
    }

    const host = typeof parsed.host === 'string' && parsed.host ? parsed.host : '127.0.0.1'
    const port = Number(parsed.port)
    const token = typeof parsed.token === 'string' ? parsed.token : ''
    if (!Number.isInteger(port) || port <= 0 || !token) {
      failures.push({ runtimePath, cause: 'runtime file missing host/port/token' })
      continue
    }

    return {
      host,
      port,
      token,
      runtimePath,
      version: typeof parsed.version === 'string' ? parsed.version : 'unknown',
    }
  }

  const runtimePath = candidates[0]?.runtimePath || path.join(os.homedir(), '.gtoffice', 'mcp', 'runtime.json')
  throw new BridgeClientError(
    'MCP_BRIDGE_UNAVAILABLE',
    `runtime file not found: ${runtimePath}`,
    { runtimePath, candidates: candidates.map((candidate) => candidate.runtimePath), failures, preferredWorkspaceId },
  )
}

export async function callBridge(method, params = {}, options = {}) {
  const config = await loadRuntimeConfig({ workspaceId: options.workspaceId })
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
