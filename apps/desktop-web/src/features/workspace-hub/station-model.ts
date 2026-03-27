import type { AgentProfile, AgentRole } from '../../shell/integration/desktop-api.js'
import { buildStationWorkdirs, type StationRole } from '../workspace/station-workdir-model.js'

export type StationToolKind = 'claude' | 'codex' | 'gemini' | 'shell' | 'unknown'

export type { StationRole } from '../workspace/station-workdir-model.js'

export interface CreateStationInput {
  name: string
  roleId: string
  role: StationRole
  roleName: string
  tool: string
  workdir: string
  customWorkdir: boolean
  promptContent: string
}

export interface UpdateStationInput extends CreateStationInput {
  id: string
}

export const stationRoleOrder: StationRole[] = ['manager', 'product', 'build', 'quality_release']

export interface AgentStation {
  id: string
  name: string
  roleId: string
  role: StationRole
  roleName: string
  roleWorkdirRel: string
  agentWorkdirRel: string
  customWorkdir: boolean
  tool: string
  toolKind: StationToolKind
  promptFileName?: string | null
  promptFileRelativePath?: string | null
  terminalSessionId: string
  state: 'running' | 'idle' | 'blocked'
  workspaceId: string
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
  if (!role) {
    return null
  }
  const fallbackWorkdirs = buildStationWorkdirs(role.roleKey, agent.name)
  const normalizedWorkdir = agent.workdir?.trim() ?? ''
  const customWorkdir = agent.customWorkdir && normalizedWorkdir.length > 0
  return createAgentStation({
    id: agent.id,
    name: agent.name,
    roleId: role.id,
    role: role.roleKey,
    roleName: role.roleName,
    roleWorkdirRel: fallbackWorkdirs.roleWorkdirRel,
    agentWorkdirRel: customWorkdir ? normalizedWorkdir : fallbackWorkdirs.agentWorkdirRel,
    customWorkdir,
    tool: agent.tool?.trim() ? agent.tool.trim() : 'codex',
    promptFileName: agent.promptFileName,
    promptFileRelativePath: agent.promptFileRelativePath,
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
    roleId: 'global_role_manager',
    role: 'manager',
    roleName: 'Manager',
    tool: 'codex cli',
    terminalSessionId: 'ts_101',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-02',
    name: '产品角色-01',
    roleId: 'global_role_product',
    role: 'product',
    roleName: 'Product',
    tool: 'claude code',
    terminalSessionId: 'ts_102',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-03',
    name: '交付角色-01',
    roleId: 'global_role_build',
    role: 'build',
    roleName: 'Build',
    tool: 'codex cli',
    terminalSessionId: 'ts_103',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-04',
    name: '质量发布-01',
    roleId: 'global_role_quality_release',
    role: 'quality_release',
    roleName: 'Quality & Release',
    tool: 'shell',
    terminalSessionId: 'ts_104',
    state: 'idle',
    workspaceId: 'ws_gtoffice',
  }),
]

const defaultStationCards: AgentStation[] = defaultStationSeeds.map((station) =>
  createAgentStation({
    ...station,
    ...buildStationWorkdirs(station.role, station.name),
    customWorkdir: false,
    promptFileName: null,
    promptFileRelativePath: null,
  }),
)

export function createDefaultStations(): AgentStation[] {
  return defaultStationCards.map((station) => ({ ...station }))
}
