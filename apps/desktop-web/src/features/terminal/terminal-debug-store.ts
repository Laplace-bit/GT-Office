import { useSyncExternalStore } from 'react'
import {
  appendTerminalDebugRecord,
  hydrateTerminalDebugRecordHumanText,
  type TerminalDebugRecord,
} from './terminal-debug-model.js'

const EMPTY_RECORDS: TerminalDebugRecord[] = []

const recordsByStationId = new Map<string, TerminalDebugRecord[]>()
const listenersByStationId = new Map<string, Set<() => void>>()

function emitStationTerminalDebugRecords(stationId: string) {
  listenersByStationId.get(stationId)?.forEach((listener) => listener())
}

export function readStationTerminalDebugRecords(stationId: string): TerminalDebugRecord[] {
  return recordsByStationId.get(stationId) ?? EMPTY_RECORDS
}

export function appendStationTerminalDebugRecord(
  stationId: string,
  record: TerminalDebugRecord,
  limit: number,
) {
  const current = readStationTerminalDebugRecords(stationId)
  const next = appendTerminalDebugRecord(current, record, limit)
  recordsByStationId.set(stationId, next)
  emitStationTerminalDebugRecords(stationId)
}

export function hydrateStationTerminalDebugHumanText(
  stationId: string,
  sessionId: string | null,
  screenRevision: number,
  humanText: string | null | undefined,
) {
  const current = recordsByStationId.get(stationId)
  if (!current?.length) {
    return
  }
  const next = hydrateTerminalDebugRecordHumanText(current, sessionId, screenRevision, humanText)
  if (next === current) {
    return
  }
  recordsByStationId.set(stationId, next)
  emitStationTerminalDebugRecords(stationId)
}

export function clearStationTerminalDebugRecords(stationId: string) {
  const current = recordsByStationId.get(stationId)
  if (!current?.length) {
    return
  }
  recordsByStationId.set(stationId, EMPTY_RECORDS)
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

export function useStationTerminalDebugRecords(stationId: string): TerminalDebugRecord[] {
  return useSyncExternalStore(
    (listener) => subscribeStationTerminalDebugRecords(stationId, listener),
    () => readStationTerminalDebugRecords(stationId),
  )
}

export function resetTerminalDebugStoreForTests() {
  recordsByStationId.clear()
  listenersByStationId.clear()
}
