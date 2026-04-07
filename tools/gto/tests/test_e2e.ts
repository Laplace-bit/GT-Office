import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import test from 'node:test'

import packageJson from '../package.json' with { type: 'json' }
import { buildCliMetadata, runCli } from '../src/gt_office_cli.js'

function createWritableCapture(writes: string[]) {
  return new Writable({
    write(chunk, _encoding, callback) {
      writes.push(String(chunk))
      callback()
    },
  })
}

function parseJsonEnvelope(writes: string[]) {
  const parsed = JSON.parse(writes.join(''))
  assert.equal(typeof parsed.traceId, 'string')
  assert.ok(parsed.traceId.length > 0)
  return parsed
}

function assertOkEnvelope(writes: string[], data: unknown) {
  const parsed = parseJsonEnvelope(writes)
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.data, data)
  assert.equal(parsed.error, null)
}

function assertErrorEnvelope(writes: string[], error: { code: string; message: string }) {
  const parsed = parseJsonEnvelope(writes)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.data, null)
  assert.deepEqual(parsed.error, error)
}

test('buildCliMetadata declares gto as the primary user-facing harness', () => {
  assert.deepEqual(buildCliMetadata(), {
    name: 'gto',
    defaultMode: 'repl',
    supportsJson: true,
  })
})

test('runCli supports -help as a help alias', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['-help'], {
    stdout: createWritableCapture(writes),
  })

  assert.equal(exitCode, 0)
  assert.match(writes.join(''), /gto send <from> <to> <text>/)
  assert.match(writes.join(''), /gto -help/)
})

test('bootstrap exports runCli and metadata matches the package contract', () => {
  assert.equal(typeof runCli, 'function')
  assert.deepEqual(buildCliMetadata(), {
    name: 'gto',
    defaultMode: 'repl',
    supportsJson: true,
  })
  assert.deepEqual(packageJson.bin, {
    gto: './bin/gto.mjs',
  })
})

test('runCli handles agent list in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'list', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createAgentCommands() {
      return {
        list: async ({ workspaceId }: { workspaceId: string }) => ({ items: [{ id: 'agent-1', workspaceId }] }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, { items: [{ id: 'agent-1', workspaceId: 'ws-1' }] })
})

test('runCli rejects missing workspace-id values for agent list', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'list', '--workspace-id', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'Option --workspace-id is required',
  })
})

test('runCli preserves machine-readable codes from non-CliError Error instances', async () => {
  const writes: string[] = []
  const error = new Error('Agent not found in bridge response') as Error & { code: string }
  error.code = 'AGENT_NOT_FOUND'

  const exitCode = await runCli(['agent', 'list', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createAgentCommands() {
      return {
        list: async () => {
          throw error
        },
      }
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'AGENT_NOT_FOUND',
    message: 'Agent not found in bridge response',
  })
})

test('runCli preserves machine-readable codes from thrown objects with code and message', async () => {
  const writes: string[] = []

  const exitCode = await runCli(['agent', 'list', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createAgentCommands() {
      return {
        list: async () => {
          throw { code: 'ROLE_IN_USE', message: 'Role is assigned to active agents' }
        },
      }
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'ROLE_IN_USE',
    message: 'Role is assigned to active agents',
  })
})

test('runCli handles agent get in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'get', 'agent-1', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createAgentCommands() {
      return {
        list: async () => ({ items: [] }),
        get: async ({ workspaceId, agentId }: { workspaceId: string; agentId: string }) => ({ id: agentId, workspaceId, name: 'Alpha' }),
        create: async () => ({ ok: true }),
        update: async () => ({ ok: true }),
        remove: async () => ({ ok: true }),
        promptRead: async () => ({ ok: true }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Alpha',
  })
})

test('runCli handles agent create in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['agent', 'create', '--workspace-id', 'ws-1', '--name', 'Alpha', '--role-id', 'role-1', '--tool', 'claude', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createAgentCommands() {
        return {
          list: async () => ({ items: [] }),
          get: async () => ({ ok: true }),
          create: async (params: { workspaceId: string; payload: Record<string, unknown> }) => ({
            agent: { id: 'agent-1', workspaceId: params.workspaceId, ...params.payload },
          }),
          update: async () => ({ ok: true }),
          remove: async () => ({ ok: true }),
          promptRead: async () => ({ ok: true }),
        }
      },
    },
  )

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    agent: {
      id: 'agent-1',
      workspaceId: 'ws-1',
      name: 'Alpha',
      roleId: 'role-1',
      tool: 'claude',
    },
  })
})

