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
  includeActive?: boolean
  activeCharLimit?: number
  includeBackground?: boolean
  backgroundEntryLimit?: number
  backgroundCharLimit?: number
}

export interface StationTerminalOutputFlushFrame {
  entries: StationTerminalOutputFlushEntry[]
  hasDeferredActive: boolean
  hasDeferredBackground: boolean
}

export interface StationTerminalOutputFlushQueueOptions {
  stationLimit?: number
  protectedStationId?: string | null
}

export const STATION_TERMINAL_OUTPUT_FLUSH_PENDING_CHUNK_LIMIT = 32
export const STATION_TERMINAL_OUTPUT_FLUSH_PENDING_STATION_LIMIT = 64
export const STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT = 24 * 1024
export const STATION_TERMINAL_OUTPUT_FLUSH_BACKGROUND_CHAR_LIMIT = 12 * 1024

function normalizeStationTerminalOutputFlushStationLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return STATION_TERMINAL_OUTPUT_FLUSH_PENDING_STATION_LIMIT
  }
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function ensureStationTerminalOutputFlushQueueCapacity(
  queue: StationTerminalOutputFlushQueue,
  stationId: string,
  options: StationTerminalOutputFlushQueueOptions | undefined,
): boolean {
  if (queue[stationId]) {
    return true
  }

  const stationLimit = normalizeStationTerminalOutputFlushStationLimit(options?.stationLimit)
  if (stationLimit === Number.POSITIVE_INFINITY) {
    return true
  }
  if (stationLimit <= 0) {
    return false
  }

  const queuedStationIds = Object.keys(queue)
  if (queuedStationIds.length < stationLimit) {
    return true
  }

  const protectedStationId = options?.protectedStationId?.trim() ?? ''
  const evictedStationId = queuedStationIds.find((queuedStationId) => queuedStationId !== protectedStationId)
  if (!evictedStationId) {
    return false
  }
  delete queue[evictedStationId]
  return true
}

export function queueStationTerminalOutputFlush(
  queue: StationTerminalOutputFlushQueue,
  stationId: string,
  chunk: string,
  unreadDelta = 1,
  options?: StationTerminalOutputFlushQueueOptions,
): boolean {
  const normalizedStationId = stationId.trim()
  if (!normalizedStationId || !chunk) {
    return false
  }
  if (!ensureStationTerminalOutputFlushQueueCapacity(queue, normalizedStationId, options)) {
    return false
  }
  const pending = queue[normalizedStationId] ?? {
    chunks: [],
    unreadDelta: 0,
  }
  pending.chunks.push(chunk)
  if (pending.chunks.length > STATION_TERMINAL_OUTPUT_FLUSH_PENDING_CHUNK_LIMIT) {
    pending.chunks = [pending.chunks.join('')]
  }
  pending.unreadDelta += Math.max(0, unreadDelta)
  queue[normalizedStationId] = pending
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

function splitStationTerminalOutputFlushBuffer(
  stationId: string,
  pending: StationTerminalOutputFlushBuffer,
  maxChars: number,
): StationTerminalOutputFlushEntry {
  const chunk = pending.chunks.length === 1 ? pending.chunks[0] : pending.chunks.join('')
  if (maxChars <= 0) {
    return {
      stationId,
      chunk: '',
      unreadDelta: 0,
    }
  }
  if (!Number.isFinite(maxChars)) {
    pending.chunks = []
    return {
      stationId,
      chunk,
      unreadDelta: pending.unreadDelta,
    }
  }

  let splitIndex = 0
  let characterCount = 0
  for (const character of chunk) {
    if (characterCount >= maxChars) {
      break
    }
    splitIndex += character.length
    characterCount += 1
  }

  if (splitIndex >= chunk.length) {
    pending.chunks = []
    return {
      stationId,
      chunk,
      unreadDelta: pending.unreadDelta,
    }
  }

  const takenChunk = chunk.slice(0, splitIndex)
  pending.chunks = [chunk.slice(splitIndex)]
  const unreadDelta = pending.unreadDelta
  pending.unreadDelta = 0
  return {
    stationId,
    chunk: takenChunk,
    unreadDelta,
  }
}

function normalizeStationTerminalOutputFlushLimit(
  value: number | null | undefined,
  fallback: number,
): number {
  if (value === null || value === undefined) {
    return fallback
  }
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

export function takeStationTerminalOutputFlushEntries(
  queue: StationTerminalOutputFlushQueue,
  stationId?: string,
): StationTerminalOutputFlushEntry[] {
  const hasTargetStation = stationId !== undefined
  const normalizedStationId = stationId?.trim() ?? ''
  if (hasTargetStation && !normalizedStationId) {
    return []
  }

  const entries = hasTargetStation
    ? queue[normalizedStationId]
      ? [compactStationTerminalOutputFlushBuffer(normalizedStationId, queue[normalizedStationId])]
      : []
    : Object.entries(queue).map(([targetStationId, pending]) =>
        compactStationTerminalOutputFlushBuffer(targetStationId, pending),
      )
  if (hasTargetStation) {
    delete queue[normalizedStationId]
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
  const includeActive = options.includeActive ?? true
  const activeCharLimit = normalizeStationTerminalOutputFlushLimit(
    options.activeCharLimit,
    Number.POSITIVE_INFINITY,
  )
  const includeBackground = options.includeBackground ?? false
  const backgroundEntryLimit = normalizeStationTerminalOutputFlushLimit(
    options.backgroundEntryLimit,
    Number.POSITIVE_INFINITY,
  )
  const backgroundCharLimit = normalizeStationTerminalOutputFlushLimit(
    options.backgroundCharLimit,
    STATION_TERMINAL_OUTPUT_FLUSH_BACKGROUND_CHAR_LIMIT,
  )
  let hasDeferredActive = false

  if (activeStationId && queue[activeStationId] && includeActive) {
    const entry = splitStationTerminalOutputFlushBuffer(
      activeStationId,
      queue[activeStationId],
      activeCharLimit,
    )
    entries.push(entry)
    if ((queue[activeStationId]?.chunks.length ?? 0) === 0) {
      delete queue[activeStationId]
    } else {
      hasDeferredActive = true
    }
  } else if (activeStationId && queue[activeStationId]) {
    hasDeferredActive = true
  }

  if (includeBackground && backgroundEntryLimit > 0) {
    let takenBackgroundEntries = 0
    let takenBackgroundChars = 0
    for (const targetStationId of Object.keys(queue)) {
      if (targetStationId === activeStationId) {
        continue
      }
      const remainingBackgroundChars = Math.max(0, backgroundCharLimit - takenBackgroundChars)
      if (remainingBackgroundChars <= 0) {
        break
      }
      const entry = splitStationTerminalOutputFlushBuffer(
        targetStationId,
        queue[targetStationId],
        remainingBackgroundChars,
      )
      entries.push(entry)
      takenBackgroundChars += Array.from(entry.chunk).length
      if ((queue[targetStationId]?.chunks.length ?? 0) === 0) {
        delete queue[targetStationId]
      }
      takenBackgroundEntries += 1
      if (takenBackgroundEntries >= backgroundEntryLimit) {
        break
      }
    }
  }

  const hasDeferredBackground = Object.keys(queue).some((targetStationId) => targetStationId !== activeStationId)
  return {
    entries: entries.filter((entry) => entry.chunk.length > 0),
    hasDeferredActive,
    hasDeferredBackground,
  }
}
