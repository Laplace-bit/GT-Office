type StationMutationAction = 'create' | 'update'
type StationMutationLocale = 'zh-CN' | 'en-US'

function stringifyError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return 'UNKNOWN_ERROR'
}

export function resolveStationMutationErrorMessage(
  locale: StationMutationLocale,
  action: StationMutationAction,
  error: unknown,
): string {
  const detail = stringifyError(error)
  if (locale === 'zh-CN') {
    return `${action === 'create' ? '新增 agent' : '更新 agent'} 失败：${detail}`
  }
  return `${action === 'create' ? 'Failed to create agent' : 'Failed to update agent'}: ${detail}`
}
