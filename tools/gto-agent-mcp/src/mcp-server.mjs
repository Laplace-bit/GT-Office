import { callBridge, BridgeClientError, loadRuntimeConfig } from './bridge-client.mjs'

const SERVER_NAME = 'gto-agent-mcp'
const SERVER_VERSION = '0.1.0'
const JSONRPC_VERSION = '2.0'
const TRANSPORT_HEADERS = 'headers'
const TRANSPORT_NDJSON = 'ndjson'

const TOOL_DEFINITIONS = [
  {
    name: 'gto_dispatch_task',
    description:
      '通过 GT Office 任务中心批量派发任务给目标 Agent（manager -> workers）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'targets', 'title', 'markdown'],
      properties: {
        workspace_id: { type: 'string' },
        targets: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
        },
        title: { type: 'string' },
        markdown: { type: 'string' },
        sender_agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'gto_report_status',
    description: '执行 Agent 向 manager 或其他 Agent 汇报状态进展（status）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'sender_agent_id', 'target_agent_ids', 'status'],
      properties: {
        workspace_id: { type: 'string' },
        sender_agent_id: { type: 'string' },
        target_agent_ids: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
        },
        status: { type: 'string' },
        task_id: { type: 'string' },
        detail: { type: 'string' },
      },
    },
  },
  {
    name: 'gto_handover',
    description: '执行 Agent 完成后发送结构化交接（handover）给 manager。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'sender_agent_id', 'target_agent_ids', 'summary'],
      properties: {
        workspace_id: { type: 'string' },
        sender_agent_id: { type: 'string' },
        target_agent_ids: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
        },
        task_id: { type: 'string' },
        summary: { type: 'string' },
        blockers: {
          type: 'array',
          items: { type: 'string' },
        },
        next_steps: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'gto_health',
    description: '检查本地 GT Office MCP bridge 健康状态与运行时配置。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
]

