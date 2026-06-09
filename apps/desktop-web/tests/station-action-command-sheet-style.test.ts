import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const commandSheetScss = readFileSync(
  resolve(testDir, '../../src/features/workspace-hub/StationActionCommandSheet.scss'),
  'utf8',
)

test('station action command sheet chrome uses theme tokens instead of fixed dark overlays', () => {
  assert.doesNotMatch(commandSheetScss, /rgba\(\s*5,\s*8,\s*18/)
  assert.doesNotMatch(commandSheetScss, /color-mix\(in srgb,\s*var\(--vb-(?:accent|warning)\)[^)]*,\s*black/)
  assert.match(commandSheetScss, /background:\s*color-mix\(in srgb, var\(--vb-bg\) 56%, transparent\)/)
  assert.match(commandSheetScss, /var\(--vb-shadow-lg\)/)
  assert.match(commandSheetScss, /var\(--vb-shadow-inset\)/)
  assert.match(commandSheetScss, /var\(--vb-bg\) 12%\)/)
  assert.match(commandSheetScss, /var\(--vb-bg\) 22%\)/)
})

test('station action command sheet reduced motion removes active scale movement', () => {
  const block =
    commandSheetScss.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.notEqual(block, '', 'command sheet should define a reduced-motion block')
  assert.match(block, /transition: none !important;/)
  assert.match(
    block,
    /\.station-action-command-sheet-close:active,[\s\S]*\.station-action-command-sheet-primary:active:not\(:disabled\) \{[\s\S]*transform: none !important;/,
  )
})
