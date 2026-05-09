import type { WorkspaceListItem, WorkspaceListResponse } from '../integration/desktop-api'
import type { WorkspaceTabInfo } from './workspace-tab-model'

function isWorkspaceListItem(value: WorkspaceListItem | null | undefined): value is WorkspaceListItem {
  return Boolean(
    value &&
      typeof value.workspaceId === 'string' &&
      value.workspaceId.trim() &&
      typeof value.root === 'string' &&
      value.root.trim() &&
      typeof value.name === 'string' &&
      typeof value.active === 'boolean',
  )
}

export function normalizeWorkspaceTabsResponse(response: WorkspaceListResponse): WorkspaceTabInfo[] {
  const seen = new Set<string>()
  const tabs: WorkspaceTabInfo[] = []
  for (const item of response.workspaces) {
    if (!isWorkspaceListItem(item)) {
      continue
    }
    const workspaceId = item.workspaceId.trim()
    if (seen.has(workspaceId)) {
      continue
    }
    seen.add(workspaceId)
    tabs.push({
      workspaceId,
      name: item.name.trim(),
      root: item.root.trim(),
      active: item.active,
    })
  }
  return tabs
}
