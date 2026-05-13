export function resolveCachedWorkspaceGitSummary(summariesByWorkspace, workspaceId) {
    if (!workspaceId) {
        return null;
    }
    return summariesByWorkspace.get(workspaceId) ?? null;
}
export function shouldApplyWorkspaceGitSummaryRefreshResult(input) {
    return (input.workspaceId === input.activeWorkspaceId &&
        input.requestId === input.latestRequestId);
}
