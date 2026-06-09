export interface RestoreStateSnapshot {
  content: string
  cols: number
  rows: number
  viewportY?: number | null
}

export interface SessionOwnedRestoreState {
  sessionId: string
  state: RestoreStateSnapshot
  revision: number
}

export function normalizeStationTerminalRestoreViewportY(viewportY?: number | null): number | null {
  if (typeof viewportY !== 'number' || !Number.isFinite(viewportY) || viewportY < 0) {
    return null
  }
  return Math.floor(viewportY)
}

export function normalizeStationTerminalRestoreStateSnapshot(state: RestoreStateSnapshot): RestoreStateSnapshot {
  const viewportY = normalizeStationTerminalRestoreViewportY(state.viewportY)
  if (viewportY === null) {
    const { viewportY: _viewportY, ...rest } = state
    return rest
  }
  return {
    ...state,
    viewportY,
  }
}

export function captureSessionOwnedRestoreState(
  runtime: { sessionId: string | null } | null | undefined,
  state: RestoreStateSnapshot,
  revision = 0,
): SessionOwnedRestoreState | null {
  const sessionId = runtime?.sessionId ?? null
  if (!sessionId) {
    return null
  }
  return {
    sessionId,
    state: normalizeStationTerminalRestoreStateSnapshot(state),
    revision,
  }
}

export function captureMatchingSessionOwnedRestoreState(
  runtime: { sessionId: string | null } | null | undefined,
  sourceSessionId: string | null | undefined,
  state: RestoreStateSnapshot,
  revision = 0,
): SessionOwnedRestoreState | null {
  const sessionId = runtime?.sessionId ?? null
  if (!sessionId || sessionId !== (sourceSessionId ?? null)) {
    return null
  }
  return {
    sessionId,
    state: normalizeStationTerminalRestoreStateSnapshot(state),
    revision,
  }
}

export function captureReportedSessionOwnedRestoreState(
  runtime: { sessionId: string | null } | null | undefined,
  reportedSessionId: string | null | undefined,
  state: RestoreStateSnapshot,
  revision = 0,
): SessionOwnedRestoreState | null {
  return captureMatchingSessionOwnedRestoreState(runtime, reportedSessionId, state, revision)
}

export function retainSessionOwnedRestoreState(
  restoreState: SessionOwnedRestoreState | null | undefined,
  sessionId: string | null,
): SessionOwnedRestoreState | null {
  if (!restoreState) {
    return null
  }
  if (!sessionId || restoreState.sessionId !== sessionId) {
    return null
  }
  return restoreState
}

export function shouldPreferSessionOwnedRestoreState(
  restoreState: SessionOwnedRestoreState | null | undefined,
  sessionId: string | null,
  outputRevision: number,
): restoreState is SessionOwnedRestoreState {
  if (!restoreState) {
    return false
  }
  if (!sessionId || restoreState.sessionId !== sessionId) {
    return false
  }
  return restoreState.revision >= outputRevision
}
