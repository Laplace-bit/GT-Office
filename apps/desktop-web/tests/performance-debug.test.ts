import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultPerformanceDebugState,
  loadPerformanceDebugState,
  savePerformanceDebugState,
} from '../src/shell/state/performance-debug.js'

function createStorageWindow(raw: string | null) {
  const storage = new Map<string, string>()
  if (raw !== null) {
    storage.set('gtoffice.performance.debug.v1', raw)
  }
  return {
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null
      },
      setItem(key: string, value: string) {
        storage.set(key, value)
      },
      removeItem(key: string) {
        storage.delete(key)
      },
    },
  }
}

test('loadPerformanceDebugState defaults to disabled when storage is empty', () => {
  const previousWindow = globalThis.window
  globalThis.window = createStorageWindow(null) as unknown as typeof window

  try {
    assert.deepEqual(loadPerformanceDebugState(), defaultPerformanceDebugState)
  } finally {
    if (previousWindow === undefined) {
      // @ts-expect-error test cleanup for window-less runtime
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})

test('savePerformanceDebugState persists the current toggle state', () => {
  const previousWindow = globalThis.window
  const nextWindow = createStorageWindow(null) as unknown as typeof window
  globalThis.window = nextWindow

  try {
    savePerformanceDebugState({
      enabled: true,
    })

    assert.deepEqual(loadPerformanceDebugState(), {
      enabled: true,
    })
  } finally {
    if (previousWindow === undefined) {
      // @ts-expect-error test cleanup for window-less runtime
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})
