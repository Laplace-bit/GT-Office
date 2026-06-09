import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cancelStationTerminalFrameFlush,
  createStationTerminalFrameFlushScheduler,
  scheduleStationTerminalFrameFlush,
  STATION_TERMINAL_FRAME_FLUSH_FALLBACK_MS,
  waitForStationTerminalFrameFlush,
  type StationTerminalFrameFlushScheduler,
} from '../src/features/terminal/station-terminal-frame-flush-scheduler.js'

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

test('station terminal frame flush uses the next animation frame and clears the fallback timer', () => {
  const fake = createFakeScheduler()
  let runCount = 0
  const handle = scheduleStationTerminalFrameFlush(() => {
    runCount += 1
  }, fake.scheduler)

  assert.equal(handle.frameId, 1)
  assert.equal(handle.timeoutId, 2)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, STATION_TERMINAL_FRAME_FLUSH_FALLBACK_MS)

  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(runCount, 1)
  assert.deepEqual(fake.clearedTimeouts, [2])
  assert.deepEqual(fake.cancelledFrames, [])
})

test('station terminal frame flush falls back when animation frames are throttled', () => {
  const fake = createFakeScheduler()
  let runCount = 0
  const handle = scheduleStationTerminalFrameFlush(() => {
    runCount += 1
  }, fake.scheduler, 12)

  assert.equal(handle.frameId, 1)
  assert.equal(handle.timeoutId, 2)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 12)

  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(32)

  assert.equal(runCount, 1)
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [])
})

test('station terminal frame flush runs active output fallback only once when the frame arrives late', () => {
  const fake = createFakeScheduler()
  const flushedEntries: string[] = []
  scheduleStationTerminalFrameFlush(() => {
    flushedEntries.push('active-output')
  }, fake.scheduler, 48)

  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(64)

  assert.deepEqual(flushedEntries, ['active-output'])
  assert.deepEqual(fake.cancelledFrames, [1])
})

test('cancelling station terminal frame flush clears both scheduled callbacks', () => {
  const fake = createFakeScheduler()
  let runCount = 0
  const handle = scheduleStationTerminalFrameFlush(() => {
    runCount += 1
  }, fake.scheduler)

  cancelStationTerminalFrameFlush(handle)
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(runCount, 0)
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('station terminal frame flush normalizes invalid fallback delays', () => {
  const fake = createFakeScheduler()
  scheduleStationTerminalFrameFlush(() => {}, fake.scheduler, Number.NaN)

  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 0)
})

test('station terminal frame flush scheduler delegates to the provided window', () => {
  const calls: string[] = []
  const scheduler = createStationTerminalFrameFlushScheduler({
    requestAnimationFrame: () => {
      calls.push('request-frame')
      return 11
    },
    cancelAnimationFrame: (id) => {
      calls.push(`cancel-frame:${id}`)
    },
    setTimeout: (_callback, delayMs) => {
      calls.push(`set-timeout:${delayMs}`)
      return 12
    },
    clearTimeout: (id) => {
      calls.push(`clear-timeout:${id}`)
    },
  })

  const handle = scheduleStationTerminalFrameFlush(() => {}, scheduler, 24)
  cancelStationTerminalFrameFlush(handle)

  assert.deepEqual(calls, ['request-frame', 'set-timeout:24', 'cancel-frame:11', 'clear-timeout:12'])
})

test('station terminal frame wait resolves on the next animation frame', async () => {
  const fake = createFakeScheduler()
  let resolved = false
  const wait = waitForStationTerminalFrameFlush(fake.scheduler).then(() => {
    resolved = true
  })

  await Promise.resolve()
  assert.equal(resolved, false)
  fake.frameCallbacks.get(1)?.(16)
  await wait

  assert.equal(resolved, true)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('station terminal frame wait resolves through fallback when frames are throttled', async () => {
  const fake = createFakeScheduler()
  let resolveCount = 0
  const wait = waitForStationTerminalFrameFlush(fake.scheduler, 20).then(() => {
    resolveCount += 1
  })

  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 20)
  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(32)
  await wait

  assert.equal(resolveCount, 1)
  assert.deepEqual(fake.cancelledFrames, [1])
})
