import fsSync from 'node:fs'
import path from 'node:path'
import { createAgentBackend } from './adapters/agent_backend.js'
import { createDefaultBridgeClient, loadDirectoryState, type DirectoryStateSnapshot } from './adapters/bridge_client.js'
import { createChannelBackend } from './adapters/channel_backend.js'
import { createDirectoryBackend } from './adapters/directory_backend.js'
import { createTaskBackend } from './adapters/task_backend.js'
import { createAgentCommands } from './commands/agent.js'
import { createChannelCommands } from './commands/channel.js'
import { createDirectoryCommands } from './commands/directory.js'
import { createRoleCommands } from './commands/role.js'
import { createTaskCommands } from './commands/task.js'
import { createRepl } from './repl/repl.js'
import { CliError } from './core/errors.js'
import { renderOutput } from './core/output.js'
import { errorResult, okResult } from './core/result.js'

interface WritableLike {
  write(chunk: string): void
}

interface ReplLike {
  run(params: { stdin?: unknown; stdout?: WritableLike; dispatch: (argv: string[]) => Promise<number> }): Promise<number>
}

interface CliDeps {
  stdin?: unknown
  stdout?: WritableLike
  write?: (chunk: string) => void
  cwd?: string
  bridge?: unknown
  createAgentBackend?: (bridge: unknown) => unknown
  createChannelBackend?: (bridge: unknown) => unknown
  createDirectoryBackend?: (bridge: unknown) => unknown
  createTaskBackend?: (bridge: unknown) => unknown
  createAgentCommands?: (backend: unknown) => {
    list(params: { workspaceId: string }): Promise<unknown>
    get(params: { workspaceId: string; agentId: string }): Promise<unknown>
    create(params: { workspaceId: string; payload: Record<string, unknown> }): Promise<unknown>
    update(params: { workspaceId: string; agentId: string; payload: Record<string, unknown> }): Promise<unknown>
    remove(params: { workspaceId: string; agentId: string }): Promise<unknown>
    promptRead(params: { workspaceId: string; agentId: string }): Promise<unknown>
  }
  createChannelCommands?: (backend: unknown) => {
    listMessages(params: { workspaceId: string; targetAgentId?: string; senderAgentId?: string; taskId?: string; limit?: number }): Promise<unknown>
    send(params: { workspaceId: string; channelKind: string; channelId: string; senderAgentId?: string; targetAgentIds?: string[]; messageType: string; payload: unknown; idempotencyKey?: string }): Promise<unknown>
  }
  createDirectoryCommands?: (backend: unknown) => {
    snapshot(params: { workspaceId: string }): Promise<unknown>
  }
  createTaskCommands?: (backend: unknown) => {
    sendTask(params: {
      workspaceId: string
      senderAgentId?: string | null
      targetAgentIds: string[]
      title: string
      markdown: string
    }): Promise<unknown>
    replyStatus(params: {
      workspaceId: string
      senderAgentId?: string | null
      targetAgentIds: string[]
      taskId: string
      detail: string
    }): Promise<unknown>
    handover(params: {
      workspaceId: string
      senderAgentId?: string | null
      targetAgentIds: string[]
      taskId: string
      summary: string
      blockers: string[]
      nextSteps: string[]
    }): Promise<unknown>
    inbox(params: { workspaceId: string; agentId?: string | null; limit?: number }): Promise<unknown>
    taskThread(params: { workspaceId: string; taskId: string }): Promise<unknown>
  }
  createRoleCommands?: (backend: unknown) => {
    list(params: { workspaceId: string }): Promise<unknown>
    create(params: { workspaceId: string; payload: unknown }): Promise<unknown>
    update(params: { workspaceId: string; roleId: string; payload: Record<string, unknown> }): Promise<unknown>
    remove(params: { workspaceId: string; roleId: string; scope?: string }): Promise<unknown>
  }
  repl?: ReplLike
}

type DirectoryAgentRecord = {
  agentId?: string
  name?: string
  resolvedCwd?: string | null
  online?: boolean
}

type WorkspaceDirectoryRecord = {
  workspaceId?: string
  agents?: DirectoryAgentRecord[]
  runtimes?: Array<{ resolvedCwd?: string | null; agentId?: string }>
}

async function requireWorkspaceId(argv: string[], deps: CliDeps) {
  const workspaceId = readOption(argv, '--workspace-id')
    ?? readEnvVar('GTO_WORKSPACE_ID')
    ?? await resolveWorkspaceIdFromContext(deps)

  if (!workspaceId) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --workspace-id is required')
  }

  return workspaceId
}

function normalizedCwd(deps: CliDeps) {
  return path.resolve(deps.cwd ?? process.cwd())
}

