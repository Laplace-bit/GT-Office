import fs from 'node:fs/promises'
import path from 'node:path'
import {
  callBridge,
  BridgeClientError,
  compareStateCandidates,
  loadRuntimeConfig,
  resolveDirectoryFilePath,
  resolveStateCandidates,
  stateCandidateFreshness,
} from './bridge-client.mjs'

const SERVER_NAME = 'gto-agent-mcp'
const SERVER_VERSION = '0.1.0'
const JSONRPC_VERSION = '2.0'
const TRANSPORT_HEADERS = 'headers'
const TRANSPORT_NDJSON = 'ndjson'
const ENV_WORKSPACE_ID = 'GTO_WORKSPACE_ID'
const ENV_AGENT_ID = 'GTO_AGENT_ID'
const ENV_ROLE_KEY = 'GTO_ROLE_KEY'
const ENV_STATION_ID = 'GTO_STATION_ID'

const TOOL_DEFINITIONS = [
  {
    name: 'gto_get_agent_directory',
    description: '列出当前 workspace 的 agent。GT Office agent 间通信默认走本 MCP；后续发送复用返回里的 workspaceId 和 agents[].agentId。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace_id: { type: 'string' },
      },
    },
  },
  {
    name: 'gto_dispatch_task',
    description:
      '向目标 agent 写入并执行任务文本。需要让其他 GT Office agent 执行或回复时使用它；workspace_id 可省略并自动解析。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['targets', 'title', 'markdown'],
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
    description: '向其他 GT Office agent 回报状态。agent 间普通回复、进展同步默认用它；workspace_id 可省略并自动解析。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target_agent_ids', 'status'],
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
    description: '向其他 GT Office agent 发送结构化交接。任务完成后的总结、阻塞、下一步默认用它；workspace_id 可省略并自动解析。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target_agent_ids', 'summary'],
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
    description: '检查本地 GT Office bridge 是否可发送。bridgeAvailable=false 时只能查目录快照，不能发送。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'gto_list_messages',
    description: '读取当前 agent 最近收到的 GT Office MCP 消息。默认读取当前 agent 的 inbox，可按 task_id 过滤。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace_id: { type: 'string' },
        target_agent_id: { type: 'string' },
        sender_agent_id: { type: 'string' },
        task_id: { type: 'string' },
        limit: { type: 'number' },
      },
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
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  }
}

async function callTool(name, args) {
  switch (name) {
    case 'gto_get_agent_directory':
      return await gtoGetAgentDirectory(args)
    case 'gto_dispatch_task':
      return await gtoDispatchTask(args)
    case 'gto_report_status':
      return await gtoReportStatus(args)
    case 'gto_handover':
      return await gtoHandover(args)
    case 'gto_health':
      return await gtoHealth()
    case 'gto_list_messages':
      return await gtoListMessages(args)
    default:
      throw new Error(`unsupported tool: ${name}`)
  }
}

function currentAgentContext() {
  const workspaceId = String(process.env[ENV_WORKSPACE_ID] || '').trim()
  const agentId = String(process.env[ENV_AGENT_ID] || '').trim()
  const roleKey = String(process.env[ENV_ROLE_KEY] || '').trim()
  const stationId = String(process.env[ENV_STATION_ID] || '').trim()
  if (!workspaceId && !agentId && !roleKey && !stationId) {
    return null
  }
  return {
    workspaceId: workspaceId || null,
    agentId: agentId || null,
    roleKey: roleKey || null,
    stationId: stationId || null,
    sessionId: null,
    toolKind: null,
  }
}

function normalizeCwd(value) {
  if (!value) {
    return ''
  }
  try {
    return path.resolve(value)
  } catch {
    return ''
  }
}

function compactAgent(agent) {
  return {
    agentId: agent?.agentId || null,
    name: agent?.name || null,
    roleKey: agent?.roleKey || null,
    online: Boolean(agent?.online),
    state: agent?.state || null,
    resolvedCwd: agent?.resolvedCwd || null,
  }
}

