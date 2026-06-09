import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveTerminalSerializeDelayMs,
  scheduleTerminalCaptureTaskFrameDrain,
  shouldScheduleRenderedScreenCapture,
  shouldReportRenderedScreenSnapshot,
  takeNextTerminalCaptureTask,
  type TerminalCaptureTaskKind,
} from '../src/features/terminal/station-terminal-capture-policy.js'
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

test('serializes immediately before the first capture', () => {
  assert.equal(resolveTerminalSerializeDelayMs(0, 5_000, 1_000), 0)
})

test('throttles repeated serialize requests until the minimum interval elapses', () => {
  assert.equal(resolveTerminalSerializeDelayMs(10_000, 10_250, 1_000), 750)
  assert.equal(resolveTerminalSerializeDelayMs(10_000, 11_000, 1_000), 0)
})

test('treats clock skew as no elapsed time instead of scheduling a negative delay', () => {
  assert.equal(resolveTerminalSerializeDelayMs(10_000, 9_500, 1_000), 1_000)
})

test('takes screen capture before serialize when both terminal capture tasks are pending', () => {
  const pending = new Set<TerminalCaptureTaskKind>(['serialize', 'screen'])

  assert.equal(takeNextTerminalCaptureTask(pending), 'screen')
  assert.equal(takeNextTerminalCaptureTask(pending), 'serialize')
  assert.equal(takeNextTerminalCaptureTask(pending), null)
})

test('terminal capture frame drain runs one task per settled frame', () => {
  const fake = createFakeScheduler()
  const pending = new Set<TerminalCaptureTaskKind>(['serialize', 'screen'])
  const tasks: TerminalCaptureTaskKind[] = []
  scheduleTerminalCaptureTaskFrameDrain({
    pending,
    scheduler: fake.scheduler,
    fallbackDelayMs: 18,
    runTask: (task) => {
      tasks.push(task)
    },
  })

  assert.equal(fake.timeoutCallbacks.get(2)?.delayMs, 18)
  fake.frameCallbacks.get(1)?.(16)

  assert.deepEqual(tasks, ['screen'])
  assert.equal(fake.timeoutCallbacks.get(4)?.delayMs, 18)
  fake.frameCallbacks.get(3)?.(32)

  assert.deepEqual(tasks, ['screen', 'serialize'])
  assert.deepEqual(fake.clearedTimeouts, [2, 4])
  assert.equal(pending.size, 0)
})

test('terminal capture frame drain advances through fallback when animation frames are throttled', () => {
  const fake = createFakeScheduler()
  const pending = new Set<TerminalCaptureTaskKind>(['serialize', 'screen'])
  const tasks: TerminalCaptureTaskKind[] = []
  scheduleTerminalCaptureTaskFrameDrain({
    pending,
    scheduler: fake.scheduler,
    fallbackDelayMs: 18,
    runTask: (task) => {
      tasks.push(task)
    },
  })

  fake.timeoutCallbacks.get(2)?.callback()
  fake.timeoutCallbacks.get(4)?.callback()
  fake.frameCallbacks.get(1)?.(16)
  fake.frameCallbacks.get(3)?.(32)

  assert.deepEqual(tasks, ['screen', 'serialize'])
  assert.deepEqual(fake.cancelledFrames, [1, 3])
  assert.equal(pending.size, 0)
})

test('terminal capture frame drain cancellation clears pending callbacks', () => {
  const fake = createFakeScheduler()
  const pending = new Set<TerminalCaptureTaskKind>(['screen'])
  const tasks: TerminalCaptureTaskKind[] = []
  const drain = scheduleTerminalCaptureTaskFrameDrain({
    pending,
    scheduler: fake.scheduler,
    fallbackDelayMs: 18,
    runTask: (task) => {
      tasks.push(task)
    },
  })

  drain.cancel()
  fake.frameCallbacks.get(1)?.(16)
  fake.timeoutCallbacks.get(2)?.callback()

  assert.deepEqual(tasks, [])
  assert.deepEqual(fake.cancelledFrames, [1])
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('terminal capture frame drain clears pending tasks when continuation stops', () => {
  const fake = createFakeScheduler()
  const pending = new Set<TerminalCaptureTaskKind>(['serialize', 'screen'])
  const tasks: TerminalCaptureTaskKind[] = []
  scheduleTerminalCaptureTaskFrameDrain({
    pending,
    scheduler: fake.scheduler,
    fallbackDelayMs: 18,
    shouldContinue: () => false,
    runTask: (task) => {
      tasks.push(task)
    },
  })

  fake.frameCallbacks.get(1)?.(16)

  assert.deepEqual(tasks, [])
  assert.equal(pending.size, 0)
  assert.deepEqual(fake.clearedTimeouts, [2])
})

test('schedules rendered screen capture only for active reportable terminals', () => {
  assert.equal(
    shouldScheduleRenderedScreenCapture({
      performanceDebugEnabled: false,
      isActive: true,
      hasRenderedScreenReporter: true,
    }),
    true,
  )
  assert.equal(
    shouldScheduleRenderedScreenCapture({
      performanceDebugEnabled: false,
      isActive: false,
      hasRenderedScreenReporter: true,
    }),
    false,
  )
  assert.equal(
    shouldScheduleRenderedScreenCapture({
      performanceDebugEnabled: true,
      isActive: true,
      hasRenderedScreenReporter: true,
    }),
    false,
  )
  assert.equal(
    shouldScheduleRenderedScreenCapture({
      performanceDebugEnabled: false,
      isActive: true,
      hasRenderedScreenReporter: false,
    }),
    false,
  )
})

test('reports rendered screen snapshots only once per workspace station session revision', () => {
  const lastReported = new Map<string, number>()
  const input = {
    lastReported,
    workspaceId: 'workspace-a',
    stationId: 'station-a',
    sessionId: 'session-a',
    screenRevision: 12,
  }

  assert.equal(shouldReportRenderedScreenSnapshot(input), true)
  assert.equal(shouldReportRenderedScreenSnapshot(input), false)
  assert.equal(
    shouldReportRenderedScreenSnapshot({
      ...input,
      screenRevision: 13,
    }),
    true,
  )
  assert.equal(
    shouldReportRenderedScreenSnapshot({
      ...input,
      sessionId: 'session-b',
      screenRevision: 12,
    }),
    true,
  )
})

test('rejects invalid rendered screen revisions without mutating report cache', () => {
  const lastReported = new Map<string, number>()

  assert.equal(
    shouldReportRenderedScreenSnapshot({
      lastReported,
      workspaceId: 'workspace-a',
      stationId: 'station-a',
      sessionId: 'session-a',
      screenRevision: 0,
    }),
    false,
  )
  assert.equal(lastReported.size, 0)
})

test('bounds rendered screen report cache while preserving newest revision', () => {
  const lastReported = new Map<string, number>()

  assert.equal(
    shouldReportRenderedScreenSnapshot({
      lastReported,
      workspaceId: 'workspace-a',
      stationId: 'station-a',
      sessionId: 'session-a',
      screenRevision: 1,
      maxEntries: 1,
    }),
    true,
  )
  assert.equal(
    shouldReportRenderedScreenSnapshot({
      lastReported,
      workspaceId: 'workspace-a',
      stationId: 'station-b',
      sessionId: 'session-b',
      screenRevision: 1,
      maxEntries: 1,
    }),
    true,
  )
  assert.equal(lastReported.size, 1)
  assert.deepEqual(Array.from(lastReported.values()), [1])
})
