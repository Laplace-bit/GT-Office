import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import {
  appendStationTerminalDebugRecord as appendStationTerminalDebugStoreRecord,
  createTerminalChunkDecoder,
  decodeTerminalBase64Chunk,
  formatTerminalDebugBody,
  formatTerminalDebugPreview,
  isStationTerminalDebugEnabled,
  resetTerminalChunkDecoder,
  setStationTerminalDebugHumanLog,
  buildClosedStationTerminalRuntime,
  buildSessionBindingRuntimePatch,
  captureMatchingSessionOwnedRestoreState,
  captureSessionOwnedRestoreState,
  createBufferedStationInputController,
  ensureSingleFlightStationSession,
  resolveStationSessionRebindCleanup,
  retainSessionOwnedRestoreState,
  resolveClosedStationSessionCleanup,
  resolveClosedStationRuntimeRegistrationCleanup,
  resolveDroppedStationRuntimeCleanup,
  resolveDroppedStationSessionCleanup,
  resolveStationRuntimeRegistrationCleanup,
  shouldPreferSessionOwnedRestoreState,
  shouldApplyRecoveredStationOutput,
  shouldApplyStationSessionLaunchFailure,
  shouldApplyStationSessionResult,
  shouldApplyStationToolLaunchResult,
  shouldForwardStationTerminalInput,
  shouldMatchDetachedBridgeSession,
  type BufferedStationInputController,
  type SessionOwnedRestoreState,
  type TerminalChunkDecoder,
  type TerminalDebugRecordInput,
  type StationTerminalSink,
  type StationTerminalSinkBindingHandler,
} from '@features/terminal'
import {
  isStationAgentProcessRunning,
  resolveStationCliLaunchCommand,
} from '@features/workspace-hub/station-agent-runtime-model'
import {
  buildStationDeleteCleanupRequest,
  buildStationDeleteCleanupState,
  type StationDeleteCleanupState,
} from '@features/workspace-hub/station-delete-binding-cleanup-model'
import {
  appendDetachedTerminalOutput,
  createEmptyWorkbenchStationRuntime,
  DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS,
  composeStationActionCommand,
  stripDetachedTerminalRuntimeProjectionPatch,
  type AgentStation,
  type DetachedTerminalRuntimeProjectionPatch,
  type StationActionDescriptor,
  type UpdateStationInput,
  type WorkbenchContainerModel,
} from '@features/workspace-hub'
import {
  buildAgentWorkspaceMarkerPath,
  resolveAgentWorkdirAbs,
} from '@features/workspace'
import {
  type RenderedScreenSnapshot,
  type DetachedTerminalBridgeMessage,
  type DetachedTerminalHydrateSnapshotMessage,
  type DetachedTerminalOutputAppendMessage,
  type DetachedTerminalOutputResetMessage,
  type DetachedTerminalRuntimeUpdatedMessage,
  type TerminalDescribeProcessesResponse,
  type TerminalMetaPayload,
  type TerminalOutputPayload,
  type TerminalStatePayload,
  type ToolCommandSummary,
  desktopApi,
  type AgentRuntimeRegisterRequest,
  type StationTerminalRestoreStatePayload,
  type SurfaceBridgeEventPayload,
} from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'
import {
  createWorkspaceTerminalSessionDocument,
  findWorkspaceTerminalSessionOwner,
  hydrateWorkspaceTerminalSessionDocument,
  removeWorkspaceTerminalSessionBinding,
  setWorkspaceTerminalSessionVisibility,
  type WorkspaceTerminalSessionDocument,
} from '../state/workspace-terminal-session-store'
import {
  STATION_INPUT_FLUSH_MS,
  STATION_INPUT_MAX_BUFFER_BYTES,
  STATION_TASK_SUBMIT_MAX_RETRY_FRAMES,
  createInitialStationTerminals,
  describeError,
  getStationIdleBanner,
  normalizeStationToolKind,
  normalizeSubmitSequence,
  shouldFlushStationInputImmediately,
  type DetachedProjectionTarget,
  type StationTerminalRuntime,
} from './ShellRoot.shared'
import type { ShellExternalChannelController } from './useShellExternalChannelController'

const TERMINAL_DEBUG_RECORD_LIMIT = 0

interface UseShellTerminalControllerInput {
  // Core state from root
  activeWorkspaceId: string | null
  activeWorkspaceIdRef: MutableRefObject<string | null>
  activeStationId: string
  locale: Locale
  tauriRuntime: boolean
  initialStations: AgentStation[]
  stations: AgentStation[]
  stationsRef: MutableRefObject<AgentStation[]>
  activeWorkspaceRoot: string | null

  // State setters for cross-concern mutations
  setActiveStationId: Dispatch<SetStateAction<string>>
  setStations: Dispatch<SetStateAction<AgentStation[]>>
  setIsStationManageOpen: Dispatch<SetStateAction<boolean>>
  setEditingStation: Dispatch<SetStateAction<UpdateStationInput | null>>

  // Workbench container refs
  workbenchContainersRef: MutableRefObject<WorkbenchContainerModel[]>

  // Performance policy
  windowPerformancePolicy: WindowPerformancePolicy

  // Detached projection callbacks (bridge to workbench controller)
  detachedWindowOpenInFlightRef: MutableRefObject<Record<string, boolean>>

  // External channel controller
  externalChannelController: ShellExternalChannelController

  // Performance debug
  performanceDebugState: { enabled: boolean }
}

import type { WindowPerformancePolicy } from './window-performance-policy'

export interface ShellTerminalController {
  // State
  stationTerminals: Record<string, StationTerminalRuntime>
  setStationTerminals: Dispatch<SetStateAction<Record<string, StationTerminalRuntime>>>
  stationProcessSnapshots: Record<string, TerminalDescribeProcessesResponse>
  toolCommandsByStationId: Record<string, ToolCommandSummary[]>
  isBatchLaunchingAgents: boolean
  pendingStationActionSheet: { station: AgentStation; action: StationActionDescriptor } | null

  // Core refs that other code needs access to
  stationTerminalsRef: MutableRefObject<Record<string, StationTerminalRuntime>>
  stationTerminalOutputCacheRef: MutableRefObject<Record<string, string>>
  stationSubmitSequenceRef: MutableRefObject<Record<string, string>>

  // Station delete state
  stationDeletePendingId: string | null
  stationDeleteCleanupTargetId: string | null
  stationDeleteCleanupState: StationDeleteCleanupState | null
  stationDeleteCleanupSubmitting: boolean
  handleStationDeleteCleanupChange: (patch: Partial<StationDeleteCleanupState>) => void
  handleStationDeleteCleanupClose: () => void
  handleStationDeleteCleanupConfirm: () => Promise<void>

  // Core terminal operations
  bindStationTerminalSink: StationTerminalSinkBindingHandler
  appendStationTerminalOutput: (stationId: string, chunk: string) => void
  resetStationTerminalOutput: (stationId: string, content?: string) => void
  setStationTerminalState: (stationId: string, patch: Partial<StationTerminalRuntime>) => void
  clearStationUnread: (stationId: string) => void
  ensureStationTerminalSession: (stationId: string) => Promise<string | null>
  launchStationTerminal: (stationId: string) => Promise<void>
  sendStationTerminalInput: (stationId: string, input: string) => void
  handleStationTerminalInput: (stationId: string, data: string) => void
  submitStationTerminal: (stationId: string) => Promise<boolean>
  writeStationTerminalWithSubmit: (stationId: string, input: string) => Promise<boolean>
  resetStationTerminalToAgentWorkdir: (stationId: string) => Promise<boolean>
  resizeStationTerminal: (stationId: string, cols: number, rows: number) => void
  reconcileStationRuntimeRegistration: (input: { workspaceId: string; stationId: string; expectedSessionId: string | null }) => Promise<void>

  // Station operations
  removeStation: (stationId: string) => Promise<void>
  cleanupRemovedStationRuntimeState: (stationId: string, workspaceId: string | null) => Promise<boolean>
  launchStationCliAgent: (stationId: string) => Promise<void>
  handleBatchLaunchAgents: () => Promise<void>
  loadToolCommandsForStations: () => Promise<void>
  executeStationAction: (station: AgentStation, action: StationActionDescriptor) => Promise<void>
  handleSubmitStationActionSheet: (values: Record<string, string | boolean>) => Promise<void>

  // Terminal document
  captureActiveWorkspaceTerminalDocument: (workspaceId: string | null) => void
  resolveWorkspaceTerminalDocument: (workspaceId: string | null, stationsForWorkspace: AgentStation[]) => WorkspaceTerminalSessionDocument
  persistActiveWorkspaceTerminalDocument: () => void
  suspendWorkspaceTerminalSessions: (workspaceId: string | null) => void
  recoverWorkspaceTerminalSessions: (workspaceId: string | null) => void

  // Detached bridge
  findDetachedProjectionTargetsByStationId: (stationId: string) => DetachedProjectionTarget[]
  publishDetachedRuntimePatch: (stationId: string, patch: DetachedTerminalRuntimeProjectionPatch) => void
  publishDetachedOutputAppend: (stationId: string, chunk: string) => void
  publishDetachedOutputReset: (stationId: string, content: string) => void
  handleDetachedSurfaceBridgeMessage: (event: SurfaceBridgeEventPayload<DetachedTerminalBridgeMessage>) => void
  reportRenderedScreenSnapshot: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  updateStationProcessSnapshot: (stationId: string, snapshot: TerminalDescribeProcessesResponse | null) => void
  inspectStationSessionProcesses: (stationId: string, sessionId: string) => Promise<TerminalDescribeProcessesResponse | null>

  // Batch launch & actions
  setIsBatchLaunchingAgents: Dispatch<SetStateAction<boolean>>
  setPendingStationActionSheet: Dispatch<SetStateAction<{ station: AgentStation; action: StationActionDescriptor } | null>>

  // Computed
  terminalSessionCount: number
  stationAgentRunningById: Record<string, boolean>
  batchLaunchableAgentCount: number
  toolCommandReloadKey: string
  runtimeStateByStationId: Record<string, string>

  // Workspace presentation switch support
  resetTerminalStateOnWorkspaceSwitch: () => void

  // Workspace session restore support - exposing internal refs
  sessionStationRef: MutableRefObject<Record<string, string>>
  terminalSessionSeqRef: MutableRefObject<Record<string, number>>
  terminalOutputQueueRef: MutableRefObject<Record<string, Promise<void>>>
  ensureStationTerminalSessionInFlightRef: MutableRefObject<Record<string, Promise<string | null>>>
  stationTerminalRestoreStateRef: MutableRefObject<Record<string, SessionOwnedRestoreState>>
  stationTerminalPendingReplayRef: MutableRefObject<Record<string, { version: number; ops: Array<{ kind: 'write'; chunk: string } | { kind: 'reset'; content: string }> }>>
  stationTerminalInputControllerRef: MutableRefObject<BufferedStationInputController | null>
  stationTerminalSinkRef: MutableRefObject<Record<string, StationTerminalSink>>
  stationTerminalOutputRevisionRef: MutableRefObject<Record<string, number>>
  terminalSessionVisibilityRef: MutableRefObject<Record<string, boolean>>
  terminalChunkDecoderBySessionRef: MutableRefObject<Record<string, TerminalChunkDecoder>>
  registeredAgentRuntimeRef: MutableRefObject<Record<string, { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }>>
  stationUnreadDeltaRef: MutableRefObject<Record<string, number>>
  stationUnreadFlushTimerRef: MutableRefObject<number | null>
  workspaceTerminalCacheRef: MutableRefObject<Record<string, WorkspaceTerminalSessionDocument>>
  presentedWorkspaceIdRef: MutableRefObject<string | null>
  stationToolLaunchSeqRef: MutableRefObject<Record<string, number>>
  stationProcessSnapshotsRef: MutableRefObject<Record<string, TerminalDescribeProcessesResponse>>

  // Additional refs needed by workspace session restore
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string | null>
}

