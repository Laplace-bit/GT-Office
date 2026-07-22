import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorkbenchCanvasPanel } from './WorkbenchCanvasPanel'
import {
  composeStationActionCommand,
  type StationActionDescriptor,
} from './station-action-model'
import { StationActionCommandSheet } from './StationActionCommandSheet'
import type { AgentStation } from './station-model'
import { normalizeStationToolKind } from './station-model'
import {
  buildStationLaunchCommand,
  STATION_INPUT_FLUSH_MS,
  STATION_INPUT_MAX_BUFFER_BYTES,
  shouldFlushStationInputImmediately,
} from '@shell/layout/ShellRoot.shared'
import type { WorkbenchContainer as WorkbenchContainerModel } from './workbench-container-model'
import {
  normalizeWorkbenchCustomLayout,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from './workbench-layout-model'
import type { WorkbenchStationRuntime } from './TerminalStationPane'
import {
  DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL,
  appendDetachedTerminalOutput,
  createEmptyWorkbenchStationRuntime,
  normalizeDetachedTerminalUnreadDelta,
  normalizeDetachedTerminalRuntime,
} from './detached-terminal-bridge'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  applyUiPreferences,
  loadUiPreferences,
  UI_PREFERENCES_UPDATED_EVENT,
  type UiPreferences,
} from '@shell/state/ui-preferences'
import {
  desktopApi,
  type DetachedTerminalBridgeMessage,
  type DetachedTerminalHydrateSnapshotMessage,
  type RenderedScreenSnapshot,
  type SurfaceBridgeEventPayload,
  type SurfaceDetachedStationPayload,
  type SurfaceWindowUpdatedPayload,
  type StationTerminalRestoreStatePayload,
  type ToolCommandSummary,
} from '@shell/integration/desktop-api'
import {
  appendStationTerminalDebugRecord,
  captureMatchingSessionOwnedRestoreState,
  captureReportedSessionOwnedRestoreState,
  captureSessionOwnedRestoreState,
  createBufferedStationInputController,
  didHydrateChangeSessionBinding,
  didSessionBindingChange,
  formatTerminalDebugBody,
  formatTerminalDebugPreview,
  hydrateSettlesSessionBinding,
  isStationTerminalDebugEnabled,
  patchTouchesSessionBinding,
  resolveNextPendingLaunchCommand,
  retainSessionOwnedRestoreState,
  selectStationTerminalReplaySource,
  normalizeStationTerminalResizeDimensions,
  shouldPreferSessionOwnedRestoreState,
  shouldReplayStationTerminalSinkBinding,
  setStationTerminalDebugHumanLog,
  shouldClearPendingFocusIntent,
  shouldClearPendingLaunchCommand,
  shouldFlushPendingLaunchCommand,
  type BufferedStationInputController,
  type SessionOwnedRestoreState,
  type StationTerminalSink,
  type StationTerminalSinkBindingMeta,
  type TerminalDebugRecordInput,
} from '@features/terminal'
import type { TerminalFileDropPayload } from '@shell/utils/terminal-file-drop'
import './DetachedWorkbenchWindow.scss'

export interface DetachedWorkbenchWindowPayload {
  windowLabel: string
  containerId: string
  workspaceId: string
  title: string
  activeStationId?: string | null
  fullscreenStationId?: string | null
  minimizedStationIds?: string[]
  layoutMode?: WorkbenchLayoutMode
  customLayout?: WorkbenchCustomLayout
  topmost: boolean
  stations: SurfaceDetachedStationPayload[]
}

function isDetachedTerminalSessionBindingInvalid(detail: string): boolean {
  return (
    detail.includes('TERMINAL_SESSION_NOT_FOUND') ||
    detail.includes('TERMINAL_SESSION_WORKSPACE_MISMATCH')
  )
}

function mapDetachedStation(payload: SurfaceDetachedStationPayload, index: number): AgentStation {
  return {
    id: payload.stationId,
    name: payload.name,
    agentWorkdirRel: payload.agentWorkdirRel,
    customWorkdir: true,
    scope: 'station',
    tool: payload.tool,
    toolKind: normalizeStationToolKind(payload.tool),
    promptFileName: null,
    promptFileRelativePath: null,
    terminalSessionId: payload.sessionId?.trim() ?? '',
    state: payload.sessionId ? 'running' : 'idle',
    workspaceId: payload.workspaceId,
    orderIndex: index + 1,
  }
}

function buildInitialRuntimeMap(
  stations: SurfaceDetachedStationPayload[],
): Record<string, WorkbenchStationRuntime> {
  return stations.reduce<Record<string, WorkbenchStationRuntime>>((acc, station) => {
    acc[station.stationId] = normalizeDetachedTerminalRuntime({
      sessionId: station.sessionId?.trim() ?? null,
      stateRaw: station.sessionId ? 'running' : 'idle',
    })
    return acc
  }, {})
}

function buildDetachedContainer(payload: DetachedWorkbenchWindowPayload): WorkbenchContainerModel {
  const stationIds = payload.stations.map((station) => station.stationId)
  const minimizedStationIdsInput = payload.minimizedStationIds
  const minimizedStationIds = Array.isArray(minimizedStationIdsInput)
    ? minimizedStationIdsInput.filter(
        (stationId, index) =>
          stationIds.includes(stationId) && minimizedStationIdsInput.indexOf(stationId) === index,
      )
    : []
  return {
    id: payload.containerId,
    stationIds,
    activeStationId: payload.activeStationId ?? payload.stations[0]?.stationId ?? null,
    fullscreenStationId:
      typeof payload.fullscreenStationId === 'string' &&
      payload.stations.some((station) => station.stationId === payload.fullscreenStationId)
        ? payload.fullscreenStationId
        : null,
    minimizedStationIds,
    layoutMode: payload.layoutMode ?? 'auto',
    customLayout: normalizeWorkbenchCustomLayout(payload.customLayout),
    mode: 'detached',
    resumeMode: 'docked',
    topmost: payload.topmost,
    frame: null,
    detachedWindowLabel: payload.windowLabel,
    lastActiveAtMs: Date.now(),
  }
}

