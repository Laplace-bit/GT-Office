import { buildStationWorkdirs, type StationRole } from '@features/workspace'

export type { StationRole } from '@features/workspace'

export interface CreateStationInput {
  name: string
  role: StationRole
  tool: string
  workdir: string
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
