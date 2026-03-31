import { useState, type CSSProperties } from 'react'
import type { ChannelMessageLayoutResult } from './channel-message-layout'
import {
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
  laneWidth: number
  layout: ChannelMessageLayoutResult
  style?: CSSProperties
}

export function ChannelMessageBubble({
  direction,
  content,
  detail,
  failed,
  laneWidth,
  layout,
  style,
}: ChannelMessageBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const canCollapse = shouldAllowChannelMessageCollapse({
    contentLength: content.length,
    lineCount: layout.tightLineCount,
  })
  const collapsed = canCollapse && !expanded

  return (
    <div
      className={`communication-channels-message-row is-${direction}`}
      style={{
        maxWidth: toRem(laneWidth),
        width: '100%',
        ...style,
      }}
    >
      <article
        className={`communication-channels-bubble ${failed ? 'is-failed' : ''} ${collapsed ? 'is-collapsed' : ''}`}
        style={{
          width: toRem(layout.bubbleWidth),
        }}
      >
        <p className="communication-channels-message-content">{content}</p>
        {detail ? (
          <p className="communication-channels-message-detail">
            {detail}
          </p>
        ) : null}
        {canCollapse ? (
          <button
            type="button"
            className="communication-channels-message-toggle"
            onClick={() => {
              setExpanded((current) => !current)
            }}
          >
            {collapsed ? '展开' : '收起'}
          </button>
        ) : null}
      </article>
    </div>
  )
}