function discoverWorkspaceRootFromCwd(cwd: string) {
  let current = cwd
  for (;;) {
    const marker = path.join(current, '.gtoffice', 'session.snapshot.json')
    if (path.dirname(marker) && path.isAbsolute(marker) && fsSync.existsSync(marker)) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

function candidateCwds(workspace: WorkspaceDirectoryRecord) {
  return [
    ...(workspace.runtimes ?? []).map((item) => item.resolvedCwd).filter(Boolean),
    ...(workspace.agents ?? []).map((item) => item.resolvedCwd).filter(Boolean),
  ] as string[]
}

function bestWorkspaceForRoot(directory: DirectoryStateSnapshot, workspaceRoot: string) {
  const workspaces = Object.values(directory.workspaces ?? {}) as WorkspaceDirectoryRecord[]
  let best: { workspaceId: string; score: number } | null = null

  for (const workspace of workspaces) {
    const workspaceId = workspace.workspaceId?.trim()
    if (!workspaceId) {
      continue
    }
    const score = candidateCwds(workspace)
      .filter((cwd) => cwd === workspaceRoot || cwd.startsWith(`${workspaceRoot}${path.sep}`))
      .length
    if (score <= 0) {
      continue
    }
    if (!best || score > best.score) {
      best = { workspaceId, score }
    }
  }

  if (best) {
    return best.workspaceId
  }

  if (workspaces.length === 1) {
    return workspaces[0].workspaceId?.trim() || null
  }

  return null
}

async function resolveWorkspaceIdFromContext(deps: CliDeps) {
  const cwd = normalizedCwd(deps)
  const workspaceRoot = discoverWorkspaceRootFromCwd(cwd)
  if (!workspaceRoot) {
    return null
  }
  try {
    const directory = await loadDirectoryState()
    return bestWorkspaceForRoot(directory, workspaceRoot)
  } catch {
    return null
  }
}

function readRoleArgAt(argv: string[], index: number) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    return null
  }

  return value
}

function requireRoleId(argv: string[]) {
  const positionalRoleId = readRoleArgAt(argv, 2)
  if (positionalRoleId) {
    return positionalRoleId
  }

  const roleId = readOption(argv, '--role-id')

  if (!roleId) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --role-id is required')
  }

  return roleId
}

const AGENT_TOOLS = ['claude', 'codex', 'gemini'] as const
const AGENT_STATES = ['ready', 'paused', 'blocked', 'terminated'] as const
const ROLE_SCOPES = ['workspace', 'global'] as const
const ROLE_STATUSES = ['active', 'deprecated', 'disabled'] as const
const PROMPT_FILE_NAMES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const
const CHANNEL_KINDS = ['direct', 'group', 'broadcast'] as const
const MESSAGE_TYPES = ['task_instruction', 'status', 'handover'] as const

function ensureAllowedValue(name: string, value: string, allowed: readonly string[]) {
  if (!allowed.includes(value)) {
    throw new CliError('INVALID_ARGUMENT', `Option ${name} must be one of: ${allowed.join(', ')}`)
  }

  return value
}

function readValidatedStringOption(argv: string[], name: string, allowed: readonly string[]) {
  const value = readStringOption(argv, name)

  if (value === undefined) {
    return undefined
  }

  return ensureAllowedValue(name, value, allowed)
}

function readRolePayload(argv: string[]) {
  const payload: Record<string, unknown> = {}
  const roleKey = readStringOption(argv, '--role-key')
  const roleName = readStringOption(argv, '--role-name')
  const scope = readValidatedStringOption(argv, '--scope', ROLE_SCOPES)
  const status = readValidatedStringOption(argv, '--status', ROLE_STATUSES)
  const charterPath = readStringOption(argv, '--charter-path')
  const policyJson = readStringOption(argv, '--policy-json')

  if (roleKey !== undefined) {
    payload.roleKey = roleKey
  }
  if (roleName !== undefined) {
    payload.roleName = roleName
  }
  if (scope !== undefined) {
    payload.scope = scope
  }
  if (status !== undefined) {
    payload.status = status
  }
  if (charterPath !== undefined) {
    payload.charterPath = charterPath
  }
  if (policyJson !== undefined) {
    payload.policyJson = policyJson
  }

  return payload
}

function requireRoleCreatePayload(argv: string[]) {
  const payload = readRolePayload(argv)

  if (typeof payload.roleKey !== 'string') {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --role-key is required')
  }

  if (typeof payload.roleName !== 'string') {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --role-name is required')
  }

  return payload
}

function requireRoleUpdatePayload(argv: string[]) {
  const payload = readRolePayload(argv)

  if (Object.keys(payload).length === 0) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'At least one role field must be provided')
  }

  return payload
}

function ensureNoRolePayload(argv: string[]) {
  if (hasOption(argv, '--payload')) {
    throw new CliError('INVALID_ARGUMENT', 'Role commands do not accept --payload')
  }
}

