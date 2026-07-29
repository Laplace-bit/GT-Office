import {
  disposeParkedStationTerminalHost,
  peekParkedStationTerminalHost,
} from '../../features/terminal/station-terminal-host-pool.js'
import type { AgentExecutionState } from '../../features/terminal/agent-execution-state.js'
import type { WorkspaceTerminalSessionDocument } from './workspace-terminal-session-store.js'

export interface StationTerminalRuntimePresentation {
  sessionId: string | null
  stateRaw: string
  executionState?: AgentExecutionState
  unreadCount: number
  shell: string | null
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string | null
}

function createIdleRuntime(): StationTerminalRuntimePresentation {
  return {
    sessionId: null,
    stateRaw: 'idle',
    executionState: 'unknown',
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
    executionState: runtime.executionState,
    unreadCount: runtime.unreadCount,
    shell: runtime.shell,
    cwdMode: runtime.cwdMode,
    resolvedCwd: runtime.resolvedCwd,
  }
}

function boundSessionId(
  runtime: StationTerminalRuntimePresentation | null | undefined,
): string | null {
  const sessionId = runtime?.sessionId?.trim() ?? ''
  return sessionId || null
}

/**
 * Presentation-only: should this runtime paint the terminal surface (not session
 * history)? Bound sessions always do. Without a session, only an in-flight
 * launch should keep the terminal chrome — closed/killed/exited without a
 * session belongs on the history/idle surface.
 */
export function shouldPresentStationTerminalSurface(
  runtime: StationTerminalRuntimePresentation | null | undefined,
): boolean {
  if (boundSessionId(runtime)) {
    return true
  }
  return runtime?.stateRaw === 'launching'
}

/**
 * Resolve the station terminal runtime that the first paint after a workspace
 * switch should use.
 *
 * Priority:
 * 1. Live React runtime when it owns a terminal surface
 * 2. Cached workspace document when it owns a terminal surface
 * 3. Parked xterm host only when it matches an expected live/cache session id
 *
 * Never revive a parked host after the user intentionally closed the agent
 * (no session binding in live/cache) — that path must return history/idle.
 */
export function resolveStationTerminalRuntimeForPresentation(input: {
  stationId: string
  workspaceId: string | null | undefined
  liveRuntime: StationTerminalRuntimePresentation | null | undefined
  cachedRuntime: StationTerminalRuntimePresentation | null | undefined
}): StationTerminalRuntimePresentation {
  const live = input.liveRuntime
  const cached = input.cachedRuntime
  const liveSessionId = boundSessionId(live)
  const cachedSessionId = boundSessionId(cached)
  const expectedSessionId = liveSessionId ?? cachedSessionId

  if (shouldPresentStationTerminalSurface(live)) {
    return cloneRuntime(live!)
  }

  if (shouldPresentStationTerminalSurface(cached)) {
    return cloneRuntime(cached!)
  }

  const parked = peekParkedStationTerminalHost(input.workspaceId, input.stationId)
  if (parked?.sessionId) {
    if (expectedSessionId && parked.sessionId === expectedSessionId) {
      return {
        sessionId: parked.sessionId,
        stateRaw:
          (live?.stateRaw && live.stateRaw !== 'idle'
            ? live.stateRaw
            : cached?.stateRaw && cached.stateRaw !== 'idle'
              ? cached.stateRaw
              : 'running') ?? 'running',
        executionState: live?.executionState ?? cached?.executionState ?? 'unknown',
        unreadCount: live?.unreadCount ?? cached?.unreadCount ?? 0,
        shell: live?.shell ?? cached?.shell ?? null,
        cwdMode: live?.cwdMode ?? cached?.cwdMode ?? 'workspace_root',
        resolvedCwd: live?.resolvedCwd ?? cached?.resolvedCwd ?? null,
      }
    }

    // Stale parked buffer after close, or session rebinding — drop it so the
    // history surface is restored on the next workspace visit.
    disposeParkedStationTerminalHost(input.workspaceId, input.stationId)
  }

  if (live) {
    // Normalize closed chrome (killed/exited without session) to idle history.
    if (!liveSessionId && live.stateRaw !== 'launching' && live.stateRaw !== 'idle') {
      return {
        ...cloneRuntime(live),
        sessionId: null,
        stateRaw: 'idle',
        shell: null,
        cwdMode: 'workspace_root',
        resolvedCwd: null,
      }
    }
    return cloneRuntime(live)
  }

  if (cached) {
    if (!cachedSessionId && cached.stateRaw !== 'launching' && cached.stateRaw !== 'idle') {
      return {
        ...cloneRuntime(cached),
        sessionId: null,
        stateRaw: 'idle',
        shell: null,
        cwdMode: 'workspace_root',
        resolvedCwd: null,
      }
    }
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
