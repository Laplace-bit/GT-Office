import { normalizeWorkbenchCustomLayout, type WorkbenchCustomLayout, type WorkbenchLayoutMode } from './workbench-layout-model.js'
import type { WorkbenchContainer } from './workbench-container-model.js'

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