function readStringOption(argv: string[], name: string) {
  return readOption(argv, name) ?? undefined
}

function readEnvVar(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function readCurrentAgentId(argv: string[]) {
  return readStringOption(argv, '--agent-id') ?? readEnvVar('GTO_AGENT_ID')
}

function requireCurrentAgentId(argv: string[]) {
  const agentId = readCurrentAgentId(argv)
  if (!agentId) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --agent-id is required')
  }
  return agentId
}

function readBooleanFlag(argv: string[], name: string) {
  return argv.includes(name)
}

function readOptionalBooleanOption(argv: string[], name: string) {
  const exact = argv.find((arg) => arg === name || arg.startsWith(`${name}=`))

  if (!exact) {
    return undefined
  }

  if (exact === name) {
    return true
  }

  const [, rawValue] = exact.split('=', 2)
  if (rawValue === 'true') {
    return true
  }
  if (rawValue === 'false') {
    return false
  }

  throw new CliError('INVALID_ARGUMENT', `Option ${name} must be true or false`)
}

function readAgentPayload(argv: string[]) {
  const payload: Record<string, unknown> = {}
  const name = readStringOption(argv, '--name')
  const roleId = readStringOption(argv, '--role-id')
  const tool = readValidatedStringOption(argv, '--tool', AGENT_TOOLS)
  const workdir = readStringOption(argv, '--workdir')
  const customWorkdir = readOptionalBooleanOption(argv, '--custom-workdir')
  const employeeNo = readStringOption(argv, '--employee-no')
  const state = readValidatedStringOption(argv, '--state', AGENT_STATES)
  const promptFileName = readValidatedStringOption(argv, '--prompt-file-name', PROMPT_FILE_NAMES)
  const promptContent = readStringOption(argv, '--prompt-content')

  if (name !== undefined) {
    payload.name = name
  }
  if (roleId !== undefined) {
    payload.roleId = roleId
  }
  if (tool !== undefined) {
    payload.tool = tool
  }
  if (workdir !== undefined) {
    payload.workdir = workdir
  }
  if (customWorkdir !== undefined) {
    payload.customWorkdir = customWorkdir
  } else if (readBooleanFlag(argv, '--custom-workdir')) {
    payload.customWorkdir = true
  }
  if (employeeNo !== undefined) {
    payload.employeeNo = employeeNo
  }
  if (state !== undefined) {
    payload.state = state
  }
  if (promptFileName !== undefined) {
    payload.promptFileName = promptFileName
  }
  if (promptContent !== undefined) {
    payload.promptContent = promptContent
  }

  return payload
}

function requireAgentCreatePayload(argv: string[]) {
  const payload = readAgentPayload(argv)

  if (typeof payload.name !== 'string') {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --name is required')
  }

  if (typeof payload.roleId !== 'string') {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --role-id is required')
  }

  return payload
}

function resolveBridge(deps: CliDeps) {
  return deps.bridge ?? createDefaultBridgeClient()
}

function createAgentCliCommands(deps: CliDeps) {
  const backendFactory = deps.createAgentBackend ?? createAgentBackend
  const commandsFactory = deps.createAgentCommands ?? createAgentCommands
  const backend = backendFactory(resolveBridge(deps))
  return commandsFactory(backend)
}

function hasOption(argv: string[], name: string) {
  return argv.includes(name) || argv.some((arg) => arg.startsWith(`${name}=`))
}

function requireAgentUpdatePayload(argv: string[]) {
  const payload = readAgentPayload(argv)

  if (Object.keys(payload).length === 0) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'At least one agent field must be provided')
  }

  return payload
}

function normalizeAgentCommand(argv: string[]) {
  if (argv[1] === 'prompt' && argv[2] === 'read') {
    return 'prompt-read'
  }

  return argv[1]
}

function normalizeAgentArgv(argv: string[]) {
  if (argv[1] === 'prompt' && argv[2] === 'read') {
    return ['agent', 'prompt-read', ...argv.slice(3)]
  }

  return argv
}

function ensureNoLegacyPayload(argv: string[]) {
  if (hasOption(argv, '--payload')) {
    throw new CliError('INVALID_ARGUMENT', 'Agent commands do not accept --payload')
  }
}

function readAgentArgAt(argv: string[], index: number) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    return null
  }

  return value
}

function requireAgentIdAt(argv: string[], index: number) {
  const agentId = readAgentArgAt(argv, index)
  if (!agentId) {
    throw new CliError('MISSING_REQUIRED_ARGUMENT', 'Agent id is required')
  }

  return agentId
}

function requireAgentIdForCommand(argv: string[]) {
  if (argv[1] === 'prompt-read') {
    return requireAgentIdAt(argv, 2)
  }

  return requireAgentIdAt(argv, 2)
}

