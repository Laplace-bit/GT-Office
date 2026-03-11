import type { AgentStation, StationRole } from '@features/workspace-hub'

export type OrganizationDepartment =
  | 'leadership'
  | 'product_management'
  | 'delivery_engineering'
  | 'quality_release'

export type StationRuntimeState = 'running' | 'idle' | 'blocked' | 'starting' | 'exited' | 'killed'

export interface StationOverviewState {
  query: string
  roleFilter: StationRole | 'all'
  departmentFilter: OrganizationDepartment | 'all'
}

export interface OrganizationRoleSummary {
  role: StationRole
  department: OrganizationDepartment
  total: number
  running: number
  blocked: number
  idle: number
}

export interface OrganizationDepartmentSummary {
  department: OrganizationDepartment
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
  byDepartment: OrganizationDepartmentSummary[]
}

export const organizationDepartmentOrder: OrganizationDepartment[] = [
  'leadership',
  'product_management',
  'delivery_engineering',
  'quality_release',
]

const roleDepartmentMap: Record<StationRole, OrganizationDepartment> = {
  manager: 'leadership',
  product: 'product_management',
  build: 'delivery_engineering',
  quality_release: 'quality_release',
}

const roleOrder: StationRole[] = ['manager', 'product', 'build', 'quality_release']

export const defaultStationOverviewState: StationOverviewState = {
  query: '',
  roleFilter: 'all',
  departmentFilter: 'all',
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

export function getStationDepartment(role: StationRole): OrganizationDepartment {
  return roleDepartmentMap[role]
}

export function buildOrganizationSnapshot(
  stations: AgentStation[],
  runtimeStateByStationId: Record<string, string>,
): OrganizationSnapshot {
  const byRoleMap = new Map<StationRole, OrganizationRoleSummary>()
  const byDepartmentMap = new Map<OrganizationDepartment, OrganizationDepartmentSummary>()
  let running = 0
  let blocked = 0
  let idle = 0

  stations.forEach((station) => {
    const runtimeState = normalizeRuntimeState(runtimeStateByStationId[station.id])
    const aggregateState = toAggregateState(runtimeState)
    const department = getStationDepartment(station.role)
    const roleSummary = byRoleMap.get(station.role) ?? {
      role: station.role,
      department,
      total: 0,
      running: 0,
      blocked: 0,
      idle: 0,
    }
    const departmentSummary = byDepartmentMap.get(department) ?? {
      department,
      total: 0,
      running: 0,
      blocked: 0,
      idle: 0,
    }

    roleSummary.total += 1
    roleSummary[aggregateState] += 1
    departmentSummary.total += 1
    departmentSummary[aggregateState] += 1
    byRoleMap.set(station.role, roleSummary)
    byDepartmentMap.set(department, departmentSummary)

    if (aggregateState === 'running') {
      running += 1
    } else if (aggregateState === 'blocked') {
      blocked += 1
    } else {
      idle += 1
    }
  })

  const byRole = roleOrder.map(
    (role) =>
      byRoleMap.get(role) ?? {
        role,
        department: getStationDepartment(role),
        total: 0,
        running: 0,
        blocked: 0,
        idle: 0,
      },
  )

  const byDepartment = organizationDepartmentOrder.map(
    (department) =>
      byDepartmentMap.get(department) ?? {
        department,
        total: 0,
        running: 0,
        blocked: 0,
        idle: 0,
      },
  )

  return {
    total: stations.length,
    running,
    blocked,
    idle,
    byRole,
    byDepartment,
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
      const department = getStationDepartment(station.role)
      if (view.roleFilter !== 'all' && station.role !== view.roleFilter) {
        return false
      }
      if (view.departmentFilter !== 'all' && department !== view.departmentFilter) {
        return false
      }
      if (!query) {
        return true
      }
      const searchable =
        `${station.id} ${station.name} ${station.role} ${station.tool} ${station.roleWorkdirRel} ${station.agentWorkdirRel}`.toLowerCase()
      return searchable.includes(query)
    })
    .sort((left, right) => {
      const roleDistance =
        roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role)
      if (roleDistance !== 0) {
        return roleDistance
      }
      return left.id.localeCompare(right.id)
    })
}
