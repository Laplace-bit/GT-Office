import {
  cancelStationTerminalFrameFlush,
  scheduleStationTerminalFrameFlush,
  type StationTerminalFrameFlushHandle,
  type StationTerminalFrameFlushScheduler,
} from './station-terminal-frame-flush-scheduler.js'

export interface StationTerminalResizeDimensions {
  cols: number
  rows: number
}

export interface StationTerminalFitRetryFrame {
  handle: StationTerminalFrameFlushHandle | null
  cancel: () => void
}

export interface ScheduleStationTerminalFitRetryFrameOptions {
  scheduler: StationTerminalFrameFlushScheduler
  run: () => void
  fallbackDelayMs?: number
}

const TERMINAL_RESIZE_MAX_DIMENSION = 65_535

export function normalizeStationTerminalResizeDimensions(
  cols: number,
  rows: number,
): StationTerminalResizeDimensions | null {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null
  }

  const normalizedCols = Math.floor(cols)
  const normalizedRows = Math.floor(rows)
  if (
    normalizedCols < 1 ||
    normalizedRows < 1 ||
    normalizedCols > TERMINAL_RESIZE_MAX_DIMENSION ||
    normalizedRows > TERMINAL_RESIZE_MAX_DIMENSION
  ) {
    return null
  }

  return {
    cols: normalizedCols,
    rows: normalizedRows,
  }
}

export function scheduleStationTerminalFitRetryFrame({
  scheduler,
  run,
  fallbackDelayMs,
}: ScheduleStationTerminalFitRetryFrameOptions): StationTerminalFitRetryFrame {
  const retryFrame: StationTerminalFitRetryFrame = {
    handle: null,
    cancel: () => {},
  }
  retryFrame.cancel = () => {
    cancelStationTerminalFrameFlush(retryFrame.handle)
    retryFrame.handle = null
  }
  retryFrame.handle = scheduleStationTerminalFrameFlush(
    () => {
      retryFrame.handle = null
      run()
    },
    scheduler,
    fallbackDelayMs,
  )
  return retryFrame
}
