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
