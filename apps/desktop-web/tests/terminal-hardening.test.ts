import test from 'node:test'
import assert from 'node:assert/strict'
import * as stationTerminalRuntimeState from '../src/features/terminal/station-terminal-runtime-state.js'
import {
  buildClosedStationTerminalRuntime,
  buildSessionBindingRuntimePatch,
  didHydrateChangeSessionBinding,
  didRuntimeSessionBindingChange,
  didSessionBindingChange,
  ensureSingleFlightStationSession,
  hydrateSettlesSessionBinding,
  patchTouchesSessionBinding,
  resolveClosedStationSessionCleanup,
  resolveDroppedStationSessionCleanup,
  resolveDroppedStationRuntimeCleanup,
  resolveStationRuntimeRegistrationCleanup,
  resolveNextPendingLaunchCommand,
  shouldApplyRecoveredStationOutput,
  shouldApplyStationSessionLaunchFailure,
  shouldApplyStationToolLaunchResult,
  resolveStationSessionRebindCleanup,
  shouldApplyStationSessionResult,
  shouldClearPendingFocusIntent,
  shouldClearPendingLaunchCommand,
  shouldFlushPendingLaunchCommand,
} from '../src/features/terminal/station-terminal-runtime-state.js'
import {
  createBufferedStationInputController,
} from '../src/features/terminal/station-terminal-input-buffer.js'
import {
  captureMatchingSessionOwnedRestoreState,
  captureReportedSessionOwnedRestoreState,
  captureSessionOwnedRestoreState,
  retainSessionOwnedRestoreState,
} from '../src/features/terminal/station-terminal-restore-state.js'
import {
  resolveTerminalDocument,
} from '../src/features/terminal/station-terminal-document-scope.js'

test('closes runtime only when the closing session still owns the station', () => {
  assert.deepEqual(
    buildClosedStationTerminalRuntime(
      {
        sessionId: 'session-1',
        stateRaw: 'running',
        unreadCount: 3,
        shell: 'zsh',
        cwdMode: 'custom',
        resolvedCwd: '/workspace/agent',
      },
      'session-1',
      'exited',
    ),
    {
      sessionId: null,
      stateRaw: 'exited',
      unreadCount: 3,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    },
  )

  assert.equal(
    buildClosedStationTerminalRuntime(
      {
        sessionId: 'session-2',
        stateRaw: 'running',
        unreadCount: 1,
        shell: 'zsh',
        cwdMode: 'custom',
        resolvedCwd: '/workspace/new',
      },
      'session-1',
      'failed',
    ),
    null,
  )
})

test('flushes buffered input immediately for submit-like input and drains queued tail after in-flight send', async () => {
  const sent: Array<{ stationId: string; input: string }> = []
  let releaseFirstSend: (() => void) | undefined
  const timerCallbacks = new Map<number, () => void>()
  let nextTimerId = 1

  const controller = createBufferedStationInputController({
    flushDelayMs: 12,
    maxBufferBytes: 64,
    shouldFlushImmediately: (input: string) => input.includes('\n'),
    scheduleTimer: (callback: () => void) => {
      const timerId = nextTimerId
      nextTimerId += 1
      timerCallbacks.set(timerId, callback)
      return timerId
    },
    clearTimer: (timerId: number) => {
      timerCallbacks.delete(timerId)
    },
    sendInput: async (stationId: string, input: string) => {
      sent.push({ stationId, input })
      if (sent.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSend = resolve
        })
      }
    },
  })

  controller.enqueue('station-a', 'claude\n')
  controller.enqueue('station-a', 'follow-up')
  assert.deepEqual(sent, [{ stationId: 'station-a', input: 'claude\n' }])

  const finishFirstSend = releaseFirstSend
  if (!finishFirstSend) {
    throw new Error('expected first send to be pending')
  }
  finishFirstSend()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(sent, [
    { stationId: 'station-a', input: 'claude\n' },
    { stationId: 'station-a', input: 'follow-up' },
  ])

  controller.dispose()
})

