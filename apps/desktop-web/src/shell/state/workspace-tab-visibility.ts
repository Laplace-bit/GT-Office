import type { WorkspaceTabInfo } from './workspace-tab-model'

export function buildActiveWorkspaceFallbackTab(
  workspaceId: string,
  root: string,
): WorkspaceTabInfo {
  const normalizedRoot = root.trim()
  const segments = normalizedRoot.split(/[/\\]/).filter(Boolean)
  return {
    workspaceId,
    name: segments[segments.length - 1] ?? workspaceId,
    root: normalizedRoot,
    active: true,
    windowLabel: null,
    detached: false,
  }
}

export function resolveVisibleWorkspaceTabs(input: {
  isSingleWorkspaceMode: boolean
  workspaceWindowId?: string
  workspaceTabs: WorkspaceTabInfo[]
  activeWorkspaceId: string | null
  activeWorkspaceRoot: string | null
}): WorkspaceTabInfo[] {
  const filtered = input.isSingleWorkspaceMode
    ? input.workspaceTabs.filter((tab) => tab.workspaceId === input.workspaceWindowId)
    : input.workspaceTabs.filter((tab) => !tab.windowLabel)

  const anchorWorkspaceId = input.isSingleWorkspaceMode
    ? input.workspaceWindowId?.trim() || null
    : input.activeWorkspaceId
  const anchorRoot = input.activeWorkspaceRoot?.trim() || null

  if (
    anchorWorkspaceId &&
    anchorRoot &&
    !filtered.some((tab) => tab.workspaceId === anchorWorkspaceId)
  ) {
    return [...filtered, buildActiveWorkspaceFallbackTab(anchorWorkspaceId, anchorRoot)]
  }

  return filtered
}
