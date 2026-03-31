export function shouldAutoScrollChannelFeed(input: {
  hasInitialAutoScroll: boolean
  scrollHeight: number
  scrollTop: number
  clientHeight: number
  threshold: number
}): boolean {
  if (!input.hasInitialAutoScroll) {
    return true
  }

  const scrollHeight = Number.isFinite(input.scrollHeight) ? input.scrollHeight : 0
  const scrollTop = Number.isFinite(input.scrollTop) ? input.scrollTop : 0
  const clientHeight = Number.isFinite(input.clientHeight) ? input.clientHeight : 0
  const threshold = Number.isFinite(input.threshold) ? Math.max(0, input.threshold) : 0
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight

  return distanceFromBottom <= threshold
}

export function resolveChannelRowEstimate(layoutHeight: number, minRowHeight: number): number {
  const safeMinRowHeight = Number.isFinite(minRowHeight) && minRowHeight > 0 ? minRowHeight : 1
  if (!Number.isFinite(layoutHeight) || layoutHeight <= 0) {
    return safeMinRowHeight
  }

  return Math.max(layoutHeight, safeMinRowHeight)
}

export function resolveLatestChannelMessageScrollTop(input: {
  latestMessageStart: number
  latestMessageHeight: number
  scrollHeight: number
  clientHeight: number
}): number {
  const latestMessageStart = Number.isFinite(input.latestMessageStart) ? Math.max(0, input.latestMessageStart) : 0
  const latestMessageHeight = Number.isFinite(input.latestMessageHeight) ? Math.max(0, input.latestMessageHeight) : 0
  const scrollHeight = Number.isFinite(input.scrollHeight) ? Math.max(0, input.scrollHeight) : 0
  const clientHeight = Number.isFinite(input.clientHeight) ? Math.max(0, input.clientHeight) : 0
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)

  return Math.min(Math.max(0, latestMessageStart), Math.max(maxScrollTop, latestMessageHeight > clientHeight ? latestMessageStart : 0))
}