type StationTerminalRestoreState = SessionOwnedRestoreState

function DetachedWorkbenchWindowView({ payload }: { payload: DetachedWorkbenchWindowPayload }) {
  const initialPreferences = useMemo(loadUiPreferences, [])
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(initialPreferences)
  const stations = useMemo(
    () => payload.stations.map((station, index) => mapDetachedStation(station, index)),
    [payload.stations],
  )
  const stationsRef = useRef(stations)
  const [container, setContainer] = useState<WorkbenchContainerModel>(() => buildDetachedContainer(payload))
  const [activeStationId, setActiveStationId] = useState(
    payload.activeStationId ?? payload.stations[0]?.stationId ?? '',
  )
  const activeStationIdRef = useRef(activeStationId)
  const [toolCommandsByStationId, setToolCommandsByStationId] = useState<Record<string, ToolCommandSummary[]>>({})
  const [pendingStationActionSheet, setPendingStationActionSheet] = useState<{
    station: AgentStation
    action: StationActionDescriptor
  } | null>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [stationRuntimes, setStationRuntimes] = useState<Record<string, WorkbenchStationRuntime>>(() => {
    return buildInitialRuntimeMap(payload.stations)
  })
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    void desktopApi
      .workspaceGetContext(payload.workspaceId)
      .then((context) => {
        setWorkspaceRoot(context.root)
      })
      .catch(() => {
        setWorkspaceRoot(null)
      })
  }, [payload.workspaceId])

  const stationRuntimesRef = useRef(stationRuntimes)
  const sinkByStationRef = useRef<Record<string, StationTerminalSink | null>>({})
  const stationTerminalRestoreStateRef = useRef<Record<string, StationTerminalRestoreState>>({})
  const outputCacheRef = useRef<Record<string, string>>({})
  const outputRevisionRef = useRef<Record<string, number>>({})
  const pendingReplayRef = useRef<
    Record<string, { version: number; ops: Array<{ kind: 'write'; chunk: string } | { kind: 'reset'; content: string }> }>
  >({})
  const projectionSeqRef = useRef<Record<string, number>>({})
  const hydrateInFlightRef = useRef(false)
  const ensureSessionInFlightRef = useRef<Record<string, boolean>>({})
  const pendingFocusStationRef = useRef<Record<string, boolean>>({})
  const pendingLaunchCommandRef = useRef<Record<string, string | null>>({})
  const inputControllerRef = useRef<BufferedStationInputController | null>(null)
  const terminalDebugRecordSeqRef = useRef(0)

  useEffect(() => {
    stationsRef.current = stations
    stations.forEach((station) => {
      if (typeof outputRevisionRef.current[station.id] !== 'number') {
        outputRevisionRef.current[station.id] = 0
      }
    })
  }, [stations])

  useEffect(() => {
    stationRuntimesRef.current = stationRuntimes
  }, [stationRuntimes])

  const toolCommandReloadKey = useMemo(
    () =>
      stations
        .map((station) => {
          const runtime = stationRuntimes[station.id]
          return [
            station.id,
            station.toolKind,
            runtime?.stateRaw ?? (runtime?.sessionId ? 'running' : 'idle'),
            runtime?.resolvedCwd ?? '',
          ].join(':')
        })
        .join('|'),
    [stationRuntimes, stations],
  )

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      setToolCommandsByStationId({})
      return
    }

    let cancelled = false
    const loadToolCommands = async () => {
      try {
        const entries = await Promise.all(
          stations.map(async (station) => {
            const runtime = stationRuntimesRef.current[station.id]
            const response = await desktopApi.toolListCommands({
              workspaceId: payload.workspaceId,
              toolKind: station.toolKind,
              station: {
                stationId: station.id,
                hasTerminalSession: Boolean(runtime?.sessionId),
                detachedReadonly: true,
                resolvedCwd: runtime?.resolvedCwd ?? null,
              },
            })
            return [station.id, response.commands] as const
          }),
        )
        if (!cancelled) {
          setToolCommandsByStationId(Object.fromEntries(entries))
        }
      } catch (error) {
        console.warn('[station-command-deck] detached catalog load failed', error)
        if (!cancelled) {
          setToolCommandsByStationId({})
        }
      }
    }

    void loadToolCommands()
    return () => {
      cancelled = true
    }
  }, [payload.workspaceId, stations, toolCommandReloadKey])

  useEffect(() => {
    activeStationIdRef.current = activeStationId
  }, [activeStationId])

  useEffect(() => {
    applyUiPreferences(uiPreferences)
  }, [uiPreferences])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'gtoffice.ui.preferences.v1') {
        return
      }
      setUiPreferences(loadUiPreferences())
    }
    const onPreferencesUpdated = () => {
      setUiPreferences(loadUiPreferences())
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(UI_PREFERENCES_UPDATED_EVENT, onPreferencesUpdated)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(UI_PREFERENCES_UPDATED_EVENT, onPreferencesUpdated)
    }
  }, [])

  const postBridgeMessage = useCallback(
    async (message: DetachedTerminalBridgeMessage) =>
      desktopApi.surfaceBridgePost(DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL, message),
    [],
  )

  const postContainerViewStatePatch = useCallback(
    (
      patch: Partial<{
        activeStationId: string | null
        fullscreenStationId: string | null
        minimizedStationIds: string[]
        layoutMode: WorkbenchLayoutMode
        customLayout: WorkbenchCustomLayout | null
      }>,
    ) =>
      postBridgeMessage({
        kind: 'detached_terminal_update_container_view_state',
        workspaceId: payload.workspaceId,
        containerId: payload.containerId,
        ...patch,
      }).catch(() => {}),
    [payload.containerId, payload.workspaceId, postBridgeMessage],
  )

  const setStationRuntime = useCallback((stationId: string, patch: Partial<WorkbenchStationRuntime>) => {
    setStationRuntimes((prev) => {
      const current = prev[stationId] ?? createEmptyWorkbenchStationRuntime()
      const nextRuntime = {
        ...current,
        ...patch,
      }
      if (didSessionBindingChange(current.sessionId, nextRuntime.sessionId)) {
        delete stationTerminalRestoreStateRef.current[stationId]
        inputControllerRef.current?.clear(stationId)
      }
      return {
        ...prev,
        [stationId]: nextRuntime,
      }
    })
  }, [])

  const incrementStationUnread = useCallback((stationId: string, delta: number) => {
    if (delta <= 0) {
      return
    }
    setStationRuntimes((prev) => {
      const runtime = prev[stationId] ?? createEmptyWorkbenchStationRuntime()
      const nextUnreadCount = Math.min(999, runtime.unreadCount + delta)
      if (nextUnreadCount === runtime.unreadCount) {
        return prev
      }
      return {
        ...prev,
        [stationId]: {
          ...runtime,
          unreadCount: nextUnreadCount,
        },
      }
    })
  }, [])

  const getStationSessionId = useCallback(
    (stationId: string) => stationRuntimesRef.current[stationId]?.sessionId ?? null,
    [],
  )

  const clearStationUnread = useCallback((stationId: string) => {
    setStationRuntimes((prev) => {
      const runtime = prev[stationId]
      if (!runtime || runtime.unreadCount === 0) {
        return prev
      }
      return {
        ...prev,
        [stationId]: {
          ...runtime,
          unreadCount: 0,
        },
      }
    })
  }, [])

  const pushStationTerminalDebugRecord = useCallback(
    (stationId: string, input: TerminalDebugRecordInput) => {
      if (!isStationTerminalDebugEnabled(stationId)) {
        return
      }
      terminalDebugRecordSeqRef.current += 1
      appendStationTerminalDebugRecord(
        stationId,
        {
          id: `${stationId}:detached:${terminalDebugRecordSeqRef.current.toString(16)}`,
          atMs: input.atMs ?? Date.now(),
          stationId,
          sessionId: input.sessionId ?? null,
          screenRevision: input.screenRevision ?? null,
          lane: input.lane,
          kind: input.kind,
          source: input.source ?? null,
          summary: input.summary,
          body: formatTerminalDebugBody(input.body),
          humanText: input.humanText ?? null,
        },
        0,
      )
    },
    [],
  )

  const appendStationTerminalOutput = useCallback(
    (stationId: string, chunk: string) => {
      if (!chunk) {
        return
      }
      outputCacheRef.current[stationId] = appendDetachedTerminalOutput(outputCacheRef.current[stationId], chunk)
      outputRevisionRef.current[stationId] = (outputRevisionRef.current[stationId] ?? 0) + 1
      if (isStationTerminalDebugEnabled(stationId)) {
        const sessionId = stationRuntimesRef.current[stationId]?.sessionId ?? null
        pushStationTerminalDebugRecord(stationId, {
          sessionId,
          lane: 'xterm',
          kind: 'write',
          source: 'detached_terminal_output_append',
          summary: formatTerminalDebugPreview(chunk, 84),
          body: chunk,
        })
      }
      const pendingReplay = pendingReplayRef.current[stationId]
      if (pendingReplay) {
        pendingReplay.ops.push({ kind: 'write', chunk })
      } else {
        void sinkByStationRef.current[stationId]?.write(chunk)
      }
    },
    [pushStationTerminalDebugRecord],
  )

  const resetStationTerminalOutput = useCallback(
    (stationId: string, content = '') => {
      outputCacheRef.current[stationId] = content
      outputRevisionRef.current[stationId] = (outputRevisionRef.current[stationId] ?? 0) + 1
      if (isStationTerminalDebugEnabled(stationId)) {
        const sessionId = stationRuntimesRef.current[stationId]?.sessionId ?? null
        pushStationTerminalDebugRecord(stationId, {
          sessionId,
          lane: 'xterm',
          kind: 'reset',
          source: 'detached_terminal_output_reset',
          summary: formatTerminalDebugPreview(content, 84),
          body: content,
        })
      }
      const pendingReplay = pendingReplayRef.current[stationId]
      if (pendingReplay) {
        pendingReplay.ops.push({ kind: 'reset', content })
      } else {
        void sinkByStationRef.current[stationId]?.reset(content)
      }
    },
    [pushStationTerminalDebugRecord],
  )

  const requestHydrate = useCallback(() => {
    if (hydrateInFlightRef.current) {
      return
    }
    hydrateInFlightRef.current = true
    void postBridgeMessage({
      kind: 'detached_terminal_hydrate_request',
      workspaceId: payload.workspaceId,
      containerId: payload.containerId,
    }).catch(() => {
      hydrateInFlightRef.current = false
    })
  }, [payload.containerId, payload.workspaceId, postBridgeMessage])

  const flushPendingStationFocus = useCallback((stationId: string) => {
    if (!pendingFocusStationRef.current[stationId]) {
      return
    }
    const sink = sinkByStationRef.current[stationId]
    if (!sink) {
      return
    }
    sink.focus()
    delete pendingFocusStationRef.current[stationId]
  }, [])

  const sendInput = useMemo(
    () => (stationId: string, input: string) => {
      if (!inputControllerRef.current) {
        inputControllerRef.current = createBufferedStationInputController({
          flushDelayMs: STATION_INPUT_FLUSH_MS,
          maxBufferBytes: STATION_INPUT_MAX_BUFFER_BYTES,
          shouldFlushImmediately: shouldFlushStationInputImmediately,
          scheduleTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
          clearTimer: (timerId) => window.clearTimeout(timerId),
          sendInput: async (targetStationId, queuedInput) => {
            try {
              await postBridgeMessage({
                kind: 'detached_terminal_write_input',
                workspaceId: payload.workspaceId,
                containerId: payload.containerId,
                stationId: targetStationId,
                sessionId: getStationSessionId(targetStationId),
                input: queuedInput,
              })
            } catch {
              requestHydrate()
            }
          },
        })
      }
      inputControllerRef.current.enqueue(stationId, input)
    },
    [getStationSessionId, payload.containerId, payload.workspaceId, postBridgeMessage, requestHydrate],
  )

  useEffect(() => {
    return () => {
      inputControllerRef.current?.dispose()
      inputControllerRef.current = null
    }
  }, [])


  const flushPendingLaunchCommand = useCallback(
    (
      stationId: string,
      runtime: Pick<WorkbenchStationRuntime, 'sessionId'> | null | undefined = stationRuntimesRef.current[stationId],
    ) => {
      const command = pendingLaunchCommandRef.current[stationId]
      if (!shouldFlushPendingLaunchCommand(command, runtime) || !command) {
        return
      }
      delete pendingLaunchCommandRef.current[stationId]
      sendInput(stationId, command)
    },
    [sendInput],
  )

  const sendInputWithSubmit = useCallback(
    async (stationId: string, input: string) => {
      await postBridgeMessage({
        kind: 'detached_terminal_write_with_submit',
        workspaceId: payload.workspaceId,
        containerId: payload.containerId,
        stationId,
        input,
      })
    },
    [payload.containerId, payload.workspaceId, postBridgeMessage],
  )

  const forceCloseTerminal = useCallback(
    async (stationId: string) => {
      const sessionId = stationRuntimesRef.current[stationId]?.sessionId ?? null
      if (!sessionId) {
        return
      }
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      const confirmed = window.confirm(
        t(uiPreferences.locale as Locale, 'terminal.forceClose.confirmMessage', {
          name: station?.name ?? stationId,
        }),
      )
      if (!confirmed) {
        return
      }

      try {
        const response = await desktopApi.terminalKill(payload.workspaceId, sessionId, 'KILL')
        if (response.workspaceId !== payload.workspaceId || response.sessionId !== sessionId) {
          return
        }
        if (!response.killed) {
          appendStationTerminalOutput(stationId, '\r\n[terminal:kill-failed] TERMINAL_KILL_REJECTED\r\n')
          return
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (!isDetachedTerminalSessionBindingInvalid(detail)) {
          appendStationTerminalOutput(stationId, `\r\n[terminal:kill-failed] ${detail}\r\n`)
          return
        }
      }

      delete stationTerminalRestoreStateRef.current[stationId]
      delete pendingLaunchCommandRef.current[stationId]
      inputControllerRef.current?.clear(stationId)
      setStationRuntimes((prev) => {
        const current = prev[stationId] ?? createEmptyWorkbenchStationRuntime()
        const next = {
          ...prev,
          [stationId]: {
            ...current,
            sessionId: null,
            stateRaw: 'killed',
            unreadCount: 0,
            shell: null,
            cwdMode: 'workspace_root' as const,
            resolvedCwd: null,
          },
        }
        stationRuntimesRef.current = next
        return next
      })
      resetStationTerminalOutput(stationId, '')
      void desktopApi.agentRuntimeUnregister(payload.workspaceId, stationId).catch(() => {
        // The main workspace will reconcile runtime state from terminal events.
      })
    },
    [appendStationTerminalOutput, payload.workspaceId, resetStationTerminalOutput, uiPreferences.locale],
  )

  const ensureStationTerminalSession = useCallback(
    async (stationId: string): Promise<string | null> => {
      const existing = stationRuntimesRef.current[stationId]?.sessionId ?? null
      if (existing) {
        return existing
      }
      if (ensureSessionInFlightRef.current[stationId]) {
        return null
      }
      ensureSessionInFlightRef.current[stationId] = true
      try {
        await postBridgeMessage({
          kind: 'detached_terminal_ensure_session',
          workspaceId: payload.workspaceId,
          containerId: payload.containerId,
          stationId,
        })
      } catch {
        delete ensureSessionInFlightRef.current[stationId]
      }
      return null
    },
    [payload.containerId, payload.workspaceId, postBridgeMessage],
  )

  const applyHydrateSnapshot = useCallback(
    (message: DetachedTerminalHydrateSnapshotMessage) => {
      hydrateInFlightRef.current = false
      const nextRuntimes = stationsRef.current.reduce<Record<string, WorkbenchStationRuntime>>((acc, station) => {
        acc[station.id] = normalizeDetachedTerminalRuntime(message.runtimes[station.id])
        return acc
      }, {})
      const nextOutputs = stationsRef.current.reduce<Record<string, string>>((acc, station) => {
        acc[station.id] = message.outputs[station.id] ?? outputCacheRef.current[station.id] ?? ''
        return acc
      }, {})
      stationsRef.current.forEach((station) => {
        const previousProjectionSeq = projectionSeqRef.current[station.id] ?? 0
        const nextProjectionSeq = message.projectionSeqByStation[station.id] ?? 0
        const previousRuntime = stationRuntimesRef.current[station.id]
        const nextRuntime = nextRuntimes[station.id]
        projectionSeqRef.current[station.id] = nextProjectionSeq
        if (didHydrateChangeSessionBinding(previousRuntime, nextRuntime)) {
          inputControllerRef.current?.clear(station.id)
        }
        const launchSettled = hydrateSettlesSessionBinding(
          previousProjectionSeq,
          nextProjectionSeq,
          nextRuntime,
        )
        if (launchSettled) {
          delete ensureSessionInFlightRef.current[station.id]
        }
        if (shouldClearPendingLaunchCommand(pendingLaunchCommandRef.current[station.id], launchSettled, nextRuntime)) {
          delete pendingLaunchCommandRef.current[station.id]
        }
        if (shouldClearPendingFocusIntent(pendingFocusStationRef.current[station.id], launchSettled, nextRuntime)) {
          delete pendingFocusStationRef.current[station.id]
        }
      })
      outputCacheRef.current = nextOutputs
      setStationRuntimes(nextRuntimes)
      const nextActiveStationId =
        (message.activeStationId && nextRuntimes[message.activeStationId] ? message.activeStationId : null) ??
        activeStationIdRef.current ??
        stationsRef.current[0]?.id ??
        ''
      setActiveStationId(nextActiveStationId)
      setContainer((prev) => ({
        ...prev,
        activeStationId: nextActiveStationId || prev.activeStationId,
      }))
      stationTerminalRestoreStateRef.current = stationsRef.current.reduce<Record<string, StationTerminalRestoreState>>(
        (acc, station) => {
          const restoreState = message.restoreStates?.[station.id]
          const capturedRestoreState = restoreState
            ? captureSessionOwnedRestoreState(
                nextRuntimes[station.id],
                restoreState,
                outputRevisionRef.current[station.id] ?? 0,
              )
            : null
          if (capturedRestoreState) {
            acc[station.id] = capturedRestoreState
          }
          return acc
        },
        {},
      )
      Object.entries(sinkByStationRef.current).forEach(([stationId, sink]) => {
        if (!sink) {
          return
        }
        const restoreState = retainSessionOwnedRestoreState(
          stationTerminalRestoreStateRef.current[stationId],
          nextRuntimes[stationId]?.sessionId ?? null,
        )
        const outputRevision = outputRevisionRef.current[stationId] ?? 0
        const shouldUseRestore = shouldPreferSessionOwnedRestoreState(
          restoreState,
          nextRuntimes[stationId]?.sessionId ?? null,
          outputRevision,
        )
        const replaySource = selectStationTerminalReplaySource({
          cachedContent: nextOutputs[stationId] ?? '',
          restoreState: shouldUseRestore ? restoreState.state : null,
        })
        if (replaySource.kind === 'restore') {
          void sink.restore(
            replaySource.state.content,
            replaySource.state.cols,
            replaySource.state.rows,
            replaySource.state.viewportY,
          )
        } else {
          delete stationTerminalRestoreStateRef.current[stationId]
          void sink.reset(replaySource.content)
        }
        flushPendingStationFocus(stationId)
      })
      stationsRef.current.forEach((station) => {
        flushPendingLaunchCommand(station.id, nextRuntimes[station.id])
        flushPendingStationFocus(station.id)
      })
    },
    [flushPendingLaunchCommand, flushPendingStationFocus],
  )

  const applyProjectionSeq = useCallback(
    (stationId: string, projectionSeq: number): boolean => {
      const currentSeq = projectionSeqRef.current[stationId] ?? 0
      if (projectionSeq <= currentSeq) {
        return false
      }
      if (currentSeq !== 0 && projectionSeq !== currentSeq + 1) {
        requestHydrate()
        return false
      }
      if (currentSeq === 0 && projectionSeq > 1) {
        requestHydrate()
        return false
      }
      projectionSeqRef.current[stationId] = projectionSeq
      return true
    },
    [requestHydrate],
  )

  const selectStation = useCallback(
    (stationId: string) => {
      setActiveStationId(stationId)
      setContainer((prev) => ({
        ...prev,
        activeStationId: stationId,
      }))
      clearStationUnread(stationId)
      void postBridgeMessage({
        kind: 'detached_terminal_activate_station',
        workspaceId: payload.workspaceId,
        containerId: payload.containerId,
        stationId,
      }).catch(() => {})
    },
    [clearStationUnread, payload.containerId, payload.workspaceId, postBridgeMessage],
  )

  const handleSurfaceBridge = useCallback(
    (event: SurfaceBridgeEventPayload<DetachedTerminalBridgeMessage>) => {
      if (event.targetWindowLabel !== payload.windowLabel) {
        return
      }
      if (event.sourceWindowLabel !== DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL) {
        return
      }
      const message = event.payload
      if (message.workspaceId !== payload.workspaceId || message.containerId !== payload.containerId) {
        return
      }
      switch (message.kind) {
        case 'detached_terminal_hydrate_snapshot':
          applyHydrateSnapshot(message)
          return
        case 'detached_terminal_output_append':
          if (!applyProjectionSeq(message.stationId, message.projectionSeq)) {
            return
          }
          appendStationTerminalOutput(message.stationId, message.chunk)
          if (message.stationId !== activeStationIdRef.current) {
            incrementStationUnread(message.stationId, normalizeDetachedTerminalUnreadDelta(message.unreadDelta))
          }
          return
        case 'detached_terminal_output_reset':
          if (!applyProjectionSeq(message.stationId, message.projectionSeq)) {
            return
          }
          resetStationTerminalOutput(message.stationId, message.content)
          return
        case 'detached_terminal_runtime_updated':
          if (!applyProjectionSeq(message.stationId, message.projectionSeq)) {
            return
          }
          const nextRuntime = {
            ...(stationRuntimesRef.current[message.stationId] ?? createEmptyWorkbenchStationRuntime()),
            ...message.runtimePatch,
          }
          if (patchTouchesSessionBinding(message.runtimePatch)) {
            delete ensureSessionInFlightRef.current[message.stationId]
          }
          if (shouldClearPendingLaunchCommand(pendingLaunchCommandRef.current[message.stationId], patchTouchesSessionBinding(message.runtimePatch), nextRuntime)) {
            delete pendingLaunchCommandRef.current[message.stationId]
          }
          if (shouldClearPendingFocusIntent(pendingFocusStationRef.current[message.stationId], patchTouchesSessionBinding(message.runtimePatch), nextRuntime)) {
            delete pendingFocusStationRef.current[message.stationId]
          }
          setStationRuntime(message.stationId, message.runtimePatch)
          queueMicrotask(() => {
            flushPendingLaunchCommand(message.stationId, nextRuntime)
            flushPendingStationFocus(message.stationId)
          })
          return
        default:
          return
      }
    },
    [
      appendStationTerminalOutput,
      applyHydrateSnapshot,
      applyProjectionSeq,
      flushPendingLaunchCommand,
      flushPendingStationFocus,
      incrementStationUnread,
      payload.containerId,
      payload.workspaceId,
      payload.windowLabel,
      resetStationTerminalOutput,
      setStationRuntime,
    ],
  )

  useEffect(() => {
    if (!activeStationId) {
      return
    }
    clearStationUnread(activeStationId)
  }, [activeStationId, clearStationUnread])

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    void desktopApi
      .subscribeSurfaceEvents({
        onWindowUpdated: (eventPayload: SurfaceWindowUpdatedPayload) => {
          if (eventPayload.windowLabel !== payload.windowLabel) {
            return
          }
          setContainer((prev) => ({
            ...prev,
            topmost: eventPayload.topmost,
          }))
        },
        onBridge: (eventPayload) => {
          if (disposed) {
            return
          }
          handleSurfaceBridge(eventPayload)
        },
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanup = unlisten
        requestHydrate()
      })
    return () => {
      disposed = true
      cleanup()
    }
  }, [handleSurfaceBridge, payload.windowLabel, requestHydrate])

  const bindSink = useCallback(
    (
      stationId: string,
      sink: StationTerminalSink | null,
      meta?: StationTerminalSinkBindingMeta,
    ) => {
      if (!sink) {
        if (meta?.sourceSink && sinkByStationRef.current[stationId] !== meta.sourceSink) {
          return
        }
        delete pendingReplayRef.current[stationId]
        const capturedRestoreState = meta?.restoreState
          ? captureMatchingSessionOwnedRestoreState(
              stationRuntimesRef.current[stationId],
              meta.sourceSessionId,
              {
                content: meta.restoreState,
                cols: meta.restoreCols ?? 0,
                rows: meta.restoreRows ?? 0,
                viewportY: meta.restoreViewportY ?? null,
              },
              outputRevisionRef.current[stationId] ?? 0,
            )
          : null
        if (capturedRestoreState) {
          stationTerminalRestoreStateRef.current[stationId] = capturedRestoreState
        } else {
          delete stationTerminalRestoreStateRef.current[stationId]
        }
        delete sinkByStationRef.current[stationId]
        return
      }

      const previousSink = sinkByStationRef.current[stationId]
      if (
        !shouldReplayStationTerminalSinkBinding({
          previousSink,
          nextSink: sink,
          hasPendingReplay: Boolean(pendingReplayRef.current[stationId]),
        })
      ) {
        return
      }

      sinkByStationRef.current[stationId] = sink

      const outputRevision = outputRevisionRef.current[stationId] ?? 0
      const restoreState = retainSessionOwnedRestoreState(
        stationTerminalRestoreStateRef.current[stationId],
        stationRuntimesRef.current[stationId]?.sessionId ?? null,
      )
      const replayVersion = (pendingReplayRef.current[stationId]?.version ?? 0) + 1
      pendingReplayRef.current[stationId] = {
        version: replayVersion,
        ops: [],
      }
      const shouldUseRestore = shouldPreferSessionOwnedRestoreState(
        restoreState,
        stationRuntimesRef.current[stationId]?.sessionId ?? null,
        outputRevision,
      )
      const replaySource = selectStationTerminalReplaySource({
        cachedContent: outputCacheRef.current[stationId] ?? '',
        restoreState: shouldUseRestore ? restoreState.state : null,
      })
      const replay =
        replaySource.kind === 'restore'
          ? sink.restore(
              replaySource.state.content,
              replaySource.state.cols,
              replaySource.state.rows,
              replaySource.state.viewportY,
            )
          : sink.reset(replaySource.content)
      if (replaySource.kind !== 'restore') {
        delete stationTerminalRestoreStateRef.current[stationId]
      }
      void replay.finally(() => {
        const pendingReplay = pendingReplayRef.current[stationId]
        if (
          !pendingReplay ||
          pendingReplay.version !== replayVersion ||
          sinkByStationRef.current[stationId] !== sink
        ) {
          return
        }
        const pendingOps = pendingReplay.ops.slice()
        delete pendingReplayRef.current[stationId]
        void pendingOps.reduce<Promise<void>>((chain, op) => {
          return chain.then(() => {
            if (sinkByStationRef.current[stationId] !== sink) {
              return
            }
            if (op.kind === 'reset') {
              return sink.reset(op.content)
            }
            return sink.write(op.chunk)
          })
        }, Promise.resolve())
      })
      if (
        replaySource.kind !== 'restore' &&
        !Object.prototype.hasOwnProperty.call(outputCacheRef.current, stationId) &&
        stationRuntimesRef.current[stationId]?.sessionId
      ) {
        requestHydrate()
      }
      flushPendingStationFocus(stationId)
    },
    [flushPendingStationFocus, requestHydrate],
  )

  const launchStationTerminal = useCallback(
    async (stationId: string) => {
      selectStation(stationId)
      pendingFocusStationRef.current[stationId] = true
      pendingLaunchCommandRef.current[stationId] = resolveNextPendingLaunchCommand('terminal', null)
      const sessionId = await ensureStationTerminalSession(stationId)
      if (sessionId) {
        flushPendingStationFocus(stationId)
      }
    },
    [ensureStationTerminalSession, flushPendingStationFocus, selectStation],
  )

  const launchStationCliAgent = useCallback(
    async (stationId: string) => {
      selectStation(stationId)
      pendingFocusStationRef.current[stationId] = true
      delete pendingLaunchCommandRef.current[stationId]
      try {
        await postBridgeMessage({
          kind: 'detached_terminal_launch_cli_agent',
          workspaceId: payload.workspaceId,
          containerId: payload.containerId,
          stationId,
        })
      } catch {
        delete pendingFocusStationRef.current[stationId]
        requestHydrate()
      }
    },
    [payload.containerId, payload.workspaceId, postBridgeMessage, requestHydrate, selectStation],
  )

  const handleResize = useCallback(
    (stationId: string, cols: number, rows: number) => {
      const resizeDimensions = normalizeStationTerminalResizeDimensions(cols, rows)
      if (!resizeDimensions) {
        return
      }
      void postBridgeMessage({
        kind: 'detached_terminal_resize',
        workspaceId: payload.workspaceId,
        containerId: payload.containerId,
        stationId,
        sessionId: getStationSessionId(stationId),
        cols: resizeDimensions.cols,
        rows: resizeDimensions.rows,
      }).catch(() => {})
    },
    [getStationSessionId, payload.containerId, payload.workspaceId, postBridgeMessage],
  )

  const handleRestoreStateCaptured = useCallback(
    (
      stationId: string,
      state: StationTerminalRestoreStatePayload,
      sourceSessionId: string | null,
    ) => {
      const capturedRestoreState = captureReportedSessionOwnedRestoreState(
        stationRuntimesRef.current[stationId],
        sourceSessionId,
        state,
        outputRevisionRef.current[stationId] ?? 0,
      )
      if (capturedRestoreState) {
        stationTerminalRestoreStateRef.current[stationId] = capturedRestoreState
      } else {
        delete stationTerminalRestoreStateRef.current[stationId]
      }
      void postBridgeMessage({
        kind: 'detached_terminal_restore_state',
        workspaceId: payload.workspaceId,
        containerId: payload.containerId,
        stationId,
        sessionId: sourceSessionId,
        state,
      }).catch(() => {})
    },
    [payload.containerId, payload.workspaceId, postBridgeMessage],
  )

  const handleRenderedScreenSnapshot = useCallback((stationId: string, snapshot: RenderedScreenSnapshot) => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    const sessionId = stationRuntimesRef.current[stationId]?.sessionId ?? null
    if (!sessionId || snapshot.sessionId !== sessionId) {
      return
    }
    if (isStationTerminalDebugEnabled(stationId)) {
      const screenBody = snapshot.rows.map((row) => row.text).join('\n')
      pushStationTerminalDebugRecord(stationId, {
        atMs: snapshot.capturedAtMs,
        sessionId,
        screenRevision: snapshot.screenRevision,
        lane: 'xterm',
        kind: 'screen',
        source: 'rendered_screen',
        summary: formatTerminalDebugPreview(
          snapshot.rows
            .map((row) => row.trimmedText)
            .filter((row) => row.length > 0)
            .join(' | '),
          84,
        ),
        body: screenBody,
      })
    }
    const station = stationsRef.current.find((item) => item.id === stationId)
    const toolKind = normalizeStationToolKind(station?.tool)
    void desktopApi
      .terminalReportRenderedScreen(payload.workspaceId, snapshot, toolKind)
      .then((response) => {
        if (
          response.workspaceId !== payload.workspaceId ||
          response.sessionId !== snapshot.sessionId ||
          (stationRuntimesRef.current[stationId]?.sessionId ?? null) !== snapshot.sessionId
        ) {
          return
        }
        setStationTerminalDebugHumanLog(stationId, {
          entries: response.humanEntries,
          eventCount: response.humanEventCount,
        })
      })
      .catch(() => {
        // Snapshot reporting is best-effort and must not affect terminal interaction.
      })
  }, [payload.workspaceId, pushStationTerminalDebugRecord])

  const handleSubmitStationActionSheet = useCallback((values: Record<string, string | boolean>) => {
    const pending = pendingStationActionSheet
    if (!pending || pending.action.execution.type !== 'open_command_sheet') {
      setPendingStationActionSheet(null)
      return
    }

    const command = composeStationActionCommand(pending.action, values)
    setPendingStationActionSheet(null)
    if (!command) {
      return
    }

    if (pending.action.execution.submit) {
      void sendInputWithSubmit(pending.station.id, command).catch(() => {
        requestHydrate()
      })
    } else {
      sendInput(pending.station.id, command)
    }
  }, [pendingStationActionSheet, requestHydrate, sendInput, sendInputWithSubmit])

  const handleDropFilePath = useCallback(
    async (stationId: string, payload: TerminalFileDropPayload) => {
      await ensureStationTerminalSession(stationId)
      sendInput(stationId, payload.shellText)
      pendingFocusStationRef.current[stationId] = true
      flushPendingStationFocus(stationId)
    },
    [ensureStationTerminalSession, flushPendingStationFocus, sendInput],
  )

  return (
    <div className="detached-workbench-window">
      <div className="detached-workbench-window-frame">
        <WorkbenchCanvasPanel
          locale={uiPreferences.locale as Locale}
          appearanceVersion={`${uiPreferences.themeMode}:${uiPreferences.monoFont}:${uiPreferences.uiFontSize}`}
          workspaceId={payload.workspaceId}
          workspaceCwd={workspaceRoot}
          container={container}
          containerIndex={0}
          stations={stations}
          activeGlobalStationId={activeStationId}
          terminalByStation={stationRuntimes}
          taskSignalByStationId={{}}
          detachedReadonly
          onSelectStation={(_, stationId) => {
            selectStation(stationId)
          }}
          onLaunchStationTerminal={(stationId) => {
            void launchStationTerminal(stationId)
          }}
          onLaunchCliAgent={(stationId) => {
            void launchStationCliAgent(stationId)
          }}
          onForceCloseTerminal={(stationId) => {
            void forceCloseTerminal(stationId)
          }}
          onSendInputData={sendInput}
          onResizeTerminal={handleResize}
          onBindTerminalSink={bindSink}
          onRenderedScreenSnapshot={handleRenderedScreenSnapshot}
          onDropFilePath={handleDropFilePath}
          onRunStationAction={(station: AgentStation, action: StationActionDescriptor) => {
            switch (action.execution.type) {
              case 'insert_text':
                sendInput(station.id, action.execution.text)
                return
              case 'insert_and_submit':
                void sendInputWithSubmit(station.id, action.execution.text).catch(() => {
                  requestHydrate()
                })
                return
              case 'submit_terminal':
                void sendInputWithSubmit(station.id, '').catch(() => {
                  requestHydrate()
                })
                return
              case 'launch_cli': {
                const command = buildStationLaunchCommand(station)
                if (command) {
                  void launchStationCliAgent(station.id)
                }
                return
              }
              case 'open_command_sheet':
                setPendingStationActionSheet({ station, action })
                return
              case 'launch_tool_profile':
              case 'open_settings_modal':
              case 'open_channel_studio':
                return
              default:
                return
            }
          }}
          toolCommandsByStationId={toolCommandsByStationId}
          onRestoreStateCaptured={handleRestoreStateCaptured}
          onRemoveStation={() => {}}
          onLayoutModeChange={(containerId, mode) => {
            setContainer((prev) => (prev.id === containerId ? { ...prev, layoutMode: mode } : prev))
            postContainerViewStatePatch({ layoutMode: mode })
          }}
          onCustomLayoutChange={(containerId, customLayout) => {
            setContainer((prev) =>
              prev.id === containerId ? { ...prev, layoutMode: 'custom', customLayout } : prev,
            )
            postContainerViewStatePatch({
              layoutMode: 'custom',
              customLayout,
            })
          }}
          onFullscreenStationChange={(containerId, fullscreenStationId) => {
            setContainer((prev) =>
              prev.id === containerId ? { ...prev, fullscreenStationId } : prev,
            )
            postContainerViewStatePatch({ fullscreenStationId })
          }}
          onMinimizedStationIdsChange={(containerId, minimizedStationIds) => {
            setContainer((prev) =>
              prev.id === containerId ? { ...prev, minimizedStationIds } : prev,
            )
            postContainerViewStatePatch({ minimizedStationIds })
          }}
          onFloatContainer={() => {}}
          onDockContainer={() => {}}
          onDetachContainer={() => {}}
          onToggleContainerTopmost={() => {
            void desktopApi.surfaceSetWindowTopmost(null, !container.topmost).then((response) => {
              setContainer((prev) => ({
                ...prev,
                topmost: response.topmost,
              }))
            })
          }}
          onBeginNativeWindowDrag={(event) => {
            if (event.button !== 0) {
              return
            }
            event.preventDefault()
            void desktopApi.surfaceStartWindowDragging(null).catch(() => {})
          }}
          onReturnToWorkspace={() => {
            void desktopApi.surfaceCloseWindow(null).catch(() => {})
          }}
        />
      </div>
      <StationActionCommandSheet
        locale={uiPreferences.locale as Locale}
        station={pendingStationActionSheet?.station ?? null}
        action={pendingStationActionSheet?.action ?? null}
        open={Boolean(pendingStationActionSheet)}
        onClose={() => {
          setPendingStationActionSheet(null)
        }}
        onSubmit={handleSubmitStationActionSheet}
      />
    </div>
  )
}

export const DetachedWorkbenchWindow = memo(DetachedWorkbenchWindowView)
