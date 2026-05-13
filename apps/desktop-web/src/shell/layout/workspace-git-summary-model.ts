export function resolveCachedWorkspaceGitSummary<T>(
  summariesByWorkspace: ReadonlyMap<string, T | null>,
  workspaceId: string | null,
): T | null {
  if (!workspaceId) {
    return null
  }
  return summariesByWorkspace.get(workspaceId) ?? null
}

export function shouldApplyWorkspaceGitSummaryRefreshResult(input: {
  workspaceId: string
  activeWorkspaceId: string | null
  requestId: number
  latestRequestId: number
}): boolean {
  return (
    input.workspaceId === input.activeWorkspaceId &&
    input.requestId === input.latestRequestId
  )
}
