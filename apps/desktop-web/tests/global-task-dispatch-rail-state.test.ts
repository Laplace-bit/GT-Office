import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampQuickDispatchRailPosition,
  parseQuickDispatchRailSnapshot,
  resolveQuickDispatchRailExpandedState,
  resolveDefaultQuickDispatchRailPosition,
  shouldExpandQuickDispatchRail,
} from '../src/features/task-center/global-task-dispatch-rail-state.js'

test('keeps the quick dispatch rail compact for an empty draft', () => {
  assert.equal(
    shouldExpandQuickDispatchRail({
      focused: false,
      markdown: '',
      sending: false,
      hasNotice: false,
      targetPickerOpen: false,
      mentionOpen: false,
    }),
    false,
  )
})

test('keeps the quick dispatch rail compact when the empty composer is only focused', () => {
  assert.equal(
    shouldExpandQuickDispatchRail({
      focused: true,
      markdown: '',
      sending: false,
      hasNotice: false,
      targetPickerOpen: false,
      mentionOpen: false,
    }),
    false,
  )
})

test('expands the quick dispatch rail when the draft already has content', () => {
  assert.equal(
    shouldExpandQuickDispatchRail({
      focused: false,
      markdown: '整理当前问题并分派',
      sending: false,
      hasNotice: false,
      targetPickerOpen: false,
      mentionOpen: false,
    }),
    true,
  )
})

test('places the default quick dispatch rail near the bottom-right corner', () => {
  assert.deepEqual(
    resolveDefaultQuickDispatchRailPosition({
      viewportWidth: 1440,
      viewportHeight: 900,
      railWidth: 448,
      railHeight: 148,
      margin: 20,
    }),
    {
      left: 972,
      top: 732,
    },
  )
})

test('clamps a remembered rail position back inside the viewport', () => {
  assert.deepEqual(
    clampQuickDispatchRailPosition({
      position: {
        left: 1600,
        top: -50,
      },
      viewportWidth: 1280,
      viewportHeight: 800,
      railWidth: 448,
      railHeight: 220,
      margin: 20,
    }),
    {
      left: 812,
      top: 20,
    },
  )
})

test('ignores malformed quick dispatch rail snapshots', () => {
  assert.equal(parseQuickDispatchRailSnapshot('{"version":1,"position":{"left":"oops"}}'), null)
})

test('keeps the rail expanded while the composer stays focused after content was entered', () => {
  const afterTyping = resolveQuickDispatchRailExpandedState({
    retainedWhileFocused: false,
    focused: true,
    markdown: '拆分当前任务',
    sending: false,
    hasNotice: false,
    targetPickerOpen: false,
    mentionOpen: false,
  })

  assert.deepEqual(afterTyping, {
    expanded: true,
    retainedWhileFocused: true,
  })

  assert.deepEqual(
    resolveQuickDispatchRailExpandedState({
      retainedWhileFocused: afterTyping.retainedWhileFocused,
      focused: true,
      markdown: '',
      sending: false,
      hasNotice: false,
      targetPickerOpen: false,
      mentionOpen: false,
    }),
    {
      expanded: true,
      retainedWhileFocused: true,
    },
  )
})

test('releases the retained expanded state once the empty composer loses focus', () => {
  assert.deepEqual(
    resolveQuickDispatchRailExpandedState({
      retainedWhileFocused: true,
      focused: false,
      markdown: '',
      sending: false,
      hasNotice: false,
      targetPickerOpen: false,
      mentionOpen: false,
    }),
    {
      expanded: false,
      retainedWhileFocused: false,
    },
  )
})
