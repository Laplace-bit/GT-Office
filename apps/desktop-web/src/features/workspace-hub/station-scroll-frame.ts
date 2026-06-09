import {
  cancelStationTerminalFrameFlush,
  scheduleStationTerminalFrameFlush,
  type StationTerminalFrameFlushHandle,
  type StationTerminalFrameFlushScheduler,
} from '../terminal/station-terminal-frame-flush-scheduler.js'

export interface StationScrollFrame {
  handle: StationTerminalFrameFlushHandle | null
  cancel: () => void
}

export interface ScheduleStationScrollFrameOptions {
  scheduler: StationTerminalFrameFlushScheduler
  scroll: () => void
  fallbackDelayMs?: number
}

export function scheduleStationScrollFrame({
  scheduler,
  scroll,
  fallbackDelayMs,
}: ScheduleStationScrollFrameOptions): StationScrollFrame {
  const scrollFrame: StationScrollFrame = {
    handle: null,
    cancel: () => {},
  }
  scrollFrame.cancel = () => {
    cancelStationTerminalFrameFlush(scrollFrame.handle)
    scrollFrame.handle = null
  }
  scrollFrame.handle = scheduleStationTerminalFrameFlush(
    () => {
      scrollFrame.handle = null
      scroll()
    },
    scheduler,
    fallbackDelayMs,
  )
  return scrollFrame
}
