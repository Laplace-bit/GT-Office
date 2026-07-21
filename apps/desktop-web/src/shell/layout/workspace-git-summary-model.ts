import type { GitStatusFile, GitStatusResponse } from '../integration/desktop-api'

export function shouldAdoptActiveWorkspace(input: {
  requestedWorkspaceId: string | null
  activeWorkspaceId: string | null
}): boolean {
  return Boolean(
    input.requestedWorkspaceId && input.requestedWorkspaceId !== input.activeWorkspaceId,
  )
}

export function shouldClearWorkspaceStateForCloseResult(input: {
  closedWorkspaceId: string
  activeWorkspaceId: string | null
  nextActiveWorkspaceId: string | null
}): boolean {
  return (
    input.nextActiveWorkspaceId === null &&
    input.closedWorkspaceId === input.activeWorkspaceId
  )
}

export function resolveWorkspaceGitStatusFiles(
  summary: GitStatusResponse | null,
  workspaceId: string | null,
): GitStatusFile[] {
  if (!workspaceId || summary?.workspaceId !== workspaceId) {
    return []
  }
  return summary.files
}

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

export function shouldClearWorkspaceStateForClosedEvent(input: {
  closedWorkspaceId: string
  activeWorkspaceId: string | null
  lockedWorkspaceId: string | null
}): boolean {
  return (
    input.closedWorkspaceId === input.activeWorkspaceId ||
    input.closedWorkspaceId === input.lockedWorkspaceId
  )
}

export function areWorkspaceGitSummariesEquivalent(
  current: GitStatusResponse | null,
  next: GitStatusResponse | null,
): boolean {
  if (current === next) {
    return true
  }
  if (!current || !next) {
    return false
  }

  return JSON.stringify([
    current.workspaceId,
    current.primaryRepositoryPath,
    current.branch,
    current.ahead,
    current.behind,
    current.files,
    current.repositories,
    current.totalChanges,
    current.truncated,
    current.kind,
    current.state,
    current.headOid,
    current.expectedHeadOid,
  ]) === JSON.stringify([
    next.workspaceId,
    next.primaryRepositoryPath,
    next.branch,
    next.ahead,
    next.behind,
    next.files,
    next.repositories,
    next.totalChanges,
    next.truncated,
    next.kind,
    next.state,
    next.headOid,
    next.expectedHeadOid,
  ])
}