test('cancels pending delayed flush when cleared', () => {
  const sent: Array<{ stationId: string; input: string }> = []
  const timerCallbacks = new Map<number, () => void>()
  let nextTimerId = 1

  const controller = createBufferedStationInputController({
    flushDelayMs: 12,
    maxBufferBytes: 8,
    shouldFlushImmediately: () => false,
    scheduleTimer: (callback: () => void) => {
      const timerId = nextTimerId
      nextTimerId += 1
      timerCallbacks.set(timerId, callback)
      return timerId
    },
    clearTimer: (timerId: number) => {
      timerCallbacks.delete(timerId)
    },
    sendInput: async (stationId: string, input: string) => {
      sent.push({ stationId, input })
    },
  })

  controller.enqueue('station-a', 'abcdef')
  assert.equal(timerCallbacks.size, 1)

  controller.clear('station-a')
  assert.equal(timerCallbacks.size, 0)
  assert.deepEqual(sent, [])
  controller.dispose()
})

test('drops restore state when the station session changes', () => {
  assert.deepEqual(
    retainSessionOwnedRestoreState(
      {
        sessionId: 'session-1',
        state: {
          content: 'old screen',
          cols: 80,
          rows: 24,
        },
      },
      'session-1',
    ),
    {
      sessionId: 'session-1',
      state: {
        content: 'old screen',
        cols: 80,
        rows: 24,
      },
    },
  )

  assert.equal(
    retainSessionOwnedRestoreState(
      {
        sessionId: 'session-1',
        state: {
          content: 'old screen',
          cols: 80,
          rows: 24,
        },
      },
      'session-2',
    ),
    null,
  )

  assert.equal(
    retainSessionOwnedRestoreState(
      {
        sessionId: 'session-1',
        state: {
          content: 'old screen',
          cols: 80,
          rows: 24,
        },
      },
      null,
    ),
    null,
  )
})

test('captures restore state only for a live station session', () => {
  assert.deepEqual(
    captureSessionOwnedRestoreState(
      {
        sessionId: 'session-2',
      },
      {
        content: 'screen',
        cols: 120,
        rows: 40,
      },
    ),
    {
      sessionId: 'session-2',
      state: {
        content: 'screen',
        cols: 120,
        rows: 40,
      },
    },
  )

  assert.equal(
    captureSessionOwnedRestoreState(
      {
        sessionId: null,
      },
      {
        content: 'screen',
        cols: 120,
        rows: 40,
      },
    ),
    null,
  )
})

test('captures teardown restore state only when the removing sink still matches the live session', () => {
  assert.deepEqual(
    captureMatchingSessionOwnedRestoreState(
      { sessionId: 'session-2' },
      'session-2',
      {
        content: 'screen',
        cols: 120,
        rows: 40,
      },
    ),
    {
      sessionId: 'session-2',
      state: {
        content: 'screen',
        cols: 120,
        rows: 40,
      },
    },
  )

  assert.equal(
    captureMatchingSessionOwnedRestoreState(
      { sessionId: 'session-2' },
      'session-1',
      {
        content: 'stale screen',
        cols: 80,
        rows: 24,
      },
    ),
    null,
  )

  assert.equal(
    captureMatchingSessionOwnedRestoreState(
      { sessionId: null },
      'session-1',
      {
        content: 'stale screen',
        cols: 80,
        rows: 24,
      },
    ),
    null,
  )
})

test('captures reported restore state only when the reported session still owns the station', () => {
  assert.deepEqual(
    captureReportedSessionOwnedRestoreState(
      { sessionId: 'session-2' },
      'session-2',
      {
        content: 'screen',
        cols: 120,
        rows: 40,
      },
    ),
    {
      sessionId: 'session-2',
      state: {
        content: 'screen',
        cols: 120,
        rows: 40,
      },
    },
  )

  assert.equal(
    captureReportedSessionOwnedRestoreState(
      { sessionId: 'session-2' },
      'session-1',
      {
        content: 'stale screen',
        cols: 80,
        rows: 24,
      },
    ),
    null,
  )

  assert.equal(
    captureReportedSessionOwnedRestoreState(
      { sessionId: null },
      'session-2',
      {
        content: 'stale screen',
        cols: 80,
        rows: 24,
      },
    ),
    null,
  )

  assert.equal(
    captureReportedSessionOwnedRestoreState(
      { sessionId: 'session-2' },
      null,
      {
        content: 'stale screen',
        cols: 80,
        rows: 24,
      },
    ),
    null,
  )
})