function requireRawPayload(argv: string[]) {
  const payload = readOption(argv, '--payload')

  if (!payload) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --payload is required')
  }

  return payload
}

function requireTextOption(argv: string[], name: string) {
  const value = readStringOption(argv, name)
  if (!value) {
    throw new CliError('MISSING_REQUIRED_OPTION', `Option ${name} is required`)
  }
  return value
}

function requireTaskId(argv: string[]) {
  return requireTextOption(argv, '--task-id')
}

function requireChannelId(argv: string[]) {
  const channelId = readOption(argv, '--channel-id')

  if (!channelId) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --channel-id is required')
  }

  return channelId
}

function requireChannelKind(argv: string[]) {
  const channelKind = readOption(argv, '--channel-kind')

  if (!channelKind) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --channel-kind is required')
  }

  return ensureAllowedValue('--channel-kind', channelKind, CHANNEL_KINDS)
}

function requireMessageType(argv: string[]) {
  const messageType = readOption(argv, '--message-type')

  if (!messageType) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --message-type is required')
  }

  return ensureAllowedValue('--message-type', messageType, MESSAGE_TYPES)
}

function readRepeatedOption(argv: string[], name: string) {
  const values: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) {
      continue
    }

    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new CliError('MISSING_REQUIRED_OPTION', `Option ${name} requires a value`)
    }

    values.push(value)
  }

  return values
}

function requireTargetAgentIds(argv: string[]) {
  const targetAgentIds = readRepeatedOption(argv, '--target-agent-id')
  if (targetAgentIds.length === 0) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --target-agent-id is required')
  }
  return targetAgentIds
}

function readLimitOption(argv: string[]) {
  const raw = readOption(argv, '--limit')

  if (!raw) {
    return undefined
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError('INVALID_ARGUMENT', 'Option --limit must be a positive integer')
  }

  return parsed
}

function readTimeoutSec(argv: string[]) {
  const raw = readOption(argv, '--timeout-sec')
  if (!raw) {
    return 120
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError('INVALID_ARGUMENT', 'Option --timeout-sec must be a positive integer')
  }
  return parsed
}

function readPositional(argv: string[], index: number) {
  const values = argv.filter((arg) => !arg.startsWith('--'))
  return values[index] ?? null
}

function summarizeTitle(text: string) {
  const compact = text.trim().replace(/\s+/g, ' ')
  if (!compact) {
    return '未命名任务'
  }
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact
}

function wrapOutput(result: unknown) {
  return hasResultEnvelope(result) ? result : okResult(result)
}

function createRoleCliCommands(deps: CliDeps) {
  const backendFactory = deps.createAgentBackend ?? createAgentBackend
  const commandsFactory = deps.createRoleCommands ?? createRoleCommands
  const backend = backendFactory(resolveBridge(deps))
  return commandsFactory(backend)
}

function createChannelCliCommands(deps: CliDeps) {
  const backendFactory = deps.createChannelBackend ?? createChannelBackend
  const commandsFactory = deps.createChannelCommands ?? createChannelCommands
  const backend = backendFactory(resolveBridge(deps))
  return commandsFactory(backend)
}

function createDirectoryCliCommands(deps: CliDeps) {
  const backendFactory = deps.createDirectoryBackend ?? createDirectoryBackend
  const commandsFactory = deps.createDirectoryCommands ?? createDirectoryCommands
  const backend = backendFactory(resolveBridge(deps))
  return commandsFactory(backend)
}

function createTaskCliCommands(deps: CliDeps) {
  const backendFactory = deps.createTaskBackend ?? createTaskBackend
  const commandsFactory = deps.createTaskCommands ?? createTaskCommands
  const backend = backendFactory(resolveBridge(deps))
  return commandsFactory(backend)
}

async function loadWorkspaceDirectory(workspaceId: string, deps: CliDeps) {
  const commands = createDirectoryCliCommands(deps)
  return await commands.snapshot<{
    workspaceId?: string
    agents?: DirectoryAgentRecord[]
    runtimes?: Array<{ resolvedCwd?: string | null; agentId?: string }>
  }>({ workspaceId })
}

function resolveAgentByRef(
  workspaceId: string,
  directory: { agents?: DirectoryAgentRecord[] },
  ref: string,
) {
  const normalized = ref.trim().toLowerCase()
  if (!normalized) {
    throw new CliError('INVALID_ARGUMENT', 'Agent reference must not be empty')
  }
  const matches = (directory.agents ?? []).filter((agent) => {
    const agentId = agent.agentId?.trim().toLowerCase()
    const name = agent.name?.trim().toLowerCase()
    return agentId === normalized || name === normalized
  })
  if (matches.length === 0) {
    throw new CliError('AGENT_NOT_FOUND', `Agent not found in workspace ${workspaceId}: ${ref}`)
  }
  if (matches.length > 1) {
    throw new CliError('AGENT_AMBIGUOUS', `Agent reference is ambiguous in workspace ${workspaceId}: ${ref}`)
  }
  const agentId = matches[0].agentId?.trim()
  if (!agentId) {
    throw new CliError('AGENT_NOT_FOUND', `Agent id missing in directory snapshot: ${ref}`)
  }
  return {
    agentId,
    name: matches[0].name?.trim() || agentId,
  }
}