test('runCli handles agent update in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['agent', 'update', 'agent-1', '--workspace-id', 'ws-1', '--state', 'paused', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createAgentCommands() {
        return {
          list: async () => ({ items: [] }),
          get: async () => ({ ok: true }),
          create: async () => ({ ok: true }),
          update: async ({ workspaceId, agentId, payload }: { workspaceId: string; agentId: string; payload: Record<string, unknown> }) => ({
            agent: { id: agentId, workspaceId, ...payload },
          }),
          remove: async () => ({ ok: true }),
          promptRead: async () => ({ ok: true }),
        }
      },
    },
  )

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    agent: {
      id: 'agent-1',
      workspaceId: 'ws-1',
      state: 'paused',
    },
  })
})

test('runCli handles agent delete in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'delete', 'agent-1', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createAgentCommands() {
      return {
        list: async () => ({ items: [] }),
        get: async () => ({ ok: true }),
        create: async () => ({ ok: true }),
        update: async () => ({ ok: true }),
        remove: async ({ workspaceId, agentId }: { workspaceId: string; agentId: string }) => ({ deleted: true, workspaceId, agentId }),
        promptRead: async () => ({ ok: true }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    deleted: true,
    workspaceId: 'ws-1',
    agentId: 'agent-1',
  })
})

test('runCli handles agent prompt read in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'prompt', 'read', 'agent-1', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createAgentCommands() {
      return {
        list: async () => ({ items: [] }),
        get: async () => ({ ok: true }),
        create: async () => ({ ok: true }),
        update: async () => ({ ok: true }),
        remove: async () => ({ ok: true }),
        promptRead: async ({ workspaceId, agentId }: { workspaceId: string; agentId: string }) => ({
          workspaceId,
          agentId,
          promptContent: 'Be helpful',
        }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    promptContent: 'Be helpful',
  })
})

test('runCli rejects legacy payload usage for agent commands', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'create', '--workspace-id', 'ws-1', '--payload', '{"name":"Alpha"}', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Agent commands do not accept --payload',
  })
})

test('runCli rejects agent create without required flags', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'create', '--workspace-id', 'ws-1', '--name', 'Alpha', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'Option --role-id is required',
  })
})

test('runCli rejects agent update without any update fields', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'update', 'agent-1', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'At least one agent field must be provided',
  })
})

test('runCli rejects invalid custom-workdir values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'update', 'agent-1', '--workspace-id', 'ws-1', '--custom-workdir=maybe', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --custom-workdir must be true or false',
  })
})

test('runCli rejects invalid agent tool values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'create', '--workspace-id', 'ws-1', '--name', 'Alpha', '--role-id', 'role-1', '--tool', 'foo', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --tool must be one of: claude, codex, gemini',
  })
})

test('runCli rejects invalid agent state values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'update', 'agent-1', '--workspace-id', 'ws-1', '--state', 'sleeping', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --state must be one of: ready, paused, blocked, terminated',
  })
})

test('runCli rejects invalid prompt file names', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'create', '--workspace-id', 'ws-1', '--name', 'Alpha', '--role-id', 'role-1', '--prompt-file-name', 'README.md', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --prompt-file-name must be one of: CLAUDE.md, AGENTS.md, GEMINI.md',
  })
})










test('runCli rejects agent prompt read without an agent id', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'prompt', 'read', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_ARGUMENT',
    message: 'Agent id is required',
  })
})

test('runCli handles role create in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    [
      'role',
      'create',
      '--workspace-id',
      'ws-1',
      '--role-key',
      'planner',
      '--role-name',
      'Planner',
      '--scope',
      'workspace',
      '--json',
    ],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createRoleCommands() {
        return {
          list: async () => ({ roles: [] }),
          create: async ({ workspaceId, payload }: { workspaceId: string; payload: Record<string, unknown> }) => ({
            role: {
              id: 'role-1',
              workspaceId,
              ...payload,
            },
          }),
          update: async () => ({ ok: true }),
          remove: async () => ({ ok: true }),
        }
      },
    },
  )

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    role: {
      id: 'role-1',
      workspaceId: 'ws-1',
      roleKey: 'planner',
      roleName: 'Planner',
      scope: 'workspace',
    },
  })
})

