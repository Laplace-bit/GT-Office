import { CliError } from '../core/errors.js'

export interface RoleRecord {
  id: string
  [key: string]: unknown
}

export interface RoleListResponse {
  roles: RoleRecord[]
}

interface RoleSaveParams {
  workspaceId: string
  roleId?: string
  roleKey?: string
  roleName: string
  scope?: unknown
  status?: unknown
  charterPath?: unknown
  policyJson?: unknown
}

export interface RoleDeleteParams {
  workspaceId: string
  roleId: string
  scope?: string
}

export interface RoleBackend {
  roleList<T>(params: { workspaceId: string }): Promise<T>
  roleSave<T>(params: RoleSaveParams): Promise<T>
  roleDelete<T>(params: RoleDeleteParams): Promise<T>
}

async function getCurrentRole(backend: RoleBackend, workspaceId: string, roleId: string) {
  const result = await backend.roleList<RoleListResponse>({ workspaceId })
  const role = result.roles.find((item) => item.id === roleId)

  if (!role) {
    throw new CliError('ROLE_NOT_FOUND', `Role not found: ${roleId}`)
  }

  return role
}

function toRoleSaveParams(workspaceId: string, payload: Record<string, unknown>, roleId?: string): RoleSaveParams {
  return {
    workspaceId,
    ...(roleId ? { roleId } : {}),
    roleKey: typeof payload.roleKey === 'string' ? payload.roleKey : undefined,
    roleName: String(payload.roleName ?? ''),
    scope: payload.scope,
    status: payload.status,
    charterPath: payload.charterPath,
    policyJson: payload.policyJson,
  }
}

export function createRoleCommands(backend: RoleBackend) {
  return {
    list<T>(params: { workspaceId: string }) {
      return backend.roleList<T>(params)
    },
    create<T>(params: { workspaceId: string; payload: unknown }) {
      return backend.roleSave<T>(toRoleSaveParams(params.workspaceId, params.payload as Record<string, unknown>))
    },
    async update<T>(params: { workspaceId: string; roleId: string; payload: Record<string, unknown> }) {
      const current = await getCurrentRole(backend, params.workspaceId, params.roleId)
      const merged = {
        ...current,
        ...params.payload,
        id: current.id,
        workspaceId: (current.workspaceId as string | undefined) ?? params.workspaceId,
      }

      return backend.roleSave<T>(toRoleSaveParams(params.workspaceId, merged, params.roleId))
    },
    remove<T>(params: RoleDeleteParams) {
      return backend.roleDelete<T>(params)
    },
  }
}
