import {
  cancelStationTerminalFrameFlush,
  scheduleStationTerminalFrameFlush,
  type StationTerminalFrameFlushHandle,
  type StationTerminalFrameFlushScheduler,
} from './station-terminal-frame-flush-scheduler.js'

export interface StationTerminalFocusRequestInput {
  focusRuntimeReady: boolean
}

export interface StationTerminalFocusRequestResolution {
  shouldDispatch: boolean
  shouldPersistPending: boolean
}

export interface StationTerminalPendingFocusFlushInput {
  pendingAutoFocus: boolean
  focusRuntimeReady: boolean
}

export interface StationTerminalInactiveMouseGestureInput {
  isActive: boolean
  button: number
}

export interface StationTerminalAutoFocusState {
  active: boolean
  sessionId: string | null
}

export interface StationTerminalAutoFocusInput {
  previous: StationTerminalAutoFocusState
  next: StationTerminalAutoFocusState
}

export interface StationTerminalFocusAttemptContinuationInput {
  componentMounted: boolean
  stationActive: boolean
}

export interface StationTerminalFocusRetryFrame {
  handle: StationTerminalFrameFlushHandle | null
  cancel: () => void
}

export interface ScheduleStationTerminalFocusRetryFrameOptions {
  scheduler: StationTerminalFrameFlushScheduler
  retry: () => void
  fallbackDelayMs?: number
}

export interface FocusStationTerminalSinkWithRetryOptions {
  maxRetryFrames: number
  focus: () => boolean
  scheduler: StationTerminalFrameFlushScheduler
  fallbackDelayMs?: number
}

function normalizeStationTerminalFocusRetryFrames(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

export function resolveStationTerminalFocusRequest({
  focusRuntimeReady,
}: StationTerminalFocusRequestInput): StationTerminalFocusRequestResolution {
  if (!focusRuntimeReady) {
    return {
      shouldDispatch: false,
      shouldPersistPending: true,
    }
  }

  return {
    shouldDispatch: true,
    shouldPersistPending: false,
  }
}

export function shouldFlushPendingStationTerminalFocus({
  pendingAutoFocus,
  focusRuntimeReady,
}: StationTerminalPendingFocusFlushInput): boolean {
  return pendingAutoFocus && focusRuntimeReady
}

export function shouldContinueStationTerminalFocusAttempt({
  componentMounted,
  stationActive,
}: StationTerminalFocusAttemptContinuationInput): boolean {
  return componentMounted && stationActive
}

export function shouldRequestStationTerminalAutoFocus({
  previous,
  next,
}: StationTerminalAutoFocusInput): boolean {
  if (!next.active) {
    return false
  }
  if (!previous.active) {
    return true
  }
  return !previous.sessionId && Boolean(next.sessionId)
}

export function shouldConsumeInactiveStationTerminalMouseGesture({
  isActive,
  button,
}: StationTerminalInactiveMouseGestureInput): boolean {
  return !isActive && button === 0
}

export function scheduleStationTerminalFocusRetryFrame({
  scheduler,
  retry,
  fallbackDelayMs,
}: ScheduleStationTerminalFocusRetryFrameOptions): StationTerminalFocusRetryFrame {
  const retryFrame: StationTerminalFocusRetryFrame = {
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
      retry()
    },
    scheduler,
    fallbackDelayMs,
  )
  return retryFrame
}

export async function focusStationTerminalSinkWithFrameRetry({
  maxRetryFrames,
  focus,
  scheduler,
  fallbackDelayMs,
}: FocusStationTerminalSinkWithRetryOptions): Promise<boolean> {
  const retryFrames = normalizeStationTerminalFocusRetryFrames(maxRetryFrames)
  for (let attempt = 0; attempt <= retryFrames; attempt += 1) {
    if (focus()) {
      return true
    }
    if (attempt >= retryFrames) {
      return false
    }
    await new Promise<void>((resolve) => {
      scheduleStationTerminalFocusRetryFrame({
        scheduler,
        fallbackDelayMs,
        retry: resolve,
      })
    })
  }
  return false
}
