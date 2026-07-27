import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

const shellReducedMotionStyleFiles = [
  'ActivityRail.scss',
  'StatusBar.scss',
  'TopControlBar.scss',
  'WorkspaceTabBar.scss',
  'WorkspaceCloseDialog.scss',
  'ShellRoot.scss',
] as const

function readShellStyle(filename: string): string {
  return readFileSync(resolve(testDir, '../src/shell/layout', filename), 'utf8')
}

function readShellComponent(filename: string): string {
  return readFileSync(resolve(testDir, '../src/shell/layout', filename), 'utf8')
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

test('activity rail connects its decorative tooltip to labeled navigation controls', () => {
  const component = readShellComponent('ActivityRail.tsx')
  const styles = readShellStyle('ActivityRail.scss')

  assert.match(component, /data-tooltip=\{item\.label\}/)
  assert.match(styles, /\[data-tooltip\]:focus-visible::before/)
})

test('shell chrome panels join flush without rounded outer corners', () => {
  assert.match(
    readShellStyle('TopControlBar.scss'),
    /\.vb-top-control-bar\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?border-bottom:/,
  )
  assert.match(readShellStyle('TopControlBar.scss'), /&\.native-window-top\s*\{[\s\S]*?border-radius:\s*0;/)
  assert.match(
    readShellStyle('ActivityRail.scss'),
    /\.activity-rail\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?border-right:/,
  )
  assert.match(
    readShellStyle('StatusBar.scss'),
    /\.status-bar\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?border-top:/,
  )

  const shellStyles = readShellStyle('ShellRoot.scss')
  assert.match(shellStyles, /\.agent-shell\s*\{[\s\S]*?gap:\s*0;/)
  assert.match(shellStyles, /\.shell-main-layout\s*\{[\s\S]*?gap:\s*0;/)
  assert.match(shellStyles, /\.shell-left-pane\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?border-right:/)
  assert.match(shellStyles, /\.shell-status-wrapper\s*\{[\s\S]*?&::after\s*\{[\s\S]*?border-radius:\s*0;/)
})

test('pin dock chooser uses menu semantics and restores keyboard focus on escape', () => {
  const component = readShellComponent('TopControlBar.tsx')

  assert.match(component, /aria-haspopup=\{[^}]*'menu'/)
  assert.match(component, /role="menu"/)
  assert.match(component, /role="menuitem"/)
  assert.match(component, /event\.key !== 'Escape'/)
  assert.match(component, /pinDropdownTriggerRef\.current\?\.focus\(\)/)
})