test('runCli handles global role delete in json mode', async () => {
  const writes: string[] = []
  const removeCalls: Array<{ workspaceId: string; roleId: string; scope?: string }> = []
  const exitCode = await runCli(['role', 'delete', 'role-1', '--workspace-id', 'ws-1', '--scope', 'global', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createRoleCommands() {
      return {
        list: async () => ({ roles: [] }),
        create: async () => ({ ok: true }),
        update: async () => ({ ok: true }),
        remove: async (params: { workspaceId: string; roleId: string; scope?: string }) => {
          removeCalls.push(params)
          return { deleted: true, ...params }
        },
      }
    },
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(removeCalls, [{ workspaceId: 'ws-1', roleId: 'role-1', scope: 'global' }])
  assertOkEnvelope(writes, {
    deleted: true,
    workspaceId: 'ws-1',
    roleId: 'role-1',
    scope: 'global',
  })
})

test('runCli rejects legacy payload usage for role commands', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['role', 'create', '--workspace-id', 'ws-1', '--payload', '{"roleName":"Planner"}', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Role commands do not accept --payload',
  })
})

test('runCli rejects role create without required flags', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['role', 'create', '--workspace-id', 'ws-1', '--role-name', 'Planner', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'Option --role-key is required',
  })
})

test('runCli rejects invalid role scope values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['role', 'create', '--workspace-id', 'ws-1', '--role-key', 'planner', '--role-name', 'Planner', '--scope', 'team', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --scope must be one of: workspace, global',
  })
})

test('runCli rejects invalid role status values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['role', 'update', 'role-1', '--workspace-id', 'ws-1', '--status', 'archived', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --status must be one of: active, deprecated, disabled',
  })
})










test('runCli rejects role update without any update fields', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['role', 'update', 'role-1', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'At least one role field must be provided',
  })
})

test('runCli handles role update with positional role id in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['role', 'update', 'role-1', '--workspace-id', 'ws-1', '--role-name', 'Planner Plus', '--status', 'active', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createRoleCommands() {
      return {
        list: async () => ({ roles: [] }),
        create: async () => ({ ok: true }),
        update: async ({ workspaceId, roleId, payload }: { workspaceId: string; roleId: string; payload: Record<string, unknown> }) => ({
          role: {
            id: roleId,
            workspaceId,
            ...payload,
          },
        }),
        remove: async () => ({ ok: true }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    role: {
      id: 'role-1',
      workspaceId: 'ws-1',
      roleName: 'Planner Plus',
      status: 'active',
    },
  })
})

test('runCli rejects role update without a role id', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['role', 'update', '--workspace-id', 'ws-1', '--role-name', 'Planner Plus', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'Option --role-id is required',
  })
})

test('runCli handles channel send in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    [
      'channel',
      'send',
      '--workspace-id',
      'ws-1',
      '--channel-kind',
      'direct',
      '--channel-id',
      'channel-1',
      '--sender-agent-id',
      'agent-0',
      '--target-agent-id',
      'agent-1',
      '--target-agent-id',
      'agent-2',
      '--message-type',
      'status',
      '--payload',
      '{"text":"hello","count":1}',
      '--idempotency-key',
      'key-1',
      '--json',
    ],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createChannelBackend() {
        return {
          publish: async ({ workspaceId, channel, senderAgentId, targetAgentIds, type, payload, idempotencyKey }: {
            workspaceId: string
            channel: { kind: string; id: string }
            senderAgentId: string | null
            targetAgentIds: string[]
            type: string
            payload: unknown
            idempotencyKey: string | null
          }) => ({
            messageId: 'message-1',
            workspaceId,
            channel,
            senderAgentId,
            targetAgentIds,
            type,
            payload,
            idempotencyKey,
          }),
          listMessages: async () => ({ messages: [] }),
        }
      },
    },
  )

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    messageId: 'message-1',
    workspaceId: 'ws-1',
    channel: {
      kind: 'direct',
      id: 'channel-1',
    },
    senderAgentId: 'agent-0',
    targetAgentIds: ['agent-1', 'agent-2'],
    type: 'status',
    payload: {
      text: 'hello',
      count: 1,
    },
    idempotencyKey: 'key-1',
  })
})