function sendMessage(message, transport = TRANSPORT_HEADERS) {
  const payload = JSON.stringify(message)
  if (transport === TRANSPORT_NDJSON) {
    process.stdout.write(`${payload}\n`)
    return
  }
  const bytes = Buffer.byteLength(payload, 'utf8')
  process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${payload}`)
}

function makeTextResult(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  }
}

async function callTool(name, args) {
  switch (name) {
    case 'gto_dispatch_task':
      return await gtoDispatchTask(args)
    case 'gto_report_status':
      return await gtoReportStatus(args)
    case 'gto_handover':
      return await gtoHandover(args)
    case 'gto_health':
      return await gtoHealth()
    default:
      throw new Error(`unsupported tool: ${name}`)
  }
}

function parseTargets(raw) {
  if (!Array.isArray(raw)) {
    return []
  }
  const normalized = raw
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
  return [...new Set(normalized)]
}

async function gtoDispatchTask(args = {}) {
  const workspaceId = String(args.workspace_id || '').trim()
  const targets = parseTargets(args.targets)
  const title = String(args.title || '').trim()
  const markdown = String(args.markdown || '').trim()
  const senderAgentId = String(args.sender_agent_id || '').trim()

  if (!workspaceId) {
    throw new Error('workspace_id is required')
  }
  if (targets.length === 0) {
    throw new Error('targets must contain at least one agent id')
  }
  if (!title) {
    throw new Error('title is required')
  }
  if (!markdown) {
    throw new Error('markdown is required')
  }

  const response = await callBridge('task.dispatch_batch', {
    workspaceId,
    sender: {
      type: senderAgentId ? 'agent' : 'human',
      agentId: senderAgentId || null,
    },
    targets,
    title,
    markdown,
    attachments: [],
    submitSequences: {},
  })

  const sent = Array.isArray(response.results)
    ? response.results.filter((item) => item?.status === 'sent').length
    : 0
  const failed = Array.isArray(response.results)
    ? response.results.filter((item) => item?.status === 'failed').length
    : 0

  return {
    summary: `batch=${response.batchId} sent=${sent} failed=${failed}`,
    response,
  }
}

async function gtoReportStatus(args = {}) {
  const workspaceId = String(args.workspace_id || '').trim()
  const senderAgentId = String(args.sender_agent_id || '').trim()
  const targetAgentIds = parseTargets(args.target_agent_ids)
  const status = String(args.status || '').trim()

  if (!workspaceId) {
    throw new Error('workspace_id is required')
  }
  if (!senderAgentId) {
    throw new Error('sender_agent_id is required')
  }
  if (targetAgentIds.length === 0) {
    throw new Error('target_agent_ids must contain at least one agent id')
  }
  if (!status) {
    throw new Error('status is required')
  }

  const response = await callBridge('channel.publish', {
    workspaceId,
    channel: {
      kind: targetAgentIds.length === 1 ? 'direct' : 'group',
      id: targetAgentIds.length === 1 ? targetAgentIds[0] : 'manager-status',
    },
    senderAgentId,
    targetAgentIds,
    type: 'status',
    payload: {
      taskId: args.task_id || null,
      status,
      detail: args.detail || null,
      source: 'gto-agent-mcp',
    },
    idempotencyKey: null,
  })

  return {
    summary: `message=${response.messageId} accepted=${response.acceptedTargets?.length || 0} failed=${response.failedTargets?.length || 0}`,
    response,
  }
}

async function gtoHandover(args = {}) {
  const workspaceId = String(args.workspace_id || '').trim()
  const senderAgentId = String(args.sender_agent_id || '').trim()
  const targetAgentIds = parseTargets(args.target_agent_ids)
  const summary = String(args.summary || '').trim()

  if (!workspaceId) {
    throw new Error('workspace_id is required')
  }
  if (!senderAgentId) {
    throw new Error('sender_agent_id is required')
  }
  if (targetAgentIds.length === 0) {
    throw new Error('target_agent_ids must contain at least one agent id')
  }
  if (!summary) {
    throw new Error('summary is required')
  }

  const blockers = Array.isArray(args.blockers) ? args.blockers.map(String) : []
  const nextSteps = Array.isArray(args.next_steps) ? args.next_steps.map(String) : []

  const response = await callBridge('channel.publish', {
    workspaceId,
    channel: {
      kind: targetAgentIds.length === 1 ? 'direct' : 'group',
      id: targetAgentIds.length === 1 ? targetAgentIds[0] : 'manager-handover',
    },
    senderAgentId,
    targetAgentIds,
    type: 'handover',
    payload: {
      taskId: args.task_id || null,
      summary,
      blockers,
      nextSteps,
      source: 'gto-agent-mcp',
    },
    idempotencyKey: null,
  })

  return {
    summary: `handover message=${response.messageId}`,
    response,
  }
}

async function gtoHealth() {
  const runtime = await loadRuntimeConfig()
  const bridge = await callBridge('health', {})
  return {
    runtime,
    bridge,
  }
}

function handleBridgeError(error) {
  if (error instanceof BridgeClientError) {
    return makeTextResult(
      {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      true,
    )
  }
  return makeTextResult(
    {
      code: 'MCP_BRIDGE_INTERNAL',
      message: error instanceof Error ? error.message : String(error),
    },
    true,
  )
}

async function handleRequest(request, transport) {
  const { id, method, params } = request

  if (method === 'initialize') {
    sendMessage({
      jsonrpc: JSONRPC_VERSION,
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2025-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      },
    }, transport)
    return
  }

  if (method === 'ping') {
    sendMessage({ jsonrpc: JSONRPC_VERSION, id, result: {} }, transport)
    return
  }

  if (method === 'notifications/initialized') {
    return
  }

  if (method === 'tools/list') {
    sendMessage({
      jsonrpc: JSONRPC_VERSION,
      id,
      result: {
        tools: TOOL_DEFINITIONS,
      },
    }, transport)
    return
  }

  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments || {}
    if (typeof name !== 'string' || !name) {
      sendMessage({
        jsonrpc: JSONRPC_VERSION,
        id,
        result: makeTextResult({ code: 'MCP_INVALID_PARAMS', message: 'tool name is required' }, true),
      }, transport)
      return
    }

    try {
      const result = await callTool(name, args)
      sendMessage({ jsonrpc: JSONRPC_VERSION, id, result: makeTextResult(result, false) }, transport)
    } catch (error) {
      sendMessage({ jsonrpc: JSONRPC_VERSION, id, result: handleBridgeError(error) }, transport)
    }
    return
  }

  sendMessage({
    jsonrpc: JSONRPC_VERSION,
    id,
    error: {
      code: -32601,
      message: `method not found: ${method}`,
    },
  }, transport)
}

export function startMcpServer() {
  let buffer = Buffer.alloc(0)
  let transport = TRANSPORT_HEADERS

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    while (true) {
      const parsed = parseNextMessage(buffer)
      if (!parsed) {
        return
      }
      const { body, remaining, skip, transport: detectedTransport } = parsed
      buffer = remaining
      if (detectedTransport) {
        transport = detectedTransport
      }
      if (skip) {
        continue
      }

      let request
      try {
        request = JSON.parse(body)
      } catch (error) {
        sendMessage({
          jsonrpc: JSONRPC_VERSION,
          id: null,
          error: { code: -32700, message: `invalid json payload: ${error.message}` },
        }, transport)
        continue
      }

      Promise.resolve(handleRequest(request, transport)).catch((error) => {
        sendMessage({
          jsonrpc: JSONRPC_VERSION,
          id: request?.id ?? null,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        }, transport)
      })
    }
  })

  process.stdin.on('end', () => {
    process.exit(0)
  })
}

function parseNextMessage(buffer) {
  const headerEnd = findHeaderEnd(buffer)
  if (headerEnd >= 0) {
    const headerText = buffer.slice(0, headerEnd).toString('utf8')
    const headers = headerText.split(/\r?\n/)
    let contentLength = -1
    for (const header of headers) {
      const separatorIndex = header.indexOf(':')
      if (separatorIndex <= 0) {
        continue
      }
      const key = header.slice(0, separatorIndex).trim().toLowerCase()
      const value = header.slice(separatorIndex + 1).trim()
      if (key === 'content-length') {
        contentLength = Number.parseInt(value, 10)
        break
      }
    }
    if (!Number.isInteger(contentLength) || contentLength < 0) {
      sendMessage({
        jsonrpc: JSONRPC_VERSION,
        id: null,
        error: { code: -32700, message: 'invalid content-length header' },
      }, TRANSPORT_HEADERS)
      return { body: '', remaining: Buffer.alloc(0), skip: true, transport: TRANSPORT_HEADERS }
    }
    const bodyStart = headerEnd + (buffer[headerEnd] === 13 ? 4 : 2)
    const bodyEnd = bodyStart + contentLength
    if (buffer.length < bodyEnd) {
      return null
    }
    return {
      body: buffer.slice(bodyStart, bodyEnd).toString('utf8'),
      remaining: buffer.slice(bodyEnd),
      transport: TRANSPORT_HEADERS,
    }
  }

  const lineEnd = buffer.indexOf('\n')
  if (lineEnd < 0) {
    return null
  }
  const line = buffer.slice(0, lineEnd + 1).toString('utf8')
  const trimmed = line.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return null
  }
  return {
    body: trimmed,
    remaining: buffer.slice(lineEnd + 1),
    transport: TRANSPORT_NDJSON,
  }
}

function findHeaderEnd(buffer) {
  const crlfIndex = buffer.indexOf('\r\n\r\n')
  if (crlfIndex >= 0) {
    return crlfIndex
  }
  return buffer.indexOf('\n\n')
}
