import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { UiFont } from '@shell/state/ui-preferences'
import type { ExternalChannelEventItem } from './CommunicationChannelsPane'
import { ChannelMessageBubble } from './ChannelMessageBubble'
import {
  clearChannelMessageLayoutCache,
  computeChannelMessageLayout,
  type ChannelMessageLayoutResult,
} from './channel-message-layout'
import {
  resolveLatestChannelMessageScrollTop,
  resolveChannelRowEstimate,
  shouldAutoScrollChannelFeed,
} from './channel-message-list-model'

const DEFAULT_ROOT_FONT_SIZE = 14
const AUTO_SCROLL_THRESHOLD = 96
const BUBBLE_PADDING_X = 12
const BUBBLE_PADDING_Y = 10
const BUBBLE_BORDER_WIDTH = 1
const CONTENT_FONT_SIZE = 12
const DETAIL_FONT_SIZE = 11
const CONTENT_LINE_HEIGHT = 17.4
const DETAIL_LINE_HEIGHT = 14.85
const MESSAGE_ROW_GAP = 10
const MIN_ROW_HEIGHT = 42
const MAX_MESSAGE_LANE_WIDTH = 720
const MESSAGE_LANE_RATIO = 0.88
const VIRTUAL_OVERSCAN = 8

type MessageDirection = 'inbound' | 'outbound'

type ChannelMessageRow = {
  id: string
  tsMs: number
  direction: MessageDirection
  content: string
  detail: string | null
  failed: boolean
  layout: ChannelMessageLayoutResult
  rowHeight: number
}

interface ChannelMessageListProps {
  appearanceVersion: string
  conversationKey: string | null
  events: ExternalChannelEventItem[]
  uiFont: UiFont
}

function toRem(value: number): string {
  return `${value / DEFAULT_ROOT_FONT_SIZE}rem`
}

function resolveEventDirection(event: ExternalChannelEventItem): MessageDirection {
  if (event.kind === 'inbound' || event.status === 'received') {
    return 'inbound'
  }
  return 'outbound'
}

function resolveEventContent(event: ExternalChannelEventItem): string {
  return event.primary.trim() || event.secondary?.trim() || event.detail?.trim() || '-'
}

function resolveFailureDetail(event: ExternalChannelEventItem): string | null {
  if (event.status === 'failed' || event.kind === 'error') {
    const detail = event.detail?.trim()
    return detail ? detail : null
  }
  return null
}

function isFailedEvent(event: ExternalChannelEventItem): boolean {
  return event.status === 'failed' || event.kind === 'error'
}

function resolveUiFontFamily(): string {
  if (typeof document === 'undefined') {
    return '"Helvetica Neue", Helvetica, Arial, sans-serif'
  }
  const family = getComputedStyle(document.documentElement).getPropertyValue('--vb-font-ui').trim()
  return family || '"Helvetica Neue", Helvetica, Arial, sans-serif'
}

function resolveScrollContentWidth(element: HTMLDivElement): number {
  const styles = getComputedStyle(element)
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0
  return Math.max(0, element.clientWidth - paddingLeft - paddingRight)
}

export function ChannelMessageList({
  appearanceVersion,
  conversationKey,
  events,
  uiFont,
}: ChannelMessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const hasInitialAutoScrollRef = useRef(false)
  const [scrollContentWidth, setScrollContentWidth] = useState(0)
  const fontFamily = useMemo(() => resolveUiFontFamily(), [appearanceVersion])

  useEffect(() => {
    clearChannelMessageLayoutCache()
  }, [appearanceVersion, uiFont])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const updateWidth = () => {
      setScrollContentWidth(resolveScrollContentWidth(element))
    }

    updateWidth()
    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const laneWidth = useMemo(
    () => Math.max(0, Math.min(scrollContentWidth * MESSAGE_LANE_RATIO, MAX_MESSAGE_LANE_WIDTH)),
    [scrollContentWidth],
  )
  const maxContentWidth = useMemo(
    () => Math.max(1, laneWidth - (BUBBLE_PADDING_X + BUBBLE_BORDER_WIDTH) * 2),
    [laneWidth],
  )

  const rows = useMemo<ChannelMessageRow[]>(() => {
    if (laneWidth <= 0) {
      return []
    }

    const contentFont = `500 ${CONTENT_FONT_SIZE}px ${fontFamily}`
    const detailFont = `500 ${DETAIL_FONT_SIZE}px ${fontFamily}`

    return events.map((event) => {
      const direction = resolveEventDirection(event)
      const content = resolveEventContent(event)
      const detail = resolveFailureDetail(event)
      const failed = isFailedEvent(event)
      const layout = computeChannelMessageLayout({
        content,
        detail,
        uiFont,
        maxContentWidth,
        contentFont,
        detailFont,
        contentLineHeight: CONTENT_LINE_HEIGHT,
        detailLineHeight: DETAIL_LINE_HEIGHT,
        bubblePaddingX: BUBBLE_PADDING_X,
        bubblePaddingY: BUBBLE_PADDING_Y,
        bubbleBorderWidth: BUBBLE_BORDER_WIDTH,
        direction,
        status: failed ? 'failed' : direction === 'inbound' ? 'received' : 'sent',
      })
      const rowHeight = resolveChannelRowEstimate(layout.bubbleHeight + MESSAGE_ROW_GAP, MIN_ROW_HEIGHT)

      return {
        id: event.id,
        tsMs: event.tsMs,
        direction,
        content,
        detail,
        failed,
        layout,
        rowHeight,
      }
    })
  }, [events, fontFamily, laneWidth, maxContentWidth, uiFont])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.rowHeight ?? MIN_ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rows, virtualizer])

  useEffect(() => {
    hasInitialAutoScrollRef.current = false
  }, [conversationKey])

  const latestRow = rows.length > 0 ? rows[rows.length - 1] : null

  useEffect(() => {
    const host = scrollRef.current
    if (!host) {
      return
    }
    if (!latestRow) {
      hasInitialAutoScrollRef.current = false
      return
    }

    const shouldScroll = shouldAutoScrollChannelFeed({
      hasInitialAutoScroll: hasInitialAutoScrollRef.current,
      scrollHeight: host.scrollHeight,
      scrollTop: host.scrollTop,
      clientHeight: host.clientHeight,
      threshold: AUTO_SCROLL_THRESHOLD,
    })

    if (!shouldScroll) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      host.scrollTop = resolveLatestChannelMessageScrollTop({
        latestMessageStart: Math.max(0, virtualizer.getTotalSize() - latestRow.rowHeight),
        latestMessageHeight: latestRow.rowHeight,
        scrollHeight: host.scrollHeight,
        clientHeight: host.clientHeight,
      })
      hasInitialAutoScrollRef.current = true
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [latestRow?.id, latestRow?.tsMs, rows.length, virtualizer])

  return (
    <div className="communication-channels-feed-scroll" ref={scrollRef}>
      <ol
        className="communication-channels-message-list"
        style={{
          display: 'block',
          position: 'relative',
          height: toRem(virtualizer.getTotalSize()),
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = rows[virtualItem.index]
          if (!row) {
            return null
          }

          return (
            <li
              key={row.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: toRem(row.rowHeight),
                transform: `translateY(${toRem(virtualItem.start)})`,
                display: 'flex',
                justifyContent: row.direction === 'inbound' ? 'flex-end' : 'flex-start',
              }}
            >
              <ChannelMessageBubble
                direction={row.direction}
                content={row.content}
                detail={row.detail}
                failed={row.failed}
                laneWidth={laneWidth}
                layout={row.layout}
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}
