import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

const shellReducedMotionStyleFiles = [
  'ActivityRail.scss',
  'StatusBar.scss',
  'WorkspaceTabBar.scss',
  'WorkspaceCloseDialog.scss',
  'ShellRoot.scss',
] as const

function readShellStyle(filename: string): string {
  return readFileSync(resolve(testDir, '../../src/shell/layout', filename), 'utf8')
}

function reducedMotionBlock(content: string): string {
  return content.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? ''
}

test('shell reduced motion styles disable nonessential motion instead of using tiny durations', () => {
  for (const filename of shellReducedMotionStyleFiles) {
    const content = readShellStyle(filename)
    const block = reducedMotionBlock(content)

    assert.notEqual(block, '', `${filename} should define a reduced-motion block`)
    assert.doesNotMatch(block, /0\.01ms/, `${filename} should not fake reduced motion with tiny durations`)
    assert.match(block, /(?:transition|animation): none !important/, `${filename} should disable nonessential motion`)
  }
})

test('status bar branch select keeps a visible keyboard focus indicator', () => {
  const content = readShellStyle('StatusBar.scss')

  assert.match(
    content,
    /\.status-bar__branch-select \{[\s\S]*&:focus-visible \{[\s\S]*box-shadow:[\s\S]*var\(--vb-accent\)/,
    'StatusBar branch select should replace outline removal with an accent focus ring',
  )
})
