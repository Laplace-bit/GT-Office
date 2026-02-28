#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function detectHostTriple() {
  const platform = process.platform
  const arch = process.arch
  if (platform === 'win32') {
    return arch === 'x64' ? 'x86_64-pc-windows-msvc' : `${arch}-pc-windows-msvc`
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'
  }
  return `${arch}-unknown-${platform}`
}

function defaultServerCommand() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const repoRoot = process.cwd()
  const sidecarCandidate = path.join(
    repoRoot,
    'target',
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    detectHostTriple(),
    'debug',
    `gto-agent-mcp-sidecar${ext}`,
  )
  if (fs.existsSync(sidecarCandidate)) {
    return {
      command: sidecarCandidate,
      args: ['serve'],
    }
  }
  return {
    command: process.execPath,
    args: [path.join(repoRoot, 'tools', 'gto-agent-mcp', 'bin', 'gto-agent-mcp.mjs'), 'serve'],
  }
}

function parseArgs(argv) {
  const options = {
    workspaceId: process.env.GTO_E2E_WORKSPACE_ID || '',
    targets: (process.env.GTO_E2E_TARGETS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    dispatch: false,
    handover: false,
    strict: false,
    timeoutMs: 10000,
    server: defaultServerCommand(),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === '--dispatch') {
      options.dispatch = true
      continue
    }
    if (value === '--handover') {
      options.handover = true
      continue
    }
    if (value === '--strict') {
      options.strict = true
      continue
    }
    if (value === '--workspace-id' && argv[i + 1]) {
      options.workspaceId = argv[++i]
      continue
    }
    if (value === '--targets' && argv[i + 1]) {
      options.targets = argv[++i]
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      continue
    }
    if (value === '--server-cmd' && argv[i + 1]) {
      options.server.command = argv[++i]
      options.server.args = []
      continue
    }
    if (value === '--server-arg' && argv[i + 1]) {
      options.server.args.push(argv[++i])
      continue
    }
    if (value === '--timeout-ms' && argv[i + 1]) {
      options.timeoutMs = Number.parseInt(argv[++i], 10)
      continue
    }
    throw new Error(`unknown option: ${value}`)
  }

  return options
}

class StdioRpcClient {
  constructor(command, args, timeoutMs) {
    this.timeoutMs = timeoutMs
    this.nextId = 1
    this.pending = new Map()
    this.buffer = Buffer.alloc(0)

    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })

    this.child.stderr.on('data', (chunk) => {
      process.stderr.write(`[probe:stderr] ${chunk.toString('utf8')}`)
    })

    this.child.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.consume()
    })

    this.child.on('exit', (code, signal) => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`server exited before response (code=${code}, signal=${signal})`))
      }
      this.pending.clear()
    })
  }

  consume() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) {
        return
      }
      const headersRaw = this.buffer.slice(0, headerEnd).toString('utf8')
      let contentLength = -1
      for (const line of headersRaw.split('\r\n')) {
        const [rawKey, rawValue] = line.split(':')
        if (!rawKey || !rawValue) {
          continue
        }
        if (rawKey.trim().toLowerCase() === 'content-length') {
          contentLength = Number.parseInt(rawValue.trim(), 10)
          break
        }
      }
      if (!Number.isInteger(contentLength) || contentLength < 0) {
        throw new Error(`invalid content-length header: ${headersRaw}`)
      }

      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + contentLength
      if (this.buffer.length < bodyEnd) {
        return
      }

      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8')
      this.buffer = this.buffer.slice(bodyEnd)

      let message
      try {
        message = JSON.parse(body)
      } catch (error) {
        throw new Error(`invalid JSON response: ${error.message}`)
      }

      const id = message?.id
      if (id == null) {
        continue
      }
      const pending = this.pending.get(id)
      if (!pending) {
        continue
      }
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.resolve(message)
    }
  }

  call(method, params = {}) {
    const id = this.nextId++
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    })
    const frame = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request timeout: ${method}`))
      }, this.timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(frame)
    })
  }

  notify(method, params = {}) {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    })
    const frame = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`
    this.child.stdin.write(frame)
  }

  close() {
    this.child.kill('SIGTERM')
  }
}