test('runCli handles channel list-messages in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['channel', 'list-messages', '--workspace-id', 'ws-1', '--target-agent-id', 'agent-1', '--sender-agent-id', 'agent-0', '--task-id', 'task-1', '--limit', '5', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createChannelBackend() {
        return {
          publish: async () => ({ messageId: 'message-1' }),
          listMessages: async ({ workspaceId, targetAgentId, senderAgentId, taskId, limit }: {
            workspaceId: string
            targetAgentId?: string
            senderAgentId?: string
            taskId?: string
            limit?: number
          }) => ({
            workspaceId,
            targetAgentId,
            senderAgentId,
            taskId,
            limit,
            messages: [{ id: 'message-1' }],
          }),
        }
      },
    },
  )

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    targetAgentId: 'agent-1',
    senderAgentId: 'agent-0',
    taskId: 'task-1',
    limit: 5,
    messages: [
      {
        id: 'message-1',
      },
    ],
  })
})

test('runCli rejects channel send without message type', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['channel', 'send', '--workspace-id', 'ws-1', '--channel-kind', 'direct', '--channel-id', 'channel-1', '--payload', '{"text":"hello"}', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'Option --message-type is required',
  })
})

test('runCli supports multiple channel target-agent-id values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['channel', 'send', '--workspace-id', 'ws-1', '--channel-kind', 'group', '--channel-id', 'channel-1', '--target-agent-id', 'agent-1', '--target-agent-id', 'agent-2', '--message-type', 'handover', '--payload', '{"text":"hello"}', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createChannelCommands() {
        return {
          send: async (params: Record<string, unknown>) => ({ targetAgentIds: params.targetAgentIds }),
          listMessages: async () => ({ messages: [] }),
        }
      },
    },
  )

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    targetAgentIds: ['agent-1', 'agent-2'],
  })
})

test('runCli handles agent send-task in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['agent', 'send-task', '--workspace-id', 'ws-1', '--target-agent-id', 'agent-1', '--title', 'Need review', '--markdown', 'Please review the latest diff.', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createTaskCommands() {
        return {
          sendTask: async (params: Record<string, unknown>) => ({
            taskId: 'task-1',
            targetAgentIds: params.targetAgentIds,
            title: params.title,
          }),
          replyStatus: async () => ({ ok: true }),
          handover: async () => ({ ok: true }),
          inbox: async () => ({ threads: [] }),
          taskThread: async () => ({ summary: { taskId: 'task-1' }, messages: [] }),
        }
      },
    },
  )

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    taskId: 'task-1',
    targetAgentIds: ['agent-1'],
    title: 'Need review',
  })
})

test('runCli requires task id for agent reply-status', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['agent', 'reply-status', '--workspace-id', 'ws-1', '--target-agent-id', 'manager', '--detail', 'done', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
    },
  )

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'MISSING_REQUIRED_OPTION',
    message: 'Option --task-id is required',
  })
})

test('runCli fails agent reply-status when the target did not accept delivery', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['agent', 'reply-status', '--workspace-id', 'ws-1', '--target-agent-id', 'manager', '--task-id', 'task-1', '--detail', 'done', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createTaskBackend() {
        return {
          dispatchBatch: async () => ({ batchId: 'batch-1', results: [] }),
          publish: async () => ({
            messageId: 'msg-1',
            acceptedTargets: [],
            failedTargets: [{ agentId: 'manager', reason: 'AGENT_OFFLINE' }],
          }),
          listThreads: async () => ({ threads: [] }),
          getThread: async () => ({ thread: null }),
        }
      },
    },
  )

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'CHANNEL_DELIVERY_FAILED',
    message: 'AGENT_OFFLINE',
  })
})

test('runCli fails agent handover when the target did not accept delivery', async () => {
  const writes: string[] = []
  const exitCode = await runCli(
    ['agent', 'handover', '--workspace-id', 'ws-1', '--target-agent-id', 'manager', '--task-id', 'task-1', '--summary', 'done', '--json'],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        },
      },
      createTaskBackend() {
        return {
          dispatchBatch: async () => ({ batchId: 'batch-1', results: [] }),
          publish: async () => ({
            messageId: 'msg-1',
            acceptedTargets: [],
            failedTargets: [{ agentId: 'manager', reason: 'AGENT_OFFLINE' }],
          }),
          listThreads: async () => ({ threads: [] }),
          getThread: async () => ({ thread: null }),
        }
      },
    },
  )

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'CHANNEL_DELIVERY_FAILED',
    message: 'AGENT_OFFLINE',
  })
})

