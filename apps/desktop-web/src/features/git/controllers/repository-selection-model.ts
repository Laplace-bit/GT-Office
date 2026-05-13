import type { GitRepositorySummary } from '@shell/integration/desktop-api'

export function resolveActiveRepositoryPath(
  currentRepositoryPath: string | null,
  repositories: readonly GitRepositorySummary[],
  primaryRepositoryPath: string | null | undefined,
): string | null {
  if (
    currentRepositoryPath &&
    repositories.some((item) => item.repositoryPath === currentRepositoryPath)
  ) {
    return currentRepositoryPath
  }

  return primaryRepositoryPath ?? repositories[0]?.repositoryPath ?? null
}

export function restoreScopedRepositorySelection(
  workspaceId: string | null,
  selectionsByWorkspace: ReadonlyMap<string, string | null>,
): string | null {
  if (!workspaceId) {
    return null
  }

  return selectionsByWorkspace.get(workspaceId) ?? null
}

export function shouldAdoptResolvedRepositorySelection(input: {
  activeRepositoryPath: string | null
  currentRepositoryPath: string | null
  repositories: readonly GitRepositorySummary[]
}): boolean {
  if (input.repositories.length === 0) {
    return input.currentRepositoryPath !== null
  }

  return input.activeRepositoryPath !== input.currentRepositoryPath
}
