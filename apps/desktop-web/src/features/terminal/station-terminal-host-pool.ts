import type { Terminal as XtermTerminal } from '@xterm/xterm'
import type { StationTerminalSink } from './station-terminal-sink-types'

export interface ParkedStationTerminalHost {
  key: string
  workspaceId: string
  stationId: string
  sessionId: string
  terminal: XtermTerminal
  fitAddon: { fit: () => void; proposeDimensions?: () => { cols: number; rows: number } | undefined }
  serializeAddon: {
    serialize: (options?: {
      scrollback?: number
      excludeModes?: boolean
      excludeAltBuffer?: boolean
    }) => string
  }
  webglAddon: { dispose: () => void } | null
  surface: HTMLDivElement
  sink: StationTerminalSink | null
  parkedAtMs: number
}

export type StationTerminalHostPool = Map<string, ParkedStationTerminalHost>

const defaultPool: StationTerminalHostPool = new Map()

export function buildStationTerminalHostPoolKey(
  workspaceId: string | null | undefined,
  stationId: string | null | undefined,
): string | null {
  const normalizedWorkspaceId = workspaceId?.trim() ?? ''
  const normalizedStationId = stationId?.trim() ?? ''
  if (!normalizedWorkspaceId || !normalizedStationId) {
    return null
  }
  return `${normalizedWorkspaceId}::${normalizedStationId}`
}

export function createStationTerminalHostSurface(doc: Document = document): HTMLDivElement {
  const surface = doc.createElement('div')
  surface.className = 'station-terminal-host-surface'
  surface.setAttribute('data-terminal-host-surface', 'true')
  return surface
}

function disposeParkedStationTerminalHostEntry(entry: ParkedStationTerminalHost): void {
  try {
    entry.webglAddon?.dispose()
  } catch {
    // Best-effort: WebGL dispose must never block host teardown.
  }
  try {
    entry.terminal.dispose()
  } catch {
    // Best-effort: xterm dispose must never block host teardown.
  }
  entry.webglAddon = null
  entry.sink = null
  entry.surface.remove()
}

export function parkStationTerminalHost(
  entry: Omit<ParkedStationTerminalHost, 'parkedAtMs' | 'key'> & { key?: string | null },
  pool: StationTerminalHostPool = defaultPool,
): ParkedStationTerminalHost | null {
  const key =
    entry.key?.trim() ||
    buildStationTerminalHostPoolKey(entry.workspaceId, entry.stationId)
  const sessionId = entry.sessionId.trim()
  if (!key || !sessionId) {
    disposeParkedStationTerminalHostEntry({
      ...entry,
      key: key ?? `${entry.workspaceId}::${entry.stationId}`,
      sessionId,
      parkedAtMs: Date.now(),
    })
    return null
  }

  const existing = pool.get(key)
  if (existing && existing !== entry) {
    pool.delete(key)
    disposeParkedStationTerminalHostEntry(existing)
  }

  if (entry.surface.parentElement) {
    entry.surface.parentElement.removeChild(entry.surface)
  }

  const parked: ParkedStationTerminalHost = {
    key,
    workspaceId: entry.workspaceId,
    stationId: entry.stationId,
    sessionId,
    terminal: entry.terminal,
    fitAddon: entry.fitAddon,
    serializeAddon: entry.serializeAddon,
    webglAddon: entry.webglAddon,
    surface: entry.surface,
    sink: entry.sink,
    parkedAtMs: Date.now(),
  }
  pool.set(key, parked)
  return parked
}

export function peekParkedStationTerminalHost(
  workspaceId: string | null | undefined,
  stationId: string | null | undefined,
  pool: StationTerminalHostPool = defaultPool,
): ParkedStationTerminalHost | null {
  const key = buildStationTerminalHostPoolKey(workspaceId, stationId)
  if (!key) {
    return null
  }
  return pool.get(key) ?? null
}

export function reclaimStationTerminalHost(
  workspaceId: string | null | undefined,
  stationId: string | null | undefined,
  sessionId: string | null | undefined,
  pool: StationTerminalHostPool = defaultPool,
): ParkedStationTerminalHost | null {
  const key = buildStationTerminalHostPoolKey(workspaceId, stationId)
  const expectedSessionId = sessionId?.trim() ?? ''
  if (!key || !expectedSessionId) {
    return null
  }
  const parked = pool.get(key)
  if (!parked) {
    return null
  }
  if (parked.sessionId !== expectedSessionId) {
    pool.delete(key)
    disposeParkedStationTerminalHostEntry(parked)
    return null
  }
  pool.delete(key)
  return parked
}

export function disposeParkedStationTerminalHost(
  workspaceId: string | null | undefined,
  stationId: string | null | undefined,
  pool: StationTerminalHostPool = defaultPool,
): boolean {
  const key = buildStationTerminalHostPoolKey(workspaceId, stationId)
  if (!key) {
    return false
  }
  const parked = pool.get(key)
  if (!parked) {
    return false
  }
  pool.delete(key)
  disposeParkedStationTerminalHostEntry(parked)
  return true
}

export function disposeParkedStationTerminalHostsForWorkspace(
  workspaceId: string | null | undefined,
  pool: StationTerminalHostPool = defaultPool,
): number {
  const normalizedWorkspaceId = workspaceId?.trim() ?? ''
  if (!normalizedWorkspaceId) {
    return 0
  }
  let disposed = 0
  for (const [key, parked] of [...pool.entries()]) {
    if (parked.workspaceId !== normalizedWorkspaceId) {
      continue
    }
    pool.delete(key)
    disposeParkedStationTerminalHostEntry(parked)
    disposed += 1
  }
  return disposed
}

export function disposeAllParkedStationTerminalHosts(
  pool: StationTerminalHostPool = defaultPool,
): number {
  let disposed = 0
  for (const [key, parked] of [...pool.entries()]) {
    pool.delete(key)
    disposeParkedStationTerminalHostEntry(parked)
    disposed += 1
  }
  return disposed
}

export function listParkedStationTerminalHostKeys(
  pool: StationTerminalHostPool = defaultPool,
): string[] {
  return [...pool.keys()]
}

export function shouldPreserveStationTerminalLiveBuffer(input: {
  preserveLiveBuffer?: boolean | null
  previousSink?: unknown | null
  nextSink?: unknown | null
}): boolean {
  if (!input.preserveLiveBuffer || !input.nextSink) {
    return false
  }
  // A reclaimed host rebinds a fresh sink wrapper around the same live buffer.
  // Skip full restore/reset so scrollback, viewport, and WebGL state stay intact.
  return input.previousSink !== input.nextSink || Boolean(input.preserveLiveBuffer)
}
