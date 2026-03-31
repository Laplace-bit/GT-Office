import type { CSSProperties } from 'react'
import type { ChannelMessageLayoutResult } from './channel-message-layout'

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
        className={`communication-channels-bubble ${failed ? 'is-failed' : ''}`}
        title={content}
        style={{
          width: toRem(layout.bubbleWidth),
        }}
      >
        <p className="communication-channels-message-content">{content}</p>
        {detail ? (
          <p className="communication-channels-message-detail" title={detail}>
            {detail}
          </p>
        ) : null}
      </article>
    </div>
  )
}
