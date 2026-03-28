import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentBackend } from '../src/adapters/agent_backend.js'
import { createBridgeClient, createDefaultBridgeClient } from '../src/adapters/bridge_client.js'
import { createChannelBackend } from '../src/adapters/channel_backend.js'
import { createDirectoryBackend } from '../src/adapters/directory_backend.js'
import { createAgentCommands } from '../src/commands/agent.js'
import { createChannelCommands } from '../src/commands/channel.js'
import { createDirectoryCommands } from '../src/commands/directory.js'
import { createRoleCommands } from '../src/commands/role.js'
import { runCli } from '../src/gt_office_cli.js'
import { splitCommandLine } from '../src/core/argv.js'
import { CliError, parseJsonOption } from '../src/core/errors.js'
import { renderAgentList, renderMessageList, renderOutput, renderRoleList } from '../src/core/output.js'
import { okResult, errorResult } from '../src/core/result.js'
import { createFakeBridge } from './helpers/fakes.js'

test('okResult wraps data in the stable success envelope', () => {
  const result = okResult({ id: 'agent-1' })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, { id: 'agent-1' })
  assert.equal(result.error, null)
  assert.equal(typeof result.traceId, 'string')
  assert.ok(result.traceId.length > 0)
})

test('errorResult wraps code and message in the stable failure envelope', () => {
  const result = errorResult('INVALID_JSON', 'Option --payload must be valid JSON')

  assert.equal(result.ok, false)
  assert.equal(result.data, null)
  assert.deepEqual(result.error, {
    code: 'INVALID_JSON',
    message: 'Option --payload must be valid JSON',
  })
  assert.equal(typeof result.traceId, 'string')
  assert.ok(result.traceId.length > 0)
})

test('CliError stores code and message for CLI-layer failures', () => {
  const error = new CliError('MISSING_REQUIRED_OPTION', 'Option --workspace-id is required')

  assert.equal(error.name, 'CliError')
  assert.equal(error.code, 'MISSING_REQUIRED_OPTION')
  assert.equal(error.message, 'Option --workspace-id is required')
})

test('parseJsonOption returns parsed JSON values', () => {
  const validJson = '{"task_id":"task-1","ok":true}'

  assert.deepEqual(parseJsonOption(validJson), {
    task_id: 'task-1',
    ok: true,
  })
})

test('parseJsonOption throws INVALID_JSON when JSON parsing fails', () => {
  assert.throws(
    () => parseJsonOption('{bad json]'),
    (error) => {
      assert.ok(error instanceof CliError)
      assert.equal(error.code, 'INVALID_JSON')
      assert.equal(error.message, 'Option must be valid JSON')
      return true
    },
  )
})

test('splitCommandLine preserves quoted JSON with spaces', () => {
  assert.deepEqual(
    splitCommandLine('channel send --payload "{\\"message\\":\\"hello world\\",\\"count\\":1}" --json'),
    [
      'channel',
      'send',
      '--payload',
      '{"message":"hello world","count":1}',
      '--json',
    ],
  )
})

test('splitCommandLine preserves single-quoted JSON with embedded double quotes', () => {
  assert.deepEqual(
    splitCommandLine("channel send --payload '{\"message\":\"hello world\",\"count\":1}' --json"),
    [
      'channel',
      'send',
      '--payload',
      '{"message":"hello world","count":1}',
      '--json',
    ],
  )
})

test('splitCommandLine preserves backslashes inside quoted JSON payloads', () => {
  assert.deepEqual(
    splitCommandLine(String.raw`channel send --payload '{"path":"C:\\Users\\dzlin"}' --json`),
    [
      'channel',
      'send',
      '--payload',
      '{"path":"C:\\\\Users\\\\dzlin"}',
      '--json',
    ],
  )
})

test('parseJsonOption accepts JSON with escaped backslashes after splitting', () => {
  const [, , , payload] = splitCommandLine(
    String.raw`channel send --payload '{"path":"C:\\Users\\dzlin"}' --json`,
  )

  assert.deepEqual(parseJsonOption(payload), {
    path: 'C:\\Users\\dzlin',
  })
})

test('renderOutput returns pretty JSON with trailing newline in json mode', () => {
  const output = renderOutput(okResult({ id: 'agent-1' }), true)
  const parsed = JSON.parse(output)

  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.data, { id: 'agent-1' })
  assert.equal(parsed.error, null)
  assert.equal(typeof parsed.traceId, 'string')
})

test('renderOutput returns String(result) with trailing newline in human mode', () => {
  assert.equal(
    renderOutput('Agent not found', false),
    'Agent not found\n',
  )
})

test('renderOutput stringifies non-string primitive results in human mode', () => {
  assert.equal(renderOutput(42, false), '42\n')
})

test('renderOutput prints error messages in human mode', () => {
  assert.equal(renderOutput(errorResult('AGENT_NOT_FOUND', 'Agent not found'), false), 'Agent not found\n')
})

test('renderAgentList prints the approved columns', () => {
  assert.equal(
    renderAgentList([
      {
        id: 'a1',
        name: 'Alpha',
        roleId: 'r1',
        tool: 'claude',
        state: 'ready',
        workdir: '.gtoffice/alpha',
      },
    ]),
    'Alpha / a1 / r1 / claude / ready / .gtoffice/alpha',
  )
})

test('renderRoleList prints the approved columns', () => {
  assert.equal(
    renderRoleList([
      {
        roleName: 'Planner',
        roleKey: 'planner',
        scope: 'workspace',
        status: 'active',
      },
    ]),
    'Planner / planner / workspace / active',
  )
})

test('renderMessageList prints the approved columns', () => {
  assert.equal(
    renderMessageList([
      {
        tsMs: 1,
        senderAgentId: 'agent-0',
        targetAgentId: 'agent-1',
        type: 'status',
        payload: { taskId: 'task-1' },
      },
    ]),
    '1 / agent-0 / agent-1 / status / task-1',
  )
})

test('renderOutput renders agent lists in human mode', () => {
  assert.equal(
    renderOutput(okResult({ agents: [{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }] }), false),
    'Alpha / a1 / r1 / claude / ready / .gtoffice/alpha\n',
  )
})

test('renderOutput renders role lists in human mode', () => {
  assert.equal(
    renderOutput(okResult({ roles: [{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: 'active' }] }), false),
    'Planner / planner / workspace / active\n',
  )
})

test('renderOutput renders message lists in human mode', () => {
  assert.equal(
    renderOutput(okResult({ messages: [{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }] }), false),
    '1 / agent-0 / agent-1 / status / task-1\n',
  )
})


test('renderOutput falls back to pretty JSON for non-list objects in human mode', () => {
  assert.equal(
    renderOutput(okResult({ agent: { id: 'a1', name: 'Alpha' } }), false),
    '{\n  "agent": {\n    "id": "a1",\n    "name": "Alpha"\n  }\n}\n',
  )
})


test('renderOutput falls back to line rendering for arrays in human mode', () => {
  assert.equal(renderOutput(['a', 'b'], false), 'a\nb\n')
})


test('renderOutput leaves blank line for empty human-readable list results', () => {
  assert.equal(renderOutput(okResult({ agents: [] }), false), '\n')
})


test('renderOutput keeps raw objects readable in human mode', () => {
  assert.equal(renderOutput({ id: 'a1', name: 'Alpha' }, false), '{\n  "id": "a1",\n  "name": "Alpha"\n}\n')
})


test('renderOutput handles null values in list rows cleanly', () => {
  assert.equal(
    renderAgentList([{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: null, state: 'ready', workdir: null }]),
    'Alpha / a1 / r1 /  / ready / ',
  )
})


test('renderOutput uses items as an agent list fallback in human mode', () => {
  assert.equal(
    renderOutput(okResult({ items: [{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }] }), false),
    'Alpha / a1 / r1 / claude / ready / .gtoffice/alpha\n',
  )
})


test('renderMessageList accepts alternate timestamp and routing keys', () => {
  assert.equal(
    renderMessageList([
      {
        timestamp: '2026-03-29T00:00:00Z',
        from: 'agent-0',
        to: 'agent-1',
        type: 'handover',
        payload: { taskId: 'task-2' },
      },
    ]),
    '2026-03-29T00:00:00Z / agent-0 / agent-1 / handover / task-2',
  )
})


test('renderMessageList leaves task id blank when payload is absent', () => {
  assert.equal(
    renderMessageList([
      {
        tsMs: 1,
        senderAgentId: 'agent-0',
        targetAgentId: 'agent-1',
        type: 'status',
      },
    ]),
    '1 / agent-0 / agent-1 / status / ',
  )
})


test('renderRoleList leaves optional columns blank when absent', () => {
  assert.equal(
    renderRoleList([{ roleName: 'Planner', roleKey: 'planner' }]),
    'Planner / planner /  / ',
  )
})


test('renderOutput preserves false booleans in fallback JSON mode', () => {
  assert.equal(renderOutput(okResult({ flag: false }), false), '{\n  "flag": false\n}\n')
})


test('renderOutput preserves zero numbers in fallback JSON mode', () => {
  assert.equal(renderOutput(okResult({ count: 0 }), false), '{\n  "count": 0\n}\n')
})


test('renderOutput stringifies nested arrays in direct array mode', () => {
  assert.equal(renderOutput([[1], [2]], false), '[1]\n[2]\n')
})


test('renderOutput stringifies booleans in direct array mode', () => {
  assert.equal(renderOutput([true, false], false), 'true\nfalse\n')
})


test('renderOutput keeps undefined list columns empty', () => {
  assert.equal(
    renderAgentList([{ id: 'a1', name: 'Alpha', roleId: 'r1', state: 'ready' }]),
    'Alpha / a1 / r1 /  / ready / ',
  )
})


test('renderOutput keeps null role status empty', () => {
  assert.equal(
    renderRoleList([{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: null }]),
    'Planner / planner / workspace / ',
  )
})


test('renderOutput keeps null message routing empty', () => {
  assert.equal(
    renderMessageList([{ tsMs: 1, senderAgentId: null, targetAgentId: null, type: 'status', payload: { taskId: 'task-1' } }]),
    '1 /  /  / status / task-1',
  )
})


test('renderOutput falls back to pretty JSON for success envelopes with scalar data', () => {
  assert.equal(renderOutput(okResult('done'), false), 'done\n')
})


test('renderOutput preserves plain object booleans in fallback JSON', () => {
  assert.equal(renderOutput({ ok: true, value: false }, false), '{\n  "ok": true,\n  "value": false\n}\n')
})


