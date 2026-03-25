import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCommandSheetInitialFocusTarget,
} from '../src/features/workspace-hub/station-action-command-sheet-focus.js'

test('focuses the first editable field when a sheet command starts with required inputs', () => {
  assert.equal(
    resolveCommandSheetInitialFocusTarget({
      hasEditableField: true,
      isSubmitDisabled: true,
    }),
    'field',
  )
})

test('falls back to close when there is no field and submit is disabled', () => {
  assert.equal(
    resolveCommandSheetInitialFocusTarget({
      hasEditableField: false,
      isSubmitDisabled: true,
    }),
    'close',
  )
})

test('uses submit when the sheet has no fields and submit is available', () => {
  assert.equal(
    resolveCommandSheetInitialFocusTarget({
      hasEditableField: false,
      isSubmitDisabled: false,
    }),
    'submit',
  )
})
