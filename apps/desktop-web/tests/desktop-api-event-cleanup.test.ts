import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSafeAsyncCleanup,
  runAsyncCleanupSafely,
} from '../src/shell/integration/desktop-api.js'

test('runAsyncCleanupSafely executes cleanups and suppresses teardown failures', async (t) => {
  const steps: string[] = []
  const unhandled: unknown[] = []
  const handleUnhandledRejection = (reason: unknown) => {
    unhandled.push(reason)
  }

  process.on('unhandledRejection', handleUnhandledRejection)
  t.after(() => {
    process.off('unhandledRejection', handleUnhandledRejection)
  })

  runAsyncCleanupSafely([
    () => {
      steps.push('sync-ok')
    },
    () => {
      steps.push('sync-throw')
      throw new Error('sync boom')
    },
    async () => {
      steps.push('async-ok')
    },
    async () => {
      steps.push('async-throw')
      throw new Error('async boom')
    },
    null,
    undefined,
  ])

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(steps, ['sync-ok', 'sync-throw', 'async-ok', 'async-throw'])
  assert.equal(unhandled.length, 0)
})

test('createSafeAsyncCleanup is idempotent and suppresses repeated teardown failures', async (t) => {
  const steps: string[] = []
  const unhandled: unknown[] = []
  const handleUnhandledRejection = (reason: unknown) => {
    unhandled.push(reason)
  }

  process.on('unhandledRejection', handleUnhandledRejection)
  t.after(() => {
    process.off('unhandledRejection', handleUnhandledRejection)
  })

  const cleanup = createSafeAsyncCleanup([
    async () => {
      steps.push('teardown')
      throw new Error('listener already removed')
    },
  ])

  cleanup()
  cleanup()

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(steps, ['teardown'])
  assert.equal(unhandled.length, 0)
})