test('prefers host ownerDocument over global document for terminal scope', () => {
  const globalDocument = { documentElement: { id: 'global-root' } } as unknown as Document
  const ownerDocument = { documentElement: { id: 'owner-root' } } as unknown as Document
  const host = { ownerDocument } as HTMLElement

  assert.equal(resolveTerminalDocument(host, globalDocument), ownerDocument)
  assert.equal(resolveTerminalDocument(null, globalDocument), globalDocument)
})

test('treats explicit sessionId patches as session binding updates even when null', () => {
  assert.equal(patchTouchesSessionBinding({ sessionId: 'session-1' }), true)
  assert.equal(patchTouchesSessionBinding({ sessionId: null }), true)
  assert.equal(patchTouchesSessionBinding({ stateRaw: 'idle' }), false)
  assert.equal(patchTouchesSessionBinding(null), false)
})

test('builds explicit session binding patches for detached bridge replies', () => {
  assert.deepEqual(buildSessionBindingRuntimePatch('session-1'), { sessionId: 'session-1' })
  assert.deepEqual(buildSessionBindingRuntimePatch(null), { sessionId: null })
  assert.deepEqual(buildSessionBindingRuntimePatch(undefined), { sessionId: null })
})

test('resolves pending CLI command from the current launch intent only', () => {
  assert.equal(
    resolveNextPendingLaunchCommand('terminal', 'claude\n'),
    null,
  )
  assert.equal(
    resolveNextPendingLaunchCommand('cli', 'claude\n'),
    'claude\n',
  )
  assert.equal(
    resolveNextPendingLaunchCommand('cli', null),
    null,
  )
})

test('treats hydrate snapshots as settling detached session launch attempts only after snapshot progress', () => {
  assert.equal(hydrateSettlesSessionBinding(0, 0, { sessionId: null }), false)
  assert.equal(hydrateSettlesSessionBinding(3, 4, { sessionId: null }), true)
  assert.equal(hydrateSettlesSessionBinding(0, 0, { sessionId: 'session-1' }), true)
})

test('treats detached input buffers as stale when the station session binding changes', () => {
  assert.equal(didSessionBindingChange('session-1', 'session-1'), false)
  assert.equal(didSessionBindingChange('session-1', 'session-2'), true)
  assert.equal(didSessionBindingChange('session-1', null), true)
  assert.equal(didSessionBindingChange(null, 'session-2'), true)
})

test('detects runtime-driven station session binding changes', () => {
  assert.equal(
    didRuntimeSessionBindingChange(
      { sessionId: 'session-1' },
      { sessionId: 'session-1' },
    ),
    false,
  )
  assert.equal(
    didRuntimeSessionBindingChange(
      { sessionId: 'session-1' },
      { sessionId: null },
    ),
    true,
  )
  assert.equal(
    didRuntimeSessionBindingChange(
      { sessionId: null },
      { sessionId: 'session-2' },
    ),
    true,
  )
})

test('detects hydrate-driven station session binding changes', () => {
  assert.equal(
    didHydrateChangeSessionBinding(
      { sessionId: 'session-1' },
      { sessionId: 'session-1' },
    ),
    false,
  )
  assert.equal(
    didHydrateChangeSessionBinding(
      { sessionId: 'session-1' },
      { sessionId: null },
    ),
    true,
  )
  assert.equal(
    didHydrateChangeSessionBinding(
      { sessionId: null },
      { sessionId: 'session-2' },
    ),
    true,
  )
})

test('flushes pending CLI launch command against the hydrate runtime being applied', () => {
  assert.equal(
    shouldFlushPendingLaunchCommand('claude\n', { sessionId: null }),
    false,
  )
  assert.equal(
    shouldFlushPendingLaunchCommand('claude\n', { sessionId: 'session-2' }),
    true,
  )
  assert.equal(
    shouldFlushPendingLaunchCommand(null, { sessionId: 'session-2' }),
    false,
  )
})

