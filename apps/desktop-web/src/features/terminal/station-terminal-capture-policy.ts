import {
  cancelStationTerminalFrameFlush,
  scheduleStationTerminalFrameFlush,
  type StationTerminalFrameFlushHandle,
  type StationTerminalFrameFlushScheduler,
} from './station-terminal-frame-flush-scheduler.js'

export function resolveTerminalSerializeDelayMs(
  lastSerializedAtMs: number,
  nowMs: number,
  minIntervalMs: number,
): number {
  if (minIntervalMs <= 0 || lastSerializedAtMs <= 0) {
    return 0
  }
  return Math.max(0, minIntervalMs - Math.max(0, nowMs - lastSerializedAtMs))
}

export type TerminalCaptureTaskKind = 'serialize' | 'screen'

export const RENDERED_SCREEN_REPORT_CACHE_LIMIT = 512

export interface TerminalCaptureTaskFrameDrain {
  handle: StationTerminalFrameFlushHandle | null
  cancel: () => void
}

export interface ScheduleTerminalCaptureTaskFrameDrainOptions {
  pending: Set<TerminalCaptureTaskKind>
  scheduler: StationTerminalFrameFlushScheduler
  runTask: (task: TerminalCaptureTaskKind) => void
  shouldContinue?: () => boolean
  fallbackDelayMs?: number
}

export interface ShouldScheduleRenderedScreenCaptureInput {
  performanceDebugEnabled: boolean
  isActive: boolean
  hasRenderedScreenReporter: boolean
}

export interface ShouldReportRenderedScreenSnapshotInput {
  lastReported: Map<string, number>
  workspaceId: string
  stationId: string
  sessionId: string
  screenRevision: number
  maxEntries?: number
}

export function shouldScheduleRenderedScreenCapture({
  performanceDebugEnabled,
  isActive,
  hasRenderedScreenReporter,
}: ShouldScheduleRenderedScreenCaptureInput): boolean {
  return !performanceDebugEnabled && isActive && hasRenderedScreenReporter
}

export function shouldReportRenderedScreenSnapshot({
  lastReported,
  workspaceId,
  stationId,
  sessionId,
  screenRevision,
  maxEntries = RENDERED_SCREEN_REPORT_CACHE_LIMIT,
}: ShouldReportRenderedScreenSnapshotInput): boolean {
  const nextRevision = Math.floor(screenRevision)
  if (!Number.isFinite(nextRevision) || nextRevision <= 0) {
    return false
  }
  const maxCacheEntries = Math.floor(maxEntries)
  if (!Number.isFinite(maxCacheEntries) || maxCacheEntries <= 0) {
    return false
  }
  const reportKey = `${workspaceId}\u0000${stationId}\u0000${sessionId}`
  if ((lastReported.get(reportKey) ?? 0) >= nextRevision) {
    return false
  }
  if (!lastReported.has(reportKey) && lastReported.size >= maxCacheEntries) {
    const oldest = lastReported.keys().next()
    if (!oldest.done) {
      lastReported.delete(oldest.value)
    }
  }
  lastReported.set(reportKey, nextRevision)
  return true
}

export function takeNextTerminalCaptureTask(
  pending: Set<TerminalCaptureTaskKind>,
): TerminalCaptureTaskKind | null {
  if (pending.has('screen')) {
    pending.delete('screen')
    return 'screen'
  }
  if (pending.has('serialize')) {
    pending.delete('serialize')
    return 'serialize'
  }
  return null
}

export function scheduleTerminalCaptureTaskFrameDrain({
  pending,
  scheduler,
  runTask,
  shouldContinue,
  fallbackDelayMs,
}: ScheduleTerminalCaptureTaskFrameDrainOptions): TerminalCaptureTaskFrameDrain {
  const drain: TerminalCaptureTaskFrameDrain = {
    handle: null,
    cancel: () => {},
  }
  let cancelled = false
  const cancel = () => {
    cancelled = true
    cancelStationTerminalFrameFlush(drain.handle)
    drain.handle = null
  }
  drain.cancel = cancel
  const step = () => {
    drain.handle = null
    if (cancelled) {
      return
    }
    if (shouldContinue && !shouldContinue()) {
      pending.clear()
      return
    }
    const task = takeNextTerminalCaptureTask(pending)
    if (task === null) {
      return
    }
    runTask(task)
    if (pending.size <= 0 || cancelled) {
      return
    }
    if (shouldContinue && !shouldContinue()) {
      pending.clear()
      return
    }
    drain.handle = scheduleStationTerminalFrameFlush(step, scheduler, fallbackDelayMs)
  }
  drain.handle = scheduleStationTerminalFrameFlush(step, scheduler, fallbackDelayMs)
  return drain
}
