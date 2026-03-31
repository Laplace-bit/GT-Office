import { clearCache, layout, prepareWithSegments, type PreparedTextWithSegments } from '@chenglou/pretext'

export interface ChannelMessageLayoutInput {
  content: string
  detail: string | null
  uiFont: 'sf-pro' | 'ibm-plex' | 'system-ui'
  maxContentWidth: number
  contentFont: string
  detailFont: string
  contentLineHeight: number
  detailLineHeight: number
  bubblePaddingX: number
  bubblePaddingY: number
  bubbleBorderWidth: number
  direction: 'inbound' | 'outbound'
  status: 'received' | 'sent' | 'failed'
}

export interface ChannelMessageLayoutResult {
  bubbleWidth: number
  bubbleHeight: number
  maxBubbleWidth: number
  maxWidthLineCount: number
  tightLineCount: number
  usedFallback: boolean
}

const preparedCache = new Map<string, PreparedTextWithSegments>()
const BINARY_SEARCH_ITERATIONS = 24
const MIN_CONTENT_WIDTH = 1
const FONT_SIZE_PATTERN = /(\d+(?:\.\d+)?)\s*px/i

type TextMetricsLike = {
  width: number
}

type CanvasMeasureContextLike = {
  font: string
  measureText(text: string): TextMetricsLike
}

function parseFontSize(font: string): number {
  const match = font.match(FONT_SIZE_PATTERN)
  const parsed = match ? Number.parseFloat(match[1]) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16
}

function estimateCharacterWidth(char: string, fontSize: number): number {
  if (char === ' ') {
    return fontSize * 0.33
  }

  if (char === '\t') {
    return fontSize * 0.33 * 8
  }

  if (/[\u3400-\u9fff\uac00-\ud7af\u3040-\u30ff]/u.test(char)) {
    return fontSize
  }

  if (/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(char)) {
    return fontSize
  }

  if (/[ilj|.,'`:;!]/.test(char)) {
    return fontSize * 0.3
  }

  if (/[frtI]/.test(char)) {
    return fontSize * 0.4
  }

  if (/[mwMW@#%&]/.test(char)) {
    return fontSize * 0.82
  }

  if (/[A-Z0-9]/.test(char)) {
    return fontSize * 0.62
  }

  if (/[-_+=~*?^()[\]{}\\/<>]/.test(char)) {
    return fontSize * 0.45
  }

  return fontSize * 0.56
}

function createMeasureContextShim(): CanvasMeasureContextLike {
  return {
    font: '16px system-ui',
    measureText(text: string): TextMetricsLike {
      const fontSize = parseFontSize(this.font)
      let width = 0

      for (const char of text) {
        width += estimateCharacterWidth(char, fontSize)
      }

      return { width }
    },
  }
}

function installOffscreenCanvasShim(): void {
  if (typeof OffscreenCanvas !== 'undefined') {
    return
  }

  class OffscreenCanvasShim {
    constructor(_width: number, _height: number) {}

    getContext(contextId: '2d'): CanvasMeasureContextLike | null {
      if (contextId !== '2d') {
        return null
      }

      return createMeasureContextShim()
    }
  }

  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: OffscreenCanvasShim,
    configurable: true,
    writable: true,
  })
}

function toCacheKey(text: string, font: string): string {
  return `${font}__${text}`
}

function toSafeLineHeight(lineHeight: number): number {
  return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1
}

function toSafeContentWidth(contentWidth: number): number {
  return Number.isFinite(contentWidth) && contentWidth > 0 ? contentWidth : MIN_CONTENT_WIDTH
}

function toBubbleChromeWidth(input: ChannelMessageLayoutInput): number {
  return (input.bubblePaddingX + input.bubbleBorderWidth) * 2
}

function toBubbleChromeHeight(input: ChannelMessageLayoutInput): number {
  return (input.bubblePaddingY + input.bubbleBorderWidth) * 2
}

function estimateFallbackBlockHeight(text: string, width: number, lineHeight: number): { lineCount: number; height: number } {
  const safeLineHeight = toSafeLineHeight(lineHeight)
  const normalized = text.trim().length === 0 ? ' ' : text
  const averageCharWidth = safeLineHeight * 0.55
  const charsPerLine = Math.max(1, Math.floor(width / averageCharWidth))
  const hardBreakLines = normalized.split('\n')

  let lineCount = 0
  for (const line of hardBreakLines) {
    const collapsedLine = line.replace(/\s+/g, ' ').trim()
    const measuredLength = collapsedLine.length === 0 ? 1 : collapsedLine.length
    lineCount += Math.max(1, Math.ceil(measuredLength / charsPerLine))
  }

  return {
    lineCount,
    height: lineCount * safeLineHeight,
  }
}

