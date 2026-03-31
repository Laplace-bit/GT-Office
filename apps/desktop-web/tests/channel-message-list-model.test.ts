import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveLatestChannelMessageScrollTop,
  resolveChannelRowEstimate,
  shouldAutoScrollChannelFeed,
} from '../src/features/tool-adapter/channel-message-list-model.js'

test('initial load should auto-scroll to latest message', () => {
  assert.equal(
    shouldAutoScrollChannelFeed({
      hasInitialAutoScroll: false,
      scrollHeight: 1600,
      scrollTop: 0,
      clientHeight: 480,
      threshold: 96,
    }),
    true,
  )
})

test('later updates should auto-scroll when near bottom threshold', () => {
  assert.equal(
    shouldAutoScrollChannelFeed({
      hasInitialAutoScroll: true,
      scrollHeight: 1000,
      scrollTop: 820,
      clientHeight: 120,
      threshold: 96,
    }),
    true,
  )
})

test('later updates should not auto-scroll when user is far from bottom', () => {
  assert.equal(
    shouldAutoScrollChannelFeed({
      hasInitialAutoScroll: true,
      scrollHeight: 1000,
      scrollTop: 300,
      clientHeight: 120,
      threshold: 96,
    }),
    false,
  )
})

test('row estimate uses layout-driven height when available', () => {
  assert.equal(resolveChannelRowEstimate(88, 42), 88)
})

test('scroll target aligns the latest message top when there is enough room below it', () => {
  assert.equal(
    resolveLatestChannelMessageScrollTop({
      latestMessageStart: 480,
      latestMessageHeight: 120,
      scrollHeight: 1000,
      clientHeight: 240,
    }),
    480,
  )
})

test('scroll target clamps to max scroll when the latest message start exceeds the scrollable range', () => {
  assert.equal(
    resolveLatestChannelMessageScrollTop({
      latestMessageStart: 920,
      latestMessageHeight: 120,
      scrollHeight: 1000,
      clientHeight: 240,
    }),
    760,
  )
})
