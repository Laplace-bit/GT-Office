import type { WorkbenchContainerSnapshot } from '@features/workspace-hub'
import type { NavItemId } from '../layout/navigation-model.js'

/**
 * In-memory presentation state for a visited workspace tab.
 * Restored atomically on switch so the first paint matches the last known UI
 * (workbench layout, nav, active station, pin) instead of reconciling into a
 * temporary wrong layout.
 */
export interface WorkspacePresentationCacheEntry {
  workspaceId: string
  workbenchContainers: WorkbenchContainerSnapshot[]
  pinnedWorkbenchContainerId: string | null
  activeNavId: NavItemId
  activeStationId: string
  updatedAtMs: number
}

export type WorkspacePresentationCache = Record<string, WorkspacePresentationCacheEntry>

export function captureWorkspacePresentationCacheEntry(input: {
  workspaceId: string | null | undefined
  workbenchContainers: WorkbenchContainerSnapshot[]
  pinnedWorkbenchContainerId: string | null
  activeNavId: NavItemId
  activeStationId: string
  updatedAtMs?: number
}): WorkspacePresentationCacheEntry | null {
  const workspaceId = input.workspaceId?.trim() ?? ''
  if (!workspaceId) {
    return null
  }
  return {
    workspaceId,
    workbenchContainers: input.workbenchContainers.map((container) => ({
      ...container,
      stationIds: [...container.stationIds],
      minimizedStationIds: container.minimizedStationIds
        ? [...container.minimizedStationIds]
        : [],
      customLayout: container.customLayout ? { ...container.customLayout } : container.customLayout,
      frame: container.frame ? { ...container.frame } : container.frame,
    })),
    pinnedWorkbenchContainerId: input.pinnedWorkbenchContainerId,
    activeNavId: input.activeNavId,
    activeStationId: input.activeStationId,
    updatedAtMs: input.updatedAtMs ?? Date.now(),
  }
}

export function putWorkspacePresentationCacheEntry(
  cache: WorkspacePresentationCache,
  entry: WorkspacePresentationCacheEntry | null | undefined,
): void {
  if (!entry?.workspaceId) {
    return
  }
  cache[entry.workspaceId] = entry
}

export function takeWorkspacePresentationCacheEntry(
  cache: WorkspacePresentationCache,
  workspaceId: string | null | undefined,
): WorkspacePresentationCacheEntry | null {
  const normalizedWorkspaceId = workspaceId?.trim() ?? ''
  if (!normalizedWorkspaceId) {
    return null
  }
  return cache[normalizedWorkspaceId] ?? null
}

export function removeWorkspacePresentationCacheEntry(
  cache: WorkspacePresentationCache,
  workspaceId: string | null | undefined,
): void {
  const normalizedWorkspaceId = workspaceId?.trim() ?? ''
  if (!normalizedWorkspaceId) {
    return
  }
  delete cache[normalizedWorkspaceId]
}

export function resolveWorkbenchSnapshotsForStations(
  cache: WorkspacePresentationCache,
  workspaceId: string | null | undefined,
  stationIds: readonly string[],
): WorkbenchContainerSnapshot[] | null {
  const entry = takeWorkspacePresentationCacheEntry(cache, workspaceId)
  if (!entry) {
    return null
  }
  if (stationIds.length === 0) {
    return entry.workbenchContainers
  }
  // Prefer the cached layout whenever any of its stations still exist in the
  // incoming inventory. Full identity matching is too strict during agent reloads.
  const stationIdSet = new Set(stationIds)
  const overlaps = entry.workbenchContainers.some((container) =>
    container.stationIds.some((stationId) => stationIdSet.has(stationId)),
  )
  return overlaps || entry.workbenchContainers.length === 0 ? entry.workbenchContainers : null
}