test('runCli handles agent inbox in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'inbox', '--workspace-id', 'ws-1', '--agent-id', 'agent-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({ taskId: 'task-1' }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async ({ workspaceId, agentId }: { workspaceId: string; agentId: string }) => ({
          workspaceId,
          agentId,
          threads: [{ taskId: 'task-1', state: 'open' }],
        }),
        taskThread: async () => ({ summary: { taskId: 'task-1' }, messages: [] }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    threads: [{ taskId: 'task-1', state: 'open' }],
  })
})

test('runCli handles agent task-thread in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agent', 'task-thread', '--workspace-id', 'ws-1', '--task-id', 'task-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({ taskId: 'task-1' }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async () => ({ threads: [] }),
        taskThread: async ({ workspaceId, taskId }: { workspaceId: string; taskId: string }) => ({
          workspaceId,
          summary: { taskId, state: 'replied' },
          messages: [{ messageId: 'msg-1', payload: { taskId } }],
        }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    summary: { taskId: 'task-1', state: 'replied' },
    messages: [{ messageId: 'msg-1', payload: { taskId: 'task-1' } }],
  })
})

test('runCli rejects invalid channel kind values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['channel', 'send', '--workspace-id', 'ws-1', '--channel-kind', 'fanout', '--channel-id', 'channel-1', '--message-type', 'status', '--payload', '{"text":"hello"}', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --channel-kind must be one of: direct, group, broadcast',
  })
})

test('runCli rejects invalid message type values', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['channel', 'send', '--workspace-id', 'ws-1', '--channel-kind', 'direct', '--channel-id', 'channel-1', '--message-type', 'ping', '--payload', '{"text":"hello"}', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  assertErrorEnvelope(writes, {
    code: 'INVALID_ARGUMENT',
    message: 'Option --message-type must be one of: task_instruction, status, handover',
  })
})
test('runCli handles directory snapshot in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['directory', 'snapshot', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryBackend() {
      return {
        snapshot: async ({ workspaceId }: { workspaceId: string }) => ({
          workspaceId,
          agents: [{ id: 'agent-1' }],
        }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    agents: [
      {
        id: 'agent-1',
      },
    ],
  })
})