test('renderOutput preserves plain object numbers in fallback JSON', () => {
  assert.equal(renderOutput({ ok: true, value: 0 }, false), '{\n  "ok": true,\n  "value": 0\n}\n')
})


test('renderOutput handles null input directly', () => {
  assert.equal(renderOutput(null, false), 'null\n')
})


test('renderOutput handles boolean input directly', () => {
  assert.equal(renderOutput(true, false), 'true\n')
})


test('renderOutput handles object arrays in direct array mode', () => {
  assert.equal(renderOutput([{ id: 'a1' }, { id: 'a2' }], false), '{"id":"a1"}\n{"id":"a2"}\n')
})


test('renderOutput handles mixed arrays in direct array mode', () => {
  assert.equal(renderOutput(['a', { id: 'a1' }, 3], false), 'a\n{"id":"a1"}\n3\n')
})


test('renderOutput falls back to pretty JSON for message envelope metadata', () => {
  assert.equal(
    renderOutput(okResult({ messageId: 'm1', channel: { kind: 'direct', id: 'c1' } }), false),
    '{\n  "messageId": "m1",\n  "channel": {\n    "kind": "direct",\n    "id": "c1"\n  }\n}\n',
  )
})


test('renderOutput renders directory snapshots via the agent list formatter', () => {
  assert.equal(
    renderOutput(okResult({ workspaceId: 'ws-1', agents: [{ id: 'a1' }] }), false),
    ' / a1 /  /  /  / \n',
  )
})


test('renderOutput uses agent renderer for bare agent collections', () => {
  assert.equal(
    renderOutput({ agents: [{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }] }, false),
    'Alpha / a1 / r1 / claude / ready / .gtoffice/alpha\n',
  )
})


test('renderOutput uses role renderer for bare role collections', () => {
  assert.equal(
    renderOutput({ roles: [{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: 'active' }] }, false),
    'Planner / planner / workspace / active\n',
  )
})


test('renderOutput uses message renderer for bare message collections', () => {
  assert.equal(
    renderOutput({ messages: [{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }] }, false),
    '1 / agent-0 / agent-1 / status / task-1\n',
  )
})


test('renderOutput leaves unknown empty objects as pretty JSON', () => {
  assert.equal(renderOutput({}, false), '{}\n')
})


test('renderOutput leaves success envelopes with empty objects readable', () => {
  assert.equal(renderOutput(okResult({}), false), '{}\n')
})


test('renderOutput keeps empty arrays empty in human mode', () => {
  assert.equal(renderOutput([], false), '\n')
})


test('renderOutput keeps agent list order stable', () => {
  assert.equal(
    renderAgentList([
      { id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' },
      { id: 'a2', name: 'Beta', roleId: 'r2', tool: 'gemini', state: 'paused', workdir: '.gtoffice/beta' },
    ]),
    'Alpha / a1 / r1 / claude / ready / .gtoffice/alpha\nBeta / a2 / r2 / gemini / paused / .gtoffice/beta',
  )
})


test('renderRoleList keeps role order stable', () => {
  assert.equal(
    renderRoleList([
      { roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: 'active' },
      { roleName: 'Reviewer', roleKey: 'reviewer', scope: 'global', status: 'deprecated' },
    ]),
    'Planner / planner / workspace / active\nReviewer / reviewer / global / deprecated',
  )
})


test('renderMessageList keeps message order stable', () => {
  assert.equal(
    renderMessageList([
      { tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } },
      { tsMs: 2, senderAgentId: 'agent-1', targetAgentId: 'agent-2', type: 'handover', payload: { taskId: 'task-2' } },
    ]),
    '1 / agent-0 / agent-1 / status / task-1\n2 / agent-1 / agent-2 / handover / task-2',
  )
})


test('renderOutput preserves direct object strings in fallback JSON', () => {
  assert.equal(renderOutput({ id: 'a1', name: 'Alpha', note: 'ready' }, false), '{\n  "id": "a1",\n  "name": "Alpha",\n  "note": "ready"\n}\n')
})


test('renderOutput handles empty string input directly', () => {
  assert.equal(renderOutput('', false), '\n')
})


test('renderOutput handles direct undefined array values', () => {
  assert.equal(renderOutput([undefined], false), '\n')
})


test('renderOutput handles nested payload objects in message rows', () => {
  assert.equal(
    renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1', extra: { ok: true } } }]),
    '1 / agent-0 / agent-1 / status / task-1',
  )
})


test('renderOutput handles bare success booleans directly', () => {
  assert.equal(renderOutput(okResult(true), false), 'true\n')
})


test('renderOutput handles bare success numbers directly', () => {
  assert.equal(renderOutput(okResult(3), false), '3\n')
})


test('renderOutput handles bare success arrays directly', () => {
  assert.equal(renderOutput(okResult(['a', 'b']), false), 'a\nb\n')
})


test('renderOutput handles channel message lists with createdAt fallback', () => {
  assert.equal(
    renderMessageList([{ createdAt: 't1', senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]),
    't1 / agent-0 / agent-1 / status / task-1',
  )
})


test('renderOutput handles empty role list results', () => {
  assert.equal(renderOutput(okResult({ roles: [] }), false), '\n')
})


test('renderOutput handles empty message list results', () => {
  assert.equal(renderOutput(okResult({ messages: [] }), false), '\n')
})


test('renderOutput does not special-case unknown ok-shaped plain objects', () => {
  assert.equal(renderOutput({ ok: 'yes' }, false), '{\n  "ok": "yes"\n}\n')
})


test('renderOutput handles false scalar success envelopes directly', () => {
  assert.equal(renderOutput(okResult(false), false), 'false\n')
})


test('renderOutput handles zero scalar success envelopes directly', () => {
  assert.equal(renderOutput(okResult(0), false), '0\n')
})


test('renderOutput handles null scalar success envelopes directly', () => {
  assert.equal(renderOutput(okResult(null), false), 'null\n')
})


test('renderOutput handles message rows with plain payload strings', () => {
  assert.equal(
    renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: 'plain' }]),
    '1 / agent-0 / agent-1 / status / ',
  )
})


test('renderOutput handles agent rows with numeric ids', () => {
  assert.equal(
    renderAgentList([{ id: 1, name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]),
    'Alpha / 1 / r1 / claude / ready / .gtoffice/alpha',
  )
})


test('renderOutput handles role rows with numeric keys', () => {
  assert.equal(
    renderRoleList([{ roleName: 'Planner', roleKey: 1, scope: 'workspace', status: 'active' }]),
    'Planner / 1 / workspace / active',
  )
})


test('renderOutput handles message rows with numeric task ids', () => {
  assert.equal(
    renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 1 } }]),
    '1 / agent-0 / agent-1 / status / 1',
  )
})


test('renderOutput keeps fallback JSON indentation stable', () => {
  assert.equal(renderOutput({ nested: { value: 1 } }, false), '{\n  "nested": {\n    "value": 1\n  }\n}\n')
})


test('renderOutput keeps direct array object stringification compact', () => {
  assert.equal(renderOutput([{ nested: { value: 1 } }], false), '{"nested":{"value":1}}\n')
})


test('renderOutput handles undefined direct input', () => {
  assert.equal(renderOutput(undefined, false), 'undefined\n')
})


test('renderOutput handles success envelope with undefined data', () => {
  assert.equal(renderOutput(okResult(undefined), false), 'undefined\n')
})


test('renderOutput keeps agent list spacing stable', () => {
  assert.equal(renderAgentList([{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]).includes(' / '), true)
})


test('renderOutput keeps role list spacing stable', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: 'active' }]).includes(' / '), true)
})


test('renderOutput keeps message list spacing stable', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]).includes(' / '), true)
})


test('renderOutput handles empty payload objects in message rows', () => {
  assert.equal(
    renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: {} }]),
    '1 / agent-0 / agent-1 / status / ',
  )
})


test('renderOutput handles missing payload objects in message rows', () => {
  assert.equal(
    renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status' }]),
    '1 / agent-0 / agent-1 / status / ',
  )
})


test('renderOutput handles whitespace strings directly', () => {
  assert.equal(renderOutput(' ', false), ' \n')
})


test('renderOutput handles success envelope with empty string data', () => {
  assert.equal(renderOutput(okResult(''), false), '\n')
})


test('renderOutput handles success envelope with object array data', () => {
  assert.equal(renderOutput(okResult([{ id: 'a1' }]), false), '{"id":"a1"}\n')
})


test('renderOutput handles success envelope with mixed array data', () => {
  assert.equal(renderOutput(okResult(['a', { id: 'a1' }, 3]), false), 'a\n{"id":"a1"}\n3\n')
})


test('renderOutput handles fallback JSON arrays in object values', () => {
  assert.equal(renderOutput({ values: [1, 2] }, false), '{\n  "values": [\n    1,\n    2\n  ]\n}\n')
})


test('renderOutput handles message rows with boolean task ids', () => {
  assert.equal(
    renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: false } }]),
    '1 / agent-0 / agent-1 / status / false',
  )
})


test('renderOutput handles agent rows with boolean states', () => {
  assert.equal(
    renderAgentList([{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: false, workdir: '.gtoffice/alpha' }]),
    'Alpha / a1 / r1 / claude / false / .gtoffice/alpha',
  )
})


test('renderOutput handles role rows with boolean statuses', () => {
  assert.equal(
    renderRoleList([{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: false }]),
    'Planner / planner / workspace / false',
  )
})


test('renderOutput handles success envelope with nested list object fallback', () => {
  assert.equal(
    renderOutput(okResult({ nested: { agents: [] } }), false),
    '{\n  "nested": {\n    "agents": []\n  }\n}\n',
  )
})


test('renderOutput handles non-ok error-like objects as JSON', () => {
  assert.equal(renderOutput({ error: { message: 'x' } }, false), '{\n  "error": {\n    "message": "x"\n  }\n}\n')
})


test('renderOutput handles role rows with null names', () => {
  assert.equal(
    renderRoleList([{ roleName: null, roleKey: 'planner', scope: 'workspace', status: 'active' }]),
    ' / planner / workspace / active',
  )
})


