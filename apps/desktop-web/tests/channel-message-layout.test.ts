import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

type UiFont = 'sf-pro' | 'ibm-plex' | 'system-ui'
type MessageDirection = 'inbound' | 'outbound'
type MessageStatus = 'received' | 'sent' | 'failed'

type ChannelMessageLayoutInput = {
  content: string
  detail: string | null
  uiFont: UiFont
  maxContentWidth: number
  contentFont: string
  detailFont: string
  contentLineHeight: number
  detailLineHeight: number
  bubblePaddingX: number
  bubblePaddingY: number
  bubbleBorderWidth: number
  direction: MessageDirection
  status: MessageStatus
}

type ChannelMessageLayoutResult = {
  bubbleWidth: number
  bubbleHeight: number
  maxBubbleWidth: number
  maxWidthLineCount: number
  tightLineCount: number
  usedFallback: boolean
}

function loadComputeChannelMessageLayout(): (input: ChannelMessageLayoutInput) => ChannelMessageLayoutResult {
  return createRequire(import.meta.url)('../src/features/tool-adapter/channel-message-layout.js')
    .computeChannelMessageLayout as (input: ChannelMessageLayoutInput) => ChannelMessageLayoutResult
}

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
} as const satisfies ChannelMessageLayoutInput

test('tight width preserves wrapped line count', () => {
  const computeChannelMessageLayout = loadComputeChannelMessageLayout()
  const layout = computeChannelMessageLayout({ ...baseLayoutInput })

  assert.equal(layout.usedFallback, false)
  assert.equal(layout.tightLineCount, layout.maxWidthLineCount)
  assert.ok(layout.bubbleWidth < layout.maxBubbleWidth)
})

test('row height grows when detail text is present', () => {
  const computeChannelMessageLayout = loadComputeChannelMessageLayout()
  const withoutDetail = computeChannelMessageLayout({ ...baseLayoutInput, detail: null, status: 'failed' })
  const withDetail = computeChannelMessageLayout({
    ...baseLayoutInput,
    detail: 'Webhook rejected preview update.',
    status: 'failed',
  })

  assert.ok(withDetail.bubbleHeight > withoutDetail.bubbleHeight)
})

test('system-ui forces fallback sizing', () => {
  const computeChannelMessageLayout = loadComputeChannelMessageLayout()
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
