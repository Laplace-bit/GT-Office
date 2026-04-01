import { useState, type CSSProperties } from 'react'
import type { ChannelMessageLayoutResult } from './channel-message-layout'
import {
  DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
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

  return (
    <div
      className={`communication-channels-message-row is-${direction}`}
      style={style}
    >
      <article
        className={`communication-channels-bubble ${failed ? 'is-failed' : ''} ${collapsedState ? 'is-collapsed' : ''}`}
        style={{
          width: toRem(layout.bubbleWidth),
          ['--communication-collapse-lines' as const]: DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT,
        } as CSSProperties}
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
            onClick={handleToggle}
          >
            {collapsedState ? '展开' : '收起'}
          </button>
        ) : null}
      </article>
    </div>
  )
}
