import type { AgentProfile, AgentRole } from '@shell/integration/desktop-api'
import { buildStationWorkdirs, type StationRole } from '@features/workspace'

export type StationToolKind = 'claude' | 'codex' | 'gemini' | 'shell' | 'unknown'

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
  toolKind: StationToolKind
  terminalSessionId: string
  state: 'running' | 'idle' | 'blocked'
  workspaceId: string
}

function isStationRole(value: string): value is StationRole {
  return value === 'manager' || value === 'product' || value === 'build' || value === 'quality_release'
}

export function normalizeStationToolKind(tool: string | null | undefined): StationToolKind {
  const normalized = tool?.trim().toLowerCase() ?? ''
  if (normalized.includes('claude')) {
    return 'claude'
  }
  if (normalized.includes('codex')) {
    return 'codex'
  }
  if (normalized.includes('gemini')) {
    return 'gemini'
  }
  if (normalized.includes('shell')) {
    return 'shell'
  }
  return 'unknown'
}

function withToolKind<T extends { tool: string }>(input: T): T & { toolKind: StationToolKind } {
  return {
    ...input,
    toolKind: normalizeStationToolKind(input.tool),
  }
}

function createAgentStation(input: Omit<AgentStation, 'toolKind'>): AgentStation {
  return withToolKind(input)
}

function createDefaultStationSeed(input: DefaultStationSeed): DefaultStationSeed & { toolKind: StationToolKind } {
  return withToolKind(input)
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
  return createAgentStation({
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
  })
}

type DefaultStationSeed = Omit<AgentStation, 'roleWorkdirRel' | 'agentWorkdirRel' | 'customWorkdir' | 'toolKind'>

const defaultStationSeeds: Array<DefaultStationSeed & { toolKind: StationToolKind }> = [
  createDefaultStationSeed({
    id: 'agent-01',
    name: '管理角色-01',
    role: 'manager',
    tool: 'codex cli',
    terminalSessionId: 'ts_101',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-02',
    name: '产品角色-01',
    role: 'product',
    tool: 'claude code',
    terminalSessionId: 'ts_102',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-03',
    name: '交付角色-01',
    role: 'build',
    tool: 'codex cli',
    terminalSessionId: 'ts_103',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-04',
    name: '质量发布-01',
    role: 'quality_release',
    tool: 'shell',
    terminalSessionId: 'ts_104',
    state: 'idle',
    workspaceId: 'ws_gtoffice',
  }),
]

const defaultStationCards: AgentStation[] = defaultStationSeeds.map((station) =>
  createAgentStation({
    ...station,
    ...buildStationWorkdirs(station.role, station.id),
    customWorkdir: false,
  }),
)

export function createDefaultStations(): AgentStation[] {
  return defaultStationCards.map((station) => ({ ...station }))
}
