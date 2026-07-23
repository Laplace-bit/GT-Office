import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8')
}

test('station navigation renders the workbench without a duplicate left panel', () => {
  const shellRootView = readSource('shell/layout/ShellRootView.tsx')

  assert.doesNotMatch(shellRootView, /StationOverviewPane/)
  assert.match(shellRootView, /activeNavId === 'designer' \|\| activeNavId === 'stations'/)
})

test('right-side station cards retain edit and container-move controls', () => {
  const stationCard = readSource('features/workspace-hub/StationCard.tsx')
  const workbenchCanvas = readSource('features/workspace-hub/WorkbenchCanvas.tsx')
  const workbenchPanel = readSource('features/workspace-hub/WorkbenchCanvasPanel.tsx')

  assert.match(stationCard, /className="station-edit-btn"/)
  assert.match(stationCard, /className="station-drag-handle"/)
  assert.match(workbenchCanvas, /onEditStation=\{onEditStation\}/)
  assert.match(workbenchPanel, /onEditStation=\{detachedReadonly \? undefined : onEditStation\}/)
})

test('right-side station dragging uses the Pointer path rather than competing HTML5 drag events', () => {
  const stationCard = readSource('features/workspace-hub/StationCard.tsx')
  const workbenchCanvas = readSource('features/workspace-hub/WorkbenchCanvas.tsx')
  const workbenchPanel = readSource('features/workspace-hub/WorkbenchCanvasPanel.tsx')

  assert.match(stationCard, /onStationDragPointerStart/)
  assert.doesNotMatch(stationCard, /draggable=\{draggable\}/)
  assert.match(workbenchCanvas, /resolveStationDropTargetAtPoint/)
  assert.doesNotMatch(workbenchPanel, /onDragOver=/)
})

test('primary station launch keeps mouse focus available for the terminal', () => {
  const stationCard = readSource('features/workspace-hub/StationCard.tsx')

  assert.match(
    stationCard,
    /className=\{\['station-primary-launch-btn', launchState\][\s\S]*?onPointerDown=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\)/,
  )
  assert.match(
    stationCard,
    /className="station-terminal-launch-btn"[\s\S]*?onPointerDown=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\)/,
  )
})

test('inactive station terminal launch activates on pointer down before the launch click', () => {
  const stationCard = readSource('features/workspace-hub/StationCard.tsx')
  const terminalLaunchButton =
    stationCard.match(/className="station-terminal-launch-btn"[\s\S]*?<\/StationIconButton>/)?.[0] ?? ''

  assert.notEqual(terminalLaunchButton, '', 'station terminal launch button should exist')
  assert.match(
    terminalLaunchButton,
    /onPointerDown=\{\(event\) => \{[\s\S]*?activateStationAndFocusTerminal\(\)[\s\S]*?event\.preventDefault\(\)/,
    'pointer down must activate an inactive station before the click starts its terminal',
  )
  assert.match(terminalLaunchButton, /onClick=\{\(event\) => \{[\s\S]*?activateStationAndOpenTerminal\(\)/)
})

test('explicit terminal launch starts a fresh session even when the card shows closed history', () => {
  const stationCard = readSource('features/workspace-hub/StationCard.tsx')
  const explicitLaunchBlock =
    stationCard.match(/const activateStationAndOpenTerminal = useCallback\([\s\S]*?\n  const activateStationFromTerminal/m)?.[0] ?? ''

  assert.notEqual(explicitLaunchBlock, '', 'explicit terminal launch handler should exist')
  assert.match(
    explicitLaunchBlock,
    /activateStationAndFocusTerminal\(\)\s*onLaunchStationTerminal\(station\.id\)/,
  )
  assert.doesNotMatch(explicitLaunchBlock, /shouldAutoLaunchTerminal/)
})

test('idle session history is available regardless of the active station', () => {
  const stationCard = readSource('features/workspace-hub/StationCard.tsx')
  const terminalStationPane = readSource('features/workspace-hub/TerminalStationPane.tsx')

  assert.doesNotMatch(stationCard, /active && !shouldRenderTerminal && workspaceId && sessionProvider/)
  assert.doesNotMatch(terminalStationPane, /active && !shouldRenderTerminal && workspaceId && sessionProvider/)
  assert.match(stationCard, /!shouldRenderTerminal && workspaceId && sessionProvider/)
  assert.match(terminalStationPane, /!shouldRenderTerminal && workspaceId && sessionProvider/)
})

test('station card chrome avoids nested backdrop filters during terminal work', () => {
  const stationCardStyle = readSource('features/workspace-hub/StationCard.scss')

  assert.doesNotMatch(stationCardStyle, /backdrop-filter:/)
})
