export type WorkbenchLayoutMode = 'auto' | 'focus' | 'custom'

export interface WorkbenchCustomLayout {
  columns: number
  rows: number
}

export const DEFAULT_WORKBENCH_CUSTOM_LAYOUT: WorkbenchCustomLayout = {
  columns: 2,
  rows: 2,
}

const CUSTOM_LAYOUT_MIN = 1
const CUSTOM_LAYOUT_MAX = 8

export function clampWorkbenchLayoutValue(value: number): number {
  return Math.max(CUSTOM_LAYOUT_MIN, Math.min(CUSTOM_LAYOUT_MAX, Math.round(value)))
}

export function normalizeWorkbenchCustomLayout(
  layout: Partial<WorkbenchCustomLayout> | null | undefined,
): WorkbenchCustomLayout {
  return {
    columns: clampWorkbenchLayoutValue(layout?.columns ?? DEFAULT_WORKBENCH_CUSTOM_LAYOUT.columns),
    rows: clampWorkbenchLayoutValue(layout?.rows ?? DEFAULT_WORKBENCH_CUSTOM_LAYOUT.rows),
  }
}

export function isWorkbenchLayoutMode(value: unknown): value is WorkbenchLayoutMode {
  return value === 'auto' || value === 'focus' || value === 'custom'
}
