import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultUiPreferences, loadUiPreferences } from '../src/shell/state/ui-preferences.js'

function createStorageWindow(raw: string | null) {
  return {
    localStorage: {
      getItem(key: string) {
        return key === 'gtoffice.ui.preferences.v1' ? raw : null
      },
      setItem() {},
      removeItem() {},
    },
  }
}

test('loadUiPreferences migrates preset ids into ordered capsule ids and preserves custom capsules', () => {
  const previousWindow = globalThis.window

  globalThis.window = createStorageWindow(
    JSON.stringify({
      quickCommandVisibilityByProvider: {
        claude: true,
        codex: true,
        gemini: true,
      },
      pinnedCommandIdsByProvider: {
        codex: ['plan', 'model'],
      },
      customCommandCapsulesByProvider: {
        codex: [
          {
            id: 'review-diff',
            label: 'Review diff',
            text: 'Review the current diff and call out risks.',
            submitMode: 'insert',
            createdAt: 1710000000000,
          },
        ],
      },
    }),
  ) as unknown as typeof window

  try {
    const preferences = loadUiPreferences() as typeof defaultUiPreferences & {
      customCommandCapsulesByProvider?: Record<string, unknown[]>
      orderedCommandCapsuleIdsByProvider?: Record<string, string[]>
    }

    assert.deepEqual(preferences.customCommandCapsulesByProvider?.codex, [
      {
        id: 'review-diff',
        label: 'Review diff',
        text: 'Review the current diff and call out risks.',
        submitMode: 'insert',
        createdAt: 1710000000000,
      },
    ])
    assert.deepEqual(preferences.orderedCommandCapsuleIdsByProvider?.codex, [
      'preset:plan',
      'preset:model',
      'custom:review-diff',
    ])
  } finally {
    if (previousWindow === undefined) {
      // @ts-expect-error test cleanup for window-less runtime
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})
