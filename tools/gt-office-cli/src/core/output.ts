function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
    || typeof value === 'symbol'
    || typeof value === 'function'
  ) {
    return String(value)
  }

  return JSON.stringify(value)
}

export function renderAgentList(agents: Array<Record<string, unknown>>) {
  return agents
    .map((agent) => [
      formatValue(agent.name),
      formatValue(agent.id),
      formatValue(agent.roleId),
      formatValue(agent.tool),
      formatValue(agent.state),
      formatValue(agent.workdir),
    ].join(' / '))
    .join('\n')
}

export function renderRoleList(roles: Array<Record<string, unknown>>) {
  return roles
    .map((role) => [
      formatValue(role.roleName),
      formatValue(role.roleKey),
      formatValue(role.scope),
      formatValue(role.status),
    ].join(' / '))
    .join('\n')
}

export function renderMessageList(messages: Array<Record<string, unknown>>) {
  return messages
    .map((message) => [
      formatValue(message.tsMs ?? message.timestamp ?? message.createdAt),
      formatValue(message.senderAgentId ?? message.from),
      formatValue(message.targetAgentId ?? message.to),
      formatValue(message.type),
      formatValue(isRecord(message.payload) ? message.payload.taskId : undefined),
    ].join(' / '))
    .join('\n')
}

function renderHumanData(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map((item) => formatValue(item)).join('\n')
  }

  if (!isRecord(data)) {
    return String(data)
  }

  if (Array.isArray(data.agents) || Array.isArray(data.items)) {
    return renderAgentList((data.agents ?? data.items ?? []) as Array<Record<string, unknown>>)
  }

  if (Array.isArray(data.roles)) {
    return renderRoleList(data.roles as Array<Record<string, unknown>>)
  }

  if (Array.isArray(data.messages)) {
    return renderMessageList(data.messages as Array<Record<string, unknown>>)
  }

  return JSON.stringify(data, null, 2)
}

export function renderOutput(result: unknown, asJson: boolean): string {
  if (asJson) {
    return `${JSON.stringify(result, null, 2)}\n`
  }

  if (isRecord(result) && result.ok === false && isRecord(result.error) && typeof result.error.message === 'string') {
    return `${result.error.message}\n`
  }

  if (isRecord(result) && result.ok === true && 'data' in result) {
    return `${renderHumanData(result.data)}\n`
  }

  return `${renderHumanData(result)}\n`
}