test('renderOutput handles agent rows with null names', () => {
  assert.equal(
    renderAgentList([{ id: 'a1', name: null, roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]),
    ' / a1 / r1 / claude / ready / .gtoffice/alpha',
  )
})


test('renderOutput handles message rows with null timestamps', () => {
  assert.equal(
    renderMessageList([{ tsMs: null, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]),
    ' / agent-0 / agent-1 / status / task-1',
  )
})


test('renderOutput handles success envelope with bare object array containing nulls', () => {
  assert.equal(renderOutput(okResult([null, { id: 'a1' }]), false), '\n{"id":"a1"}\n')
})


test('renderOutput handles bare arrays containing nulls', () => {
  assert.equal(renderOutput([null, { id: 'a1' }], false), '\n{"id":"a1"}\n')
})


test('renderOutput handles fallback JSON for nested booleans and zeros', () => {
  assert.equal(renderOutput({ nested: { ok: false, count: 0 } }, false), '{\n  "nested": {\n    "ok": false,\n    "count": 0\n  }\n}\n')
})


test('renderOutput keeps scalar false direct output exact', () => {
  assert.equal(renderOutput(false, false), 'false\n')
})


test('renderOutput keeps scalar zero direct output exact', () => {
  assert.equal(renderOutput(0, false), '0\n')
})


test('renderOutput handles message rows with missing routing keys entirely', () => {
  assert.equal(renderMessageList([{ type: 'status', payload: { taskId: 'task-1' } }]), ' /  /  / status / task-1')
})


test('renderOutput handles agent rows with missing core keys entirely', () => {
  assert.equal(renderAgentList([{}]), ' /  /  /  /  / ')
})


test('renderOutput handles role rows with missing core keys entirely', () => {
  assert.equal(renderRoleList([{}]), ' /  /  / ')
})


test('renderOutput handles message rows with missing core keys entirely', () => {
  assert.equal(renderMessageList([{}]), ' /  /  /  / ')
})


test('renderOutput handles nested plain object arrays compactly', () => {
  assert.equal(renderOutput([[{ id: 'a1' }]], false), '[{"id":"a1"}]\n')
})


test('renderOutput preserves human fallback for plain strings inside success envelopes', () => {
  assert.equal(renderOutput(okResult('Agent not found'), false), 'Agent not found\n')
})


test('renderOutput preserves human fallback for plain numbers inside success envelopes', () => {
  assert.equal(renderOutput(okResult(42), false), '42\n')
})


test('renderOutput preserves human fallback for plain booleans inside success envelopes', () => {
  assert.equal(renderOutput(okResult(true), false), 'true\n')
})


test('renderOutput preserves human fallback for plain null inside success envelopes', () => {
  assert.equal(renderOutput(okResult(null), false), 'null\n')
})


test('renderOutput preserves human fallback for plain undefined inside success envelopes', () => {
  assert.equal(renderOutput(okResult(undefined), false), 'undefined\n')
})


test('renderOutput preserves compact object stringification in direct array success envelopes', () => {
  assert.equal(renderOutput(okResult([{ id: 'a1' }, { id: 'a2' }]), false), '{"id":"a1"}\n{"id":"a2"}\n')
})


test('renderOutput preserves compact object stringification in direct arrays', () => {
  assert.equal(renderOutput([{ id: 'a1' }, { id: 'a2' }], false), '{"id":"a1"}\n{"id":"a2"}\n')
})


test('renderOutput handles plain object arrays with booleans and zeros compactly', () => {
  assert.equal(renderOutput([{ ok: false, count: 0 }], false), '{"ok":false,"count":0}\n')
})


test('renderOutput handles success envelope plain object arrays with booleans and zeros compactly', () => {
  assert.equal(renderOutput(okResult([{ ok: false, count: 0 }]), false), '{"ok":false,"count":0}\n')
})


test('renderOutput handles empty strings in list fields', () => {
  assert.equal(renderAgentList([{ id: '', name: '', roleId: '', tool: '', state: '', workdir: '' }]), ' /  /  /  /  / ')
})


test('renderOutput handles role empty strings in list fields', () => {
  assert.equal(renderRoleList([{ roleName: '', roleKey: '', scope: '', status: '' }]), ' /  /  / ')
})


test('renderOutput handles message empty strings in list fields', () => {
  assert.equal(renderMessageList([{ tsMs: '', senderAgentId: '', targetAgentId: '', type: '', payload: { taskId: '' } }]), ' /  /  /  / ')
})


test('renderOutput handles nested arrays in fallback JSON pretty mode', () => {
  assert.equal(renderOutput({ nested: [[1]] }, false), '{\n  "nested": [\n    [\n      1\n    ]\n  ]\n}\n')
})


test('renderOutput keeps pretty JSON for unknown metadata objects', () => {
  assert.equal(renderOutput(okResult({ workspaceId: 'ws-1', targetAgentId: 'agent-1', senderAgentId: 'agent-0', taskId: 'task-1', limit: 5, extra: true }), false), '{\n  "workspaceId": "ws-1",\n  "targetAgentId": "agent-1",\n  "senderAgentId": "agent-0",\n  "taskId": "task-1",\n  "limit": 5,\n  "extra": true\n}\n')
})


test('renderOutput keeps pretty JSON for role mutation results', () => {
  assert.equal(renderOutput(okResult({ role: { id: 'r1', roleName: 'Planner' } }), false), '{\n  "role": {\n    "id": "r1",\n    "roleName": "Planner"\n  }\n}\n')
})


test('renderOutput keeps pretty JSON for agent mutation results', () => {
  assert.equal(renderOutput(okResult({ agent: { id: 'a1', name: 'Alpha' } }), false), '{\n  "agent": {\n    "id": "a1",\n    "name": "Alpha"\n  }\n}\n')
})


test('renderOutput keeps pretty JSON for channel mutation results', () => {
  assert.equal(renderOutput(okResult({ messageId: 'm1' }), false), '{\n  "messageId": "m1"\n}\n')
})


test('renderOutput renders empty directory snapshots as an empty line', () => {
  assert.equal(renderOutput(okResult({ workspaceId: 'ws-1', agents: [], source: 'bridge' }), false), '\n')
})


test('renderOutput leaves whitespace-only list fields intact as strings', () => {
  assert.equal(renderAgentList([{ id: ' ', name: ' ', roleId: ' ', tool: ' ', state: ' ', workdir: ' ' }]), '  /   /   /   /   /  ')
})


test('renderOutput handles message rows with payload taskId nested null', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: null } }]), '1 / agent-0 / agent-1 / status / ')
})


test('renderOutput handles message rows with payload taskId nested zero', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 0 } }]), '1 / agent-0 / agent-1 / status / 0')
})


test('renderOutput handles message rows with payload taskId nested false', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: false } }]), '1 / agent-0 / agent-1 / status / false')
})


test('renderOutput handles success envelope with empty array data', () => {
  assert.equal(renderOutput(okResult([]), false), '\n')
})


test('renderOutput handles direct empty array data', () => {
  assert.equal(renderOutput([], false), '\n')
})


test('renderOutput handles direct empty object data', () => {
  assert.equal(renderOutput({}, false), '{}\n')
})


test('renderOutput handles success envelope with empty object data', () => {
  assert.equal(renderOutput(okResult({}), false), '{}\n')
})


test('renderOutput handles role rows with numeric status', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: 1 }]), 'Planner / planner / workspace / 1')
})


test('renderOutput handles agent rows with numeric tool', () => {
  assert.equal(renderAgentList([{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 1, state: 'ready', workdir: '.gtoffice/alpha' }]), 'Alpha / a1 / r1 / 1 / ready / .gtoffice/alpha')
})


test('renderOutput handles message rows with numeric type', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 1, payload: { taskId: 'task-1' } }]), '1 / agent-0 / agent-1 / 1 / task-1')
})


test('renderOutput handles arrays of arrays inside success envelopes compactly', () => {
  assert.equal(renderOutput(okResult([[1], [2]]), false), '[1]\n[2]\n')
})


test('renderOutput handles arrays of arrays directly compactly', () => {
  assert.equal(renderOutput([[1], [2]], false), '[1]\n[2]\n')
})


test('renderOutput handles direct NaN numbers by string conversion', () => {
  assert.equal(renderOutput(Number.NaN, false), 'NaN\n')
})


test('renderOutput handles success envelope NaN numbers by string conversion', () => {
  assert.equal(renderOutput(okResult(Number.NaN), false), 'NaN\n')
})


test('renderOutput handles Infinity numbers by string conversion', () => {
  assert.equal(renderOutput(Number.POSITIVE_INFINITY, false), 'Infinity\n')
})


test('renderOutput handles success envelope Infinity numbers by string conversion', () => {
  assert.equal(renderOutput(okResult(Number.POSITIVE_INFINITY), false), 'Infinity\n')
})


test('renderOutput handles negative zero numbers by string conversion', () => {
  assert.equal(renderOutput(-0, false), '0\n')
})


test('renderOutput handles success envelope negative zero numbers by string conversion', () => {
  assert.equal(renderOutput(okResult(-0), false), '0\n')
})


test('renderOutput handles direct symbol values by string conversion', () => {
  assert.equal(renderOutput(Symbol.for('x'), false), 'Symbol(x)\n')
})


test('renderOutput handles success envelope symbol values by string conversion', () => {
  assert.equal(renderOutput(okResult(Symbol.for('x')), false), 'Symbol(x)\n')
})


test('renderOutput handles direct bigint values by string conversion', () => {
  assert.equal(renderOutput(1n, false), '1\n')
})


test('renderOutput handles success envelope bigint values by string conversion', () => {
  assert.equal(renderOutput(okResult(1n), false), '1\n')
})


test('renderOutput handles list field bigint values by string conversion', () => {
  assert.equal(renderAgentList([{ id: 1n, name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]), 'Alpha / 1 / r1 / claude / ready / .gtoffice/alpha')
})


test('renderOutput handles message payload taskId bigint values by string conversion', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 1n } }]), '1 / agent-0 / agent-1 / status / 1')
})


test('renderOutput handles role field bigint values by string conversion', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: 1n, scope: 'workspace', status: 'active' }]), 'Planner / 1 / workspace / active')
})


test('renderOutput keeps fallback JSON for success envelopes with nested arrays of objects', () => {
  assert.equal(renderOutput(okResult({ nested: [{ id: 'a1' }] }), false), '{\n  "nested": [\n    {\n      "id": "a1"\n    }\n  ]\n}\n')
})


test('renderOutput keeps fallback JSON for plain objects with nested arrays of objects', () => {
  assert.equal(renderOutput({ nested: [{ id: 'a1' }] }, false), '{\n  "nested": [\n    {\n      "id": "a1"\n    }\n  ]\n}\n')
})


