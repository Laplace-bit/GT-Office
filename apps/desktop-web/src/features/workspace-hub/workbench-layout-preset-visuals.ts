import type { WorkbenchLayoutMode } from './workbench-layout-model.js'

export type WorkbenchLayoutPresetVisual =
  | {
      kind: 'glyph'
      value: 'A'
    }
  | {
      kind: 'icon'
      value: 'focus' | 'custom'
    }

export function resolveWorkbenchLayoutPresetVisual(
  mode: WorkbenchLayoutMode,
): WorkbenchLayoutPresetVisual {
  if (mode === 'auto') {
    return {
      kind: 'glyph',
      value: 'A',
    }
  }
  if (mode === 'focus') {
    return {
      kind: 'icon',
      value: 'focus',
    }
  }
  return {
    kind: 'icon',
    value: 'custom',
  }
}
