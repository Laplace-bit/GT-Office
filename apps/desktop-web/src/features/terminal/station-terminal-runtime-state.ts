type StationTerminalRuntimeShape = {
  sessionId: string | null
  stateRaw: string
  unreadCount: number
  shell: string | null
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string | null
}

type StationTerminalRuntimeStateLike = Pick<StationTerminalRuntimeShape, 'sessionId'> & {
  stateRaw?: string | null
}

export function shouldRenderStationTerminal(
  runtime: StationTerminalRuntimeStateLike | null | undefined,
): boolean {
  if (Boolean(runtime?.sessionId)) {
    return true
  }
  return runtime?.stateRaw === 'exited' || runtime?.stateRaw === 'killed' || runtime?.stateRaw === 'failed'
}

export function isStationTerminalRuntimeLive(
  runtime: StationTerminalRuntimeStateLike | null | undefined,
): boolean {
  if (!runtime?.sessionId) {
    return false
  }
  return runtime.stateRaw !== 'exited' && runtime.stateRaw !== 'killed' && runtime.stateRaw !== 'failed'
}

export function shouldAutoLaunchStationTerminalFromSurface(
  runtime: StationTerminalRuntimeStateLike | null | undefined,
): boolean {
  return !runtime?.sessionId && !shouldRenderStationTerminal(runtime)
}

export function shouldForwardStationTerminalInput(
  target: StationTerminalRuntimeStateLike | string | null | undefined,
): boolean {
  if (typeof target === 'string') {
    return target.length > 0
  }
  return isStationTerminalRuntimeLive(target)
}

export function shouldAcceptStationTerminalLocalInput(
  target: StationTerminalRuntimeStateLike | string | null | undefined,
): boolean {
  return shouldForwardStationTerminalInput(target)
}

export function isStationTerminalFocusReportInput(input: string | null | undefined): boolean {
  return input === '\x1b[I' || input === '\x1b[O'
}

export function buildStationTerminalCommandSubmitChunks(
  command: string,
  submitSequence: string | null | undefined,
): string[] {
  const normalizedSubmitSequence = submitSequence && submitSequence.length > 0 ? submitSequence : '\r'
  if (!command) {
    return [normalizedSubmitSequence]
  }
  return [command, normalizedSubmitSequence]
}

export function shouldMatchDetachedBridgeSession(
  runtimeSessionId: string | null | undefined,
  messageSessionId: string | null | undefined,
): boolean {
  const normalizedRuntimeSessionId = runtimeSessionId ?? null
  const normalizedMessageSessionId = messageSessionId ?? null
  if (!normalizedRuntimeSessionId) {
    return false
  }
  return normalizedRuntimeSessionId === normalizedMessageSessionId
}

export function didStationTerminalRenderabilityChange(
  previousRuntime: StationTerminalRuntimeStateLike | null | undefined,
  nextRuntime: StationTerminalRuntimeStateLike | null | undefined,
): boolean {
  return shouldRenderStationTerminal(previousRuntime) !== shouldRenderStationTerminal(nextRuntime)
}

export function patchTouchesSessionBinding(
  patch: Partial<StationTerminalRuntimeShape> | null | undefined,
): boolean {
  return Boolean(patch && Object.prototype.hasOwnProperty.call(patch, 'sessionId'))
}

export function buildSessionBindingRuntimePatch(
  sessionId: string | null | undefined,
): Partial<StationTerminalRuntimeShape> {
  return {
    sessionId: sessionId ?? null,
  }
}

function hasOwnRuntimePatchKey(
  patch: Partial<StationTerminalRuntimeShape> | null | undefined,
  key: keyof StationTerminalRuntimeShape,
): boolean {
  return Boolean(patch && Object.prototype.hasOwnProperty.call(patch, key))
}

export function doesStationTerminalRuntimePatchChangeState(
  runtime: StationTerminalRuntimeShape | null | undefined,
  patch: Partial<StationTerminalRuntimeShape> | null | undefined,
): boolean {
  if (!patch) {
    return false
  }
  if (!runtime) {
    return Object.keys(patch).length > 0
  }
  if (hasOwnRuntimePatchKey(patch, 'sessionId') && (patch.sessionId ?? null) !== (runtime.sessionId ?? null)) {
    return true
  }
  if (hasOwnRuntimePatchKey(patch, 'stateRaw') && (patch.stateRaw ?? 'idle') !== runtime.stateRaw) {
    return true
  }
  if (hasOwnRuntimePatchKey(patch, 'unreadCount') && (patch.unreadCount ?? 0) !== runtime.unreadCount) {
    return true
  }
  if (hasOwnRuntimePatchKey(patch, 'shell') && (patch.shell ?? null) !== (runtime.shell ?? null)) {
    return true
  }
  if (
    hasOwnRuntimePatchKey(patch, 'cwdMode') &&
    (patch.cwdMode === 'custom' ? 'custom' : 'workspace_root') !== runtime.cwdMode
  ) {
    return true
  }
  if (hasOwnRuntimePatchKey(patch, 'resolvedCwd') && (patch.resolvedCwd ?? null) !== (runtime.resolvedCwd ?? null)) {
    return true
  }
  return false
}

