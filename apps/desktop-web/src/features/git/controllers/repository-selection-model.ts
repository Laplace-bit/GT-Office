import type { GitRepositorySummary } from '@shell/integration/desktop-api'

export function isSelectableRepository(repository: GitRepositorySummary): boolean {
  return !repository.state || repository.state === 'ready'
}

export function shouldShowRepositorySection(
  repositories: readonly GitRepositorySummary[],
): boolean {
  return repositories.length > 1 ||
    (repositories.length === 1 && !isSelectableRepository(repositories[0]))
}

export function resolveActiveRepositoryPath(
  currentRepositoryPath: string | null,
  repositories: readonly GitRepositorySummary[],
  primaryRepositoryPath: string | null | undefined,
): string | null {
  const selectableRepositories = repositories.filter(isSelectableRepository)
  if (
    currentRepositoryPath !== null &&
    selectableRepositories.some((item) => item.repositoryPath === currentRepositoryPath)
  ) {
    return currentRepositoryPath
  }

  const primaryRepository = selectableRepositories.find(
    (item) => item.repositoryPath === primaryRepositoryPath,
  )
  return primaryRepository?.repositoryPath ?? selectableRepositories[0]?.repositoryPath ?? null
}

export function buildRepositoryScopeKey(
  workspaceId: string | null,
  repositoryPath: string | null,
): string {
  const workspaceScope = workspaceId ?? '<no-workspace>'
  const repositoryScope = repositoryPath === null ? '<auto>' : repositoryPath
  return `${workspaceScope}:${repositoryScope}`
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