test('clears pending CLI launch command once the launch settles without a live session', () => {
  assert.equal(
    shouldClearPendingLaunchCommand('claude\n', true, { sessionId: null }),
    true,
  )
  assert.equal(
    shouldClearPendingLaunchCommand('claude\n', false, { sessionId: null }),
    false,
  )
  assert.equal(
    shouldClearPendingLaunchCommand('claude\n', true, { sessionId: 'session-2' }),
    false,
  )
  assert.equal(
    shouldClearPendingLaunchCommand(null, true, { sessionId: null }),
    false,
  )
})

test('clears pending focus intent once the launch settles without a live session', () => {
  assert.equal(
    shouldClearPendingFocusIntent(true, true, { sessionId: null }),
    true,
  )
  assert.equal(
    shouldClearPendingFocusIntent(true, false, { sessionId: null }),
    false,
  )
  assert.equal(
    shouldClearPendingFocusIntent(true, true, { sessionId: 'session-2' }),
    false,
  )
  assert.equal(
    shouldClearPendingFocusIntent(false, true, { sessionId: null }),
    false,
  )
})

test('resolves session cleanup required before rebinding a station to a new live session', () => {
  assert.deepEqual(
    resolveStationSessionRebindCleanup(
      { sessionId: 'session-1' },
      'session-2',
    ),
    {
      previousSessionId: 'session-1',
      nextSessionId: 'session-2',
      shouldClearInputBuffer: true,
      shouldClearRestoreState: true,
      shouldResetSubmitSequence: true,
      shouldTerminatePreviousSession: true,
      signal: 'TERM',
    },
  )

  assert.equal(
    resolveStationSessionRebindCleanup(
      { sessionId: 'session-1' },
      'session-1',
    ),
    null,
  )

  assert.equal(
    resolveStationSessionRebindCleanup(
      { sessionId: null },
      'session-2',
    ),
    null,
  )
})

test('treats null rebinding targets as non-rebind cleanup cases', () => {
  assert.equal(
    resolveStationSessionRebindCleanup(
      { sessionId: 'session-1' },
      null,
    ),
    null,
  )
})

test('resolves closed session cleanup that must clear station-scoped submit state', () => {
  assert.deepEqual(
    resolveClosedStationSessionCleanup({ sessionId: 'session-1' }, 'session-1'),
    {
      closedSessionId: 'session-1',
      shouldClearInputBuffer: true,
      shouldClearSubmitSequence: true,
    },
  )
})

test('ignores closed session cleanup when the station already rebound to another session', () => {
  assert.equal(resolveClosedStationSessionCleanup({ sessionId: 'session-2' }, 'session-1'), null)
  assert.equal(resolveClosedStationSessionCleanup({ sessionId: null }, 'session-1'), null)
})

test('keeps closed runtimes terminal-renderable after the live session id is cleared', () => {
  assert.equal(
    Reflect.has(stationTerminalRuntimeState, 'shouldRenderStationTerminal'),
    true,
  )

  const shouldRenderStationTerminal = Reflect.get(
    stationTerminalRuntimeState,
    'shouldRenderStationTerminal',
  ) as ((runtime: { sessionId?: string | null; stateRaw?: string | null } | null | undefined) => boolean)

  assert.equal(shouldRenderStationTerminal({ sessionId: 'session-live', stateRaw: 'running' }), true)
  assert.equal(shouldRenderStationTerminal({ sessionId: null, stateRaw: 'exited' }), true)
  assert.equal(shouldRenderStationTerminal({ sessionId: null, stateRaw: 'killed' }), true)
  assert.equal(shouldRenderStationTerminal({ sessionId: null, stateRaw: 'failed' }), true)
  assert.equal(shouldRenderStationTerminal({ sessionId: null, stateRaw: 'idle' }), false)
  assert.equal(shouldRenderStationTerminal(null), false)
})