test('runCli handles top-level agents command in json mode', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['agents', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryCommands() {
      return {
        snapshot: async ({ workspaceId }: { workspaceId: string }) => ({
          workspaceId,
          agents: [{ agentId: 'agent-1', name: 'Alpha' }],
        }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    agents: [{ agentId: 'agent-1', name: 'Alpha' }],
  })
})

test('runCli handles top-level send by agent names', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['send', 'Alpha', 'Beta', '你好', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryCommands() {
      return {
        snapshot: async () => ({
          workspaceId: 'ws-1',
          agents: [
            { agentId: 'agent-a', name: 'Alpha' },
            { agentId: 'agent-b', name: 'Beta' },
          ],
        }),
      }
    },
    createTaskCommands() {
      return {
        sendTask: async (params: Record<string, unknown>) => ({
          taskId: 'task-1',
          senderAgentId: params.senderAgentId,
          targetAgentIds: params.targetAgentIds,
          markdown: params.markdown,
        }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async () => ({ threads: [] }),
        taskThread: async () => ({ thread: null }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    taskId: 'task-1',
    senderAgentId: 'agent-a',
    targetAgentIds: ['agent-b'],
    markdown: '你好',
  })
})

test('runCli supports top-level send with wait for reply', async () => {
  const writes: string[] = []
  let taskThreadCalls = 0
  const exitCode = await runCli(['send', 'Alpha', 'Beta', '你好', '--workspace-id', 'ws-1', '--wait', '--timeout-sec', '1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryCommands() {
      return {
        snapshot: async () => ({
          workspaceId: 'ws-1',
          agents: [
            { agentId: 'agent-a', name: 'Alpha' },
            { agentId: 'agent-b', name: 'Beta' },
          ],
        }),
      }
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({
          taskId: 'task-1',
          batchId: 'batch-1',
        }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async () => ({ threads: [] }),
        taskThread: async () => {
          taskThreadCalls += 1
          if (taskThreadCalls === 1) {
            return {
              thread: {
                summary: { taskId: 'task-1', state: 'open' },
                messages: [{ messageId: 'm1', senderAgentId: 'agent-a', type: 'task_instruction' }],
              },
            }
          }
          return {
            thread: {
              summary: { taskId: 'task-1', state: 'replied' },
              messages: [
                { messageId: 'm1', senderAgentId: 'agent-a', type: 'task_instruction' },
                { messageId: 'm2', senderAgentId: 'agent-b', type: 'status', payload: { taskId: 'task-1', detail: 'ok' } },
              ],
            },
          }
        },
      }
    },
  })

  assert.equal(exitCode, 0)
  const parsed = parseJsonEnvelope(writes)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.send.taskId, 'task-1')
  assert.equal(parsed.data.wait.reply.messageId, 'm2')
})

test('runCli supports top-level wait when task-thread uses the legacy flat response shape', async () => {
  const writes: string[] = []
  let taskThreadCalls = 0
  const exitCode = await runCli(['wait', 'task-legacy', '--from', 'Alpha', '--workspace-id', 'ws-1', '--timeout-sec', '1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryCommands() {
      return {
        snapshot: async () => ({
          workspaceId: 'ws-1',
          agents: [
            { agentId: 'agent-a', name: 'Alpha' },
            { agentId: 'agent-b', name: 'Beta' },
          ],
        }),
      }
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({ taskId: 'task-legacy' }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async () => ({ threads: [] }),
        taskThread: async () => {
          taskThreadCalls += 1
          if (taskThreadCalls === 1) {
            return {
              summary: { taskId: 'task-legacy', state: 'open' },
              messages: [{ messageId: 'm1', senderAgentId: 'agent-a', type: 'task_instruction' }],
            }
          }
          return {
            summary: { taskId: 'task-legacy', state: 'replied' },
            messages: [
              { messageId: 'm1', senderAgentId: 'agent-a', type: 'task_instruction' },
              { messageId: 'm2', senderAgentId: 'agent-b', type: 'status', payload: { taskId: 'task-legacy', detail: 'ok' } },
            ],
          }
        },
      }
    },
  })

  assert.equal(exitCode, 0)
  const parsed = parseJsonEnvelope(writes)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.reply.messageId, 'm2')
})

test('runCli wait prefers the thread root sender over a mismatched --from value', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['wait', 'task-root-sender', '--from', 'Beta', '--workspace-id', 'ws-1', '--timeout-sec', '1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryCommands() {
      return {
        snapshot: async () => ({
          workspaceId: 'ws-1',
          agents: [
            { agentId: 'agent-a', name: 'Alpha' },
            { agentId: 'agent-b', name: 'Beta' },
          ],
        }),
      }
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({ taskId: 'task-root-sender' }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async () => ({ threads: [] }),
        taskThread: async () => ({
          thread: {
            summary: { taskId: 'task-root-sender', state: 'replied' },
            messages: [
              {
                messageId: 'm1',
                senderAgentId: 'agent-a',
                type: 'task_instruction',
                payload: {
                  taskId: 'task-root-sender',
                  sender: { agentId: 'agent-a', type: 'agent' },
                },
              },
              {
                messageId: 'm2',
                senderAgentId: 'agent-b',
                type: 'status',
                payload: { taskId: 'task-root-sender', detail: 'ok' },
              },
            ],
          },
        }),
      }
    },
  })

  assert.equal(exitCode, 0)
  const parsed = parseJsonEnvelope(writes)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.reply.messageId, 'm2')
})

