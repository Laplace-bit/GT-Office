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
  launchCommand?: string | null
}

export interface UpdateStationInput extends CreateStationInput {
  id: string
}

export const stationRoleOrder: StationRole[] = ['orchestrator', 'analyst', 'generator', 'evaluator']

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
  launchCommand?: string | null
  terminalSessionId: string
  state: 'running' | 'idle' | 'blocked'
  workspaceId: string
  orderIndex: number
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
    launchCommand: agent.launchCommand,
    terminalSessionId: '',
    state: agent.state === 'blocked' ? 'blocked' : 'idle',
    workspaceId: agent.workspaceId,
    orderIndex: agent.orderIndex ?? 0,
  })
}

type DefaultStationSeed = Omit<AgentStation, 'roleWorkdirRel' | 'agentWorkdirRel' | 'customWorkdir' | 'toolKind' | 'orderIndex'>

const defaultStationSeeds: Array<DefaultStationSeed & { toolKind: StationToolKind }> = [
  createDefaultStationSeed({
    id: 'agent-01',
    name: 'Orchestrator-01',
    roleId: 'global_role_orchestrator',
    role: 'orchestrator',
    roleName: 'Orchestrator',
    tool: 'claude code',
    terminalSessionId: 'ts_101',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-02',
    name: 'Analyst-01',
    roleId: 'global_role_analyst',
    role: 'analyst',
    roleName: 'Analyst',
    tool: 'claude code',
    terminalSessionId: 'ts_102',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-03',
    name: 'Generator-01',
    roleId: 'global_role_generator',
    role: 'generator',
    roleName: 'Generator',
    tool: 'codex cli',
    terminalSessionId: 'ts_103',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  }),
  createDefaultStationSeed({
    id: 'agent-04',
    name: 'Evaluator-01',
    roleId: 'global_role_evaluator',
    role: 'evaluator',
    roleName: 'Evaluator',
    tool: 'codex cli',
    terminalSessionId: 'ts_104',
    state: 'idle',
    workspaceId: 'ws_gtoffice',
  }),
]

const defaultStationCards: AgentStation[] = defaultStationSeeds.map((station, index) =>
  createAgentStation({
    ...station,
    ...buildStationWorkdirs(station.role, station.name),
    customWorkdir: false,
    promptFileName: null,
    promptFileRelativePath: null,
    orderIndex: index + 1,
  }),
)

export function createDefaultStations(): AgentStation[] {
  return defaultStationCards.map((station) => ({ ...station }))
}
