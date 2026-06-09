import test from 'node:test'
import assert from 'node:assert/strict'
import { submitStationTerminalWithFrameRetry } from '../src/features/terminal/station-terminal-submit-retry.js'
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

test('station terminal submit retry returns immediately when submit succeeds', async () => {
  const fake = createFakeScheduler()
  let submitCount = 0
  const submitted = await submitStationTerminalWithFrameRetry({
    maxRetryFrames: 4,
    scheduler: fake.scheduler,
    submit: () => {
      submitCount += 1
      return true
    },
  })

  assert.equal(submitted, true)
  assert.equal(submitCount, 1)
  assert.equal(fake.frameCallbacks.size, 0)
  assert.equal(fake.timeoutCallbacks.size, 0)
})

test('station terminal submit retry succeeds after the next animation frame', async () => {
  const fake = createFakeScheduler()
  let submitCount = 0
  const submitTask = submitStationTerminalWithFrameRetry({
    maxRetryFrames: 4,
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    submit: () => {
      submitCount += 1
      return submitCount >= 2
    },
  })

  await Promise.resolve()
  assert.equal(submitCount, 1)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 20)

  fake.frameCallbacks.get(1)?.(16)
  assert.equal(await submitTask, true)
  assert.equal(submitCount, 2)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('station terminal submit retry continues through fallback when animation frames are throttled', async () => {
  const fake = createFakeScheduler()
  let submitCount = 0
  const submitTask = submitStationTerminalWithFrameRetry({
    maxRetryFrames: 4,
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    submit: () => {
      submitCount += 1
      return submitCount >= 2
    },
  })

  await Promise.resolve()
  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(await submitTask, true)
  assert.equal(submitCount, 2)
  assert.deepEqual(fake.cancelledFrames, [1])
})

test('station terminal submit retry returns false after retry frames are exhausted', async () => {
  const fake = createFakeScheduler()
  let submitCount = 0
  const submitTask = submitStationTerminalWithFrameRetry({
    maxRetryFrames: 2,
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    submit: () => {
      submitCount += 1
      return false
    },
  })

  await Promise.resolve()
  fake.frameCallbacks.get(1)?.(16)
  await Promise.resolve()
  fake.frameCallbacks.get(3)?.(32)

  assert.equal(await submitTask, false)
  assert.equal(submitCount, 3)
  assert.deepEqual(fake.clearedTimeouts, [2, 4])
})