export function useShellTerminalController({
  activeWorkspaceId,
  activeWorkspaceIdRef,
  activeStationId,
  locale,
  tauriRuntime: _tauriRuntime,
  initialStations,
  stations,
  stationsRef,
  activeWorkspaceRoot,

  setActiveStationId: _setActiveStationId,
  setStations,
  setIsStationManageOpen,
  setEditingStation,

  workbenchContainersRef,
  windowPerformancePolicy,
  detachedWindowOpenInFlightRef: _detachedWindowOpenInFlightRef,
  externalChannelController,
  performanceDebugState,
}: UseShellTerminalControllerInput): ShellTerminalController {
  // ── State declarations ────────────────────────────────────────────────
  const [stationTerminals, setStationTerminals] = useState<Record<string, StationTerminalRuntime>>(
    () => createInitialStationTerminals(initialStations),
  )
  const [stationProcessSnapshots, setStationProcessSnapshots] = useState<
    Record<string, TerminalDescribeProcessesResponse>
  >({})
  const [toolCommandsByStationId, setToolCommandsByStationId] = useState<Record<string, ToolCommandSummary[]>>({})
  const [pendingStationActionSheet, setPendingStationActionSheet] = useState<{
    station: AgentStation
    action: StationActionDescriptor
  } | null>(null)
  const [isBatchLaunchingAgents, setIsBatchLaunchingAgents] = useState(false)
  const [stationDeletePendingId, setStationDeletePendingId] = useState<string | null>(null)
  const [stationDeleteCleanupTargetId, setStationDeleteCleanupTargetId] = useState<string | null>(null)
  const [stationDeleteCleanupState, setStationDeleteCleanupState] = useState<StationDeleteCleanupState | null>(null)
  const [stationDeleteCleanupSubmitting, setStationDeleteCleanupSubmitting] = useState(false)

  // ── Refs ──────────────────────────────────────────────────────────────
  const stationTerminalsRef = useRef(stationTerminals)
  const stationProcessSnapshotsRef = useRef(stationProcessSnapshots)
  const sessionStationRef = useRef<Record<string, string>>({})
  const terminalSessionSeqRef = useRef<Record<string, number>>({})
  const terminalOutputQueueRef = useRef<Record<string, Promise<void>>>({})
  const ensureStationTerminalSessionInFlightRef = useRef<Record<string, Promise<string | null>>>({})
  const stationToolLaunchSeqRef = useRef<Record<string, number>>({})
  const stationTerminalSinkRef = useRef<Record<string, StationTerminalSink>>({})
  const stationTerminalOutputCacheRef = useRef<Record<string, string>>({})
  const stationTerminalOutputRevisionRef = useRef<Record<string, number>>({})
  const stationTerminalPendingReplayRef = useRef<
    Record<string, { version: number; ops: Array<{ kind: 'write'; chunk: string } | { kind: 'reset'; content: string }> }>
  >({})
  const stationTerminalRestoreStateRef = useRef<Record<string, SessionOwnedRestoreState>>({})
  const stationTerminalInputControllerRef = useRef<BufferedStationInputController | null>(null)
  const stationSubmitSequenceRef = useRef<Record<string, string>>({})
  const terminalSessionVisibilityRef = useRef<Record<string, boolean>>({})
  const terminalChunkDecoderBySessionRef = useRef<Record<string, TerminalChunkDecoder>>({})
  const terminalDebugRecordSeqRef = useRef(0)
  const workspaceTerminalCacheRef = useRef<Record<string, WorkspaceTerminalSessionDocument>>({})
  const detachedProjectionSeqRef = useRef<Record<string, number>>({})
  const detachedProjectionDispatchQueueRef = useRef<Record<string, Promise<void>>>({})
  const registeredAgentRuntimeRef = useRef<
    Record<string, { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }>
  >({})
  const stationUnreadDeltaRef = useRef<Record<string, number>>({})
  const stationUnreadFlushTimerRef = useRef<number | null>(null)
  const presentedWorkspaceIdRef = useRef<string | null>(null)

  // ── Ref sync effects ──────────────────────────────────────────────────
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId, activeWorkspaceIdRef])

  useEffect(() => {
    stationTerminalsRef.current = stationTerminals
  }, [stationTerminals])

  useEffect(() => {
    stationProcessSnapshotsRef.current = stationProcessSnapshots
  }, [stationProcessSnapshots])

  useEffect(() => {
    if (stations.length === 0) {
      return
    }
    setStationTerminals((prev) => {
      let changed = false
      const next = { ...prev }
      const initialRuntimeById = createInitialStationTerminals(stations)
      stations.forEach((station) => {
        if (next[station.id]) {
          return
        }
        next[station.id] = initialRuntimeById[station.id]
        changed = true
      })
      return changed ? next : prev
    })
    stations.forEach((station) => {
      if (stationTerminalOutputCacheRef.current[station.id] !== undefined) {
        return
      }
      stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(station)
    })
  }, [stations])

  // ── Station process snapshot pruning ──────────────────────────────────
  useEffect(() => {
    setStationProcessSnapshots((prev) => {
      const nextEntries = Object.entries(prev).filter(([stationId, snapshot]) => {
        const sessionId = stationTerminals[stationId]?.sessionId ?? null
        return Boolean(sessionId && snapshot.sessionId === sessionId)
      })
      const next = Object.fromEntries(nextEntries)
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [stationTerminals])

  // ── Detached projection helpers ───────────────────────────────────────
  const findDetachedProjectionTargetsByStationId = useCallback((stationId: string): DetachedProjectionTarget[] => {
    if (!stationId) {
      return []
    }
    return workbenchContainersRef.current.reduce<DetachedProjectionTarget[]>((acc, container) => {
      if (
        container.mode !== 'detached' ||
        !container.detachedWindowLabel ||
        !container.stationIds.includes(stationId)
      ) {
        return acc
      }
      acc.push({
        containerId: container.id,
        windowLabel: container.detachedWindowLabel,
      })
      return acc
    }, [])
  }, [])

  const queueDetachedProjectionMessage = useCallback(
    (windowLabel: string, payload: DetachedTerminalBridgeMessage) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const previous = detachedProjectionDispatchQueueRef.current[windowLabel] ?? Promise.resolve()
      detachedProjectionDispatchQueueRef.current[windowLabel] = previous
        .catch(() => undefined)
        .then(async () => {
          await desktopApi.surfaceBridgePost(windowLabel, payload)
        })
        .catch(() => undefined)
    },
    [],
  )

  const nextDetachedProjectionSeq = useCallback((windowLabel: string, stationId: string) => {
    const seqKey = `${windowLabel}:${stationId}`
    const nextSeq = (detachedProjectionSeqRef.current[seqKey] ?? 0) + 1
    detachedProjectionSeqRef.current[seqKey] = nextSeq
    return nextSeq
  }, [])

  const publishDetachedRuntimePatch = useCallback(
    (stationId: string, runtimePatch: DetachedTerminalRuntimeProjectionPatch) => {
      if (!runtimePatch || Object.keys(runtimePatch).length === 0) {
        return
      }
      findDetachedProjectionTargetsByStationId(stationId).forEach(({ containerId, windowLabel }) => {
        const message: DetachedTerminalRuntimeUpdatedMessage = {
          kind: 'detached_terminal_runtime_updated',
          workspaceId: activeWorkspaceIdRef.current ?? '',
          containerId,
          stationId,
          runtimePatch,
          projectionSeq: nextDetachedProjectionSeq(windowLabel, stationId),
        }
        queueDetachedProjectionMessage(windowLabel, message)
      })
    },
    [findDetachedProjectionTargetsByStationId, nextDetachedProjectionSeq, queueDetachedProjectionMessage],
  )

  const publishDetachedOutputAppend = useCallback(
    (stationId: string, chunk: string) => {
      if (!chunk) {
        return
      }
      findDetachedProjectionTargetsByStationId(stationId).forEach(({ containerId, windowLabel }) => {
        const message: DetachedTerminalOutputAppendMessage = {
          kind: 'detached_terminal_output_append',
          workspaceId: activeWorkspaceIdRef.current ?? '',
          containerId,
          stationId,
          chunk,
          projectionSeq: nextDetachedProjectionSeq(windowLabel, stationId),
          unreadDelta: 1,
        }
        queueDetachedProjectionMessage(windowLabel, message)
      })
    },
    [findDetachedProjectionTargetsByStationId, nextDetachedProjectionSeq, queueDetachedProjectionMessage],
  )

  const publishDetachedOutputReset = useCallback(
    (stationId: string, content: string) => {
      findDetachedProjectionTargetsByStationId(stationId).forEach(({ containerId, windowLabel }) => {
        const message: DetachedTerminalOutputResetMessage = {
          kind: 'detached_terminal_output_reset',
          workspaceId: activeWorkspaceIdRef.current ?? '',
          containerId,
          stationId,
          content,
          projectionSeq: nextDetachedProjectionSeq(windowLabel, stationId),
        }
        queueDetachedProjectionMessage(windowLabel, message)
      })
    },
    [findDetachedProjectionTargetsByStationId, nextDetachedProjectionSeq, queueDetachedProjectionMessage],
  )

  // ── Terminal debug ─────────────────────────────────────────────────────
  const pushStationTerminalDebugRecord = useCallback(
    (stationId: string, input: TerminalDebugRecordInput) => {
      if (!isStationTerminalDebugEnabled(stationId)) {
        return
      }
      terminalDebugRecordSeqRef.current += 1
      const record: import('@features/terminal').TerminalDebugRecord = {
        id: `${stationId}:${terminalDebugRecordSeqRef.current.toString(16)}`,
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
      }
      appendStationTerminalDebugStoreRecord(stationId, record, TERMINAL_DEBUG_RECORD_LIMIT)
    },
    [],
  )

  // ── Terminal document persistence ──────────────────────────────────────
  const captureActiveWorkspaceTerminalDocument = useCallback(
    (workspaceId: string | null) => {
      if (!workspaceId) {
        return
      }
      if (workspaceId !== presentedWorkspaceIdRef.current) {
        return
      }
      workspaceTerminalCacheRef.current[workspaceId] = {
        stationTerminals: { ...stationTerminalsRef.current },
        outputCache: { ...stationTerminalOutputCacheRef.current },
        outputRevision: { ...stationTerminalOutputRevisionRef.current },
        restoreState: { ...stationTerminalRestoreStateRef.current },
        sessionStation: { ...sessionStationRef.current },
        sessionSeq: { ...terminalSessionSeqRef.current },
        sessionVisibility: { ...terminalSessionVisibilityRef.current },
      }
    },
    [],
  )

  const resolveWorkspaceTerminalDocument = useCallback(
    (workspaceId: string | null, stationsForWorkspace: AgentStation[]) => {
      if (!workspaceId) {
        return createWorkspaceTerminalSessionDocument(stationsForWorkspace)
      }
      const hydrated = hydrateWorkspaceTerminalSessionDocument(
        workspaceTerminalCacheRef.current[workspaceId],
        stationsForWorkspace,
      )
      workspaceTerminalCacheRef.current[workspaceId] = hydrated
      return hydrated
    },
    [],
  )

  const persistActiveWorkspaceTerminalDocument = useCallback(() => {
    captureActiveWorkspaceTerminalDocument(presentedWorkspaceIdRef.current)
  }, [captureActiveWorkspaceTerminalDocument])

  const suspendWorkspaceTerminalSessions = useCallback(
    (workspaceId: string | null) => {
      if (!workspaceId) {
        return
      }
      captureActiveWorkspaceTerminalDocument(workspaceId)
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const document = workspaceTerminalCacheRef.current[workspaceId]
      if (!document) {
        return
      }
      const sessionIds = setWorkspaceTerminalSessionVisibility(document, false)
      sessionIds.forEach((sessionId) => {
        void desktopApi
          .terminalSetVisibility(sessionId, false)
          .catch((error) => {
            const detail = describeError(error)
            if (!detail.includes('TERMINAL_SESSION_NOT_FOUND')) {
              return
            }
            const stationId = removeWorkspaceTerminalSessionBinding(document, sessionId, 'exited')
            if (stationId) {
              void desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {
                // Runtime sync will be refreshed when the workspace is presented again.
              })
            }
          })
      })
    },
    [captureActiveWorkspaceTerminalDocument],
  )

  // ── Output streaming ──────────────────────────────────────────────────
  const appendStationTerminalOutput = useMemo(
    () => (stationId: string, chunk: string) => {
      stationTerminalOutputCacheRef.current[stationId] = appendDetachedTerminalOutput(
        stationTerminalOutputCacheRef.current[stationId],
        chunk,
      )
      stationTerminalOutputRevisionRef.current[stationId] =
        (stationTerminalOutputRevisionRef.current[stationId] ?? 0) + 1
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      pushStationTerminalDebugRecord(stationId, {
        sessionId,
        lane: 'xterm',
        kind: 'write',
        source: 'append',
        summary: formatTerminalDebugPreview(chunk, 84),
        body: chunk,
      })
      const pendingReplay = stationTerminalPendingReplayRef.current[stationId]
      if (pendingReplay) {
        pendingReplay.ops.push({ kind: 'write', chunk })
      } else {
        void stationTerminalSinkRef.current[stationId]?.write(chunk)
      }
      persistActiveWorkspaceTerminalDocument()
      publishDetachedOutputAppend(stationId, chunk)
    },
    [persistActiveWorkspaceTerminalDocument, publishDetachedOutputAppend, pushStationTerminalDebugRecord],
  )

  const resetStationTerminalOutput = useMemo(
    () => (stationId: string, content?: string) => {
      const station = stationsRef.current.find((item) => item.id === stationId)
      const fallback = getStationIdleBanner(station)
      const nextContentRaw = content ?? fallback
      const nextContent =
        nextContentRaw.length > DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS
          ? nextContentRaw.slice(nextContentRaw.length - DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS)
          : nextContentRaw
      stationTerminalOutputCacheRef.current[stationId] = nextContent
      stationTerminalOutputRevisionRef.current[stationId] =
        (stationTerminalOutputRevisionRef.current[stationId] ?? 0) + 1
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      pushStationTerminalDebugRecord(stationId, {
        sessionId,
        lane: 'xterm',
        kind: 'reset',
        source: content == null ? 'fallback' : 'explicit',
        summary: formatTerminalDebugPreview(nextContent, 84),
        body: nextContent,
      })
      const pendingReplay = stationTerminalPendingReplayRef.current[stationId]
      if (pendingReplay) {
        pendingReplay.ops.push({ kind: 'reset', content: nextContent })
      } else {
        void stationTerminalSinkRef.current[stationId]?.reset(nextContent)
      }
      persistActiveWorkspaceTerminalDocument()
      publishDetachedOutputReset(stationId, nextContent)
    },
    [persistActiveWorkspaceTerminalDocument, publishDetachedOutputReset, pushStationTerminalDebugRecord],
  )

  const setStationTerminalState = useMemo(
    () => (stationId: string, patch: Partial<StationTerminalRuntime>) => {
      const projectionPatch = stripDetachedTerminalRuntimeProjectionPatch(patch)
      setStationTerminals((prev) => {
        const current = prev[stationId] ?? {
          sessionId: null,
          stateRaw: 'idle',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        }
        const nextRuntime = {
          ...current,
          ...patch,
        }
        if ((current.sessionId ?? null) !== (nextRuntime.sessionId ?? null)) {
          delete stationTerminalRestoreStateRef.current[stationId]
        }
        const next = {
          ...prev,
          [stationId]: nextRuntime,
        }
        stationTerminalsRef.current = next
        return {
          ...next,
        }
      })
      persistActiveWorkspaceTerminalDocument()
      if (projectionPatch) {
        publishDetachedRuntimePatch(stationId, projectionPatch)
      }
    },
    [persistActiveWorkspaceTerminalDocument, publishDetachedRuntimePatch],
  )

  // ── Unread tracking ───────────────────────────────────────────────────
  const clearStationUnread = useMemo(
    () => (stationId: string) => {
      delete stationUnreadDeltaRef.current[stationId]
      setStationTerminals((prev) => {
        const current = prev[stationId]
        if (!current || current.unreadCount === 0) {
          return prev
        }
        const next = {
          ...prev,
          [stationId]: {
            ...current,
            unreadCount: 0,
          },
        }
        stationTerminalsRef.current = next
        return next
      })
      persistActiveWorkspaceTerminalDocument()
    },
    [persistActiveWorkspaceTerminalDocument],
  )

  const flushStationUnreadDeltas = useMemo(
    () => () => {
      const pending = stationUnreadDeltaRef.current
      stationUnreadDeltaRef.current = {}
      stationUnreadFlushTimerRef.current = null
      const entries = Object.entries(pending).filter(([, delta]) => delta > 0)
      if (entries.length === 0) {
        return
      }
      setStationTerminals((prev) => {
        let changed = false
        const next = { ...prev }
        entries.forEach(([stationId, delta]) => {
          const current = next[stationId]
          if (!current) {
            return
          }
          const unreadCount = Math.min(999, current.unreadCount + delta)
          if (unreadCount === current.unreadCount) {
            return
          }
          next[stationId] = {
            ...current,
            unreadCount,
          }
          changed = true
        })
        if (changed) {
          stationTerminalsRef.current = next
        }
        return changed ? next : prev
      })
      persistActiveWorkspaceTerminalDocument()
    },
    [persistActiveWorkspaceTerminalDocument],
  )

  const incrementStationUnread = useMemo(
    () => (stationId: string, delta: number) => {
      if (delta <= 0) {
        return
      }
      const pending = stationUnreadDeltaRef.current
      pending[stationId] = Math.min(999, (pending[stationId] ?? 0) + delta)
      if (typeof stationUnreadFlushTimerRef.current === 'number') {
        return
      }
      stationUnreadFlushTimerRef.current = window.setTimeout(flushStationUnreadDeltas, 84)
    },
    [flushStationUnreadDeltas],
  )

  // ── Sink binding ───────────────────────────────────────────────────────
  const bindStationTerminalSink = useMemo<StationTerminalSinkBindingHandler>(
    () => (stationId, sink, meta) => {
      if (!sink) {
        if (meta?.sourceSink && stationTerminalSinkRef.current[stationId] !== meta.sourceSink) {
          return
        }
        delete stationTerminalPendingReplayRef.current[stationId]
        const capturedRestoreState = meta?.restoreState
          ? captureMatchingSessionOwnedRestoreState(
              stationTerminalsRef.current[stationId],
              meta.sourceSessionId,
              {
                content: meta.restoreState,
                cols: meta.restoreCols ?? 0,
                rows: meta.restoreRows ?? 0,
              },
              stationTerminalOutputRevisionRef.current[stationId] ?? 0,
            )
          : null
        if (capturedRestoreState) {
          stationTerminalRestoreStateRef.current[stationId] = capturedRestoreState
        } else {
          delete stationTerminalRestoreStateRef.current[stationId]
        }
        delete stationTerminalSinkRef.current[stationId]
        return
      }
      stationTerminalSinkRef.current[stationId] = sink
      const station = stationsRef.current.find((item) => item.id === stationId)
      const cachedContent = stationTerminalOutputCacheRef.current[stationId] ?? getStationIdleBanner(station)
      const outputRevision = stationTerminalOutputRevisionRef.current[stationId] ?? 0
      const restoreState = retainSessionOwnedRestoreState(
        stationTerminalRestoreStateRef.current[stationId],
        stationTerminalsRef.current[stationId]?.sessionId ?? null,
      )
      const replayVersion = (stationTerminalPendingReplayRef.current[stationId]?.version ?? 0) + 1
      stationTerminalPendingReplayRef.current[stationId] = {
        version: replayVersion,
        ops: [],
      }
      const replay = shouldPreferSessionOwnedRestoreState(
        restoreState,
        stationTerminalsRef.current[stationId]?.sessionId ?? null,
        outputRevision,
      )
        ? sink.restore(restoreState.state.content, restoreState.state.cols, restoreState.state.rows)
        : sink.reset(cachedContent)
      if (shouldPreferSessionOwnedRestoreState(
        restoreState,
        stationTerminalsRef.current[stationId]?.sessionId ?? null,
        outputRevision,
      )) {
        pushStationTerminalDebugRecord(stationId, {
          sessionId: stationTerminalsRef.current[stationId]?.sessionId ?? null,
          lane: 'xterm',
          kind: 'restore',
          source: 'session_restore',
          summary: formatTerminalDebugPreview(restoreState.state.content, 84),
          body: restoreState.state.content,
        })
      } else {
        delete stationTerminalRestoreStateRef.current[stationId]
      }
      void replay.finally(() => {
        const pendingReplay = stationTerminalPendingReplayRef.current[stationId]
        if (
          !pendingReplay ||
          pendingReplay.version !== replayVersion ||
          stationTerminalSinkRef.current[stationId] !== sink
        ) {
          return
        }
        const pendingOps = pendingReplay.ops.slice()
        delete stationTerminalPendingReplayRef.current[stationId]
        void pendingOps.reduce<Promise<void>>((chain, op) => {
          return chain.then(() => {
            if (stationTerminalSinkRef.current[stationId] !== sink) {
              return
            }
            if (op.kind === 'reset') {
              return sink.reset(op.content)
            }
            return sink.write(op.chunk)
          })
        }, Promise.resolve())
      })
    },
    [pushStationTerminalDebugRecord],
  )

  // ── Session visibility ────────────────────────────────────────────────
  const ensureTerminalSessionVisible = useCallback((sessionId: string) => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (terminalSessionVisibilityRef.current[sessionId]) {
      return
    }
    void desktopApi
      .terminalSetVisibility(sessionId, true)
      .then(() => {
        terminalSessionVisibilityRef.current[sessionId] = true
      })
      .catch(() => {
        // Ignore transient sync failure; next render cycle will retry.
      })
  }, [])

  const decodeBase64Chunk = useMemo(
    () => (sessionId: string, base64Chunk: string, stream: boolean): string => {
      const decoder =
        terminalChunkDecoderBySessionRef.current[sessionId] ??
        (terminalChunkDecoderBySessionRef.current[sessionId] = createTerminalChunkDecoder())
      return decodeTerminalBase64Chunk(decoder, base64Chunk, stream)
    },
    [],
  )

  const cleanupMissingWorkspaceTerminalSession = useCallback(
    (workspaceId: string, stationId: string, sessionId: string) => {
      const document = workspaceTerminalCacheRef.current[workspaceId]
      if (document) {
        removeWorkspaceTerminalSessionBinding(document, sessionId, 'exited')
      }
      if (sessionStationRef.current[sessionId] === stationId) {
        delete sessionStationRef.current[sessionId]
        delete terminalSessionSeqRef.current[sessionId]
        delete terminalOutputQueueRef.current[sessionId]
        delete terminalSessionVisibilityRef.current[sessionId]
        delete terminalChunkDecoderBySessionRef.current[sessionId]
      }
      if (stationTerminalsRef.current[stationId]?.sessionId === sessionId) {
        setStationTerminalState(stationId, {
          sessionId: null,
          stateRaw: 'exited',
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        })
      }
      void desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {
        // The next live registration pass will reconcile this if the session still exists.
      })
    },
    [setStationTerminalState],
  )

  const recoverStationTerminalOutput = useCallback(
    async (workspaceId: string, stationId: string, sessionId: string): Promise<boolean> => {
      if (!desktopApi.isTauriRuntime()) {
        return false
      }
      if (activeWorkspaceIdRef.current !== workspaceId) {
        return false
      }
      if (sessionStationRef.current[sessionId] !== stationId) {
        return false
      }

      const previousSeq = terminalSessionSeqRef.current[sessionId] ?? 0
      try {
        const delta = await desktopApi.terminalReadDelta(sessionId, previousSeq)
        if (activeWorkspaceIdRef.current !== workspaceId || sessionStationRef.current[sessionId] !== stationId) {
          return false
        }
        if (delta.gap || delta.truncated) {
          const snapshot = await desktopApi.terminalReadSnapshot(sessionId).catch(() => null)
          if (!snapshot) {
            return true
          }
          if (activeWorkspaceIdRef.current !== workspaceId || sessionStationRef.current[sessionId] !== stationId) {
            return false
          }
          const decoder =
            terminalChunkDecoderBySessionRef.current[sessionId] ??
            (terminalChunkDecoderBySessionRef.current[sessionId] = createTerminalChunkDecoder())
          resetTerminalChunkDecoder(decoder)
          const snapshotText = decodeTerminalBase64Chunk(decoder, snapshot.chunk, false)
          if (snapshotText) {
            resetStationTerminalOutput(stationId, snapshotText)
          }
          terminalSessionSeqRef.current[sessionId] = snapshot.currentSeq
          persistActiveWorkspaceTerminalDocument()
          return true
        }

        if (delta.toSeq > previousSeq) {
          const text = decodeBase64Chunk(sessionId, delta.chunk, true)
          if (text) {
            appendStationTerminalOutput(stationId, text)
          }
          terminalSessionSeqRef.current[sessionId] = delta.toSeq
          persistActiveWorkspaceTerminalDocument()
        }
        return true
      } catch (error) {
        const detail = describeError(error)
        if (detail.includes('TERMINAL_SESSION_NOT_FOUND')) {
          cleanupMissingWorkspaceTerminalSession(workspaceId, stationId, sessionId)
        }
        return false
      }
    },
    [
      appendStationTerminalOutput,
      cleanupMissingWorkspaceTerminalSession,
      decodeBase64Chunk,
      persistActiveWorkspaceTerminalDocument,
      resetStationTerminalOutput,
    ],
  )

  const recoverWorkspaceTerminalSessions = useCallback(
    (workspaceId: string | null) => {
      if (!workspaceId || !desktopApi.isTauriRuntime()) {
        return
      }
      const entries = Object.entries(sessionStationRef.current)
      entries.forEach(([sessionId, stationId]) => {
        void (async () => {
          const recoveredWhileHidden = await recoverStationTerminalOutput(workspaceId, stationId, sessionId)
          if (!recoveredWhileHidden) {
            return
          }
          try {
            await desktopApi.terminalSetVisibility(sessionId, true)
            if (activeWorkspaceIdRef.current !== workspaceId || sessionStationRef.current[sessionId] !== stationId) {
              return
            }
            terminalSessionVisibilityRef.current[sessionId] = true
            const document = workspaceTerminalCacheRef.current[workspaceId]
            if (document) {
              document.sessionVisibility[sessionId] = true
            }
          } catch (error) {
            const detail = describeError(error)
            if (detail.includes('TERMINAL_SESSION_NOT_FOUND')) {
              cleanupMissingWorkspaceTerminalSession(workspaceId, stationId, sessionId)
            }
            return
          }
          await recoverStationTerminalOutput(workspaceId, stationId, sessionId)
        })()
      })
    },
    [cleanupMissingWorkspaceTerminalSession, recoverStationTerminalOutput],
  )

  const cacheBackgroundLaunchedTerminalSession = useCallback(
    (input: {
      workspaceId: string
      station: AgentStation
      sessionId: string
      shell: string | null
      cwdMode: 'workspace_root' | 'custom'
      resolvedCwd: string | null
      submitSequence?: string | null
    }) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const sessionId = input.sessionId.trim()
      if (!sessionId) {
        return
      }
      const document =
        workspaceTerminalCacheRef.current[input.workspaceId] ??
        createWorkspaceTerminalSessionDocument([input.station])
      workspaceTerminalCacheRef.current[input.workspaceId] = document

      const currentRuntime = document.stationTerminals[input.station.id] ?? {
        sessionId: null,
        stateRaw: 'idle',
        unreadCount: 0,
        shell: null,
        cwdMode: 'workspace_root' as const,
        resolvedCwd: null,
      }
      const previousSessionId = currentRuntime.sessionId
      if (previousSessionId && previousSessionId !== sessionId) {
        removeWorkspaceTerminalSessionBinding(document, previousSessionId, 'killed')
        void desktopApi.terminalKill(previousSessionId, 'TERM').catch(() => {
          // Superseded background launches should not leave duplicate station sessions.
        })
      }

      document.stationTerminals[input.station.id] = {
        ...currentRuntime,
        sessionId,
        stateRaw: 'running',
        unreadCount: currentRuntime.sessionId === sessionId ? currentRuntime.unreadCount : 0,
        shell: input.shell,
        cwdMode: input.cwdMode,
        resolvedCwd: input.resolvedCwd,
      }
      document.sessionStation[sessionId] = input.station.id
      document.sessionSeq[sessionId] = document.sessionSeq[sessionId] ?? 0
      document.sessionVisibility[sessionId] = false
      delete document.restoreState[input.station.id]
      document.outputCache[input.station.id] =
        document.outputCache[input.station.id] ??
        `${t(locale, 'system.terminalLaunched')}${t(locale, 'system.terminalSessionInfo', {
          sessionId,
          cwd: input.resolvedCwd ?? input.station.agentWorkdirRel,
        })}`
      document.outputRevision[input.station.id] = (document.outputRevision[input.station.id] ?? 0) + 1

      void desktopApi
        .terminalSetVisibility(sessionId, false)
        .catch((error) => {
          const detail = describeError(error)
          if (detail.includes('TERMINAL_SESSION_NOT_FOUND')) {
            removeWorkspaceTerminalSessionBinding(document, sessionId, 'exited')
          }
        })
      void desktopApi
        .agentRuntimeRegister({
          workspaceId: input.workspaceId,
          agentId: input.station.id,
          stationId: input.station.id,
          roleKey: input.station.role,
          sessionId,
          toolKind: normalizeStationToolKind(input.station.tool),
          resolvedCwd: input.resolvedCwd,
          submitSequence: input.submitSequence ?? null,
          online: true,
        })
        .catch(() => {
          // The runtime will be registered again when the workspace is presented.
        })
    },
    [locale],
  )

  // ── Terminal event subscription ────────────────────────────────────────
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null
    void desktopApi
      .subscribeTerminalEvents({
        onOutput: (payload: TerminalOutputPayload) => {
          const previous = terminalOutputQueueRef.current[payload.sessionId] ?? Promise.resolve()
          terminalOutputQueueRef.current[payload.sessionId] = previous
            .catch(() => undefined)
            .then(async () => {
              if (disposed) {
                return
              }
              const stationId = sessionStationRef.current[payload.sessionId]
              if (!stationId) {
                const owner = findWorkspaceTerminalSessionOwner(
                  workspaceTerminalCacheRef.current,
                  payload.sessionId,
                )
                if (!owner) {
                  return
                }
                const seq = owner.document.sessionSeq[payload.sessionId] ?? 0
                if (payload.seq <= seq) {
                  return
                }
                const directText = decodeBase64Chunk(payload.sessionId, payload.chunk, true)
                if (directText) {
                  owner.document.outputCache[owner.stationId] = appendDetachedTerminalOutput(
                    owner.document.outputCache[owner.stationId],
                    directText,
                  )
                  owner.document.outputRevision[owner.stationId] =
                    (owner.document.outputRevision[owner.stationId] ?? 0) + 1
                }
                owner.document.sessionSeq[payload.sessionId] = payload.seq
                const runtime = owner.document.stationTerminals[owner.stationId]
                if (runtime) {
                  owner.document.stationTerminals[owner.stationId] = {
                    ...runtime,
                    unreadCount: Math.min(999, runtime.unreadCount + 1),
                  }
                }
                return
              }
              const directText = decodeBase64Chunk(payload.sessionId, payload.chunk, true)
              pushStationTerminalDebugRecord(stationId, {
                atMs: payload.tsMs,
                sessionId: payload.sessionId,
                lane: 'event',
                kind: 'output',
                source: 'terminal/output',
                summary: `seq ${payload.seq} · ${formatTerminalDebugPreview(directText || payload.chunk, 72)}`,
                body: [
                  `seq=${payload.seq}`,
                  `tsMs=${payload.tsMs}`,
                  `base64=${payload.chunk}`,
                  '',
                  'decoded:',
                  directText,
                ].join('\n'),
              })
              const unread = stationId !== activeStationId
              const seq = terminalSessionSeqRef.current[payload.sessionId] ?? 0
              if (payload.seq <= seq) {
                return
              }
              if (payload.seq === seq + 1) {
                const text = directText
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSessionSeqRef.current[payload.sessionId] = payload.seq
                persistActiveWorkspaceTerminalDocument()
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const delta = await desktopApi
                .terminalReadDelta(payload.sessionId, seq)
                .catch(() => null)
              if (
                delta &&
                !delta.gap &&
                !delta.truncated &&
                delta.fromSeq === seq + 1 &&
                delta.toSeq >= payload.seq
              ) {
                if (
                  !shouldApplyRecoveredStationOutput(
                    stationTerminalsRef.current[stationId],
                    payload.sessionId,
                  )
                ) {
                  return
                }
                const text = decodeBase64Chunk(payload.sessionId, delta.chunk, true)
                pushStationTerminalDebugRecord(stationId, {
                  sessionId: payload.sessionId,
                  lane: 'recovery',
                  kind: 'delta',
                  source: 'terminal_read_delta',
                  summary: `delta ${delta.fromSeq ?? '?'}-${delta.toSeq} · ${formatTerminalDebugPreview(text || delta.chunk, 72)}`,
                  body: [
                    `afterSeq=${delta.afterSeq}`,
                    `fromSeq=${delta.fromSeq ?? 'null'}`,
                    `toSeq=${delta.toSeq}`,
                    `currentSeq=${delta.currentSeq}`,
                    `gap=${delta.gap}`,
                    `truncated=${delta.truncated}`,
                    `base64=${delta.chunk}`,
                    '',
                    'decoded:',
                    text,
                  ].join('\n'),
                })
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSessionSeqRef.current[payload.sessionId] = delta.toSeq
                persistActiveWorkspaceTerminalDocument()
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const snapshot = await desktopApi.terminalReadSnapshot(payload.sessionId).catch(() => null)
              if (!snapshot) {
                return
              }
              if (
                !shouldApplyRecoveredStationOutput(
                  stationTerminalsRef.current[stationId],
                  payload.sessionId,
                )
              ) {
                return
              }
              const decoder =
                terminalChunkDecoderBySessionRef.current[payload.sessionId] ??
                (terminalChunkDecoderBySessionRef.current[payload.sessionId] = createTerminalChunkDecoder())
              resetTerminalChunkDecoder(decoder)
              const snapshotText = decodeTerminalBase64Chunk(decoder, snapshot.chunk, false)
              pushStationTerminalDebugRecord(stationId, {
                sessionId: payload.sessionId,
                lane: 'recovery',
                kind: 'snapshot',
                source: 'terminal_read_snapshot',
                summary: `snapshot @${snapshot.currentSeq} · ${formatTerminalDebugPreview(snapshotText || snapshot.chunk, 72)}`,
                body: [
                  `currentSeq=${snapshot.currentSeq}`,
                  `bytes=${snapshot.bytes}`,
                  `maxBytes=${snapshot.maxBytes}`,
                  `truncated=${snapshot.truncated}`,
                  `base64=${snapshot.chunk}`,
                  '',
                  'decoded:',
                  snapshotText,
                ].join('\n'),
              })
              resetStationTerminalOutput(stationId, snapshotText)
              terminalSessionSeqRef.current[payload.sessionId] = snapshot.currentSeq
              persistActiveWorkspaceTerminalDocument()
              if (unread) {
                incrementStationUnread(stationId, 1)
              }
            })
        },
        onStateChanged: (payload: TerminalStatePayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
            const owner = findWorkspaceTerminalSessionOwner(
              workspaceTerminalCacheRef.current,
              payload.sessionId,
            )
            if (!owner) {
              return
            }
            const runtime = owner.document.stationTerminals[owner.stationId]
            if (runtime) {
              owner.document.stationTerminals[owner.stationId] = {
                ...runtime,
                stateRaw: payload.to,
              }
            }
            if (payload.to !== 'running') {
              owner.document.outputCache[owner.stationId] = appendDetachedTerminalOutput(
                owner.document.outputCache[owner.stationId],
                `\n[terminal:${payload.to}]\n`,
              )
              owner.document.outputRevision[owner.stationId] =
                (owner.document.outputRevision[owner.stationId] ?? 0) + 1
            }
            if (payload.to === 'exited' || payload.to === 'killed' || payload.to === 'failed') {
              removeWorkspaceTerminalSessionBinding(
                owner.document,
                payload.sessionId,
                payload.to as 'exited' | 'killed' | 'failed',
              )
              delete terminalOutputQueueRef.current[payload.sessionId]
              delete terminalChunkDecoderBySessionRef.current[payload.sessionId]
              void desktopApi
                .agentRuntimeUnregister(owner.workspaceId, owner.stationId)
                .catch(() => {
                  // Runtime sync will retry when the workspace is presented again.
                })
            }
            return
          }
          pushStationTerminalDebugRecord(stationId, {
            atMs: payload.tsMs,
            sessionId: payload.sessionId,
            lane: 'event',
            kind: 'state',
            source: 'terminal/state_changed',
            summary: `${payload.from} -> ${payload.to}`,
            body: [`from=${payload.from}`, `to=${payload.to}`, `tsMs=${payload.tsMs}`].join('\n'),
          })
          const nextClosedRuntime =
            payload.to === 'exited' || payload.to === 'killed' || payload.to === 'failed'
              ? buildClosedStationTerminalRuntime(
                  stationTerminalsRef.current[stationId],
                  payload.sessionId,
                  payload.to,
                )
              : null
          const closedSessionCleanup =
            payload.to === 'exited' || payload.to === 'killed' || payload.to === 'failed'
              ? resolveClosedStationSessionCleanup(
                  stationTerminalsRef.current[stationId],
                  payload.sessionId,
                )
              : null
          const closedRuntimeRegistrationCleanup =
            payload.to === 'exited' || payload.to === 'killed' || payload.to === 'failed'
              ? resolveClosedStationRuntimeRegistrationCleanup(
                  registeredAgentRuntimeRef.current[stationId]
                    ? {
                        workspaceId: registeredAgentRuntimeRef.current[stationId].workspaceId,
                        sessionId: registeredAgentRuntimeRef.current[stationId].sessionId,
                      }
                    : null,
                  payload.sessionId,
                )
              : null
          if (nextClosedRuntime) {
            setStationTerminalState(stationId, nextClosedRuntime)
          } else if (payload.to !== 'exited' && payload.to !== 'killed' && payload.to !== 'failed') {
            setStationTerminalState(stationId, { stateRaw: payload.to })
          }
          if (payload.to !== 'running') {
            appendStationTerminalOutput(stationId, `\n[terminal:${payload.to}]\n`)
          }
          if (payload.to === 'exited' || payload.to === 'killed' || payload.to === 'failed') {
            delete terminalSessionSeqRef.current[payload.sessionId]
            delete terminalOutputQueueRef.current[payload.sessionId]
            delete sessionStationRef.current[payload.sessionId]
            delete terminalSessionVisibilityRef.current[payload.sessionId]
            delete terminalChunkDecoderBySessionRef.current[payload.sessionId]
            if (closedSessionCleanup) {
              stationTerminalInputControllerRef.current?.clear(stationId)
              delete stationSubmitSequenceRef.current[stationId]
            }
            if (closedRuntimeRegistrationCleanup) {
              void desktopApi
                .agentRuntimeUnregister(closedRuntimeRegistrationCleanup.workspaceId, stationId)
                .catch(() => {
                  // Runtime sync effect will retry from the current station ownership.
                })
            }
          }
          persistActiveWorkspaceTerminalDocument()
        },
        onMeta: (payload: TerminalMetaPayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
            const owner = findWorkspaceTerminalSessionOwner(
              workspaceTerminalCacheRef.current,
              payload.sessionId,
            )
            const runtime = owner?.document.stationTerminals[owner.stationId]
            if (owner && runtime) {
              const delta = Math.max(1, Math.min(99, payload.unreadChunks || 1))
              owner.document.stationTerminals[owner.stationId] = {
                ...runtime,
                unreadCount: Math.min(999, runtime.unreadCount + delta),
              }
            }
            return
          }
          const tail = decodeBase64Chunk(payload.sessionId, payload.tailChunk, true)
          pushStationTerminalDebugRecord(stationId, {
            atMs: payload.tsMs,
            sessionId: payload.sessionId,
            lane: 'event',
            kind: 'meta',
            source: 'terminal/meta',
            summary: `chunks ${payload.unreadChunks} · ${formatTerminalDebugPreview(tail || payload.tailChunk, 72)}`,
            body: [
              `unreadBytes=${payload.unreadBytes}`,
              `unreadChunks=${payload.unreadChunks}`,
              `tsMs=${payload.tsMs}`,
              `base64=${payload.tailChunk}`,
              '',
              'decoded:',
              tail,
            ].join('\n'),
          })
          if (tail) {
            appendStationTerminalOutput(stationId, tail)
          }
          if (stationId !== activeStationId) {
            const delta = Math.max(1, Math.min(99, payload.unreadChunks || 1))
            incrementStationUnread(stationId, delta)
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
      if (cleanup) {
        cleanup()
      }
    }
  }, [
    activeStationId,
    appendStationTerminalOutput,
    decodeBase64Chunk,
    incrementStationUnread,
    persistActiveWorkspaceTerminalDocument,
    pushStationTerminalDebugRecord,
    resetStationTerminalOutput,
    setStationTerminalState,
  ])

  // ── Agent runtime registration sync ───────────────────────────────────
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      registeredAgentRuntimeRef.current = {}
      return
    }
    const previous = registeredAgentRuntimeRef.current
    const desired: Record<
      string,
      { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }
    > = {}
    const presentedWorkspaceId = presentedWorkspaceIdRef.current

    if (presentedWorkspaceId) {
      stations.forEach((station) => {
        const sessionId = stationTerminals[station.id]?.sessionId ?? null
        if (!sessionId) {
          return
        }
        desired[station.id] = {
          workspaceId: presentedWorkspaceId,
          sessionId,
          toolKind: normalizeStationToolKind(station.tool),
          resolvedCwd: stationTerminals[station.id]?.resolvedCwd ?? null,
        }
      })
    }

    Object.entries(previous).forEach(([agentId, runtime]) => {
      const next = desired[agentId]
      if (
        next &&
        next.workspaceId === runtime.workspaceId &&
        next.sessionId === runtime.sessionId &&
        next.toolKind === runtime.toolKind &&
        next.resolvedCwd === runtime.resolvedCwd
      ) {
        return
      }
      if (runtime.workspaceId !== presentedWorkspaceId) {
        return
      }
      void desktopApi
        .agentRuntimeUnregister(runtime.workspaceId, agentId)
        .catch(() => {
          // Keep sync loop resilient during transient runtime teardown.
        })
    })

    Object.entries(desired).forEach(([agentId, runtime]) => {
      const prev = previous[agentId]
      if (
        prev &&
        prev.workspaceId === runtime.workspaceId &&
        prev.sessionId === runtime.sessionId &&
        prev.toolKind === runtime.toolKind &&
        prev.resolvedCwd === runtime.resolvedCwd
      ) {
        return
      }
      const stationRole =
        stationsRef.current.find((station) => station.id === agentId)?.role ?? null
      const submitSequence = stationSubmitSequenceRef.current[agentId] ?? null
      void desktopApi
        .agentRuntimeRegister({
          workspaceId: runtime.workspaceId,
          agentId,
          stationId: agentId,
          roleKey: stationRole,
          sessionId: runtime.sessionId,
          toolKind: runtime.toolKind as AgentRuntimeRegisterRequest['toolKind'],
          resolvedCwd: runtime.resolvedCwd,
          submitSequence,
          online: true,
        })
        .catch(() => {
          // Ignore sync retry failures; next render cycle will retry.
        })
    })

    registeredAgentRuntimeRef.current = desired
  }, [activeWorkspaceId, stations, stationTerminals])

  // ── Process snapshot polling ──────────────────────────────────────────
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      setStationProcessSnapshots({})
      return
    }

    let cancelled = false

    const refresh = async () => {
      const liveStations = stationsRef.current
        .map((station) => ({
          stationId: station.id,
          sessionId: stationTerminalsRef.current[station.id]?.sessionId ?? null,
        }))
        .filter((item): item is { stationId: string; sessionId: string } => Boolean(item.sessionId))
      const polledStations = windowPerformancePolicy.shouldPollAllLiveStationProcesses
        ? liveStations
        : liveStations.filter(({ stationId }) => stationId === activeStationId)

      if (polledStations.length === 0) {
        if (!cancelled) {
          setStationProcessSnapshots({})
        }
        return
      }

      const entries = await Promise.all(
        polledStations.map(async ({ stationId, sessionId }) => {
          try {
            const snapshot = await desktopApi.terminalDescribeProcesses(sessionId)
            if (stationTerminalsRef.current[stationId]?.sessionId !== sessionId) {
              return [stationId, null] as const
            }
            return [stationId, snapshot] as const
          } catch {
            return [stationId, stationProcessSnapshotsRef.current[stationId] ?? null] as const
          }
        }),
      )

      if (cancelled) {
        return
      }

      const next = Object.fromEntries(
        entries.filter((entry): entry is [string, TerminalDescribeProcessesResponse] => Boolean(entry[1])),
      )
      setStationProcessSnapshots((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length === nextKeys.length) {
          const unchanged = nextKeys.every((stationId) => {
            const prevSnapshot = prev[stationId]
            const nextSnapshot = next[stationId]
            return (
              prevSnapshot?.sessionId === nextSnapshot?.sessionId &&
              prevSnapshot?.rootPid === nextSnapshot?.rootPid &&
              prevSnapshot?.currentProcess?.pid === nextSnapshot?.currentProcess?.pid &&
              prevSnapshot?.currentProcess?.args === nextSnapshot?.currentProcess?.args &&
              prevSnapshot?.processes.length === nextSnapshot?.processes.length &&
              prevSnapshot?.processes.every(
                (process, index) =>
                  process.pid === nextSnapshot?.processes[index]?.pid &&
                  process.args === nextSnapshot?.processes[index]?.args,
              )
            )
          })
          if (unchanged) {
            return prev
          }
        }
        return next
      })
    }

    void refresh()
    const timerId = window.setInterval(() => {
      void refresh()
    }, windowPerformancePolicy.stationProcessPollIntervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [
    activeWorkspaceId,
    activeStationId,
    stationTerminals,
    stations,
    windowPerformancePolicy.shouldPollAllLiveStationProcesses,
    windowPerformancePolicy.stationProcessPollIntervalMs,
  ])

  // ── Active station unread clear ────────────────────────────────────────
  useEffect(() => {
    if (!activeStationId) {
      return
    }
    clearStationUnread(activeStationId)
  }, [activeStationId, clearStationUnread])

  // ── Terminal session visibility ────────────────────────────────────────
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    const desiredVisibility: Record<string, boolean> = {}
    Object.keys(sessionStationRef.current).forEach((sessionId) => {
      // Keep every mapped terminal session visible. Active-only visibility caused
      // focus and cursor race conditions when switching between station terminals.
      desiredVisibility[sessionId] = true
    })

    Object.entries(desiredVisibility).forEach(([sessionId, visible]) => {
      if (!visible) {
        return
      }
      if (terminalSessionVisibilityRef.current[sessionId] === false) {
        return
      }
      if (terminalSessionVisibilityRef.current[sessionId]) {
        return
      }
      ensureTerminalSessionVisible(sessionId)
    })

    Object.keys(terminalSessionVisibilityRef.current).forEach((sessionId) => {
      if (desiredVisibility[sessionId] === undefined) {
        delete terminalSessionVisibilityRef.current[sessionId]
      }
    })
  }, [ensureTerminalSessionVisible, stationTerminals])

  // ── Input controller dispose ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      stationTerminalInputControllerRef.current?.dispose()
      stationTerminalInputControllerRef.current = null
    }
  }, [])

  // ── Resolve workspace root ─────────────────────────────────────────────
  const resolveWorkspaceRoot = useMemo(
    () => async (workspaceId: string): Promise<string | null> => {
      if (activeWorkspaceRoot) {
        return activeWorkspaceRoot
      }
      try {
        const context = await desktopApi.workspaceGetContext(workspaceId)
        return context.root
      } catch {
        return null
      }
    },
    [activeWorkspaceRoot],
  )

  // ── Ensure station terminal session ────────────────────────────────────
  const ensureStationTerminalSession = useMemo(
    () =>
      ensureSingleFlightStationSession({
        getExistingSessionId: (stationId) => stationTerminalsRef.current[stationId]?.sessionId,
        getInFlight: (stationId) => ensureStationTerminalSessionInFlightRef.current[stationId],
        setInFlight: (stationId, promise) => {
          ensureStationTerminalSessionInFlightRef.current[stationId] = promise
        },
        clearInFlight: (stationId, promise) => {
          if (ensureStationTerminalSessionInFlightRef.current[stationId] === promise) {
            delete ensureStationTerminalSessionInFlightRef.current[stationId]
          }
        },
        createSession: async (stationId: string): Promise<string | null> => {
          if (!activeWorkspaceId) {
            appendStationTerminalOutput(stationId, t(locale, 'system.bindWorkspace'))
            return null
          }
          if (!desktopApi.isTauriRuntime()) {
            appendStationTerminalOutput(stationId, t(locale, 'system.webPreviewNoPty'))
            return null
          }

          const launchWorkspaceId = activeWorkspaceId
          try {
            const station = stationsRef.current.find((item) => item.id === stationId)
            if (!station) {
              appendStationTerminalOutput(
                stationId,
                t(locale, 'system.launchFailed', {
                  detail: 'STATION_NOT_FOUND',
                }),
              )
              return null
            }
            const workspaceRoot = await resolveWorkspaceRoot(launchWorkspaceId)
            if (!workspaceRoot) {
              if (
                shouldApplyStationSessionLaunchFailure(
                  launchWorkspaceId,
                  activeWorkspaceIdRef.current,
                  stationsRef.current.some((item) => item.id === stationId),
                  stationTerminalsRef.current[stationId],
                )
              ) {
                appendStationTerminalOutput(
                  stationId,
                  t(locale, 'system.launchFailed', {
                    detail: 'WORKSPACE_CONTEXT_UNAVAILABLE',
                  }),
                )
              }
              return null
            }

            await desktopApi.fsWriteFile(
              launchWorkspaceId,
              buildAgentWorkspaceMarkerPath(station.agentWorkdirRel),
              '',
            )
            const agentWorkspaceCwd = resolveAgentWorkdirAbs(workspaceRoot, station.agentWorkdirRel)
            const terminalEnv = {
              GTO_WORKSPACE_ID: activeWorkspaceId,
              GTO_AGENT_ID: station.id,
              GTO_ROLE_KEY: station.role,
              GTO_STATION_ID: station.id,
            }
            const session = await desktopApi.terminalCreate(launchWorkspaceId, {
              cwd: agentWorkspaceCwd,
              cwdMode: 'custom',
              env: terminalEnv,
              agentToolKind: normalizeStationToolKind(station.tool),
            })
            if (
              !shouldApplyStationSessionResult(
                launchWorkspaceId,
                activeWorkspaceIdRef.current,
                stationsRef.current.some((item) => item.id === stationId),
                stationTerminalsRef.current[stationId],
              )
            ) {
              if (activeWorkspaceIdRef.current !== launchWorkspaceId) {
                cacheBackgroundLaunchedTerminalSession({
                  workspaceId: launchWorkspaceId,
                  station,
                  sessionId: session.sessionId,
                  shell: session.shell,
                  cwdMode: session.cwdMode,
                  resolvedCwd: session.resolvedCwd,
                })
                return null
              }
              const droppedSessionCleanup = resolveDroppedStationSessionCleanup(session.sessionId)
              if (droppedSessionCleanup) {
                void desktopApi.terminalKill(
                  droppedSessionCleanup.sessionId,
                  droppedSessionCleanup.signal,
                ).catch(() => {
                  // Dropped async station launches must not leave orphan backend sessions behind.
                })
              }
              return null
            }
            sessionStationRef.current[session.sessionId] = stationId
            terminalSessionSeqRef.current[session.sessionId] = 0
            terminalOutputQueueRef.current[session.sessionId] = Promise.resolve()
            delete stationTerminalRestoreStateRef.current[stationId]
            ensureTerminalSessionVisible(session.sessionId)
            const currentRuntime = stationTerminalsRef.current[stationId] ?? {
              sessionId: null,
              stateRaw: 'idle',
              unreadCount: 0,
              shell: null,
              cwdMode: 'workspace_root' as const,
              resolvedCwd: null,
            }
            stationTerminalsRef.current = {
              ...stationTerminalsRef.current,
              [stationId]: {
                ...currentRuntime,
                sessionId: session.sessionId,
                stateRaw: 'running',
                unreadCount: 0,
                shell: session.shell,
                cwdMode: session.cwdMode,
                resolvedCwd: session.resolvedCwd,
              },
            }
            resetStationTerminalOutput(
              stationId,
              `${t(locale, 'system.terminalLaunched')}${t(locale, 'system.terminalSessionInfo', {
                sessionId: session.sessionId,
                cwd: session.resolvedCwd,
              })}`,
            )
            setStationTerminalState(stationId, {
              sessionId: session.sessionId,
              stateRaw: 'running',
              unreadCount: 0,
              shell: session.shell,
              cwdMode: session.cwdMode,
              resolvedCwd: session.resolvedCwd,
            })
            return session.sessionId
          } catch (error) {
            if (
              shouldApplyStationSessionLaunchFailure(
                launchWorkspaceId,
                activeWorkspaceIdRef.current,
                stationsRef.current.some((item) => item.id === stationId),
                stationTerminalsRef.current[stationId],
              )
            ) {
              appendStationTerminalOutput(
                stationId,
                t(locale, 'system.launchFailed', {
                  detail: describeError(error),
                }),
              )
            }
            return null
          }
        },
      }),
    [
      activeWorkspaceId,
      appendStationTerminalOutput,
      cacheBackgroundLaunchedTerminalSession,
      ensureTerminalSessionVisible,
      locale,
      resetStationTerminalOutput,
      resolveWorkspaceRoot,
      setStationTerminalState,
    ],
  )

  const launchStationTerminal = useMemo(
    () => async (stationId: string) => {
      await ensureStationTerminalSession(stationId)
      stationTerminalSinkRef.current[stationId]?.focus()
    },
    [ensureStationTerminalSession],
  )

  // ── Send station terminal input ────────────────────────────────────────
  const sendStationTerminalInput = useMemo(
    () => (stationId: string, input: string) => {
      if (!stationTerminalInputControllerRef.current) {
        stationTerminalInputControllerRef.current = createBufferedStationInputController({
          flushDelayMs: STATION_INPUT_FLUSH_MS,
          maxBufferBytes: STATION_INPUT_MAX_BUFFER_BYTES,
          shouldFlushImmediately: shouldFlushStationInputImmediately,
          scheduleTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
          clearTimer: (timerId) => window.clearTimeout(timerId),
          sendInput: async (targetStationId, queuedInput) => {
            if (!desktopApi.isTauriRuntime()) {
              appendStationTerminalOutput(targetStationId, t(locale, 'system.webPreviewNoInput'))
              return
            }

            try {
              const sessionId = stationTerminalsRef.current[targetStationId]?.sessionId ?? null
              if (!sessionId || !shouldForwardStationTerminalInput(sessionId)) {
                return
              }
              await desktopApi.terminalWrite(sessionId, queuedInput)
            } catch (error) {
              appendStationTerminalOutput(
                targetStationId,
                t(locale, 'system.sendFailed', {
                  detail: describeError(error),
                }),
              )
            }
          },
        })
      }
      stationTerminalInputControllerRef.current.enqueue(stationId, input)
    },
    [appendStationTerminalOutput, ensureStationTerminalSession],
  )

  // ── Submit station terminal ────────────────────────────────────────────
  const submitStationTerminal = useCallback(async (stationId: string): Promise<boolean> => {
    for (let attempt = 0; attempt <= STATION_TASK_SUBMIT_MAX_RETRY_FRAMES; attempt += 1) {
      const submittedByTerminal = stationTerminalSinkRef.current[stationId]?.submit?.() ?? false
      if (submittedByTerminal) {
        return true
      }
      if (attempt >= STATION_TASK_SUBMIT_MAX_RETRY_FRAMES) {
        return false
      }
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          resolve()
        })
      })
    }
    return false
  }, [])

  // ── Write station terminal with submit ──────────────────────────────────
  const writeStationTerminalWithSubmit = useCallback(
    async (stationId: string, input: string): Promise<boolean> => {
      if (!input) {
        return submitStationTerminal(stationId)
      }
      if (!desktopApi.isTauriRuntime()) {
        return false
      }

      try {
        let sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
        if (!sessionId) {
          sessionId = await ensureStationTerminalSession(stationId)
          if (!sessionId) {
            return false
          }
        }
        await desktopApi.terminalWriteWithSubmit(
          sessionId,
          input,
          stationSubmitSequenceRef.current[stationId] ?? '\r',
        )
        return true
      } catch (error) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.sendFailed', {
            detail: describeError(error),
          }),
        )
        return false
      }
    },
    [appendStationTerminalOutput, ensureStationTerminalSession, locale, submitStationTerminal],
  )

  // ── Reset station terminal to agent workdir ────────────────────────────
  const resetStationTerminalToAgentWorkdir = useCallback(
    async (stationId: string): Promise<boolean> => {
      if (!desktopApi.isTauriRuntime()) {
        return false
      }

      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      const workspaceId = activeWorkspaceIdRef.current
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      if (!sessionId || !workspaceId || !station) {
        return false
      }

      const workspaceRoot = await resolveWorkspaceRoot(workspaceId)
      if (!workspaceRoot) {
        return false
      }

      const agentWorkspaceCwd = resolveAgentWorkdirAbs(workspaceRoot, station.agentWorkdirRel)
      const resetCommand = `cd "${agentWorkspaceCwd.replace(/"/g, '\\"')}"`

      try {
        await desktopApi.terminalWriteWithSubmit(
          sessionId,
          resetCommand,
          stationSubmitSequenceRef.current[stationId] ?? '\r',
        )
        return true
      } catch (error) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.sendFailed', {
            detail: describeError(error),
          }),
        )
        return false
      }
    },
    [appendStationTerminalOutput, locale, resolveWorkspaceRoot],
  )

  // ── Reconcile station runtime registration ──────────────────────────────
  const reconcileStationRuntimeRegistration = useCallback(
    async (input: { workspaceId: string; stationId: string; expectedSessionId: string | null }) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const currentStation = stationsRef.current.find((item) => item.id === input.stationId)
      const runtimeRegistrationCleanup = resolveStationRuntimeRegistrationCleanup(
        input.workspaceId,
        activeWorkspaceIdRef.current,
        Boolean(currentStation),
        input.expectedSessionId,
        stationTerminalsRef.current[input.stationId],
      )
      if (!runtimeRegistrationCleanup) {
        return
      }
      if (runtimeRegistrationCleanup.action === 'unregister') {
        await desktopApi.agentRuntimeUnregister(input.workspaceId, input.stationId)
        return
      }
      if (!currentStation) {
        await desktopApi.agentRuntimeUnregister(input.workspaceId, input.stationId)
        return
      }
      await desktopApi.agentRuntimeRegister({
        workspaceId: input.workspaceId,
        agentId: input.stationId,
        stationId: input.stationId,
        roleKey: currentStation.role,
        sessionId: runtimeRegistrationCleanup.sessionId,
        toolKind: normalizeStationToolKind(currentStation.tool),
        resolvedCwd: runtimeRegistrationCleanup.resolvedCwd,
        submitSequence: stationSubmitSequenceRef.current[input.stationId] ?? null,
        online: true,
      })
    },
    [],
  )

  // ── Handle station terminal input ──────────────────────────────────────
  const handleStationTerminalInput = useCallback(
    (stationId: string, data: string) => {
      const submitSequence = normalizeSubmitSequence(data)
      if (submitSequence) {
        stationSubmitSequenceRef.current[stationId] = submitSequence
        const workspaceId = activeWorkspaceIdRef.current
        const runtime = stationTerminalsRef.current[stationId]
        const sessionId = runtime?.sessionId ?? null
        const station = stationsRef.current.find((entry) => entry.id === stationId)
        const stationRole = station?.role ?? null
        if (workspaceId && sessionId) {
          void desktopApi
            .agentRuntimeRegister({
              workspaceId,
              agentId: stationId,
              stationId,
              roleKey: stationRole,
              sessionId,
              toolKind: normalizeStationToolKind(station?.tool),
              resolvedCwd: runtime?.resolvedCwd ?? null,
              submitSequence,
              online: true,
            })
            .then(() =>
              reconcileStationRuntimeRegistration({
                workspaceId,
                stationId,
                expectedSessionId: sessionId,
              }),
            )
            .catch(() => {
              // Best-effort runtime update; next periodic sync will retry.
            })
        }
      }
      sendStationTerminalInput(stationId, data)
    },
    [reconcileStationRuntimeRegistration, sendStationTerminalInput],
  )

  // ── Resize station terminal ────────────────────────────────────────────
  const resizeStationTerminal = useMemo(
    () => (stationId: string, cols: number, rows: number) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      if (!sessionId) {
        return
      }
      // Fire and forget - resize is best effort
      void desktopApi.terminalResize(sessionId, cols, rows).catch(() => {
        // Resize failures are non-critical
      })
    },
    [],
  )

  // ── Detached bridge helpers ─────────────────────────────────────────────
  const resolveDetachedBridgeContainer = useCallback(
    (sourceWindowLabel: string, containerId: string, stationId?: string | null) => {
      const container =
        workbenchContainersRef.current.find((candidate) => candidate.id === containerId && candidate.mode === 'detached') ??
        null
      if (!container) {
        return null
      }
      if (container.detachedWindowLabel && container.detachedWindowLabel !== sourceWindowLabel) {
        return null
      }
      if (stationId && !container.stationIds.includes(stationId)) {
        return null
      }
      return container
    },
    [],
  )

  const matchesDetachedBridgeSession = useCallback(
    (stationId: string, sessionId: string | null) =>
      shouldMatchDetachedBridgeSession(stationTerminalsRef.current[stationId]?.sessionId, sessionId),
    [],
  )

  const buildDetachedHydrateSnapshotMessage = useCallback(
    (targetWindowLabel: string, containerId: string): DetachedTerminalHydrateSnapshotMessage | null => {
      const container =
        workbenchContainersRef.current.find((candidate) => candidate.id === containerId && candidate.mode === 'detached') ??
        null
      const workspaceId = activeWorkspaceIdRef.current
      if (!container || !workspaceId) {
        return null
      }
      const runtimes = container.stationIds.reduce<Record<string, StationTerminalRuntime>>((acc, stationId) => {
        acc[stationId] = {
          ...createEmptyWorkbenchStationRuntime(),
          ...(stationTerminalsRef.current[stationId] ?? {}),
        }
        return acc
      }, {})
      const outputs = container.stationIds.reduce<Record<string, string>>((acc, stationId) => {
        const station = stationsRef.current.find((entry) => entry.id === stationId)
        acc[stationId] = stationTerminalOutputCacheRef.current[stationId] ?? getStationIdleBanner(station)
        return acc
      }, {})
      const projectionSeqByStation = container.stationIds.reduce<Record<string, number>>((acc, stationId) => {
        acc[stationId] = detachedProjectionSeqRef.current[`${targetWindowLabel}:${stationId}`] ?? 0
        return acc
      }, {})
      const restoreStates = container.stationIds.reduce<Record<string, StationTerminalRestoreStatePayload>>((acc, stationId) => {
        const state = retainSessionOwnedRestoreState(
          stationTerminalRestoreStateRef.current[stationId],
          stationTerminalsRef.current[stationId]?.sessionId ?? null,
        )
        if (state) {
          acc[stationId] = state.state
        }
        return acc
      }, {})
      return {
        kind: 'detached_terminal_hydrate_snapshot',
        workspaceId,
        containerId: container.id,
        activeStationId: container.activeStationId ?? container.stationIds[0] ?? null,
        runtimes,
        outputs,
        projectionSeqByStation,
        restoreStates,
      }
    },
    [],
  )

  const handleDetachedSurfaceBridgeMessage = useCallback(
    (event: SurfaceBridgeEventPayload<DetachedTerminalBridgeMessage>) => {
      const message = event.payload
      const sourceWindowLabel = event.sourceWindowLabel
      const activeWorkspaceId = activeWorkspaceIdRef.current
      if (!activeWorkspaceId) {
        return
      }
      if (message.workspaceId !== activeWorkspaceId) {
        return
      }
      switch (message.kind) {
        case 'detached_terminal_hydrate_request': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId)
          if (!container) {
            return
          }
          const snapshot = buildDetachedHydrateSnapshotMessage(sourceWindowLabel, container.id)
          if (!snapshot) {
            return
          }
          queueDetachedProjectionMessage(sourceWindowLabel, snapshot)
          return
        }
        case 'detached_terminal_ensure_session': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId, message.stationId)
          if (!container) {
            return
          }
          void ensureStationTerminalSession(message.stationId).then((sessionId) => {
            if (sessionId || stationTerminalsRef.current[message.stationId]?.sessionId) {
              return
            }
            publishDetachedRuntimePatch(
              message.stationId,
              buildSessionBindingRuntimePatch(null) as DetachedTerminalRuntimeProjectionPatch,
            )
          })
          return
        }
        case 'detached_terminal_write_input': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId, message.stationId)
          if (!container) {
            return
          }
          if (!matchesDetachedBridgeSession(message.stationId, message.sessionId)) {
            return
          }
          handleStationTerminalInput(message.stationId, message.input)
          return
        }
        case 'detached_terminal_resize': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId, message.stationId)
          if (!container) {
            return
          }
          if (!matchesDetachedBridgeSession(message.stationId, message.sessionId)) {
            return
          }
          resizeStationTerminal(message.stationId, message.cols, message.rows)
          return
        }
        case 'detached_terminal_activate_station': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId, message.stationId)
          if (!container) {
            return
          }
          // Note: setWorkbenchContainers is handled by root controller
          return
        }
        case 'detached_terminal_restore_state': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId, message.stationId)
          if (!container) {
            return
          }
          if (!matchesDetachedBridgeSession(message.stationId, message.sessionId)) {
            return
          }
          const capturedRestoreState = captureSessionOwnedRestoreState(
            stationTerminalsRef.current[message.stationId],
            message.state,
            stationTerminalOutputRevisionRef.current[message.stationId] ?? 0,
          )
          if (capturedRestoreState) {
            stationTerminalRestoreStateRef.current[message.stationId] = capturedRestoreState
          } else {
            delete stationTerminalRestoreStateRef.current[message.stationId]
          }
          return
        }
        default:
          return
      }
    },
    [
      buildDetachedHydrateSnapshotMessage,
      ensureStationTerminalSession,
      handleStationTerminalInput,
      matchesDetachedBridgeSession,
      queueDetachedProjectionMessage,
      publishDetachedRuntimePatch,
      resizeStationTerminal,
      resolveDetachedBridgeContainer,
    ],
  )

  // ── Rendered screen snapshot ───────────────────────────────────────────
  const reportRenderedScreenSnapshot = useMemo(
    () => (stationId: string, snapshot: RenderedScreenSnapshot) => {
      if (!desktopApi.isTauriRuntime() || performanceDebugState.enabled) {
        return
      }
      const debugEnabled = isStationTerminalDebugEnabled(stationId)
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      if (!sessionId || snapshot.sessionId !== sessionId) {
        return
      }
      const screenBody = snapshot.rows.map((row) => row.text).join('\n')
      if (debugEnabled) {
        pushStationTerminalDebugRecord(stationId, {
          atMs: snapshot.capturedAtMs,
          sessionId: snapshot.sessionId,
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
        .terminalReportRenderedScreen(snapshot, toolKind)
        .then((response) => {
          setStationTerminalDebugHumanLog(stationId, {
            entries: response.humanEntries,
            eventCount: response.humanEventCount,
          })
        })
        .catch(() => {
          // Snapshot reporting is best-effort and must not affect terminal interaction.
        })
    },
    [performanceDebugState.enabled, pushStationTerminalDebugRecord],
  )

  // ── Process snapshot helpers ────────────────────────────────────────────
  const updateStationProcessSnapshot = useCallback(
    (stationId: string, snapshot: TerminalDescribeProcessesResponse | null) => {
      setStationProcessSnapshots((prev) => {
        if (!snapshot) {
          if (!prev[stationId]) {
            return prev
          }
          const next = { ...prev }
          delete next[stationId]
          return next
        }

        const current = prev[stationId]
        const unchanged =
          current?.sessionId === snapshot.sessionId &&
          current?.rootPid === snapshot.rootPid &&
          current?.currentProcess?.pid === snapshot.currentProcess?.pid &&
          current?.currentProcess?.args === snapshot.currentProcess?.args &&
          current?.processes.length === snapshot.processes.length &&
          current?.processes.every(
            (process, index) =>
              process.pid === snapshot.processes[index]?.pid &&
              process.args === snapshot.processes[index]?.args,
          )
        if (unchanged) {
          return prev
        }

        return {
          ...prev,
          [stationId]: snapshot,
        }
      })
    },
    [],
  )

  const inspectStationSessionProcesses = useCallback(
    async (stationId: string, sessionId: string): Promise<TerminalDescribeProcessesResponse | null> => {
      if (!desktopApi.isTauriRuntime()) {
        return null
      }

      try {
        const snapshot = await desktopApi.terminalDescribeProcesses(sessionId)
        if (stationTerminalsRef.current[stationId]?.sessionId !== sessionId) {
          return null
        }
        updateStationProcessSnapshot(stationId, snapshot)
        return snapshot
      } catch {
        return stationProcessSnapshotsRef.current[stationId] ?? null
      }
    },
    [updateStationProcessSnapshot],
  )

  // ── Launch tool profile for station ────────────────────────────────────
  const launchToolProfileForStation = useCallback(
    async (station: AgentStation, profileId: string = station.toolKind) => {
      const workspaceId = activeWorkspaceIdRef.current
      if (!workspaceId) {
        return null
      }
      const requestSeq = (stationToolLaunchSeqRef.current[station.id] ?? 0) + 1
      stationToolLaunchSeqRef.current[station.id] = requestSeq

      if (!desktopApi.isTauriRuntime()) {
        const sessionId = await ensureStationTerminalSession(station.id)
        if (!sessionId) {
          return null
        }
        if (station.toolKind !== 'unknown' && station.toolKind !== 'shell') {
          const command = station.launchCommand?.trim() || station.toolKind
          sendStationTerminalInput(station.id, `${command}\n`)
        }
        return sessionId
      }

      try {
        const response = await desktopApi.toolLaunch({
          workspaceId,
          profileId,
          context: {
            agentId: station.id,
            stationId: station.id,
            roleKey: station.role,
            toolKind: station.toolKind,
            cwd: station.agentWorkdirRel,
            agentWorkdirRel: station.agentWorkdirRel,
            roleWorkdirRel: station.roleWorkdirRel,
            resolvedCwd: null,
            cwdMode: 'custom',
          },
        })

        const terminalSessionId = response.terminalSessionId?.trim() ?? ''
        if (!terminalSessionId) {
          return null
        }
        if (
          !shouldApplyStationToolLaunchResult(
            workspaceId,
            activeWorkspaceIdRef.current,
            stationsRef.current.some((item) => item.id === station.id),
            requestSeq,
            stationToolLaunchSeqRef.current[station.id] ?? 0,
          )
        ) {
          if (activeWorkspaceIdRef.current !== workspaceId) {
            const submitSequence = response.submitSequence
              ? normalizeSubmitSequence(response.submitSequence)
              : null
            cacheBackgroundLaunchedTerminalSession({
              workspaceId,
              station,
              sessionId: terminalSessionId,
              shell: response.shell ?? null,
              cwdMode: response.resolvedCwd ? 'custom' : 'workspace_root',
              resolvedCwd: response.resolvedCwd ?? stationTerminalsRef.current[station.id]?.resolvedCwd ?? null,
              submitSequence,
            })
            return null
          }
          const droppedSessionCleanup = resolveDroppedStationSessionCleanup(terminalSessionId)
          if (droppedSessionCleanup) {
            void desktopApi.terminalKill(
              droppedSessionCleanup.sessionId,
              droppedSessionCleanup.signal,
            ).catch(() => {
              // Dropped async tool launches must not leave orphan backend sessions behind.
            })
          }
          const droppedRuntimeCleanup = resolveDroppedStationRuntimeCleanup(
            workspaceId,
            activeWorkspaceIdRef.current,
            stationsRef.current.some((item) => item.id === station.id),
            stationTerminalsRef.current[station.id],
          )
          if (droppedRuntimeCleanup.action === 'register_current') {
            const submitSequence = stationSubmitSequenceRef.current[station.id] ?? null
            void desktopApi
              .agentRuntimeRegister({
                workspaceId,
                agentId: station.id,
                stationId: station.id,
                roleKey: station.role,
                sessionId: droppedRuntimeCleanup.sessionId,
                toolKind: normalizeStationToolKind(station.tool),
                resolvedCwd: droppedRuntimeCleanup.resolvedCwd,
                submitSequence,
                online: true,
              })
              .catch(() => {
                // Runtime sync effect will retry from current station ownership.
              })
          } else {
            void desktopApi.agentRuntimeUnregister(workspaceId, station.id).catch(() => {
              // Runtime sync effect will retry from current station ownership.
            })
          }
          return null
        }

        const rebindCleanup = resolveStationSessionRebindCleanup(
          stationTerminalsRef.current[station.id],
          terminalSessionId,
        )
        if (rebindCleanup) {
          delete sessionStationRef.current[rebindCleanup.previousSessionId]
          delete terminalSessionSeqRef.current[rebindCleanup.previousSessionId]
          delete terminalOutputQueueRef.current[rebindCleanup.previousSessionId]
          delete terminalSessionVisibilityRef.current[rebindCleanup.previousSessionId]
          stationTerminalInputControllerRef.current?.clear(station.id)
          delete stationTerminalRestoreStateRef.current[station.id]
          delete stationSubmitSequenceRef.current[station.id]
          void desktopApi
            .terminalKill(rebindCleanup.previousSessionId, rebindCleanup.signal)
            .catch(() => {
              // Rebinding must not leave the superseded backend session running.
            })
        }

        sessionStationRef.current[terminalSessionId] = station.id
        terminalSessionSeqRef.current[terminalSessionId] = 0
        terminalOutputQueueRef.current[terminalSessionId] = Promise.resolve()
        delete stationTerminalRestoreStateRef.current[station.id]

        if (response.submitSequence) {
          const normalizedSubmitSequence = normalizeSubmitSequence(response.submitSequence)
          if (normalizedSubmitSequence) {
            stationSubmitSequenceRef.current[station.id] = normalizedSubmitSequence
          }
        }

        ensureTerminalSessionVisible(terminalSessionId)
        resetStationTerminalOutput(
          station.id,
          `${t(locale, 'system.terminalLaunched')}${t(locale, 'system.terminalSessionInfo', {
            sessionId: terminalSessionId,
            cwd: response.resolvedCwd ?? station.agentWorkdirRel,
          })}`,
        )
        setStationTerminalState(station.id, {
          sessionId: terminalSessionId,
          stateRaw: 'running',
          unreadCount: 0,
          shell: response.shell ?? null,
          cwdMode: response.resolvedCwd ? 'custom' : 'workspace_root',
          resolvedCwd: response.resolvedCwd ?? stationTerminalsRef.current[station.id]?.resolvedCwd ?? null,
        })

        return terminalSessionId
      } catch (error) {
        if (
          shouldApplyStationToolLaunchResult(
            workspaceId,
            activeWorkspaceIdRef.current,
            stationsRef.current.some((item) => item.id === station.id),
            requestSeq,
            stationToolLaunchSeqRef.current[station.id] ?? 0,
          )
        ) {
          appendStationTerminalOutput(
            station.id,
            t(locale, 'system.launchFailed', {
              detail: describeError(error),
            }),
          )
        }
        return null
      }
    },
    [
      appendStationTerminalOutput,
      cacheBackgroundLaunchedTerminalSession,
      ensureStationTerminalSession,
      ensureTerminalSessionVisible,
      locale,
      resetStationTerminalOutput,
      sendStationTerminalInput,
      setStationTerminalState,
    ],
  )

  // ── Launch station CLI agent ────────────────────────────────────────────
  const launchStationCliAgent = useMemo(
    () => async (stationId: string) => {
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      if (!station) {
        return
      }
      const currentSessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      const launchCommand = resolveStationCliLaunchCommand(station.toolKind, station.launchCommand)
      if (!currentSessionId || !launchCommand) {
        const sessionId = await launchToolProfileForStation(station)
        if (!sessionId) {
          return
        }
        stationTerminalSinkRef.current[stationId]?.focus()
        return
      }

      const processSnapshot = await inspectStationSessionProcesses(stationId, currentSessionId)
      const agentRunning = isStationAgentProcessRunning(station.toolKind, processSnapshot)
      if (agentRunning) {
        stationTerminalSinkRef.current[stationId]?.focus()
        return
      }

      const resetCwd = await resetStationTerminalToAgentWorkdir(stationId)
      if (!resetCwd) {
        return
      }
      const launchedInSession = await writeStationTerminalWithSubmit(stationId, launchCommand)
      if (!launchedInSession) {
        return
      }
      stationTerminalSinkRef.current[stationId]?.focus()
    },
    [
      inspectStationSessionProcesses,
      launchToolProfileForStation,
      resetStationTerminalToAgentWorkdir,
      writeStationTerminalWithSubmit,
    ],
  )

  // ── Cleanup removed station runtime state ───────────────────────────────
  const cleanupRemovedStationRuntimeState = useCallback(
    async (stationId: string, workspaceId: string | null) => {
      const runtime = stationTerminalsRef.current[stationId]
      const mappedSessionId =
        Object.entries(sessionStationRef.current).find(([, mappedStationId]) => mappedStationId === stationId)?.[0] ??
        null
      const targetSessionId = runtime?.sessionId ?? mappedSessionId
      if (targetSessionId && desktopApi.isTauriRuntime()) {
        try {
          await desktopApi.terminalKill(targetSessionId, 'TERM')
        } catch (error) {
          const detail = describeError(error)
          if (!detail.includes('TERMINAL_SESSION_NOT_FOUND')) {
            appendStationTerminalOutput(
              stationId,
              t(locale, 'system.killFailed', {
                detail,
              }),
            )
            return false
          }
        }
      } else if (targetSessionId) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.killSkippedNoRuntime', {
            sessionId: targetSessionId,
          }),
        )
      } else if (runtime?.sessionId) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.killFailed', {
            detail: runtime.sessionId,
          }),
        )
        return false
      }

      setStationTerminalState(stationId, {
        sessionId: null,
        stateRaw: 'killed',
        unreadCount: 0,
        shell: null,
        cwdMode: 'workspace_root',
        resolvedCwd: null,
      })

      Object.entries(sessionStationRef.current).forEach(([sessionId, mappedStationId]) => {
        if (mappedStationId === stationId) {
          delete sessionStationRef.current[sessionId]
          delete terminalSessionSeqRef.current[sessionId]
          delete terminalOutputQueueRef.current[sessionId]
          delete terminalSessionVisibilityRef.current[sessionId]
        }
      })
      if (targetSessionId) {
        delete sessionStationRef.current[targetSessionId]
        delete terminalSessionSeqRef.current[targetSessionId]
        delete terminalOutputQueueRef.current[targetSessionId]
        delete terminalSessionVisibilityRef.current[targetSessionId]
      }
      stationTerminalInputControllerRef.current?.clear(stationId)
      delete stationTerminalRestoreStateRef.current[stationId]

      setStations((prev) => prev.filter((station) => station.id !== stationId))
      setStationTerminals((prev) => {
        const next = { ...prev }
        delete next[stationId]
        return next
      })
      delete stationTerminalOutputCacheRef.current[stationId]
      externalChannelController.removeStationTaskSignal(stationId)
      if (workspaceId && desktopApi.isTauriRuntime()) {
        void desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {
          // Runtime sync effect will retry if this one fails.
        })
      }
      return true
    },
    [appendStationTerminalOutput, externalChannelController.removeStationTaskSignal, locale, setStations, setStationTerminalState],
  )

  // ── Remove station ─────────────────────────────────────────────────────
  const removeStation = useCallback(
    async (stationId: string) => {
      const workspaceId = activeWorkspaceIdRef.current
      if (workspaceId && desktopApi.isTauriRuntime()) {
        setStationDeletePendingId(stationId)
        try {
          const response = await desktopApi.agentDelete({
            workspaceId,
            agentId: stationId,
          })
          if (!response.deleted) {
            if (
              response.errorCode === 'AGENT_DELETE_BLOCKED_BY_CHANNEL_BINDINGS'
              && response.blockingBindings?.length
            ) {
              setStationDeleteCleanupTargetId(stationId)
              setStationDeleteCleanupState(
                buildStationDeleteCleanupState(
                  response,
                  stationsRef.current
                    .filter((station) => station.workspaceId === workspaceId)
                    .map((station) => ({
                      id: station.id,
                      name: station.name,
                    })),
                  stationId,
                ),
              )
            }
            return
          }
        } finally {
          setStationDeletePendingId(null)
        }
      }

      const removed = await cleanupRemovedStationRuntimeState(stationId, workspaceId)
      if (!removed) {
        return
      }
      if (workspaceId && desktopApi.isTauriRuntime()) {
        // loadStationsFromDatabase is called externally - we just do cleanup here
      }
      setStationDeleteCleanupTargetId(null)
      setStationDeleteCleanupState(null)
      setIsStationManageOpen(false)
      setEditingStation(null)
    },
    [cleanupRemovedStationRuntimeState],
  )

  // ── Station delete cleanup ─────────────────────────────────────────────
  const handleStationDeleteCleanupChange = useCallback((patch: Partial<StationDeleteCleanupState>) => {
    setStationDeleteCleanupState((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const handleStationDeleteCleanupClose = useCallback(() => {
    if (stationDeleteCleanupSubmitting) {
      return
    }
    setStationDeleteCleanupTargetId(null)
    setStationDeleteCleanupState(null)
  }, [stationDeleteCleanupSubmitting])

  const handleStationDeleteCleanupConfirm = useCallback(async () => {
    if (!stationDeleteCleanupState || !stationDeleteCleanupTargetId) {
      return
    }
    const workspaceId = activeWorkspaceIdRef.current
    if (!workspaceId || !desktopApi.isTauriRuntime()) {
      return
    }

    setStationDeleteCleanupSubmitting(true)
    setStationDeletePendingId(stationDeleteCleanupTargetId)
    try {
      const response = await desktopApi.agentDelete({
        workspaceId,
        agentId: stationDeleteCleanupTargetId,
        ...buildStationDeleteCleanupRequest(stationDeleteCleanupState),
      })
      if (!response.deleted) {
        if (
          response.errorCode === 'AGENT_DELETE_BLOCKED_BY_CHANNEL_BINDINGS'
          && response.blockingBindings?.length
        ) {
          setStationDeleteCleanupState(
            buildStationDeleteCleanupState(
              response,
              stationsRef.current
                .filter((station) => station.workspaceId === workspaceId)
                .map((station) => ({
                  id: station.id,
                  name: station.name,
                })),
              stationDeleteCleanupTargetId,
            ),
          )
        }
        return
      }

      const removed = await cleanupRemovedStationRuntimeState(
        stationDeleteCleanupTargetId,
        workspaceId,
      )
      if (!removed) {
        return
      }
      setStationDeleteCleanupTargetId(null)
      setStationDeleteCleanupState(null)
      setIsStationManageOpen(false)
      setEditingStation(null)
    } finally {
      setStationDeleteCleanupSubmitting(false)
      setStationDeletePendingId(null)
    }
  }, [
    cleanupRemovedStationRuntimeState,
    stationDeleteCleanupState,
    stationDeleteCleanupTargetId,
  ])

  // ── Batch launch agents ────────────────────────────────────────────────
  const handleBatchLaunchAgents = useCallback(async () => {
    if (isBatchLaunchingAgents) {
      return
    }
    setIsBatchLaunchingAgents(true)
    try {
      for (const station of stationsRef.current) {
        const launchCommand = resolveStationCliLaunchCommand(station.toolKind, station.launchCommand)
        if (!launchCommand) {
          continue
        }

        const sessionId = stationTerminalsRef.current[station.id]?.sessionId ?? null
        let agentRunning = isStationAgentProcessRunning(
          station.toolKind,
          stationProcessSnapshotsRef.current[station.id],
        )
        if (sessionId) {
          const processSnapshot = await inspectStationSessionProcesses(station.id, sessionId)
          agentRunning = isStationAgentProcessRunning(station.toolKind, processSnapshot)
        }
        if (agentRunning) {
          continue
        }

        if (!sessionId) {
          await launchToolProfileForStation(station)
          continue
        }

        await writeStationTerminalWithSubmit(station.id, launchCommand)
      }
    } finally {
      setIsBatchLaunchingAgents(false)
    }
  }, [
    inspectStationSessionProcesses,
    isBatchLaunchingAgents,
    launchToolProfileForStation,
    writeStationTerminalWithSubmit,
  ])

  // ── Load tool commands for stations ────────────────────────────────────
  const loadToolCommandsForStations = useCallback(async () => {
    const workspaceId = activeWorkspaceIdRef.current
    if (!workspaceId || !desktopApi.isTauriRuntime()) {
      setToolCommandsByStationId({})
      return
    }

    try {
      const entries = await Promise.all(
        stationsRef.current.map(async (station) => {
          const runtime = stationTerminalsRef.current[station.id]
          const response = await desktopApi.toolListCommands({
            workspaceId,
            toolKind: station.toolKind,
            station: {
              stationId: station.id,
              hasTerminalSession: Boolean(runtime?.sessionId),
              detachedReadonly: false,
              resolvedCwd: runtime?.resolvedCwd ?? null,
            },
          })
          return [station.id, response.commands] as const
        }),
      )
      setToolCommandsByStationId(Object.fromEntries(entries))
    } catch (error) {
      console.warn('[station-command-deck] failed to load command catalog', error)
      setToolCommandsByStationId({})
    }
  }, [])

  // ── Execute station action ──────────────────────────────────────────────
  const executeStationAction = useCallback(
    async (station: AgentStation, action: StationActionDescriptor) => {
      const execution: import('@features/workspace-hub').StationActionExecution = action.execution
      switch (execution.type) {
        case 'insert_text':
          handleStationTerminalInput(station.id, execution.text)
          stationTerminalSinkRef.current[station.id]?.focus()
          return
        case 'insert_and_submit':
          await writeStationTerminalWithSubmit(station.id, execution.text)
          stationTerminalSinkRef.current[station.id]?.focus()
          return
        case 'submit_terminal':
          await submitStationTerminal(station.id)
          stationTerminalSinkRef.current[station.id]?.focus()
          return
        case 'launch_cli':
          await launchStationCliAgent(station.id)
          stationTerminalSinkRef.current[station.id]?.focus()
          return
        case 'open_command_sheet':
          setPendingStationActionSheet({ station, action })
          return
        case 'open_settings_modal':
          // setIsSettingsOpen(true) - handled externally
          return
        case 'open_channel_studio':
          // setActiveNavId('channels') - handled externally
          // setIsChannelStudioOpen(true) - handled externally
          return
        case 'launch_tool_profile': {
          await launchToolProfileForStation(station, execution.profileId)
          return
        }
        default:
          return
      }
    },
    [handleStationTerminalInput, launchStationCliAgent, launchToolProfileForStation, submitStationTerminal, writeStationTerminalWithSubmit],
  )

  // ── Handle submit station action sheet ──────────────────────────────────
  const handleSubmitStationActionSheet = useCallback(
    async (values: Record<string, string | boolean>) => {
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

      handleStationTerminalInput(pending.station.id, command)
      if (pending.action.execution.submit) {
        await submitStationTerminal(pending.station.id)
      }
      stationTerminalSinkRef.current[pending.station.id]?.focus()
    },
    [handleStationTerminalInput, pendingStationActionSheet, submitStationTerminal],
  )

  // ── Computed values ────────────────────────────────────────────────────
  const runtimeStateByStationId = useMemo(
    () =>
      Object.entries(stationTerminals).reduce<Record<string, string>>((acc, [stationId, runtime]) => {
        acc[stationId] = runtime.stateRaw
        return acc
      }, {}),
    [stationTerminals],
  )

  const terminalSessionCount = useMemo(
    () => Object.values(stationTerminals).filter((runtime) => runtime.sessionId).length,
    [stationTerminals],
  )

  const stationAgentRunningById = useMemo(
    () =>
      stations.reduce<Record<string, boolean>>((acc, station) => {
        acc[station.id] = isStationAgentProcessRunning(
          station.toolKind,
          stationProcessSnapshots[station.id],
        )
        return acc
      }, {}),
    [stationProcessSnapshots, stations],
  )

  const batchLaunchableAgentCount = useMemo(
    () =>
      stations.reduce((count, station) => {
        if (!resolveStationCliLaunchCommand(station.toolKind, station.launchCommand)) {
          return count
        }
        if (stationAgentRunningById[station.id]) {
          return count
        }
        return count + 1
      }, 0),
    [stationAgentRunningById, stations],
  )

  const toolCommandReloadKey = useMemo(
    () =>
      stations
        .map((station) => {
          const runtime = stationTerminals[station.id]
          return [
            station.id,
            station.toolKind,
            runtime?.sessionId ? 'live' : 'idle',
            runtime?.resolvedCwd ?? '',
          ].join(':')
        })
        .join('|'),
    [stationTerminals, stations],
  )

  // ── Terminal state reset for workspace switch ──────────────────────────
  const resetTerminalStateOnWorkspaceSwitch = useCallback(() => {
    detachedProjectionSeqRef.current = {}
    detachedProjectionDispatchQueueRef.current = {}
    sessionStationRef.current = {}
    terminalSessionSeqRef.current = {}
    terminalOutputQueueRef.current = {}
    ensureStationTerminalSessionInFlightRef.current = {}
    stationToolLaunchSeqRef.current = {}
    terminalSessionVisibilityRef.current = {}
    stationTerminalInputControllerRef.current?.dispose()
    stationTerminalInputControllerRef.current = null
    stationSubmitSequenceRef.current = {}
  }, [])

  // ── Cleanup effect ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const unreadTimerId = stationUnreadFlushTimerRef.current
      if (typeof unreadTimerId === 'number') {
        window.clearTimeout(unreadTimerId)
      }
      stationUnreadFlushTimerRef.current = null
      stationUnreadDeltaRef.current = {}

      if (desktopApi.isTauriRuntime()) {
        Object.entries(registeredAgentRuntimeRef.current).forEach(([agentId, runtime]) => {
          void desktopApi.agentRuntimeUnregister(runtime.workspaceId, agentId).catch(() => {
            // Best-effort runtime cleanup during shell teardown.
          })
        })
        workbenchContainersRef.current.forEach((container) => {
          if (!container.detachedWindowLabel) {
            return
          }
          void desktopApi.surfaceCloseWindow(container.detachedWindowLabel).catch(() => {
            // Detached surfaces are best-effort on shell teardown.
          })
        })
      }
      registeredAgentRuntimeRef.current = {}
    }
  }, [])

  // ── Tool commands loading ──────────────────────────────────────────────
  useEffect(() => {
    void loadToolCommandsForStations()
  }, [activeWorkspaceId, loadToolCommandsForStations, toolCommandReloadKey])

  return {
    // State
    stationTerminals,
    setStationTerminals,
    stationProcessSnapshots,
    toolCommandsByStationId,
    isBatchLaunchingAgents,
    pendingStationActionSheet,

    // Core refs
    stationTerminalsRef,
    stationTerminalOutputCacheRef,
    stationSubmitSequenceRef,

    // Station delete state
    stationDeletePendingId,
    stationDeleteCleanupTargetId,
    stationDeleteCleanupState,
    stationDeleteCleanupSubmitting,
    handleStationDeleteCleanupChange,
    handleStationDeleteCleanupClose,
    handleStationDeleteCleanupConfirm,

    // Core terminal operations
    bindStationTerminalSink,
    appendStationTerminalOutput,
    resetStationTerminalOutput,
    setStationTerminalState,
    clearStationUnread,
    ensureStationTerminalSession,
    launchStationTerminal,
    sendStationTerminalInput,
    handleStationTerminalInput,
    submitStationTerminal,
    writeStationTerminalWithSubmit,
    resetStationTerminalToAgentWorkdir,
    resizeStationTerminal,
    reconcileStationRuntimeRegistration,

    // Station operations
    removeStation,
    cleanupRemovedStationRuntimeState,
    launchStationCliAgent,
    handleBatchLaunchAgents,
    loadToolCommandsForStations,
    executeStationAction,
    handleSubmitStationActionSheet,

    // Terminal document
    captureActiveWorkspaceTerminalDocument,
    resolveWorkspaceTerminalDocument,
    persistActiveWorkspaceTerminalDocument,
    suspendWorkspaceTerminalSessions,
    recoverWorkspaceTerminalSessions,

    // Detached bridge
    findDetachedProjectionTargetsByStationId,
    publishDetachedRuntimePatch,
    publishDetachedOutputAppend,
    publishDetachedOutputReset,
    handleDetachedSurfaceBridgeMessage,
    reportRenderedScreenSnapshot,
    updateStationProcessSnapshot,
    inspectStationSessionProcesses,

    // Batch launch & actions
    setIsBatchLaunchingAgents,
    setPendingStationActionSheet,

    // Computed
    terminalSessionCount,
    stationAgentRunningById,
    batchLaunchableAgentCount,
    toolCommandReloadKey,
    runtimeStateByStationId,

    // Workspace presentation switch support
    resetTerminalStateOnWorkspaceSwitch,

    // Exposing internal refs for workspace session restore
    sessionStationRef,
    terminalSessionSeqRef,
    terminalOutputQueueRef,
    ensureStationTerminalSessionInFlightRef,
    stationTerminalRestoreStateRef,
    stationTerminalPendingReplayRef,
    stationTerminalInputControllerRef,
    stationTerminalSinkRef,
    stationTerminalOutputRevisionRef,
    terminalSessionVisibilityRef,
    terminalChunkDecoderBySessionRef,
    registeredAgentRuntimeRef,
    stationUnreadDeltaRef,
    stationUnreadFlushTimerRef,
    workspaceTerminalCacheRef,
    presentedWorkspaceIdRef,
    stationToolLaunchSeqRef,
    stationProcessSnapshotsRef,

    // resolveWorkspaceRoot for use by workspace session restore
    resolveWorkspaceRoot,
  } satisfies ShellTerminalController
}
