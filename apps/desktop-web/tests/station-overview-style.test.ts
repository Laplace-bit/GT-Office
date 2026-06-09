import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const stationOverviewScss = readFileSync(
  resolve(testDir, '../../src/features/workspace/StationOverviewPane.scss'),
  'utf8',
)

test('station overview styles use tokenized colors for active and dragging states', () => {
  assert.doesNotMatch(stationOverviewScss, /rgba\(/)
  assert.match(stationOverviewScss, /color-mix\(in srgb, var\(--vb-surface\) 18%, transparent\)/)
  assert.match(stationOverviewScss, /color-mix\(in srgb, var\(--vb-shadow\) 18%, transparent\)/)
})

test('station overview reduced motion disables nonessential transitions', () => {
  const reducedMotionBlock = stationOverviewScss.match(
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/,
  )?.[0] ?? ''

  assert.doesNotMatch(reducedMotionBlock, /0\.01ms/)
  assert.match(reducedMotionBlock, /transition: none !important/)
  assert.match(reducedMotionBlock, /animation: none !important/)
})
