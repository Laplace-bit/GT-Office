import test from 'node:test'
import assert from 'node:assert/strict'
import {
  scheduleStationTerminalAppearanceSyncFrame,
  scheduleStationTerminalRenderRefreshFrame,
  scheduleStationTerminalRendererRecoveryFrameDrain,
  shouldRecycleStationTerminalRenderer,
} from '../src/features/terminal/station-terminal-render-recovery.js'
import type { StationTerminalFrameFlushScheduler } from '../src/features/terminal/station-terminal-frame-flush-scheduler.js'

function createFakeScheduler() {
  let nextId = 1
  const frameCallbacks = new Map<number, FrameRequestCallback>()
  const timeoutCallbacks = new Map<number, { callback: () => void; delayMs: number }>()
  const cancelledFrames: number[] = []
  const clearedTimeouts: number[] = []
  const scheduler: StationTerminalFrameFlushScheduler = {
    requestAnimationFrame: (callback) => {
      const id = nextId
      nextId += 1
      frameCallbacks.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id) => {
      cancelledFrames.push(id)
      frameCallbacks.delete(id)
    },
    setTimeout: (callback, delayMs) => {
      const id = nextId
      nextId += 1
      timeoutCallbacks.set(id, { callback, delayMs })
      return id
    },
    clearTimeout: (id) => {
      clearedTimeouts.push(id)
      timeoutCallbacks.delete(id)
    },
  }

  return {
    scheduler,
    frameCallbacks,
    timeoutCallbacks,
    cancelledFrames,
    clearedTimeouts,
  }
}

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

test('render refresh frame runs on the next animation frame and clears fallback', () => {
  const fake = createFakeScheduler()
  let refreshCount = 0
  const refreshFrame = scheduleStationTerminalRenderRefreshFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    run: () => {
      refreshCount += 1
    },
  })

  assert.equal(refreshFrame.handle?.frameId, 1)
  assert.equal(refreshFrame.handle?.timeoutId, 2)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 20)
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(refreshCount, 1)
  assert.equal(refreshFrame.handle, null)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('render refresh frame falls back when animation frames are throttled', () => {
  const fake = createFakeScheduler()
  let refreshCount = 0
  const refreshFrame = scheduleStationTerminalRenderRefreshFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    run: () => {
      refreshCount += 1
    },
  })

  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(refreshCount, 1)
  assert.equal(refreshFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
})

test('render refresh frame cancellation clears pending callbacks', () => {
  const fake = createFakeScheduler()
  let refreshCount = 0
  const refreshFrame = scheduleStationTerminalRenderRefreshFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    run: () => {
      refreshCount += 1
    },
  })

  refreshFrame.cancel()
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(refreshCount, 0)
  assert.equal(refreshFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('appearance sync frame runs on the next animation frame and clears fallback', () => {
  const fake = createFakeScheduler()
  let syncCount = 0
  const syncFrame = scheduleStationTerminalAppearanceSyncFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    run: () => {
      syncCount += 1
    },
  })

  assert.equal(syncFrame.handle?.frameId, 1)
  assert.equal(syncFrame.handle?.timeoutId, 2)
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(syncCount, 1)
  assert.equal(syncFrame.handle, null)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('appearance sync frame falls back when animation frames are throttled', () => {
  const fake = createFakeScheduler()
  let syncCount = 0
  const syncFrame = scheduleStationTerminalAppearanceSyncFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    run: () => {
      syncCount += 1
    },
  })

  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(syncCount, 1)
  assert.equal(syncFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
})

test('appearance sync frame cancellation clears pending callbacks', () => {
  const fake = createFakeScheduler()
  let syncCount = 0
  const syncFrame = scheduleStationTerminalAppearanceSyncFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    run: () => {
      syncCount += 1
    },
  })

  syncFrame.cancel()
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(syncCount, 0)
  assert.equal(syncFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('renderer recovery frame drain waits for the requested frame count', () => {
  const fake = createFakeScheduler()
  let settledCount = 0
  scheduleStationTerminalRendererRecoveryFrameDrain(
    () => {
      settledCount += 1
    },
    {
      frameCount: 2,
      scheduler: fake.scheduler,
      fallbackDelayMs: 20,
    },
  )

  assert.equal(settledCount, 0)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 20)
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(settledCount, 0)
  assert.equal(fake.timeoutCallbacks.get(4)?.delayMs, 20)
  fake.frameCallbacks.get(3)?.(32)

  assert.equal(settledCount, 1)
  assert.deepEqual(fake.clearedTimeouts, [2, 4])
})

test('renderer recovery frame drain advances through fallback when animation frames are throttled', () => {
  const fake = createFakeScheduler()
  let settledCount = 0
  scheduleStationTerminalRendererRecoveryFrameDrain(
    () => {
      settledCount += 1
    },
    {
      frameCount: 2,
      scheduler: fake.scheduler,
      fallbackDelayMs: 20,
    },
  )

  fake.timeoutCallbacks.get(2)?.callback()
  assert.equal(settledCount, 0)
  fake.timeoutCallbacks.get(4)?.callback()
  fake.frameCallbacks.get(1)?.(16)
  fake.frameCallbacks.get(3)?.(32)

  assert.equal(settledCount, 1)
  assert.deepEqual(fake.cancelledFrames, [1, 3])
})

test('renderer recovery frame drain cancellation clears pending callbacks', () => {
  const fake = createFakeScheduler()
  let settledCount = 0
  const drain = scheduleStationTerminalRendererRecoveryFrameDrain(
    () => {
      settledCount += 1
    },
    {
      frameCount: 1,
      scheduler: fake.scheduler,
      fallbackDelayMs: 20,
    },
  )

  drain.cancel()
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(settledCount, 0)
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('renderer recovery frame drain settles immediately for invalid frame counts', () => {
  const fake = createFakeScheduler()
  let settledCount = 0
  scheduleStationTerminalRendererRecoveryFrameDrain(
    () => {
      settledCount += 1
    },
    {
      frameCount: Number.NaN,
      scheduler: fake.scheduler,
      fallbackDelayMs: 20,
    },
  )

  assert.equal(settledCount, 1)
  assert.equal(fake.frameCallbacks.size, 0)
  assert.equal(fake.timeoutCallbacks.size, 0)
})
