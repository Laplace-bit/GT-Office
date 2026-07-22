import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const stationTerminalScss = readFileSync(
  resolve(testDir, '../../src/features/terminal/StationXtermTerminal.scss'),
  'utf8',
)
const stationTerminalSource = readFileSync(
  resolve(testDir, '../../src/features/terminal/StationXtermTerminal.tsx'),
  'utf8',
)
const terminalDebugPanelScss = readFileSync(
  resolve(testDir, '../../src/features/terminal/TerminalDebugPanel.scss'),
  'utf8',
)

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

test('station terminal keeps the WebGL, system monospace, and extended scrollback path enabled', () => {
  assert.match(stationTerminalSource, /const TERMINAL_SCROLLBACK_LINES = 20_000/)
  assert.match(stationTerminalSource, /scrollback: TERMINAL_SCROLLBACK_LINES/)
  assert.match(stationTerminalSource, /lineHeight: 1\.2/)
  assert.match(stationTerminalSource, /new webglModule\.WebglAddon\(\)/)
  assert.match(stationTerminalSource, /ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace/)
})
