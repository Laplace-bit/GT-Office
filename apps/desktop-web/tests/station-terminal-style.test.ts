import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const stationTerminalScss = readFileSync(
  resolve(testDir, '../src/features/terminal/StationXtermTerminal.scss'),
  'utf8',
)
const stationTerminalSource = readFileSync(
  resolve(testDir, '../src/features/terminal/StationXtermTerminal.tsx'),
  'utf8',
)
const terminalDebugPanelScss = readFileSync(
  resolve(testDir, '../src/features/terminal/TerminalDebugPanel.scss'),
  'utf8',
)
const workbenchCanvasScss = readFileSync(
  resolve(testDir, '../src/features/workspace-hub/WorkbenchCanvas.scss'),
  'utf8',
)
const shellRootScss = readFileSync(resolve(testDir, '../src/shell/layout/ShellRoot.scss'), 'utf8')

function reducedMotionBlock(content: string): string {
  return content.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? ''
}

test('station terminal reduced motion keeps file drop feedback visible without animation', () => {
  const block = reducedMotionBlock(stationTerminalScss)

  assert.notEqual(block, '', 'StationXtermTerminal.scss should define a reduced-motion block')
  assert.match(block, /transition: none !important;/)
  assert.match(block, /\.station-terminal-drop-pulse \{[\s\S]*animation: none !important;/)
  assert.match(block, /\.station-terminal-drop-pulse \{[\s\S]*opacity: 1;/)
  assert.match(block, /\.station-terminal-drop-pulse \{[\s\S]*transform: none !important;/)
  assert.doesNotMatch(block, /\.station-terminal-drop-pulse \{[\s\S]*opacity: 0;/)
})

test('terminal debug panel reduced motion removes pressed scale movement', () => {
  const block = reducedMotionBlock(terminalDebugPanelScss)

  assert.notEqual(block, '', 'TerminalDebugPanel.scss should define a reduced-motion block')
  assert.match(block, /transition: none !important;/)
  assert.match(
    block,
    /\.terminal-debug-launcher:active,[\s\S]*\.terminal-debug-panel-tabs button:active \{[\s\S]*transform: none !important;/,
  )
})

test('station terminal keeps WebGL outside macOS WebKit plus system monospace and extended scrollback', () => {
  assert.match(stationTerminalSource, /const TERMINAL_SCROLLBACK_LINES = 20_000/)
  assert.match(stationTerminalSource, /scrollback: TERMINAL_SCROLLBACK_LINES/)
  assert.match(stationTerminalSource, /lineHeight: 1\.2/)
  assert.match(stationTerminalSource, /allowProposedApi:\s*true/)
  assert.match(
    stationTerminalSource,
    /shouldUseStationTerminalWebglRenderer\(isMacOsWebKitEnvironmentRef\.current\)/,
  )
  assert.match(stationTerminalSource, /new webglModule\.WebglAddon\(false\)/)
  assert.match(stationTerminalSource, /ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace/)
})

test('active terminal chrome draws a complete border above terminal content', () => {
  assert.match(
    stationTerminalScss,
    /\.station-terminal-shell::after\s*\{[\s\S]*?inset:\s*0;[\s\S]*?border:\s*var\(--vb-border-width\) solid[\s\S]*?border-radius:\s*0;[\s\S]*?z-index:\s*3;/,
  )
  assert.match(
    stationTerminalScss,
    /\.station-terminal-shell\[data-active='true'\]\s*\{[\s\S]*?&::after\s*\{[\s\S]*?border-color:/,
  )
})

test('focus terminals use a larger shared radius without an inset card', () => {
  assert.match(workbenchCanvasScss, /\.workbench-canvas\s*\{[\s\S]*?--workbench-corner-radius:\s*#\{rem\(12\)\};/)
  assert.match(workbenchCanvasScss, /\.workbench-canvas\s*\{[\s\S]*?--focus-station-corner-radius:\s*#\{rem\(12\)\};/)
  assert.match(
    workbenchCanvasScss,
    /\.focus-main-stage\s*\{[\s\S]*?\.station-window\s*\{[\s\S]*?border-radius:\s*var\(--focus-station-corner-radius\);/,
  )
  assert.match(
    workbenchCanvasScss,
    /\.station-terminal-shell,\s*\.station-terminal-shell::after\s*\{[\s\S]*?border-bottom-right-radius:\s*var\(--focus-station-corner-radius\);[\s\S]*?border-bottom-left-radius:\s*var\(--focus-station-corner-radius\);/,
  )
  assert.match(
    workbenchCanvasScss,
    /\.station-grid\.fullscreen-mode,[\s\S]*?\.station-grid\.focus-mode\.single-station-mode\s*\{\s*padding:\s*0;/,
  )
})

test('shell clipping radius remains smaller than the focused terminal frame', () => {
  assert.match(
    shellRootScss,
    /\.shell-main-pane\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?border-radius:\s*#\{rem\(8\)\};/,
  )
})
