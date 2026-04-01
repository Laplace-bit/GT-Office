export const DEFAULT_CHANNEL_MESSAGE_COLLAPSE_CHAR_LIMIT = 160
export const DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT = 3
export const DEFAULT_CHANNEL_MESSAGE_TOGGLE_HEIGHT = 28

export function shouldAllowChannelMessageCollapse(input: {
  contentLength: number
  lineCount: number
  charLimit?: number
  lineLimit?: number
}): boolean {
  const charLimit =
    Number.isFinite(input.charLimit) && (input.charLimit ?? 0) > 0
      ? (input.charLimit as number)
      : DEFAULT_CHANNEL_MESSAGE_COLLAPSE_CHAR_LIMIT
  const lineLimit =
    Number.isFinite(input.lineLimit) && (input.lineLimit ?? 0) > 0
      ? (input.lineLimit as number)
      : DEFAULT_CHANNEL_MESSAGE_COLLAPSE_LINE_LIMIT

  return input.contentLength > charLimit || input.lineCount > lineLimit
}

export function resolveChannelMessageToggleReserveHeight(canCollapse: boolean): number {
  return canCollapse ? DEFAULT_CHANNEL_MESSAGE_TOGGLE_HEIGHT : 0
}
