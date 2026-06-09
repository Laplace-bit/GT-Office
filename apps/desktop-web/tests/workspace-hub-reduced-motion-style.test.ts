import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

const reducedMotionStyleFiles = [
  'StationManageModal.scss',
  'StationForceCloseConfirmDialog.scss',
  'StationSearchModal.scss',
  'StationActionDock.scss',
] as const

function readWorkspaceHubStyle(filename: string): string {
  return readFileSync(resolve(testDir, '../../src/features/workspace-hub', filename), 'utf8')
}

function reducedMotionBlock(content: string): string {
  return content.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? ''
}

test('workspace hub reduced motion styles disable nonessential motion instead of using tiny durations', () => {
  for (const filename of reducedMotionStyleFiles) {
    const content = readWorkspaceHubStyle(filename)
    const block = reducedMotionBlock(content)

    assert.notEqual(block, '', `${filename} should define a reduced-motion block`)
    assert.doesNotMatch(block, /0\.01ms/, `${filename} should not fake reduced motion with tiny durations`)
    assert.match(block, /(?:transition|animation): none !important/, `${filename} should disable nonessential motion`)
  }
})