export function resolveNextPendingLaunchCommand(
  launchMode: 'terminal' | 'cli',
  launchCommand: string | null | undefined,
): string | null {
  if (launchMode !== 'cli') {
    return null
  }
  return launchCommand ?? null
}

export function hydrateSettlesSessionBinding(
  previousProjectionSeq: number,
  nextProjectionSeq: number,
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  if (runtime?.sessionId) {
    return true
  }
  return nextProjectionSeq > previousProjectionSeq
}

export function didSessionBindingChange(
  previousSessionId: string | null | undefined,
  nextSessionId: string | null | undefined,
): boolean {
  return (previousSessionId ?? null) !== (nextSessionId ?? null)
}

export function didRuntimeSessionBindingChange(
  previousRuntime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
  nextRuntime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  return didSessionBindingChange(previousRuntime?.sessionId, nextRuntime?.sessionId)
}

export function didHydrateChangeSessionBinding(
  previousRuntime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
  nextRuntime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  return didRuntimeSessionBindingChange(previousRuntime, nextRuntime)
}

export function resolveStationSessionRebindCleanup(
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
  nextSessionId: string | null | undefined,
): {
  previousSessionId: string
  nextSessionId: string
  shouldClearInputBuffer: true
  shouldClearRestoreState: true
  shouldResetSubmitSequence: true
  shouldTerminatePreviousSession: true
  signal: 'TERM'
} | null {
  const previousSessionId = runtime?.sessionId ?? null
  const normalizedNextSessionId = nextSessionId ?? null
  if (!previousSessionId || !normalizedNextSessionId || previousSessionId === normalizedNextSessionId) {
    return null
  }
  return {
    previousSessionId,
    nextSessionId: normalizedNextSessionId,
    shouldClearInputBuffer: true,
    shouldClearRestoreState: true,
    shouldResetSubmitSequence: true,
    shouldTerminatePreviousSession: true,
    signal: 'TERM',
  }
}

export function resolveClosedStationSessionCleanup(
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
  closedSessionId: string | null | undefined,
): {
  closedSessionId: string
  shouldClearInputBuffer: true
  shouldClearSubmitSequence: true
} | null {
  const normalizedClosedSessionId = closedSessionId ?? null
  if (!normalizedClosedSessionId || runtime?.sessionId !== normalizedClosedSessionId) {
    return null
  }
  return {
    closedSessionId: normalizedClosedSessionId,
    shouldClearInputBuffer: true,
    shouldClearSubmitSequence: true,
  }
}

export function resolveClosedStationRuntimeRegistrationCleanup(
  runtime:
    | {
        workspaceId: string
        sessionId: string
      }
    | null
    | undefined,
  closedSessionId: string | null | undefined,
):
  | {
      workspaceId: string
      sessionId: string
    }
  | null {
  const normalizedClosedSessionId = closedSessionId ?? null
  const workspaceId = runtime?.workspaceId?.trim() ?? ''
  if (!normalizedClosedSessionId || !workspaceId || runtime?.sessionId !== normalizedClosedSessionId) {
    return null
  }
  return {
    workspaceId,
    sessionId: runtime.sessionId,
  }
}

export function resolveDroppedStationSessionCleanup(sessionId: string | null | undefined): {
  sessionId: string
  signal: 'TERM'
} | null {
  const normalizedSessionId = sessionId?.trim() ?? ''
  if (!normalizedSessionId) {
    return null
  }
  return {
    sessionId: normalizedSessionId,
    signal: 'TERM',
  }
}

export function resolveDroppedStationRuntimeCleanup(
  expectedWorkspaceId: string | null | undefined,
  currentWorkspaceId: string | null | undefined,
  stationStillExists: boolean,
  runtime:
    | Pick<StationTerminalRuntimeShape, 'sessionId' | 'resolvedCwd'>
    | null
    | undefined,
):
  | {
      action: 'register_current'
      sessionId: string
      resolvedCwd: string | null
    }
  | {
      action: 'unregister'
    } {
  if (
    (expectedWorkspaceId ?? null) !== (currentWorkspaceId ?? null) ||
    !stationStillExists ||
    !runtime?.sessionId
  ) {
    return { action: 'unregister' }
  }
  return {
    action: 'register_current',
    sessionId: runtime.sessionId,
    resolvedCwd: runtime.resolvedCwd ?? null,
  }
}

