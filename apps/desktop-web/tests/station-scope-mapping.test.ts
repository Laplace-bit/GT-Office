import test from 'node:test'
import assert from 'node:assert/strict'

import type { AgentProfile } from '../src/shell/integration/desktop-api.js'
import { mapAgentProfileToStation } from '../src/features/workspace-hub/station-model.js'

function baseProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent_designer',
    workspaceId: 'ws_test',
    name: 'Designer',
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
  const station = mapAgentProfileToStation(baseProfile({ scope: 'station' }))
  assert.equal(station.scope, 'station')
})

test('mapAgentProfileToStation preserves a designer scope for filtering', () => {
  const station = mapAgentProfileToStation(baseProfile({ scope: 'designer' }))
  assert.equal(station.scope, 'designer')
})

test('mapAgentProfileToStation keeps the agent id and workspace binding', () => {
  const station = mapAgentProfileToStation(baseProfile())
  assert.equal(station.id, 'agent_designer')
  assert.equal(station.workspaceId, 'ws_test')
})