function matchAgentByCwd(agents, cwd = process.cwd()) {
  const normalizedCwd = normalizeCwd(cwd)
  if (!normalizedCwd || !Array.isArray(agents)) {
    return null
  }

  const scored = agents
    .map((agent) => {
      const agentCwd = normalizeCwd(agent?.resolvedCwd)
      if (!agentCwd) {
        return null
      }
      if (normalizedCwd === agentCwd) {
        return { agent, score: agentCwd.length + 1000 }
      }
      if (normalizedCwd.startsWith(`${agentCwd}${path.sep}`)) {
        return { agent, score: agentCwd.length }
      }
      return null
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)

  return scored[0]?.agent || null
}

async function loadDirectorySnapshot(workspaceId) {
  return await loadDirectorySnapshotFallback(workspaceId)
}

async function loadAgentDirectory(workspaceId) {
  try {
    return await callBridge('directory.get', { workspaceId }, { workspaceId })
  } catch (error) {
    if (error instanceof BridgeClientError && error.code === 'WORKSPACE_NOT_FOUND') {
      throw new BridgeClientError(
        'MCP_WORKSPACE_NOT_AVAILABLE',
        `workspace '${workspaceId}' is not active; refresh directory and retry.`,
        await buildWorkspaceRefreshDetails(workspaceId),
      )
    }
    if (!(error instanceof BridgeClientError)) {
      throw error
    }
    return await loadDirectorySnapshot(workspaceId)
  }
}

function attachSelfContext(directory) {
  const context = currentAgentContext()
  const inferredByCwd = matchAgentByCwd(directory?.agents)
  const agentId = context?.agentId || inferredByCwd?.agentId || null
  const roleKey = context?.roleKey || inferredByCwd?.roleKey || null
  const stationId = context?.stationId || inferredByCwd?.agentId || null

  return {
    workspaceId: directory?.workspaceId || null,
    directoryVersion: directory?.directoryVersion || null,
    updatedAtMs: directory?.updatedAtMs || null,
    agents: Array.isArray(directory?.agents) ? directory.agents.map(compactAgent) : [],
    self: agentId
      ? {
          agentId,
          roleKey,
          stationId,
          sessionId: null,
          toolKind: null,
        }
      : null,
  }
}

async function inferSenderAgentIdFromDirectory(preferredWorkspaceId = '') {
  const workspaceId = preferredWorkspaceId || (await resolveDirectoryWorkspaceId(null)).workspaceId
  const directory = await loadAgentDirectory(workspaceId)
  const matched = attachSelfContext(directory)?.self?.agentId || matchAgentByCwd(directory?.agents)?.agentId || null
  if (!matched) {
    throw new Error('sender agent could not be inferred from current terminal context')
  }
  return { agentId: matched, resolvedFrom: 'directory', workspaceId }
}

async function resolveSenderAgentId(explicitSenderAgentId, preferredWorkspaceId = '') {
  const explicit = String(explicitSenderAgentId || '').trim()
  if (explicit) {
    return { agentId: explicit, resolvedFrom: 'explicit' }
  }
  const envAgentId = String(process.env[ENV_AGENT_ID] || '').trim()
  if (envAgentId) {
    return { agentId: envAgentId, resolvedFrom: 'env' }
  }
  return await inferSenderAgentIdFromDirectory(preferredWorkspaceId)
}

function validateWorkspaceId(explicitWorkspaceId, { allowAutoResolve = false } = {}) {
  const value = String(explicitWorkspaceId || '').trim()
  if (!value) {
    if (allowAutoResolve) {
      return ''
    }
    throw new Error('workspace_id is required and must look like ws:...')
  }
  if (!value.startsWith('ws:')) {
    throw new Error('workspace_id must look like ws:..., not an agent id')
  }
  return value
}

async function buildWorkspaceRefreshDetails(requestedWorkspaceId) {
  let suggestedWorkspaceId = null
  try {
    suggestedWorkspaceId = (await resolveDirectoryWorkspaceId(null)).workspaceId || null
  } catch {
    suggestedWorkspaceId = null
  }
  return {
    requestedWorkspaceId,
    suggestedWorkspaceId,
    hint: 'Call gto_get_agent_directory({}) again and reuse the returned workspaceId.',
  }
}

async function callBridgeForSend(method, params, workspaceId) {
  try {
    return await callBridge(method, params, { workspaceId })
  } catch (error) {
    if (error instanceof BridgeClientError && error.code === 'WORKSPACE_NOT_FOUND') {
      throw new BridgeClientError(
        'MCP_WORKSPACE_NOT_AVAILABLE',
        `workspace '${workspaceId}' is not active in the live bridge.`,
        await buildWorkspaceRefreshDetails(workspaceId),
      )
    }
    if (error instanceof BridgeClientError && error.code === 'MCP_BRIDGE_UNAVAILABLE') {
      throw new BridgeClientError(
        'MCP_BRIDGE_SEND_UNAVAILABLE',
        'send requires a live GT Office bridge; directory snapshot alone is not enough.',
        {
          ...error.details,
          originalCode: error.code,
        },
      )
    }
    throw error
  }
}

async function loadDirectorySnapshotFiles() {
  const candidates = resolveStateCandidates().sort(compareStateCandidates)
  const snapshots = []
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate.directoryPath, 'utf8')
      const parsed = JSON.parse(raw)
      const workspaces = parsed?.workspaces
      if (!workspaces || typeof workspaces !== 'object' || Object.keys(workspaces).length === 0) {
        continue
      }
      snapshots.push({
        filePath: candidate.directoryPath,
        workspaces,
        freshness: stateCandidateFreshness(candidate),
      })
    } catch {
      continue
    }
  }
  if (snapshots.length === 0) {
    throw new Error(`directory snapshot file does not contain workspaces: ${resolveDirectoryFilePath()}`)
  }
  return snapshots
}

