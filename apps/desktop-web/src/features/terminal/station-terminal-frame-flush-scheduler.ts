export const STATION_TERMINAL_FRAME_FLUSH_FALLBACK_MS = 48

export interface StationTerminalFrameFlushScheduler {
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  cancelAnimationFrame: (id: number) => void
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (id: number) => void
}

export interface StationTerminalFrameFlushWindow {
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  cancelAnimationFrame: (id: number) => void
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (id: number) => void
}

export interface StationTerminalFrameFlushHandle {
  scheduler: StationTerminalFrameFlushScheduler
  frameId: number | null
  timeoutId: number | null
  settled: boolean
}

function normalizeStationTerminalFrameFlushFallbackDelay(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return STATION_TERMINAL_FRAME_FLUSH_FALLBACK_MS
  }
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

export function createStationTerminalFrameFlushScheduler(
  targetWindow: StationTerminalFrameFlushWindow,
): StationTerminalFrameFlushScheduler {
  return {
    requestAnimationFrame: (callback) => targetWindow.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => targetWindow.cancelAnimationFrame(id),
    setTimeout: (callback, delayMs) => targetWindow.setTimeout(callback, delayMs),
    clearTimeout: (id) => targetWindow.clearTimeout(id),
  }
}

export function scheduleStationTerminalFrameFlush(
  callback: () => void,
  scheduler: StationTerminalFrameFlushScheduler,
  fallbackDelayMs?: number,
): StationTerminalFrameFlushHandle {
  const handle: StationTerminalFrameFlushHandle = {
    scheduler,
    frameId: null,
    timeoutId: null,
    settled: false,
  }
  const run = (source: 'frame' | 'timeout') => {
    if (handle.settled) {
      return
    }
    handle.settled = true
    if (source !== 'frame' && handle.frameId !== null) {
      scheduler.cancelAnimationFrame(handle.frameId)
    }
    if (source !== 'timeout' && handle.timeoutId !== null) {
      scheduler.clearTimeout(handle.timeoutId)
    }
    callback()
  }

  handle.frameId = scheduler.requestAnimationFrame(() => run('frame'))
  handle.timeoutId = scheduler.setTimeout(
    () => run('timeout'),
    normalizeStationTerminalFrameFlushFallbackDelay(fallbackDelayMs),
  )
  return handle
}

export function cancelStationTerminalFrameFlush(
  handle: StationTerminalFrameFlushHandle | null | undefined,
): void {
  if (!handle || handle.settled) {
    return
  }
  handle.settled = true
  if (handle.frameId !== null) {
    handle.scheduler.cancelAnimationFrame(handle.frameId)
  }
  if (handle.timeoutId !== null) {
    handle.scheduler.clearTimeout(handle.timeoutId)
  }
}

export function waitForStationTerminalFrameFlush(
  scheduler: StationTerminalFrameFlushScheduler,
  fallbackDelayMs?: number,
): Promise<void> {
  return new Promise((resolve) => {
    scheduleStationTerminalFrameFlush(resolve, scheduler, fallbackDelayMs)
  })
}
