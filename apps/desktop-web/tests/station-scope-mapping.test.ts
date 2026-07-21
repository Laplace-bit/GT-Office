import test from 'node:test'
import assert from 'node:assert/strict'

import type { AgentProfile, AgentRole } from '../src/shell/integration/desktop-api.js'
import { mapAgentProfileToStation } from '../src/features/workspace-hub/station-model.js'

const baseRole: AgentRole = {
  id: 'role_business_designer',
  workspaceId: 'ws_test',
  roleKey: 'business-designer',
  roleName: 'Business Designer',
  departmentId: 'dept_design',
  scope: 'workspace',
  charterPath: null,
  policyJson: null,
  version: 1,
  status: 'active',
  isSystem: false,
  createdAtMs: 1,
  updatedAtMs: 1,
}

function baseProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent_designer',
    workspaceId: 'ws_test',
    name: 'Designer',
    roleId: 'role_business_designer',
    tool: 'codex',
    workdir: '.gtoffice/designer',
    customWorkdir: true,
    scope: 'station',
    state: 'ready',
    employeeNo: null,
    policySnapshotId: null,
    promptFileName: null,
    promptFileRelativePath: null,
    launchCommand: null,
    orderIndex: 0,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  }
}

test('mapAgentProfileToStation carries the scope field onto the station', () => {
  const station = mapAgentProfileToStation(baseProfile({ scope: 'station' }), new Map([['role_business_designer', baseRole]]))
  assert.equal(station?.scope, 'station')
})

test('mapAgentProfileToStation preserves a designer scope for filtering', () => {
  const station = mapAgentProfileToStation(baseProfile({ scope: 'designer' }), new Map([['role_business_designer', baseRole]]))
  assert.equal(station?.scope, 'designer')
})

test('mapAgentProfileToStation returns null when the role is missing', () => {
  const station = mapAgentProfileToStation(baseProfile(), new Map())
  assert.equal(station, null)
})