test('does not auto-launch a closed rendered terminal from terminal-surface activation', () => {
  assert.equal(
    Reflect.has(stationTerminalRuntimeState, 'shouldAutoLaunchStationTerminalFromSurface'),
    true,
  )

  const shouldAutoLaunchStationTerminalFromSurface = Reflect.get(
    stationTerminalRuntimeState,
    'shouldAutoLaunchStationTerminalFromSurface',
  ) as ((runtime: { sessionId?: string | null; stateRaw?: string | null } | null | undefined) => boolean)

  assert.equal(shouldAutoLaunchStationTerminalFromSurface({ sessionId: 'session-live', stateRaw: 'running' }), false)
  assert.equal(shouldAutoLaunchStationTerminalFromSurface({ sessionId: null, stateRaw: 'exited' }), false)
  assert.equal(shouldAutoLaunchStationTerminalFromSurface({ sessionId: null, stateRaw: 'killed' }), false)
  assert.equal(shouldAutoLaunchStationTerminalFromSurface({ sessionId: null, stateRaw: 'failed' }), false)
  assert.equal(shouldAutoLaunchStationTerminalFromSurface({ sessionId: null, stateRaw: 'idle' }), true)
  assert.equal(shouldAutoLaunchStationTerminalFromSurface(null), true)
})

test('forwards rendered terminal input only while a live session is still bound', () => {
  assert.equal(
    Reflect.has(stationTerminalRuntimeState, 'shouldForwardStationTerminalInput'),
    true,
  )

  const shouldForwardStationTerminalInput = Reflect.get(
    stationTerminalRuntimeState,
    'shouldForwardStationTerminalInput',
  ) as ((sessionId: string | null | undefined) => boolean)

  assert.equal(shouldForwardStationTerminalInput('session-live'), true)
  assert.equal(shouldForwardStationTerminalInput(null), false)
  assert.equal(shouldForwardStationTerminalInput(undefined), false)
})

test('accepts local terminal interaction only while a live session is still bound', () => {
  assert.equal(
    Reflect.has(stationTerminalRuntimeState, 'shouldAcceptStationTerminalLocalInput'),
    true,
  )

  const shouldAcceptStationTerminalLocalInput = Reflect.get(
    stationTerminalRuntimeState,
    'shouldAcceptStationTerminalLocalInput',
  ) as ((sessionId: string | null | undefined) => boolean)

  assert.equal(shouldAcceptStationTerminalLocalInput('session-live'), true)
  assert.equal(shouldAcceptStationTerminalLocalInput(null), false)
  assert.equal(shouldAcceptStationTerminalLocalInput(undefined), false)
})

test('rejects detached session-bound messages when both sides lost the live session binding', () => {
  assert.equal(
    Reflect.has(stationTerminalRuntimeState, 'shouldMatchDetachedBridgeSession'),
    true,
  )

  const shouldMatchDetachedBridgeSession = Reflect.get(
    stationTerminalRuntimeState,
    'shouldMatchDetachedBridgeSession',
  ) as ((runtimeSessionId: string | null | undefined, messageSessionId: string | null | undefined) => boolean)

  assert.equal(shouldMatchDetachedBridgeSession('session-live', 'session-live'), true)
  assert.equal(shouldMatchDetachedBridgeSession('session-live', 'session-stale'), false)
  assert.equal(shouldMatchDetachedBridgeSession(null, 'session-live'), false)
  assert.equal(shouldMatchDetachedBridgeSession(null, null), false)
})

test('treats StationCard terminal renderability changes as memo-significant runtime changes', () => {
  assert.equal(
    Reflect.has(stationTerminalRuntimeState, 'didStationTerminalRenderabilityChange'),
    true,
  )

  const didStationTerminalRenderabilityChange = Reflect.get(
    stationTerminalRuntimeState,
    'didStationTerminalRenderabilityChange',
  ) as ((
    previousRuntime: { sessionId?: string | null; stateRaw?: string | null } | null | undefined,
    nextRuntime: { sessionId?: string | null; stateRaw?: string | null } | null | undefined,
  ) => boolean)

  assert.equal(
    didStationTerminalRenderabilityChange(
      { sessionId: null, stateRaw: 'idle' },
      { sessionId: null, stateRaw: 'exited' },
    ),
    true,
  )
  assert.equal(
    didStationTerminalRenderabilityChange(
      { sessionId: null, stateRaw: 'exited' },
      { sessionId: null, stateRaw: 'killed' },
    ),
    false,
  )
  assert.equal(
    didStationTerminalRenderabilityChange(
      { sessionId: 'session-live', stateRaw: 'running' },
      { sessionId: 'session-live', stateRaw: 'running' },
    ),
    false,
  )
})

