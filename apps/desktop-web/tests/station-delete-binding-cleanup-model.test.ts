import test from 'node:test'
import assert from 'node:assert/strict'

import type {
  AgentDeleteResponse,
  AgentProfile,
  ChannelRouteBinding,
} from '../src/shell/integration/desktop-api.js'
import {
  buildStationDeleteCleanupRequest,
  buildStationDeleteCleanupState,
  canConfirmStationDeleteCleanup,
} from '../src/features/workspace-hub/station-delete-binding-cleanup-model.js'

function sampleBinding(targetAgentId = 'agent-1'): ChannelRouteBinding {
  return {
    workspaceId: 'ws-1',
    channel: 'telegram',
    accountId: 'default',
    peerKind: 'direct',
    peerPattern: null,
    targetAgentId,
    priority: 100,
    enabled: true,
  }
}

function sampleAgent(id: string, name: string): AgentProfile {
  return {
    id,
    workspaceId: 'ws-1',
    name,
    roleId: 'role-product',
    tool: 'codex',
    workdir: '.gtoffice/product',
    customWorkdir: false,
    state: 'ready',
    employeeNo: null,
    policySnapshotId: null,
    promptFileName: 'AGENTS.md',
    promptFileRelativePath: '.gtoffice/product/AGENTS.md',
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}

function blockedDeleteResponse(): AgentDeleteResponse {
  return {
    deleted: false,
    errorCode: 'AGENT_DELETE_BLOCKED_BY_CHANNEL_BINDINGS',
    blockingBindings: [sampleBinding()],
  }
}

test('buildStationDeleteCleanupState derives dialog state from blocked delete response', () => {
  const state = buildStationDeleteCleanupState(
    blockedDeleteResponse(),
    [
      sampleAgent('agent-2', 'Replacement Agent'),
      sampleAgent('agent-1', 'Deleting Agent'),
    ],
    'agent-1',
  )

  assert.equal(state.strategy, 'disable')
  assert.equal(state.blockingBindings.length, 1)
  assert.deepEqual(
    state.availableAgents.map((agent) => agent.id),
    ['agent-2'],
  )
  assert.equal(state.replacementAgentId, 'agent-2')
})

test('canConfirmStationDeleteCleanup requires a replacement agent for rebind', () => {
  const state = buildStationDeleteCleanupState(
    blockedDeleteResponse(),
    [sampleAgent('agent-2', 'Replacement Agent')],
    'agent-1',
  )

  assert.equal(
    canConfirmStationDeleteCleanup({
      ...state,
      strategy: 'rebind',
      replacementAgentId: '',
    }),
    false,
  )
  assert.equal(
    canConfirmStationDeleteCleanup({
      ...state,
      strategy: 'rebind',
      replacementAgentId: 'agent-2',
    }),
    true,
  )
})

test('buildStationDeleteCleanupRequest emits the selected cleanup strategy', () => {
  const state = buildStationDeleteCleanupState(
    blockedDeleteResponse(),
    [sampleAgent('agent-2', 'Replacement Agent')],
    'agent-1',
  )

  assert.deepEqual(
    buildStationDeleteCleanupRequest({
      ...state,
      strategy: 'disable',
    }),
    {
      cleanupMode: 'disable',
      replacementAgentId: null,
    },
  )

  assert.deepEqual(
    buildStationDeleteCleanupRequest({
      ...state,
      strategy: 'rebind',
      replacementAgentId: 'agent-2',
    }),
    {
      cleanupMode: 'rebind',
      replacementAgentId: 'agent-2',
    },
  )
})
