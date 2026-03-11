import type { AgentProfile, AgentRole } from '@shell/integration/desktop-api'
import { buildStationWorkdirs, type StationRole } from '@features/workspace'

export type { StationRole } from '@features/workspace'

export interface CreateStationInput {
  name: string
  role: StationRole
  tool: string
  workdir: string
}

export interface UpdateStationInput extends CreateStationInput {
  id: string
}

export const stationRoleOrder: StationRole[] = ['manager', 'product', 'build', 'quality_release']

export interface AgentStation {
  id: string
  name: string
  role: StationRole
  roleWorkdirRel: string
  agentWorkdirRel: string
  customWorkdir: boolean
  tool: string
  terminalSessionId: string
  state: 'running' | 'idle' | 'blocked'
  workspaceId: string
}

function isStationRole(value: string): value is StationRole {
  return value === 'manager' || value === 'product' || value === 'build' || value === 'quality_release'
}

export function mapAgentProfileToStation(
  agent: AgentProfile,
  rolesById: Map<string, AgentRole>,
): AgentStation | null {
  const role = rolesById.get(agent.roleId)
  if (!role || !isStationRole(role.roleKey)) {
    return null
  }
  const fallbackWorkdirs = buildStationWorkdirs(role.roleKey, agent.id)
  const normalizedWorkdir = agent.workdir?.trim() ?? ''
  const customWorkdir = agent.customWorkdir && normalizedWorkdir.length > 0
  return {
    id: agent.id,
    name: agent.name,
    role: role.roleKey,
    roleWorkdirRel: fallbackWorkdirs.roleWorkdirRel,
    agentWorkdirRel: customWorkdir ? normalizedWorkdir : fallbackWorkdirs.agentWorkdirRel,
    customWorkdir,
    tool: agent.tool?.trim() ? agent.tool.trim() : 'codex cli',
    terminalSessionId: '',
    state: agent.state === 'blocked' ? 'blocked' : 'idle',
    workspaceId: agent.workspaceId,
  }
}

type DefaultStationSeed = Omit<AgentStation, 'roleWorkdirRel' | 'agentWorkdirRel' | 'customWorkdir'>

const defaultStationSeeds: DefaultStationSeed[] = [
  {
    id: 'agent-01',
    name: '管理角色-01',
    role: 'manager',
    tool: 'codex cli',
    terminalSessionId: 'ts_101',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  },
  {
    id: 'agent-02',
    name: '产品角色-01',
    role: 'product',
    tool: 'claude code',
    terminalSessionId: 'ts_102',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  },
  {
    id: 'agent-03',
    name: '交付角色-01',
    role: 'build',
    tool: 'codex cli',
    terminalSessionId: 'ts_103',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  },
  {
    id: 'agent-04',
    name: '质量发布-01',
    role: 'quality_release',
    tool: 'shell',
    terminalSessionId: 'ts_104',
    state: 'idle',
    workspaceId: 'ws_gtoffice',
  },
]

const defaultStationCards: AgentStation[] = defaultStationSeeds.map((station) => ({
  ...station,
  ...buildStationWorkdirs(station.role, station.id),
  customWorkdir: false,
}))

export function createDefaultStations(): AgentStation[] {
  return defaultStationCards.map((station) => ({ ...station }))
}
