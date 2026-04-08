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
const DETAIL_MARGIN_TOP = 6

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

function estimateFallbackBlockHeight(text: string, width: number, lineHeight: number, font: string): { lineCount: number; height: number; tightWidth: number } {
  const safeLineHeight = toSafeLineHeight(lineHeight)
  const safeWidth = toSafeContentWidth(width)
  const fontSize = parseFontSize(font)
  const normalized = text.length === 0 ? ' ' : text
  const hardBreakLines = normalized.split('\n')

  let totalLines = 0
  let tightWidth = 0

  for (const line of hardBreakLines) {
    if (line.length === 0) {
      totalLines += 1
      continue
    }

    const words = line.split(/(\s+)/)
    let currentLineWidth = 0
    let currentLineChunks = 1

    for (const word of words) {
      if (word.length === 0) continue

      const isSpace = /^\s+$/.test(word)
      let wordWidth = 0
      for (const char of word) {
        wordWidth += estimateCharacterWidth(char, fontSize)
      }

      if (currentLineWidth + wordWidth <= safeWidth) {
        currentLineWidth += wordWidth
      } else if (isSpace) {
        continue
      } else {
        if (wordWidth > safeWidth) {
          for (const char of word) {
            const cw = estimateCharacterWidth(char, fontSize)
            if (currentLineWidth + cw > safeWidth && currentLineWidth > 0) {
              tightWidth = Math.max(tightWidth, currentLineWidth)
              currentLineChunks += 1
              currentLineWidth = cw
            } else {
              currentLineWidth += cw
            }
          }
        } else {
          tightWidth = Math.max(tightWidth, currentLineWidth)
          currentLineChunks += 1
          currentLineWidth = wordWidth
        }
      }
    }
    tightWidth = Math.max(tightWidth, currentLineWidth)
    totalLines += currentLineChunks
  }

  return {
    lineCount: totalLines,
    height: totalLines * safeLineHeight,
    tightWidth: Math.max(MIN_CONTENT_WIDTH, tightWidth),
  }
}

function computeFallbackLayout(input: ChannelMessageLayoutInput): ChannelMessageLayoutResult {
  const maxContentWidth = toSafeContentWidth(input.maxContentWidth)
  const chromeWidth = toBubbleChromeWidth(input)
  
  const contentLayout = estimateFallbackBlockHeight(input.content, maxContentWidth, input.contentLineHeight, input.contentFont)
  const detailLayout = input.detail
    ? estimateFallbackBlockHeight(input.detail, maxContentWidth, input.detailLineHeight, input.detailFont)
    : null

  const tightMeasuredWidth = Math.max(
    contentLayout.tightWidth,
    detailLayout ? detailLayout.tightWidth : 0
  )
  
  const detailHeight = detailLayout ? detailLayout.height + DETAIL_MARGIN_TOP : 0
  const maxBubbleWidth = maxContentWidth + chromeWidth
  const bubbleWidth = Math.min(tightMeasuredWidth + chromeWidth, maxBubbleWidth)

  return {
    bubbleWidth,
    bubbleHeight: contentLayout.height + detailHeight + toBubbleChromeHeight(input),
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
    const fallbackLayout = computeFallbackLayout(input)
    return {
      ...fallbackLayout,
      bubbleWidth: fallbackLayout.maxBubbleWidth,
    }
  }

  const averageContentCharWidth = input.contentLineHeight * 0.55
  const contentCharsPerLine = Math.max(1, Math.floor(maxContentWidth / averageContentCharWidth))
  
  const averageDetailCharWidth = input.detailLineHeight * 0.55
  const detailCharsPerLine = Math.max(1, Math.floor(maxContentWidth / averageDetailCharWidth))

  // Use pretext for all font types — the fontFamily resolve already reads
  // the actual CSS custom property, so it works for system-ui too.
  const hasLongUnbreakableWord = (text: string, charsPerLine: number) => {
    const normalized = text.replace(/[\u3400-\u9fff\uac00-\ud7af\u3040-\u30ff]/gu, ' ')
    return normalized.split(/\s+/).some(word => word.length > charsPerLine)
  }

  const needsFallback = hasLongUnbreakableWord(input.content, contentCharsPerLine) ||
                        (input.detail ? hasLongUnbreakableWord(input.detail, detailCharsPerLine) : false)

  if (needsFallback) {
    return computeFallbackLayout(input)
  }

  try {
    const contentPrepared = prepareCached(input.content, input.contentFont)
    const maxContentLayout = estimateBlockHeight(contentPrepared, maxContentWidth, input.contentLineHeight)
    const tightContentWidth = findTightWidth(contentPrepared, maxContentWidth, input.contentLineHeight)
    const tightContentLayout = estimateBlockHeight(contentPrepared, tightContentWidth, input.contentLineHeight)

    // Use the larger of tight/max content heights as a safety guard against
    // binary-search precision edge cases (off-by-subpixel → one extra wrap line).
    const contentHeight = Math.max(tightContentLayout.height, maxContentLayout.height)

    let tightMeasuredWidth = tightContentWidth
    let detailHeight = 0
    if (input.detail) {
      const detailPrepared = prepareCached(input.detail, input.detailFont)
      const tightDetailWidth = findTightWidth(detailPrepared, maxContentWidth, input.detailLineHeight)
      const maxDetailLayout = estimateBlockHeight(detailPrepared, maxContentWidth, input.detailLineHeight)
      const tightDetailLayout = estimateBlockHeight(detailPrepared, tightDetailWidth, input.detailLineHeight)
      tightMeasuredWidth = Math.max(tightMeasuredWidth, tightDetailWidth)
      const dHeight = Math.max(tightDetailLayout.height, maxDetailLayout.height)
      detailHeight = dHeight + DETAIL_MARGIN_TOP
    }

    const bubbleWidth = Math.min(tightMeasuredWidth + chromeWidth, maxBubbleWidth)
    const bubbleHeight = contentHeight + detailHeight + toBubbleChromeHeight(input)
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
