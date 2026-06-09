import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

const modalStyleFiles = [
  {
    filename: 'StationManageModal.scss',
    expectedShadow: /box-shadow:\s*var\(--vb-shadow-lg\),\s*var\(--vb-shadow-inset\)/,
  },
  {
    filename: 'StationSearchModal.scss',
    expectedShadow: /box-shadow:\s*var\(--vb-shadow-lg\)/,
  },
] as const

function readWorkspaceHubStyle(filename: string): string {
  return readFileSync(resolve(testDir, '../../src/features/workspace-hub', filename), 'utf8')
}

test('workspace hub modal chrome uses theme tokens instead of fixed black overlays', () => {
  for (const { filename, expectedShadow } of modalStyleFiles) {
    const content = readWorkspaceHubStyle(filename)

    assert.doesNotMatch(content, /rgba\(\s*0,\s*0,\s*0/, `${filename} should not hardcode black rgba`)
    assert.match(
      content,
      /background:\s*color-mix\(in srgb, var\(--vb-bg\) 40%, transparent\)/,
      `${filename} should theme its backdrop through --vb-bg`,
    )
    assert.match(content, expectedShadow, `${filename} should use shared shadow tokens`)
  }
})