export function resolveStationRuntimeRegistrationCleanup(
  expectedWorkspaceId: string | null | undefined,
  currentWorkspaceId: string | null | undefined,
  stationStillExists: boolean,
  expectedSessionId: string | null | undefined,
  runtime:
    | Pick<StationTerminalRuntimeShape, 'sessionId' | 'resolvedCwd'>
    | null
    | undefined,
):
  | {
      action: 'register_current'
      sessionId: string
      resolvedCwd: string | null
    }
  | {
      action: 'unregister'
    }
  | null {
  if ((expectedSessionId ?? null) === (runtime?.sessionId ?? null)) {
    return null
  }
  return resolveDroppedStationRuntimeCleanup(
    expectedWorkspaceId,
    currentWorkspaceId,
    stationStillExists,
    runtime,
  )
}

export function ensureSingleFlightStationSession(params: {
  getExistingSessionId: (stationId: string) => string | null | undefined
  getInFlight: (stationId: string) => Promise<string | null> | undefined
  setInFlight: (stationId: string, promise: Promise<string | null>) => void
  clearInFlight: (stationId: string, promise: Promise<string | null>) => void
  createSession: (stationId: string) => Promise<string | null>
}): (stationId: string) => Promise<string | null> {
  return (stationId: string): Promise<string | null> => {
    const existingSessionId = params.getExistingSessionId(stationId) ?? null
    if (existingSessionId) {
      return Promise.resolve(existingSessionId)
    }

    const inFlight = params.getInFlight(stationId)
    if (inFlight) {
      return inFlight
    }

    const trackedPromise = params
      .createSession(stationId)
      .finally(() => {
        params.clearInFlight(stationId, trackedPromise)
      })
    params.setInFlight(stationId, trackedPromise)
    return trackedPromise
  }
}

export function shouldApplyStationSessionResult(
  expectedWorkspaceId: string | null | undefined,
  currentWorkspaceId: string | null | undefined,
  stationStillExists: boolean,
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  if (!stationStillExists) {
    return false
  }
  if ((expectedWorkspaceId ?? null) !== (currentWorkspaceId ?? null)) {
    return false
  }
  return !runtime?.sessionId
}

export function shouldApplyRecoveredStationOutput(
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  return (runtime?.sessionId ?? null) === (sessionId ?? null)
}

export function resolveTerminalOutputSequenceAction(
  payloadSeq: number,
  currentSeq: number | null | undefined,
): 'stale' | 'append' | 'recover' {
  const normalizedCurrentSeq = Math.max(0, Math.floor(currentSeq ?? 0))
  if (payloadSeq <= normalizedCurrentSeq) {
    return 'stale'
  }
  if (payloadSeq === normalizedCurrentSeq + 1) {
    return 'append'
  }
  return 'recover'
}

export function shouldReplayStationTerminalSinkBinding(input: {
  previousSink: unknown | null | undefined
  nextSink: unknown | null | undefined
  hasPendingReplay: boolean
}): boolean {
  if (!input.nextSink) {
    return false
  }
  return input.previousSink !== input.nextSink || input.hasPendingReplay
}

export function shouldApplyStationSessionLaunchFailure(
  expectedWorkspaceId: string | null | undefined,
  currentWorkspaceId: string | null | undefined,
  stationStillExists: boolean,
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  return shouldApplyStationSessionResult(
    expectedWorkspaceId,
    currentWorkspaceId,
    stationStillExists,
    runtime,
  )
}

export function shouldApplyStationToolLaunchResult(
  expectedWorkspaceId: string | null | undefined,
  currentWorkspaceId: string | null | undefined,
  stationStillExists: boolean,
  requestSeq: number,
  latestRequestSeq: number,
): boolean {
  if (!stationStillExists) {
    return false
  }
  if ((expectedWorkspaceId ?? null) !== (currentWorkspaceId ?? null)) {
    return false
  }
  return requestSeq === latestRequestSeq
}

export function shouldFlushPendingLaunchCommand(
  command: string | null | undefined,
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  return Boolean(command && runtime?.sessionId)
}

export function shouldClearPendingLaunchCommand(
  command: string | null | undefined,
  launchSettled: boolean,
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  return Boolean(command && launchSettled && !runtime?.sessionId)
}

export function shouldClearPendingFocusIntent(
  pendingFocus: boolean | null | undefined,
  launchSettled: boolean,
  runtime: Pick<StationTerminalRuntimeShape, 'sessionId'> | null | undefined,
): boolean {
  return Boolean(pendingFocus && launchSettled && !runtime?.sessionId)
}

export function buildClosedStationTerminalRuntime(
  runtime: StationTerminalRuntimeShape | null | undefined,
  closingSessionId: string,
  nextStateRaw: 'exited' | 'killed' | 'failed',
): StationTerminalRuntimeShape | null {
  if (!runtime) {
    return null
  }
  if (runtime.sessionId !== closingSessionId) {
    return null
  }
  return {
    sessionId: null,
    stateRaw: nextStateRaw,
    unreadCount: runtime.unreadCount,
    shell: null,
    cwdMode: 'workspace_root',
    resolvedCwd: null,
  }
}
