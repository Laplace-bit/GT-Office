import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCustomCommandCapsuleOrderId,
  buildNextOrderedCommandCapsuleIdsForCustomSave,
  loadUiPreferences,
  resolveCustomCommandSaveModeForEdit,
} from '../src/shell/state/ui-preferences.js'

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

test('loadUiPreferences preserves legacy active custom capsules when ordered ids are absent', () => {
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
    const preferences = loadUiPreferences()

    assert.deepEqual(preferences.customCommandCapsulesByProvider.codex, [
      {
        id: 'review-diff',
        label: 'Review diff',
        text: 'Review the current diff and call out risks.',
        submitMode: 'insert',
        createdAt: 1710000000000,
      },
    ])
    assert.deepEqual(preferences.orderedCommandCapsuleIdsByProvider.codex, [
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

test('loadUiPreferences keeps save-only custom capsules inactive when explicit ordered ids omit them', () => {
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
      orderedCommandCapsuleIdsByProvider: {
        codex: ['preset:plan', 'preset:model'],
      },
      customCommandCapsulesByProvider: {
        codex: [
          {
            id: 'draft-note',
            label: 'Draft note',
            text: 'Draft a note for the current task.',
            submitMode: 'insert',
            createdAt: 1710000000001,
          },
        ],
      },
    }),
  ) as unknown as typeof window

  try {
    const preferences = loadUiPreferences()

    assert.deepEqual(preferences.customCommandCapsulesByProvider.codex, [
      {
        id: 'draft-note',
        label: 'Draft note',
        text: 'Draft a note for the current task.',
        submitMode: 'insert',
        createdAt: 1710000000001,
      },
    ])
    assert.deepEqual(preferences.orderedCommandCapsuleIdsByProvider.codex, [
      'preset:plan',
      'preset:model',
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

test('buildNextOrderedCommandCapsuleIdsForCustomSave covers save-and-add, save-only, and edit-preserve semantics', () => {
  const activeOrderId = buildCustomCommandCapsuleOrderId('review-diff')
  const savedOnlyOrderId = buildCustomCommandCapsuleOrderId('draft-note')

  assert.deepEqual(
    buildNextOrderedCommandCapsuleIdsForCustomSave([activeOrderId], 'draft-note', 'save-only'),
    [activeOrderId],
  )
  assert.deepEqual(
    buildNextOrderedCommandCapsuleIdsForCustomSave([activeOrderId], 'draft-note', 'save-and-add'),
    [activeOrderId, savedOnlyOrderId],
  )
  assert.deepEqual(
    buildNextOrderedCommandCapsuleIdsForCustomSave([activeOrderId], 'review-diff', 'save-and-add'),
    [activeOrderId],
  )
})

test('resolveCustomCommandSaveModeForEdit preserves inactive edits as save-only', () => {
  const activeOrderId = buildCustomCommandCapsuleOrderId('review-diff')

  assert.equal(
    resolveCustomCommandSaveModeForEdit([activeOrderId], 'review-diff'),
    'save-and-add',
  )
  assert.equal(
    resolveCustomCommandSaveModeForEdit([activeOrderId], 'draft-note'),
    'save-only',
  )
})
