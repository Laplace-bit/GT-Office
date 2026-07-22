import test from 'node:test'
import assert from 'node:assert/strict'
import {
  focusStationTerminalSinkWithFrameRetry,
  scheduleStationTerminalFocusRetryFrame,
  shouldContinueStationTerminalFocusAttempt,
  resolveStationTerminalFocusRequest,
  shouldRequestStationTerminalAutoFocus,
  shouldConsumeInactiveStationTerminalMouseGesture,
  shouldFlushPendingStationTerminalFocus,
} from '../src/features/terminal/station-terminal-focus-runtime.js'
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

test('defers terminal focus requests until runtime helpers are ready', () => {
  assert.deepEqual(
    resolveStationTerminalFocusRequest({
      focusRuntimeReady: false,
    }),
    {
      shouldDispatch: false,
      shouldPersistPending: true,
    },
  )
})

test('dispatches terminal focus requests once runtime helpers are ready', () => {
  assert.deepEqual(
    resolveStationTerminalFocusRequest({
      focusRuntimeReady: true,
    }),
    {
      shouldDispatch: true,
      shouldPersistPending: false,
    },
  )
})

test('keeps the startup focus intent pending until the document is focused', () => {
  assert.deepEqual(
    resolveStationTerminalFocusRequest({
      focusRuntimeReady: true,
      documentFocused: false,
    }),
    {
      shouldDispatch: false,
      shouldPersistPending: true,
    },
  )
})

test('flushes pending terminal focus only after runtime helpers are ready', () => {
  assert.equal(
    shouldFlushPendingStationTerminalFocus({
      pendingAutoFocus: true,
      focusRuntimeReady: false,
    }),
    false,
  )

  assert.equal(
    shouldFlushPendingStationTerminalFocus({
      pendingAutoFocus: true,
      focusRuntimeReady: true,
    }),
    true,
  )

  assert.equal(
    shouldFlushPendingStationTerminalFocus({
      pendingAutoFocus: false,
      focusRuntimeReady: true,
    }),
    false,
  )
})

test('stops terminal focus retries once the station is no longer active or mounted', () => {
  assert.equal(
    shouldContinueStationTerminalFocusAttempt({
      componentMounted: true,
      stationActive: true,
    }),
    true,
  )

  assert.equal(
    shouldContinueStationTerminalFocusAttempt({
      componentMounted: true,
      stationActive: false,
    }),
    false,
  )

  assert.equal(
    shouldContinueStationTerminalFocusAttempt({
      componentMounted: false,
      stationActive: true,
    }),
    false,
  )
})

test('consumes the first primary mouse gesture while the terminal is inactive', () => {
  assert.equal(
    shouldConsumeInactiveStationTerminalMouseGesture({
      isActive: false,
      button: 0,
    }),
    true,
  )

  assert.equal(
    shouldConsumeInactiveStationTerminalMouseGesture({
      isActive: true,
      button: 0,
    }),
    false,
  )

  assert.equal(
    shouldConsumeInactiveStationTerminalMouseGesture({
      isActive: false,
      button: 1,
    }),
    false,
  )
})

test('requests terminal auto focus only when a station becomes active', () => {
  assert.equal(
    shouldRequestStationTerminalAutoFocus({
      previous: { active: false, sessionId: null },
      next: { active: true, sessionId: 'session-a' },
    }),
    true,
  )

  assert.equal(
    shouldRequestStationTerminalAutoFocus({
      previous: { active: true, sessionId: 'session-a' },
      next: { active: true, sessionId: 'session-b' },
    }),
    false,
  )

  assert.equal(
    shouldRequestStationTerminalAutoFocus({
      previous: { active: false, sessionId: 'session-a' },
      next: { active: false, sessionId: 'session-b' },
    }),
    false,
  )
})

test('requests terminal auto focus when the active station first receives a session', () => {
  assert.equal(
    shouldRequestStationTerminalAutoFocus({
      previous: { active: true, sessionId: null },
      next: { active: true, sessionId: 'session-a' },
    }),
    true,
  )
})

