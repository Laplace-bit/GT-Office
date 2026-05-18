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
