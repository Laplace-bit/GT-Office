import {
  waitForStationTerminalFrameFlush,
  type StationTerminalFrameFlushScheduler,
} from './station-terminal-frame-flush-scheduler.js'

export interface SubmitStationTerminalWithRetryOptions {
  maxRetryFrames: number
  submit: () => boolean
  scheduler: StationTerminalFrameFlushScheduler
  fallbackDelayMs?: number
}

function normalizeStationTerminalSubmitRetryFrames(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

export async function submitStationTerminalWithFrameRetry({
  maxRetryFrames,
  submit,
  scheduler,
  fallbackDelayMs,
}: SubmitStationTerminalWithRetryOptions): Promise<boolean> {
  const retryFrames = normalizeStationTerminalSubmitRetryFrames(maxRetryFrames)
  for (let attempt = 0; attempt <= retryFrames; attempt += 1) {
    if (submit()) {
      return true
    }
    if (attempt >= retryFrames) {
      return false
    }
    await waitForStationTerminalFrameFlush(scheduler, fallbackDelayMs)
  }
  return false
}
