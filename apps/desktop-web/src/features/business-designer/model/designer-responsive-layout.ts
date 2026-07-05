export const DESIGNER_RESPONSIVE_BREAKPOINTS = {
  toolbarWrap: 1040,
  stackedWorkbench: 860,
  stackedLibrary: 720,
  compactToolbar: 520,
} as const

export const DESIGNER_LAYOUT_METRICS = {
  defaultLibraryWidth: 272,
  libraryResizerWidth: 1,
  inspectorWidth: 280,
  minimumCanvasWidth: 264,
  drillPanelMaxWidth: 480,
  drillDrawerHorizontalInset: 12,
  drillDrawerBottomInset: 36,
  compactToolButtonWidth: 31,
  statusbarStateMinWidth: 120,
  statusbarGapMinWidth: 68,
  statusbarDiagnosticsMinWidth: 92,
  statusbarExternalActionsMinWidth: 184,
} as const

export interface DesignerResponsiveLayoutInput {
  viewportWidth: number
  viewportHeight: number
  libraryPanelVisible: boolean
  drillOpen: boolean
  externalChangePending?: boolean
  diagnosticsVisible?: boolean
}

export type DesignerToolbarMode = 'regular' | 'wrapped' | 'compact'
export type DesignerStatusbarMode = 'regular' | 'compact'
export type DesignerLibraryPlacement = 'side' | 'top' | 'hidden'
export type DesignerWorkbenchGrid = 'desktop-columns' | 'stacked-rows'
export type DesignerDrillPresentation = 'closed' | 'canvas-side-panel' | 'workbench-drawer'

export interface DesignerResponsiveLayout {
  viewportWidth: number
  viewportHeight: number
  toolbarMode: DesignerToolbarMode
  toolbarPromptFullRow: boolean
  statusbarMode: DesignerStatusbarMode
  statusbarActionsFullRow: boolean
  statusbarHiddenMeta: readonly ('schema' | 'repo')[]
  statusbarHorizontalOverflow: boolean
  libraryPlacement: DesignerLibraryPlacement
  libraryWidth: number
  mainWidth: number
  workbenchGrid: DesignerWorkbenchGrid
  canvasWidth: number
  inspectorWidth: number
  drillPresentation: DesignerDrillPresentation
  drillWidth: number
  drillOverlapsInspector: boolean
  horizontalOverflow: boolean
}

function nonNegative(value: number): number {
  return Math.max(0, Math.round(value))
}