test('renderOutput handles empty string task ids as blank', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: '' } }]), '1 / agent-0 / agent-1 / status / ')
})


test('renderOutput handles empty string timestamps as blank', () => {
  assert.equal(renderMessageList([{ tsMs: '', senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]), ' / agent-0 / agent-1 / status / task-1')
})


test('renderOutput handles empty string names as blank', () => {
  assert.equal(renderAgentList([{ id: 'a1', name: '', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]), ' / a1 / r1 / claude / ready / .gtoffice/alpha')
})


test('renderOutput handles empty string role names as blank', () => {
  assert.equal(renderRoleList([{ roleName: '', roleKey: 'planner', scope: 'workspace', status: 'active' }]), ' / planner / workspace / active')
})


test('renderOutput handles plain object arrays with nulls compactly', () => {
  assert.equal(renderOutput([{ id: 'a1' }, null], false), '{"id":"a1"}\n\n')
})


test('renderOutput handles success envelope plain object arrays with nulls compactly', () => {
  assert.equal(renderOutput(okResult([{ id: 'a1' }, null]), false), '{"id":"a1"}\n\n')
})


test('renderOutput keeps direct string arrays exact', () => {
  assert.equal(renderOutput(['hello', 'world'], false), 'hello\nworld\n')
})


test('renderOutput keeps success string arrays exact', () => {
  assert.equal(renderOutput(okResult(['hello', 'world']), false), 'hello\nworld\n')
})


test('renderOutput keeps direct numeric arrays exact', () => {
  assert.equal(renderOutput([1, 2], false), '1\n2\n')
})


test('renderOutput keeps success numeric arrays exact', () => {
  assert.equal(renderOutput(okResult([1, 2]), false), '1\n2\n')
})


test('renderOutput keeps direct boolean arrays exact', () => {
  assert.equal(renderOutput([true, false], false), 'true\nfalse\n')
})


test('renderOutput keeps success boolean arrays exact', () => {
  assert.equal(renderOutput(okResult([true, false]), false), 'true\nfalse\n')
})


test('renderOutput keeps direct mixed arrays exact', () => {
  assert.equal(renderOutput(['x', 1, true], false), 'x\n1\ntrue\n')
})


test('renderOutput keeps success mixed arrays exact', () => {
  assert.equal(renderOutput(okResult(['x', 1, true]), false), 'x\n1\ntrue\n')
})


test('renderOutput handles unknown scalar-like plain objects via JSON', () => {
  assert.equal(renderOutput({ value: 'x' }, false), '{\n  "value": "x"\n}\n')
})


test('renderOutput handles unknown scalar-like success objects via JSON', () => {
  assert.equal(renderOutput(okResult({ value: 'x' }), false), '{\n  "value": "x"\n}\n')
})


test('renderOutput handles undefined task ids in message rows as blank', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: undefined } }]), '1 / agent-0 / agent-1 / status / ')
})


test('renderOutput handles success envelope with explicit error-like fields in data as JSON', () => {
  assert.equal(renderOutput(okResult({ error: { code: 'X' } }), false), '{\n  "error": {\n    "code": "X"\n  }\n}\n')
})


test('renderOutput handles plain object with ok false but missing error object as JSON', () => {
  assert.equal(renderOutput({ ok: false }, false), '{\n  "ok": false\n}\n')
})


test('renderOutput handles plain object with ok true but missing data as JSON', () => {
  assert.equal(renderOutput({ ok: true }, false), '{\n  "ok": true\n}\n')
})


test('renderOutput handles array entries with symbols by string conversion', () => {
  assert.equal(renderOutput([Symbol.for('x')], false), 'Symbol(x)\n')
})


test('renderOutput handles success array entries with symbols by string conversion', () => {
  assert.equal(renderOutput(okResult([Symbol.for('x')]), false), 'Symbol(x)\n')
})


test('renderOutput handles array entries with bigints by string conversion', () => {
  assert.equal(renderOutput([1n], false), '1\n')
})


test('renderOutput handles success array entries with bigints by string conversion', () => {
  assert.equal(renderOutput(okResult([1n]), false), '1\n')
})


test('renderOutput handles plain object values with undefined by JSON omission', () => {
  assert.equal(renderOutput({ value: undefined, keep: 1 }, false), '{\n  "keep": 1\n}\n')
})


test('renderOutput handles success object values with undefined by JSON omission', () => {
  assert.equal(renderOutput(okResult({ value: undefined, keep: 1 }), false), '{\n  "keep": 1\n}\n')
})


test('renderOutput handles success envelope with array of nulls', () => {
  assert.equal(renderOutput(okResult([null, null]), false), '\n\n')
})


test('renderOutput handles direct array of nulls', () => {
  assert.equal(renderOutput([null, null], false), '\n\n')
})


test('renderOutput handles role list rows with object values via JSON stringification', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: { id: 1 }, scope: 'workspace', status: 'active' }]), 'Planner / {"id":1} / workspace / active')
})


test('renderOutput handles agent list rows with object values via JSON stringification', () => {
  assert.equal(renderAgentList([{ id: 'a1', name: 'Alpha', roleId: { id: 1 }, tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]), 'Alpha / a1 / {"id":1} / claude / ready / .gtoffice/alpha')
})


test('renderOutput handles message list type objects via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: { id: 1 }, payload: { taskId: 'task-1' } }]), '1 / agent-0 / agent-1 / {"id":1} / task-1')
})


test('renderOutput handles message list task id objects via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: { id: 1 } } }]), '1 / agent-0 / agent-1 / status / {"id":1}')
})


test('renderOutput handles success object arrays with nested arrays compactly', () => {
  assert.equal(renderOutput(okResult([{ values: [1, 2] }]), false), '{"values":[1,2]}\n')
})


test('renderOutput handles plain object arrays with nested arrays compactly', () => {
  assert.equal(renderOutput([{ values: [1, 2] }], false), '{"values":[1,2]}\n')
})


test('renderOutput handles plain object arrays with nested objects compactly', () => {
  assert.equal(renderOutput([{ nested: { ok: true } }], false), '{"nested":{"ok":true}}\n')
})


test('renderOutput handles success object arrays with nested objects compactly', () => {
  assert.equal(renderOutput(okResult([{ nested: { ok: true } }]), false), '{"nested":{"ok":true}}\n')
})


test('renderOutput handles empty objects in plain object arrays compactly', () => {
  assert.equal(renderOutput([{}], false), '{}\n')
})


test('renderOutput handles empty objects in success object arrays compactly', () => {
  assert.equal(renderOutput(okResult([{}]), false), '{}\n')
})


test('renderOutput handles list rows with symbol values by string conversion', () => {
  assert.equal(renderAgentList([{ id: Symbol.for('x'), name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]), 'Alpha / Symbol(x) / r1 / claude / ready / .gtoffice/alpha')
})


test('renderOutput handles role rows with symbol values by string conversion', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: Symbol.for('x'), scope: 'workspace', status: 'active' }]), 'Planner / Symbol(x) / workspace / active')
})


test('renderOutput handles message rows with symbol task ids by string conversion', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: Symbol.for('x') } }]), '1 / agent-0 / agent-1 / status / Symbol(x)')
})


test('renderOutput handles undefined direct arrays compactly with multiple items', () => {
  assert.equal(renderOutput([undefined, undefined], false), '\n\n')
})


test('renderOutput handles undefined success arrays compactly with multiple items', () => {
  assert.equal(renderOutput(okResult([undefined, undefined]), false), '\n\n')
})


test('renderOutput handles date-like strings unchanged', () => {
  assert.equal(renderMessageList([{ tsMs: '2026-03-29', senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]), '2026-03-29 / agent-0 / agent-1 / status / task-1')
})


test('renderOutput handles role rows with object statuses via JSON stringification', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: { active: true } }]), 'Planner / planner / workspace / {"active":true}')
})


test('renderOutput handles agent rows with object states via JSON stringification', () => {
  assert.equal(renderAgentList([{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: { ready: true }, workdir: '.gtoffice/alpha' }]), 'Alpha / a1 / r1 / claude / {"ready":true} / .gtoffice/alpha')
})


test('renderOutput handles message rows with object timestamps via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: { value: 1 }, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]), '{"value":1} / agent-0 / agent-1 / status / task-1')
})


test('renderOutput handles message rows with object routing via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: { id: 1 }, targetAgentId: { id: 2 }, type: 'status', payload: { taskId: 'task-1' } }]), '1 / {"id":1} / {"id":2} / status / task-1')
})


test('renderOutput keeps fallback JSON for success envelopes with role collections plus metadata', () => {
  assert.equal(renderOutput(okResult({ roles: [], total: 0 }), false), '\n')
})


test('renderOutput keeps fallback JSON for success envelopes with message collections plus metadata', () => {
  assert.equal(renderOutput(okResult({ messages: [], total: 0 }), false), '\n')
})


test('renderOutput keeps fallback JSON for success envelopes with items plus metadata', () => {
  assert.equal(renderOutput(okResult({ items: [], total: 0 }), false), '\n')
})


test('renderOutput handles plain object list collections plus metadata by choosing the collection', () => {
  assert.equal(renderOutput({ agents: [], total: 0 }, false), '\n')
})


test('renderOutput handles plain role collections plus metadata by choosing the collection', () => {
  assert.equal(renderOutput({ roles: [], total: 0 }, false), '\n')
})


test('renderOutput handles plain message collections plus metadata by choosing the collection', () => {
  assert.equal(renderOutput({ messages: [], total: 0 }, false), '\n')
})


test('renderOutput handles plain item collections plus metadata by choosing the collection', () => {
  assert.equal(renderOutput({ items: [], total: 0 }, false), '\n')
})


test('renderOutput handles empty-string error messages in human mode', () => {
  assert.equal(renderOutput(errorResult('X', ''), false), '\n')
})


test('renderOutput handles nested payload task ids that are arrays via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: [1,2] } }]), '1 / agent-0 / agent-1 / status / [1,2]')
})


test('renderOutput handles nested payload task ids that are nested objects via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: { nested: true } } }]), '1 / agent-0 / agent-1 / status / {"nested":true}')
})


test('renderOutput handles plain objects with arrays of scalars by pretty JSON', () => {
  assert.equal(renderOutput({ values: ['a', 'b'] }, false), '{\n  "values": [\n    "a",\n    "b"\n  ]\n}\n')
})