test('runCli returns interaction_required when waiting task exposes an interaction prompt', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['send', 'Alpha', 'Beta', '你好', '--workspace-id', 'ws-1', '--wait', '--timeout-sec', '1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryCommands() {
      return {
        snapshot: async () => ({
          workspaceId: 'ws-1',
          agents: [
            { agentId: 'agent-a', name: 'Alpha' },
            { agentId: 'agent-b', name: 'Beta' },
          ],
        }),
      }
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({
          taskId: 'task-2',
          batchId: 'batch-2',
        }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async () => ({ threads: [] }),
        taskThread: async () => ({
          thread: {
            summary: { taskId: 'task-2', state: 'open' },
            messages: [{ messageId: 'm1', senderAgentId: 'agent-a', type: 'task_instruction' }],
          },
          waitState: {
            kind: 'interaction_required',
            taskId: 'task-2',
            targetAgentId: 'agent-b',
            prompt: {
              kind: 'permission',
              title: 'Allow this action?',
              options: ['Yes', 'No'],
            },
          },
        }),
      }
    },
  })

  assert.equal(exitCode, 0)
  const parsed = parseJsonEnvelope(writes)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.send.taskId, 'task-2')
  assert.equal(parsed.data.wait.interactionRequired.kind, 'interaction_required')
  assert.equal(parsed.data.wait.interactionRequired.targetAgentId, 'agent-b')
})

test('runCli handles top-level inbox with agent name', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['inbox', 'Alpha', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createDirectoryCommands() {
      return {
        snapshot: async () => ({
          workspaceId: 'ws-1',
          agents: [{ agentId: 'agent-a', name: 'Alpha' }],
        }),
      }
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({ taskId: 'task-1' }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async ({ workspaceId, agentId }: { workspaceId: string; agentId: string }) => ({
          workspaceId,
          agentId,
          threads: [{ taskId: 'task-1' }],
        }),
        taskThread: async () => ({ thread: null }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    agentId: 'agent-a',
    threads: [{ taskId: 'task-1' }],
  })
})

test('runCli handles top-level thread command', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['thread', 'task-1', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createTaskCommands() {
      return {
        sendTask: async () => ({ taskId: 'task-1' }),
        replyStatus: async () => ({ ok: true }),
        handover: async () => ({ ok: true }),
        inbox: async () => ({ threads: [] }),
        taskThread: async ({ workspaceId, taskId }: { workspaceId: string; taskId: string }) => ({
          workspaceId,
          thread: { summary: { taskId }, messages: [] },
        }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assertOkEnvelope(writes, {
    workspaceId: 'ws-1',
    thread: { summary: { taskId: 'task-1' }, messages: [] },
    waitState: null,
  })
})

test('runCli injects a default bridge into backend factories', async () => {
  const writes: string[] = []
  let capturedBridge: { request: unknown } | undefined

  const exitCode = await runCli(['agent', 'list', '--workspace-id', 'ws-1', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
    createAgentBackend(bridge: unknown) {
      capturedBridge = bridge as { request: unknown }
      return {
        list: async () => ({ items: [{ id: 'agent-1' }] }),
      }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(typeof capturedBridge?.request, 'function')
  assertOkEnvelope(writes, {
    items: [
      {
        id: 'agent-1',
      },
    ],
  })
})

test('runCli enters the real REPL and exits on quit', async () => {
  const writes: string[] = []
  const stdin = Readable.from(['quit\n'])
  const stdout = createWritableCapture(writes)

  const exitCode = await runCli([], {
    stdin,
    stdout,
  } as never)

  assert.equal(exitCode, 0)
  assert.ok(writes.some((chunk) => chunk.includes('GTO CLI\n')))
  assert.ok(writes.some((chunk) => chunk.includes('gto> ')))
})

test('real REPL uses the shared dispatcher for commands', async () => {
  const writes: string[] = []
  const stdin = Readable.from(['agent list --workspace-id ws-1\n', 'quit\n'])
  const stdout = createWritableCapture(writes)

  const exitCode = await runCli([], {
    stdin,
    stdout,
    createAgentCommands() {
      return {
        list: async ({ workspaceId }: { workspaceId: string }) => ({ items: [{ id: 'agent-1', workspaceId }] }),
      }
    },
  } as never)

  assert.equal(exitCode, 0)
  assert.ok(writes.some((chunk) => chunk.includes('GTO CLI\n')))
  assert.ok(writes.some((chunk) => chunk.includes('agent-1')))
})

test('real REPL handles help before quit', async () => {
  const writes: string[] = []
  const stdin = Readable.from(['help\n', 'quit\n'])
  const stdout = createWritableCapture(writes)

  const exitCode = await runCli([], {
    stdin,
    stdout,
  } as never)

  assert.equal(exitCode, 0)
  assert.ok(writes.some((chunk) => chunk.includes('Commands: agent, role, channel, directory, help, exit, quit\n')))
})
