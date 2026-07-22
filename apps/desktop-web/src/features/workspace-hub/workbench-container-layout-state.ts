import { normalizeWorkbenchCustomLayout, type WorkbenchCustomLayout, type WorkbenchLayoutMode } from './workbench-layout-model.js'
import type { WorkbenchContainer } from './workbench-container-model.js'

function isSameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function normalizeMinimizedStationIds(container: WorkbenchContainer, stationIds: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const stationId of stationIds) {
    if (!container.stationIds.includes(stationId) || seen.has(stationId)) {
      continue
    }
    seen.add(stationId)
    normalized.push(stationId)
  }
  return normalized
}

export interface WorkbenchStationMoveTarget {
  containerId: string
  anchorStationId?: string | null
  placement?: 'before' | 'after'
}

function insertStationAtDropTarget(
  stationIds: string[],
  stationId: string,
  anchorStationId: string | null | undefined,
  placement: 'before' | 'after' | undefined,
): string[] {
  const remainingStationIds = stationIds.filter((id) => id !== stationId)
  const anchorIndex = anchorStationId ? remainingStationIds.indexOf(anchorStationId) : -1
  if (anchorIndex < 0) {
    return [...remainingStationIds, stationId]
  }
  const insertIndex = placement === 'after' ? anchorIndex + 1 : anchorIndex
  return [
    ...remainingStationIds.slice(0, insertIndex),
    stationId,
    ...remainingStationIds.slice(insertIndex),
  ]
}

export function applyWorkbenchContainerLayoutModeChange(
  containers: WorkbenchContainer[],
  containerId: string,
  mode: WorkbenchLayoutMode,
): WorkbenchContainer[] {
  let changed = false
  const next = containers.map((container) => {
    if (container.id !== containerId || container.layoutMode === mode) {
      return container
    }
    changed = true
    return {
      ...container,
      layoutMode: mode,
    } satisfies WorkbenchContainer
  })
  return changed ? next : containers
}

export function applyWorkbenchContainerCustomLayoutChange(
  containers: WorkbenchContainer[],
  containerId: string,
  layout: WorkbenchCustomLayout,
): WorkbenchContainer[] {
  const normalizedLayout = normalizeWorkbenchCustomLayout(layout)
  let changed = false
  const next = containers.map((container) => {
    if (container.id !== containerId) {
      return container
    }
    const sameLayout =
      container.layoutMode === 'custom' &&
      container.customLayout.columns === normalizedLayout.columns &&
      container.customLayout.rows === normalizedLayout.rows
    if (sameLayout) {
      return container
    }
    changed = true
    return {
      ...container,
      layoutMode: 'custom',
      customLayout: normalizedLayout,
    } satisfies WorkbenchContainer
  })
  return changed ? next : containers
}

export function applyWorkbenchContainerFullscreenStationChange(
  containers: WorkbenchContainer[],
  containerId: string,
  fullscreenStationId: string | null,
): WorkbenchContainer[] {
  let changed = false
  const next = containers.map((container) => {
    if (container.id !== containerId) {
      return container
    }
    const normalizedFullscreenStationId =
      typeof fullscreenStationId === 'string' && container.stationIds.includes(fullscreenStationId)
        ? fullscreenStationId
        : null
    if (container.fullscreenStationId === normalizedFullscreenStationId) {
      return container
    }
    changed = true
    return {
      ...container,
      fullscreenStationId: normalizedFullscreenStationId,
    } satisfies WorkbenchContainer
  })
  return changed ? next : containers
}

export function applyWorkbenchContainerActiveStationChange(
  containers: WorkbenchContainer[],
  containerId: string,
  activeStationId: string | null,
): WorkbenchContainer[] {
  let changed = false
  const next = containers.map((container) => {
    if (container.id !== containerId) {
      return container
    }
    const normalizedActiveStationId =
      typeof activeStationId === 'string' && container.stationIds.includes(activeStationId)
        ? activeStationId
        : container.stationIds[0] ?? null
    if (container.activeStationId === normalizedActiveStationId) {
      return container
    }
    changed = true
    return {
      ...container,
      activeStationId: normalizedActiveStationId,
    } satisfies WorkbenchContainer
  })
  return changed ? next : containers
}

export function applyWorkbenchContainerMinimizedStationIdsChange(
  containers: WorkbenchContainer[],
  containerId: string,
  minimizedStationIds: string[],
): WorkbenchContainer[] {
  let changed = false
  const next = containers.map((container) => {
    if (container.id !== containerId) {
      return container
    }
    const normalizedMinimizedStationIds = normalizeMinimizedStationIds(container, minimizedStationIds)
    if (isSameStringArray(container.minimizedStationIds, normalizedMinimizedStationIds)) {
      return container
    }
    changed = true
    return {
      ...container,
      minimizedStationIds: normalizedMinimizedStationIds,
    } satisfies WorkbenchContainer
  })
  return changed ? next : containers
}

export function applyWorkbenchStationMove(
  containers: WorkbenchContainer[],
  stationId: string,
  target: WorkbenchStationMoveTarget,
): WorkbenchContainer[] {
  const sourceIndex = containers.findIndex((container) => container.stationIds.includes(stationId))
  const targetIndex = containers.findIndex((container) => container.id === target.containerId)
  if (sourceIndex < 0 || targetIndex < 0) {
    return containers
  }

  const source = containers[sourceIndex]
  const targetContainer = containers[targetIndex]
  if (!source || !targetContainer) {
    return containers
  }

  if (sourceIndex === targetIndex) {
    if (!target.anchorStationId || target.anchorStationId === stationId) {
      return containers
    }
    const stationIds = insertStationAtDropTarget(
      source.stationIds,
      stationId,
      target.anchorStationId,
      target.placement,
    )
    if (isSameStringArray(source.stationIds, stationIds)) {
      return containers
    }
    return containers.map((container, index) =>
      index === sourceIndex
        ? {
            ...container,
            stationIds,
            activeStationId: stationId,
          } satisfies WorkbenchContainer
        : container,
    )
  }

  if (targetContainer.stationIds.includes(stationId)) {
    return containers
  }

  const remainingStationIds = source.stationIds.filter((id) => id !== stationId)
  const targetStationIds = insertStationAtDropTarget(
    targetContainer.stationIds,
    stationId,
    target.anchorStationId,
    target.placement,
  )
  return containers.map((container, index) => {
    if (index === sourceIndex) {
      return {
        ...container,
        stationIds: remainingStationIds,
        activeStationId:
          container.activeStationId === stationId ? remainingStationIds[0] ?? null : container.activeStationId,
        fullscreenStationId: container.fullscreenStationId === stationId ? null : container.fullscreenStationId,
        minimizedStationIds: container.minimizedStationIds.filter((id) => id !== stationId),
      } satisfies WorkbenchContainer
    }
    if (index === targetIndex) {
      return {
        ...container,
        stationIds: targetStationIds,
        activeStationId: stationId,
      } satisfies WorkbenchContainer
    }
    return container
  })
}
