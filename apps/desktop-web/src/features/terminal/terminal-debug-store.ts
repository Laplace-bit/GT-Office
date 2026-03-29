import { useSyncExternalStore } from 'react'
import type { TerminalDebugHumanEntry } from '../../shell/integration/desktop-api.js'
import type { TerminalDebugRecord } from './terminal-debug-model.js'

export interface StationTerminalDebugHumanLog {
  entries: TerminalDebugHumanEntry[]
  eventCount: number
}

const EMPTY_HUMAN_LOG: StationTerminalDebugHumanLog = {
  entries: [],
  eventCount: 0,
}

const EMPTY_RECORDS: TerminalDebugRecord[] = []

const humanLogByStationId = new Map<string, StationTerminalDebugHumanLog>()
const enabledByStationId = new Map<string, boolean>()
const listenersByStationId = new Map<string, Set<() => void>>()

function emitStationTerminalDebugRecords(stationId: string) {
  listenersByStationId.get(stationId)?.forEach((listener) => listener())
}

export function readStationTerminalDebugHumanLog(stationId: string): StationTerminalDebugHumanLog {
  return humanLogByStationId.get(stationId) ?? EMPTY_HUMAN_LOG
}

export function isStationTerminalDebugEnabled(stationId: string): boolean {
  return enabledByStationId.get(stationId) ?? false
}

export function setStationTerminalDebugEnabled(stationId: string, enabled: boolean) {
  if (enabled) {
    enabledByStationId.set(stationId, true)
    return
  }
  enabledByStationId.delete(stationId)
}

export function setStationTerminalDebugHumanLog(
  stationId: string,
  nextLog: StationTerminalDebugHumanLog,
) {
  const current = humanLogByStationId.get(stationId)
  const unchanged =
    current?.eventCount === nextLog.eventCount &&
    current?.entries.length === nextLog.entries.length &&
    current?.entries.every(
      (entry, index) =>
        entry.atMs === nextLog.entries[index]?.atMs && entry.text === nextLog.entries[index]?.text,
    )
  if (unchanged) {
    return
  }
  humanLogByStationId.set(stationId, nextLog)
  emitStationTerminalDebugRecords(stationId)
}

export function clearStationTerminalDebugRecords(stationId: string) {
  const current = humanLogByStationId.get(stationId)
  if (!current?.eventCount) {
    return
  }
  humanLogByStationId.set(stationId, EMPTY_HUMAN_LOG)
  emitStationTerminalDebugRecords(stationId)
}

export function subscribeStationTerminalDebugRecords(
  stationId: string,
  listener: () => void,
): () => void {
  const listeners = listenersByStationId.get(stationId) ?? new Set<() => void>()
  listeners.add(listener)
  listenersByStationId.set(stationId, listeners)
  return () => {
    const current = listenersByStationId.get(stationId)
    if (!current) {
      return
    }
    current.delete(listener)
    if (current.size === 0) {
      listenersByStationId.delete(stationId)
    }
  }
}

export function useStationTerminalDebugHumanLog(
  stationId: string,
): StationTerminalDebugHumanLog {
  return useSyncExternalStore(
    (listener) => subscribeStationTerminalDebugRecords(stationId, listener),
    () => readStationTerminalDebugHumanLog(stationId),
  )
}

export function resetTerminalDebugStoreForTests() {
  humanLogByStationId.clear()
  enabledByStationId.clear()
  listenersByStationId.clear()
}

// Compatibility no-ops for record-based callers while the remaining frontend plumbing is removed.
export function appendStationTerminalDebugRecord(
  _stationId: string,
  _record: TerminalDebugRecord,
  _limit: number,
) {}

export function hydrateStationTerminalDebugHumanText(
  _stationId: string,
  _sessionId: string | null,
  _screenRevision: number,
  _humanText: string | null | undefined,
) {}

export function readStationTerminalDebugRecords(_stationId: string): TerminalDebugRecord[] {
  return EMPTY_RECORDS
}

export function useStationTerminalDebugRecords(_stationId: string): TerminalDebugRecord[] {
  return EMPTY_RECORDS
}
