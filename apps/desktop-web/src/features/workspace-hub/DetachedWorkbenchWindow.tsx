import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorkbenchCanvasPanel } from './WorkbenchCanvasPanel'
import { DETACHED_TERMINAL_RUNTIME_SYNC_STORAGE_KEY } from './detached-window-sync'
import type { AgentStation, StationRole } from './station-model'
import type { WorkbenchContainer as WorkbenchContainerModel } from './workbench-container-model'
import { normalizeWorkbenchCustomLayout, type WorkbenchCustomLayout, type WorkbenchLayoutMode } from './workbench-layout-model'
import type { WorkbenchStationRuntime } from './TerminalStationPane'
import { resolveAgentWorkdirAbs } from '@features/workspace'
import type { Locale } from '@shell/i18n/ui-locale'
import {
  applyUiPreferences,
  loadUiPreferences,
  type UiPreferences,
} from '@shell/state/ui-preferences'
import {
  desktopApi,
  type SurfaceDetachedStationPayload,
  type SurfaceWindowUpdatedPayload,
  type TerminalMetaPayload,
  type TerminalOutputPayload,
  type TerminalStatePayload,
} from '@shell/integration/desktop-api'
import './DetachedWorkbenchWindow.scss'

const STATION_INPUT_FLUSH_MS = 4
const STATION_INPUT_MAX_BUFFER_BYTES = 65536
const STATION_INPUT_IMMEDIATE_CHUNK_BYTES = 24
const TERMINAL_OUTPUT_CACHE_MAX_CHARS = 50000
const TERMINAL_WRITE_READBACK_DELAY_MS = 28

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

function decodeBase64Chunk(base64Chunk: string): string {
  try {
    const binary = window.atob(base64Chunk)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
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
    terminalSessionId: payload.sessionId?.trim() ?? '',
    state: payload.sessionId ? 'running' : 'idle',
    workspaceId: payload.workspaceId,
  }
}

function buildInitialRuntimeMap(
  stations: SurfaceDetachedStationPayload[],
): Record<string, WorkbenchStationRuntime> {
  return stations.reduce<Record<string, WorkbenchStationRuntime>>((acc, station) => {
    acc[station.stationId] = {
      sessionId: station.sessionId?.trim() ?? null,
      unreadCount: 0,
      stateRaw: station.sessionId ? 'running' : 'idle',
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    }
    return acc
  }, {})
}

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

function normalizeStationToolKind(
  tool: string | null | undefined,
): 'claude' | 'codex' | 'gemini' | 'shell' | 'unknown' {
  const normalized = tool?.trim().toLowerCase() ?? ''
  if (normalized.includes('claude')) {
    return 'claude'
  }
  if (normalized.includes('codex')) {
    return 'codex'
  }
  if (normalized.includes('gemini')) {
    return 'gemini'
  }
  if (normalized.includes('shell')) {
    return 'shell'
  }
  return 'unknown'
}

function buildStationLaunchCommand(station: AgentStation): string | null {
  switch (normalizeStationToolKind(station.tool)) {
    case 'claude':
      return 'claude\n'
    case 'codex':
      return 'codex\n'
    case 'gemini':
      return 'gemini\n'
    default:
      return null
  }
}

interface StationTerminalRestoreState {
  content: string
  cols: number
  rows: number
}

function appendTerminalOutputChunk(previous: string | undefined, chunk: string): string {
  const merged = `${previous ?? ''}${chunk}`
  return merged.length > TERMINAL_OUTPUT_CACHE_MAX_CHARS
    ? merged.slice(merged.length - TERMINAL_OUTPUT_CACHE_MAX_CHARS)
    : merged
}

