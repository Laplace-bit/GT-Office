export interface StationTerminalOutputFlushBuffer {
  chunk: string
  unreadDelta: number
}

export interface StationTerminalOutputFlushEntry extends StationTerminalOutputFlushBuffer {
  stationId: string
}

export type StationTerminalOutputFlushQueue = Record<string, StationTerminalOutputFlushBuffer>

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
    chunk: '',
    unreadDelta: 0,
  }
  pending.chunk += chunk
  pending.unreadDelta += Math.max(0, unreadDelta)
  queue[stationId] = pending
  return true
}

export function takeStationTerminalOutputFlushEntries(
  queue: StationTerminalOutputFlushQueue,
  stationId?: string,
): StationTerminalOutputFlushEntry[] {
  const entries = stationId
    ? queue[stationId]
      ? [{ stationId, ...queue[stationId] }]
      : []
    : Object.entries(queue).map(([targetStationId, pending]) => ({
        stationId: targetStationId,
        ...pending,
      }))
  if (stationId) {
    delete queue[stationId]
  } else {
    Object.keys(queue).forEach((targetStationId) => {
      delete queue[targetStationId]
    })
  }
  return entries.filter((entry) => entry.chunk.length > 0)
}