test('applies recovered terminal output only while the session still owns the station', () => {
  assert.equal(
    shouldApplyRecoveredStationOutput(
      { sessionId: 'session-1' },
      'session-1',
    ),
    true,
  )
})

test('drops recovered terminal output after the station rebinding changes session ownership', () => {
  assert.equal(
    shouldApplyRecoveredStationOutput(
      { sessionId: 'session-2' },
      'session-1',
    ),
    false,
  )
  assert.equal(
    shouldApplyRecoveredStationOutput(
      { sessionId: null },
      'session-1',
    ),
    false,
  )
})

test('applies resolved station session result when workspace still matches and station remains unbound', () => {
  assert.equal(
    shouldApplyStationSessionResult('workspace-1', 'workspace-1', true, { sessionId: null }),
    true,
  )
})

test('drops resolved station session result when workspace changed', () => {
  assert.equal(
    shouldApplyStationSessionResult('workspace-1', 'workspace-2', true, { sessionId: null }),
    false,
  )
})

test('drops resolved station session result when the station was removed', () => {
  assert.equal(
    shouldApplyStationSessionResult('workspace-1', 'workspace-1', false, { sessionId: null }),
    false,
  )
})

test('drops resolved station session result when the station already rebound', () => {
  assert.equal(
    shouldApplyStationSessionResult('workspace-1', 'workspace-1', true, { sessionId: 'session-live' }),
    false,
  )
})

test('applies tool launch result while workspace still matches and station remains available', () => {
  assert.equal(
    shouldApplyStationToolLaunchResult('workspace-1', 'workspace-1', true, 2, 2),
    true,
  )
})

test('drops tool launch result when workspace changed or station disappeared', () => {
  assert.equal(
    shouldApplyStationToolLaunchResult('workspace-1', 'workspace-2', true, 1, 1),
    false,
  )
  assert.equal(
    shouldApplyStationToolLaunchResult('workspace-1', 'workspace-1', false, 1, 1),
    false,
  )
})

test('drops tool launch result when a newer launch request started for the same station', () => {
  assert.equal(
    shouldApplyStationToolLaunchResult('workspace-1', 'workspace-1', true, 1, 2),
    false,
  )
})

test('applies session launch failure output only while workspace still matches and station remains unbound', () => {
  assert.equal(
    shouldApplyStationSessionLaunchFailure('workspace-1', 'workspace-1', true, { sessionId: null }),
    true,
  )
})

test('drops session launch failure output when workspace changed before the async failure resolved', () => {
  assert.equal(
    shouldApplyStationSessionLaunchFailure('workspace-1', 'workspace-2', true, { sessionId: null }),
    false,
  )
})

test('resolves dropped station session cleanup for orphan async success results', () => {
  assert.deepEqual(resolveDroppedStationSessionCleanup('session-orphan'), {
    sessionId: 'session-orphan',
    signal: 'TERM',
  })
})

test('resolves dropped tool launch runtime cleanup by restoring the current live runtime when ownership still matches', () => {
  assert.deepEqual(
    resolveDroppedStationRuntimeCleanup('workspace-1', 'workspace-1', true, {
      sessionId: 'session-live',
      resolvedCwd: '/workspace/live',
    }),
    {
      action: 'register_current',
      sessionId: 'session-live',
      resolvedCwd: '/workspace/live',
    },
  )
})

test('resolves dropped tool launch runtime cleanup by unregistering stale runtime when ownership no longer matches', () => {
  assert.deepEqual(
    resolveDroppedStationRuntimeCleanup('workspace-1', 'workspace-2', true, {
      sessionId: 'session-live',
      resolvedCwd: '/workspace/live',
    }),
    { action: 'unregister' },
  )
  assert.deepEqual(
    resolveDroppedStationRuntimeCleanup('workspace-1', 'workspace-1', false, {
      sessionId: 'session-live',
      resolvedCwd: '/workspace/live',
    }),
    { action: 'unregister' },
  )
  assert.deepEqual(
    resolveDroppedStationRuntimeCleanup('workspace-1', 'workspace-1', true, {
      sessionId: null,
      resolvedCwd: '/workspace/live',
    }),
    { action: 'unregister' },
  )
})

