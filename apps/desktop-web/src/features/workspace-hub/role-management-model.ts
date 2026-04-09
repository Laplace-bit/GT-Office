import type {
  AgentProfile,
  AgentRole,
  AgentRoleDeleteResponse,
  RestorableSystemRole,
} from '../../shell/integration/desktop-api.js'
import type { Locale } from '../../shell/i18n/ui-locale.js'

export function sortRoles(roles: AgentRole[]): AgentRole[] {
  return [...roles].sort((left, right) => {
    if (left.scope !== right.scope) {
      return left.scope === 'workspace' ? -1 : 1
    }
    if (left.isSystem !== right.isSystem) {
      return left.isSystem ? -1 : 1
    }
    return left.roleName.localeCompare(right.roleName)
  })
}

export function resolveEffectiveRoles(roles: AgentRole[]): AgentRole[] {
  const effective = new Map<string, AgentRole>()
  for (const role of sortRoles(roles.filter((item) => item.status === 'active'))) {
    if (!effective.has(role.roleKey)) {
      effective.set(role.roleKey, role)
    }
  }
  return [...effective.values()]
}

export function sortRestorableSystemRoles(
  roles: RestorableSystemRole[],
): RestorableSystemRole[] {
  return [...roles].sort((left, right) => left.roleName.localeCompare(right.roleName))
}

export function resolveRoleDeleteErrorMessage(
  locale: Locale,
  response: Pick<AgentRoleDeleteResponse, 'deleted'> &
    Partial<Pick<AgentRoleDeleteResponse, 'errorCode' | 'blockingAgents'>>,
): string {
  if (
    response.errorCode === 'AGENT_ROLE_DELETE_BLOCKED_BY_ASSIGNED_AGENTS' &&
    response.blockingAgents &&
    response.blockingAgents.length > 0
  ) {
    const names = response.blockingAgents
      .map((agent: AgentProfile) => agent.name)
      .join(locale === 'zh-CN' ? '、' : ', ')
    return locale === 'zh-CN'
      ? `无法删除该角色，仍有 ${response.blockingAgents.length} 个 Agent 正在使用：${names}。请先为这些 Agent 更换角色后再删除。`
      : `This role is still assigned to ${response.blockingAgents.length} agents: ${names}. Reassign those agents before deleting the role.`
  }

  return response.errorCode ?? (locale === 'zh-CN' ? '删除角色失败。' : 'Failed to delete role.')
}