function computeFallbackLayout(input: ChannelMessageLayoutInput): ChannelMessageLayoutResult {
  const maxContentWidth = toSafeContentWidth(input.maxContentWidth)
  const chromeWidth = toBubbleChromeWidth(input)
  const maxBubbleWidth = maxContentWidth + chromeWidth
  const contentLayout = estimateFallbackBlockHeight(input.content, maxContentWidth, input.contentLineHeight)
  const detailLayout = input.detail
    ? estimateFallbackBlockHeight(input.detail, maxContentWidth, input.detailLineHeight)
    : { lineCount: 0, height: 0 }

  return {
    bubbleWidth: maxBubbleWidth,
    bubbleHeight: contentLayout.height + detailLayout.height + toBubbleChromeHeight(input),
    maxBubbleWidth,
    maxWidthLineCount: contentLayout.lineCount,
    tightLineCount: contentLayout.lineCount,
    usedFallback: true,
  }
}

function prepareCached(text: string, font: string): PreparedTextWithSegments {
  installOffscreenCanvasShim()
  const key = toCacheKey(text, font)
  const existing = preparedCache.get(key)
  if (existing) {
    return existing
  }
  const prepared = prepareWithSegments(text, font)
  preparedCache.set(key, prepared)
  return prepared
}

function estimateBlockHeight(
  prepared: PreparedTextWithSegments,
  width: number,
  lineHeight: number,
): { lineCount: number; height: number } {
  const safeWidth = toSafeContentWidth(width)
  const safeLineHeight = toSafeLineHeight(lineHeight)
  const measured = layout(prepared, safeWidth, safeLineHeight)
  return {
    lineCount: measured.lineCount,
    height: measured.height,
  }
}

function findTightWidth(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): number {
  const safeMaxWidth = toSafeContentWidth(maxWidth)
  const safeLineHeight = toSafeLineHeight(lineHeight)
  const targetLineCount = layout(prepared, safeMaxWidth, safeLineHeight).lineCount

  let low = 0
  let high = safeMaxWidth
  for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i += 1) {
    const mid = (low + high) / 2
    const lineCount = layout(prepared, Math.max(mid, MIN_CONTENT_WIDTH), safeLineHeight).lineCount
    if (lineCount > targetLineCount) {
      low = mid
      continue
    }
    high = mid
  }

  return Math.max(high, MIN_CONTENT_WIDTH)
}

export function clearChannelMessageLayoutCache(): void {
  preparedCache.clear()
  clearCache()
}

export function computeChannelMessageLayout(input: ChannelMessageLayoutInput): ChannelMessageLayoutResult {
  const maxContentWidth = toSafeContentWidth(input.maxContentWidth)
  const chromeWidth = toBubbleChromeWidth(input)
  const maxBubbleWidth = maxContentWidth + chromeWidth

  if (input.uiFont === 'system-ui') {
    return computeFallbackLayout(input)
  }

  try {
    const contentPrepared = prepareCached(input.content, input.contentFont)
    const maxContentLayout = estimateBlockHeight(contentPrepared, maxContentWidth, input.contentLineHeight)
    const tightContentWidth = findTightWidth(contentPrepared, maxContentWidth, input.contentLineHeight)
    const tightContentLayout = estimateBlockHeight(contentPrepared, tightContentWidth, input.contentLineHeight)

    let tightMeasuredWidth = tightContentWidth
    let detailHeight = 0
    if (input.detail) {
      const detailPrepared = prepareCached(input.detail, input.detailFont)
      const tightDetailWidth = findTightWidth(detailPrepared, maxContentWidth, input.detailLineHeight)
      const detailLayout = estimateBlockHeight(detailPrepared, tightDetailWidth, input.detailLineHeight)
      tightMeasuredWidth = Math.max(tightMeasuredWidth, tightDetailWidth)
      detailHeight = detailLayout.height
    }

    const bubbleWidth = Math.min(tightMeasuredWidth + chromeWidth, maxBubbleWidth)
    const bubbleHeight = tightContentLayout.height + detailHeight + toBubbleChromeHeight(input)
    return {
      bubbleWidth,
      bubbleHeight,
      maxBubbleWidth,
      maxWidthLineCount: maxContentLayout.lineCount,
      tightLineCount: tightContentLayout.lineCount,
      usedFallback: false,
    }
  } catch {
    return computeFallbackLayout(input)
  }
}
