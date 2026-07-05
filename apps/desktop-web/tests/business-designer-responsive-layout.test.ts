import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertDesignerResponsiveLayout,
  DESIGNER_LAYOUT_METRICS,
  DESIGNER_RESPONSIVE_BREAKPOINTS,
  resolveDesignerResponsiveLayout,
} from '../src/features/business-designer/model/designer-responsive-layout.js'

function assertNoLayoutIssues(width: number, drillOpen: boolean, libraryPanelVisible = true) {
  const layout = resolveDesignerResponsiveLayout({
    viewportWidth: width,
    viewportHeight: 760,
    libraryPanelVisible,
    drillOpen,
  })
  assert.deepEqual(assertDesignerResponsiveLayout(layout), [], `${width}px layout should be valid`)
  assert.equal(layout.horizontalOverflow, false, `${width}px should not overflow horizontally`)
  return layout
}

test('business designer responsive layout keeps desktop canvas and inspector separated', () => {
  for (const width of [1440, 1200, 1041, 1024, 900, 861]) {
    const layout = assertNoLayoutIssues(width, true)

    assert.equal(layout.libraryPlacement, 'side')
    assert.equal(layout.workbenchGrid, 'desktop-columns')
    assert.equal(layout.drillPresentation, 'canvas-side-panel')
    assert.equal(layout.drillOverlapsInspector, false)
    assert.equal(layout.inspectorWidth, DESIGNER_LAYOUT_METRICS.inspectorWidth)
    assert.ok(layout.canvasWidth >= DESIGNER_LAYOUT_METRICS.minimumCanvasWidth)
    assert.ok(layout.drillWidth <= layout.canvasWidth)
  }
})

test('business designer responsive layout switches to stacked workbench at the canvas breakpoint', () => {
  const justAbove = assertNoLayoutIssues(DESIGNER_RESPONSIVE_BREAKPOINTS.stackedWorkbench + 1, true)
  const atBreakpoint = assertNoLayoutIssues(DESIGNER_RESPONSIVE_BREAKPOINTS.stackedWorkbench, true)
  const below = assertNoLayoutIssues(768, true)

  assert.equal(justAbove.workbenchGrid, 'desktop-columns')
  assert.equal(atBreakpoint.workbenchGrid, 'stacked-rows')
  assert.equal(below.workbenchGrid, 'stacked-rows')
  assert.equal(atBreakpoint.drillPresentation, 'workbench-drawer')
  assert.equal(atBreakpoint.drillOverlapsInspector, true)
  assert.ok(atBreakpoint.drillWidth < atBreakpoint.mainWidth)
})

test('business designer responsive layout stacks the library before mobile widths get cramped', () => {
  const justAbove = assertNoLayoutIssues(DESIGNER_RESPONSIVE_BREAKPOINTS.stackedLibrary + 1, false)
  const atBreakpoint = assertNoLayoutIssues(DESIGNER_RESPONSIVE_BREAKPOINTS.stackedLibrary, false)
  const mobile = assertNoLayoutIssues(375, true)

  assert.equal(justAbove.libraryPlacement, 'side')
  assert.equal(atBreakpoint.libraryPlacement, 'top')
  assert.equal(atBreakpoint.libraryWidth, 0)
  assert.equal(atBreakpoint.mainWidth, atBreakpoint.viewportWidth)
  assert.equal(mobile.libraryPlacement, 'top')
  assert.equal(mobile.drillPresentation, 'workbench-drawer')
  assert.equal(mobile.drillWidth, 351)
})

test('business designer responsive layout moves the prompt to a full row on compact toolbar', () => {
  const compact = assertNoLayoutIssues(DESIGNER_RESPONSIVE_BREAKPOINTS.compactToolbar, false)
  const phone = assertNoLayoutIssues(375, false)
  const regular = assertNoLayoutIssues(DESIGNER_RESPONSIVE_BREAKPOINTS.compactToolbar + 1, false)

  assert.equal(compact.toolbarMode, 'compact')
  assert.equal(compact.toolbarPromptFullRow, true)
  assert.equal(phone.toolbarMode, 'compact')
  assert.equal(phone.toolbarPromptFullRow, true)
  assert.notEqual(regular.toolbarMode, 'compact')
  assert.equal(regular.toolbarPromptFullRow, false)
})

test('business designer responsive layout wraps statusbar actions on compact widths', () => {
  const compact = resolveDesignerResponsiveLayout({
    viewportWidth: DESIGNER_RESPONSIVE_BREAKPOINTS.compactToolbar,
    viewportHeight: 760,
    libraryPanelVisible: true,
    drillOpen: false,
    externalChangePending: true,
    diagnosticsVisible: true,
  })
  const phone = resolveDesignerResponsiveLayout({
    viewportWidth: 375,
    viewportHeight: 760,
    libraryPanelVisible: true,
    drillOpen: false,
    externalChangePending: true,
    diagnosticsVisible: true,
  })
  const regular = resolveDesignerResponsiveLayout({
    viewportWidth: DESIGNER_RESPONSIVE_BREAKPOINTS.compactToolbar + 1,
    viewportHeight: 760,
    libraryPanelVisible: true,
    drillOpen: false,
    externalChangePending: true,
    diagnosticsVisible: true,
  })

  assert.deepEqual(assertDesignerResponsiveLayout(compact), [])
  assert.deepEqual(assertDesignerResponsiveLayout(phone), [])
  assert.equal(compact.statusbarMode, 'compact')
  assert.equal(compact.statusbarActionsFullRow, true)
  assert.deepEqual(compact.statusbarHiddenMeta, ['schema', 'repo'])
  assert.equal(phone.statusbarHorizontalOverflow, false)
  assert.equal(regular.statusbarMode, 'regular')
  assert.equal(regular.statusbarActionsFullRow, false)
})

test('business designer responsive layout handles collapsed library without reallocating phantom width', () => {
  const layout = assertNoLayoutIssues(1024, true, false)

  assert.equal(layout.libraryPlacement, 'hidden')
  assert.equal(layout.libraryWidth, 0)
  assert.equal(layout.mainWidth, 1024)
  assert.equal(layout.canvasWidth, 744)
  assert.equal(layout.drillWidth, 480)
})
