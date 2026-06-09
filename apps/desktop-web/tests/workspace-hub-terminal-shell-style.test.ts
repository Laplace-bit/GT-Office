import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

const terminalShellStyleFiles = ['StationCard.scss', 'TerminalStationPane.scss'] as const

function readWorkspaceHubStyle(filename: string): string {
  return readFileSync(resolve(testDir, '../../src/features/workspace-hub', filename), 'utf8')
}

test('workspace hub terminal shell chrome uses terminal theme tokens', () => {
  for (const filename of terminalShellStyleFiles) {
    const content = readWorkspaceHubStyle(filename)
    const terminalShellBlock = content.match(/\.station-terminal-shell[\s\S]*?\n\}/)?.[0] ?? ''

    assert.notEqual(terminalShellBlock, '', `${filename} should define terminal shell chrome`)
    assert.doesNotMatch(
      terminalShellBlock,
      /rgba\(\s*0,\s*0,\s*0/,
      `${filename} terminal shell should not hardcode black rgba`,
    )
    assert.match(
      terminalShellBlock,
      /background:\s*var\(--vb-terminal-shell-bg\)/,
      `${filename} terminal shell should use terminal background token`,
    )
    assert.match(
      terminalShellBlock,
      /box-shadow:[\s\S]*var\(--vb-terminal-shell-shadow\)/,
      `${filename} terminal shell should use terminal shadow token`,
    )
  }
})

test('terminal station reduced motion removes active scale movement', () => {
  const content = readWorkspaceHubStyle('TerminalStationPane.scss')
  const block = content.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.notEqual(block, '', 'TerminalStationPane should define a reduced-motion block')
  assert.match(block, /transition: none !important;/)
  assert.match(
    block,
    /\.terminal-station-pane-force-close:active,[\s\S]*\.terminal-station-pane-idle-button:active \{[\s\S]*transform: none;/,
  )
})
