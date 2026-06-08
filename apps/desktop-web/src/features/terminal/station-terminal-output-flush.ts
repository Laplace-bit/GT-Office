export interface StationTerminalOutputFlushBuffer {
  chunks: string[]
  unreadDelta: number
}

export interface StationTerminalOutputFlushEntry {
  stationId: string
  chunk: string
  unreadDelta: number
}

export type StationTerminalOutputFlushQueue = Record<string, StationTerminalOutputFlushBuffer>

export interface StationTerminalOutputFlushFrameOptions {
  activeStationId?: string | null
  includeBackground?: boolean
  backgroundEntryLimit?: number
}

export interface StationTerminalOutputFlushFrame {
  entries: StationTerminalOutputFlushEntry[]
  hasDeferredBackground: boolean
}

export function queueStationTerminalOutputFlush(
  queue: StationTerminalOutputFlushQueue,
  stationId: string,
  chunk: string,
  unreadDelta = 1,
): boolean {
  if (!stationId || !chunk) {
    return false
  }
  const pending = queue[stationId] ?? {
    chunks: [],
    unreadDelta: 0,
  }
  pending.chunks.push(chunk)
  pending.unreadDelta += Math.max(0, unreadDelta)
  queue[stationId] = pending
  return true
}

function compactStationTerminalOutputFlushBuffer(
  stationId: string,
  pending: StationTerminalOutputFlushBuffer,
): StationTerminalOutputFlushEntry {
  return {
    stationId,
    chunk: pending.chunks.length === 1 ? pending.chunks[0] : pending.chunks.join(''),
    unreadDelta: pending.unreadDelta,
  }
}

export function takeStationTerminalOutputFlushEntries(
  queue: StationTerminalOutputFlushQueue,
  stationId?: string,
): StationTerminalOutputFlushEntry[] {
  const entries = stationId
    ? queue[stationId]
      ? [compactStationTerminalOutputFlushBuffer(stationId, queue[stationId])]
      : []
    : Object.entries(queue).map(([targetStationId, pending]) =>
        compactStationTerminalOutputFlushBuffer(targetStationId, pending),
      )
  if (stationId) {
    delete queue[stationId]
  } else {
    Object.keys(queue).forEach((targetStationId) => {
      delete queue[targetStationId]
    })
  }
  return entries.filter((entry) => entry.chunk.length > 0)
}

export function takeStationTerminalOutputFlushFrameEntries(
  queue: StationTerminalOutputFlushQueue,
  options: StationTerminalOutputFlushFrameOptions = {},
): StationTerminalOutputFlushFrame {
  const entries: StationTerminalOutputFlushEntry[] = []
  const activeStationId = options.activeStationId?.trim() ?? ''
  const includeBackground = options.includeBackground ?? false
  const backgroundEntryLimit = Math.max(0, Math.floor(options.backgroundEntryLimit ?? Number.POSITIVE_INFINITY))

  if (activeStationId && queue[activeStationId]) {
    entries.push(compactStationTerminalOutputFlushBuffer(activeStationId, queue[activeStationId]))
    delete queue[activeStationId]
  }

  if (includeBackground && backgroundEntryLimit > 0) {
    let takenBackgroundEntries = 0
    for (const targetStationId of Object.keys(queue)) {
      if (targetStationId === activeStationId) {
        continue
      }
      entries.push(compactStationTerminalOutputFlushBuffer(targetStationId, queue[targetStationId]))
      delete queue[targetStationId]
      takenBackgroundEntries += 1
      if (takenBackgroundEntries >= backgroundEntryLimit) {
        break
      }
    }
  }

  const hasDeferredBackground = Object.keys(queue).some((targetStationId) => targetStationId !== activeStationId)
  return {
    entries: entries.filter((entry) => entry.chunk.length > 0),
    hasDeferredBackground,
  }
}
