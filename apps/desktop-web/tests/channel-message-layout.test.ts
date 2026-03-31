import test from 'node:test'
import assert from 'node:assert/strict'
import { computeChannelMessageLayout } from '../src/features/tool-adapter/channel-message-layout.js'

const baseLayoutInput = {
  content: 'Preview updated. Final reply will only append the delta once validation passes.',
  detail: null,
  uiFont: 'sf-pro',
  maxContentWidth: 280,
  contentFont: '500 12px "Helvetica Neue"',
  detailFont: '500 11px "Helvetica Neue"',
  contentLineHeight: 17.4,
  detailLineHeight: 14.85,
  bubblePaddingX: 12,
  bubblePaddingY: 10,
  bubbleBorderWidth: 1,
  direction: 'inbound',
  status: 'received',
}

test('tight width preserves wrapped line count', () => {
  const layout = computeChannelMessageLayout({ ...baseLayoutInput })

  assert.equal(layout.usedFallback, false)
  assert.equal(layout.tightLineCount, layout.maxWidthLineCount)
  assert.ok(layout.bubbleWidth <= layout.maxBubbleWidth)
})

test('row height grows when detail text is present', () => {
  const withoutDetail = computeChannelMessageLayout({ ...baseLayoutInput, detail: null, status: 'received' })
  const withDetail = computeChannelMessageLayout({
    ...baseLayoutInput,
    detail: 'Webhook rejected preview update.',
    status: 'failed',
  })

  assert.ok(withDetail.bubbleHeight > withoutDetail.bubbleHeight)
})

test('system-ui forces fallback sizing', () => {
  const layout = computeChannelMessageLayout({
    ...baseLayoutInput,
    uiFont: 'system-ui',
    contentFont: '500 12px system-ui',
    detailFont: '500 11px system-ui',
    direction: 'outbound',
    status: 'sent',
  })

  assert.equal(layout.usedFallback, true)
  assert.equal(layout.bubbleWidth, layout.maxBubbleWidth)
})
