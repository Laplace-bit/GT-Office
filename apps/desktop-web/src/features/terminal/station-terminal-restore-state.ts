export interface RestoreStateSnapshot {
  content: string
  cols: number
  rows: number
}

export interface SessionOwnedRestoreState {
  sessionId: string
  state: RestoreStateSnapshot
  revision: number
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
    state,
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
    state,
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