function DetachedWorkbenchWindowView({ payload }: { payload: DetachedWorkbenchWindowPayload }) {
  const initialPreferences = useMemo(loadUiPreferences, [])
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(initialPreferences)
  const stations = useMemo(() => payload.stations.map(mapDetachedStation), [payload.stations])
  const stationsRef = useRef(stations)
  const [container, setContainer] = useState<WorkbenchContainerModel>(() => buildDetachedContainer(payload))
  const [activeStationId, setActiveStationId] = useState(payload.activeStationId ?? payload.stations[0]?.stationId ?? '')
  const [stationRuntimes, setStationRuntimes] = useState<Record<string, WorkbenchStationRuntime>>(() =>
    buildInitialRuntimeMap(payload.stations),
  )
  const stationRuntimesRef = useRef(stationRuntimes)
  const sessionStationRef = useRef<Record<string, string>>(
    payload.stations.reduce<Record<string, string>>((acc, station) => {
      if (station.sessionId) {
        acc[station.sessionId] = station.stationId
      }
      return acc
    }, {}),
  )
  const terminalSeqRef = useRef<Record<string, number>>({})
  const terminalOutputQueueRef = useRef<Record<string, Promise<void>>>({})
  const terminalSessionVisibilityRef = useRef<Record<string, boolean>>({})
  const sinkByStationRef = useRef<Record<string, import('@features/terminal').StationTerminalSink | null>>({})
  const stationTerminalRestoreStateRef = useRef<Record<string, StationTerminalRestoreState>>({})
  const outputCacheRef = useRef<Record<string, string>>({})
  const workspaceRootRef = useRef<string | null>(null)
  const inputQueueRef = useRef<Record<string, string>>({})
  const inputSendingRef = useRef<Record<string, boolean>>({})
  const inputFlushTimerRef = useRef<Record<string, number | null>>({})
  const inputReadbackTimerRef = useRef<Record<string, number | null>>({})
  const inputReadbackInFlightRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    stationsRef.current = stations
  }, [stations])

  useEffect(() => {
    stationRuntimesRef.current = stationRuntimes
  }, [stationRuntimes])

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
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setStationRuntime = useCallback((stationId: string, patch: Partial<WorkbenchStationRuntime>) => {
    setStationRuntimes((prev) => {
      const current = prev[stationId] ?? {
        sessionId: null,
        unreadCount: 0,
        stateRaw: 'idle',
        shell: null,
        cwdMode: 'workspace_root',
        resolvedCwd: null,
      }
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
      const runtime = prev[stationId]
      if (!runtime) {
        return prev
      }
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

  const appendStationTerminalOutput = useCallback((stationId: string, chunk: string) => {
    if (!chunk) {
      return
    }
    outputCacheRef.current[stationId] = appendTerminalOutputChunk(outputCacheRef.current[stationId], chunk)
    sinkByStationRef.current[stationId]?.write(chunk)
  }, [])

  const resetStationTerminalOutput = useCallback((stationId: string, content = '') => {
    const nextContent =
      content.length > TERMINAL_OUTPUT_CACHE_MAX_CHARS
        ? content.slice(content.length - TERMINAL_OUTPUT_CACHE_MAX_CHARS)
        : content
    outputCacheRef.current[stationId] = nextContent
    sinkByStationRef.current[stationId]?.reset(nextContent)
  }, [])

  const ensureTerminalSessionVisible = useCallback((sessionId: string) => {
    if (terminalSessionVisibilityRef.current[sessionId]) {
      return
    }
    void desktopApi
      .terminalSetVisibility(sessionId, true)
      .then(() => {
        terminalSessionVisibilityRef.current[sessionId] = true
      })
      .catch(() => {})
  }, [])

  const resolveWorkspaceRoot = useCallback(async (): Promise<string | null> => {
    if (workspaceRootRef.current) {
      return workspaceRootRef.current
    }
    try {
      const context = await desktopApi.workspaceGetContext(payload.workspaceId)
      workspaceRootRef.current = context.root
      return context.root
    } catch {
      return null
    }
  }, [payload.workspaceId])

  const syncStationTerminalReadback = useCallback(
    async (stationId: string, sessionId: string) => {
      if (inputReadbackInFlightRef.current[stationId]) {
        return
      }
      inputReadbackInFlightRef.current[stationId] = true
      try {
        const seq = terminalSeqRef.current[sessionId] ?? 0
        const delta = await desktopApi
          .terminalReadDelta(sessionId, seq, TERMINAL_OUTPUT_CACHE_MAX_CHARS)
          .catch(() => null)
        if (delta && !delta.gap && !delta.truncated) {
          if (delta.toSeq > seq) {
            const text = decodeBase64Chunk(delta.chunk)
            if (text) {
              appendStationTerminalOutput(stationId, text)
            }
            terminalSeqRef.current[sessionId] = delta.toSeq
          }
          return
        }

        const snapshot = await desktopApi
          .terminalReadSnapshot(sessionId, TERMINAL_OUTPUT_CACHE_MAX_CHARS)
          .catch(() => null)
        if (!snapshot) {
          return
        }
        if (snapshot.currentSeq <= seq && Object.prototype.hasOwnProperty.call(outputCacheRef.current, stationId)) {
          return
        }
        resetStationTerminalOutput(stationId, decodeBase64Chunk(snapshot.chunk))
        terminalSeqRef.current[sessionId] = snapshot.currentSeq
      } finally {
        inputReadbackInFlightRef.current[stationId] = false
      }
    },
    [appendStationTerminalOutput, resetStationTerminalOutput],
  )

  const scheduleStationTerminalReadback = useCallback(
    (stationId: string, sessionId: string) => {
      const existingTimerId = inputReadbackTimerRef.current[stationId]
      if (typeof existingTimerId === 'number') {
        window.clearTimeout(existingTimerId)
      }
      inputReadbackTimerRef.current[stationId] = window.setTimeout(() => {
        inputReadbackTimerRef.current[stationId] = null
        void syncStationTerminalReadback(stationId, sessionId)
      }, TERMINAL_WRITE_READBACK_DELAY_MS)
    },
    [syncStationTerminalReadback],
  )

  useEffect(() => {
    const desiredVisibility: Record<string, boolean> = {}
    Object.values(stationRuntimes).forEach((runtime) => {
      if (!runtime.sessionId) {
        return
      }
      desiredVisibility[runtime.sessionId] = true
    })
    Object.keys(desiredVisibility).forEach((sessionId) => {
      if (terminalSessionVisibilityRef.current[sessionId]) {
        return
      }
      ensureTerminalSessionVisible(sessionId)
    })
    Object.keys(terminalSessionVisibilityRef.current).forEach((sessionId) => {
      if (desiredVisibility[sessionId] !== undefined) {
        return
      }
      delete terminalSessionVisibilityRef.current[sessionId]
    })
  }, [ensureTerminalSessionVisible, stationRuntimes])

  useEffect(() => {
    if (!activeStationId) {
      return
    }
    setStationRuntimes((prev) => {
      const runtime = prev[activeStationId]
      if (!runtime || runtime.unreadCount === 0) {
        return prev
      }
      return {
        ...prev,
        [activeStationId]: {
          ...runtime,
          unreadCount: 0,
        },
      }
    })
  }, [activeStationId])

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    void desktopApi
      .subscribeTerminalEvents({
        onOutput: (eventPayload: TerminalOutputPayload) => {
          const previous = terminalOutputQueueRef.current[eventPayload.sessionId] ?? Promise.resolve()
          terminalOutputQueueRef.current[eventPayload.sessionId] = previous
            .catch(() => undefined)
            .then(async () => {
              if (disposed) {
                return
              }
              const stationId = sessionStationRef.current[eventPayload.sessionId]
              if (!stationId) {
                return
              }
              const unread = stationId !== activeStationId
              const seq = terminalSeqRef.current[eventPayload.sessionId] ?? 0
              if (eventPayload.seq <= seq) {
                return
              }
              if (eventPayload.seq === seq + 1) {
                const text = decodeBase64Chunk(eventPayload.chunk)
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSeqRef.current[eventPayload.sessionId] = eventPayload.seq
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const delta = await desktopApi
                .terminalReadDelta(eventPayload.sessionId, seq, TERMINAL_OUTPUT_CACHE_MAX_CHARS)
                .catch(() => null)
              if (
                delta &&
                !delta.gap &&
                !delta.truncated &&
                delta.fromSeq === seq + 1 &&
                delta.toSeq >= eventPayload.seq
              ) {
                const text = decodeBase64Chunk(delta.chunk)
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSeqRef.current[eventPayload.sessionId] = delta.toSeq
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const snapshot = await desktopApi
                .terminalReadSnapshot(eventPayload.sessionId, TERMINAL_OUTPUT_CACHE_MAX_CHARS)
                .catch(() => null)
              if (!snapshot) {
                return
              }
              resetStationTerminalOutput(stationId, decodeBase64Chunk(snapshot.chunk))
              terminalSeqRef.current[eventPayload.sessionId] = snapshot.currentSeq
              if (unread) {
                incrementStationUnread(stationId, 1)
              }
            })
        },
        onStateChanged: (eventPayload: TerminalStatePayload) => {
          const stationId = sessionStationRef.current[eventPayload.sessionId]
          if (!stationId) {
            return
          }
          setStationRuntime(stationId, {
            sessionId: eventPayload.sessionId,
            stateRaw: eventPayload.to,
          })
          appendStationTerminalOutput(stationId, `\n[terminal:${eventPayload.to}]\n`)
          if (
            eventPayload.to === 'exited' ||
            eventPayload.to === 'killed' ||
            eventPayload.to === 'failed'
          ) {
            delete terminalSeqRef.current[eventPayload.sessionId]
            delete terminalOutputQueueRef.current[eventPayload.sessionId]
            delete terminalSessionVisibilityRef.current[eventPayload.sessionId]
          }
        },
        onMeta: (eventPayload: TerminalMetaPayload) => {
          const stationId = sessionStationRef.current[eventPayload.sessionId]
          if (!stationId) {
            return
          }
          const tail = decodeBase64Chunk(eventPayload.tailChunk)
          if (tail) {
            appendStationTerminalOutput(stationId, tail)
          }
          if (stationId !== activeStationId) {
            incrementStationUnread(stationId, Math.max(1, Math.min(99, eventPayload.unreadChunks || 1)))
          }
        },
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanup = unlisten
      })
    return () => {
      disposed = true
      cleanup()
    }
  }, [
    activeStationId,
    appendStationTerminalOutput,
    incrementStationUnread,
    resetStationTerminalOutput,
    setStationRuntime,
  ])

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
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        cleanup = unlisten
      })
    return () => {
      disposed = true
      cleanup()
    }
  }, [payload.windowLabel])

  const bindSink = useCallback(
    (
      stationId: string,
      sink: import('@features/terminal').StationTerminalSink | null,
      meta?: import('@features/terminal').StationTerminalSinkBindingMeta,
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

      const restoreState = stationTerminalRestoreStateRef.current[stationId]
      if (restoreState) {
        sink.restore(restoreState.content, restoreState.cols, restoreState.rows)
        return
      }

      if (Object.prototype.hasOwnProperty.call(outputCacheRef.current, stationId)) {
        sink.reset(outputCacheRef.current[stationId] ?? '')
        return
      }

      const sessionId = stationRuntimesRef.current[stationId]?.sessionId
      if (!sessionId) {
        return
      }

      void desktopApi
        .terminalReadSnapshot(sessionId, TERMINAL_OUTPUT_CACHE_MAX_CHARS)
        .then((snapshot) => {
          if (stationRuntimesRef.current[stationId]?.sessionId !== sessionId) {
            return
          }
          const content = decodeBase64Chunk(snapshot.chunk)
          outputCacheRef.current[stationId] = content
          terminalSeqRef.current[sessionId] = snapshot.currentSeq
          sinkByStationRef.current[stationId]?.reset(content)
        })
        .catch(() => {})
    },
    [],
  )

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
      const sessionId = stationRuntimesRef.current[stationId]?.sessionId
      if (!sessionId) {
        return
      }
      inputQueueRef.current[stationId] = ''
      inputSendingRef.current[stationId] = true
      try {
        await desktopApi.terminalWrite(sessionId, queuedInput)
        scheduleStationTerminalReadback(stationId, sessionId)
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
      if (
        input.includes('\n') ||
        input.includes('\r') ||
        input.length >= STATION_INPUT_IMMEDIATE_CHUNK_BYTES
      ) {
        void flushInput(stationId)
        return
      }
      if (!previous && !inputSendingRef.current[stationId]) {
        void flushInput(stationId)
        return
      }
      inputFlushTimerRef.current[stationId] = window.setTimeout(() => {
        inputFlushTimerRef.current[stationId] = null
        void flushInput(stationId)
      }, STATION_INPUT_FLUSH_MS)
    }
  }, [scheduleStationTerminalReadback])

  const ensureStationTerminalSession = useCallback(
    async (stationId: string): Promise<string | null> => {
      const existing = stationRuntimesRef.current[stationId]?.sessionId ?? null
      if (existing) {
        return existing
      }
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      if (!station) {
        return null
      }
      try {
        const workspaceRoot = await resolveWorkspaceRoot()
        if (!workspaceRoot) {
          return null
        }
        const session = await desktopApi.terminalCreate(payload.workspaceId, {
          cwdMode: 'custom',
          cwd: resolveAgentWorkdirAbs(workspaceRoot, station.agentWorkdirRel),
          env: {
            GTO_WORKSPACE_ID: payload.workspaceId,
            GTO_AGENT_ID: station.id,
            GTO_ROLE_KEY: station.role,
            GTO_STATION_ID: station.id,
          },
          agentToolKind: normalizeStationToolKind(station.tool),
        })
        sessionStationRef.current[session.sessionId] = stationId
        terminalSeqRef.current[session.sessionId] = 0
        terminalOutputQueueRef.current[session.sessionId] = Promise.resolve()
        delete stationTerminalRestoreStateRef.current[stationId]
        ensureTerminalSessionVisible(session.sessionId)
        setStationRuntimes((prev) => ({
          ...prev,
          [stationId]: {
            ...(prev[stationId] ?? {
              unreadCount: 0,
            }),
            sessionId: session.sessionId,
            stateRaw: 'running',
            shell: session.shell,
            cwdMode: session.cwdMode,
            resolvedCwd: session.resolvedCwd,
            unreadCount: 0,
          },
        }))
        window.localStorage.setItem(
          DETACHED_TERMINAL_RUNTIME_SYNC_STORAGE_KEY,
          JSON.stringify({
            workspaceId: payload.workspaceId,
            stationId,
            sessionId: session.sessionId,
            shell: session.shell,
            cwdMode: session.cwdMode,
            resolvedCwd: session.resolvedCwd,
            stateRaw: 'running',
            tsMs: Date.now(),
          }),
        )
        return session.sessionId
      } catch {
        return null
      }
    },
    [ensureTerminalSessionVisible, payload.workspaceId, resolveWorkspaceRoot],
  )

  const launchStationTerminal = useCallback(
    async (stationId: string) => {
      const sessionId = await ensureStationTerminalSession(stationId)
      if (!sessionId) {
        return
      }
      sinkByStationRef.current[stationId]?.focus()
    },
    [ensureStationTerminalSession],
  )

  const launchStationCliAgent = useCallback(
    async (stationId: string) => {
      const sessionId = await ensureStationTerminalSession(stationId)
      if (!sessionId) {
        return
      }
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      const launchCommand = station ? buildStationLaunchCommand(station) : null
      if (launchCommand) {
        sendInput(stationId, launchCommand)
      }
      sinkByStationRef.current[stationId]?.focus()
    },
    [ensureStationTerminalSession, sendInput],
  )

  const handleResize = useCallback((stationId: string, cols: number, rows: number) => {
    const sessionId = stationRuntimesRef.current[stationId]?.sessionId
    if (!sessionId) {
      return
    }
    void desktopApi.terminalResize(sessionId, cols, rows).catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      Object.values(inputFlushTimerRef.current).forEach((timerId) => {
        if (typeof timerId === 'number') {
          window.clearTimeout(timerId)
        }
      })
      Object.values(inputReadbackTimerRef.current).forEach((timerId) => {
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
            setActiveStationId(stationId)
            setContainer((prev) => ({
              ...prev,
              activeStationId: stationId,
            }))
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
    </div>
  )
}

export const DetachedWorkbenchWindow = memo(DetachedWorkbenchWindowView)
