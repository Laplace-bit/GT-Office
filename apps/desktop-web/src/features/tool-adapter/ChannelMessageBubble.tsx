import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { ChannelMessageLayoutResult } from './channel-message-layout'
import {
  DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
  resolveChannelMessageAnimationStartHeight,
  resolveChannelMessageAnimationTargetHeight,
  shouldAllowChannelMessageCollapse,
} from './channel-message-bubble-model'

const DEFAULT_ROOT_FONT_SIZE = 14

function toRem(value: number): string {
  return `${value / DEFAULT_ROOT_FONT_SIZE}rem`
}

interface ChannelMessageBubbleProps {
  direction: 'inbound' | 'outbound'
  content: string
  detail: string | null
  failed: boolean
  layout: ChannelMessageLayoutResult
  style?: CSSProperties
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export function ChannelMessageBubble({
  direction,
  content,
  detail,
  failed,
  layout,
  style,
  isCollapsed,
  onToggleCollapse,
}: ChannelMessageBubbleProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const contentRef = useRef<HTMLParagraphElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const previousCollapsedStateRef = useRef<boolean | null>(null)
  const [animatedContentHeight, setAnimatedContentHeight] = useState<number | null>(null)
  const [isAnimatingHeight, setIsAnimatingHeight] = useState(false)
  const collapsed = isCollapsed ?? internalCollapsed

  const canCollapse = shouldAllowChannelMessageCollapse({
    contentLength: content.length,
    lineCount: layout.tightLineCount,
  })
  const collapsedState = canCollapse && collapsed

  const handleToggle = () => {
    if (onToggleCollapse) {
      onToggleCollapse()
    } else {
      setInternalCollapsed((current) => !current)
    }
  }

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    const contentElement = contentRef.current
    if (!contentElement) {
      return
    }

    const expandedHeight = Math.ceil(contentElement.scrollHeight)
    if (!canCollapse) {
      previousCollapsedStateRef.current = null
      setIsAnimatingHeight(false)
      setAnimatedContentHeight(expandedHeight)
      return
    }

    const computedStyle = window.getComputedStyle(contentElement)
    const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight)
    const safeLineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : 17.4
    const collapsedHeight = Math.min(
      expandedHeight,
      Math.ceil(safeLineHeight * DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT),
    )
    const targetHeight = resolveChannelMessageAnimationTargetHeight({
      collapsed: collapsedState,
      collapsedHeight,
      expandedHeight,
    })
    const previousCollapsedState = previousCollapsedStateRef.current
    previousCollapsedStateRef.current = collapsedState

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (previousCollapsedState === null || previousCollapsedState === collapsedState) {
      setIsAnimatingHeight(false)
      setAnimatedContentHeight(targetHeight)
      return
    }

    const startHeight = resolveChannelMessageAnimationStartHeight({
      collapsed: collapsedState,
      collapsedHeight,
      expandedHeight,
    })

    setIsAnimatingHeight(true)
    setAnimatedContentHeight(startHeight)
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setAnimatedContentHeight(targetHeight)
      animationFrameRef.current = null
    })
  }, [canCollapse, collapsedState, content, layout.tightLineCount, layout.bubbleWidth])

  return (
    <div
      className={`communication-channels-message-row is-${direction}`}
      style={style}
    >
      <article
        className={`communication-channels-bubble ${failed ? 'is-failed' : ''} ${collapsedState ? 'is-collapsed' : ''} ${isAnimatingHeight ? 'is-animating-height' : ''}`}
        style={{
          width: toRem(layout.bubbleWidth),
          ['--communication-collapse-lines' as const]: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
        } as CSSProperties}
      >
        <div
          className="communication-channels-message-content-viewport"
          style={
            animatedContentHeight === null
              ? undefined
              : {
                  height: toRem(animatedContentHeight),
                }
          }
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget || event.propertyName !== 'height') {
              return
            }
            setIsAnimatingHeight(false)
          }}
        >
          <p ref={contentRef} className="communication-channels-message-content">
            {content}
          </p>
        </div>
        {detail ? (
          <p className="communication-channels-message-detail">
            {detail}
          </p>
        ) : null}
        {canCollapse ? (
          <button
            type="button"
            className="communication-channels-message-toggle"
            onClick={handleToggle}
            aria-expanded={!collapsedState}
          >
            {collapsedState ? '展开' : '收起'}
          </button>
        ) : null}
      </article>
    </div>
  )
}
