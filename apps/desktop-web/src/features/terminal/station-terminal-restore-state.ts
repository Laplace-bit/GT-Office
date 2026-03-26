export interface RestoreStateSnapshot {
  content: string
  cols: number
  rows: number
}

export interface SessionOwnedRestoreState {
  sessionId: string
  state: RestoreStateSnapshot
}

export function captureSessionOwnedRestoreState(
  runtime: { sessionId: string | null } | null | undefined,
  state: RestoreStateSnapshot,
): SessionOwnedRestoreState | null {
  const sessionId = runtime?.sessionId ?? null
  if (!sessionId) {
    return null
  }
  return {
    sessionId,
    state,
  }
}

export function captureMatchingSessionOwnedRestoreState(
  runtime: { sessionId: string | null } | null | undefined,
  sourceSessionId: string | null | undefined,
  state: RestoreStateSnapshot,
): SessionOwnedRestoreState | null {
  const sessionId = runtime?.sessionId ?? null
  if (!sessionId || sessionId !== (sourceSessionId ?? null)) {
    return null
  }
  return {
    sessionId,
    state,
  }
}

export function captureReportedSessionOwnedRestoreState(
  runtime: { sessionId: string | null } | null | undefined,
  reportedSessionId: string | null | undefined,
  state: RestoreStateSnapshot,
): SessionOwnedRestoreState | null {
  return captureMatchingSessionOwnedRestoreState(runtime, reportedSessionId, state)
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