export function resolveDesignerResponsiveLayout({
  viewportWidth,
  viewportHeight,
  libraryPanelVisible,
  drillOpen,
  externalChangePending = false,
  diagnosticsVisible = false,
}: DesignerResponsiveLayoutInput): DesignerResponsiveLayout {
  const compactToolbar = viewportWidth <= DESIGNER_RESPONSIVE_BREAKPOINTS.compactToolbar
  const wrappedToolbar = viewportWidth <= DESIGNER_RESPONSIVE_BREAKPOINTS.toolbarWrap
  const statusbarMode: DesignerStatusbarMode = compactToolbar ? 'compact' : 'regular'
  const statusbarHiddenMeta = compactToolbar ? (['schema', 'repo'] as const) : []
  const statusbarPrimaryWidth =
    DESIGNER_LAYOUT_METRICS.statusbarStateMinWidth +
    DESIGNER_LAYOUT_METRICS.statusbarGapMinWidth +
    (diagnosticsVisible ? DESIGNER_LAYOUT_METRICS.statusbarDiagnosticsMinWidth : 0)
  const statusbarActionsWidth = externalChangePending
    ? DESIGNER_LAYOUT_METRICS.statusbarExternalActionsMinWidth
    : 0
  const statusbarHorizontalOverflow =
    statusbarMode === 'regular'
      ? statusbarPrimaryWidth + statusbarActionsWidth > viewportWidth
      : Math.max(statusbarPrimaryWidth, statusbarActionsWidth) > viewportWidth
  const libraryPlacement: DesignerLibraryPlacement = !libraryPanelVisible
    ? 'hidden'
    : viewportWidth <= DESIGNER_RESPONSIVE_BREAKPOINTS.stackedLibrary
      ? 'top'
      : 'side'
  const libraryWidth =
    libraryPlacement === 'side' ? DESIGNER_LAYOUT_METRICS.defaultLibraryWidth : 0
  const resizerWidth = libraryPlacement === 'side' ? DESIGNER_LAYOUT_METRICS.libraryResizerWidth : 0
  const mainWidth = nonNegative(viewportWidth - libraryWidth - resizerWidth)
  const workbenchGrid: DesignerWorkbenchGrid =
    viewportWidth <= DESIGNER_RESPONSIVE_BREAKPOINTS.stackedWorkbench
      ? 'stacked-rows'
      : 'desktop-columns'
  const inspectorWidth =
    workbenchGrid === 'desktop-columns'
      ? Math.min(DESIGNER_LAYOUT_METRICS.inspectorWidth, mainWidth)
      : mainWidth
  const canvasWidth =
    workbenchGrid === 'desktop-columns' ? nonNegative(mainWidth - inspectorWidth) : mainWidth
  const drillPresentation: DesignerDrillPresentation = !drillOpen
    ? 'closed'
    : workbenchGrid === 'desktop-columns'
      ? 'canvas-side-panel'
      : 'workbench-drawer'
  const drillWidth =
    drillPresentation === 'closed'
      ? 0
      : drillPresentation === 'canvas-side-panel'
        ? Math.min(DESIGNER_LAYOUT_METRICS.drillPanelMaxWidth, canvasWidth)
        : nonNegative(mainWidth - DESIGNER_LAYOUT_METRICS.drillDrawerHorizontalInset * 2)
  const occupiedWidth = libraryWidth + resizerWidth + mainWidth

  return {
    viewportWidth,
    viewportHeight,
    toolbarMode: compactToolbar ? 'compact' : wrappedToolbar ? 'wrapped' : 'regular',
    toolbarPromptFullRow: compactToolbar,
    statusbarMode,
    statusbarActionsFullRow: compactToolbar && externalChangePending,
    statusbarHiddenMeta,
    statusbarHorizontalOverflow,
    libraryPlacement,
    libraryWidth,
    mainWidth,
    workbenchGrid,
    canvasWidth,
    inspectorWidth,
    drillPresentation,
    drillWidth,
    drillOverlapsInspector: drillPresentation === 'workbench-drawer',
    horizontalOverflow: occupiedWidth > viewportWidth || drillWidth > mainWidth,
  }
}

export function assertDesignerResponsiveLayout(layout: DesignerResponsiveLayout): string[] {
  const issues: string[] = []
  if (layout.horizontalOverflow) {
    issues.push('layout should not overflow horizontally')
  }
  if (layout.mainWidth <= 0) {
    issues.push('main workbench width should stay positive')
  }
  if (layout.workbenchGrid === 'desktop-columns') {
    if (layout.inspectorWidth !== DESIGNER_LAYOUT_METRICS.inspectorWidth) {
      issues.push('desktop inspector should keep the fixed scan column width')
    }
    if (layout.canvasWidth < DESIGNER_LAYOUT_METRICS.minimumCanvasWidth) {
      issues.push('desktop canvas should keep enough width for node dragging')
    }
    if (layout.drillOverlapsInspector) {
      issues.push('desktop drill panel must stay inside the canvas stack')
    }
  }
  if (layout.workbenchGrid === 'stacked-rows' && layout.drillPresentation === 'workbench-drawer') {
    if (layout.drillWidth <= 0 || layout.drillWidth > layout.mainWidth) {
      issues.push('mobile drill drawer should fit inside the workbench')
    }
  }
  if (layout.toolbarMode === 'compact' && !layout.toolbarPromptFullRow) {
    issues.push('compact toolbar prompt must move to its own row')
  }
  if (layout.statusbarHorizontalOverflow) {
    issues.push('statusbar should not overflow horizontally')
  }
  if (layout.statusbarMode === 'compact') {
    if (!layout.statusbarHiddenMeta.includes('schema') || !layout.statusbarHiddenMeta.includes('repo')) {
      issues.push('compact statusbar should hide low-priority metadata')
    }
  }
  return issues
}
