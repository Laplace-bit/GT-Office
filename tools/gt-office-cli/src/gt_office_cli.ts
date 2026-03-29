import { createAgentBackend } from './adapters/agent_backend.js'
import { createDefaultBridgeClient } from './adapters/bridge_client.js'
import { createChannelBackend } from './adapters/channel_backend.js'
import { createDirectoryBackend } from './adapters/directory_backend.js'
import { createAgentCommands } from './commands/agent.js'
import { createChannelCommands } from './commands/channel.js'
import { createDirectoryCommands } from './commands/directory.js'
import { createRoleCommands } from './commands/role.js'
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
  bridge?: unknown
  createAgentBackend?: (bridge: unknown) => unknown
  createChannelBackend?: (bridge: unknown) => unknown
  createDirectoryBackend?: (bridge: unknown) => unknown
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
  createRoleCommands?: (backend: unknown) => {
    list(params: { workspaceId: string }): Promise<unknown>
    create(params: { workspaceId: string; payload: unknown }): Promise<unknown>
    update(params: { workspaceId: string; roleId: string; payload: Record<string, unknown> }): Promise<unknown>
    remove(params: { workspaceId: string; roleId: string; scope?: string }): Promise<unknown>
  }
  repl?: ReplLike
}

function requireWorkspaceId(argv: string[]) {
  const workspaceId = readOption(argv, '--workspace-id')

  if (!workspaceId) {
    throw new CliError('MISSING_REQUIRED_OPTION', 'Option --workspace-id is required')
  }

  return workspaceId
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

async function handleRoleCommand(argv: string[], deps: CliDeps) {
  const [, command] = argv
  const workspaceId = requireWorkspaceId(argv)
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
  const workspaceId = requireWorkspaceId(normalizedArgv)
  const command = normalizeAgentCommand(argv)
  const commands = createAgentCliCommands(deps)

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

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${groupAndCommand(argv)}`)
}

async function handleChannelCommand(argv: string[], deps: CliDeps) {
  const [, command] = argv
  const workspaceId = requireWorkspaceId(argv)
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
    const workspaceId = requireWorkspaceId(argv)
    const commands = createDirectoryCliCommands(deps)
    return wrapOutput(await commands.snapshot({ workspaceId }))
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${groupAndCommand(argv)}`)
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
    name: 'gt-office-cli',
    defaultMode: 'repl',
    supportsJson: true,
  } as const
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

    throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${group}`)
  } catch (error) {
    const code = readErrorCode(error)
    const message = readErrorMessage(error)

    writeOutput(deps, renderOutput(errorResult(code, message), asJson))
    return 1
  }
}
