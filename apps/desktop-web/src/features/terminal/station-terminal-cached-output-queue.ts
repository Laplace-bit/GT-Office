export interface StationTerminalCachedOutputAppendBuffer {
  workspaceId: string
  stationId: string
  sessionId: string
  base64Chunks: string[]
  encodedLength: number
  unreadDelta: number
}

export type StationTerminalCachedOutputAppendQueue = Record<string, StationTerminalCachedOutputAppendBuffer>

export interface StationTerminalCachedOutputAppendInput {
  workspaceId: string
  stationId: string
  sessionId: string
  base64Chunk?: string
  unreadDelta?: number
}

export interface StationTerminalCachedOutputAppendResult {
  queued: boolean
  shouldFlush: boolean
  queueKey: string | null
}

export interface StationTerminalCachedOutputAppendOptions {
  queueKeyLimit?: number
  protectedQueueKey?: string | null
}

export const STATION_TERMINAL_CACHED_OUTPUT_PENDING_CHUNK_LIMIT = 32
export const STATION_TERMINAL_CACHED_OUTPUT_PENDING_BASE64_CHAR_LIMIT = 128 * 1024
export const STATION_TERMINAL_CACHED_OUTPUT_PENDING_QUEUE_KEY_LIMIT = 128

export function buildStationTerminalCachedOutputQueueKey(
  workspaceId: string,
  stationId: string,
  sessionId: string,
): string {
  return `${workspaceId}:${stationId}:${sessionId}`
}

function normalizeStationTerminalCachedOutputQueueKeyLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return STATION_TERMINAL_CACHED_OUTPUT_PENDING_QUEUE_KEY_LIMIT
  }
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function normalizeStationTerminalCachedOutputUnreadDelta(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function ensureStationTerminalCachedOutputQueueCapacity(
  queue: StationTerminalCachedOutputAppendQueue,
  queueKey: string,
  options: StationTerminalCachedOutputAppendOptions | undefined,
): boolean {
  if (queue[queueKey]) {
    return true
  }

  const queueKeyLimit = normalizeStationTerminalCachedOutputQueueKeyLimit(options?.queueKeyLimit)
  if (queueKeyLimit === Number.POSITIVE_INFINITY) {
    return true
  }
  if (queueKeyLimit <= 0) {
    return false
  }

  const queuedKeys = Object.keys(queue)
  if (queuedKeys.length < queueKeyLimit) {
    return true
  }

  const protectedQueueKey = options?.protectedQueueKey?.trim() ?? ''
  const evictedQueueKey = queuedKeys.find((queuedKey) => queuedKey !== protectedQueueKey)
  if (!evictedQueueKey) {
    return false
  }
  delete queue[evictedQueueKey]
  return true
}

export function queueStationTerminalCachedOutputAppend(
  queue: StationTerminalCachedOutputAppendQueue,
  input: StationTerminalCachedOutputAppendInput,
  options?: StationTerminalCachedOutputAppendOptions,
): StationTerminalCachedOutputAppendResult {
  const workspaceId = input.workspaceId.trim()
  const stationId = input.stationId.trim()
  const sessionId = input.sessionId.trim()
  if (!workspaceId || !stationId || !sessionId) {
    return { queued: false, shouldFlush: false, queueKey: null }
  }

  const base64Chunk = input.base64Chunk ?? ''
  const unreadDelta = normalizeStationTerminalCachedOutputUnreadDelta(input.unreadDelta)
  if (!base64Chunk && unreadDelta === 0) {
    return { queued: false, shouldFlush: false, queueKey: null }
  }

  const queueKey = buildStationTerminalCachedOutputQueueKey(workspaceId, stationId, sessionId)
  if (!ensureStationTerminalCachedOutputQueueCapacity(queue, queueKey, options)) {
    return { queued: false, shouldFlush: false, queueKey }
  }

  const pending =
    queue[queueKey] ??
    ({
      workspaceId,
      stationId,
      sessionId,
      base64Chunks: [],
      encodedLength: 0,
      unreadDelta: 0,
    } satisfies StationTerminalCachedOutputAppendBuffer)

  if (base64Chunk) {
    pending.base64Chunks.push(base64Chunk)
    pending.encodedLength += base64Chunk.length
  }
  pending.unreadDelta = Math.min(999, pending.unreadDelta + unreadDelta)
  queue[queueKey] = pending

  return {
    queued: true,
    shouldFlush:
      pending.base64Chunks.length >= STATION_TERMINAL_CACHED_OUTPUT_PENDING_CHUNK_LIMIT ||
      pending.encodedLength >= STATION_TERMINAL_CACHED_OUTPUT_PENDING_BASE64_CHAR_LIMIT,
    queueKey,
  }
}
