import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorkbenchCanvasPanel } from './WorkbenchCanvasPanel'
import {
  composeStationActionCommand,
  type StationActionDescriptor,
} from './station-action-model'
import { StationActionCommandSheet } from './StationActionCommandSheet'
import type { AgentStation, StationRole } from './station-model'
import { normalizeStationToolKind } from './station-model'
import { buildStationLaunchCommand } from '@shell/layout/ShellRoot.shared'
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
  normalizeDetachedTerminalRuntime,
} from './detached-terminal-bridge'
import type { Locale } from '@shell/i18n/ui-locale'
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
  type SurfaceBridgeEventPayload,
  type SurfaceDetachedStationPayload,
  type SurfaceWindowUpdatedPayload,
  type StationTerminalRestoreStatePayload,
  type ToolCommandSummary,
} from '@shell/integration/desktop-api'
import type {
  StationTerminalSink,
  StationTerminalSinkBindingMeta,
} from '@features/terminal'
import './DetachedWorkbenchWindow.scss'

const STATION_INPUT_FLUSH_MS = 12
const STATION_INPUT_MAX_BUFFER_BYTES = 65536
const STATION_INPUT_IMMEDIATE_CHUNK_BYTES = 24

function shouldFlushStationInputImmediately(input: string): boolean {
  if (!input) {
    return false
  }
  if (input.includes('\n') || input.includes('\r')) {
    return true
  }
  if (input.length >= STATION_INPUT_IMMEDIATE_CHUNK_BYTES) {
    return true
  }
  return /[\x00-\x1f\x7f]/.test(input) || input.includes('\x1b')
}

export interface DetachedWorkbenchWindowPayload {
  windowLabel: string
  containerId: string
  workspaceId: string
  title: string
  activeStationId?: string | null
  layoutMode?: WorkbenchLayoutMode
  customLayout?: WorkbenchCustomLayout
  topmost: boolean
  stations: SurfaceDetachedStationPayload[]
}

function toStationRole(value: string): StationRole {
  if (value === 'manager' || value === 'product' || value === 'build' || value === 'quality_release') {
    return value
  }
  return 'build'
}