test('drops stale runtime registration updates once station ownership already moved to another session', () => {
  assert.deepEqual(
    resolveStationRuntimeRegistrationCleanup('workspace-1', 'workspace-1', true, 'session-stale', {
      sessionId: 'session-live',
      resolvedCwd: '/workspace/live',
    }),
    {
      action: 'register_current',
      sessionId: 'session-live',
      resolvedCwd: '/workspace/live',
    },
  )
  assert.equal(
    resolveStationRuntimeRegistrationCleanup('workspace-1', 'workspace-1', true, 'session-live', {
      sessionId: 'session-live',
      resolvedCwd: '/workspace/live',
    }),
    null,
  )
})

test('allows only one in-flight session creation per station', async () => {
  const inFlight = new Map<string, Promise<string | null>>()
  const launches: string[] = []
  let resolveLaunch: ((value: string) => void) | undefined

  const ensure = ensureSingleFlightStationSession({
    getExistingSessionId: (stationId: string) => (stationId === 'station-a' ? null : 'session-existing'),
    getInFlight: (stationId: string) => inFlight.get(stationId),
    setInFlight: (stationId: string, promise: Promise<string | null>) => {
      inFlight.set(stationId, promise)
    },
    clearInFlight: (stationId: string, promise: Promise<string | null>) => {
      if (inFlight.get(stationId) === promise) {
        inFlight.delete(stationId)
      }
    },
    createSession: async (stationId: string) => {
      launches.push(stationId)
      return await new Promise<string>((resolve) => {
        resolveLaunch = resolve
      })
    },
  })

  const first = ensure('station-a')
  const second = ensure('station-a')

  assert.equal(launches.length, 1)
  assert.equal(first, second)

  const finishLaunch = resolveLaunch
  if (!finishLaunch) {
    throw new Error('expected launch promise to exist')
  }
  finishLaunch('session-1')

  assert.equal(await first, 'session-1')
  assert.equal(await second, 'session-1')
  assert.equal(inFlight.has('station-a'), false)
})

test('returns existing session immediately without creating a new one', async () => {
  let launches = 0
  const inFlight = new Map<string, Promise<string | null>>()

  const ensure = ensureSingleFlightStationSession({
    getExistingSessionId: () => 'session-existing',
    getInFlight: (stationId: string) => inFlight.get(stationId),
    setInFlight: (stationId: string, promise: Promise<string | null>) => {
      inFlight.set(stationId, promise)
    },
    clearInFlight: (stationId: string, promise: Promise<string | null>) => {
      if (inFlight.get(stationId) === promise) {
        inFlight.delete(stationId)
      }
    },
    createSession: async () => {
      launches += 1
      return 'session-new'
    },
  })

  assert.equal(await ensure('station-a'), 'session-existing')
  assert.equal(launches, 0)
})

test('clears failed in-flight session creation so the next attempt can retry', async () => {
  const inFlight = new Map<string, Promise<string | null>>()
  let launches = 0

  const ensure = ensureSingleFlightStationSession({
    getExistingSessionId: () => null,
    getInFlight: (stationId: string) => inFlight.get(stationId),
    setInFlight: (stationId: string, promise: Promise<string | null>) => {
      inFlight.set(stationId, promise)
    },
    clearInFlight: (stationId: string, promise: Promise<string | null>) => {
      if (inFlight.get(stationId) === promise) {
        inFlight.delete(stationId)
      }
    },
    createSession: async () => {
      launches += 1
      if (launches === 1) {
        throw new Error('launch failed')
      }
      return 'session-2'
    },
  })

  await assert.rejects(() => ensure('station-a'), /launch failed/)
  assert.equal(inFlight.has('station-a'), false)
  assert.equal(await ensure('station-a'), 'session-2')
  assert.equal(launches, 2)
})
