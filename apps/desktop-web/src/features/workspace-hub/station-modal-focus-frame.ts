import {
  cancelStationTerminalFrameFlush,
  scheduleStationTerminalFrameFlush,
  type StationTerminalFrameFlushHandle,
  type StationTerminalFrameFlushScheduler,
} from '../terminal/station-terminal-frame-flush-scheduler.js'

export interface StationModalFocusFrame {
  handle: StationTerminalFrameFlushHandle | null
  cancel: () => void
}

export interface ScheduleStationModalFocusFrameOptions {
  scheduler: StationTerminalFrameFlushScheduler
  focus: () => void
  fallbackDelayMs?: number
}

export function scheduleStationModalFocusFrame({
  scheduler,
  focus,
  fallbackDelayMs,
}: ScheduleStationModalFocusFrameOptions): StationModalFocusFrame {
  const focusFrame: StationModalFocusFrame = {
    handle: null,
    cancel: () => {},
  }
  focusFrame.cancel = () => {
    cancelStationTerminalFrameFlush(focusFrame.handle)
    focusFrame.handle = null
  }
  focusFrame.handle = scheduleStationTerminalFrameFlush(
    () => {
      focusFrame.handle = null
      focus()
    },
    scheduler,
    fallbackDelayMs,
  )
  return focusFrame
}