test('renderOutput handles success objects with arrays of scalars by pretty JSON', () => {
  assert.equal(renderOutput(okResult({ values: ['a', 'b'] }), false), '{\n  "values": [\n    "a",\n    "b"\n  ]\n}\n')
})


test('renderOutput handles array entries with functions by string conversion', () => {
  assert.equal(renderOutput([function x() {}], false).includes('function x'), true)
})


test('renderOutput handles success array entries with functions by string conversion', () => {
  assert.equal(renderOutput(okResult([function x() {}]), false).includes('function x'), true)
})


test('renderOutput handles direct function input by string conversion', () => {
  assert.equal(renderOutput(function x() {}, false).includes('function x'), true)
})


test('renderOutput handles success function input by string conversion', () => {
  assert.equal(renderOutput(okResult(function x() {}), false).includes('function x'), true)
})


test('renderOutput handles list rows with function values by string conversion', () => {
  assert.equal(renderAgentList([{ id: function x() {}, name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]).includes('function x'), true)
})


test('renderOutput handles role rows with function values by string conversion', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: function x() {}, scope: 'workspace', status: 'active' }]).includes('function x'), true)
})


test('renderOutput handles message rows with function values by string conversion', () => {
  assert.equal(renderMessageList([{ tsMs: function x() {}, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]).includes('function x'), true)
})


test('renderOutput handles function task ids by string conversion', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: function x() {} } }]).includes('function x'), true)
})


test('renderOutput handles plain functions in object fallback by string conversion wrapper', () => {
  assert.equal(renderOutput({ fn: function x() {} }, false), '{}\n')
})


test('renderOutput handles success functions in object fallback by string conversion wrapper', () => {
  assert.equal(renderOutput(okResult({ fn: function x() {} }), false), '{}\n')
})


test('renderOutput handles direct functions in arrays mixed with objects', () => {
  const text = renderOutput([function x() {}, { id: 'a1' }], false)
  assert.equal(text.includes('function x'), true)
  assert.equal(text.includes('{"id":"a1"}'), true)
})


test('renderOutput handles success functions in arrays mixed with objects', () => {
  const text = renderOutput(okResult([function x() {}, { id: 'a1' }]), false)
  assert.equal(text.includes('function x'), true)
  assert.equal(text.includes('{"id":"a1"}'), true)
})


test('renderOutput handles object rows with nested arrays in role renderer via JSON stringification', () => {
  assert.equal(renderRoleList([{ roleName: 'Planner', roleKey: ['a'], scope: 'workspace', status: 'active' }]), 'Planner / ["a"] / workspace / active')
})


test('renderOutput handles object rows with nested arrays in agent renderer via JSON stringification', () => {
  assert.equal(renderAgentList([{ id: 'a1', name: 'Alpha', roleId: ['a'], tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]), 'Alpha / a1 / ["a"] / claude / ready / .gtoffice/alpha')
})


test('renderOutput handles object rows with nested arrays in message renderer via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: [1], senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]), '[1] / agent-0 / agent-1 / status / task-1')
})


test('renderOutput handles nested arrays in task ids via JSON stringification', () => {
  assert.equal(renderMessageList([{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: ['a'] } }]), '1 / agent-0 / agent-1 / status / ["a"]')
})


test('renderOutput handles empty direct arrays with sparse values', () => {
  const text = renderOutput(Array(2), false)
  assert.equal(text, '\n\n')
})


test('renderOutput handles empty success arrays with sparse values', () => {
  const text = renderOutput(okResult(Array(2)), false)
  assert.equal(text, '\n\n')
})


test('renderOutput handles direct object arrays with sparse values', () => {
  const text = renderOutput([, { id: 'a1' }], false)
  assert.equal(text, '\n{"id":"a1"}\n')
})


test('renderOutput handles success object arrays with sparse values', () => {
  const text = renderOutput(okResult([, { id: 'a1' }]), false)
  assert.equal(text, '\n{"id":"a1"}\n')
})


test('renderOutput keeps human mode deterministic for same input', () => {
  const input = okResult({ agents: [{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }] })
  assert.equal(renderOutput(input, false), renderOutput(input, false))
})


test('renderOutput keeps JSON mode deterministic for same input', () => {
  const input = okResult({ agents: [{ id: 'a1', name: 'Alpha' }] })
  assert.equal(renderOutput(input, true), renderOutput(input, true))
})


test('renderOutput keeps agent renderer deterministic for same input', () => {
  const input = [{ id: 'a1', name: 'Alpha', roleId: 'r1', tool: 'claude', state: 'ready', workdir: '.gtoffice/alpha' }]
  assert.equal(renderAgentList(input), renderAgentList(input))
})


test('renderOutput keeps role renderer deterministic for same input', () => {
  const input = [{ roleName: 'Planner', roleKey: 'planner', scope: 'workspace', status: 'active' }]
  assert.equal(renderRoleList(input), renderRoleList(input))
})


test('renderOutput keeps message renderer deterministic for same input', () => {
  const input = [{ tsMs: 1, senderAgentId: 'agent-0', targetAgentId: 'agent-1', type: 'status', payload: { taskId: 'task-1' } }]
  assert.equal(renderMessageList(input), renderMessageList(input))
})

test('createAgentBackend().list() calls the bridge with agent.list and workspaceId', async () => {
  const calls: Array<{ method: string; params: unknown }> = []
  const bridge = {
    request: async <T>(method: string, params: unknown) => {
      calls.push({ method, params })
      return { items: [{ id: 'agent-1' }] } as T
    },
  }

  const backend = createAgentBackend(bridge)
  const result = await backend.list({ workspaceId: 'ws-1' })

  assert.deepEqual(calls, [{ method: 'agent.list', params: { workspaceId: 'ws-1' } }])
  assert.deepEqual(result, { items: [{ id: 'agent-1' }] })
})

test('createAgentBackend forwards the rest of the agent and role methods to the bridge', async () => {
  const calls: Array<{ method: string; params: unknown }> = []
  const bridge = {
    request: async <T>(method: string, params: unknown) => {
      calls.push({ method, params })
      return { method, params } as T
    },
  }

  const backend = createAgentBackend(bridge)

  await backend.roleList({ workspaceId: 'ws-1' })
  await backend.create({ workspaceId: 'ws-1', payload: { name: 'Agent One' } })
  await backend.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Agent Prime' } })
  await backend.delete({ workspaceId: 'ws-1', agentId: 'agent-1' })
  await backend.promptRead({ workspaceId: 'ws-1', agentId: 'agent-1' })
  await backend.roleSave({ workspaceId: 'ws-1', roleId: 'role-1', roleKey: 'planner', roleName: 'Planner' })
  await backend.roleDelete({ workspaceId: 'ws-1', roleId: 'role-1', scope: 'global' })

  assert.deepEqual(calls, [
    { method: 'agent.role_list', params: { workspaceId: 'ws-1' } },
    { method: 'agent.create', params: { workspaceId: 'ws-1', payload: { name: 'Agent One' } } },
    { method: 'agent.update', params: { workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Agent Prime' } } },
    { method: 'agent.delete', params: { workspaceId: 'ws-1', agentId: 'agent-1' } },
    { method: 'agent.prompt_read', params: { workspaceId: 'ws-1', agentId: 'agent-1' } },
    { method: 'agent.role_save', params: { workspaceId: 'ws-1', roleId: 'role-1', roleKey: 'planner', roleName: 'Planner' } },
    { method: 'agent.role_delete', params: { workspaceId: 'ws-1', roleId: 'role-1', scope: 'global' } },
  ])
})

test('createChannelBackend forwards channel calls to the bridge', async () => {
  const calls: Array<{ method: string; params: unknown }> = []
  const bridge = {
    request: async <T>(method: string, params: unknown) => {
      calls.push({ method, params })
      return { method, params } as T
    },
  }

  const backend = createChannelBackend(bridge)

  await backend.publish({
    workspaceId: 'ws-1',
    channel: { kind: 'direct', id: 'channel-1' },
    senderAgentId: 'agent-0',
    targetAgentIds: ['agent-1', 'agent-2'],
    type: 'status',
    payload: { text: 'hello' },
    idempotencyKey: 'key-1',
  })
  await backend.listMessages({ workspaceId: 'ws-1', targetAgentId: 'agent-1', senderAgentId: 'agent-0', taskId: 'task-1', limit: 20 })

  assert.deepEqual(calls, [
    {
      method: 'channel.publish',
      params: {
        workspaceId: 'ws-1',
        channel: { kind: 'direct', id: 'channel-1' },
        senderAgentId: 'agent-0',
        targetAgentIds: ['agent-1', 'agent-2'],
        type: 'status',
        payload: { text: 'hello' },
        idempotencyKey: 'key-1',
      },
    },
    {
      method: 'channel.list_messages',
      params: { workspaceId: 'ws-1', targetAgentId: 'agent-1', senderAgentId: 'agent-0', taskId: 'task-1', limit: 20 },
    },
  ])
})

test('createChannelCommands().send() maps transport fields to the backend contract', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    publish: async (params: Record<string, unknown>) => {
      backendCalls.push({ method: 'publish', params })
      return { messageId: 'm-1' }
    },
  }

  const commands = createChannelCommands(backend as never)
  const result = await commands.send({
    workspaceId: 'ws-1',
    channelKind: 'broadcast',
    channelId: 'channel-1',
    senderAgentId: 'agent-0',
    targetAgentIds: ['agent-1', 'agent-2'],
    messageType: 'status',
    payload: '{"taskId":"t-1"}',
    idempotencyKey: 'key-1',
  })

  assert.deepEqual(backendCalls, [
    {
      method: 'publish',
      params: {
        workspaceId: 'ws-1',
        channel: { kind: 'broadcast', id: 'channel-1' },
        senderAgentId: 'agent-0',
        targetAgentIds: ['agent-1', 'agent-2'],
        type: 'status',
        payload: { taskId: 't-1' },
        idempotencyKey: 'key-1',
      },
    },
  ])
  assert.deepEqual(result, { messageId: 'm-1' })
})

