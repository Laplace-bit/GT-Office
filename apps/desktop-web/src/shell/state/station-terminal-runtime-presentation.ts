import { shouldRenderStationTerminal } from '../../features/terminal/station-terminal-runtime-state.js'
import { peekParkedStationTerminalHost } from '../../features/terminal/station-terminal-host-pool.js'
import type { WorkspaceTerminalSessionDocument } from './workspace-terminal-session-store.js'

export interface StationTerminalRuntimePresentation {
  sessionId: string | null
  stateRaw: string
  unreadCount: number
  shell: string | null
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string | null
}

function createIdleRuntime(): StationTerminalRuntimePresentation {
  return {
    sessionId: null,
    stateRaw: 'idle',
    unreadCount: 0,
    shell: null,
    cwdMode: 'workspace_root',
    resolvedCwd: null,
  }
}

function cloneRuntime(
  runtime: StationTerminalRuntimePresentation,
): StationTerminalRuntimePresentation {
  return {
    sessionId: runtime.sessionId,
    stateRaw: runtime.stateRaw,
    unreadCount: runtime.unreadCount,
    shell: runtime.shell,
    cwdMode: runtime.cwdMode,
    resolvedCwd: runtime.resolvedCwd,
  }
}

/**
 * Resolve the station terminal runtime that the first paint after a workspace
 * switch should use. Prefer live React state, then the parked xterm host, then
 * the workspace terminal document cache — never fall through to a blank idle
 * shell when a live session is already known for that station.
 */
export function resolveStationTerminalRuntimeForPresentation(input: {
  stationId: string
  workspaceId: string | null | undefined
  liveRuntime: StationTerminalRuntimePresentation | null | undefined
  cachedRuntime: StationTerminalRuntimePresentation | null | undefined
}): StationTerminalRuntimePresentation {
  const live = input.liveRuntime
  if (shouldRenderStationTerminal(live)) {
    return cloneRuntime(live!)
  }

  const parked = peekParkedStationTerminalHost(input.workspaceId, input.stationId)
  if (parked?.sessionId) {
    return {
      sessionId: parked.sessionId,
      stateRaw: live?.stateRaw && live.stateRaw !== 'idle' ? live.stateRaw : 'running',
      unreadCount: live?.unreadCount ?? input.cachedRuntime?.unreadCount ?? 0,
      shell: live?.shell ?? input.cachedRuntime?.shell ?? null,
      cwdMode: live?.cwdMode ?? input.cachedRuntime?.cwdMode ?? 'workspace_root',
      resolvedCwd: live?.resolvedCwd ?? input.cachedRuntime?.resolvedCwd ?? null,
    }
  }

  const cached = input.cachedRuntime
  if (shouldRenderStationTerminal(cached)) {
    return cloneRuntime(cached!)
  }

  if (live) {
    return cloneRuntime(live)
  }
  if (cached) {
    return cloneRuntime(cached)
  }
  return createIdleRuntime()
}

export function mergeStationTerminalRuntimesForPresentation(input: {
  stations: ReadonlyArray<{ id: string }>
  liveRuntimes: Record<string, StationTerminalRuntimePresentation>
  cachedDocument: WorkspaceTerminalSessionDocument | null | undefined
  workspaceId: string | null | undefined
}): Record<string, StationTerminalRuntimePresentation> {
  const next: Record<string, StationTerminalRuntimePresentation> = {}
  for (const station of input.stations) {
    next[station.id] = resolveStationTerminalRuntimeForPresentation({
      stationId: station.id,
      workspaceId: input.workspaceId,
      liveRuntime: input.liveRuntimes[station.id],
      cachedRuntime: input.cachedDocument?.stationTerminals[station.id],
    })
  }
  return next
}
