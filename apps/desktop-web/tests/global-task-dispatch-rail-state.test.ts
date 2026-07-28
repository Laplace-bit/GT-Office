import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampQuickDispatchRailPosition,
  parseQuickDispatchRailPrefs,
  parseQuickDispatchRailSnapshot,
  resolveDefaultTaskTargetIds,
  resolveTaskTargetIdsForDispatch,
  resolveQuickDispatchRailExpandedState,
  resolveDefaultQuickDispatchRailPosition,
  serializeQuickDispatchRailPrefs,
  shouldExpandQuickDispatchRail,
} from '../src/features/task-center/global-task-dispatch-rail-state.js'
import { normalizeTaskQuickDispatchOpacity } from '../src/features/task-center/task-center-model.js'

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

test('parses v2 prefs for enter-to-send, pin, and follow-active', () => {
  const prefs = parseQuickDispatchRailPrefs(
    JSON.stringify({
      version: 2,
      enterToSend: true,
      pinned: true,
      followActiveAgent: false,
    }),
  )
  assert.deepEqual(prefs, {
    position: null,
    enterToSend: true,
    pinned: true,
    followActiveAgent: false,
  })
})

test('round-trips quick dispatch prefs including position', () => {
  const raw = serializeQuickDispatchRailPrefs({
    position: { left: 120, top: 80 },
    enterToSend: true,
    pinned: false,
    followActiveAgent: true,
  })
  assert.deepEqual(parseQuickDispatchRailPrefs(raw), {
    position: { left: 120, top: 80 },
    enterToSend: true,
    pinned: false,
    followActiveAgent: true,
  })
})

test('defaults empty targets to the active agent', () => {
  assert.deepEqual(
    resolveDefaultTaskTargetIds(
      [{ id: 'a' }, { id: 'b' }],
      'b',
      [],
    ),
    ['b'],
  )
})

test('keeps an existing valid multi-target selection', () => {
  assert.deepEqual(
    resolveDefaultTaskTargetIds(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      'a',
      ['c', 'b'],
    ),
    ['c', 'b'],
  )
})

test('follow-active mode always locks to the active agent', () => {
  assert.deepEqual(
    resolveTaskTargetIdsForDispatch({
      stations: [{ id: 'a' }, { id: 'b' }],
      activeStationId: 'b',
      currentTargetIds: ['a'],
      followActiveAgent: true,
    }),
    ['b'],
  )
})

test('non-follow mode keeps a manual selection', () => {
  assert.deepEqual(
    resolveTaskTargetIdsForDispatch({
      stations: [{ id: 'a' }, { id: 'b' }],
      activeStationId: 'b',
      currentTargetIds: ['a'],
      followActiveAgent: false,
    }),
    ['a'],
  )
})

test('opacity can be fully transparent or fully solid', () => {
  assert.equal(normalizeTaskQuickDispatchOpacity(0), 0)
  assert.equal(normalizeTaskQuickDispatchOpacity(1), 1)
  assert.equal(normalizeTaskQuickDispatchOpacity(-1), 0)
  assert.equal(normalizeTaskQuickDispatchOpacity(2), 1)
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