async function loadDirectorySnapshotFallback(workspaceId) {
  const snapshots = await loadDirectorySnapshotFiles()
  for (const snapshotFile of snapshots) {
    const snapshot = snapshotFile.workspaces?.[workspaceId]
    if (snapshot && typeof snapshot === 'object') {
      return snapshot
    }
  }
  throw new Error(`directory snapshot for workspace '${workspaceId}' was not found`)
}

async function resolveDirectoryWorkspaceId(explicitWorkspaceId) {
  const explicit = validateWorkspaceId(explicitWorkspaceId, { allowAutoResolve: true })
  if (explicit) {
    return { workspaceId: explicit, resolvedFrom: 'explicit' }
  }

  const envWorkspaceId = String(process.env[ENV_WORKSPACE_ID] || '').trim()
  if (envWorkspaceId) {
    return { workspaceId: envWorkspaceId, resolvedFrom: 'env' }
  }

  const snapshots = await loadDirectorySnapshotFiles()
  const entries = snapshots
    .flatMap((snapshotFile) => Object.entries(snapshotFile.workspaces || {}))
    .filter(([, snapshot]) => snapshot && typeof snapshot === 'object')
    .sort((left, right) => Number(right[1]?.updatedAtMs || 0) - Number(left[1]?.updatedAtMs || 0))
  if (entries.length === 0) {
    throw new Error('workspace_id is missing and no directory snapshot workspace could be inferred')
  }
  return { workspaceId: entries[0][0], resolvedFrom: 'snapshot' }
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

async function gtoGetAgentDirectory(args = {}) {
  const { workspaceId, resolvedFrom } = await resolveDirectoryWorkspaceId(args.workspace_id)
  const directory = await loadAgentDirectory(workspaceId)
  return {
    ...attachSelfContext(directory),
    workspaceResolvedFrom: resolvedFrom,
  }
}

async function gtoDispatchTask(args = {}) {
  const { workspaceId } = await resolveDirectoryWorkspaceId(args.workspace_id)
  const targets = parseTargets(args.targets)
  const title = String(args.title || '').trim()
  const markdown = String(args.markdown || '').trim()
  let senderAgentId = ''
  let senderResolvedFrom = 'human'
  try {
    const resolvedSender = await resolveSenderAgentId(args.sender_agent_id, workspaceId)
    senderAgentId = resolvedSender.agentId
    senderResolvedFrom = resolvedSender.resolvedFrom
  } catch {
    senderAgentId = ''
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

  const response = await callBridgeForSend('task.dispatch_batch', {
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
  }, workspaceId)

  const sent = Array.isArray(response.results)
    ? response.results.filter((item) => item?.status === 'sent').length
    : 0
  const failed = Array.isArray(response.results)
    ? response.results.filter((item) => item?.status === 'failed').length
    : 0

  return {
    summary: `batch=${response.batchId} sent=${sent} failed=${failed}`,
    ...(senderResolvedFrom === 'human' ? {} : { senderResolvedFrom }),
    response,
  }
}

async function gtoReportStatus(args = {}) {
  const { workspaceId } = await resolveDirectoryWorkspaceId(args.workspace_id)
  const { agentId: senderAgentId, resolvedFrom: senderResolvedFrom } = await resolveSenderAgentId(
    args.sender_agent_id,
    workspaceId,
  )
  const targetAgentIds = parseTargets(args.target_agent_ids)
  const status = String(args.status || '').trim()

  if (targetAgentIds.length === 0) {
    throw new Error('target_agent_ids must contain at least one agent id')
  }
  if (!status) {
    throw new Error('status is required')
  }

  const response = await callBridgeForSend('channel.publish', {
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
  }, workspaceId)

  return {
    summary: `message=${response.messageId} accepted=${response.acceptedTargets?.length || 0} failed=${response.failedTargets?.length || 0}`,
    senderResolvedFrom,
    response,
  }
}

async function gtoHandover(args = {}) {
  const { workspaceId } = await resolveDirectoryWorkspaceId(args.workspace_id)
  const { agentId: senderAgentId, resolvedFrom: senderResolvedFrom } = await resolveSenderAgentId(
    args.sender_agent_id,
    workspaceId,
  )
  const targetAgentIds = parseTargets(args.target_agent_ids)
  const summary = String(args.summary || '').trim()

  if (targetAgentIds.length === 0) {
    throw new Error('target_agent_ids must contain at least one agent id')
  }
  if (!summary) {
    throw new Error('summary is required')
  }

  const blockers = Array.isArray(args.blockers) ? args.blockers.map(String) : []
  const nextSteps = Array.isArray(args.next_steps) ? args.next_steps.map(String) : []

  const response = await callBridgeForSend('channel.publish', {
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
  }, workspaceId)

  return {
    summary: `handover message=${response.messageId}`,
    senderResolvedFrom,
    response,
  }
}

async function gtoHealth() {
  const self = currentAgentContext()
  let preferredWorkspaceId = ''
  try {
    preferredWorkspaceId =
      self?.workspaceId || (await resolveDirectoryWorkspaceId(null)).workspaceId || ''
  } catch {
    preferredWorkspaceId = self?.workspaceId || ''
  }
  let runtime = null
  let bridge = null
  let bridgeAvailable = false
  try {
    runtime = await loadRuntimeConfig({ workspaceId: preferredWorkspaceId })
  } catch (error) {
    if (!(error instanceof BridgeClientError)) {
      throw error
    }
    runtime = {
      code: error.code,
      message: error.message,
      details: error.details,
    }
  }

  try {
    bridge = await callBridge('health', {}, { workspaceId: preferredWorkspaceId })
    bridgeAvailable = true
  } catch (error) {
    if (!(error instanceof BridgeClientError)) {
      throw error
    }
    bridge = {
      code: error.code,
      message: error.message,
      details: error.details,
    }
  }
  let directory = null
  try {
    const snapshot = await gtoGetAgentDirectory({ workspace_id: preferredWorkspaceId || null })
    directory = {
      workspaceId: snapshot.workspaceId,
      directoryVersion: snapshot.directoryVersion,
      updatedAtMs: snapshot.updatedAtMs,
      agentCount: Array.isArray(snapshot.agents) ? snapshot.agents.length : 0,
      workspaceResolvedFrom: snapshot.workspaceResolvedFrom,
    }
  } catch {
    directory = null
  }
  return {
    bridgeAvailable,
    self,
    directory,
    ...(bridgeAvailable ? {} : { bridge, runtime }),
  }
}

async function gtoListMessages(args = {}) {
  const { workspaceId } = await resolveDirectoryWorkspaceId(args.workspace_id)
  const targetAgentId = String(args.target_agent_id || '').trim()
    ? String(args.target_agent_id || '').trim()
    : (await resolveSenderAgentId(null, workspaceId)).agentId
  const senderAgentId = String(args.sender_agent_id || '').trim() || null
  const taskId = String(args.task_id || '').trim() || null
  const limitRaw = Number(args.limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20

  const response = await callBridgeForSend(
    'channel.list_messages',
    {
      workspaceId,
      targetAgentId,
      senderAgentId,
      taskId,
      limit,
    },
    workspaceId,
  )

  return {
    targetAgentId,
    messages: Array.isArray(response.messages) ? response.messages : [],
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
