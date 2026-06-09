import {
  cancelStationTerminalFrameFlush,
  scheduleStationTerminalFrameFlush,
  type StationTerminalFrameFlushHandle,
  type StationTerminalFrameFlushScheduler,
} from './station-terminal-frame-flush-scheduler.js'

export interface StationTerminalRendererRecoveryInput {
  hasMeaningfulContent: boolean
  hasSerializedRestoreState: boolean
  renderEventSeqAtSchedule: number
  currentRenderEventSeq: number
}

export interface StationTerminalRendererRecoveryFrameDrain {
  handle: StationTerminalFrameFlushHandle | null
  cancel: () => void
}

export interface StationTerminalRenderRefreshFrame {
  handle: StationTerminalFrameFlushHandle | null
  cancel: () => void
}

export type StationTerminalAppearanceSyncFrame = StationTerminalRenderRefreshFrame

export interface StationTerminalRendererRecoveryFrameDrainOptions {
  frameCount: number
  scheduler: StationTerminalFrameFlushScheduler
  fallbackDelayMs?: number
}

export interface ScheduleStationTerminalRenderRefreshFrameOptions {
  scheduler: StationTerminalFrameFlushScheduler
  run: () => void
  fallbackDelayMs?: number
}

export type ScheduleStationTerminalAppearanceSyncFrameOptions =
  ScheduleStationTerminalRenderRefreshFrameOptions

export function shouldRecycleStationTerminalRenderer({
  hasMeaningfulContent,
  hasSerializedRestoreState,
  renderEventSeqAtSchedule,
  currentRenderEventSeq,
}: StationTerminalRendererRecoveryInput): boolean {
  if (currentRenderEventSeq !== renderEventSeqAtSchedule) {
    return false
  }
  if (!hasMeaningfulContent && !hasSerializedRestoreState) {
    return false
  }
  return true
}

function normalizeStationTerminalRendererRecoveryFrameCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

export function scheduleStationTerminalRendererRecoveryFrameDrain(
  onSettled: () => void,
  { frameCount, scheduler, fallbackDelayMs }: StationTerminalRendererRecoveryFrameDrainOptions,
): StationTerminalRendererRecoveryFrameDrain {
  const drain: StationTerminalRendererRecoveryFrameDrain = {
    handle: null,
    cancel: () => {},
  }
  let remainingFrames = normalizeStationTerminalRendererRecoveryFrameCount(frameCount)
  let cancelled = false
  const cancel = () => {
    cancelled = true
    cancelStationTerminalFrameFlush(drain.handle)
    drain.handle = null
  }
  drain.cancel = cancel
  const step = () => {
    if (cancelled) {
      return
    }
    if (remainingFrames <= 0) {
      drain.handle = null
      onSettled()
      return
    }
    remainingFrames -= 1
    drain.handle = scheduleStationTerminalFrameFlush(step, scheduler, fallbackDelayMs)
  }
  step()
  return drain
}

export function scheduleStationTerminalRenderRefreshFrame({
  scheduler,
  run,
  fallbackDelayMs,
}: ScheduleStationTerminalRenderRefreshFrameOptions): StationTerminalRenderRefreshFrame {
  const refreshFrame: StationTerminalRenderRefreshFrame = {
    handle: null,
    cancel: () => {},
  }
  refreshFrame.cancel = () => {
    cancelStationTerminalFrameFlush(refreshFrame.handle)
    refreshFrame.handle = null
  }
  refreshFrame.handle = scheduleStationTerminalFrameFlush(
    () => {
      refreshFrame.handle = null
      run()
    },
    scheduler,
    fallbackDelayMs,
  )
  return refreshFrame
}

export function scheduleStationTerminalAppearanceSyncFrame(
  options: ScheduleStationTerminalAppearanceSyncFrameOptions,
): StationTerminalAppearanceSyncFrame {
  return scheduleStationTerminalRenderRefreshFrame(options)
}
