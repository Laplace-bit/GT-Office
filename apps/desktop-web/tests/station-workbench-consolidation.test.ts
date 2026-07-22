import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

function readSource(relativePath: string): string {
  return readFileSync(resolve(testDir, '../../src', relativePath), 'utf8')
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

test('idle session history scans start only for the active station', () => {
  const stationCard = readSource('features/workspace-hub/StationCard.tsx')
  const terminalStationPane = readSource('features/workspace-hub/TerminalStationPane.tsx')

  assert.match(stationCard, /active && !shouldRenderTerminal && workspaceId && sessionProvider/)
  assert.match(terminalStationPane, /active && !shouldRenderTerminal && workspaceId && sessionProvider/)
})

test('station card chrome avoids nested backdrop filters during terminal work', () => {
  const stationCardStyle = readSource('features/workspace-hub/StationCard.scss')

  assert.doesNotMatch(stationCardStyle, /backdrop-filter:/)
})
