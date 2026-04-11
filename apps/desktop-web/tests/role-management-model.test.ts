import test from 'node:test'
import assert from 'node:assert/strict'

import type { AgentProfile } from '../src/shell/integration/desktop-api.js'
import { resolveRoleDeleteErrorMessage } from '../src/features/workspace-hub/role-management-model.js'

function sampleAgent(id: string, name: string): AgentProfile {
  return {
    id,
    workspaceId: 'ws-1',
    name,
    roleId: 'global_role_orchestrator',
    tool: 'codex',
    workdir: '.gtoffice/orchestrator',
    customWorkdir: false,
    state: 'ready',
    employeeNo: null,
    policySnapshotId: null,
    promptFileName: 'AGENTS.md',
    promptFileRelativePath: '.gtoffice/orchestrator/AGENTS.md',
    orderIndex: 0,
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}

test('formats role delete blocked errors with blocking agent names in zh-CN', () => {
  assert.equal(
    resolveRoleDeleteErrorMessage('zh-CN', {
      deleted: false,
      errorCode: 'AGENT_ROLE_DELETE_BLOCKED_BY_ASSIGNED_AGENTS',
      blockingAgents: [sampleAgent('agent-1', 'Alpha'), sampleAgent('agent-2', 'Beta')],
    }),
    '无法删除该角色，仍有 2 个 Agent 正在使用：Alpha、Beta。请先为这些 Agent 更换角色后再删除。',
  )
})

test('falls back to raw error message when delete response is not a structured blocking error', () => {
  assert.equal(
    resolveRoleDeleteErrorMessage('en-US', {
      deleted: false,
      errorCode: 'UNEXPECTED',
    }),
    'UNEXPECTED',
  )
})