test('requests terminal auto focus when an active session becomes input-ready', () => {
  const transition = {
    previous: { active: true, sessionId: 'session-a', inputReady: false },
    next: { active: true, sessionId: 'session-a', inputReady: true },
  }

  assert.equal(shouldRequestStationTerminalAutoFocus(transition), true)
})

test('terminal focus retry frame runs on the next animation frame', () => {
  const fake = createFakeScheduler()
  let retryCount = 0
  const retryFrame = scheduleStationTerminalFocusRetryFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    retry: () => {
      retryCount += 1
    },
  })

  assert.equal(retryFrame.handle?.frameId, 1)
  assert.equal(retryFrame.handle?.timeoutId, 2)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 20)

  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(retryCount, 1)
  assert.equal(retryFrame.handle, null)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('terminal focus retry frame falls back when animation frames are throttled', () => {
  const fake = createFakeScheduler()
  let retryCount = 0
  const retryFrame = scheduleStationTerminalFocusRetryFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    retry: () => {
      retryCount += 1
    },
  })

  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(retryCount, 1)
  assert.equal(retryFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
})

test('terminal focus retry frame cancellation clears pending callbacks', () => {
  const fake = createFakeScheduler()
  let retryCount = 0
  const retryFrame = scheduleStationTerminalFocusRetryFrame({
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    retry: () => {
      retryCount += 1
    },
  })

  retryFrame.cancel()
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.equal(retryCount, 0)
  assert.equal(retryFrame.handle, null)
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('terminal sink focus retry returns immediately when focus succeeds', async () => {
  const fake = createFakeScheduler()
  let focusCount = 0
  const focused = await focusStationTerminalSinkWithFrameRetry({
    maxRetryFrames: 4,
    scheduler: fake.scheduler,
    focus: () => {
      focusCount += 1
      return true
    },
  })

  assert.equal(focused, true)
  assert.equal(focusCount, 1)
  assert.equal(fake.frameCallbacks.size, 0)
  assert.equal(fake.timeoutCallbacks.size, 0)
})

test('terminal sink focus retry succeeds after the next animation frame', async () => {
  const fake = createFakeScheduler()
  let focusCount = 0
  const focusTask = focusStationTerminalSinkWithFrameRetry({
    maxRetryFrames: 4,
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    focus: () => {
      focusCount += 1
      return focusCount >= 2
    },
  })

  await Promise.resolve()
  assert.equal(focusCount, 1)
  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 20)
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(await focusTask, true)
  assert.equal(focusCount, 2)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('terminal sink focus retry continues through fallback when animation frames are throttled', async () => {
  const fake = createFakeScheduler()
  let focusCount = 0
  const focusTask = focusStationTerminalSinkWithFrameRetry({
    maxRetryFrames: 4,
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    focus: () => {
      focusCount += 1
      return focusCount >= 2
    },
  })

  await Promise.resolve()
  fake.timeoutCallbacks.get(2)?.callback()
  fake.frameCallbacks.get(1)?.(16)

  assert.equal(await focusTask, true)
  assert.equal(focusCount, 2)
  assert.deepEqual(fake.cancelledFrames, [1])
})

test('terminal sink focus retry returns false after retry frames are exhausted', async () => {
  const fake = createFakeScheduler()
  let focusCount = 0
  const focusTask = focusStationTerminalSinkWithFrameRetry({
    maxRetryFrames: 2,
    scheduler: fake.scheduler,
    fallbackDelayMs: 20,
    focus: () => {
      focusCount += 1
      return false
    },
  })

  await Promise.resolve()
  fake.frameCallbacks.get(1)?.(16)
  await Promise.resolve()
  fake.frameCallbacks.get(3)?.(32)

  assert.equal(await focusTask, false)
  assert.equal(focusCount, 3)
  assert.deepEqual(fake.clearedTimeouts, [2, 4])
})