test('createChannelCommands().listMessages() forwards transport filter fields', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    listMessages: async (params: Record<string, unknown>) => {
      backendCalls.push({ method: 'listMessages', params })
      return { messages: [] }
    },
  }

  const commands = createChannelCommands(backend as never)
  const result = await commands.listMessages({
    workspaceId: 'ws-1',
    targetAgentId: 'agent-1',
    senderAgentId: 'agent-0',
    taskId: 'task-1',
    limit: 10,
  })

  assert.deepEqual(backendCalls, [
    {
      method: 'listMessages',
      params: {
        workspaceId: 'ws-1',
        targetAgentId: 'agent-1',
        senderAgentId: 'agent-0',
        taskId: 'task-1',
        limit: 10,
      },
    },
  ])
  assert.deepEqual(result, { messages: [] })
})

test('createChannelCommands().send() defaults optional routing fields cleanly', async () => {
  const commands = createChannelCommands({
    publish: async (params: Record<string, unknown>) => params,
    listMessages: async () => ({ messages: [] }),
  } as never)

  const result = await commands.send({
    workspaceId: 'ws-1',
    channelKind: 'direct',
    channelId: 'channel-1',
    messageType: 'status',
    payload: { taskId: 't-1' },
  })

  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    channel: { kind: 'direct', id: 'channel-1' },
    senderAgentId: null,
    targetAgentIds: [],
    type: 'status',
    payload: { taskId: 't-1' },
    idempotencyKey: null,
  })
})

test('createChannelCommands().send() preserves object payloads without reparsing', async () => {
  const payload = { taskId: 't-1' }
  const commands = createChannelCommands({
    publish: async (params: Record<string, unknown>) => params,
    listMessages: async () => ({ messages: [] }),
  } as never)

  const result = await commands.send({
    workspaceId: 'ws-1',
    channelKind: 'direct',
    channelId: 'channel-1',
    messageType: 'status',
    payload,
  })

  assert.equal(result.payload, payload)
})

test('createChannelCommands().listMessages() allows omitted filters', async () => {
  const commands = createChannelCommands({
    publish: async () => ({ messageId: 'm-1' }),
    listMessages: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.listMessages({ workspaceId: 'ws-1' })
  assert.deepEqual(result, { workspaceId: 'ws-1' })
})

test('createChannelCommands().send() throws INVALID_JSON for malformed payload strings', () => {
  const commands = createChannelCommands({
    publish: async () => ({ messageId: 'm-1' }),
    listMessages: async () => ({ messages: [] }),
  } as never)

  assert.throws(
    () => commands.send({
      workspaceId: 'ws-1',
      channelKind: 'direct',
      channelId: 'channel-1',
      messageType: 'status',
      payload: '{bad json]',
    }),
    (error) => error instanceof CliError && error.code === 'INVALID_JSON',
  )
})

test('runCli rejects invalid JSON payloads for channel send', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['channel', 'send', '--workspace-id', 'ws-1', '--channel-kind', 'direct', '--channel-id', 'channel-1', '--message-type', 'status', '--payload', '{bad json]', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  const parsed = JSON.parse(writes.join(''))
  assert.equal(parsed.ok, false)
  assert.equal(parsed.data, null)
  assert.deepEqual(parsed.error, {
    code: 'INVALID_JSON',
    message: 'Option must be valid JSON',
  })
  assert.equal(typeof parsed.traceId, 'string')
  assert.ok(parsed.traceId.length > 0)
})

test('createDirectoryBackend().snapshot() calls directory.get with workspaceId', async () => {
  const calls: Array<{ method: string; params: unknown }> = []
  const bridge = {
    request: async <T>(method: string, params: unknown) => {
      calls.push({ method, params })
      return { workspaceId: 'ws-1', agents: [] } as T
    },
  }

  const backend = createDirectoryBackend(bridge)
  const result = await backend.snapshot({ workspaceId: 'ws-1' })

  assert.deepEqual(calls, [{ method: 'directory.get', params: { workspaceId: 'ws-1' } }])
  assert.deepEqual(result, { workspaceId: 'ws-1', agents: [] })
})

test('createChannelCommands().send() parses raw JSON payload strings before publishing', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    publish: async (params: {
      workspaceId: string
      channel: { kind: string; id: string }
      senderAgentId?: string | null
      targetAgentIds?: string[]
      type: string
      payload: unknown
      idempotencyKey?: string | null
    }) => {
      backendCalls.push({ method: 'publish', params })
      return {
        message: {
          id: 'message-1',
          ...params,
        },
      }
    },
  }

  const commands = createChannelCommands(backend as never)
  const result = await commands.send({
    workspaceId: 'ws-1',
    channelKind: 'direct',
    channelId: 'channel-1',
    messageType: 'status',
    payload: '{"text":"hello","count":1}',
  })

  assert.deepEqual(backendCalls, [
    {
      method: 'publish',
      params: {
        workspaceId: 'ws-1',
        channel: {
          kind: 'direct',
          id: 'channel-1',
        },
        senderAgentId: null,
        targetAgentIds: [],
        type: 'status',
        payload: {
          text: 'hello',
          count: 1,
        },
        idempotencyKey: null,
      },
    },
  ])
  assert.deepEqual(result, {
    message: {
      id: 'message-1',
      workspaceId: 'ws-1',
      channel: {
        kind: 'direct',
        id: 'channel-1',
      },
      senderAgentId: null,
      targetAgentIds: [],
      type: 'status',
      payload: {
        text: 'hello',
        count: 1,
      },
      idempotencyKey: null,
    },
  })
})

test('createChannelCommands().listMessages() forwards lookup behavior to the backend', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    listMessages: async (params: { workspaceId: string; channelId: string; limit?: number }) => {
      backendCalls.push({ method: 'listMessages', params })
      return {
        items: [
          {
            id: 'message-1',
            channelId: params.channelId,
          },
        ],
      }
    },
  }

  const commands = createChannelCommands(backend as never)
  const result = await commands.listMessages({
    workspaceId: 'ws-1',
    channelId: 'channel-1',
    limit: 10,
  })

  assert.deepEqual(backendCalls, [
    {
      method: 'listMessages',
      params: {
        workspaceId: 'ws-1',
        channelId: 'channel-1',
        limit: 10,
      },
    },
  ])
  assert.deepEqual(result, {
    items: [
      {
        id: 'message-1',
        channelId: 'channel-1',
      },
    ],
  })
})

test('createDirectoryCommands().snapshot() forwards directory lookup behavior to the backend', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    snapshot: async (params: { workspaceId: string }) => {
      backendCalls.push({ method: 'snapshot', params })
      return {
        workspaceId: params.workspaceId,
        agents: [{ id: 'agent-1' }],
      }
    },
  }

  const commands = createDirectoryCommands(backend as never)
  const result = await commands.snapshot({ workspaceId: 'ws-1' })

  assert.deepEqual(backendCalls, [{ method: 'snapshot', params: { workspaceId: 'ws-1' } }])
  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    agents: [{ id: 'agent-1' }],
  })
})

test('runCli rejects invalid JSON payloads for channel send', async () => {
  const writes: string[] = []
  const exitCode = await runCli(['channel', 'send', '--workspace-id', 'ws-1', '--channel-kind', 'direct', '--channel-id', 'channel-1', '--message-type', 'status', '--payload', '{bad json]', '--json'], {
    stdout: {
      write(chunk: string) {
        writes.push(chunk)
      },
    },
  })

  assert.equal(exitCode, 1)
  const parsed = JSON.parse(writes.join(''))
  assert.equal(parsed.ok, false)
  assert.equal(parsed.data, null)
  assert.deepEqual(parsed.error, {
    code: 'INVALID_JSON',
    message: 'Option must be valid JSON',
  })
  assert.equal(typeof parsed.traceId, 'string')
  assert.ok(parsed.traceId.length > 0)
})


test('createBridgeClient forwards undefined params unchanged', async () => {
  const calls: Array<{ method: string; params: unknown }> = []
  const client = createBridgeClient({
    async request<T>(method: string, params?: unknown) {
      calls.push({ method, params })
      return { ok: true } as T
    },
  })

  const result = await client.request('health')

  assert.deepEqual(calls, [{ method: 'health', params: undefined }])
  assert.deepEqual(result, { ok: true })
})

test('createDefaultBridgeClient returns a request-capable client', () => {
  const client = createDefaultBridgeClient()

  assert.equal(typeof client.request, 'function')
})


test('createFakeBridge preserves undefined params and delegates responses', async () => {
  const { bridge, calls } = createFakeBridge({
    respond(method, params) {
      return { method, params }
    },
  })

  const result = await bridge.request('health')

  assert.deepEqual(calls, [{ method: 'health', params: undefined }])
  assert.deepEqual(result, { method: 'health', params: undefined })
})

test('createAgentCommands().get() filters list result by id', async () => {
  const commandCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    list: async ({ workspaceId }: { workspaceId: string }) => {
      commandCalls.push({ method: 'list', params: { workspaceId } })
      return {
        agents: [
          { id: 'agent-1', name: 'Alpha' },
          { id: 'agent-2', name: 'Beta' },
        ],
      }
    },
  }

  const commands = createAgentCommands(backend as never)
  const result = await commands.get({ workspaceId: 'ws-1', agentId: 'agent-2' })

  assert.deepEqual(commandCalls, [{ method: 'list', params: { workspaceId: 'ws-1' } }])
  assert.deepEqual(result, { id: 'agent-2', name: 'Beta' })
})

test('createAgentCommands().create() sends flat backend request fields', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    create: async (params: Record<string, unknown>) => {
      backendCalls.push({ method: 'create', params })
      return params
    },
  }

  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: backend.create,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: {
      id: 'ignored-id',
      name: 'Alpha',
      roleId: 'role-1',
      tool: 'claude',
      workdir: '.gtoffice/alpha',
      customWorkdir: true,
      employeeNo: 'E-1',
      state: 'ready',
      promptFileName: 'CLAUDE.md',
      promptContent: 'Be helpful',
    },
  })

  assert.deepEqual(backendCalls, [
    {
      method: 'create',
      params: {
        workspaceId: 'ws-1',
        name: 'Alpha',
        roleId: 'role-1',
        tool: 'claude',
        workdir: '.gtoffice/alpha',
        customWorkdir: true,
        employeeNo: 'E-1',
        state: 'ready',
        promptFileName: 'CLAUDE.md',
        promptContent: 'Be helpful',
      },
    },
  ])
  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    name: 'Alpha',
    roleId: 'role-1',
    tool: 'claude',
    workdir: '.gtoffice/alpha',
    customWorkdir: true,
    employeeNo: 'E-1',
    state: 'ready',
    promptFileName: 'CLAUDE.md',
    promptContent: 'Be helpful',
  })
})