async function waitForReply(
  taskCommands: ReturnType<typeof createTaskCliCommands>,
  channelCommands: ReturnType<typeof createChannelCliCommands>,
  workspaceId: string,
  taskId: string,
  senderAgentId: string,
  timeoutSec: number,
) {
  const deadline = Date.now() + timeoutSec * 1000
  for (;;) {
    const thread = await loadTaskThread(taskCommands, channelCommands, workspaceId, taskId)
    const waitState = thread.waitState
    if (waitState && typeof waitState === 'object' && waitState.kind === 'interaction_required') {
      return {
        workspaceId,
        taskId,
        thread: thread.thread ?? null,
        interactionRequired: waitState,
      }
    }
    const messages = thread.thread?.messages ?? []
    const reply = [...messages].reverse().find((message) => {
      const sender = typeof message.senderAgentId === 'string' ? message.senderAgentId : ''
      const type = typeof message.type === 'string' ? message.type : ''
      return sender !== senderAgentId && (type === 'status' || type === 'handover')
    })
    if (reply) {
      return {
        workspaceId,
        taskId,
        thread: thread.thread ?? null,
        reply,
      }
    }
    if (Date.now() >= deadline) {
      throw new CliError('WAIT_TIMEOUT', `Timed out waiting for reply on task ${taskId}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function loadTaskThread(
  taskCommands: ReturnType<typeof createTaskCliCommands>,
  channelCommands: ReturnType<typeof createChannelCliCommands>,
  workspaceId: string,
  taskId: string,
) {
  try {
    return await taskCommands.taskThread<{
      workspaceId?: string
      thread?: {
        summary?: Record<string, unknown>
        messages?: Array<Record<string, unknown>>
      } | null
      waitState?: Record<string, unknown> | null
    }>({ workspaceId, taskId })
  } catch (error) {
    if (!(error instanceof CliError) && !(error instanceof Error && 'code' in error)) {
      throw error
    }
    const code = error instanceof CliError
      ? error.code
      : String((error as { code?: unknown }).code ?? '')
    if (code !== 'LOCAL_BRIDGE_METHOD_UNSUPPORTED' && code !== 'MCP_BRIDGE_METHOD_UNSUPPORTED') {
      throw error
    }
    const fallback = await channelCommands.listMessages<{
      messages?: Array<Record<string, unknown>>
    }>({
      workspaceId,
      taskId,
      limit: 200,
    })
    const messages = [...(fallback.messages ?? [])].sort((left, right) => {
      const leftTs = typeof left.tsMs === 'number' ? left.tsMs : 0
      const rightTs = typeof right.tsMs === 'number' ? right.tsMs : 0
      return leftTs - rightTs
    })
    const latest = messages[messages.length - 1] ?? null
    return {
      workspaceId,
      thread: {
        summary: latest
          ? {
              taskId,
              state: typeof latest.type === 'string'
                ? latest.type === 'handover'
                  ? 'handed_over'
                  : latest.type === 'status'
                    ? 'replied'
                    : 'open'
                : 'open',
            }
          : { taskId, state: 'open' },
        messages,
      },
      waitState: null,
    }
  }
}

async function loadInboxThreads(
  taskCommands: ReturnType<typeof createTaskCliCommands>,
  channelCommands: ReturnType<typeof createChannelCliCommands>,
  workspaceId: string,
  agentId: string,
  limit?: number,
) {
  try {
    return await taskCommands.inbox<{
      workspaceId?: string
      agentId?: string
      threads?: Array<Record<string, unknown>>
    }>({
      workspaceId,
      agentId,
      limit,
    })
  } catch (error) {
    if (!(error instanceof CliError) && !(error instanceof Error && 'code' in error)) {
      throw error
    }
    const code = error instanceof CliError
      ? error.code
      : String((error as { code?: unknown }).code ?? '')
    if (code !== 'LOCAL_BRIDGE_METHOD_UNSUPPORTED' && code !== 'MCP_BRIDGE_METHOD_UNSUPPORTED') {
      throw error
    }
    const fallback = await channelCommands.listMessages<{
      messages?: Array<Record<string, unknown>>
    }>({
      workspaceId,
      targetAgentId: agentId,
      limit: Math.max(limit ?? 20, 200),
    })
    const grouped = new Map<string, Record<string, unknown>>()
    for (const message of fallback.messages ?? []) {
      const payload = (typeof message.payload === 'object' && message.payload !== null)
        ? message.payload as Record<string, unknown>
        : {}
      const taskId = typeof payload.taskId === 'string' ? payload.taskId : null
      if (!taskId) {
        continue
      }
      if (grouped.has(taskId)) {
        continue
      }
      grouped.set(taskId, {
        taskId,
        title: typeof payload.title === 'string' ? payload.title : taskId,
        latestTargetAgentId: message.targetAgentId,
        updatedAtMs: message.tsMs,
        state: message.type === 'handover' ? 'handed_over' : message.type === 'status' ? 'replied' : 'open',
      })
    }
    return {
      workspaceId,
      agentId,
      threads: [...grouped.values()].slice(0, limit ?? 20),
    }
  }
}

async function handleRoleCommand(argv: string[], deps: CliDeps) {
  const [, command] = argv
  const workspaceId = await requireWorkspaceId(argv, deps)
  const commands = createRoleCliCommands(deps)

  if (command === 'list') {
    return wrapOutput(await commands.list({ workspaceId }))
  }

  ensureNoRolePayload(argv)

  if (command === 'create') {
    return wrapOutput(await commands.create({ workspaceId, payload: requireRoleCreatePayload(argv) }))
  }

  if (command === 'update') {
    return wrapOutput(
      await commands.update({
        workspaceId,
        roleId: requireRoleId(argv),
        payload: requireRoleUpdatePayload(argv),
      }),
    )
  }

  if (command === 'delete') {
    return wrapOutput(
      await commands.remove({
        workspaceId,
        roleId: requireRoleId(argv),
        scope: readValidatedStringOption(argv, '--scope', ROLE_SCOPES),
      }),
    )
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${groupAndCommand(argv)}`)
}

function groupAndCommand(argv: string[]) {
  const [group, command] = argv
  return command ? `${group} ${command}` : String(group)
}

async function handleAgentCommand(argv: string[], deps: CliDeps) {
  const normalizedArgv = normalizeAgentArgv(argv)
  const workspaceId = await requireWorkspaceId(normalizedArgv, deps)
  const command = normalizeAgentCommand(argv)
  const commands = createAgentCliCommands(deps)
  const taskCommands = createTaskCliCommands(deps)

  ensureNoLegacyPayload(normalizedArgv)

  if (command === 'list') {
    return wrapOutput(await commands.list({ workspaceId }))
  }

  if (command === 'get') {
    return wrapOutput(await commands.get({ workspaceId, agentId: requireAgentIdForCommand(normalizedArgv) }))
  }

  if (command === 'create') {
    return wrapOutput(await commands.create({ workspaceId, payload: requireAgentCreatePayload(normalizedArgv) }))
  }

  if (command === 'update') {
    return wrapOutput(
      await commands.update({
        workspaceId,
        agentId: requireAgentIdForCommand(normalizedArgv),
        payload: requireAgentUpdatePayload(normalizedArgv),
      }),
    )
  }

  if (command === 'delete') {
    return wrapOutput(await commands.remove({ workspaceId, agentId: requireAgentIdForCommand(normalizedArgv) }))
  }

  if (command === 'prompt-read') {
    return wrapOutput(await commands.promptRead({ workspaceId, agentId: requireAgentIdForCommand(normalizedArgv) }))
  }

  if (command === 'send-task') {
    return wrapOutput(
      await taskCommands.sendTask({
        workspaceId,
        senderAgentId: readCurrentAgentId(normalizedArgv) ?? null,
        targetAgentIds: requireTargetAgentIds(normalizedArgv),
        title: requireTextOption(normalizedArgv, '--title'),
        markdown: requireTextOption(normalizedArgv, '--markdown'),
      }),
    )
  }

  if (command === 'reply-status') {
    return wrapOutput(
      await taskCommands.replyStatus({
        workspaceId,
        senderAgentId: readCurrentAgentId(normalizedArgv) ?? null,
        targetAgentIds: requireTargetAgentIds(normalizedArgv),
        taskId: requireTaskId(normalizedArgv),
        detail: requireTextOption(normalizedArgv, '--detail'),
      }),
    )
  }

  if (command === 'handover') {
    return wrapOutput(
      await taskCommands.handover({
        workspaceId,
        senderAgentId: readCurrentAgentId(normalizedArgv) ?? null,
        targetAgentIds: requireTargetAgentIds(normalizedArgv),
        taskId: requireTaskId(normalizedArgv),
        summary: requireTextOption(normalizedArgv, '--summary'),
        blockers: readRepeatedOption(normalizedArgv, '--blocker'),
        nextSteps: readRepeatedOption(normalizedArgv, '--next-step'),
      }),
    )
  }

  if (command === 'inbox') {
    return wrapOutput(
      await taskCommands.inbox({
        workspaceId,
        agentId: requireCurrentAgentId(normalizedArgv),
        limit: readLimitOption(normalizedArgv),
      }),
    )
  }

  if (command === 'task-thread') {
    return wrapOutput(
      await taskCommands.taskThread({
        workspaceId,
        taskId: requireTaskId(normalizedArgv),
      }),
    )
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${groupAndCommand(argv)}`)
}

async function handleChannelCommand(argv: string[], deps: CliDeps) {
  const [, command] = argv
  const workspaceId = await requireWorkspaceId(argv, deps)
  const commands = createChannelCliCommands(deps)

  if (command === 'list-messages') {
    return wrapOutput(
      await commands.listMessages({
        workspaceId,
        targetAgentId: readStringOption(argv, '--target-agent-id'),
        senderAgentId: readStringOption(argv, '--sender-agent-id'),
        taskId: readStringOption(argv, '--task-id'),
        limit: readLimitOption(argv),
      }),
    )
  }

  if (command === 'send') {
    return wrapOutput(
      await commands.send({
        workspaceId,
        channelKind: requireChannelKind(argv),
        channelId: requireChannelId(argv),
        senderAgentId: readStringOption(argv, '--sender-agent-id'),
        targetAgentIds: readRepeatedOption(argv, '--target-agent-id'),
        messageType: requireMessageType(argv),
        payload: requireRawPayload(argv),
        idempotencyKey: readStringOption(argv, '--idempotency-key'),
      }),
    )
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${groupAndCommand(argv)}`)
}

async function handleDirectoryCommand(argv: string[], deps: CliDeps) {
  const [, command] = argv

  if (command === 'snapshot') {
    const workspaceId = await requireWorkspaceId(argv, deps)
    const commands = createDirectoryCliCommands(deps)
    return wrapOutput(await commands.snapshot({ workspaceId }))
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${groupAndCommand(argv)}`)
}

async function handleTopLevelCommand(argv: string[], deps: CliDeps) {
  const [command] = argv

  if (command === 'agents') {
    const workspaceId = await requireWorkspaceId(argv, deps)
    const directory = await loadWorkspaceDirectory(workspaceId, deps)
    return wrapOutput({ workspaceId, agents: directory.agents ?? [] })
  }

  if (command === 'send') {
    const fromRef = readPositional(argv, 1)
    const toRef = readPositional(argv, 2)
    const text = readPositional(argv, 3)
    if (!fromRef || !toRef || !text) {
      throw new CliError('INVALID_ARGUMENT', 'Usage: gto send <from> <to> <text>')
    }
    const workspaceId = await requireWorkspaceId(argv, deps)
    const directory = await loadWorkspaceDirectory(workspaceId, deps)
    const from = resolveAgentByRef(workspaceId, directory, fromRef)
    const to = resolveAgentByRef(workspaceId, directory, toRef)
    const taskCommands = createTaskCliCommands(deps)
    const channelCommands = createChannelCliCommands(deps)
    const sendResult = await taskCommands.sendTask<{
      batchId?: string
      taskId?: string | null
      targetAgentIds?: string[]
      title?: string
      results?: unknown[]
    }>({
      workspaceId,
      senderAgentId: from.agentId,
      targetAgentIds: [to.agentId],
      title: readStringOption(argv, '--title') ?? summarizeTitle(text),
      markdown: text,
    })
    if (argv.includes('--wait')) {
      const taskId = typeof sendResult.taskId === 'string' ? sendResult.taskId : null
      if (!taskId) {
        throw new CliError('TASK_NOT_FOUND', 'Send result did not include taskId')
      }
      const waited = await waitForReply(taskCommands, channelCommands, workspaceId, taskId, from.agentId, readTimeoutSec(argv))
      return wrapOutput({
        send: sendResult,
        wait: waited,
      })
    }
    return wrapOutput(sendResult)
  }

  if (command === 'inbox') {
    const agentRef = readPositional(argv, 1) ?? readCurrentAgentId(argv)
    if (!agentRef) {
      throw new CliError('INVALID_ARGUMENT', 'Usage: gto inbox <agent>')
    }
    const workspaceId = await requireWorkspaceId(argv, deps)
    const directory = await loadWorkspaceDirectory(workspaceId, deps)
    const agent = resolveAgentByRef(workspaceId, directory, agentRef)
    const taskCommands = createTaskCliCommands(deps)
    const channelCommands = createChannelCliCommands(deps)
    return wrapOutput(await loadInboxThreads(taskCommands, channelCommands, workspaceId, agent.agentId, readLimitOption(argv)))
  }

  if (command === 'thread') {
    const taskId = readPositional(argv, 1)
    if (!taskId) {
      throw new CliError('INVALID_ARGUMENT', 'Usage: gto thread <taskId>')
    }
    const workspaceId = await requireWorkspaceId(argv, deps)
    const taskCommands = createTaskCliCommands(deps)
    const channelCommands = createChannelCliCommands(deps)
    return wrapOutput(await loadTaskThread(taskCommands, channelCommands, workspaceId, taskId))
  }

  if (command === 'wait') {
    const taskId = readPositional(argv, 1)
    const fromRef = readStringOption(argv, '--from') ?? readCurrentAgentId(argv)
    if (!taskId || !fromRef) {
      throw new CliError('INVALID_ARGUMENT', 'Usage: gto wait <taskId> --from <agent>')
    }
    const workspaceId = await requireWorkspaceId(argv, deps)
    const directory = await loadWorkspaceDirectory(workspaceId, deps)
    const from = resolveAgentByRef(workspaceId, directory, fromRef)
    const taskCommands = createTaskCliCommands(deps)
    const channelCommands = createChannelCliCommands(deps)
    return wrapOutput(await waitForReply(taskCommands, channelCommands, workspaceId, taskId, from.agentId, readTimeoutSec(argv)))
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${command}`)
}

function renderSuccess(deps: CliDeps, result: unknown, asJson: boolean) {
  writeOutput(deps, renderOutput(result, asJson))
  return 0
}

function readOption(argv: string[], name: string) {
  const index = argv.indexOf(name)

  if (index === -1) {
    return null
  }

  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    return null
  }

  return value
}

function hasResultEnvelope(value: unknown): value is { ok: boolean } {
  return typeof value === 'object' && value !== null && 'ok' in value
}

function writeOutput(deps: CliDeps, text: string) {
  if (typeof deps.write === 'function') {
    deps.write(text)
    return
  }

  deps.stdout?.write(text)
}

function hasStringProperty(value: unknown, key: 'code' | 'message'): value is Record<typeof key, string> {
  return typeof value === 'object' && value !== null && key in value && typeof value[key] === 'string'
}

function readErrorCode(error: unknown) {
  if (error instanceof CliError) {
    return error.code
  }

  if (hasStringProperty(error, 'code')) {
    return error.code
  }

  return 'CLI_ERROR'
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (hasStringProperty(error, 'message')) {
    return error.message
  }

  return String(error)
}

export function buildCliMetadata() {
  return {
    name: 'gto',
    defaultMode: 'repl',
    supportsJson: true,
  } as const
}

function renderHelpText() {
  return [
    'gto: local GT Office agent CLI',
    '',
    'Top-level commands',
    '  gto agents [--workspace-id <id>] [--json]',
    '  gto send <from> <to> <text> [--workspace-id <id>] [--title <title>] [--wait] [--timeout-sec <seconds>] [--json]',
    '  gto inbox <agent> [--workspace-id <id>] [--limit <n>] [--json]',
    '  gto thread <taskId> [--workspace-id <id>] [--json]',
    '  gto wait <taskId> --from <agent> [--workspace-id <id>] [--timeout-sec <seconds>] [--json]',
    '',
    'Advanced groups',
    '  gto agent ...',
    '  gto role ...',
    '  gto channel ...',
    '  gto directory snapshot ...',
    '',
    'Help',
    '  gto help',
    '  gto --help',
    '  gto -h',
    '  gto -help',
  ].join('\n')
}

export async function runCli(argv: string[], deps: CliDeps = {}) {
  const dispatch = (nextArgv: string[]) => runCli(nextArgv, deps)

  if (argv.length === 0) {
    const repl = deps.repl ?? createRepl({ dispatch })
    return repl.run({ stdin: deps.stdin, stdout: deps.stdout, dispatch })
  }

  const asJson = argv.includes('--json')
  const [group] = argv

  try {
    if (group === 'help' || group === '--help' || group === '-h' || group === '-help') {
      return renderSuccess(deps, renderHelpText(), asJson)
    }

    if (group === 'agent') {
      return renderSuccess(deps, await handleAgentCommand(argv, deps), asJson)
    }

    if (group === 'role') {
      return renderSuccess(deps, await handleRoleCommand(argv, deps), asJson)
    }

    if (group === 'channel') {
      return renderSuccess(deps, await handleChannelCommand(argv, deps), asJson)
    }

    if (group === 'directory') {
      return renderSuccess(deps, await handleDirectoryCommand(argv, deps), asJson)
    }

    if (group === 'agents' || group === 'send' || group === 'inbox' || group === 'thread' || group === 'wait') {
      return renderSuccess(deps, await handleTopLevelCommand(argv, deps), asJson)
    }

    throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${group}`)
  } catch (error) {
    const code = readErrorCode(error)
    const message = readErrorMessage(error)

    writeOutput(deps, renderOutput(errorResult(code, message), asJson))
    return 1
  }
}
