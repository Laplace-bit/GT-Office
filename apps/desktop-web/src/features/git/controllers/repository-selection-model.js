export function resolveActiveRepositoryPath(currentRepositoryPath, repositories, primaryRepositoryPath) {
    if (currentRepositoryPath &&
        repositories.some((item) => item.repositoryPath === currentRepositoryPath)) {
        return currentRepositoryPath;
    }
    return primaryRepositoryPath ?? repositories[0]?.repositoryPath ?? null;
}
export function restoreScopedRepositorySelection(workspaceId, selectionsByWorkspace) {
    if (!workspaceId) {
        return null;
    }
    return selectionsByWorkspace.get(workspaceId) ?? null;
}
export function shouldAdoptResolvedRepositorySelection(input) {
    if (input.repositories.length === 0) {
        return input.currentRepositoryPath !== null;
    }
    return input.activeRepositoryPath !== input.currentRepositoryPath;
}
