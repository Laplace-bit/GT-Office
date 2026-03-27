import type { AgentStation, StationRole } from '@features/workspace-hub'

export type StationRuntimeState = 'running' | 'idle' | 'blocked' | 'starting' | 'exited' | 'killed'

export interface StationOverviewState {
  query: string
  roleFilter: StationRole | 'all'
}

export interface OrganizationRoleSummary {
  role: StationRole
  total: number
  running: number
  blocked: number
  idle: number
}

export interface OrganizationSnapshot {
  total: number
  running: number
  blocked: number
  idle: number
  byRole: OrganizationRoleSummary[]
}

export const defaultStationOverviewState: StationOverviewState = {
  query: '',
  roleFilter: 'all',
}

function normalizeRuntimeState(raw: string | undefined): StationRuntimeState {
  switch (raw) {
    case 'running':
      return 'running'
    case 'blocked':
      return 'blocked'
    case 'starting':
      return 'starting'
    case 'exited':
      return 'exited'
    case 'killed':
      return 'killed'
    case 'idle':
      return 'idle'
    default:
      return 'idle'
  }
}

function toAggregateState(runtimeState: StationRuntimeState): 'running' | 'blocked' | 'idle' {
  if (runtimeState === 'running') {
    return 'running'
  }
  if (runtimeState === 'blocked' || runtimeState === 'starting') {
    return 'blocked'
  }
  return 'idle'
}

export function buildOrganizationSnapshot(
  stations: AgentStation[],
  runtimeStateByStationId: Record<string, string>,
): OrganizationSnapshot {
  const byRoleMap = new Map<StationRole, OrganizationRoleSummary>()
  let running = 0
  let blocked = 0
  let idle = 0

  stations.forEach((station) => {
    const runtimeState = normalizeRuntimeState(runtimeStateByStationId[station.id])
    const aggregateState = toAggregateState(runtimeState)
    const roleSummary = byRoleMap.get(station.role) ?? {
      role: station.role,
      total: 0,
      running: 0,
      blocked: 0,
      idle: 0,
    }

    roleSummary.total += 1
    roleSummary[aggregateState] += 1
    byRoleMap.set(station.role, roleSummary)

    if (aggregateState === 'running') {
      running += 1
    } else if (aggregateState === 'blocked') {
      blocked += 1
    } else {
      idle += 1
    }
  })

  const byRole = [...byRoleMap.values()].sort((left, right) => left.role.localeCompare(right.role))

  return {
    total: stations.length,
    running,
    blocked,
    idle,
    byRole,
  }
}

export function filterStationsForOverview(
  stations: AgentStation[],
  _runtimeStateByStationId: Record<string, string>,
  view: StationOverviewState,
): AgentStation[] {
  const query = view.query.trim().toLowerCase()
  return stations
    .filter((station) => {
      if (view.roleFilter !== 'all' && station.role !== view.roleFilter) {
        return false
      }
      if (!query) {
        return true
      }
      const searchable =
        `${station.id} ${station.name} ${station.role} ${station.roleName} ${station.tool} ${station.agentWorkdirRel}`.toLowerCase()
      return searchable.includes(query)
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}