function mapDetachedStation(payload: SurfaceDetachedStationPayload): AgentStation {
  return {
    id: payload.stationId,
    name: payload.name,
    role: toStationRole(payload.role),
    roleWorkdirRel: payload.roleWorkdirRel?.trim() || '.gtoffice/org',
    agentWorkdirRel: payload.agentWorkdirRel,
    customWorkdir: true,
    tool: payload.tool,
    toolKind: normalizeStationToolKind(payload.tool),
    terminalSessionId: payload.sessionId?.trim() ?? '',
    state: payload.sessionId ? 'running' : 'idle',
    workspaceId: payload.workspaceId,
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

const DETACHED_LOG_PREFIX = '[detached-terminal]'

function buildDetachedContainer(payload: DetachedWorkbenchWindowPayload): WorkbenchContainerModel {
  return {
    id: payload.containerId,
    stationIds: payload.stations.map((station) => station.stationId),
    activeStationId: payload.activeStationId ?? payload.stations[0]?.stationId ?? null,
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

interface StationTerminalRestoreState {
  content: string
  cols: number
  rows: number
}

function DetachedWorkbenchWindowView({ payload }: { payload: DetachedWorkbenchWindowPayload }) {
  const initialPreferences = useMemo(loadUiPreferences, [])
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(initialPreferences)
  const stations = useMemo(() => payload.stations.map(mapDetachedStation), [payload.stations])
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
  const [stationRuntimes, setStationRuntimes] = useState<Record<string, WorkbenchStationRuntime>>(() => {
    const runtimes = buildInitialRuntimeMap(payload.stations)
    console.log(DETACHED_LOG_PREFIX, 'init runtimes', JSON.stringify(Object.entries(runtimes).map(([k, v]) => [k.slice(0, 8), v.sessionId?.slice(0, 8) ?? null])))
    return runtimes
  })
  const stationRuntimesRef = useRef(stationRuntimes)
  const sinkByStationRef = useRef<Record<string, StationTerminalSink | null>>({})
  const stationTerminalRestoreStateRef = useRef<Record<string, StationTerminalRestoreState>>({})
  const outputCacheRef = useRef<Record<string, string>>({})
  const projectionSeqRef = useRef<Record<string, number>>({})
  const hydrateInFlightRef = useRef(false)
  const ensureSessionInFlightRef = useRef<Record<string, boolean>>({})
  const pendingFocusStationRef = useRef<Record<string, boolean>>({})
  const pendingLaunchCommandRef = useRef<Record<string, string | null>>({})
  const inputQueueRef = useRef<Record<string, string>>({})
  const inputSendingRef = useRef<Record<string, boolean>>({})
  const inputFlushTimerRef = useRef<Record<string, number | null>>({})

  useEffect(() => {
    stationsRef.current = stations
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
            runtime?.sessionId ? 'live' : 'idle',
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

  const setStationRuntime = useCallback((stationId: string, patch: Partial<WorkbenchStationRuntime>) => {
    setStationRuntimes((prev) => {
      const current = prev[stationId] ?? createEmptyWorkbenchStationRuntime()
      return {
        ...prev,
        [stationId]: {
          ...current,
          ...patch,
        },
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

  const appendStationTerminalOutput = useCallback((stationId: string, chunk: string) => {
    if (!chunk) {
      return
    }
    outputCacheRef.current[stationId] = appendDetachedTerminalOutput(outputCacheRef.current[stationId], chunk)
    sinkByStationRef.current[stationId]?.write(chunk)
  }, [])

  const resetStationTerminalOutput = useCallback((stationId: string, content = '') => {
    outputCacheRef.current[stationId] = content
    sinkByStationRef.current[stationId]?.reset(content)
  }, [])

  const requestHydrate = useCallback(() => {
    if (hydrateInFlightRef.current) {
      return
    }
    hydrateInFlightRef.current = true
    console.log(DETACHED_LOG_PREFIX, 'requestHydrate sending')
    void postBridgeMessage({
      kind: 'detached_terminal_hydrate_request',
      workspaceId: payload.workspaceId,
      containerId: payload.containerId,
    }).catch((err) => {
      console.error(DETACHED_LOG_PREFIX, 'requestHydrate failed', err)
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

  const sendInput = useMemo(() => {
    const clearFlushTimer = (stationId: string) => {
      const timerId = inputFlushTimerRef.current[stationId]
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      inputFlushTimerRef.current[stationId] = null
    }

    const flushInput = async (stationId: string) => {
      clearFlushTimer(stationId)
      if (inputSendingRef.current[stationId]) {
        return
      }
      const queuedInput = inputQueueRef.current[stationId] ?? ''
      if (!queuedInput) {
        return
      }
      inputQueueRef.current[stationId] = ''
      inputSendingRef.current[stationId] = true
      try {
        await postBridgeMessage({
          kind: 'detached_terminal_write_input',
          workspaceId: payload.workspaceId,
          containerId: payload.containerId,
          stationId,
          input: queuedInput,
        })
      } catch {
        requestHydrate()
      } finally {
        inputSendingRef.current[stationId] = false
        if (inputQueueRef.current[stationId]) {
          queueMicrotask(() => {
            void flushInput(stationId)
          })
        }
      }
    }

    return (stationId: string, input: string) => {
      if (!input) {
        return
      }
      const previous = inputQueueRef.current[stationId] ?? ''
      const merged = `${previous}${input}`
      inputQueueRef.current[stationId] =
        merged.length > STATION_INPUT_MAX_BUFFER_BYTES
          ? merged.slice(merged.length - STATION_INPUT_MAX_BUFFER_BYTES)
          : merged
      clearFlushTimer(stationId)
      if (shouldFlushStationInputImmediately(input)) {
        void flushInput(stationId)
        return
      }
      inputFlushTimerRef.current[stationId] = window.setTimeout(() => {
        inputFlushTimerRef.current[stationId] = null
        void flushInput(stationId)
      }, STATION_INPUT_FLUSH_MS)
    }
  }, [payload.containerId, payload.workspaceId, postBridgeMessage, requestHydrate])

  const flushPendingLaunchCommand = useCallback(
    (stationId: string) => {
      const command = pendingLaunchCommandRef.current[stationId]
      if (!command || !stationRuntimesRef.current[stationId]?.sessionId) {
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
      console.log(DETACHED_LOG_PREFIX, 'applyHydrateSnapshot received', {
        runtimeKeys: Object.keys(message.runtimes),
        outputKeys: Object.keys(message.outputs),
        outputLengths: Object.fromEntries(Object.entries(message.outputs).map(([k, v]) => [k.slice(0, 8), v?.length ?? 0])),
        activeStationId: message.activeStationId?.slice(0, 8),
      })
      const nextRuntimes = stationsRef.current.reduce<Record<string, WorkbenchStationRuntime>>((acc, station) => {
        acc[station.id] = normalizeDetachedTerminalRuntime(message.runtimes[station.id])
        return acc
      }, {})
      const nextOutputs = stationsRef.current.reduce<Record<string, string>>((acc, station) => {
        acc[station.id] = message.outputs[station.id] ?? outputCacheRef.current[station.id] ?? ''
        return acc
      }, {})
      stationsRef.current.forEach((station) => {
        projectionSeqRef.current[station.id] = message.projectionSeqByStation[station.id] ?? 0
        if (nextRuntimes[station.id]?.sessionId) {
          delete ensureSessionInFlightRef.current[station.id]
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
      stationTerminalRestoreStateRef.current = message.restoreStates ? { ...message.restoreStates } : {}
      Object.entries(sinkByStationRef.current).forEach(([stationId, sink]) => {
        if (!sink) {
          return
        }
        const restoreState = message.restoreStates?.[stationId]
        if (restoreState) {
          console.log(DETACHED_LOG_PREFIX, 'hydrate sink.restore', stationId.slice(0, 8))
          sink.restore(restoreState.content, restoreState.cols, restoreState.rows)
        } else {
          console.log(DETACHED_LOG_PREFIX, 'hydrate sink.reset', stationId.slice(0, 8), 'len=', (nextOutputs[stationId] ?? '').length)
          sink.reset(nextOutputs[stationId] ?? '')
        }
        flushPendingStationFocus(stationId)
      })
      stationsRef.current.forEach((station) => {
        flushPendingLaunchCommand(station.id)
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
        console.log(DETACHED_LOG_PREFIX, 'bridge msg filtered: wrong target', event.targetWindowLabel, '!=', payload.windowLabel)
        return
      }
      if (event.sourceWindowLabel !== DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL) {
        console.log(DETACHED_LOG_PREFIX, 'bridge msg filtered: wrong source', event.sourceWindowLabel)
        return
      }
      const message = event.payload
      if (message.workspaceId !== payload.workspaceId || message.containerId !== payload.containerId) {
        console.log(DETACHED_LOG_PREFIX, 'bridge msg filtered: wrong workspace/container')
        return
      }
      console.log(DETACHED_LOG_PREFIX, 'bridge msg received', message.kind)
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
            incrementStationUnread(message.stationId, Math.max(1, message.unreadDelta ?? 1))
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
          if (message.runtimePatch.sessionId) {
            delete ensureSessionInFlightRef.current[message.stationId]
          }
          setStationRuntime(message.stationId, message.runtimePatch)
          queueMicrotask(() => {
            flushPendingLaunchCommand(message.stationId)
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
        console.log(DETACHED_LOG_PREFIX, 'subscribeSurfaceEvents ready, calling requestHydrate')
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
        if (meta?.restoreState) {
          stationTerminalRestoreStateRef.current[stationId] = {
            content: meta.restoreState,
            cols: meta.restoreCols ?? 0,
            rows: meta.restoreRows ?? 0,
          }
        }
        delete sinkByStationRef.current[stationId]
        return
      }

      sinkByStationRef.current[stationId] = sink
      console.log(DETACHED_LOG_PREFIX, 'bindSink', stationId.slice(0, 8), 'hasRestoreState=', !!stationTerminalRestoreStateRef.current[stationId], 'hasCachedOutput=', Object.prototype.hasOwnProperty.call(outputCacheRef.current, stationId), 'sessionId=', stationRuntimesRef.current[stationId]?.sessionId?.slice(0, 8) ?? null)

      const restoreState = stationTerminalRestoreStateRef.current[stationId]
      if (restoreState) {
        sink.restore(restoreState.content, restoreState.cols, restoreState.rows)
        flushPendingStationFocus(stationId)
        return
      }

      if (Object.prototype.hasOwnProperty.call(outputCacheRef.current, stationId)) {
        sink.reset(outputCacheRef.current[stationId] ?? '')
        flushPendingStationFocus(stationId)
        return
      }

      sink.reset('')
      if (stationRuntimesRef.current[stationId]?.sessionId) {
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
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      const launchCommand = station ? buildStationLaunchCommand(station) : null
      const sessionId = await ensureStationTerminalSession(stationId)
      if (launchCommand) {
        if (sessionId || stationRuntimesRef.current[stationId]?.sessionId) {
          sendInput(stationId, launchCommand)
        } else {
          pendingLaunchCommandRef.current[stationId] = launchCommand
        }
      }
      if (sessionId) {
        flushPendingStationFocus(stationId)
      }
    },
    [ensureStationTerminalSession, flushPendingStationFocus, selectStation, sendInput],
  )

  const handleResize = useCallback(
    (stationId: string, cols: number, rows: number) => {
      void postBridgeMessage({
        kind: 'detached_terminal_resize',
        workspaceId: payload.workspaceId,
        containerId: payload.containerId,
        stationId,
        cols,
        rows,
      }).catch(() => {})
    },
    [payload.containerId, payload.workspaceId, postBridgeMessage],
  )

  const handleRestoreStateCaptured = useCallback(
    (stationId: string, state: StationTerminalRestoreStatePayload) => {
      stationTerminalRestoreStateRef.current[stationId] = state
      void postBridgeMessage({
        kind: 'detached_terminal_restore_state',
        workspaceId: payload.workspaceId,
        containerId: payload.containerId,
        stationId,
        state,
      }).catch(() => {})
    },
    [payload.containerId, payload.workspaceId, postBridgeMessage],
  )

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

  useEffect(() => {
    const flushTimerMap = inputFlushTimerRef.current
    return () => {
      Object.values(flushTimerMap).forEach((timerId) => {
        if (typeof timerId === 'number') {
          window.clearTimeout(timerId)
        }
      })
    }
  }, [])

  return (
    <div className="detached-workbench-window">
      <div className="detached-workbench-window-frame">
        <WorkbenchCanvasPanel
          locale={uiPreferences.locale as Locale}
          appearanceVersion={`${uiPreferences.themeMode}:${uiPreferences.monoFont}:${uiPreferences.uiFontSize}`}
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
          onSendInputData={sendInput}
          onResizeTerminal={handleResize}
          onBindTerminalSink={bindSink}
          onRenderedScreenSnapshot={undefined}
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
          }}
          onCustomLayoutChange={(containerId, customLayout) => {
            setContainer((prev) =>
              prev.id === containerId ? { ...prev, layoutMode: 'custom', customLayout } : prev,
            )
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
