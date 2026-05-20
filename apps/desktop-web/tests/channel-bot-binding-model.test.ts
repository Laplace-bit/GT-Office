import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildChannelRouteRowKey,
  buildChannelBotBindingGroups,
  isConfiguredChannelBotGroup,
  matchesChannelBindingIdentity,
} from '../src/features/tool-adapter/channel-bot-binding-model.js'

test('buildChannelBotBindingGroups preserves multiple accounts on the same channel', () => {
  const groups = buildChannelBotBindingGroups({
    bindings: [
      {
        workspaceId: 'ws-1',
        channel: 'feishu',
        accountId: 'ops',
        peerKind: 'group',
        peerPattern: 'ops-room',
        targetAgentId: 'agent-1',
      },
      {
        workspaceId: 'ws-1',
        channel: 'feishu',
        accountId: 'sales',
        peerKind: 'group',
        peerPattern: 'sales-room',
        targetAgentId: 'agent-2',
      },
    ],
    accounts: [
      {
        channel: 'feishu',
        accountId: 'ops',
        enabled: true,
        mode: 'websocket',
        updatedAtMs: 1,
      },
      {
        channel: 'feishu',
        accountId: 'sales',
        enabled: true,
        mode: 'websocket',
        updatedAtMs: 2,
      },
    ],
  })

  assert.deepEqual(
    groups.map((group) => ({
      channel: group.channel,
      accountId: group.accountId,
      routeCount: group.routes.length,
    })),
    [
      { channel: 'feishu', accountId: 'ops', routeCount: 1 },
      { channel: 'feishu', accountId: 'sales', routeCount: 1 },
    ],
  )
})

test('isConfiguredChannelBotGroup excludes placeholder channel entries', () => {
  const groups = buildChannelBotBindingGroups({
    bindings: [],
    accounts: [],
    configuredChannels: ['feishu'],
  })

  assert.equal(groups.length, 1)
  assert.equal(isConfiguredChannelBotGroup(groups[0]), false)
})

test('configuredChannels does not add a default placeholder when the channel already has concrete accounts', () => {
  const groups = buildChannelBotBindingGroups({
    bindings: [],
    accounts: [
      {
        channel: 'feishu',
        accountId: 'ops',
        enabled: true,
        mode: 'websocket',
        updatedAtMs: 1,
      },
    ],
    configuredChannels: ['feishu'],
  })

  assert.deepEqual(
    groups.map((group) => group.accountId),
    ['ops'],
  )
})

test('matchesChannelBindingIdentity mirrors backend route deletion identity', () => {
  assert.equal(
    matchesChannelBindingIdentity(
      {
        workspaceId: 'ws-1',
        channel: 'Feishu',
        accountId: null,
        peerKind: 'direct',
        peerPattern: null,
        targetAgentId: 'agent-1',
      },
      {
        workspaceId: 'ws-1',
        channel: 'feishu',
        accountId: 'default',
        peerKind: 'direct',
        peerPattern: '',
        targetAgentId: 'agent-2',
      },
    ),
    true,
  )
})

test('buildChannelRouteRowKey stays unique across workspaces for visually similar routes', () => {
  const left = buildChannelRouteRowKey({
    workspaceId: 'ws-1',
    channel: 'feishu',
    accountId: 'default',
    peerKind: 'direct',
    peerPattern: null,
    targetAgentId: 'role:product',
    createdAtMs: 1,
  })
  const right = buildChannelRouteRowKey({
    workspaceId: 'ws-2',
    channel: 'feishu',
    accountId: 'default',
    peerKind: 'direct',
    peerPattern: null,
    targetAgentId: 'role:product',
    createdAtMs: 1,
  })

  assert.notEqual(left, right)
})
