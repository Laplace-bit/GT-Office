import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRecycleStationTerminalRenderer } from '../src/features/terminal/station-terminal-render-recovery.js'

test('recycles the renderer when content exists but no render event arrived after wake', () => {
  assert.equal(
    shouldRecycleStationTerminalRenderer({
      hasMeaningfulContent: true,
      hasSerializedRestoreState: false,
      renderEventSeqAtSchedule: 4,
      currentRenderEventSeq: 4,
    }),
    true,
  )
})

test('recycles the renderer when serialized restore state exists but the live buffer is blank', () => {
  assert.equal(
    shouldRecycleStationTerminalRenderer({
      hasMeaningfulContent: false,
      hasSerializedRestoreState: true,
      renderEventSeqAtSchedule: 9,
      currentRenderEventSeq: 9,
    }),
    true,
  )
})

test('does not recycle once rendering resumed after wake', () => {
  assert.equal(
    shouldRecycleStationTerminalRenderer({
      hasMeaningfulContent: true,
      hasSerializedRestoreState: true,
      renderEventSeqAtSchedule: 12,
      currentRenderEventSeq: 13,
    }),
    false,
  )
})

test('does not recycle empty terminals that have nothing to restore', () => {
  assert.equal(
    shouldRecycleStationTerminalRenderer({
      hasMeaningfulContent: false,
      hasSerializedRestoreState: false,
      renderEventSeqAtSchedule: 2,
      currentRenderEventSeq: 2,
    }),
    false,
  )
})