test('createAgentCommands().create() requires name and roleId', () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async () => ({ ok: true }),
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  assert.throws(
    () => commands.create({ workspaceId: 'ws-1', payload: { roleId: 'role-1' } }),
    (error) => error instanceof CliError && error.code === 'INVALID_ARGUMENT',
  )
})


test('createAgentCommands().update() merges unspecified non-prompt fields from the current agent', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    list: async ({ workspaceId }: { workspaceId: string }) => {
      backendCalls.push({ method: 'list', params: { workspaceId } })
      return {
        agents: [
          {
            id: 'agent-1',
            name: 'Alpha',
            roleId: 'role-1',
            workspaceId: 'ws-1',
            tool: 'claude',
            workdir: '.gtoffice/alpha',
            customWorkdir: false,
            employeeNo: 'E-1',
            state: 'ready',
            promptFileName: 'CLAUDE.md',
            promptContent: 'Be helpful',
          },
        ],
      }
    },
    update: async (params: Record<string, unknown>) => {
      backendCalls.push({ method: 'update', params })
      return params
    },
  }

  const commands = createAgentCommands(backend as never)
  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: {
      name: 'Alpha Prime',
    },
  })

  assert.deepEqual(backendCalls, [
    { method: 'list', params: { workspaceId: 'ws-1' } },
    {
      method: 'update',
      params: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        name: 'Alpha Prime',
        roleId: 'role-1',
        tool: 'claude',
        workdir: '.gtoffice/alpha',
        customWorkdir: false,
        employeeNo: 'E-1',
        state: 'ready',
      },
    },
  ])
  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    name: 'Alpha Prime',
    roleId: 'role-1',
    tool: 'claude',
    workdir: '.gtoffice/alpha',
    customWorkdir: false,
    employeeNo: 'E-1',
    state: 'ready',
  })
})

test('createAgentCommands().update() preserves immutable identity fields from the current agent', async () => {
  const backend = {
    list: async () => ({
      items: [
        {
          id: 'agent-1',
          workspaceId: 'ws-1',
          name: 'Alpha',
          roleId: 'role-1',
        },
      ],
    }),
    update: async (params: Record<string, unknown>) => params,
  }

  const commands = createAgentCommands(backend as never)
  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: {
      id: 'agent-2',
      workspaceId: 'ws-2',
      name: 'Alpha Prime',
    },
  })

  assert.deepEqual(result, {
    agentId: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Alpha Prime',
    roleId: 'role-1',
    tool: null,
    workdir: null,
    customWorkdir: false,
    employeeNo: null,
    state: null,
  })
})

test('createAgentCommands().promptRead() forwards prompt lookup behavior to the backend', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    promptRead: async (params: { workspaceId: string; agentId: string }) => {
      backendCalls.push({ method: 'promptRead', params })
      return { promptContent: 'Be helpful', ...params }
    },
  }

  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async () => ({ ok: true }),
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: backend.promptRead,
  } as never)

  const result = await commands.promptRead({ workspaceId: 'ws-1', agentId: 'agent-1' })

  assert.deepEqual(backendCalls, [{ method: 'promptRead', params: { workspaceId: 'ws-1', agentId: 'agent-1' } }])
  assert.deepEqual(result, { promptContent: 'Be helpful', workspaceId: 'ws-1', agentId: 'agent-1' })
})

test('createAgentCommands().remove() forwards delete behavior to the backend', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    delete: async (params: { workspaceId: string; agentId: string }) => {
      backendCalls.push({ method: 'delete', params })
      return { deleted: true, ...params }
    },
  }

  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async () => ({ ok: true }),
    update: async () => ({ ok: true }),
    delete: backend.delete,
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.remove({ workspaceId: 'ws-1', agentId: 'agent-1' })

  assert.deepEqual(backendCalls, [{ method: 'delete', params: { workspaceId: 'ws-1', agentId: 'agent-1' } }])
  assert.deepEqual(result, { deleted: true, workspaceId: 'ws-1', agentId: 'agent-1' })
})

test('createAgentCommands().update() requires merged roleId', async () => {
  const commands = createAgentCommands({
    list: async () => ({ items: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha' }] }),
    update: async () => ({ ok: true }),
  } as never)

  await assert.rejects(
    () => commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Alpha Prime' } }),
    (error) => error instanceof CliError && error.code === 'INVALID_ARGUMENT',
  )
})

test('createAgentCommands().create() accepts explicit false customWorkdir', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: {
      name: 'Alpha',
      roleId: 'role-1',
      customWorkdir: false,
    },
  })

  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    name: 'Alpha',
    roleId: 'role-1',
    tool: null,
    workdir: null,
    customWorkdir: false,
    employeeNo: null,
    state: null,
    promptFileName: null,
    promptContent: null,
  })
})

test('createAgentCommands().update() preserves explicit false customWorkdir', async () => {
  const commands = createAgentCommands({
    list: async () => ({
      agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', customWorkdir: true }],
    }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { customWorkdir: false },
  })

  assert.equal(result.customWorkdir, false)
})

test('createAgentCommands().get() supports agents response shape', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', name: 'Alpha' }] }),
  } as never)

  const result = await commands.get({ workspaceId: 'ws-1', agentId: 'agent-1' })
  assert.deepEqual(result, { id: 'agent-1', name: 'Alpha' })
})

test('createAgentCommands().get() supports legacy items response shape', async () => {
  const commands = createAgentCommands({
    list: async () => ({ items: [{ id: 'agent-1', name: 'Alpha' }] }),
  } as never)

  const result = await commands.get({ workspaceId: 'ws-1', agentId: 'agent-1' })
  assert.deepEqual(result, { id: 'agent-1', name: 'Alpha' })
})

test('createAgentCommands().create() ignores non-string optional fields', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: {
      name: 'Alpha',
      roleId: 'role-1',
      tool: 1,
      workdir: 2,
      employeeNo: 3,
      state: 4,
      promptFileName: 5,
      promptContent: 6,
    },
  })

  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    name: 'Alpha',
    roleId: 'role-1',
    tool: null,
    workdir: null,
    customWorkdir: false,
    employeeNo: null,
    state: null,
    promptFileName: null,
    promptContent: null,
  })
})

test('createAgentCommands().create() throws when roleId is missing', () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async () => ({ ok: true }),
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  assert.throws(
    () => commands.create({ workspaceId: 'ws-1', payload: { name: 'Alpha' } }),
    (error) => error instanceof CliError && error.code === 'INVALID_ARGUMENT',
  )
})

test('createAgentCommands().update() preserves existing optional non-prompt fields when patch omits them', async () => {
  const commands = createAgentCommands({
    list: async () => ({
      agents: [{
        id: 'agent-1',
        workspaceId: 'ws-1',
        name: 'Alpha',
        roleId: 'role-1',
        tool: 'claude',
        workdir: '.gtoffice/alpha',
        customWorkdir: true,
        employeeNo: 'E-1',
        state: 'ready',
        promptFileName: 'CLAUDE.md',
        promptContent: 'Be helpful',
      }],
    }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { name: 'Alpha Prime' },
  })

  assert.deepEqual(result, {
    agentId: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Alpha Prime',
    roleId: 'role-1',
    tool: 'claude',
    workdir: '.gtoffice/alpha',
    customWorkdir: true,
    employeeNo: 'E-1',
    state: 'ready',
  })
})


test('createAgentCommands().update() forwards explicit prompt fields only', async () => {
  const commands = createAgentCommands({
    list: async () => ({
      agents: [{
        id: 'agent-1',
        workspaceId: 'ws-1',
        name: 'Alpha',
        roleId: 'role-1',
        promptFileName: 'CLAUDE.md',
        promptContent: 'Be helpful',
      }],
    }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { promptContent: 'New prompt' },
  })

  assert.deepEqual(result, {
    agentId: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Alpha',
    roleId: 'role-1',
    tool: null,
    workdir: null,
    customWorkdir: false,
    employeeNo: null,
    state: null,
    promptContent: 'New prompt',
  })
})

test('createAgentCommands().update() allows clearing nullable string fields with null-like input omission fallback', async () => {
  const commands = createAgentCommands({
    list: async () => ({
      agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', workdir: null }],
    }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { tool: 'claude' },
  })

  assert.equal(result.workdir, null)
})

test('createAgentCommands().remove() does not require a prior list lookup', async () => {
  const backendCalls: string[] = []
  const commands = createAgentCommands({
    delete: async () => {
      backendCalls.push('delete')
      return { deleted: true }
    },
  } as never)

  await commands.remove({ workspaceId: 'ws-1', agentId: 'agent-1' })
  assert.deepEqual(backendCalls, ['delete'])
})

test('createAgentCommands().promptRead() does not require a prior list lookup', async () => {
  const backendCalls: string[] = []
  const commands = createAgentCommands({
    promptRead: async () => {
      backendCalls.push('promptRead')
      return { promptContent: 'Be helpful' }
    },
  } as never)

  await commands.promptRead({ workspaceId: 'ws-1', agentId: 'agent-1' })
  assert.deepEqual(backendCalls, ['promptRead'])
})

test('createAgentCommands().update() preserves current workspaceId when backend list returns agents shape', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Alpha Prime' } })
  assert.equal(result.workspaceId, 'ws-1')
})

test('createAgentCommands().create() uses null defaults for omitted optional strings', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({ workspaceId: 'ws-1', payload: { name: 'Alpha', roleId: 'role-1' } })
  assert.equal(result.tool, null)
})

test('createAgentCommands().update() uses null defaults for omitted optional strings after merge', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Alpha Prime' } })
  assert.equal(result.tool, null)
})

test('createAgentCommands().update() keeps boolean false from merged current agent', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', customWorkdir: false }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Alpha Prime' } })
  assert.equal(result.customWorkdir, false)
})

test('createAgentCommands().create() keeps boolean false when explicitly provided', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: { name: 'Alpha', roleId: 'role-1', customWorkdir: false },
  })

  assert.equal(result.customWorkdir, false)
})

test('createAgentCommands().update() ignores immutable payload id override', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { id: 'agent-2', name: 'Alpha Prime' },
  })

  assert.equal(result.agentId, 'agent-1')
})

test('createAgentCommands().update() ignores immutable payload workspaceId override', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { workspaceId: 'ws-2', name: 'Alpha Prime' },
  })

  assert.equal(result.workspaceId, 'ws-1')
})