function parseToolText(result) {
  const text = result?.content?.[0]?.text
  if (typeof text !== 'string') {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const runtimePath = process.env.GTO_MCP_RUNTIME_FILE || path.join(os.homedir(), '.gtoffice', 'mcp', 'runtime.json')
  if (!fs.existsSync(runtimePath)) {
    throw new Error(`bridge runtime file not found: ${runtimePath}`)
  }

  process.stdout.write(`[probe] server command: ${options.server.command} ${options.server.args.join(' ')}\n`)
  const client = new StdioRpcClient(options.server.command, options.server.args, options.timeoutMs)

  try {
    await client.call('initialize', {
      protocolVersion: '2025-11-05',
      capabilities: {},
      clientInfo: { name: 'gto-agent-mcp-probe', version: '0.1.0' },
    })
    client.notify('notifications/initialized', {})

    const listResp = await client.call('tools/list', {})
    const tools = listResp?.result?.tools || []
    const names = new Set(tools.map((tool) => tool.name))
    for (const required of ['gto_dispatch_task', 'gto_report_status', 'gto_handover', 'gto_health']) {
      if (!names.has(required)) {
        throw new Error(`required tool missing: ${required}`)
      }
    }
    process.stdout.write(`[probe] tools/list ok: ${Array.from(names).join(', ')}\n`)

    const healthResp = await client.call('tools/call', {
      name: 'gto_health',
      arguments: {},
    })
    const healthResult = parseToolText(healthResp?.result)
    if (healthResp?.result?.isError) {
      throw new Error(`gto_health returned error: ${JSON.stringify(healthResult)}`)
    }
    process.stdout.write(`[probe] gto_health ok: ${JSON.stringify(healthResult)}\n`)

    if (options.dispatch) {
      if (!options.workspaceId || options.targets.length === 0) {
        process.stdout.write('[probe] skip gto_dispatch_task (workspace/targets missing)\n')
      } else {
        const dispatchResp = await client.call('tools/call', {
          name: 'gto_dispatch_task',
          arguments: {
            workspace_id: options.workspaceId,
            targets: options.targets,
            title: 'MCP E2E Probe Task',
            markdown: '- probe dispatch from gto-agent-mcp-probe',
          },
        })
        const dispatchResult = parseToolText(dispatchResp?.result)
        if (dispatchResp?.result?.isError && options.strict) {
          throw new Error(`gto_dispatch_task returned error: ${JSON.stringify(dispatchResult)}`)
        }
        process.stdout.write(`[probe] gto_dispatch_task result: ${JSON.stringify(dispatchResult)}\n`)
      }
    }

    if (options.handover) {
      if (!options.workspaceId || options.targets.length === 0) {
        process.stdout.write('[probe] skip gto_handover (workspace/targets missing)\n')
      } else {
        const handoverResp = await client.call('tools/call', {
          name: 'gto_handover',
          arguments: {
            workspace_id: options.workspaceId,
            sender_agent_id: options.targets[0],
            target_agent_ids: options.targets,
            summary: 'probe handover',
            blockers: [],
            next_steps: ['review probe output'],
          },
        })
        const handoverResult = parseToolText(handoverResp?.result)
        if (handoverResp?.result?.isError && options.strict) {
          throw new Error(`gto_handover returned error: ${JSON.stringify(handoverResult)}`)
        }
        process.stdout.write(`[probe] gto_handover result: ${JSON.stringify(handoverResult)}\n`)
      }
    }

    process.stdout.write('[probe] done\n')
  } finally {
    client.close()
  }
}

main().catch((error) => {
  process.stderr.write(`[probe] failed: ${error.message}\n`)
  process.exit(1)
})
