import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleStationScrollFrame } from '../src/features/workspace-hub/station-scroll-frame.js'
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

test('station scroll frame runs on the next animation frame and clears fallback', () => {
  const fake = createFakeScheduler()
  let scrollCount = 0
  const scrollFrame = scheduleStationScrollFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    scroll: () => {
      scrollCount += 1
    },
  })

  assert.equal(scrollFrame.handle?.frameId, 1)
  assert.equal(scrollFrame.handle?.timeoutId, 2)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 20)

  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(scrollCount, 1)
  assert.equal(scrollFrame.handle, null)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('station scroll frame falls back when animation frames are throttled', () => {
  const fake = createFakeScheduler()
  let scrollCount = 0
  const scrollFrame = scheduleStationScrollFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    scroll: () => {
      scrollCount += 1
    },
  })

  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(scrollCount, 1)
  assert.equal(scrollFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
})

test('station scroll frame cancellation clears pending callbacks', () => {
  const fake = createFakeScheduler()
  let scrollCount = 0
  const scrollFrame = scheduleStationScrollFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    scroll: () => {
      scrollCount += 1
    },
  })

  scrollFrame.cancel()
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(scrollCount, 0)
  assert.equal(scrollFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [2])
})