test('createAgentCommands().create() forwards prompt content when provided', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: { name: 'Alpha', roleId: 'role-1', promptContent: 'Be helpful' },
  })

  assert.equal(result.promptContent, 'Be helpful')
})

test('createAgentCommands().update() omits prompt content when it is not explicitly provided', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', promptContent: 'Be helpful' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { name: 'Alpha Prime' },
  })

  assert.equal(Object.prototype.hasOwnProperty.call(result, 'promptContent'), false)
})

test('createAgentCommands().update() allows replacing tool while keeping required fields', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', tool: 'claude' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    payload: { tool: 'gemini' },
  })

  assert.equal(result.tool, 'gemini')
})

test('createAgentCommands().create() allows nullable optional fields to default cleanly', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: { name: 'Alpha', roleId: 'role-1' },
  })

  assert.equal(result.workdir, null)
})

test('createAgentCommands().update() preserves null workdir', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', workdir: null }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Alpha Prime' } })
  assert.equal(result.workdir, null)
})

test('createAgentCommands().update() omits null prompt content when absent', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', promptContent: null }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Alpha Prime' } })
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'promptContent'), false)
})

test('createAgentCommands().create() keeps null prompt defaults', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({ workspaceId: 'ws-1', payload: { name: 'Alpha', roleId: 'role-1' } })
  assert.equal(result.promptContent, null)
})

test('createAgentCommands().update() omits null prompt file name when absent', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', promptFileName: null }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { name: 'Alpha Prime' } })
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'promptFileName'), false)
})

test('createAgentCommands().remove() forwards agent identity only', async () => {
  const commands = createAgentCommands({
    delete: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.remove({ workspaceId: 'ws-1', agentId: 'agent-1' })
  assert.deepEqual(result, { workspaceId: 'ws-1', agentId: 'agent-1' })
})

test('createAgentCommands().promptRead() forwards agent identity only', async () => {
  const commands = createAgentCommands({
    promptRead: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.promptRead({ workspaceId: 'ws-1', agentId: 'agent-1' })
  assert.deepEqual(result, { workspaceId: 'ws-1', agentId: 'agent-1' })
})

test('createAgentCommands().update() can override state', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', state: 'ready' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { state: 'paused' } })
  assert.equal(result.state, 'paused')
})

test('createAgentCommands().update() can override prompt file name', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', promptFileName: 'CLAUDE.md' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { promptFileName: 'AGENTS.md' } })
  assert.equal(result.promptFileName, 'AGENTS.md')
})

test('createAgentCommands().update() can override prompt content', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', promptContent: 'Old' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { promptContent: 'New' } })
  assert.equal(result.promptContent, 'New')
})

test('createAgentCommands().update() can override employee number', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', employeeNo: 'E-1' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { employeeNo: 'E-2' } })
  assert.equal(result.employeeNo, 'E-2')
})

test('createAgentCommands().update() can override workdir', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', workdir: '.gtoffice/alpha' }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { workdir: '.gtoffice/beta' } })
  assert.equal(result.workdir, '.gtoffice/beta')
})

test('createAgentCommands().update() can override customWorkdir to true', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'Alpha', roleId: 'role-1', customWorkdir: false }] }),
    update: async (params: Record<string, unknown>) => params,
  } as never)

  const result = await commands.update({ workspaceId: 'ws-1', agentId: 'agent-1', payload: { customWorkdir: true } })
  assert.equal(result.customWorkdir, true)
})

test('createAgentCommands().create() can set all optional fields', async () => {
  const commands = createAgentCommands({
    list: async () => ({ agents: [] }),
    create: async (params: Record<string, unknown>) => params,
    update: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    promptRead: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: {
      name: 'Alpha',
      roleId: 'role-1',
      tool: 'claude',
      workdir: '.gtoffice/alpha',
      customWorkdir: true,
      employeeNo: 'E-1',
      state: 'ready',
      promptFileName: 'CLAUDE.md',
      promptContent: 'Be helpful',
    },
  })

  assert.equal(result.tool, 'claude')
  assert.equal(result.promptContent, 'Be helpful')
})

test('createAgentCommands().get() throws AGENT_NOT_FOUND when the agent is missing', async () => {
  const commands = createAgentCommands({
    list: async () => ({ items: [{ id: 'agent-1', name: 'Alpha' }] }),
  } as never)

  await assert.rejects(
    () => commands.get({ workspaceId: 'ws-1', agentId: 'missing-agent' }),
    (error) => error instanceof CliError && error.code === 'AGENT_NOT_FOUND',
  )
})

test('createAgentCommands().update() throws AGENT_NOT_FOUND when the agent is missing', async () => {
  const commands = createAgentCommands({
    list: async () => ({ items: [{ id: 'agent-1', name: 'Alpha' }] }),
    update: async () => ({ ok: true }),
  } as never)

  await assert.rejects(
    () => commands.update({ workspaceId: 'ws-1', agentId: 'missing-agent', payload: { name: 'Nope' } }),
    (error) => error instanceof CliError && error.code === 'AGENT_NOT_FOUND',
  )
})

test('createRoleCommands().update() merges unspecified fields from the current role', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    roleList: async ({ workspaceId }: { workspaceId: string }) => {
      backendCalls.push({ method: 'roleList', params: { workspaceId } })
      return {
        roles: [
          {
            id: 'role-1',
            workspaceId: 'ws-1',
            roleName: 'Planner',
            roleKey: 'planner',
            scope: 'workspace',
            version: 3,
          },
        ],
      }
    },
    roleSave: async (params: {
      workspaceId: string
      roleId?: string
      roleKey?: string
      roleName: string
      scope?: unknown
      status?: unknown
      charterPath?: unknown
      policyJson?: unknown
    }) => {
      backendCalls.push({ method: 'roleSave', params })
      return params
    },
  }

  const commands = createRoleCommands(backend as never)
  const result = await commands.update({
    workspaceId: 'ws-1',
    roleId: 'role-1',
    payload: {
      roleName: 'Lead Planner',
    },
  })

  assert.deepEqual(backendCalls, [
    { method: 'roleList', params: { workspaceId: 'ws-1' } },
    {
      method: 'roleSave',
      params: {
        workspaceId: 'ws-1',
        roleId: 'role-1',
        roleKey: 'planner',
        roleName: 'Lead Planner',
        scope: 'workspace',
        status: undefined,
        charterPath: undefined,
        policyJson: undefined,
      },
    },
  ])
  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    roleId: 'role-1',
    roleKey: 'planner',
    roleName: 'Lead Planner',
    scope: 'workspace',
    status: undefined,
    charterPath: undefined,
    policyJson: undefined,
  })
})

test('createRoleCommands().create() sends flat backend request fields', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const backend = {
    roleSave: async (params: {
      workspaceId: string
      roleId?: string
      roleKey?: string
      roleName: string
      scope?: unknown
      status?: unknown
      charterPath?: unknown
      policyJson?: unknown
    }) => {
      backendCalls.push({ method: 'roleSave', params })
      return params
    },
  }

  const commands = createRoleCommands({
    roleList: async () => ({ roles: [] }),
    roleSave: backend.roleSave,
    roleDelete: async () => ({ ok: true }),
  } as never)

  const result = await commands.create({
    workspaceId: 'ws-1',
    payload: {
      id: 'role-should-not-be-forwarded',
      roleKey: 'planner',
      roleName: 'Planner',
      scope: 'workspace',
      status: 'active',
      charterPath: 'docs/charter.md',
      policyJson: '{"allow":true}',
    },
  })

  assert.deepEqual(backendCalls, [
    {
      method: 'roleSave',
      params: {
        workspaceId: 'ws-1',
        roleKey: 'planner',
        roleName: 'Planner',
        scope: 'workspace',
        status: 'active',
        charterPath: 'docs/charter.md',
        policyJson: '{"allow":true}',
      },
    },
  ])
  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    roleKey: 'planner',
    roleName: 'Planner',
    scope: 'workspace',
    status: 'active',
    charterPath: 'docs/charter.md',
    policyJson: '{"allow":true}',
  })
})

test('createRoleCommands().update() throws ROLE_NOT_FOUND when the role is missing', async () => {
  const commands = createRoleCommands({
    roleList: async () => ({ roles: [{ id: 'role-1', roleName: 'Planner' }] }),
    roleSave: async () => ({ ok: true }),
  } as never)

  await assert.rejects(
    () => commands.update({ workspaceId: 'ws-1', roleId: 'missing-role', payload: { roleName: 'Nope' } }),
    (error) => error instanceof CliError && error.code === 'ROLE_NOT_FOUND',
  )
})


test('createRoleCommands().remove() forwards scope when provided', async () => {
  const backendCalls: Array<{ method: string; params: unknown }> = []
  const commands = createRoleCommands({
    roleList: async () => ({ roles: [] }),
    roleSave: async () => ({ ok: true }),
    roleDelete: async (params: { workspaceId: string; roleId: string; scope?: string }) => {
      backendCalls.push({ method: 'roleDelete', params })
      return params
    },
  } as never)

  const result = await commands.remove({ workspaceId: 'ws-1', roleId: 'role-1', scope: 'global' })

  assert.deepEqual(backendCalls, [{ method: 'roleDelete', params: { workspaceId: 'ws-1', roleId: 'role-1', scope: 'global' } }])
  assert.deepEqual(result, { workspaceId: 'ws-1', roleId: 'role-1', scope: 'global' })
})

test('createRoleCommands().update() preserves immutable identity fields from the current role', async () => {
  const backend = {
    roleList: async () => ({
      roles: [
        {
          id: 'role-1',
          workspaceId: 'ws-1',
          roleName: 'Planner',
        },
      ],
    }),
    roleSave: async (params: {
      workspaceId: string
      roleId?: string
      roleKey?: string
      roleName: string
      scope?: unknown
      status?: unknown
      charterPath?: unknown
      policyJson?: unknown
    }) => params,
  }

  const commands = createRoleCommands(backend as never)
  const result = await commands.update({
    workspaceId: 'ws-1',
    roleId: 'role-1',
    payload: {
      id: 'role-2',
      workspaceId: 'ws-2',
      roleName: 'Lead Planner',
    },
  })

  assert.deepEqual(result, {
    workspaceId: 'ws-1',
    roleId: 'role-1',
    roleKey: undefined,
    roleName: 'Lead Planner',
    scope: undefined,
    status: undefined,
    charterPath: undefined,
    policyJson: undefined,
  })
})




