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
  buildStationTerminalCommandSubmitChunks,
  createTerminalChunkDecoder,
  decodeTerminalBase64Chunk,
  formatTerminalDebugBody,
  formatTerminalDebugPreview,
  isStationTerminalRuntimeLive,
  isStationTerminalDebugEnabled,
  resetTerminalChunkDecoder,
  setStationTerminalDebugHumanLog,
  buildClosedStationTerminalRuntime,
  buildSessionBindingRuntimePatch,
  captureMatchingSessionOwnedRestoreState,
  captureSessionOwnedRestoreState,
  doesStationTerminalRuntimePatchChangeState,
  createBufferedStationInputController,
  ensureSingleFlightStationSession,
  resolveStationSessionRebindCleanup,
  retainSessionOwnedRestoreState,
  resolveClosedStationSessionCleanup,
  resolveClosedStationRuntimeRegistrationCleanup,
  resolveDroppedStationRuntimeCleanup,
  resolveDroppedStationSessionCleanup,
  resolveStationRuntimeRegistrationCleanup,
  resolveTerminalOutputSequenceAction,
  shouldReplayStationTerminalSinkBinding,
  shouldPreferSessionOwnedRestoreState,
  selectStationTerminalReplaySource,
  isStationTerminalFocusReportInput,
  shouldApplyRecoveredStationOutput,
  shouldApplyStationSessionLaunchFailure,
  shouldApplyStationSessionResult,
  shouldApplyStationToolLaunchResult,
  shouldForwardStationTerminalInput,
  shouldMatchDetachedBridgeSession,
  appendStationTerminalPendingReplayOp,
  compactStationTerminalPendingReplayOps,
  drainStationTerminalPendingReplayOps,
  buildStationTerminalCachedOutputQueueKey,
  queueStationTerminalCachedOutputAppend,
  cancelStationTerminalFrameFlush,
  createStationTerminalFrameFlushScheduler,
  focusStationTerminalSinkWithFrameRetry,
  queueStationTerminalOutputFlush,
  normalizeStationTerminalResizeDimensions,
  scheduleStationTerminalFrameFlush,
  shouldReportRenderedScreenSnapshot,
  submitStationTerminalWithFrameRetry,
  STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT,
  takeStationTerminalOutputFlushFrameEntries,
  takeStationTerminalOutputFlushEntries,
  waitForStationTerminalFrameFlush,
  type BufferedStationInputController,
  type SessionOwnedRestoreState,
  type TerminalChunkDecoder,
  type TerminalDebugRecordInput,
  type StationTerminalSink,
  type StationTerminalSinkBindingHandler,
  type StationTerminalOutputFlushQueue,
  type StationTerminalPendingReplay,
  type StationTerminalCachedOutputAppendQueue,
  type StationTerminalFrameFlushHandle,
} from '@features/terminal/runtime'
import {
  recordStationTerminalFocusDiagnostic,
  type StationTerminalFocusDiagnosticKind,
} from '@features/terminal/station-terminal-focus-diagnostics'
import {
  isStationAgentProcessRunning,
  resolveStationCliLaunchCommand,
} from '@features/workspace-hub/station-agent-runtime-model'
import {
  buildSessionRelaunchLaunchCommand,
  resolveStationSessionProvider,
  type SessionRelaunchRequest,
} from '@features/session'
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
  normalizeDetachedTerminalUnreadDelta,
  queueDetachedTerminalOutputAppendDraft,
  stripDetachedTerminalRuntimeProjectionPatch,
  takeDetachedTerminalOutputAppendDrafts,
  type AgentStation,
  type DetachedTerminalOutputAppendDraft,
  type DetachedTerminalRuntimeProjectionPatch,
  type StationActionDescriptor,
  type UpdateStationInput,
  type WorkbenchContainerModel,
} from '@features/workspace-hub'
import {
  isWorkspaceRootWorkdir,
  resolveAgentWorkdirAbs,
} from '@features/workspace'
import {
  type RenderedScreenSnapshot,
  type DetachedTerminalBridgeMessage,
  type DetachedTerminalHydrateSnapshotMessage,
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
const BACKGROUND_TERMINAL_REPLAY_TIMEOUT_MS = 900
const BACKGROUND_TERMINAL_REPLAY_FALLBACK_DELAY_MS = 80
const BACKGROUND_TERMINAL_OUTPUT_FLUSH_DELAY_MS = 48
const BACKGROUND_TERMINAL_OUTPUT_FLUSH_ENTRY_LIMIT = 2
const BACKGROUND_TERMINAL_OUTPUT_FLUSH_CHAR_LIMIT = 12 * 1024
const ACTIVE_TERMINAL_OUTPUT_FLUSH_CHAR_LIMIT = STATION_TERMINAL_OUTPUT_FLUSH_ACTIVE_CHAR_LIMIT
const TERMINAL_REPLAY_WRITE_CHUNK_CHAR_LIMIT = ACTIVE_TERMINAL_OUTPUT_FLUSH_CHAR_LIMIT
const CACHED_TERMINAL_OUTPUT_FLUSH_DELAY_MS = 96
const TERMINAL_DOCUMENT_PERSIST_DELAY_MS = 180
const TERMINAL_WRITE_REJECTED_DETAIL = 'TERMINAL_WRITE_REJECTED'
const TERMINAL_KILL_REJECTED_DETAIL = 'TERMINAL_KILL_REJECTED'
const STATION_TERMINAL_FOCUS_MAX_RETRY_FRAMES = 8
const STATION_TERMINAL_FOCUS_RETRY_FALLBACK_DELAY_MS = 48
const STATION_TASK_SUBMIT_RETRY_FALLBACK_DELAY_MS = 48

function isTerminalSessionBindingInvalid(detail: string): boolean {
  return (
    detail.includes('TERMINAL_SESSION_NOT_FOUND') ||
    detail.includes('TERMINAL_SESSION_WORKSPACE_MISMATCH')
  )
}

interface TerminalWorkspaceSessionResponse {
  workspaceId: string
  sessionId: string
}

function isMatchingTerminalWorkspaceSessionResponse(
  response: TerminalWorkspaceSessionResponse,
  workspaceId: string,
  sessionId: string,
): boolean {
  return response.workspaceId === workspaceId && response.sessionId === sessionId
}

interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

interface IdleCallbackScheduler {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout?: number },
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

interface ScheduledTerminalReplayTask {
  stationId: string
  sink: StationTerminalSink
  replayVersion: number
  run: () => Promise<void>
}

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

  // Detached projection callbacks (bridge to workbench controller)
  detachedWindowOpenInFlightRef: MutableRefObject<Record<string, boolean>>

  // External channel controller
  externalChannelController: ShellExternalChannelController

  // Performance debug
  performanceDebugState: { enabled: boolean }
}

export interface ShellTerminalController {
  // State
  stationTerminals: Record<string, StationTerminalRuntime>
  setStationTerminals: Dispatch<SetStateAction<Record<string, StationTerminalRuntime>>>
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
  forceCloseStationTerminal: (stationId: string) => void
  confirmForceCloseStationTerminal: () => Promise<void>
  dismissForceCloseConfirm: () => void
  forceCloseConfirmPendingId: string | null
  reconcileStationRuntimeRegistration: (input: { workspaceId: string; stationId: string; expectedSessionId: string | null }) => Promise<void>

