import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CHANNEL_MESSAGE_COLLAPSE_CHAR_LIMIT,
  DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
  DEFAULT_CHANNEL_MESSAGE_TOGGLE_HEIGHT,
  resolveChannelMessageToggleReserveHeight,
  shouldAllowChannelMessageCollapse,
} from '../src/features/tool-adapter/channel-message-bubble-model.js'

test('does not collapse short messages within the line limit', () => {
  assert.equal(
    shouldAllowChannelMessageCollapse({
      contentLength: 48,
      lineCount: 2,
      charLimit: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_CHAR_LIMIT,
      lineLimit: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
    }),
    false,
  )
})

test('collapses messages that exceed the character limit', () => {
  assert.equal(
    shouldAllowChannelMessageCollapse({
      contentLength: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_CHAR_LIMIT + 1,
      lineCount: 3,
      charLimit: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_CHAR_LIMIT,
      lineLimit: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
    }),
    true,
  )
})

test('collapses messages that exceed the line limit even if the text is shorter', () => {
  assert.equal(
    shouldAllowChannelMessageCollapse({
      contentLength: 90,
      lineCount: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT + 1,
      charLimit: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_CHAR_LIMIT,
      lineLimit: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
    }),
    true,
  )
})

test('reserves toggle height only when collapse affordance is visible', () => {
  assert.equal(resolveChannelMessageToggleReserveHeight(true), DEFAULT_CHANNEL_MESSAGE_TOGGLE_HEIGHT)
  assert.equal(resolveChannelMessageToggleReserveHeight(false), 0)
})