  // Station operations
  removeStation: (stationId: string) => Promise<void>
  cleanupRemovedStationRuntimeState: (stationId: string, workspaceId: string | null) => Promise<boolean>
  launchStationCliAgent: (stationId: string) => Promise<void>
  resumeGtoSession: (stationId: string, gtoSessionId: string) => Promise<void>
  relaunchGtoSession: (stationId: string, request: SessionRelaunchRequest) => Promise<void>
  warmStationTerminal: (stationId: string) => void
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
  stationTerminalPendingReplayRef: MutableRefObject<Record<string, StationTerminalPendingReplay>>
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
  detachedWindowOpenInFlightRef: _detachedWindowOpenInFlightRef,
  externalChannelController,
  performanceDebugState,
}: UseShellTerminalControllerInput): ShellTerminalController {
  // ── State declarations ────────────────────────────────────────────────
  const [stationTerminals, setStationTerminals] = useState<Record<string, StationTerminalRuntime>>(
    () => createInitialStationTerminals(initialStations),
  )
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
  const [forceCloseConfirmPendingId, setForceCloseConfirmPendingId] = useState<string | null>(null)

  // ── Refs ──────────────────────────────────────────────────────────────
  const stationTerminalsRef = useRef(stationTerminals)
  const sessionStationRef = useRef<Record<string, string>>({})
  const terminalSessionSeqRef = useRef<Record<string, number>>({})
  const terminalOutputQueueRef = useRef<Record<string, Promise<void>>>({})
  const cachedTerminalOutputAppendQueueRef = useRef<StationTerminalCachedOutputAppendQueue>({})
  const cachedTerminalOutputAppendTimerRef = useRef<number | null>(null)
  const ensureStationTerminalSessionInFlightRef = useRef<Record<string, Promise<string | null>>>({})
  const stationToolLaunchSeqRef = useRef<Record<string, number>>({})
  const stationTerminalSinkRef = useRef<Record<string, StationTerminalSink>>({})
  const stationTerminalOutputCacheRef = useRef<Record<string, string>>({})
  const stationTerminalOutputRevisionRef = useRef<Record<string, number>>({})
  const stationTerminalOutputFlushFrameRef = useRef<StationTerminalFrameFlushHandle | null>(null)
  const stationTerminalBackgroundOutputFlushTimerRef = useRef<number | null>(null)
  const stationTerminalOutputFlushQueueRef = useRef<StationTerminalOutputFlushQueue>({})
  const terminalDocumentPersistTimerRef = useRef<number | null>(null)
  const stationTerminalPendingReplayRef = useRef<Record<string, StationTerminalPendingReplay>>({})
  const scheduledTerminalReplayQueueRef = useRef<ScheduledTerminalReplayTask[]>([])
  const scheduledTerminalReplayHandleRef = useRef<{ kind: 'idle' | 'timeout'; id: number } | null>(null)
  const scheduledTerminalReplayRunningRef = useRef(false)
  const stationTerminalRestoreStateRef = useRef<Record<string, SessionOwnedRestoreState>>({})
  const stationTerminalInputControllerRef = useRef<BufferedStationInputController | null>(null)
  const stationSubmitSequenceRef = useRef<Record<string, string>>({})
  const renderedScreenReportRevisionRef = useRef<Map<string, number>>(new Map())
  const terminalSessionVisibilityRef = useRef<Record<string, boolean>>({})
  const terminalChunkDecoderBySessionRef = useRef<Record<string, TerminalChunkDecoder>>({})
  const terminalDebugRecordSeqRef = useRef(0)
  const workspaceTerminalCacheRef = useRef<Record<string, WorkspaceTerminalSessionDocument>>({})
  const detachedProjectionSeqRef = useRef<Record<string, number>>({})
  const detachedProjectionDispatchQueueRef = useRef<Record<string, Promise<void>>>({})
  const detachedProjectionOutputAppendQueueRef = useRef<
    Record<string, Record<string, DetachedTerminalOutputAppendDraft>>
  >({})
  const detachedProjectionOutputAppendFlushRef = useRef<StationTerminalFrameFlushHandle | null>(null)
  const registeredAgentRuntimeRef = useRef<
    Record<string, { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }>
  >({})
  const stationUnreadDeltaRef = useRef<Record<string, number>>({})
  const protectedAgentSessionByStationRef = useRef<Record<string, string>>({})
  const launchStationCliAgentRef = useRef<((stationId: string) => Promise<void>) | null>(null)

  const protectStationAgentSession = useCallback(
    (stationId: string, sessionId: string | null | undefined) => {
      const normalizedSessionId = sessionId?.trim() ?? ''
      if (!normalizedSessionId) {
        return
      }
      protectedAgentSessionByStationRef.current[stationId] = normalizedSessionId
    },
    [],
  )

  const recordStationLifecycleDiagnostic = useCallback(
    (
      stationId: string,
      sessionId: string | null,
      kind:
        | 'force-close-request'
        | 'force-close-confirm'
        | 'force-close-dismiss'
        | 'remove-station-request'
        | 'terminal-kill-request'
        | 'terminal-state-event'
        | 'runtime-state-patch'
        | 'missing-session-cleanup'
        | 'visibility-sync-miss',
      detail?: string,
    ) => {
      if (typeof window === 'undefined') {
        return
      }
      const owner =
        sessionId !== null
          ? findWorkspaceTerminalSessionOwner(workspaceTerminalCacheRef.current, sessionId)
          : null
      const workspaceId = owner?.workspaceId ?? activeWorkspaceIdRef.current ?? null
      void recordStationTerminalFocusDiagnostic({
        targetWindow: window,
        workspaceId,
        stationId,
        sessionId,
        kind,
        detail,
      })
    },
    [activeWorkspaceIdRef],
  )
  const recordStationRuntimeDiagnosticBySession = useCallback(
    (sessionId: string, kind: StationTerminalFocusDiagnosticKind, detail?: string) => {
      if (typeof window === 'undefined') {
        return
      }
      const owner = findWorkspaceTerminalSessionOwner(workspaceTerminalCacheRef.current, sessionId)
      const mappedStationId =
        sessionStationRef.current[sessionId]
        ?? owner?.stationId
        ?? null
      void recordStationTerminalFocusDiagnostic({
        targetWindow: window,
        workspaceId: owner?.workspaceId ?? activeWorkspaceIdRef.current ?? null,
        stationId: mappedStationId ?? 'session',
        sessionId,
        kind,
        detail,
      })
    },
    [activeWorkspaceIdRef],
  )
  const stationUnreadFlushTimerRef = useRef<number | null>(null)
  const activeStationIdRef = useRef(activeStationId)
  const presentedWorkspaceIdRef = useRef<string | null>(null)
  const scheduledStationOutputRecoveryRef = useRef<Record<string, number>>({})

  const isDetachedProjectionMessageCurrent = useCallback(
    (windowLabel: string, payload: DetachedTerminalBridgeMessage) => {
      if (
        payload.workspaceId !== activeWorkspaceIdRef.current ||
        payload.workspaceId !== presentedWorkspaceIdRef.current
      ) {
        return false
      }
      const container = workbenchContainersRef.current.find(
        (candidate) => candidate.id === payload.containerId && candidate.mode === 'detached',
      )
      if (container?.detachedWindowLabel !== windowLabel) {
        return false
      }
      return !('stationId' in payload) || container.stationIds.includes(payload.stationId)
    },
    [activeWorkspaceIdRef, workbenchContainersRef],
  )

  // ── Ref sync effects ──────────────────────────────────────────────────
  useEffect(() => {
    const previousWorkspaceId = activeWorkspaceIdRef.current
    if (previousWorkspaceId && previousWorkspaceId !== activeWorkspaceId) {
      stationTerminalInputControllerRef.current?.dispose()
      stationTerminalInputControllerRef.current = null
    }
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId, activeWorkspaceIdRef])

  useEffect(() => {
    activeStationIdRef.current = activeStationId
  }, [activeStationId])

  useEffect(() => {
    stationTerminalsRef.current = stationTerminals
  }, [stationTerminals])

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
      if (changed) {
        stationTerminalsRef.current = next
      }
      return changed ? next : prev
    })
    stations.forEach((station) => {
      if (stationTerminalOutputCacheRef.current[station.id] !== undefined) {
        return
      }
      stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(station)
    })
  }, [stations])

  // ── Detached projection helpers ───────────────────────────────────────
  const hasDetachedProjectionTargets = useCallback(() => {
    return workbenchContainersRef.current.some(
      (container) =>
        container.mode === 'detached' &&
        Boolean(container.detachedWindowLabel) &&
        container.stationIds.length > 0,
    )
  }, [])

  const findDetachedProjectionTargetsByStationId = useCallback((stationId: string): DetachedProjectionTarget[] => {
    if (!stationId || !hasDetachedProjectionTargets()) {
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
  }, [hasDetachedProjectionTargets])

  const enqueueDetachedProjectionMessage = useCallback(
    (windowLabel: string, payload: DetachedTerminalBridgeMessage) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      if (!isDetachedProjectionMessageCurrent(windowLabel, payload)) {
        return
      }
      const previous = detachedProjectionDispatchQueueRef.current[windowLabel] ?? Promise.resolve()
      detachedProjectionDispatchQueueRef.current[windowLabel] = previous
        .catch(() => undefined)
        .then(async () => {
          if (!isDetachedProjectionMessageCurrent(windowLabel, payload)) {
            return
          }
          await desktopApi.surfaceBridgePost(windowLabel, payload)
        })
        .catch(() => undefined)
    },
    [isDetachedProjectionMessageCurrent],
  )

  const nextDetachedProjectionSeq = useCallback((windowLabel: string, stationId: string) => {
    const seqKey = `${windowLabel}:${stationId}`
    const nextSeq = (detachedProjectionSeqRef.current[seqKey] ?? 0) + 1
    detachedProjectionSeqRef.current[seqKey] = nextSeq
    return nextSeq
  }, [])

  const cancelDetachedProjectionOutputAppendFlush = useCallback(() => {
    cancelStationTerminalFrameFlush(detachedProjectionOutputAppendFlushRef.current)
    detachedProjectionOutputAppendFlushRef.current = null
  }, [])

  const flushDetachedProjectionOutputAppends = useCallback(() => {
    cancelDetachedProjectionOutputAppendFlush()
    const pendingByWindow = detachedProjectionOutputAppendQueueRef.current
    detachedProjectionOutputAppendQueueRef.current = {}
    Object.entries(pendingByWindow).forEach(([windowLabel, queue]) => {
      const messages = takeDetachedTerminalOutputAppendDrafts(queue, {
        nextProjectionSeq: (stationId) => nextDetachedProjectionSeq(windowLabel, stationId),
      })
      messages.forEach((message) => {
        enqueueDetachedProjectionMessage(windowLabel, message)
      })
    })
  }, [
    cancelDetachedProjectionOutputAppendFlush,
    enqueueDetachedProjectionMessage,
    nextDetachedProjectionSeq,
  ])

  const scheduleDetachedProjectionOutputAppendFlush = useCallback(() => {
    if (typeof window === 'undefined') {
      flushDetachedProjectionOutputAppends()
      return
    }
    if (detachedProjectionOutputAppendFlushRef.current !== null) {
      return
    }
    detachedProjectionOutputAppendFlushRef.current = scheduleStationTerminalFrameFlush(
      () => {
        detachedProjectionOutputAppendFlushRef.current = null
        flushDetachedProjectionOutputAppends()
      },
      {
        requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
        cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (id) => window.clearTimeout(id),
      },
    )
  }, [flushDetachedProjectionOutputAppends])

  const queueDetachedProjectionMessage = useCallback(
    (windowLabel: string, payload: DetachedTerminalBridgeMessage) => {
      flushDetachedProjectionOutputAppends()
      enqueueDetachedProjectionMessage(windowLabel, payload)
    },
    [enqueueDetachedProjectionMessage, flushDetachedProjectionOutputAppends],
  )

  const publishDetachedRuntimePatch = useCallback(
    (stationId: string, runtimePatch: DetachedTerminalRuntimeProjectionPatch) => {
      if (!runtimePatch || Object.keys(runtimePatch).length === 0) {
        return
      }
      const workspaceId = presentedWorkspaceIdRef.current
      if (!workspaceId || workspaceId !== activeWorkspaceIdRef.current) {
        return
      }
      const targets = findDetachedProjectionTargetsByStationId(stationId)
      if (targets.length === 0) {
        return
      }
      flushDetachedProjectionOutputAppends()
      targets.forEach(({ containerId, windowLabel }) => {
        const message: DetachedTerminalRuntimeUpdatedMessage = {
          kind: 'detached_terminal_runtime_updated',
          workspaceId,
          containerId,
          stationId,
          runtimePatch,
          projectionSeq: nextDetachedProjectionSeq(windowLabel, stationId),
        }
        enqueueDetachedProjectionMessage(windowLabel, message)
      })
    },
    [
      activeWorkspaceIdRef,
      enqueueDetachedProjectionMessage,
      findDetachedProjectionTargetsByStationId,
      flushDetachedProjectionOutputAppends,
      nextDetachedProjectionSeq,
    ],
  )

  const publishDetachedOutputAppend = useCallback(
    (stationId: string, chunk: string, unreadDelta = 1) => {
      if (!chunk) {
        return
      }
      const workspaceId = presentedWorkspaceIdRef.current
      if (!workspaceId || workspaceId !== activeWorkspaceIdRef.current) {
        return
      }
      const targets = findDetachedProjectionTargetsByStationId(stationId)
      if (targets.length === 0) {
        return
      }
      targets.forEach(({ containerId, windowLabel }) => {
        const queue =
          detachedProjectionOutputAppendQueueRef.current[windowLabel] ??
          (detachedProjectionOutputAppendQueueRef.current[windowLabel] = {})
        const queuedKey = queueDetachedTerminalOutputAppendDraft(queue, {
          workspaceId,
          containerId,
          stationId,
          chunk,
          unreadDelta,
        })
        if (queuedKey) {
          scheduleDetachedProjectionOutputAppendFlush()
        }
      })
    },
    [
      activeWorkspaceIdRef,
      findDetachedProjectionTargetsByStationId,
      scheduleDetachedProjectionOutputAppendFlush,
    ],
  )

  const publishDetachedOutputReset = useCallback(
    (stationId: string, content: string) => {
      const workspaceId = presentedWorkspaceIdRef.current
      if (!workspaceId || workspaceId !== activeWorkspaceIdRef.current) {
        return
      }
      const targets = findDetachedProjectionTargetsByStationId(stationId)
      if (targets.length === 0) {
        return
      }
      flushDetachedProjectionOutputAppends()
      targets.forEach(({ containerId, windowLabel }) => {
        const message: DetachedTerminalOutputResetMessage = {
          kind: 'detached_terminal_output_reset',
          workspaceId,
          containerId,
          stationId,
          content,
          projectionSeq: nextDetachedProjectionSeq(windowLabel, stationId),
        }
        enqueueDetachedProjectionMessage(windowLabel, message)
      })
    },
    [
      activeWorkspaceIdRef,
      enqueueDetachedProjectionMessage,
      findDetachedProjectionTargetsByStationId,
      flushDetachedProjectionOutputAppends,
      nextDetachedProjectionSeq,
    ],
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

  const flushCachedTerminalOutputAppendQueue = useCallback(() => {
    if (typeof window !== 'undefined' && cachedTerminalOutputAppendTimerRef.current !== null) {
      window.clearTimeout(cachedTerminalOutputAppendTimerRef.current)
    }
    cachedTerminalOutputAppendTimerRef.current = null
    const pendingQueue = cachedTerminalOutputAppendQueueRef.current
    cachedTerminalOutputAppendQueueRef.current = {}
    Object.values(pendingQueue).forEach((pending) => {
      const document = workspaceTerminalCacheRef.current[pending.workspaceId]
      if (!document || document.sessionStation[pending.sessionId] !== pending.stationId) {
        return
      }
      const textChunks: string[] = []
      const decoder =
        terminalChunkDecoderBySessionRef.current[pending.sessionId] ??
        (terminalChunkDecoderBySessionRef.current[pending.sessionId] = createTerminalChunkDecoder())
      pending.base64Chunks.forEach((base64Chunk) => {
        const text = decodeTerminalBase64Chunk(decoder, base64Chunk, true)
        if (text) {
          textChunks.push(text)
        }
      })
      const chunk = textChunks.length === 1 ? textChunks[0] : textChunks.join('')
      if (chunk) {
        document.outputCache[pending.stationId] = appendDetachedTerminalOutput(
          document.outputCache[pending.stationId],
          chunk,
        )
        document.outputRevision[pending.stationId] =
          (document.outputRevision[pending.stationId] ?? 0) + Math.max(1, textChunks.length)
      }
      const runtime = document.stationTerminals[pending.stationId]
      if (runtime && pending.unreadDelta > 0) {
        document.stationTerminals[pending.stationId] = {
          ...runtime,
          unreadCount: Math.min(999, runtime.unreadCount + pending.unreadDelta),
        }
      }
    })
  }, [])

  const scheduleCachedTerminalOutputAppendFlush = useCallback(() => {
    if (typeof window === 'undefined') {
      flushCachedTerminalOutputAppendQueue()
      return
    }
    if (cachedTerminalOutputAppendTimerRef.current !== null) {
      return
    }
    cachedTerminalOutputAppendTimerRef.current = window.setTimeout(
      flushCachedTerminalOutputAppendQueue,
      CACHED_TERMINAL_OUTPUT_FLUSH_DELAY_MS,
    )
  }, [flushCachedTerminalOutputAppendQueue])

  const resolveActiveCachedTerminalOutputQueueKey = useCallback((workspaceId: string): string | null => {
    const activeStationId = activeStationIdRef.current
    if (!activeStationId) {
      return null
    }
    const document = workspaceTerminalCacheRef.current[workspaceId]
    if (!document) {
      return null
    }
    const activeSessionId =
      stationTerminalsRef.current[activeStationId]?.sessionId ??
      document.stationTerminals[activeStationId]?.sessionId ??
      null
    if (!activeSessionId || document.sessionStation[activeSessionId] !== activeStationId) {
      return null
    }
    return buildStationTerminalCachedOutputQueueKey(workspaceId, activeStationId, activeSessionId)
  }, [])

  const queueCachedTerminalOutputAppend = useCallback(
    (input: {
      workspaceId: string
      stationId: string
      sessionId: string
      seq: number
      base64Chunk: string
      unreadDelta: number
    }) => {
      const document = workspaceTerminalCacheRef.current[input.workspaceId]
      if (!document || document.sessionStation[input.sessionId] !== input.stationId) {
        return
      }
      document.sessionSeq[input.sessionId] = input.seq
      const unreadDelta = Math.max(0, input.unreadDelta)
      const result = queueStationTerminalCachedOutputAppend(
        cachedTerminalOutputAppendQueueRef.current,
        {
          workspaceId: input.workspaceId,
          stationId: input.stationId,
          sessionId: input.sessionId,
          base64Chunk: input.base64Chunk,
          unreadDelta,
        },
        {
          protectedQueueKey: resolveActiveCachedTerminalOutputQueueKey(input.workspaceId),
        },
      )
      if (!result.queued) {
        return
      }
      if (result.shouldFlush) {
        flushCachedTerminalOutputAppendQueue()
        return
      }
      scheduleCachedTerminalOutputAppendFlush()
    },
    [
      flushCachedTerminalOutputAppendQueue,
      resolveActiveCachedTerminalOutputQueueKey,
      scheduleCachedTerminalOutputAppendFlush,
    ],
  )

  const queueCachedTerminalUnreadDelta = useCallback(
    (input: { workspaceId: string; stationId: string; sessionId: string; unreadDelta: number }) => {
      const document = workspaceTerminalCacheRef.current[input.workspaceId]
      if (!document || document.sessionStation[input.sessionId] !== input.stationId) {
        return
      }
      const unreadDelta = Math.max(0, input.unreadDelta)
      if (unreadDelta === 0) {
        return
      }
      const result = queueStationTerminalCachedOutputAppend(
        cachedTerminalOutputAppendQueueRef.current,
        {
          workspaceId: input.workspaceId,
          stationId: input.stationId,
          sessionId: input.sessionId,
          unreadDelta,
        },
        {
          protectedQueueKey: resolveActiveCachedTerminalOutputQueueKey(input.workspaceId),
        },
      )
      if (!result.queued) {
        return
      }
      scheduleCachedTerminalOutputAppendFlush()
    },
    [resolveActiveCachedTerminalOutputQueueKey, scheduleCachedTerminalOutputAppendFlush],
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
      flushCachedTerminalOutputAppendQueue()
      const hydrated = hydrateWorkspaceTerminalSessionDocument(
        workspaceTerminalCacheRef.current[workspaceId],
        stationsForWorkspace,
      )
      workspaceTerminalCacheRef.current[workspaceId] = hydrated
      return hydrated
    },
    [flushCachedTerminalOutputAppendQueue],
  )

  const persistActiveWorkspaceTerminalDocument = useCallback(() => {
    captureActiveWorkspaceTerminalDocument(presentedWorkspaceIdRef.current)
  }, [captureActiveWorkspaceTerminalDocument])

  const scheduleTerminalDocumentPersist = useCallback(() => {
    if (typeof window === 'undefined') {
      persistActiveWorkspaceTerminalDocument()
      return
    }
    if (terminalDocumentPersistTimerRef.current !== null) {
      return
    }
    terminalDocumentPersistTimerRef.current = window.setTimeout(() => {
      terminalDocumentPersistTimerRef.current = null
      persistActiveWorkspaceTerminalDocument()
    }, TERMINAL_DOCUMENT_PERSIST_DELAY_MS)
  }, [persistActiveWorkspaceTerminalDocument])

  const cancelScheduledTerminalDocumentPersist = useCallback(() => {
    if (typeof window !== 'undefined' && terminalDocumentPersistTimerRef.current !== null) {
      window.clearTimeout(terminalDocumentPersistTimerRef.current)
    }
    terminalDocumentPersistTimerRef.current = null
  }, [])

  const flushScheduledTerminalDocumentPersist = useCallback(() => {
    cancelScheduledTerminalDocumentPersist()
    persistActiveWorkspaceTerminalDocument()
  }, [cancelScheduledTerminalDocumentPersist, persistActiveWorkspaceTerminalDocument])

  // ── Output streaming ──────────────────────────────────────────────────
  const applyStationTerminalOutputCacheEntries = useCallback(
    (entries: ReturnType<typeof takeStationTerminalOutputFlushEntries>) => {
      entries.forEach(({ stationId: targetStationId, ...pendingOutput }) => {
        const { chunk } = pendingOutput
        if (!chunk) {
          return
        }
        stationTerminalOutputCacheRef.current[targetStationId] = appendDetachedTerminalOutput(
          stationTerminalOutputCacheRef.current[targetStationId],
          chunk,
        )
        stationTerminalOutputRevisionRef.current[targetStationId] =
          (stationTerminalOutputRevisionRef.current[targetStationId] ?? 0) + Math.max(1, pendingOutput.unreadDelta)
      })
    },
    [],
  )

  const applyStationTerminalOutputFlushEntries = useCallback(
    (entries: ReturnType<typeof takeStationTerminalOutputFlushEntries>) => {
      applyStationTerminalOutputCacheEntries(entries)
      entries.forEach(({ stationId: targetStationId, ...pendingOutput }) => {
        const { chunk } = pendingOutput
        if (!chunk) {
          return
        }
        const pendingReplay = stationTerminalPendingReplayRef.current[targetStationId]
        if (pendingReplay) {
          appendStationTerminalPendingReplayOp(
            pendingReplay,
            { kind: 'write', chunk },
            { writeChunkCharLimit: TERMINAL_REPLAY_WRITE_CHUNK_CHAR_LIMIT },
          )
        } else {
          void stationTerminalSinkRef.current[targetStationId]?.write(chunk)
        }
        publishDetachedOutputAppend(
          targetStationId,
          chunk,
          normalizeDetachedTerminalUnreadDelta(pendingOutput.unreadDelta),
        )
      })
    },
    [applyStationTerminalOutputCacheEntries, publishDetachedOutputAppend],
  )

  const cancelScheduledStationTerminalOutputFlushes = useCallback(() => {
    cancelStationTerminalFrameFlush(stationTerminalOutputFlushFrameRef.current)
    stationTerminalOutputFlushFrameRef.current = null
    if (typeof window !== 'undefined' && stationTerminalBackgroundOutputFlushTimerRef.current !== null) {
      window.clearTimeout(stationTerminalBackgroundOutputFlushTimerRef.current)
    }
    stationTerminalBackgroundOutputFlushTimerRef.current = null
  }, [])

  const flushPendingStationTerminalOutputToCache = useCallback(() => {
    const entries = takeStationTerminalOutputFlushEntries(stationTerminalOutputFlushQueueRef.current)
    if (entries.length === 0) {
      return
    }
    cancelScheduledStationTerminalOutputFlushes()
    applyStationTerminalOutputCacheEntries(entries)
  }, [applyStationTerminalOutputCacheEntries, cancelScheduledStationTerminalOutputFlushes])

  const flushPendingStationTerminalOutput = useCallback(
    (stationId?: string) => {
      const pending = stationTerminalOutputFlushQueueRef.current
      const entries = takeStationTerminalOutputFlushEntries(pending, stationId)
      if (entries.length === 0) {
        return
      }
      if (!stationId) {
        cancelStationTerminalFrameFlush(stationTerminalOutputFlushFrameRef.current)
        stationTerminalOutputFlushFrameRef.current = null
      }
      if (!stationId && typeof window !== 'undefined' && stationTerminalBackgroundOutputFlushTimerRef.current !== null) {
        window.clearTimeout(stationTerminalBackgroundOutputFlushTimerRef.current)
        stationTerminalBackgroundOutputFlushTimerRef.current = null
      }
      applyStationTerminalOutputFlushEntries(entries)
      scheduleTerminalDocumentPersist()
    },
    [applyStationTerminalOutputFlushEntries, scheduleTerminalDocumentPersist],
  )

  const suspendWorkspaceTerminalSessions = useCallback(
    (workspaceId: string | null) => {
      if (!workspaceId) {
        return
      }
      flushPendingStationTerminalOutputToCache()
      captureActiveWorkspaceTerminalDocument(workspaceId)
      cancelScheduledTerminalDocumentPersist()
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
          .terminalSetVisibility(workspaceId, sessionId, false)
          .catch((error) => {
            const detail = describeError(error)
            recordStationRuntimeDiagnosticBySession(
              sessionId,
              'visibility-sync-miss',
              `visible=false;detail=${detail}`,
            )
            if (!isTerminalSessionBindingInvalid(detail)) {
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
    [
      cancelScheduledTerminalDocumentPersist,
      captureActiveWorkspaceTerminalDocument,
      flushPendingStationTerminalOutputToCache,
      recordStationRuntimeDiagnosticBySession,
    ],
  )

  const scheduleBackgroundStationTerminalOutputFlush = useCallback(() => {
    if (typeof window === 'undefined') {
      flushPendingStationTerminalOutput()
      return
    }
    if (stationTerminalBackgroundOutputFlushTimerRef.current !== null) {
      return
    }
    const runBackgroundFlush = () => {
      stationTerminalBackgroundOutputFlushTimerRef.current = null
      const { entries, hasDeferredBackground } = takeStationTerminalOutputFlushFrameEntries(
        stationTerminalOutputFlushQueueRef.current,
        {
          activeStationId: activeStationIdRef.current,
          includeActive: false,
          includeBackground: true,
          backgroundEntryLimit: BACKGROUND_TERMINAL_OUTPUT_FLUSH_ENTRY_LIMIT,
          backgroundCharLimit: BACKGROUND_TERMINAL_OUTPUT_FLUSH_CHAR_LIMIT,
        },
      )
      applyStationTerminalOutputFlushEntries(entries)
      if (entries.length > 0) {
        scheduleTerminalDocumentPersist()
      }
      if (hasDeferredBackground) {
        stationTerminalBackgroundOutputFlushTimerRef.current = window.setTimeout(
          runBackgroundFlush,
          BACKGROUND_TERMINAL_OUTPUT_FLUSH_DELAY_MS,
        )
      }
    }
    stationTerminalBackgroundOutputFlushTimerRef.current = window.setTimeout(
      runBackgroundFlush,
      BACKGROUND_TERMINAL_OUTPUT_FLUSH_DELAY_MS,
    )
  }, [applyStationTerminalOutputFlushEntries, flushPendingStationTerminalOutput, scheduleTerminalDocumentPersist])

  const scheduleStationTerminalOutputFlush = useCallback(() => {
    if (typeof window === 'undefined') {
      flushPendingStationTerminalOutput()
      return
    }
    if (stationTerminalOutputFlushFrameRef.current !== null) {
      return
    }
    stationTerminalOutputFlushFrameRef.current = scheduleStationTerminalFrameFlush(
      () => {
        stationTerminalOutputFlushFrameRef.current = null
        const { entries, hasDeferredActive, hasDeferredBackground } = takeStationTerminalOutputFlushFrameEntries(
          stationTerminalOutputFlushQueueRef.current,
          {
            activeStationId: activeStationIdRef.current,
            activeCharLimit: ACTIVE_TERMINAL_OUTPUT_FLUSH_CHAR_LIMIT,
            includeBackground: false,
          },
        )
        applyStationTerminalOutputFlushEntries(entries)
        if (entries.length > 0) {
          scheduleTerminalDocumentPersist()
        }
        if (hasDeferredActive) {
          scheduleStationTerminalOutputFlush()
        }
        if (hasDeferredBackground) {
          scheduleBackgroundStationTerminalOutputFlush()
        }
      },
      {
        requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
        cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (id) => window.clearTimeout(id),
      },
    )
  }, [
    applyStationTerminalOutputFlushEntries,
    flushPendingStationTerminalOutput,
    scheduleBackgroundStationTerminalOutputFlush,
    scheduleTerminalDocumentPersist,
  ])

  const appendStationTerminalOutput = useMemo(
    () => (stationId: string, chunk: string) => {
      if (!chunk) {
        return
      }
      if (isStationTerminalDebugEnabled(stationId)) {
        const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
        pushStationTerminalDebugRecord(stationId, {
          sessionId,
          lane: 'xterm',
          kind: 'write',
          source: 'append',
          summary: formatTerminalDebugPreview(chunk, 84),
          body: chunk,
        })
      }
      queueStationTerminalOutputFlush(stationTerminalOutputFlushQueueRef.current, stationId, chunk, 1, {
        protectedStationId: activeStationIdRef.current,
      })
      scheduleStationTerminalOutputFlush()
    },
    [pushStationTerminalDebugRecord, scheduleStationTerminalOutputFlush],
  )

  useEffect(() => {
    if (!activeStationId) {
      return
    }
    if (!stationTerminalOutputFlushQueueRef.current[activeStationId]) {
      return
    }
    scheduleStationTerminalOutputFlush()
  }, [activeStationId, scheduleStationTerminalOutputFlush])

  const resetStationTerminalOutput = useMemo(
    () => (stationId: string, content?: string) => {
      flushPendingStationTerminalOutput(stationId)
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
      if (isStationTerminalDebugEnabled(stationId)) {
        const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
        pushStationTerminalDebugRecord(stationId, {
          sessionId,
          lane: 'xterm',
          kind: 'reset',
          source: content == null ? 'fallback' : 'explicit',
          summary: formatTerminalDebugPreview(nextContent, 84),
          body: nextContent,
        })
      }
      const pendingReplay = stationTerminalPendingReplayRef.current[stationId]
      if (pendingReplay) {
        appendStationTerminalPendingReplayOp(pendingReplay, { kind: 'reset', content: nextContent })
      } else {
        void stationTerminalSinkRef.current[stationId]?.reset(nextContent)
      }
      scheduleTerminalDocumentPersist()
      publishDetachedOutputReset(stationId, nextContent)
    },
    [
      flushPendingStationTerminalOutput,
      publishDetachedOutputReset,
      pushStationTerminalDebugRecord,
      scheduleTerminalDocumentPersist,
    ],
  )

  const setStationTerminalState = useMemo(
    () => (stationId: string, patch: Partial<StationTerminalRuntime>) => {
      const projectionPatch = stripDetachedTerminalRuntimeProjectionPatch(patch)
      const previousRuntime = stationTerminalsRef.current[stationId] ?? null
      const changesRuntimeState = doesStationTerminalRuntimePatchChangeState(previousRuntime, patch)
      const nextRuntimePreview =
        previousRuntime == null
          ? ({
              sessionId: patch.sessionId ?? null,
              stateRaw: patch.stateRaw ?? 'idle',
              unreadCount: patch.unreadCount ?? 0,
              shell: patch.shell ?? null,
              cwdMode: patch.cwdMode ?? 'workspace_root',
              resolvedCwd: patch.resolvedCwd ?? null,
            } satisfies StationTerminalRuntime)
          : {
              ...previousRuntime,
              ...patch,
            }
      if (
        previousRuntime == null
        || previousRuntime.sessionId !== nextRuntimePreview.sessionId
        || previousRuntime.stateRaw !== nextRuntimePreview.stateRaw
      ) {
        recordStationLifecycleDiagnostic(
          stationId,
          nextRuntimePreview.sessionId ?? previousRuntime?.sessionId ?? null,
          'runtime-state-patch',
          [
            `fromSession=${previousRuntime?.sessionId ?? 'none'}`,
            `toSession=${nextRuntimePreview.sessionId ?? 'none'}`,
            `fromState=${previousRuntime?.stateRaw ?? 'none'}`,
            `toState=${nextRuntimePreview.stateRaw}`,
          ].join(';'),
        )
      }
      if (changesRuntimeState) {
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
          return next
        })
        persistActiveWorkspaceTerminalDocument()
      }
      if (projectionPatch) {
        publishDetachedRuntimePatch(stationId, projectionPatch)
      }
    },
    [
      persistActiveWorkspaceTerminalDocument,
      publishDetachedRuntimePatch,
      recordStationLifecycleDiagnostic,
    ],
  )

  // ── Unread tracking ───────────────────────────────────────────────────
  const clearStationUnread = useMemo(
    () => (stationId: string) => {
      delete stationUnreadDeltaRef.current[stationId]
      const runtime = stationTerminalsRef.current[stationId]
      if (!runtime || runtime.unreadCount === 0) {
        return
      }
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
      const changedEntries = entries.filter(([stationId, delta]) => {
        const current = stationTerminalsRef.current[stationId]
        if (!current) {
          return false
        }
        return Math.min(999, current.unreadCount + delta) !== current.unreadCount
      })
      if (changedEntries.length === 0) {
        return
      }
      setStationTerminals((prev) => {
        let changed = false
        const next = { ...prev }
        changedEntries.forEach(([stationId, delta]) => {
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

  const cancelScheduledTerminalReplayDrain = useCallback(() => {
    const scheduled = scheduledTerminalReplayHandleRef.current
    if (!scheduled || typeof window === 'undefined') {
      scheduledTerminalReplayHandleRef.current = null
      return
    }
    if (scheduled.kind === 'idle') {
      const win = window as unknown as IdleCallbackScheduler
      win.cancelIdleCallback?.(scheduled.id)
    } else {
      window.clearTimeout(scheduled.id)
    }
    scheduledTerminalReplayHandleRef.current = null
  }, [])

  const drainScheduledTerminalReplayQueue = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (
      scheduledTerminalReplayHandleRef.current ||
      scheduledTerminalReplayRunningRef.current ||
      scheduledTerminalReplayQueueRef.current.length === 0
    ) {
      return
    }

    const win = window as unknown as IdleCallbackScheduler
    const runNext = (deadline: IdleDeadlineLike) => {
      scheduledTerminalReplayHandleRef.current = null
      if (scheduledTerminalReplayRunningRef.current) {
        drainScheduledTerminalReplayQueue()
        return
      }
      if (!deadline.didTimeout && deadline.timeRemaining() < 8) {
        drainScheduledTerminalReplayQueue()
        return
      }
      const task = scheduledTerminalReplayQueueRef.current.shift()
      if (!task) {
        return
      }
      if (
        stationTerminalSinkRef.current[task.stationId] !== task.sink ||
        stationTerminalPendingReplayRef.current[task.stationId]?.version !== task.replayVersion
      ) {
        drainScheduledTerminalReplayQueue()
        return
      }
      scheduledTerminalReplayRunningRef.current = true
      void task.run().finally(() => {
        scheduledTerminalReplayRunningRef.current = false
        drainScheduledTerminalReplayQueue()
      })
    }

    if (win.requestIdleCallback) {
      scheduledTerminalReplayHandleRef.current = {
        kind: 'idle',
        id: win.requestIdleCallback(runNext, { timeout: BACKGROUND_TERMINAL_REPLAY_TIMEOUT_MS }),
      }
      return
    }

    scheduledTerminalReplayHandleRef.current = {
      kind: 'timeout',
      id: window.setTimeout(
        () => runNext({ didTimeout: true, timeRemaining: () => 0 }),
        BACKGROUND_TERMINAL_REPLAY_FALLBACK_DELAY_MS,
      ),
    }
  }, [])

  const scheduleTerminalReplay = useCallback(
    (task: ScheduledTerminalReplayTask, priority: 'active' | 'background') => {
      scheduledTerminalReplayQueueRef.current = scheduledTerminalReplayQueueRef.current.filter(
        (queued) => queued.stationId !== task.stationId || queued.sink !== task.sink,
      )
      if (priority === 'active') {
        if (scheduledTerminalReplayRunningRef.current) {
          scheduledTerminalReplayQueueRef.current.unshift(task)
          drainScheduledTerminalReplayQueue()
          return
        }
        scheduledTerminalReplayRunningRef.current = true
        void task.run().finally(() => {
          scheduledTerminalReplayRunningRef.current = false
          drainScheduledTerminalReplayQueue()
        })
        return
      }
      scheduledTerminalReplayQueueRef.current.push(task)
      drainScheduledTerminalReplayQueue()
    },
    [drainScheduledTerminalReplayQueue],
  )

  const waitForNextTerminalReplayFrame = useCallback((): Promise<void> => {
    if (typeof window === 'undefined') {
      return Promise.resolve()
    }
    return waitForStationTerminalFrameFlush({
      requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
      cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (id) => window.clearTimeout(id),
    })
  }, [])

  // ── Sink binding ───────────────────────────────────────────────────────
  const bindStationTerminalSink = useMemo<StationTerminalSinkBindingHandler>(
    () => (stationId, sink, meta) => {
      flushPendingStationTerminalOutput(stationId)
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
                viewportY: meta.restoreViewportY ?? null,
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
      const previousSink = stationTerminalSinkRef.current[stationId]
      if (
        !shouldReplayStationTerminalSinkBinding({
          previousSink,
          nextSink: sink,
          hasPendingReplay: Boolean(stationTerminalPendingReplayRef.current[stationId]),
        })
      ) {
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
      const restoreStateToReplay = shouldPreferSessionOwnedRestoreState(
        restoreState,
        stationTerminalsRef.current[stationId]?.sessionId ?? null,
        outputRevision,
      )
        ? restoreState
        : null
      const replaySource = selectStationTerminalReplaySource({
        cachedContent,
        restoreState: restoreStateToReplay?.state ?? null,
      })
      const replayVersion = (stationTerminalPendingReplayRef.current[stationId]?.version ?? 0) + 1
      stationTerminalPendingReplayRef.current[stationId] = {
        version: replayVersion,
        ops: [],
      }
      if (replaySource.kind === 'restore') {
        if (isStationTerminalDebugEnabled(stationId)) {
          pushStationTerminalDebugRecord(stationId, {
            sessionId: stationTerminalsRef.current[stationId]?.sessionId ?? null,
            lane: 'xterm',
            kind: 'restore',
            source: 'session_restore',
            summary: formatTerminalDebugPreview(replaySource.state.content, 84),
            body: replaySource.state.content,
          })
        }
      } else {
        delete stationTerminalRestoreStateRef.current[stationId]
      }
      scheduleTerminalReplay(
        {
          stationId,
          sink,
          replayVersion,
          run: async () => {
            if (
              stationTerminalSinkRef.current[stationId] !== sink ||
              stationTerminalPendingReplayRef.current[stationId]?.version !== replayVersion
            ) {
              return
            }
            const replay =
              replaySource.kind === 'restore'
                ? sink.restore(
                    replaySource.state.content,
                    replaySource.state.cols,
                    replaySource.state.rows,
                    replaySource.state.viewportY,
                  )
                : sink.reset(replaySource.content)
            await replay
            const pendingReplay = stationTerminalPendingReplayRef.current[stationId]
            if (
              !pendingReplay ||
              pendingReplay.version !== replayVersion ||
              stationTerminalSinkRef.current[stationId] !== sink
            ) {
              return
            }
            const pendingOps = compactStationTerminalPendingReplayOps(pendingReplay.ops, {
              writeChunkCharLimit: TERMINAL_REPLAY_WRITE_CHUNK_CHAR_LIMIT,
            })
            delete stationTerminalPendingReplayRef.current[stationId]
            await drainStationTerminalPendingReplayOps(sink, pendingOps, {
              shouldContinue: () => stationTerminalSinkRef.current[stationId] === sink,
              yieldBetweenWrites: waitForNextTerminalReplayFrame,
            })
          },
        },
        meta?.restorePriority === 'active' ? 'active' : 'background',
      )
    },
    [
      flushPendingStationTerminalOutput,
      pushStationTerminalDebugRecord,
      scheduleTerminalReplay,
      waitForNextTerminalReplayFrame,
    ],
  )

  // ── Session visibility ────────────────────────────────────────────────
  const ensureTerminalSessionVisible = useCallback((workspaceId: string, sessionId: string) => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (terminalSessionVisibilityRef.current[sessionId]) {
      return
    }
    void desktopApi
      .terminalSetVisibility(workspaceId, sessionId, true)
      .then((response) => {
        if (
          !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, sessionId) ||
          response.visible !== true ||
          activeWorkspaceIdRef.current !== workspaceId
        ) {
          return
        }
        terminalSessionVisibilityRef.current[sessionId] = true
      })
      .catch((error) => {
        recordStationRuntimeDiagnosticBySession(
          sessionId,
          'visibility-sync-miss',
          `visible=true;workspace=${workspaceId};detail=${describeError(error)}`,
        )
        // Ignore transient sync failure; next render cycle will retry.
      })
  }, [activeWorkspaceIdRef, recordStationRuntimeDiagnosticBySession])

  const requestTerminalKill = useCallback(
    (input: {
      sessionId: string
      signal: 'TERM' | 'KILL'
      reason: string
      stationId?: string | null
      workspaceId?: string | null
    }) => {
      recordStationLifecycleDiagnostic(
        input.stationId ?? sessionStationRef.current[input.sessionId] ?? 'session',
        input.sessionId,
        'terminal-kill-request',
        [
          `signal=${input.signal}`,
          `reason=${input.reason}`,
          `workspace=${input.workspaceId ?? 'none'}`,
          `mappedStation=${sessionStationRef.current[input.sessionId] ?? 'none'}`,
        ].join(';'),
      )
      if (!input.workspaceId) {
        return Promise.reject(
          new Error(`TERMINAL_WORKSPACE_REQUIRED: workspace_id is required to kill session '${input.sessionId}'`),
        )
      }
      return desktopApi.terminalKill(input.workspaceId, input.sessionId, input.signal)
    },
    [recordStationLifecycleDiagnostic],
  )

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
    (
      workspaceId: string,
      stationId: string,
      sessionId: string,
      detail: string = 'TERMINAL_SESSION_NOT_FOUND',
    ) => {
      recordStationLifecycleDiagnostic(
        stationId,
        sessionId,
        'missing-session-cleanup',
        `workspace=${workspaceId};detail=${detail}`,
      )
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
    [recordStationLifecycleDiagnostic, setStationTerminalState],
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
        const delta = await desktopApi.terminalReadDelta(workspaceId, sessionId, previousSeq)
        if (
          !isMatchingTerminalWorkspaceSessionResponse(delta, workspaceId, sessionId) ||
          activeWorkspaceIdRef.current !== workspaceId ||
          sessionStationRef.current[sessionId] !== stationId
        ) {
          return false
        }
        if (delta.gap || delta.truncated) {
          const snapshot = await desktopApi.terminalReadSnapshot(workspaceId, sessionId).catch(() => null)
          if (!snapshot) {
            return true
          }
          if (
            !isMatchingTerminalWorkspaceSessionResponse(snapshot, workspaceId, sessionId) ||
            activeWorkspaceIdRef.current !== workspaceId ||
            sessionStationRef.current[sessionId] !== stationId
          ) {
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
          scheduleTerminalDocumentPersist()
          return true
        }

        if (delta.toSeq > previousSeq) {
          const text = decodeBase64Chunk(sessionId, delta.chunk, true)
          if (text) {
            appendStationTerminalOutput(stationId, text)
          }
          terminalSessionSeqRef.current[sessionId] = delta.toSeq
          scheduleTerminalDocumentPersist()
        }
        return true
      } catch (error) {
        const detail = describeError(error)
        if (isTerminalSessionBindingInvalid(detail)) {
          cleanupMissingWorkspaceTerminalSession(workspaceId, stationId, sessionId, detail)
        }
        return false
      }
    },
    [
      appendStationTerminalOutput,
      cleanupMissingWorkspaceTerminalSession,
      decodeBase64Chunk,
      resetStationTerminalOutput,
      scheduleTerminalDocumentPersist,
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
            const response = await desktopApi.terminalSetVisibility(workspaceId, sessionId, true)
            if (
              !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, sessionId) ||
              response.visible !== true ||
              activeWorkspaceIdRef.current !== workspaceId ||
              sessionStationRef.current[sessionId] !== stationId
            ) {
              return
            }
            terminalSessionVisibilityRef.current[sessionId] = true
            const document = workspaceTerminalCacheRef.current[workspaceId]
            if (document) {
              document.sessionVisibility[sessionId] = true
            }
          } catch (error) {
            const detail = describeError(error)
            recordStationRuntimeDiagnosticBySession(
              sessionId,
              'visibility-sync-miss',
              `visible=true;detail=${detail}`,
            )
            if (isTerminalSessionBindingInvalid(detail)) {
              cleanupMissingWorkspaceTerminalSession(workspaceId, stationId, sessionId, detail)
            }
            return
          }
          await recoverStationTerminalOutput(workspaceId, stationId, sessionId)
        })()
      })
    },
    [
      cleanupMissingWorkspaceTerminalSession,
      recordStationRuntimeDiagnosticBySession,
      recoverStationTerminalOutput,
    ],
  )

  const scheduleStationTerminalOutputRecovery = useCallback(
    (workspaceId: string | null, stationId: string, sessionId: string | null, delayMs = 28) => {
      if (!desktopApi.isTauriRuntime() || !workspaceId || !stationId || !sessionId) {
        return
      }
      const recoveryKey = `${workspaceId}:${stationId}:${sessionId}`
      const existingTimer = scheduledStationOutputRecoveryRef.current[recoveryKey]
      if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer)
      }
      scheduledStationOutputRecoveryRef.current[recoveryKey] = window.setTimeout(() => {
        delete scheduledStationOutputRecoveryRef.current[recoveryKey]
        void recoverStationTerminalOutput(workspaceId, stationId, sessionId)
      }, delayMs)
    },
    [recoverStationTerminalOutput],
  )

  const clearScheduledStationTerminalOutputRecoveries = useCallback(() => {
    Object.values(scheduledStationOutputRecoveryRef.current).forEach((timerId) => {
      window.clearTimeout(timerId)
    })
    scheduledStationOutputRecoveryRef.current = {}
  }, [])

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
        void requestTerminalKill({
          sessionId: previousSessionId,
          signal: 'TERM',
          reason: 'cache-background-session-superseded',
          stationId: input.station.id,
          workspaceId: input.workspaceId,
        }).catch(() => {
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
        .terminalSetVisibility(input.workspaceId, sessionId, false)
        .catch((error) => {
          const detail = describeError(error)
          recordStationLifecycleDiagnostic(
            input.station.id,
            sessionId,
            'visibility-sync-miss',
            `visible=false;detail=${detail};context=background-cache`,
          )
          if (isTerminalSessionBindingInvalid(detail)) {
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
    [locale, recordStationLifecycleDiagnostic, requestTerminalKill],
  )

  // ── Terminal event subscription ────────────────────────────────────────
  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    // Keep focus changes out of the subscription lifecycle. Rebinding these
    // listeners on every active-station switch can drop live terminal events.
    let disposed = false
    let cleanup: (() => void) | null = null
    type TerminalEventTarget =
      | { kind: 'active'; stationId: string }
      | {
          kind: 'cached'
          owner: { workspaceId: string; stationId: string; document: WorkspaceTerminalSessionDocument }
        }
    const terminalEventTargetCache = new Map<string, TerminalEventTarget>()
    const resolveTerminalEventTarget = (payload: { workspaceId: string; sessionId: string }) => {
      const cacheKey = `${payload.workspaceId}:${payload.sessionId}`
      const cachedTarget = terminalEventTargetCache.get(cacheKey)
      if (cachedTarget?.kind === 'active') {
        if (
          payload.workspaceId === activeWorkspaceIdRef.current &&
          sessionStationRef.current[payload.sessionId] === cachedTarget.stationId
        ) {
          return cachedTarget
        }
        terminalEventTargetCache.delete(cacheKey)
      } else if (cachedTarget?.kind === 'cached') {
        const { owner } = cachedTarget
        if (
          owner.workspaceId === payload.workspaceId &&
          workspaceTerminalCacheRef.current[owner.workspaceId] === owner.document &&
          owner.document.sessionStation[payload.sessionId] === owner.stationId
        ) {
          return cachedTarget
        }
        terminalEventTargetCache.delete(cacheKey)
      }
      if (payload.workspaceId === activeWorkspaceIdRef.current) {
        const stationId = sessionStationRef.current[payload.sessionId]
        if (stationId) {
          const target = { kind: 'active' as const, stationId }
          terminalEventTargetCache.set(cacheKey, target)
          return target
        }
      }
      const owner = findWorkspaceTerminalSessionOwner(
        workspaceTerminalCacheRef.current,
        payload.sessionId,
      )
      if (owner?.workspaceId === payload.workspaceId) {
        const target = { kind: 'cached' as const, owner }
        terminalEventTargetCache.set(cacheKey, target)
        return target
      }
      terminalEventTargetCache.delete(cacheKey)
      return null
    }
    const queueCachedTerminalOutputPayload = (
      owner: { workspaceId: string; stationId: string; document: WorkspaceTerminalSessionDocument },
      payload: TerminalOutputPayload,
    ) => {
      const seq = owner.document.sessionSeq[payload.sessionId] ?? 0
      if (payload.seq <= seq) {
        return
      }
      queueCachedTerminalOutputAppend({
        workspaceId: owner.workspaceId,
        stationId: owner.stationId,
        sessionId: payload.sessionId,
        seq: payload.seq,
        base64Chunk: payload.chunk,
        unreadDelta: 1,
      })
    }
    void desktopApi
      .subscribeTerminalEvents({
        onOutput: (payload: TerminalOutputPayload) => {
          const initialTarget = resolveTerminalEventTarget(payload)
          if (!initialTarget) {
            return
          }
          if (disposed) {
            return
          }
          if (initialTarget.kind === 'cached') {
            queueCachedTerminalOutputPayload(initialTarget.owner, payload)
            return
          }
          if (!terminalOutputQueueRef.current[payload.sessionId]) {
            const stationId = initialTarget.stationId
            const seq = terminalSessionSeqRef.current[payload.sessionId] ?? 0
            const sequenceAction = resolveTerminalOutputSequenceAction(payload.seq, seq)
            if (sequenceAction === 'stale') {
              return
            }
            const terminalDebugEnabled = isStationTerminalDebugEnabled(stationId)
            let debugDirectText = ''
            if (terminalDebugEnabled) {
              debugDirectText = decodeBase64Chunk(payload.sessionId, payload.chunk, true)
              pushStationTerminalDebugRecord(stationId, {
                atMs: payload.tsMs,
                sessionId: payload.sessionId,
                lane: 'event',
                kind: 'output',
                source: 'terminal/output',
                summary: `seq ${payload.seq} · ${formatTerminalDebugPreview(debugDirectText || payload.chunk, 72)}`,
                body: [
                  `workspace=${payload.workspaceId}`,
                  `seq=${payload.seq}`,
                  `tsMs=${payload.tsMs}`,
                  `base64=${payload.chunk}`,
                  '',
                  'decoded:',
                  debugDirectText,
                ].join('\n'),
              })
            }
            if (sequenceAction === 'append') {
              const text = terminalDebugEnabled
                ? debugDirectText
                : decodeBase64Chunk(payload.sessionId, payload.chunk, true)
              if (text) {
                appendStationTerminalOutput(stationId, text)
              }
              terminalSessionSeqRef.current[payload.sessionId] = payload.seq
              if (!text) {
                scheduleTerminalDocumentPersist()
              }
              if (stationId !== activeStationIdRef.current) {
                incrementStationUnread(stationId, 1)
              }
              return
            }
          }
          const previous = terminalOutputQueueRef.current[payload.sessionId] ?? Promise.resolve()
          let queuedOutput: Promise<void>
          queuedOutput = previous
            .catch(() => undefined)
            .then(async () => {
              if (disposed) {
                return
              }
              const target = resolveTerminalEventTarget(payload)
              if (!target) {
                return
              }
              if (target.kind === 'cached') {
                queueCachedTerminalOutputPayload(target.owner, payload)
                return
              }
              const stationId = target.stationId
              const seq = terminalSessionSeqRef.current[payload.sessionId] ?? 0
              const sequenceAction = resolveTerminalOutputSequenceAction(payload.seq, seq)
              if (sequenceAction === 'stale') {
                return
              }
              const terminalDebugEnabled = isStationTerminalDebugEnabled(stationId)
              let debugDirectText = ''
              if (terminalDebugEnabled) {
                debugDirectText = decodeBase64Chunk(payload.sessionId, payload.chunk, true)
                pushStationTerminalDebugRecord(stationId, {
                  atMs: payload.tsMs,
                  sessionId: payload.sessionId,
                  lane: 'event',
                  kind: 'output',
                  source: 'terminal/output',
                  summary: `seq ${payload.seq} · ${formatTerminalDebugPreview(debugDirectText || payload.chunk, 72)}`,
                  body: [
                    `workspace=${payload.workspaceId}`,
                    `seq=${payload.seq}`,
                    `tsMs=${payload.tsMs}`,
                    `base64=${payload.chunk}`,
                    '',
                    'decoded:',
                    debugDirectText,
                  ].join('\n'),
                })
              }
              const unread = stationId !== activeStationIdRef.current
              if (sequenceAction === 'append') {
                const text = terminalDebugEnabled
                  ? debugDirectText
                  : decodeBase64Chunk(payload.sessionId, payload.chunk, true)
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSessionSeqRef.current[payload.sessionId] = payload.seq
                if (!text) {
                  scheduleTerminalDocumentPersist()
                }
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const workspaceId = payload.workspaceId
              if (activeWorkspaceIdRef.current !== workspaceId) {
                return
              }
              const delta = await desktopApi
                .terminalReadDelta(workspaceId, payload.sessionId, seq)
                .catch((error) => {
                  const detail = describeError(error)
                  if (isTerminalSessionBindingInvalid(detail)) {
                    cleanupMissingWorkspaceTerminalSession(
                      workspaceId,
                      stationId,
                      payload.sessionId,
                      detail,
                    )
                  }
                  return null
                })
              if (
                delta &&
                !isMatchingTerminalWorkspaceSessionResponse(delta, workspaceId, payload.sessionId)
              ) {
                return
              }
              if (
                activeWorkspaceIdRef.current !== workspaceId ||
                sessionStationRef.current[payload.sessionId] !== stationId
              ) {
                return
              }
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
                if (terminalDebugEnabled) {
                  pushStationTerminalDebugRecord(stationId, {
                    sessionId: payload.sessionId,
                    lane: 'recovery',
                    kind: 'delta',
                    source: 'terminal_read_delta',
                    summary: `delta ${delta.fromSeq ?? '?'}-${delta.toSeq} · ${formatTerminalDebugPreview(text || delta.chunk, 72)}`,
                    body: [
                      `workspace=${workspaceId}`,
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
                }
                if (text) {
                  appendStationTerminalOutput(stationId, text)
                }
                terminalSessionSeqRef.current[payload.sessionId] = delta.toSeq
                if (!text) {
                  scheduleTerminalDocumentPersist()
                }
                if (unread) {
                  incrementStationUnread(stationId, 1)
                }
                return
              }

              const snapshot = await desktopApi
                .terminalReadSnapshot(workspaceId, payload.sessionId)
                .catch((error) => {
                  const detail = describeError(error)
                  if (isTerminalSessionBindingInvalid(detail)) {
                    cleanupMissingWorkspaceTerminalSession(
                      workspaceId,
                      stationId,
                      payload.sessionId,
                      detail,
                    )
                  }
                  return null
                })
              if (!snapshot) {
                return
              }
              if (
                !isMatchingTerminalWorkspaceSessionResponse(snapshot, workspaceId, payload.sessionId) ||
                activeWorkspaceIdRef.current !== workspaceId ||
                sessionStationRef.current[payload.sessionId] !== stationId
              ) {
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
              if (terminalDebugEnabled) {
                pushStationTerminalDebugRecord(stationId, {
                  sessionId: payload.sessionId,
                  lane: 'recovery',
                  kind: 'snapshot',
                  source: 'terminal_read_snapshot',
                  summary: `snapshot @${snapshot.currentSeq} · ${formatTerminalDebugPreview(snapshotText || snapshot.chunk, 72)}`,
                  body: [
                    `workspace=${workspaceId}`,
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
              }
              resetStationTerminalOutput(stationId, snapshotText)
              terminalSessionSeqRef.current[payload.sessionId] = snapshot.currentSeq
              scheduleTerminalDocumentPersist()
              if (unread) {
                incrementStationUnread(stationId, 1)
              }
            })
            .finally(() => {
              if (terminalOutputQueueRef.current[payload.sessionId] === queuedOutput) {
                delete terminalOutputQueueRef.current[payload.sessionId]
              }
            })
          terminalOutputQueueRef.current[payload.sessionId] = queuedOutput
        },
        onStateChanged: (payload: TerminalStatePayload) => {
          const target = resolveTerminalEventTarget(payload)
          if (!target) {
            return
          }
          const stateDetail = [
            `workspace=${payload.workspaceId}`,
            `from=${payload.from}`,
            `to=${payload.to}`,
            `tsMs=${payload.tsMs}`,
          ].join(';')
          if (target.kind === 'cached') {
            flushCachedTerminalOutputAppendQueue()
            const { owner } = target
            recordStationLifecycleDiagnostic(
              owner.stationId,
              payload.sessionId,
              'terminal-state-event',
              stateDetail,
            )
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
          const stationId = target.stationId
          recordStationLifecycleDiagnostic(
            stationId,
            payload.sessionId,
            'terminal-state-event',
            stateDetail,
          )
          if (isStationTerminalDebugEnabled(stationId)) {
            pushStationTerminalDebugRecord(stationId, {
              atMs: payload.tsMs,
              sessionId: payload.sessionId,
              lane: 'event',
              kind: 'state',
              source: 'terminal/state_changed',
              summary: `${payload.from} -> ${payload.to}`,
              body: [
                `workspace=${payload.workspaceId}`,
                `from=${payload.from}`,
                `to=${payload.to}`,
                `tsMs=${payload.tsMs}`,
              ].join('\n'),
            })
          }
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
              delete protectedAgentSessionByStationRef.current[stationId]
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
          const target = resolveTerminalEventTarget(payload)
          if (!target) {
            return
          }
          if (target.kind === 'cached') {
            const { owner } = target
            queueCachedTerminalUnreadDelta({
              workspaceId: owner.workspaceId,
              stationId: owner.stationId,
              sessionId: payload.sessionId,
              unreadDelta: Math.max(1, Math.min(99, payload.unreadChunks || 1)),
            })
            return
          }
          const stationId = target.stationId
          const terminalDebugEnabled = isStationTerminalDebugEnabled(stationId)
          const tail = terminalDebugEnabled
            ? decodeBase64Chunk(payload.sessionId, payload.tailChunk, true)
            : ''
          if (terminalDebugEnabled) {
            pushStationTerminalDebugRecord(stationId, {
              atMs: payload.tsMs,
              sessionId: payload.sessionId,
              lane: 'event',
              kind: 'meta',
              source: 'terminal/meta',
              summary: `chunks ${payload.unreadChunks} · ${formatTerminalDebugPreview(tail || payload.tailChunk, 72)}`,
              body: [
                `workspace=${payload.workspaceId}`,
                `unreadBytes=${payload.unreadBytes}`,
                `unreadChunks=${payload.unreadChunks}`,
                `tsMs=${payload.tsMs}`,
                `base64=${payload.tailChunk}`,
                '',
                'decoded:',
                tail,
              ].join('\n'),
            })
          }
          if (tail) {
            appendStationTerminalOutput(stationId, tail)
          }
          if (stationId !== activeStationIdRef.current) {
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
      flushCachedTerminalOutputAppendQueue()
      flushPendingStationTerminalOutput()
      flushScheduledTerminalDocumentPersist()
    }
  }, [
    appendStationTerminalOutput,
    cleanupMissingWorkspaceTerminalSession,
    decodeBase64Chunk,
    flushCachedTerminalOutputAppendQueue,
    flushPendingStationTerminalOutput,
    flushScheduledTerminalDocumentPersist,
    incrementStationUnread,
    queueCachedTerminalOutputAppend,
    queueCachedTerminalUnreadDelta,
    persistActiveWorkspaceTerminalDocument,
    pushStationTerminalDebugRecord,
    recordStationLifecycleDiagnostic,
    recordStationRuntimeDiagnosticBySession,
    resetStationTerminalOutput,
    scheduleTerminalDocumentPersist,
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

  // ── Active station unread clear ────────────────────────────────────────
  useEffect(() => {
    if (!activeStationId) {
      return
    }
    clearStationUnread(activeStationId)
  }, [activeStationId, clearStationUnread])

  // ── Terminal session visibility ────────────────────────────────────────
  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
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
      if (terminalSessionVisibilityRef.current[sessionId]) {
        return
      }
      ensureTerminalSessionVisible(activeWorkspaceId, sessionId)
    })

    Object.keys(terminalSessionVisibilityRef.current).forEach((sessionId) => {
      if (desiredVisibility[sessionId] === undefined) {
        delete terminalSessionVisibilityRef.current[sessionId]
      }
    })
  }, [activeWorkspaceId, ensureTerminalSessionVisible, stationTerminals])

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

            const launchesFromWorkspaceRoot = isWorkspaceRootWorkdir(station.agentWorkdirRel)
            if (!launchesFromWorkspaceRoot) {
              await desktopApi.fsCreateDir(launchWorkspaceId, station.agentWorkdirRel)
            }
            const agentWorkspaceCwd = resolveAgentWorkdirAbs(workspaceRoot, station.agentWorkdirRel)
            const terminalEnv = {
              GTO_WORKSPACE_ID: activeWorkspaceId,
              GTO_AGENT_ID: station.id,
              GTO_ROLE_KEY: station.role,
              GTO_STATION_ID: station.id,
            }
            const session = await desktopApi.terminalCreate(launchWorkspaceId, {
              cwd: launchesFromWorkspaceRoot ? null : agentWorkspaceCwd,
              cwdMode: launchesFromWorkspaceRoot ? 'workspace_root' : 'custom',
              env: terminalEnv,
              agentToolKind: normalizeStationToolKind(station.tool),
              injectProviderEnv: false,
              loginShell: true,
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
                void requestTerminalKill({
                  sessionId: droppedSessionCleanup.sessionId,
                  signal: droppedSessionCleanup.signal,
                  reason: 'dropped-async-station-launch',
                  stationId,
                  workspaceId: launchWorkspaceId,
                }).catch(() => {
                  // Dropped async station launches must not leave orphan backend sessions behind.
                })
              }
              return null
            }
            sessionStationRef.current[session.sessionId] = stationId
            terminalSessionSeqRef.current[session.sessionId] = 0
            delete stationTerminalRestoreStateRef.current[stationId]
            ensureTerminalSessionVisible(launchWorkspaceId, session.sessionId)
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
      requestTerminalKill,
      resetStationTerminalOutput,
      resolveWorkspaceRoot,
      setStationTerminalState,
    ],
  )

  const focusStationTerminal = useCallback(async (stationId: string): Promise<boolean> => {
    return focusStationTerminalSinkWithFrameRetry({
      maxRetryFrames: STATION_TERMINAL_FOCUS_MAX_RETRY_FRAMES,
      scheduler: createStationTerminalFrameFlushScheduler(window),
      fallbackDelayMs: STATION_TERMINAL_FOCUS_RETRY_FALLBACK_DELAY_MS,
      focus: () => {
        const sink = stationTerminalSinkRef.current[stationId]
        if (!sink) {
          return false
        }
        sink.focus()
        return true
      },
    })
  }, [])

  const refocusStationTerminal = useCallback(
    (stationId: string) => {
      void focusStationTerminal(stationId)
    },
    [focusStationTerminal],
  )

  const launchStationTerminal = useMemo(
    () => async (stationId: string) => {
      await ensureStationTerminalSession(stationId)
      await focusStationTerminal(stationId)
    },
    [ensureStationTerminalSession, focusStationTerminal],
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
              const runtime = stationTerminalsRef.current[targetStationId]
              const sessionId = runtime?.sessionId ?? null
              const workspaceId = activeWorkspaceIdRef.current
              if (!workspaceId || !sessionId || !shouldForwardStationTerminalInput(runtime)) {
                return
              }
              ensureTerminalSessionVisible(workspaceId, sessionId)
              const response = await desktopApi.terminalWrite(workspaceId, sessionId, queuedInput)
              if (
                !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, sessionId) ||
                activeWorkspaceIdRef.current !== workspaceId ||
                stationTerminalsRef.current[targetStationId]?.sessionId !== sessionId
              ) {
                return
              }
              if (!response.accepted) {
                appendStationTerminalOutput(
                  targetStationId,
                  t(locale, 'system.sendFailed', {
                    detail: TERMINAL_WRITE_REJECTED_DETAIL,
                  }),
                )
                return
              }
              scheduleStationTerminalOutputRecovery(workspaceId, targetStationId, sessionId)
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
    [
      appendStationTerminalOutput,
      ensureStationTerminalSession,
      ensureTerminalSessionVisible,
      locale,
      scheduleStationTerminalOutputRecovery,
    ],
  )

  // ── Submit station terminal ────────────────────────────────────────────
  const submitStationTerminal = useCallback(async (stationId: string): Promise<boolean> => {
    return submitStationTerminalWithFrameRetry({
      maxRetryFrames: STATION_TASK_SUBMIT_MAX_RETRY_FRAMES,
      scheduler: createStationTerminalFrameFlushScheduler(window),
      fallbackDelayMs: STATION_TASK_SUBMIT_RETRY_FALLBACK_DELAY_MS,
      submit: () => stationTerminalSinkRef.current[stationId]?.submit?.() ?? false,
    })
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

      const workspaceId = activeWorkspaceIdRef.current
      if (!workspaceId) {
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
        if (!shouldForwardStationTerminalInput(stationTerminalsRef.current[stationId])) {
          return false
        }
        ensureTerminalSessionVisible(workspaceId, sessionId)
        const response = await desktopApi.terminalWriteWithSubmit(
          workspaceId,
          sessionId,
          input,
          stationSubmitSequenceRef.current[stationId] ?? '\r',
        )
        if (
          !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, sessionId) ||
          activeWorkspaceIdRef.current !== workspaceId ||
          stationTerminalsRef.current[stationId]?.sessionId !== sessionId
        ) {
          return false
        }
        if (!response.accepted) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.sendFailed', {
              detail: TERMINAL_WRITE_REJECTED_DETAIL,
            }),
          )
          return false
        }
        scheduleStationTerminalOutputRecovery(workspaceId, stationId, sessionId)
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
    [
      appendStationTerminalOutput,
      ensureStationTerminalSession,
      ensureTerminalSessionVisible,
      locale,
      scheduleStationTerminalOutputRecovery,
      submitStationTerminal,
    ],
  )

  const runStationTerminalCommand = useCallback(
    async (stationId: string, command: string): Promise<boolean> => {
      if (!command || !desktopApi.isTauriRuntime()) {
        return false
      }

      const workspaceId = activeWorkspaceIdRef.current
      if (!workspaceId) {
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
        if (!shouldForwardStationTerminalInput(stationTerminalsRef.current[stationId])) {
          return false
        }
        ensureTerminalSessionVisible(workspaceId, sessionId)
        const chunks = buildStationTerminalCommandSubmitChunks(
          command,
          stationSubmitSequenceRef.current[stationId] ?? '\r',
        )
        for (let index = 0; index < chunks.length; index += 1) {
          // Shell launch commands should submit once; the extra hard-Enter path is reserved for
          // interactive prompt submission after the tool is already running.
          const response = await desktopApi.terminalWrite(workspaceId, sessionId, chunks[index])
          if (
            !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, sessionId) ||
            activeWorkspaceIdRef.current !== workspaceId ||
            stationTerminalsRef.current[stationId]?.sessionId !== sessionId
          ) {
            return false
          }
          if (!response.accepted) {
            appendStationTerminalOutput(
              stationId,
              t(locale, 'system.sendFailed', {
                detail: TERMINAL_WRITE_REJECTED_DETAIL,
              }),
            )
            return false
          }
          if (index + 1 < chunks.length) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 5)
            })
          }
        }
        scheduleStationTerminalOutputRecovery(workspaceId, stationId, sessionId)
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
    [
      appendStationTerminalOutput,
      ensureStationTerminalSession,
      ensureTerminalSessionVisible,
      locale,
      scheduleStationTerminalOutputRecovery,
    ],
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
      if (
        !sessionId ||
        !workspaceId ||
        !station ||
        !shouldForwardStationTerminalInput(stationTerminalsRef.current[stationId])
      ) {
        return false
      }

      const workspaceRoot = await resolveWorkspaceRoot(workspaceId)
      if (!workspaceRoot) {
        return false
      }

      const agentWorkspaceCwd = resolveAgentWorkdirAbs(workspaceRoot, station.agentWorkdirRel)
      const resetCommand = `cd "${agentWorkspaceCwd.replace(/"/g, '\\"')}"`

      try {
        ensureTerminalSessionVisible(workspaceId, sessionId)
        const response = await desktopApi.terminalWriteWithSubmit(
          workspaceId,
          sessionId,
          resetCommand,
          stationSubmitSequenceRef.current[stationId] ?? '\r',
        )
        if (
          !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, sessionId) ||
          activeWorkspaceIdRef.current !== workspaceId ||
          stationTerminalsRef.current[stationId]?.sessionId !== sessionId
        ) {
          return false
        }
        if (!response.accepted) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.sendFailed', {
              detail: TERMINAL_WRITE_REJECTED_DETAIL,
            }),
          )
          return false
        }
        scheduleStationTerminalOutputRecovery(workspaceId, stationId, sessionId)
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
    [
      appendStationTerminalOutput,
      ensureTerminalSessionVisible,
      locale,
      resolveWorkspaceRoot,
      scheduleStationTerminalOutputRecovery,
    ],
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
      const focusReportInput = isStationTerminalFocusReportInput(data)
      if (focusReportInput) {
        return
      }
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
      const runtime = stationTerminalsRef.current[stationId]
      const sessionId = runtime?.sessionId ?? null
      const workspaceId = activeWorkspaceIdRef.current
      const resizeDimensions = normalizeStationTerminalResizeDimensions(cols, rows)
      if (
        !workspaceId ||
        !sessionId ||
        !resizeDimensions ||
        !shouldForwardStationTerminalInput(runtime)
      ) {
        return
      }
      // Fire and forget - resize is best effort
      void desktopApi
        .terminalResize(workspaceId, sessionId, resizeDimensions.cols, resizeDimensions.rows)
        .catch(() => {
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
          flushDetachedProjectionOutputAppends()
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
        case 'detached_terminal_launch_cli_agent': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId, message.stationId)
          if (!container) {
            return
          }
          void launchStationCliAgentRef.current?.(message.stationId)
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
      flushDetachedProjectionOutputAppends,
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
      const workspaceId = activeWorkspaceIdRef.current
      if (!workspaceId || !sessionId || snapshot.sessionId !== sessionId) {
        return
      }
      if (
        !shouldReportRenderedScreenSnapshot({
          lastReported: renderedScreenReportRevisionRef.current,
          workspaceId,
          stationId,
          sessionId,
          screenRevision: snapshot.screenRevision,
        })
      ) {
        return
      }
      if (debugEnabled) {
        const screenBody = snapshot.rows.map((row) => row.text).join('\n')
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
        .terminalReportRenderedScreen(workspaceId, snapshot, toolKind)
        .then((response) => {
          if (
            !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, snapshot.sessionId) ||
            activeWorkspaceIdRef.current !== workspaceId ||
            (stationTerminalsRef.current[stationId]?.sessionId ?? null) !== snapshot.sessionId
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
    },
    [performanceDebugState.enabled, pushStationTerminalDebugRecord],
  )

  // ── Process snapshot helpers ────────────────────────────────────────────
  const inspectStationSessionProcesses = useCallback(
    async (stationId: string, sessionId: string): Promise<TerminalDescribeProcessesResponse | null> => {
      if (!desktopApi.isTauriRuntime()) {
        return null
      }

      try {
        const workspaceId = activeWorkspaceIdRef.current
        if (!workspaceId) {
          return null
        }
        const snapshot = await desktopApi.terminalDescribeProcesses(workspaceId, sessionId)
        if (
          !isMatchingTerminalWorkspaceSessionResponse(snapshot, workspaceId, sessionId) ||
          activeWorkspaceIdRef.current !== workspaceId ||
          stationTerminalsRef.current[stationId]?.sessionId !== sessionId
        ) {
          return null
        }
        return snapshot
      } catch {
        return null
      }
    },
    [],
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
          protectStationAgentSession(station.id, sessionId)
        }
        return sessionId
      }

      try {
        const launchesFromWorkspaceRoot = isWorkspaceRootWorkdir(station.agentWorkdirRel)
        if (!launchesFromWorkspaceRoot) {
          await desktopApi.fsCreateDir(workspaceId, station.agentWorkdirRel)
        }
        const response = await desktopApi.toolLaunch({
          workspaceId,
          profileId,
          context: {
            agentId: station.id,
            stationId: station.id,
            roleKey: station.role,
            toolKind: station.toolKind,
            cwd: launchesFromWorkspaceRoot ? null : station.agentWorkdirRel,
            agentWorkdirRel: launchesFromWorkspaceRoot ? undefined : station.agentWorkdirRel,
            roleWorkdirRel: station.roleWorkdirRel,
            resolvedCwd: null,
            cwdMode: launchesFromWorkspaceRoot ? 'workspace_root' : 'custom',
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
              cwdMode: launchesFromWorkspaceRoot ? 'workspace_root' : 'custom',
              resolvedCwd: response.resolvedCwd ?? stationTerminalsRef.current[station.id]?.resolvedCwd ?? null,
              submitSequence,
            })
            return null
          }
          const droppedSessionCleanup = resolveDroppedStationSessionCleanup(terminalSessionId)
          if (droppedSessionCleanup) {
            void requestTerminalKill({
              sessionId: droppedSessionCleanup.sessionId,
              signal: droppedSessionCleanup.signal,
              reason: 'dropped-async-tool-launch',
              stationId: station.id,
              workspaceId,
            }).catch(() => {
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
          void requestTerminalKill({
            sessionId: rebindCleanup.previousSessionId,
            signal: rebindCleanup.signal,
            reason: 'station-session-rebind',
            stationId: station.id,
            workspaceId,
          })
            .catch(() => {
              // Rebinding must not leave the superseded backend session running.
            })
        }

        sessionStationRef.current[terminalSessionId] = station.id
        terminalSessionSeqRef.current[terminalSessionId] = 0
        delete stationTerminalRestoreStateRef.current[station.id]

        if (response.submitSequence) {
          const normalizedSubmitSequence = normalizeSubmitSequence(response.submitSequence)
          if (normalizedSubmitSequence) {
            stationSubmitSequenceRef.current[station.id] = normalizedSubmitSequence
          }
        }

        ensureTerminalSessionVisible(workspaceId, terminalSessionId)
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
          cwdMode: launchesFromWorkspaceRoot ? 'workspace_root' : 'custom',
          resolvedCwd: response.resolvedCwd ?? stationTerminalsRef.current[station.id]?.resolvedCwd ?? null,
        })
        if (resolveStationCliLaunchCommand(station.toolKind, station.launchCommand)) {
          protectStationAgentSession(station.id, terminalSessionId)
        }

        if (station.toolKind === 'claude' || station.toolKind === 'codex') {
          const sessionCwd =
            response.resolvedCwd ?? (await resolveWorkspaceRoot(workspaceId))
          if (sessionCwd) {
            void desktopApi
              .sessionLaunch({
                workspaceId,
                stationId: station.id,
                agentId: station.id,
                provider: station.toolKind,
                cwd: sessionCwd,
                terminalSessionId,
              })
              .catch(() => {
                // Session registry is best-effort; terminal launch already succeeded.
              })
          }
        }

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
      protectStationAgentSession,
      requestTerminalKill,
      resetStationTerminalOutput,
      resolveWorkspaceRoot,
      sendStationTerminalInput,
      setStationTerminalState,
    ],
  )

  const launchCliInStationTerminal = useCallback(
    async (
      stationId: string,
      launchCommand: string,
      options?: {
        bindGtoSessionId?: string
        sessionCwd?: string | null
      },
    ): Promise<boolean> => {
      const workspaceId = activeWorkspaceIdRef.current
      if (!workspaceId || !desktopApi.isTauriRuntime()) {
        return false
      }
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      if (!station || !launchCommand.trim()) {
        return false
      }

      _setActiveStationId(stationId)

      const existingSessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      const sessionId = existingSessionId ?? (await ensureStationTerminalSession(stationId))
      if (!sessionId) {
        return false
      }

      const runtime = stationTerminalsRef.current[stationId]
      if (!runtime?.sessionId) {
        setStationTerminalState(stationId, {
          sessionId,
          stateRaw: 'running',
          unreadCount: 0,
          shell: runtime?.shell ?? null,
          cwdMode: isWorkspaceRootWorkdir(station.agentWorkdirRel) ? 'workspace_root' : 'custom',
          resolvedCwd: options?.sessionCwd ?? runtime?.resolvedCwd ?? null,
        })
      }

      sessionStationRef.current[sessionId] = stationId
      ensureTerminalSessionVisible(workspaceId, sessionId)

      void desktopApi
        .agentRuntimeRegister({
          workspaceId,
          agentId: station.id,
          stationId: station.id,
          roleKey: station.role,
          sessionId,
          toolKind: normalizeStationToolKind(station.tool),
          resolvedCwd: stationTerminalsRef.current[stationId]?.resolvedCwd ?? options?.sessionCwd ?? null,
          submitSequence: stationSubmitSequenceRef.current[stationId] ?? null,
          online: true,
        })
        .catch(() => {})

      const launched = await runStationTerminalCommand(stationId, launchCommand.trim())
      if (!launched) {
        return false
      }

      protectStationAgentSession(stationId, sessionId)

      if (options?.bindGtoSessionId) {
        void desktopApi
          .sessionResumeBind({
            workspaceId,
            gtoSessionId: options.bindGtoSessionId,
            terminalSessionId: sessionId,
            stationId: station.id,
            agentId: station.id,
          })
          .catch(() => {})
      }

      await focusStationTerminal(stationId)
      return true
    },
    [
      ensureStationTerminalSession,
      ensureTerminalSessionVisible,
      focusStationTerminal,
      protectStationAgentSession,
      runStationTerminalCommand,
      setStationTerminalState,
      _setActiveStationId,
    ],
  )

  const relaunchGtoSession = useCallback(
    async (stationId: string, request: SessionRelaunchRequest) => {
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      if (!station) {
        return
      }
      const expectedProvider = resolveStationSessionProvider(station)
      if (!expectedProvider) {
        return
      }

      const launchCommand = buildSessionRelaunchLaunchCommand(
        request.mode,
        expectedProvider,
        request.providerSessionId,
      )

      const ok = await launchCliInStationTerminal(stationId, launchCommand, {
        bindGtoSessionId: request.mode === 'resume' ? request.gtoSessionId : undefined,
        sessionCwd: request.cwd ?? null,
      })
      if (!ok) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'session.resumeFailed', {
            detail: 'launch failed',
          }),
        )
      }
    },
    [appendStationTerminalOutput, launchCliInStationTerminal, locale],
  )

  const warmStationTerminal = useCallback(
    (stationId: string) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      if (stationTerminalsRef.current[stationId]?.sessionId) {
        return
      }
      void ensureStationTerminalSession(stationId)
    },
    [ensureStationTerminalSession],
  )

  const resumeGtoSession = useCallback(
    (stationId: string, gtoSessionId: string) =>
      relaunchGtoSession(stationId, { mode: 'resume', gtoSessionId }),
    [relaunchGtoSession],
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
        await focusStationTerminal(stationId)
        return
      }

      const processSnapshot = await inspectStationSessionProcesses(stationId, currentSessionId)
      const agentRunning = isStationAgentProcessRunning(station.toolKind, processSnapshot)
      if (agentRunning) {
        protectStationAgentSession(stationId, currentSessionId)
        await focusStationTerminal(stationId)
        return
      }

      const resetCwd = await resetStationTerminalToAgentWorkdir(stationId)
      if (!resetCwd) {
        return
      }
      const launchedInSession = await runStationTerminalCommand(stationId, launchCommand)
      if (!launchedInSession) {
        return
      }
      protectStationAgentSession(stationId, currentSessionId)
      await focusStationTerminal(stationId)
    },
    [
      focusStationTerminal,
      inspectStationSessionProcesses,
      launchToolProfileForStation,
      protectStationAgentSession,
      resetStationTerminalToAgentWorkdir,
      runStationTerminalCommand,
    ],
  )
  launchStationCliAgentRef.current = launchStationCliAgent

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
          const response = await requestTerminalKill({
            sessionId: targetSessionId,
            signal: 'TERM',
            reason: 'removed-station-runtime-cleanup',
            stationId,
            workspaceId,
          })
          if (!workspaceId || !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, targetSessionId)) {
            return false
          }
          if (!response.killed) {
            appendStationTerminalOutput(
              stationId,
              t(locale, 'system.killFailed', {
                detail: TERMINAL_KILL_REJECTED_DETAIL,
              }),
            )
            return false
          }
        } catch (error) {
          const detail = describeError(error)
          if (!isTerminalSessionBindingInvalid(detail)) {
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
      delete protectedAgentSessionByStationRef.current[stationId]

      setStations((prev) => prev.filter((station) => station.id !== stationId))
      setStationTerminals((prev) => {
        const next = { ...prev }
        delete next[stationId]
        stationTerminalsRef.current = next
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
    [
      appendStationTerminalOutput,
      externalChannelController.removeStationTaskSignal,
      locale,
      requestTerminalKill,
      setStations,
      setStationTerminalState,
    ],
  )

  // ── Remove station ─────────────────────────────────────────────────────
  const removeStation = useCallback(
    async (stationId: string) => {
      const workspaceId = activeWorkspaceIdRef.current
      recordStationLifecycleDiagnostic(
        stationId,
        stationTerminalsRef.current[stationId]?.sessionId ?? null,
        'remove-station-request',
        workspaceId ?? 'workspace:none',
      )
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
        } catch (error) {
          console.error('[removeStation] agentDelete failed:', error)
          return
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
    [cleanupRemovedStationRuntimeState, recordStationLifecycleDiagnostic],
  )

  // ── Force close station terminal (two-step: confirm then kill) ───────
  const forceCloseStationTerminal = useCallback((stationId: string) => {
    const runtime = stationTerminalsRef.current[stationId]
    if (!runtime?.sessionId) {
      return
    }
    recordStationLifecycleDiagnostic(
      stationId,
      runtime.sessionId,
      'force-close-request',
      'dialog-open',
    )
    setForceCloseConfirmPendingId(stationId)
  }, [recordStationLifecycleDiagnostic])

  const confirmForceCloseStationTerminal = useCallback(async () => {
    const stationId = forceCloseConfirmPendingId
    if (!stationId) {
      return
    }
    setForceCloseConfirmPendingId(null)
    const runtime = stationTerminalsRef.current[stationId]
    const sessionId = runtime?.sessionId ?? null
    if (!sessionId) {
      return
    }
    recordStationLifecycleDiagnostic(stationId, sessionId, 'force-close-confirm', 'kill-request')
    const station = stationsRef.current.find((entry) => entry.id === stationId)

    const workspaceId = activeWorkspaceIdRef.current
    try {
      if (desktopApi.isTauriRuntime()) {
        const response = await requestTerminalKill({
          sessionId,
          signal: 'KILL',
          reason: 'force-close-confirmed',
          stationId,
          workspaceId,
        })
        if (!workspaceId || !isMatchingTerminalWorkspaceSessionResponse(response, workspaceId, sessionId)) {
          return
        }
        if (!response.killed) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.killFailed', {
              detail: TERMINAL_KILL_REJECTED_DETAIL,
            }),
          )
          return
        }
      }
    } catch (error) {
      const detail = describeError(error)
      if (!isTerminalSessionBindingInvalid(detail)) {
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.killFailed', {
            detail,
          }),
        )
        return
      }
    }

    delete sessionStationRef.current[sessionId]
    delete terminalSessionSeqRef.current[sessionId]
    delete terminalOutputQueueRef.current[sessionId]
    delete terminalSessionVisibilityRef.current[sessionId]
    delete terminalChunkDecoderBySessionRef.current[sessionId]
    delete stationSubmitSequenceRef.current[stationId]
    delete stationTerminalRestoreStateRef.current[stationId]
    stationTerminalInputControllerRef.current?.clear(stationId)

    if (workspaceId) {
      const document = workspaceTerminalCacheRef.current[workspaceId]
      if (document) {
        removeWorkspaceTerminalSessionBinding(document, sessionId, 'killed')
      }
      void desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {
        // Runtime sync will reconcile if a later session is started.
      })
    }

    resetStationTerminalOutput(stationId, station ? getStationIdleBanner(station) : undefined)
    setStationTerminalState(stationId, {
      sessionId: null,
      stateRaw: 'idle',
      unreadCount: 0,
      shell: null,
      cwdMode: 'workspace_root',
      resolvedCwd: null,
    })
  }, [
    forceCloseConfirmPendingId,
    appendStationTerminalOutput,
    locale,
    recordStationLifecycleDiagnostic,
    requestTerminalKill,
    resetStationTerminalOutput,
    setStationTerminalState,
  ])

  const dismissForceCloseConfirm = useCallback(() => {
    if (forceCloseConfirmPendingId) {
      recordStationLifecycleDiagnostic(
        forceCloseConfirmPendingId,
        stationTerminalsRef.current[forceCloseConfirmPendingId]?.sessionId ?? null,
        'force-close-dismiss',
      )
    }
    setForceCloseConfirmPendingId(null)
  }, [forceCloseConfirmPendingId, recordStationLifecycleDiagnostic])

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
    } catch (error) {
      console.error('[handleStationDeleteCleanupConfirm] agentDelete failed:', error)
      return
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
        const runtime = stationTerminalsRef.current[station.id]
        const agentRunning = isStationTerminalRuntimeLive(runtime)
        if (agentRunning) {
          continue
        }

        if (!sessionId) {
          await launchToolProfileForStation(station)
          continue
        }

        const launchedInSession = await runStationTerminalCommand(station.id, launchCommand)
        if (launchedInSession) {
          protectStationAgentSession(station.id, sessionId)
        }
      }
    } finally {
      setIsBatchLaunchingAgents(false)
    }
  }, [
    isBatchLaunchingAgents,
    launchToolProfileForStation,
    protectStationAgentSession,
    runStationTerminalCommand,
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
          refocusStationTerminal(station.id)
          return
        case 'insert_and_submit':
          await writeStationTerminalWithSubmit(station.id, execution.text)
          refocusStationTerminal(station.id)
          return
        case 'submit_terminal':
          await submitStationTerminal(station.id)
          refocusStationTerminal(station.id)
          return
        case 'launch_cli':
          await launchStationCliAgent(station.id)
          refocusStationTerminal(station.id)
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
    [
      handleStationTerminalInput,
      launchStationCliAgent,
      launchToolProfileForStation,
      refocusStationTerminal,
      submitStationTerminal,
      writeStationTerminalWithSubmit,
    ],
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
      await focusStationTerminal(pending.station.id)
    },
    [focusStationTerminal, handleStationTerminalInput, pendingStationActionSheet, submitStationTerminal],
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
        const runtime = stationTerminals[station.id]
        acc[station.id] = isStationTerminalRuntimeLive(runtime)
        return acc
      }, {}),
    [stationTerminals, stations],
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
            runtime?.stateRaw ?? (runtime?.sessionId ? 'running' : 'idle'),
            runtime?.resolvedCwd ?? '',
          ].join(':')
        })
        .join('|'),
    [stationTerminals, stations],
  )

  // ── Terminal state reset for workspace switch ──────────────────────────
  const resetTerminalStateOnWorkspaceSwitch = useCallback(() => {
    flushCachedTerminalOutputAppendQueue()
    cancelScheduledStationTerminalOutputFlushes()
    stationTerminalOutputFlushQueueRef.current = {}
    cancelScheduledTerminalDocumentPersist()
    clearScheduledStationTerminalOutputRecoveries()
    cancelScheduledTerminalReplayDrain()
    scheduledTerminalReplayQueueRef.current = []
    scheduledTerminalReplayRunningRef.current = false
    cancelDetachedProjectionOutputAppendFlush()
    detachedProjectionOutputAppendQueueRef.current = {}
    detachedProjectionSeqRef.current = {}
    detachedProjectionDispatchQueueRef.current = {}
    stationTerminalSinkRef.current = {}
    stationTerminalPendingReplayRef.current = {}
    stationTerminalOutputCacheRef.current = {}
    stationTerminalOutputRevisionRef.current = {}
    stationTerminalRestoreStateRef.current = {}
    sessionStationRef.current = {}
    terminalSessionSeqRef.current = {}
    terminalOutputQueueRef.current = {}
    ensureStationTerminalSessionInFlightRef.current = {}
    stationToolLaunchSeqRef.current = {}
    renderedScreenReportRevisionRef.current.clear()
    terminalSessionVisibilityRef.current = {}
    terminalChunkDecoderBySessionRef.current = {}
    stationTerminalInputControllerRef.current?.dispose()
    stationTerminalInputControllerRef.current = null
    stationSubmitSequenceRef.current = {}
    stationUnreadDeltaRef.current = {}
    protectedAgentSessionByStationRef.current = {}
    const unreadTimerId = stationUnreadFlushTimerRef.current
    if (typeof unreadTimerId === 'number') {
      window.clearTimeout(unreadTimerId)
    }
    stationUnreadFlushTimerRef.current = null
  }, [
    cancelScheduledStationTerminalOutputFlushes,
    cancelScheduledTerminalDocumentPersist,
    cancelScheduledTerminalReplayDrain,
    cancelDetachedProjectionOutputAppendFlush,
    clearScheduledStationTerminalOutputRecoveries,
    flushCachedTerminalOutputAppendQueue,
  ])

  // ── Cleanup effect ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const unreadTimerId = stationUnreadFlushTimerRef.current
      if (typeof unreadTimerId === 'number') {
        window.clearTimeout(unreadTimerId)
      }
      stationUnreadFlushTimerRef.current = null
      stationUnreadDeltaRef.current = {}
      flushCachedTerminalOutputAppendQueue()
      flushPendingStationTerminalOutput()
      flushScheduledTerminalDocumentPersist()
      cancelScheduledStationTerminalOutputFlushes()
      stationTerminalOutputFlushQueueRef.current = {}
      clearScheduledStationTerminalOutputRecoveries()
      cancelScheduledTerminalReplayDrain()
      scheduledTerminalReplayQueueRef.current = []
      scheduledTerminalReplayRunningRef.current = false
      cancelDetachedProjectionOutputAppendFlush()
      detachedProjectionOutputAppendQueueRef.current = {}

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
  }, [
    cancelScheduledStationTerminalOutputFlushes,
    cancelScheduledTerminalReplayDrain,
    cancelDetachedProjectionOutputAppendFlush,
    clearScheduledStationTerminalOutputRecoveries,
    flushCachedTerminalOutputAppendQueue,
    flushPendingStationTerminalOutput,
    flushScheduledTerminalDocumentPersist,
  ])

  // ── Tool commands loading ──────────────────────────────────────────────
  useEffect(() => {
    void loadToolCommandsForStations()
  }, [activeWorkspaceId, loadToolCommandsForStations, toolCommandReloadKey])

  return {
    // State
    stationTerminals,
    setStationTerminals,
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
    forceCloseStationTerminal,
    confirmForceCloseStationTerminal,
    dismissForceCloseConfirm,
    forceCloseConfirmPendingId,
    reconcileStationRuntimeRegistration,

    // Station operations
    removeStation,
    cleanupRemovedStationRuntimeState,
    launchStationCliAgent,
    resumeGtoSession,
    relaunchGtoSession,
    warmStationTerminal,
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

    // resolveWorkspaceRoot for use by workspace session restore
    resolveWorkspaceRoot,
  } satisfies ShellTerminalController
}
