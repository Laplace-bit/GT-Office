import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  useGitWorkspaceController,
} from '@features/git'
import { isPreviewable } from '@features/file-preview'
import {
  formatShortcutBinding,
  areShortcutBindingsEqual,
  formatNativeMenuAccelerator,
  getDefaultShortcutBindings,
  matchesShortcutEvent,
  resolveShortcutBindingsFromSettings,
  shortcutBindingToKeystroke,
  type ShortcutBinding,
} from '@features/keybindings'
import {
  DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  areTaskTargetsEqual,
  buildTaskCenterDraftFilePath,
  createInitialTaskDraft,
  normalizeTaskQuickDispatchOpacity,
  resolveValidTaskTargets,
  useTaskDispatchActions,
  useTaskCenterDraftPersistence,
  type StationTaskSignal,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
} from '@features/task-center'
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
  shouldApplyRecoveredStationOutput,
  shouldApplyStationSessionLaunchFailure,
  shouldApplyStationSessionResult,
  shouldApplyStationToolLaunchResult,
  shouldForwardStationTerminalInput,
  shouldMatchDetachedBridgeSession,
  type BufferedStationInputController,
  type SessionOwnedRestoreState,
  type TerminalChunkDecoder,
  type TerminalDebugRecord,
  type TerminalDebugRecordInput,
  type StationTerminalSink,
  type StationTerminalSinkBindingHandler,
} from '@features/terminal'
import {
  buildStationChannelBotBindingMap,
  resolveConnectorAccounts,
} from '@features/tool-adapter'
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
  DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL,
  DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS,
  createDefaultFloatingFrame,
  createDefaultStations,
  createInitialWorkbenchContainers,
  normalizeWorkbenchContainerFrame,
  reconcileWorkbenchContainers,
  restoreWorkbenchContainers,
  StationActionCommandSheet,
  composeStationActionCommand,
  stripDetachedTerminalRuntimeProjectionPatch,
  type AgentStation,
  type DetachedTerminalRuntimeProjectionPatch,
  type StationActionDescriptor,
  type StationActionExecution,
  type UpdateStationInput,
  type WorkbenchContainerModel,
  type WorkbenchContainerSnapshot,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from '@features/workspace-hub'
import {
  buildAgentWorkspaceMarkerPath,
  buildWorkspaceSessionFilePath,
  buildWorkspaceSessionSnapshot,
  defaultStationOverviewState,
  filterStationsForOverview,
  parseWorkspaceSessionSnapshot,
  resolveAgentWorkdirAbs,
  serializeWorkspaceSessionSnapshot,
  type WorkspaceSessionTerminalSnapshot,
} from '@features/workspace'
import {
  getNavItems,
  getPaneModels,
  type NavItemId,
} from './navigation-model'
import {
  type ChannelMessagePayload,
  type ExternalChannelInboundPayload,
  type ExternalChannelOutboundResultPayload,
  type AgentRuntimeRegisterRequest,
  type ChannelRouteBinding,
  desktopApi,
  type RenderedScreenSnapshot,
  type DetachedTerminalBridgeMessage,
  type DetachedTerminalHydrateSnapshotMessage,
  type DetachedTerminalOutputAppendMessage,
  type DetachedTerminalOutputResetMessage,
  type DetachedTerminalRuntimeUpdatedMessage,
  type StationTerminalRestoreStatePayload,
  type SurfaceDetachedStationPayload,
  type SurfaceBridgeEventPayload,
  type TerminalDescribeProcessesResponse,
  type TerminalMetaPayload,
  type TerminalOutputPayload,
  type TerminalStatePayload,
  type ToolCommandSummary,
} from '../integration/desktop-api'
import { t } from '../i18n/ui-locale'
import {
  applyUiPreferences,
  loadUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_UPDATED_EVENT,
} from '../state/ui-preferences'
import {
  loadPerformanceDebugState,
  // TODO: 性能调试按钮暂时隐藏
  // savePerformanceDebugState,
} from '../state/performance-debug'
import { addNotification } from '@/stores/notification'
import { pickDirectory } from '../integration/directory-picker'
import {
  EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT,
  EXTERNAL_CHANNEL_STATUS_POLL_MS,
  SHELL_LAYOUT_STORAGE_KEY,
  STATION_INPUT_FLUSH_MS,
  STATION_INPUT_MAX_BUFFER_BYTES,
  STATION_TASK_SIGNAL_VISIBLE_MS,
  TASK_DISPATCH_HISTORY_LIMIT,
  TASK_DRAFT_PERSIST_DEBOUNCE_MS,
  TELEGRAM_DEBUG_TOAST_VISIBLE_MS,
  WORKSPACE_SESSION_MAX_RESTORE_TABS,
  WORKSPACE_SESSION_MAX_RESTORE_TERMINALS,
  WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS,
  buildDefaultWorkbenchContainerId,
  buildExternalConversationKey,
  buildExternalEndpointKey,
  buildWorkbenchContainerTitle,
  clampLeftPaneWidth,
  clampRightPaneWidth,
  LEFT_PANE_WIDTH_MAX,
  RIGHT_PANE_WIDTH_MAX,
  createInitialStationTerminals,
  createStationEditInput,
  describeError,
  getStationIdleBanner,
  isCodeEditorKeyboardTarget,
  isEditableKeyboardTarget,
  isLinuxPlatform,
  isMacOsPlatform,
  isNavItemId,
  loadCanvasLayoutPreference,
  loadLeftPaneWidthPreference,
  loadRightPaneWidthPreference,
  nextStationNumber,
  normalizeExternalChannel,
  normalizeFsPath,
  normalizeStationToolKind,
  normalizeSubmitSequence,
  resolveLeftPaneWidthMax,
  resolveRightPaneWidthMax,
  readNumber,
  readRecord,
  readString,
  readTaskQuickDispatchOpacityFromSettings,
  STATION_TASK_SUBMIT_MAX_RETRY_FRAMES,
  shouldFlushStationInputImmediately,
  shouldPreventDesktopBrowserShortcut,
  summarizeExternalChannelText,
  toRelativePathIfInside,
  type DetachedProjectionTarget,
  type ExternalChannelEventItem,
  type ExternalTraceContext,
  type StationTerminalRuntime,
  type TelegramInboundDebugToast,
} from './ShellRoot.shared'
import { ShellRootView } from './ShellRootView'
import { useShellFileController } from './useShellFileController'
import { useShellStationController } from './useShellStationController'
import { useShellTaskMentionController } from './useShellTaskMentionController'
import { useShellWorkbenchController } from './useShellWorkbenchController'
import { useShellWorkspaceController } from './useShellWorkspaceController'
import { resolveWindowPerformancePolicy } from './window-performance-policy'

import './ShellRoot.scss'

const TERMINAL_DEBUG_RECORD_LIMIT = 0

export function ShellRoot() {
  const initialStations = useMemo(() => createDefaultStations(), [])
  const stationCounterRef = useRef(nextStationNumber(initialStations))
  const workbenchContainerCounterRef = useRef(initialStations.length + 1)
  const tauriRuntime = desktopApi.isTauriRuntime()
  const performanceDebugState = useMemo(loadPerformanceDebugState, [])
  const windowPerformancePolicy = useMemo(
    () =>
      resolveWindowPerformancePolicy({
        tauriRuntime,
        isMacOs: isMacOsPlatform(),
        isLinux: isLinuxPlatform(),
        performanceDebugEnabled: performanceDebugState.enabled,
      }),
    [performanceDebugState.enabled, tauriRuntime],
  )
  const nativeWindowTop = windowPerformancePolicy.useCustomWindowChrome
  const nativeWindowTopMacOs = windowPerformancePolicy.platform === 'macos' && nativeWindowTop
  const nativeWindowTopLinux = windowPerformancePolicy.platform === 'linux' && nativeWindowTop
  const nativeWindowTopWindows = windowPerformancePolicy.platform === 'windows' && nativeWindowTop
  const platformDefaultShortcutBindings = useMemo(
    () => getDefaultShortcutBindings(nativeWindowTopMacOs),
    [nativeWindowTopMacOs],
  )
  const [uiPreferences, setUiPreferences] = useState(loadUiPreferences)
  const [shortcutBindings, setShortcutBindings] = useState(() => platformDefaultShortcutBindings)
  const [taskQuickDispatchOpacity, setTaskQuickDispatchOpacity] = useState(
    DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  )
  const [leftPaneWidth, setLeftPaneWidth] = useState(loadLeftPaneWidthPreference)
  const [rightPaneWidth, setRightPaneWidth] = useState(loadRightPaneWidthPreference)
  const leftPaneWidthRef = useRef(leftPaneWidth)
  const rightPaneWidthRef = useRef(rightPaneWidth)
  const [leftPaneWidthMax, setLeftPaneWidthMax] = useState(LEFT_PANE_WIDTH_MAX)
  const [rightPaneWidthMax, setRightPaneWidthMax] = useState(RIGHT_PANE_WIDTH_MAX)
  const [leftPaneVisible, setLeftPaneVisible] = useState(true)
  const [activeNavId, setActiveNavId] = useState<NavItemId>('stations')
  const [pinnedWorkbenchContainerId, setPinnedWorkbenchContainerId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isTaskQuickDispatchOpen, setIsTaskQuickDispatchOpen] = useState(false)
  const [isChannelStudioOpen, setIsChannelStudioOpen] = useState(false)
  const [isStationManageOpen, setIsStationManageOpen] = useState(false)
  const [editingStation, setEditingStation] = useState<UpdateStationInput | null>(null)
  const [stationDeletePendingId, setStationDeletePendingId] = useState<string | null>(null)
  const [stationDeleteCleanupTargetId, setStationDeleteCleanupTargetId] = useState<string | null>(null)
  const [stationDeleteCleanupState, setStationDeleteCleanupState] = useState<StationDeleteCleanupState | null>(null)
  const [stationDeleteCleanupSubmitting, setStationDeleteCleanupSubmitting] = useState(false)
  const [isStationSearchOpen, setIsStationSearchOpen] = useState(false)
  const initialCanvasLayout = useMemo(loadCanvasLayoutPreference, [])
  const [canvasLayoutMode] = useState<WorkbenchLayoutMode>(initialCanvasLayout.mode)

  // TODO: 性能调试按钮暂时隐藏
  // const togglePerformanceDebug = useCallback(() => {
  //   setPerformanceDebugState((prev) => {
  //     const next = {
  //       enabled: !prev.enabled,
  //     }
  //     savePerformanceDebugState(next)
  //     return next
  //   })
  // }, [])
  const [canvasCustomLayout] = useState<WorkbenchCustomLayout>(initialCanvasLayout.customLayout)
  const [pendingScrollStationId, setPendingScrollStationId] = useState<string | null>(null)
  const [stationOverviewState, setStationOverviewState] = useState(defaultStationOverviewState)
  const [activeStationId, setActiveStationId] = useState(initialStations[0]?.id ?? '')
  const [workbenchContainers, setWorkbenchContainers] = useState<WorkbenchContainerModel[]>(() =>
    createInitialWorkbenchContainers(initialStations, buildDefaultWorkbenchContainerId, initialCanvasLayout),
  )
  const [taskDraft, setTaskDraft] = useState<TaskDraftState>(() =>
    createInitialTaskDraft(initialStations, initialStations[0]?.id ?? ''),
  )
  const [taskDispatchHistory, setTaskDispatchHistory] = useState<TaskDispatchRecord[]>([])
  const [taskSending, setTaskSending] = useState(false)
  const [taskRetryingTaskId, setTaskRetryingTaskId] = useState<string | null>(null)
  const [taskDraftSavedAtMs, setTaskDraftSavedAtMs] = useState<number | null>(null)
  const [taskNotice, setTaskNotice] = useState<TaskCenterNotice | null>(null)
  const [externalChannelStatus, setExternalChannelStatus] = useState<{
    loading: boolean
    running: boolean
    doctorOk: boolean | null
    runtimeBaseUrl: string | null
    feishuWebhook: string | null
    telegramWebhook: string | null
    summary: {
      routeBindings: number
      allowlistEntries: number
      pairingPending: number
      idempotencyEntries: number
    } | null
    lastSyncAtMs: number | null
    error: string | null
    bindings?: ChannelRouteBinding[]
    configuredChannels?: string[]
  }>({
    loading: false,
    running: false,
    doctorOk: null,
    runtimeBaseUrl: null,
    feishuWebhook: null,
    telegramWebhook: null,
    summary: null,
    lastSyncAtMs: null,
    error: null,
    bindings: [],
  })
  const [externalChannelEvents, setExternalChannelEvents] = useState<ExternalChannelEventItem[]>(
    [],
  )
  const [telegramDebugToast, setTelegramDebugToast] = useState<TelegramInboundDebugToast | null>(
    null,
  )
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [isBatchLaunchingAgents, setIsBatchLaunchingAgents] = useState(false)
  const [stationTaskSignals, setStationTaskSignals] = useState<Record<string, StationTaskSignal>>({})
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
  const stationTerminalsRef = useRef(stationTerminals)
  const stationProcessSnapshotsRef = useRef(stationProcessSnapshots)
  const stationsRef = useRef(initialStations)
  const workbenchContainersRef = useRef(workbenchContainers)
  const canvasLayoutModeRef = useRef(canvasLayoutMode)
  const canvasCustomLayoutRef = useRef(canvasCustomLayout)
  const detachedProjectionSeqRef = useRef<Record<string, number>>({})
  const detachedProjectionDispatchQueueRef = useRef<Record<string, Promise<void>>>({})
  const sessionStationRef = useRef<Record<string, string>>({})
  const terminalSessionSeqRef = useRef<Record<string, number>>({})
  const terminalOutputQueueRef = useRef<Record<string, Promise<void>>>({})
  const ensureStationTerminalSessionInFlightRef = useRef<Record<string, Promise<string | null>>>({})
  const stationToolLaunchSeqRef = useRef<Record<string, number>>({})
  const stationTerminalSinkRef = useRef<Record<string, StationTerminalSink>>({})
  const stationTerminalOutputCacheRef = useRef<Record<string, string>>({})
  const stationTerminalRestoreStateRef = useRef<Record<string, SessionOwnedRestoreState>>({})
  const stationTerminalInputControllerRef = useRef<BufferedStationInputController | null>(null)
  const stationSubmitSequenceRef = useRef<Record<string, string>>({})
  const terminalSessionVisibilityRef = useRef<Record<string, boolean>>({})
  const terminalChunkDecoderBySessionRef = useRef<Record<string, TerminalChunkDecoder>>({})
  const terminalDebugRecordSeqRef = useRef(0)
  const leftPaneResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; rafId: number | null; lastClientX: number; currentWidth: number } | null>(
    null,
  )
  const rightPaneResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; rafId: number | null; lastClientX: number; currentWidth: number } | null>(
    null,
  )
  const shellContainerRef = useRef<HTMLDivElement | null>(null)
  const shellTopRef = useRef<HTMLDivElement | null>(null)
  const shellMainRef = useRef<HTMLElement | null>(null)
  const shellStatusRef = useRef<HTMLDivElement | null>(null)
  const shellRailRef = useRef<HTMLDivElement | null>(null)
  const shellLeftPaneRef = useRef<HTMLDivElement | null>(null)
  const shellResizerRef = useRef<HTMLDivElement | null>(null)
  const shellMainPaneRef = useRef<HTMLDivElement | null>(null)
  const windowResizeSyncTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const updatePaneWidthBounds = () => {
      const containerWidth = shellMainRef.current?.clientWidth ?? window.innerWidth
      const nextLeftMax = resolveLeftPaneWidthMax(containerWidth)
      const nextRightMax = resolveRightPaneWidthMax(containerWidth)
      setLeftPaneWidthMax(nextLeftMax)
      setRightPaneWidthMax(nextRightMax)
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev, nextLeftMax))
      setRightPaneWidth((prev) => clampRightPaneWidth(prev, nextRightMax))
    }

    updatePaneWidthBounds()
    window.addEventListener('resize', updatePaneWidthBounds)
    return () => {
      window.removeEventListener('resize', updatePaneWidthBounds)
    }
  }, [])
  const localeRef = useRef(uiPreferences.locale)
  const activeWorkspaceIdRef = useRef<string | null>(null)
  const workspaceSessionPersistTimerRef = useRef<number | null>(null)
  const workspaceSessionHydratingRef = useRef(false)
  const workspaceSessionRestoreSeqRef = useRef(0)
  const workspaceSessionRestoreTabTimersRef = useRef<number[]>([])
  const pendingWorkbenchContainerSnapshotsRef = useRef<WorkbenchContainerSnapshot[] | null>(null)
  const detachedWindowOpenInFlightRef = useRef<Record<string, boolean>>({})
  const stationUnreadDeltaRef = useRef<Record<string, number>>({})
  const stationUnreadFlushTimerRef = useRef<number | null>(null)
  const stationTaskSignalTimerRef = useRef<Record<string, number | null>>({})
  const stationTaskSignalNonceRef = useRef<Record<string, number>>({})
  const externalChannelEventSeqRef = useRef(0)
  const externalTraceContextRef = useRef<Record<string, ExternalTraceContext>>({})
  const telegramDebugToastTimerRef = useRef<number | null>(null)
  const pendingSearchRequestFrameRef = useRef<number | null>(null)
  const pendingFileEditorCommandFrameRef = useRef<number | null>(null)
  const macOsNativeMenuInstallSeqRef = useRef(0)
  const leftPaneVisibleRef = useRef(leftPaneVisible)
  const shortcutBindingsRef = useRef(shortcutBindings)
  const nativeWindowTopMacOsRef = useRef(nativeWindowTopMacOs)
  const triggerFileSearchRef = useRef<(mode?: 'file' | 'content') => void>(() => {})
  const triggerFileEditorCommandRef = useRef<
    (type: 'find' | 'replace' | 'findNext' | 'findPrevious') => void
  >(() => {})
  const registeredAgentRuntimeRef = useRef<
    Record<string, { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }>
  >({})
  const tabSessionSnapshotRef = useRef<Array<{ path: string; active: boolean }>>([])
  const terminalSessionSnapshotRef = useRef<WorkspaceSessionTerminalSnapshot[]>([])
  const workbenchContainerSnapshotRef = useRef<WorkbenchContainerSnapshot[]>([])

  useEffect(() => {
    window.__GTO_OPEN_CHANNEL_STUDIO__ = () => {
      setIsChannelStudioOpen(true)
    }
    return () => {
      if (pendingSearchRequestFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSearchRequestFrameRef.current)
        pendingSearchRequestFrameRef.current = null
      }
      if (pendingFileEditorCommandFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFileEditorCommandFrameRef.current)
        pendingFileEditorCommandFrameRef.current = null
      }
      delete window.__GTO_OPEN_CHANNEL_STUDIO__
    }
  }, [])

  const locale = uiPreferences.locale
  const {
    workspacePathInput,
    setWorkspacePathInput,
    activeWorkspaceId,
    activeWorkspaceRoot,
    setActiveWorkspaceRoot,
    connectionState,
    gitSummary,
    refreshGit,
    openWorkspaceAtPath,
  } = useShellWorkspaceController()
  const {
    stations,
    setStations,
    agentRoles,
    restorableSystemRoles,
    stationSavePending,
    loadStationsFromDatabase,
    addStation,
    updateStation,
    reorderStations,
  } = useShellStationController({
    initialStations,
    activeWorkspaceId,
    localeRef,
    stationCounterRef,
    stationTerminalOutputCacheRef,
    setStationTerminals,
    setActiveStationId,
    setIsStationManageOpen,
    setEditingStation,
  })
  const {
    openedFiles,
    setOpenedFiles,
    activeFilePath,
    setActiveFilePath,
    filePreviewNotice,
    fileCanRenderText,
    fileReadLoading,
    fileReadError,
    isFileSearchModalOpen,
    setIsFileSearchModalOpen,
    fileSearchMode,
    fileEditorCommandRequest,
    tabSessionSnapshotEntries,
    tabSessionSnapshotSignature,
    loadFileContent,
    loadFileContentRef,
    saveFileContent,
    createFileInWorkspace,
    closeFile,
    selectFile,
    handleFileModified,
    deletePathInWorkspace,
    movePathInWorkspace,
    requestFileSearch,
    requestFileEditorCommand,
    resetFileState,
  } = useShellFileController({
    activeWorkspaceId,
    locale,
  })
  const {
    taskMentionCandidates,
    taskMentionLoading,
    taskMentionError,
    clearTaskMentionSearch,
    searchTaskMentionFiles,
  } = useShellTaskMentionController({
    activeWorkspaceId,
    localeRef,
  })
  const navItems = useMemo(() => getNavItems(locale), [locale])
  const paneModels = useMemo(() => getPaneModels(locale), [locale])
  const stationNameMap = useMemo(
    () =>
      stations.reduce<Record<string, string>>((acc, station) => {
        const normalized = station.name.trim()
        acc[station.id] = normalized || station.id
        return acc
      }, {}),
    [stations],
  )
  const taskCenterDraftFilePath = useMemo(() => buildTaskCenterDraftFilePath(), [])
  const workspaceSessionFilePath = useMemo(() => buildWorkspaceSessionFilePath(), [])

  useEffect(() => {
    stationTerminalsRef.current = stationTerminals
  }, [stationTerminals])

  useEffect(() => {
    stationProcessSnapshotsRef.current = stationProcessSnapshots
  }, [stationProcessSnapshots])

  useEffect(() => {
    stationsRef.current = stations
  }, [stations])

  useEffect(() => {
    workbenchContainersRef.current = workbenchContainers
  }, [workbenchContainers])

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

  useEffect(() => {
    setPinnedWorkbenchContainerId((prev) => {
      if (!prev) {
        return prev
      }
      const pinnedContainer = workbenchContainers.find((container) => container.id === prev) ?? null
      if (pinnedContainer?.mode === 'docked') {
        return prev
      }
      return null
    })
  }, [workbenchContainers])

  useEffect(() => {
    canvasLayoutModeRef.current = canvasLayoutMode
  }, [canvasLayoutMode])

  useEffect(() => {
    canvasCustomLayoutRef.current = canvasCustomLayout
  }, [canvasCustomLayout])

  useEffect(() => {
    if (!pendingScrollStationId) {
      return
    }
    if (stations.some((station) => station.id === pendingScrollStationId)) {
      return
    }
    setPendingScrollStationId(null)
  }, [pendingScrollStationId, stations])

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  useEffect(() => {
    return () => {
      const persistTimerId = workspaceSessionPersistTimerRef.current
      if (typeof persistTimerId === 'number') {
        window.clearTimeout(persistTimerId)
      }
      workspaceSessionPersistTimerRef.current = null

      workspaceSessionRestoreTabTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      workspaceSessionRestoreTabTimersRef.current = []

      const unreadTimerId = stationUnreadFlushTimerRef.current
      if (typeof unreadTimerId === 'number') {
        window.clearTimeout(unreadTimerId)
      }
      stationUnreadFlushTimerRef.current = null
      stationUnreadDeltaRef.current = {}

      const telegramToastTimerId = telegramDebugToastTimerRef.current
      if (typeof telegramToastTimerId === 'number') {
        window.clearTimeout(telegramToastTimerId)
      }
      telegramDebugToastTimerRef.current = null

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

  useEffect(() => {
    applyUiPreferences(uiPreferences)
    saveUiPreferences(uiPreferences)
  }, [uiPreferences])

  useEffect(() => {
    const syncUiPreferences = () => {
      setUiPreferences(loadUiPreferences())
    }

    window.addEventListener(UI_PREFERENCES_UPDATED_EVENT, syncUiPreferences)
    return () => {
      window.removeEventListener(UI_PREFERENCES_UPDATED_EVENT, syncUiPreferences)
    }
  }, [])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime() || !uiPreferences.autoCheckAppUpdates) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void desktopApi.settingsUpdateCheck().then((response) => {
        if (
          cancelled ||
          !response.updateAvailable ||
          !response.version ||
          response.version === uiPreferences.skippedAppUpdateVersion
        ) {
          return
        }
        addNotification({
          type: 'info',
          message: t(
            uiPreferences.locale,
            `GT Office ${response.version} 已可更新，请在设置中查看并安装。`,
            `GT Office ${response.version} is available. Open Settings to review and install it.`,
          ),
          duration: 8000,
        })
      }).catch(() => {
        // Startup update checks are best-effort and should stay silent here.
      })
    }, 4000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    uiPreferences.autoCheckAppUpdates,
    uiPreferences.locale,
    uiPreferences.skippedAppUpdateVersion,
  ])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null

    const loadRuntimeSettings = async () => {
      try {
        const response = await desktopApi.settingsGetEffective(activeWorkspaceId)
        if (disposed) {
          return
        }
        const runtimeShortcuts = resolveShortcutBindingsFromSettings(
          response.values,
          nativeWindowTopMacOs,
        )
        const normalizedRuntimeShortcuts =
          nativeWindowTopMacOs &&
          shortcutBindingToKeystroke(runtimeShortcuts.editorReplace) ===
            shortcutBindingToKeystroke(getDefaultShortcutBindings(false).editorReplace)
            ? {
                ...runtimeShortcuts,
                editorReplace: platformDefaultShortcutBindings.editorReplace,
              }
            : runtimeShortcuts
        setShortcutBindings((prev) =>
          areShortcutBindingsEqual(prev, normalizedRuntimeShortcuts)
            ? prev
            : normalizedRuntimeShortcuts,
        )
        if (
          nativeWindowTopMacOs &&
          !areShortcutBindingsEqual(runtimeShortcuts, normalizedRuntimeShortcuts)
        ) {
          void desktopApi
            .settingsUpdate('user', {
              keybindings: {
                overrides: [
                  {
                    command: 'shell.search.open_file',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.openFileSearch,
                    ),
                  },
                  {
                    command: 'shell.search.open_content',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.openContentSearch,
                    ),
                  },
                  {
                    command: 'shell.editor.find',
                    keystroke: shortcutBindingToKeystroke(normalizedRuntimeShortcuts.editorFind),
                  },
                  {
                    command: 'shell.editor.replace',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.editorReplace,
                    ),
                  },
                  {
                    command: 'task.center.quick_dispatch',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.taskQuickDispatch,
                    ),
                  },
                ],
              },
            })
            .catch(() => {
              // Keep normalized runtime shortcuts in memory even if migration persistence fails.
            })
        }
        const runtimeTaskQuickDispatchOpacity = readTaskQuickDispatchOpacityFromSettings(
          response.values,
        )
        if (runtimeTaskQuickDispatchOpacity !== null) {
          setTaskQuickDispatchOpacity((prev) =>
            prev === runtimeTaskQuickDispatchOpacity ? prev : runtimeTaskQuickDispatchOpacity,
          )
        }
      } catch {
        // Keep local preference when settings service is unavailable.
      }
    }

    void loadRuntimeSettings()

    void desktopApi
      .subscribeSettingsUpdated((payload) => {
        if (payload.workspaceId && activeWorkspaceId && payload.workspaceId !== activeWorkspaceId) {
          return
        }
        if (payload.workspaceId && !activeWorkspaceId) {
          return
        }
        void loadRuntimeSettings()
      })
      .then((unlisten) => {
        cleanup = unlisten
      })

    return () => {
      disposed = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [
    activeWorkspaceId,
    nativeWindowTopMacOs,
    platformDefaultShortcutBindings.editorReplace,
    setStations,
  ])

  const persistShortcutBindings = useCallback((bindings: typeof shortcutBindings) => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    void desktopApi
      .settingsUpdate('user', {
        keybindings: {
          overrides: [
            {
              command: 'shell.search.open_file',
              keystroke: shortcutBindingToKeystroke(bindings.openFileSearch),
            },
            {
              command: 'shell.search.open_content',
              keystroke: shortcutBindingToKeystroke(bindings.openContentSearch),
            },
            {
              command: 'shell.editor.find',
              keystroke: shortcutBindingToKeystroke(bindings.editorFind),
            },
            {
              command: 'shell.editor.replace',
              keystroke: shortcutBindingToKeystroke(bindings.editorReplace),
            },
            {
              command: 'task.center.quick_dispatch',
              keystroke: shortcutBindingToKeystroke(bindings.taskQuickDispatch),
            },
          ],
        },
      })
      .catch(() => {
        // Keep local shortcut state even if settings persistence fails.
      })
  }, [])

  const handleTaskQuickDispatchShortcutChange = useCallback((binding: ShortcutBinding) => {
    setShortcutBindings((prev) => {
      const next = {
        ...prev,
        taskQuickDispatch: binding,
      }
      persistShortcutBindings(next)
      return next
    })
  }, [persistShortcutBindings])

  const handleTaskQuickDispatchShortcutReset = useCallback(() => {
    setShortcutBindings((prev) => {
      const next = {
        ...prev,
        taskQuickDispatch: platformDefaultShortcutBindings.taskQuickDispatch,
      }
      persistShortcutBindings(next)
      return next
    })
  }, [persistShortcutBindings, platformDefaultShortcutBindings.taskQuickDispatch])

  const handleTaskQuickDispatchOpacityChange = useCallback((value: number) => {
    const nextOpacity = normalizeTaskQuickDispatchOpacity(value)
    setTaskQuickDispatchOpacity(nextOpacity)
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    void desktopApi
      .settingsUpdate('user', {
        ui: {
          taskQuickDispatch: {
            opacity: nextOpacity,
          },
        },
      })
      .catch(() => {
        // The overlay remains usable even if settings persistence fails.
      })
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(
      SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        leftPaneWidth,
        rightPaneWidth,
        canvasLayoutMode,
        canvasCustomLayout,
      }),
    )
  }, [canvasCustomLayout, canvasLayoutMode, leftPaneWidth, rightPaneWidth])

  const syncWindowFrameState = useCallback(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    void desktopApi.windowIsMaximized().then((maximized) => {
      setWindowMaximized((prev) => (prev === maximized ? prev : maximized))
    })
  }, [])

  useEffect(() => {
    if (!nativeWindowTop) {
      return
    }
    let disposed = false
    let cleanup: (() => void) | null = null

    const syncMaximized = async () => {
      if (disposed) {
        return
      }
      const maximized = await desktopApi.windowIsMaximized()
      if (!disposed) {
        setWindowMaximized((prev) => (prev === maximized ? prev : maximized))
      }
    }

    void desktopApi.windowSetDecorations(windowPerformancePolicy.shouldUseNativeDecorations)
    void syncMaximized()
    void desktopApi.subscribeWindowResized(() => {
      const timerId = windowResizeSyncTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      windowResizeSyncTimerRef.current = window.setTimeout(() => {
        windowResizeSyncTimerRef.current = null
        void syncMaximized()
      }, 120)
    }).then((unlisten) => {
      cleanup = unlisten
    })

    return () => {
      disposed = true
      const timerId = windowResizeSyncTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      windowResizeSyncTimerRef.current = null
      if (cleanup) {
        cleanup()
      }
    }
  }, [nativeWindowTop, windowPerformancePolicy.shouldUseNativeDecorations])

  useEffect(() => {
    const draggingClassName = 'vb-window-dragging'
    if (!nativeWindowTopWindows) {
      document.body.classList.remove(draggingClassName)
      return
    }

    const topContainer = shellTopRef.current
    if (!topContainer) {
      return
    }

    const dragRegionSelector = '[data-tauri-drag-region]'
    const interactiveSelector =
      "button,input,textarea,select,a,[role='button'],[contenteditable='true'],label"

    const clearDraggingClass = () => {
      document.body.classList.remove(draggingClassName)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const dragRegion = target.closest(dragRegionSelector)
      if (!dragRegion) {
        return
      }
      if (target.closest(interactiveSelector)) {
        return
      }
      document.body.classList.add(draggingClassName)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        clearDraggingClass()
      }
    }

    topContainer.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointerup', clearDraggingClass)
    window.addEventListener('pointercancel', clearDraggingClass)
    window.addEventListener('blur', clearDraggingClass)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      topContainer.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointerup', clearDraggingClass)
      window.removeEventListener('pointercancel', clearDraggingClass)
      window.removeEventListener('blur', clearDraggingClass)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearDraggingClass()
    }
  }, [nativeWindowTopWindows])

  useEffect(() => {
    const root = document.documentElement
    const platform = windowPerformancePolicy.platform

    root.setAttribute('data-vb-platform', platform)

    return () => {
      if (root.getAttribute('data-vb-platform') === platform) {
        root.removeAttribute('data-vb-platform')
      }
    }
  }, [windowPerformancePolicy.platform])

  const handleWindowMinimize = useCallback(() => {
    void desktopApi.windowMinimize()
  }, [])

  const handleWindowToggleMaximize = useCallback(() => {
    void desktopApi.windowToggleMaximize().then((success) => {
      if (!success) {
        return
      }
      syncWindowFrameState()
    })
  }, [syncWindowFrameState])

  const handleWindowClose = useCallback(() => {
    void desktopApi.windowClose()
  }, [])

  const activePaneModel = useMemo(() => {
    if (activeNavId !== 'git') {
      return paneModels[activeNavId]
    }

    if (!gitSummary) {
      return {
        title: t(locale, 'pane.git.title'),
        subtitle: t(locale, 'shell.git.statusMissing'),
        items: [
          t(locale, 'pane.git.currentBranch', { branch: '-' }),
          t(locale, 'pane.git.pendingFiles', { count: 0 }),
          t(locale, 'pane.git.unpushedCommits', { count: 0 }),
        ],
      }
    }

    return {
      title: t(locale, 'pane.git.title'),
      subtitle: t(locale, 'shell.git.summaryStatus', {
        branch: gitSummary.branch,
        ahead: gitSummary.ahead,
        behind: gitSummary.behind,
      }),
      items:
        gitSummary.files.length > 0
          ? gitSummary.files.slice(0, 8).map((file) => `${file.status} ${file.path}`)
          : [t(locale, 'shell.git.workspaceClean')],
    }
  }, [activeNavId, gitSummary, locale, paneModels])

  const runtimeStateByStationId = useMemo(
    () =>
      Object.entries(stationTerminals).reduce<Record<string, string>>((acc, [stationId, runtime]) => {
        acc[stationId] = runtime.stateRaw
        return acc
      }, {}),
    [stationTerminals],
  )

  const filteredStations = useMemo(
    () => filterStationsForOverview(stations, runtimeStateByStationId, stationOverviewState),
    [runtimeStateByStationId, stationOverviewState, stations],
  )

  const channelBotBindingsByStationId = useMemo(
    () =>
      buildStationChannelBotBindingMap(
        stations.map((station) => ({ id: station.id, role: station.role })),
        externalChannelStatus.bindings ?? [],
      ),
    [externalChannelStatus.bindings, stations],
  )

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

  const pushStationTerminalDebugRecord = useCallback(
    (stationId: string, input: TerminalDebugRecordInput) => {
      if (!isStationTerminalDebugEnabled(stationId)) {
        return
      }
      terminalDebugRecordSeqRef.current += 1
      const record: TerminalDebugRecord = {
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

  const appendStationTerminalOutput = useMemo(
    () => (stationId: string, chunk: string) => {
      stationTerminalOutputCacheRef.current[stationId] = appendDetachedTerminalOutput(
        stationTerminalOutputCacheRef.current[stationId],
        chunk,
      )
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      pushStationTerminalDebugRecord(stationId, {
        sessionId,
        lane: 'xterm',
        kind: 'write',
        source: 'append',
        summary: formatTerminalDebugPreview(chunk, 84),
        body: chunk,
      })
      stationTerminalSinkRef.current[stationId]?.write(chunk)
      publishDetachedOutputAppend(stationId, chunk)
    },
    [publishDetachedOutputAppend, pushStationTerminalDebugRecord],
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
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      pushStationTerminalDebugRecord(stationId, {
        sessionId,
        lane: 'xterm',
        kind: 'reset',
        source: content == null ? 'fallback' : 'explicit',
        summary: formatTerminalDebugPreview(nextContent, 84),
        body: nextContent,
      })
      stationTerminalSinkRef.current[stationId]?.reset(nextContent)
      publishDetachedOutputReset(stationId, nextContent)
    },
    [publishDetachedOutputReset, pushStationTerminalDebugRecord],
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
      if (projectionPatch) {
        publishDetachedRuntimePatch(stationId, projectionPatch)
      }
    },
    [publishDetachedRuntimePatch],
  )

  const clearStationUnread = useMemo(
    () => (stationId: string) => {
      delete stationUnreadDeltaRef.current[stationId]
      setStationTerminals((prev) => {
        const current = prev[stationId]
        if (!current || current.unreadCount === 0) {
          return prev
        }
        return {
          ...prev,
          [stationId]: {
            ...current,
            unreadCount: 0,
          },
        }
      })
    },
    [],
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
        return changed ? next : prev
      })
    },
    [],
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

  const clearStationTaskSignalTimer = useCallback((stationId: string) => {
    const timerId = stationTaskSignalTimerRef.current[stationId]
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId)
    }
    stationTaskSignalTimerRef.current[stationId] = null
  }, [])

  const scheduleStationTaskSignalDismiss = useCallback(
    (stationId: string, nonce: number) => {
      clearStationTaskSignalTimer(stationId)
      stationTaskSignalTimerRef.current[stationId] = window.setTimeout(() => {
        stationTaskSignalTimerRef.current[stationId] = null
        if ((stationTaskSignalNonceRef.current[stationId] ?? 0) !== nonce) {
          return
        }
        setStationTaskSignals((prev) => {
          const current = prev[stationId]
          if (!current || current.nonce !== nonce) {
            return prev
          }
          const next = { ...prev }
          delete next[stationId]
          return next
        })
      }, STATION_TASK_SIGNAL_VISIBLE_MS)
    },
    [clearStationTaskSignalTimer],
  )

  const emitStationTaskSignal = useCallback(
    (input: { stationId: string; taskId: string; title: string; receivedAtMs: number }) => {
      const nextNonce = (stationTaskSignalNonceRef.current[input.stationId] ?? 0) + 1
      stationTaskSignalNonceRef.current[input.stationId] = nextNonce
      setStationTaskSignals((prev) => ({
        ...prev,
        [input.stationId]: {
          nonce: nextNonce,
          taskId: input.taskId,
          title: input.title,
          receivedAtMs: input.receivedAtMs,
        },
      }))
      scheduleStationTaskSignalDismiss(input.stationId, nextNonce)
    },
    [scheduleStationTaskSignalDismiss],
  )

  const bindExternalTraceTarget = useCallback((traceId: string, targetAgentId: string) => {
    const normalizedTraceId = traceId.trim()
    const normalizedTargetAgentId = targetAgentId.trim()
    if (!normalizedTraceId || !normalizedTargetAgentId) {
      return
    }
    const context = externalTraceContextRef.current[normalizedTraceId]
    if (context) {
      context.targetAgentId = normalizedTargetAgentId
    }
    setExternalChannelEvents((prev) =>
      prev.map((event) => {
        if (event.traceId !== normalizedTraceId) {
          return event
        }
        const endpointKey =
          event.endpointKey ??
          context?.endpointKey ??
          buildExternalEndpointKey({
            channel: event.channel,
            accountId: event.accountId,
            peerKind: event.peerKind,
            peerId: event.peerId,
          })
        return {
          ...event,
          targetAgentId: normalizedTargetAgentId,
          conversationKey: buildExternalConversationKey(endpointKey, normalizedTargetAgentId),
        }
      }),
    )
  }, [])

  const appendExternalChannelEvent = useCallback(
    (input: Omit<ExternalChannelEventItem, 'id' | 'tsMs'> & { tsMs?: number }) => {
      externalChannelEventSeqRef.current += 1
      const nextEvent: ExternalChannelEventItem = {
        id: `ext_evt_${Date.now().toString(16)}_${externalChannelEventSeqRef.current.toString(16)}`,
        tsMs: input.tsMs ?? Date.now(),
        kind: input.kind,
        primary: input.primary,
        channel: input.channel,
        status: input.status,
        secondary: input.secondary,
        detail: input.detail,
        mergeKey: input.mergeKey,
        traceId: input.traceId,
        accountId: input.accountId,
        peerKind: input.peerKind,
        peerId: input.peerId,
        senderId: input.senderId,
        targetAgentId: input.targetAgentId,
        endpointKey: input.endpointKey,
        conversationKey: input.conversationKey,
      }
      setExternalChannelEvents((prev) => {
        if (!nextEvent.mergeKey) {
          return [nextEvent, ...prev].slice(0, EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT)
        }
        const existingIndex = prev.findIndex(
          (event) => event.mergeKey === nextEvent.mergeKey && event.kind === nextEvent.kind,
        )
        if (existingIndex === -1) {
          return [nextEvent, ...prev].slice(0, EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT)
        }
        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex],
          tsMs: nextEvent.tsMs,
          primary: nextEvent.primary,
          channel: nextEvent.channel,
          status: nextEvent.status,
          secondary: nextEvent.secondary,
          detail: nextEvent.detail,
          traceId: nextEvent.traceId,
          accountId: nextEvent.accountId,
          peerKind: nextEvent.peerKind,
          peerId: nextEvent.peerId,
          senderId: nextEvent.senderId,
          targetAgentId: nextEvent.targetAgentId,
          endpointKey: nextEvent.endpointKey,
          conversationKey: nextEvent.conversationKey,
        }
        return updated
      })
    },
    [],
  )

  const emitTelegramInboundDebugToast = useCallback((payload: ExternalChannelInboundPayload) => {
    if (payload.channel.trim().toLowerCase() !== 'telegram') {
      return
    }
    const normalizedText = (payload.text ?? '').trim()
    const textPreview =
      normalizedText.length > 280 ? `${normalizedText.slice(0, 280)}...` : normalizedText
    const nonce = Date.now()
    const nextToast: TelegramInboundDebugToast = {
      nonce,
      receivedAtMs: nonce,
      accountId: payload.accountId || 'default',
      senderId: payload.senderId || 'unknown',
      senderName: payload.senderName ?? null,
      peerId: payload.peerId || 'unknown',
      messageId: payload.messageId || 'unknown',
      text: textPreview,
    }
    setTelegramDebugToast(nextToast)

    const previousTimer = telegramDebugToastTimerRef.current
    if (typeof previousTimer === 'number') {
      window.clearTimeout(previousTimer)
    }
    telegramDebugToastTimerRef.current = window.setTimeout(() => {
      telegramDebugToastTimerRef.current = null
      setTelegramDebugToast((current) => {
        if (!current || current.nonce !== nonce) {
          return current
        }
        return null
      })
    }, TELEGRAM_DEBUG_TOAST_VISIBLE_MS)
  }, [])

  const refreshExternalChannelStatus = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    setExternalChannelStatus((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }))
    try {
      const [adapterStatus, doctorStatus, bindingsResponse] = await Promise.all([
        desktopApi.channelAdapterStatus(),
        desktopApi.systemGtoDoctor(),
        activeWorkspaceId ? desktopApi.channelBindingList(activeWorkspaceId) : Promise.resolve({ bindings: [] }),
      ])
      const connectorAccounts = await resolveConnectorAccounts(adapterStatus, (channel) =>
        desktopApi.channelConnectorAccountList(channel),
      )

      const runtimeRecord = readRecord(adapterStatus.runtime)
      const snapshotRecord = readRecord(adapterStatus.snapshot)
      const doctorRecord = readRecord(doctorStatus)
      const summaryRecord = readRecord(snapshotRecord)
      const doctorOk = typeof doctorRecord?.ok === 'boolean' ? doctorRecord.ok : null

      const feishuWebHit = readString(runtimeRecord?.feishuWebhook)
      const telegramWebHit = readString(runtimeRecord?.telegramWebhook)

      const activeSet = new Set<string>()
      bindingsResponse.bindings.forEach((binding) => activeSet.add(binding.channel))
      connectorAccounts.forEach((account) => {
        if (account.enabled || account.hasBotToken || account.hasWebhookSecret) {
          activeSet.add(account.channel)
        }
      })
      if (feishuWebHit) activeSet.add('feishu')
      if (telegramWebHit) {
        activeSet.add('telegram')
      }

      setExternalChannelStatus({
        loading: false,
        running: Boolean(adapterStatus.running),
        doctorOk,
        runtimeBaseUrl: readString(runtimeRecord?.baseUrl),
        feishuWebhook: feishuWebHit,
        telegramWebhook: telegramWebHit,
        summary: summaryRecord
          ? {
              routeBindings: Math.max(0, readNumber(summaryRecord.routeBindings) ?? 0),
              allowlistEntries: Math.max(0, readNumber(summaryRecord.allowlistEntries) ?? 0),
              pairingPending: Math.max(0, readNumber(summaryRecord.pairingPending) ?? 0),
              idempotencyEntries: Math.max(0, readNumber(summaryRecord.idempotencyEntries) ?? 0),
            }
          : null,
        lastSyncAtMs: Date.now(),
        error: null,
        bindings: bindingsResponse.bindings,
        configuredChannels: Array.from(activeSet),
      })
    } catch (error) {
      setExternalChannelStatus((prev) => ({
        ...prev,
        loading: false,
        error: describeError(error),
        lastSyncAtMs: Date.now(),
      }))
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (activeNavId !== 'channels' && !isChannelStudioOpen) {
      return
    }
    void refreshExternalChannelStatus()
  }, [activeNavId, isChannelStudioOpen, refreshExternalChannelStatus])

  useEffect(() => {
    return () => {
      Object.entries(stationTaskSignalTimerRef.current).forEach(([stationId]) => {
        clearStationTaskSignalTimer(stationId)
      })
      stationTaskSignalTimerRef.current = {}
      stationTaskSignalNonceRef.current = {}
    }
  }, [clearStationTaskSignalTimer])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    let disposed = false
    let timerId: number | null = null

    const poll = async () => {
      if (disposed) {
        return
      }
      await refreshExternalChannelStatus()
      if (disposed || activeNavId !== 'tasks') {
        return
      }
      timerId = window.setTimeout(() => {
        void poll()
      }, EXTERNAL_CHANNEL_STATUS_POLL_MS)
    }

    if (activeNavId === 'tasks') {
      void poll()
    }

    return () => {
      disposed = true
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
    }
  }, [activeNavId, refreshExternalChannelStatus])

  const bindStationTerminalSink = useMemo<StationTerminalSinkBindingHandler>(
    () => (stationId, sink, meta) => {
      if (!sink) {
        if (meta?.sourceSink && stationTerminalSinkRef.current[stationId] !== meta.sourceSink) {
          return
        }
        const capturedRestoreState = meta?.restoreState
          ? captureMatchingSessionOwnedRestoreState(
              stationTerminalsRef.current[stationId],
              meta.sourceSessionId,
              {
                content: meta.restoreState,
                cols: meta.restoreCols ?? 0,
                rows: meta.restoreRows ?? 0,
              },
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
      const restoreState = retainSessionOwnedRestoreState(
        stationTerminalRestoreStateRef.current[stationId],
        stationTerminalsRef.current[stationId]?.sessionId ?? null,
      )
      if (restoreState) {
        pushStationTerminalDebugRecord(stationId, {
          sessionId: stationTerminalsRef.current[stationId]?.sessionId ?? null,
          lane: 'xterm',
          kind: 'restore',
          source: 'session_restore',
          summary: formatTerminalDebugPreview(restoreState.state.content, 84),
          body: restoreState.state.content,
        })
        sink.restore(restoreState.state.content, restoreState.state.cols, restoreState.state.rows)
        return
      }
      delete stationTerminalRestoreStateRef.current[stationId]
      sink.reset(cachedContent)
    },
    [pushStationTerminalDebugRecord],
  )

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

  const gitController = useGitWorkspaceController({
    locale,
    workspaceId: activeWorkspaceId,
    summary: gitSummary,
    onRefreshSummary: refreshGit,
  })

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
              if (unread) {
                incrementStationUnread(stationId, 1)
              }
            })
        },
        onStateChanged: (payload: TerminalStatePayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
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
        },
        onMeta: (payload: TerminalMetaPayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
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
    pushStationTerminalDebugRecord,
    resetStationTerminalOutput,
    setStationTerminalState,
  ])

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

    if (activeWorkspaceId) {
      stations.forEach((station) => {
        const sessionId = stationTerminals[station.id]?.sessionId ?? null
        if (!sessionId) {
          return
        }
        desired[station.id] = {
          workspaceId: activeWorkspaceId,
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

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null

    void desktopApi
      .subscribeChannelEvents({
        onMessage: (payload: ChannelMessagePayload) => {
          if (disposed) {
            return
          }
          const station = stationsRef.current.find(
            (item) => item.id === payload.targetAgentId,
          )
          if (!station) {
            return
          }
          const rawPayload = payload.payload
          const taskId =
            typeof rawPayload.taskId === 'string' ? rawPayload.taskId : payload.messageId
          const title =
            typeof rawPayload.title === 'string' ? rawPayload.title : payload.type

          emitStationTaskSignal({
            stationId: station.id,
            taskId,
            title,
            receivedAtMs: payload.tsMs,
          })
        },
        onAck: () => {
          // Ack events are tracked in task center history records.
        },
        onDispatchProgress: () => {
          // Progress events are consumed by the dispatch command response in current UI.
        },
        onExternalInbound: (payload: ExternalChannelInboundPayload) => {
          const channel = normalizeExternalChannel(payload.channel)
          const accountId = payload.accountId?.trim() || 'default'
          const peerKind = payload.peerKind
          const peerId = payload.peerId?.trim() || 'unknown-peer'
          const senderId = payload.senderId?.trim() || 'unknown-sender'
          const endpointKey = buildExternalEndpointKey({
            channel,
            accountId,
            peerKind,
            peerId,
          })
          const previousTraceContext = externalTraceContextRef.current[payload.traceId]
          const traceContext: ExternalTraceContext = {
            channel,
            accountId,
            peerKind,
            peerId,
            senderId,
            endpointKey,
            targetAgentId: previousTraceContext?.targetAgentId,
          }
          externalTraceContextRef.current[payload.traceId] = traceContext
          const textPreview = summarizeExternalChannelText(payload.text)
          appendExternalChannelEvent({
            kind: 'inbound',
            primary: textPreview ?? `${channel} · ${senderId}`,
            channel,
            status: 'received',
            secondary: `${channel} · ${senderId}`,
            detail: `peer=${payload.peerId} · msg=${payload.messageId}`,
            traceId: payload.traceId,
            accountId,
            peerKind,
            peerId,
            senderId,
            targetAgentId: traceContext.targetAgentId,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, traceContext.targetAgentId),
          })
          emitTelegramInboundDebugToast(payload)
        },
        onExternalRouted: (payload) => {
          const resolvedTarget =
            payload.resolvedTargets?.find((value) => typeof value === 'string' && value.trim().length > 0) ??
            payload.targetAgentId
          bindExternalTraceTarget(payload.traceId, resolvedTarget)
        },
        onExternalDispatchProgress: (payload) => {
          bindExternalTraceTarget(payload.traceId, payload.targetAgentId)
          if (payload.status !== 'failed') {
            return
          }
          const traceContext = externalTraceContextRef.current[payload.traceId]
          const endpointKey =
            traceContext?.endpointKey ??
            buildExternalEndpointKey({
              channel: traceContext?.channel,
              accountId: traceContext?.accountId,
              peerKind: traceContext?.peerKind,
              peerId: traceContext?.peerId,
            })
          appendExternalChannelEvent({
            kind: 'error',
            primary: payload.detail?.trim() || 'Dispatch failed',
            channel: traceContext?.channel,
            status: 'failed',
            detail: payload.detail ?? 'Dispatch failed',
            mergeKey: `dispatch-failed:${payload.traceId}:${payload.targetAgentId}`,
            traceId: payload.traceId,
            accountId: traceContext?.accountId,
            peerKind: traceContext?.peerKind,
            peerId: traceContext?.peerId,
            senderId: traceContext?.senderId,
            targetAgentId: payload.targetAgentId,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, payload.targetAgentId),
          })
        },
        onExternalReply: () => {
          // `external/channel_reply` is an internal channel ack mirrored from task dispatch,
          // not a real external provider send result. Do not show it in recent external events.
        },
        onExternalOutboundResult: (payload: ExternalChannelOutboundResultPayload) => {
          if (payload.relayMode === 'dispatch-ack') {
            return
          }
          const textPreview = summarizeExternalChannelText(payload.textPreview)
          const traceContext =
            payload.traceId && payload.traceId.trim()
              ? externalTraceContextRef.current[payload.traceId]
              : undefined
          if (payload.traceId && traceContext) {
            traceContext.targetAgentId = payload.targetAgentId
          }
          const endpointKey =
            traceContext?.endpointKey ??
            buildExternalEndpointKey({
              channel: payload.channel ?? traceContext?.channel,
              accountId: traceContext?.accountId,
              peerKind: traceContext?.peerKind,
              peerId: traceContext?.peerId,
            })
          const targetAgentId = payload.targetAgentId || traceContext?.targetAgentId
          const failureMergeKey =
            payload.status === 'failed'
              ? `outbound-failed:${payload.traceId ?? payload.messageId}:${payload.targetAgentId}:${payload.textPreview ?? ''}`
              : undefined
          appendExternalChannelEvent({
            kind: 'outbound',
            primary: textPreview ?? `${payload.targetAgentId} · ${payload.status}`,
            channel: payload.channel ?? traceContext?.channel ?? undefined,
            status: payload.status === 'failed' ? 'failed' : 'sent',
            secondary: `${payload.targetAgentId} · ${payload.status}`,
            detail: payload.status === 'failed' ? payload.detail ?? undefined : undefined,
            mergeKey: failureMergeKey,
            tsMs: payload.tsMs,
            traceId: payload.traceId ?? undefined,
            accountId: traceContext?.accountId,
            peerKind: traceContext?.peerKind,
            peerId: traceContext?.peerId,
            senderId: traceContext?.senderId,
            targetAgentId: targetAgentId ?? undefined,
            endpointKey,
            conversationKey: buildExternalConversationKey(endpointKey, targetAgentId),
          })
        },
        onExternalError: () => {},
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
    appendExternalChannelEvent,
    bindExternalTraceTarget,
    emitStationTaskSignal,
    emitTelegramInboundDebugToast,
  ])

  useEffect(() => {
    if (desktopApi.isTauriRuntime()) {
      workbenchContainersRef.current.forEach((container) => {
        if (!container.detachedWindowLabel) {
          return
        }
        void desktopApi.surfaceCloseWindow(container.detachedWindowLabel).catch(() => {
          // Best-effort cleanup while switching workspaces.
        })
      })
    }
    setStationTerminals(createInitialStationTerminals(stationsRef.current))
    sessionStationRef.current = {}
    detachedProjectionSeqRef.current = {}
    detachedProjectionDispatchQueueRef.current = {}
    terminalSessionSeqRef.current = {}
    terminalOutputQueueRef.current = {}
    ensureStationTerminalSessionInFlightRef.current = {}
    stationToolLaunchSeqRef.current = {}
    terminalSessionVisibilityRef.current = {}
    stationTerminalRestoreStateRef.current = {}
    stationTerminalOutputCacheRef.current = stationsRef.current.reduce<Record<string, string>>((acc, station) => {
      acc[station.id] = getStationIdleBanner(station)
      return acc
    }, {})
    stationTerminalInputControllerRef.current?.dispose()
    stationTerminalInputControllerRef.current = null
    stationSubmitSequenceRef.current = {}
    Object.entries(stationTerminalSinkRef.current).forEach(([stationId, sink]) => {
      sink.reset(stationTerminalOutputCacheRef.current[stationId])
    })
    resetFileState()
    setTaskDispatchHistory([])
    setTaskSending(false)
    setTaskRetryingTaskId(null)
    setTaskDraftSavedAtMs(null)
    setTaskNotice(null)
    setExternalChannelEvents([])
    externalChannelEventSeqRef.current = 0
    externalTraceContextRef.current = {}
    pendingWorkbenchContainerSnapshotsRef.current = null
    detachedWindowOpenInFlightRef.current = {}
    setPinnedWorkbenchContainerId(null)
    setWorkbenchContainers(
      createInitialWorkbenchContainers(stationsRef.current, buildDefaultWorkbenchContainerId, {
        mode: canvasLayoutModeRef.current,
        customLayout: canvasCustomLayoutRef.current,
      }),
    )
    Object.entries(stationTaskSignalTimerRef.current).forEach(([stationId]) => {
      clearStationTaskSignalTimer(stationId)
    })
    stationTaskSignalTimerRef.current = {}
    stationTaskSignalNonceRef.current = {}
    setStationTaskSignals({})
    setTaskDraft(createInitialTaskDraft(stationsRef.current, stationsRef.current[0]?.id ?? ''))
  }, [activeWorkspaceId, clearStationTaskSignalTimer, resetFileState])

  useEffect(() => {
    const stationIdSet = new Set(stations.map((station) => station.id))
    setStationTerminals((prev) => {
      const next: Record<string, StationTerminalRuntime> = {}
      stations.forEach((station) => {
        next[station.id] = prev[station.id] ?? {
          sessionId: null,
          stateRaw: 'idle',
          unreadCount: 0,
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        }
      })
      return next
    })

    Object.keys(stationTerminalOutputCacheRef.current).forEach((stationId) => {
      if (!stationIdSet.has(stationId)) {
        delete stationTerminalOutputCacheRef.current[stationId]
      }
    })
    Object.keys(stationTerminalRestoreStateRef.current).forEach((stationId) => {
      if (!stationIdSet.has(stationId)) {
        delete stationTerminalRestoreStateRef.current[stationId]
      }
    })
    Object.keys(stationTaskSignalTimerRef.current).forEach((stationId) => {
      if (stationIdSet.has(stationId)) {
        return
      }
      clearStationTaskSignalTimer(stationId)
      delete stationTaskSignalTimerRef.current[stationId]
      delete stationTaskSignalNonceRef.current[stationId]
    })
    stations.forEach((station) => {
      if (!stationTerminalOutputCacheRef.current[station.id]) {
        stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(station)
      }
    })
    Object.entries(sessionStationRef.current).forEach(([sessionId, stationId]) => {
      if (!stationIdSet.has(stationId)) {
        delete sessionStationRef.current[sessionId]
        delete terminalSessionSeqRef.current[sessionId]
        delete terminalOutputQueueRef.current[sessionId]
        delete terminalSessionVisibilityRef.current[sessionId]
      }
    })
    stationTerminalsRef.current = Object.keys(stationTerminalsRef.current).reduce<Record<string, StationTerminalRuntime>>(
      (acc, stationId) => {
        if (stationIdSet.has(stationId)) {
          acc[stationId] = stationTerminalsRef.current[stationId]
        } else {
          stationTerminalInputControllerRef.current?.clear(stationId)
          delete ensureStationTerminalSessionInFlightRef.current[stationId]
        }
        return acc
      },
      {},
    )

    if (!activeStationId && stations[0]) {
      setActiveStationId(stations[0].id)
      return
    }
    if (activeStationId && !stationIdSet.has(activeStationId)) {
      setActiveStationId(stations[0]?.id ?? '')
    }
  }, [activeStationId, clearStationTaskSignalTimer, stations])

  useEffect(() => {
    setWorkbenchContainers((prev) => {
      const pendingSnapshots = pendingWorkbenchContainerSnapshotsRef.current
      if (pendingSnapshots) {
        pendingWorkbenchContainerSnapshotsRef.current = null
        return restoreWorkbenchContainers(
          pendingSnapshots,
          stations,
          buildDefaultWorkbenchContainerId,
          {
            mode: canvasLayoutMode,
            customLayout: canvasCustomLayout,
          },
        )
      }
      return reconcileWorkbenchContainers(prev, stations, buildDefaultWorkbenchContainerId, {
        mode: canvasLayoutMode,
        customLayout: canvasCustomLayout,
      })
    })
  }, [canvasCustomLayout, canvasLayoutMode, stations])

  useEffect(() => {
    if (!activeStationId) {
      return
    }
    setWorkbenchContainers((prev) => {
      const targetIndex = prev.findIndex((container) => container.stationIds.includes(activeStationId))
      if (targetIndex < 0) {
        return prev
      }
      const target = prev[targetIndex]
      if (target.activeStationId === activeStationId) {
        return prev
      }
      const next = [...prev]
      next[targetIndex] = {
        ...target,
        activeStationId,
        lastActiveAtMs: Date.now(),
      }
      return next
    })
  }, [activeStationId])

  useEffect(() => {
    if (!activeWorkspaceId) {
      return
    }
    setStations((prev) =>
      prev.map((station) =>
        station.workspaceId === activeWorkspaceId
          ? station
          : { ...station, workspaceId: activeWorkspaceId },
      ),
    )
  }, [activeWorkspaceId, setStations])

  useEffect(() => {
    if (!activeStationId) {
      return
    }
    clearStationUnread(activeStationId)
  }, [activeStationId, clearStationUnread])

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

  useEffect(() => {
    if (activeNavId !== 'stations') {
      return
    }
    if (filteredStations.length === 0) {
      return
    }
    if (!filteredStations.some((station) => station.id === activeStationId)) {
      setActiveStationId(filteredStations[0].id)
    }
  }, [activeNavId, activeStationId, filteredStations])

  useEffect(() => {
    const nextTargetIds = resolveValidTaskTargets(stations, taskDraft.targetStationIds)
    if (areTaskTargetsEqual(nextTargetIds, taskDraft.targetStationIds)) {
      return
    }
    setTaskDraft((prev) => ({
      ...prev,
      targetStationIds: nextTargetIds,
    }))
  }, [stations, taskDraft.targetStationIds])

  const readTaskCenterSnapshotFile = useCallback(
    async (input: { workspaceId: string; taskCenterDraftFilePath: string }) => {
      if (!desktopApi.isTauriRuntime()) {
        return null
      }
      try {
        const file = await desktopApi.fsReadFile(input.workspaceId, input.taskCenterDraftFilePath)
        if (!file.previewable) {
          return null
        }
        return file.content
      } catch {
        return null
      }
    },
    [],
  )

  const writeTaskCenterSnapshotFile = useCallback(
    async (input: {
      workspaceId: string
      taskCenterDraftFilePath: string
      serializedSnapshot: string
    }) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      await desktopApi.fsWriteFile(
        input.workspaceId,
        input.taskCenterDraftFilePath,
        input.serializedSnapshot,
      )
    },
    [],
  )

  useTaskCenterDraftPersistence({
    activeWorkspaceId,
    taskCenterDraftFilePath,
    stationsRef,
    activeStationId,
    taskDraft,
    taskDispatchHistory,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
    persistDebounceMs: TASK_DRAFT_PERSIST_DEBOUNCE_MS,
    setTaskDraft,
    setTaskDispatchHistory,
    setTaskSending,
    setTaskRetryingTaskId,
    setTaskDraftSavedAtMs,
    setTaskNotice,
    onReadTaskSnapshotFile: readTaskCenterSnapshotFile,
    onWriteTaskSnapshotFile: writeTaskCenterSnapshotFile,
  })

  const handlePickWorkspaceDirectory = useMemo(
    () => async () => {
      const selected = await pickDirectory({
        defaultPath: workspacePathInput || activeWorkspaceRoot || '/mnt/c/project/vbCode',
      })
      if (!selected) {
        return
      }
      const normalized = normalizeFsPath(selected)
      setWorkspacePathInput(normalized)
      await openWorkspaceAtPath(normalized, 'picker')
    },
    [activeWorkspaceRoot, openWorkspaceAtPath, setWorkspacePathInput, workspacePathInput],
  )

  const handlePickStationWorkdir = useMemo(
    () => async (): Promise<string | null> => {
      let workspaceRoot = activeWorkspaceRoot ?? workspacePathInput.trim()
      if (!workspaceRoot && activeWorkspaceId && desktopApi.isTauriRuntime()) {
        try {
          const context = await desktopApi.workspaceGetContext(activeWorkspaceId)
          workspaceRoot = context.root
          setActiveWorkspaceRoot(context.root)
        } catch {
          workspaceRoot = ''
        }
      }
      if (!workspaceRoot) {
        window.alert(
          locale === 'zh-CN'
            ? '请先绑定工作区后再选择角色目录。'
            : 'Bind a workspace before selecting station directory.',
        )
        return null
      }
      const selected = await pickDirectory({
        defaultPath: workspaceRoot,
      })
      if (!selected) {
        return null
      }
      const relative = toRelativePathIfInside(selected, workspaceRoot)
      if (!relative) {
        window.alert(
          locale === 'zh-CN'
            ? '所选目录必须位于当前工作区内。'
            : 'Selected directory must be inside the current workspace.',
        )
        return null
      }
      return relative
    },
    [activeWorkspaceId, activeWorkspaceRoot, locale, setActiveWorkspaceRoot, workspacePathInput],
  )

  const connectionLabel = useMemo(() => {
    switch (connectionState.code) {
      case 'checking':
        return t(locale, 'connection.checking')
      case 'web-preview':
        return t(locale, 'connection.webPreview')
      case 'tauri-connected':
        return t(locale, 'connection.tauriConnected')
      case 'workspace-read-failed':
        return t(locale, 'connection.workspaceReadFailed', {
          detail: connectionState.detail ?? 'unknown',
        })
      case 'git-read-failed':
        return t(locale, 'connection.gitReadFailed', {
          detail: connectionState.detail ?? 'unknown',
        })
      case 'input-required':
        return t(locale, 'connection.inputRequired')
      case 'not-tauri':
        return t(locale, 'connection.notTauri')
      case 'open-failed':
        return t(locale, 'connection.openFailed', {
          detail: connectionState.detail ?? 'unknown',
        })
      case 'bound':
        return t(locale, 'connection.bound', {
          detail: activeWorkspaceRoot ?? connectionState.detail ?? '',
        })
      default:
        return t(locale, 'connection.unknown')
    }
  }, [activeWorkspaceRoot, connectionState, locale])

  const resolveWorkspaceRoot = useMemo(
    () => async (workspaceId: string): Promise<string | null> => {
      if (activeWorkspaceRoot) {
        return activeWorkspaceRoot
      }
      try {
        const context = await desktopApi.workspaceGetContext(workspaceId)
        setActiveWorkspaceRoot(context.root)
        return context.root
      } catch {
        return null
      }
    },
    [activeWorkspaceRoot, setActiveWorkspaceRoot],
  )

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
              appendStationTerminalOutput(targetStationId, t(localeRef.current, 'system.webPreviewNoInput'))
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
                t(localeRef.current, 'system.sendFailed', {
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

  useEffect(() => {
    return () => {
      stationTerminalInputControllerRef.current?.dispose()
      stationTerminalInputControllerRef.current = null
    }
  }, [])


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
          setWorkbenchContainers((prev) =>
            prev.map((candidate) =>
              candidate.id === container.id
                ? {
                    ...candidate,
                    activeStationId: message.stationId,
                    lastActiveAtMs: Date.now(),
                  }
                : candidate,
            ),
          )
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
      resizeStationTerminal,
      resolveDetachedBridgeContainer,
    ],
  )

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
      ensureStationTerminalSession,
      ensureTerminalSessionVisible,
      locale,
      resetStationTerminalOutput,
      sendStationTerminalInput,
      setStationTerminalState,
    ],
  )

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

  const ensureTaskTargetRuntime = useCallback(
    async (input: { workspaceId: string; targetStationId: string }) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const station = stationsRef.current.find((item) => item.id === input.targetStationId)
      if (!station) {
        return
      }
      const sessionId = await ensureStationTerminalSession(station.id)
      if (!sessionId) {
        return
      }
      const currentStation = stationsRef.current.find((item) => item.id === input.targetStationId)
      const runtimeRegistrationCleanup = resolveStationRuntimeRegistrationCleanup(
        input.workspaceId,
        activeWorkspaceIdRef.current,
        Boolean(currentStation),
        sessionId,
        stationTerminalsRef.current[input.targetStationId],
      )
      if (runtimeRegistrationCleanup?.action === 'unregister') {
        void desktopApi.agentRuntimeUnregister(input.workspaceId, input.targetStationId).catch(() => {
          // Runtime sync effect will retry from current station ownership.
        })
        return
      }
      const registrationSessionId = runtimeRegistrationCleanup?.sessionId ?? sessionId
      const registrationResolvedCwd =
        runtimeRegistrationCleanup?.resolvedCwd ??
        stationTerminalsRef.current[input.targetStationId]?.resolvedCwd ??
        null
      const registrationStation = currentStation ?? station
      await desktopApi.agentRuntimeRegister({
        workspaceId: input.workspaceId,
        agentId: input.targetStationId,
        stationId: input.targetStationId,
        roleKey: registrationStation.role,
        sessionId: registrationSessionId,
        toolKind: normalizeStationToolKind(registrationStation.tool),
        resolvedCwd: registrationResolvedCwd,
        submitSequence: stationSubmitSequenceRef.current[input.targetStationId] ?? null,
        online: true,
      })
      await reconcileStationRuntimeRegistration({
        workspaceId: input.workspaceId,
        stationId: input.targetStationId,
        expectedSessionId: registrationSessionId,
      })
    },
    [ensureStationTerminalSession, reconcileStationRuntimeRegistration],
  )

  const dispatchTaskBatch = useCallback(
    async (input: {
      workspaceId: string
      title: string
      markdown: string
      targetStationIds: string[]
    }) => {
      const response = await desktopApi.taskDispatchBatch({
        workspaceId: input.workspaceId,
        sender: { type: 'human', agentId: null },
        targets: input.targetStationIds,
        title: input.title,
        markdown: input.markdown,
        attachments: [],
      })
      const postSubmitResults = await Promise.all(
        response.results.map(async (result) => {
          if (result.status !== 'sent') {
            return result
          }
          const submitted = await submitStationTerminal(result.targetAgentId)
          if (submitted) {
            return result
          }
          return {
            ...result,
            status: 'failed' as const,
            detail: 'XTERM_SUBMIT_FAILED',
          }
        }),
      )
      return {
        ...response,
        results: postSubmitResults,
      }
    },
    [submitStationTerminal],
  )

  const {
    updateTaskDraft,
    insertTaskSnippet,
    dispatchTaskToAgent,
    retryTaskDispatch,
  } = useTaskDispatchActions({
    locale,
    activeWorkspaceId,
    stationsRef,
    taskDraft,
    taskDispatchHistory,
    taskSending,
    taskRetryingTaskId,
    setTaskDraft,
    setTaskDispatchHistory,
    setTaskSending,
    setTaskRetryingTaskId,
    setTaskNotice,
    onEnsureTaskTargetRuntime: ensureTaskTargetRuntime,
    onDispatchTaskBatch: dispatchTaskBatch,
    describeError,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
  })

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
      clearStationTaskSignalTimer(stationId)
      delete stationTaskSignalNonceRef.current[stationId]
      setStationTaskSignals((prev) => {
        if (!prev[stationId]) {
          return prev
        }
        const next = { ...prev }
        delete next[stationId]
        return next
      })
      if (workspaceId && desktopApi.isTauriRuntime()) {
        void desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {
          // Runtime sync effect will retry if this one fails.
        })
      }
      return true
    },
    [appendStationTerminalOutput, clearStationTaskSignalTimer, locale, setStations, setStationTerminalState],
  )

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
        await loadStationsFromDatabase(workspaceId)
      }
      setStationDeleteCleanupTargetId(null)
      setStationDeleteCleanupState(null)
      setIsStationManageOpen(false)
      setEditingStation(null)
    },
    [cleanupRemovedStationRuntimeState, loadStationsFromDatabase],
  )

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
      await loadStationsFromDatabase(workspaceId)
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
    loadStationsFromDatabase,
    stationDeleteCleanupState,
    stationDeleteCleanupTargetId,
  ])

  const {
    workbenchContainerSnapshotEntries,
    workbenchContainerSnapshotSignature,
    handleCanvasSelectStation,
    createWorkbenchContainer,
    deleteWorkbenchContainer,
    floatWorkbenchContainer,
    dockWorkbenchContainer,
    toggleWorkbenchContainerTopmost,
    detachWorkbenchContainer,
    reclaimDetachedContainer,
    moveStationToWorkbenchContainer,
    moveFloatingWorkbenchContainer,
    resizeFloatingWorkbenchContainer,
    focusFloatingWorkbenchContainer,
    handleCanvasLaunchStationTerminal,
    handleCanvasLaunchCliAgent,
    handleCanvasLayoutModeChange,
    handleCanvasCustomLayoutChange,
    handleCanvasRemoveStation,
  } = useShellWorkbenchController({
    workbenchContainers,
    setWorkbenchContainers,
    workbenchContainersRef,
    workbenchContainerCounterRef,
    detachedWindowOpenInFlightRef,
    tauriRuntime,
    canvasLayoutMode,
    canvasCustomLayout,
    setActiveStationId,
    launchStationTerminal,
    launchStationCliAgent,
    removeStation,
  })

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

  const togglePinnedWorkbenchContainer = useCallback((containerId: string) => {
    setPinnedWorkbenchContainerId((prev) => (prev === containerId ? null : containerId))
  }, [])

  const handleCanvasOpenStationManage = useCallback(() => {
    setEditingStation(null)
    setIsStationManageOpen(true)
  }, [])

  const handleCanvasOpenStationSearch = useCallback(() => {
    setIsStationSearchOpen(true)
  }, [])

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

  const executeStationAction = useCallback(
    async (station: AgentStation, action: StationActionDescriptor) => {
      const execution: StationActionExecution = action.execution
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
          setIsChannelStudioOpen(false)
          setIsSettingsOpen(true)
          return
        case 'open_channel_studio':
          setActiveNavId('channels')
          setIsSettingsOpen(false)
          setIsChannelStudioOpen(true)
          return
        case 'launch_tool_profile': {
          await launchToolProfileForStation(station, execution.profileId)
          return
        }
        default:
          return
      }
    },
    [handleStationTerminalInput, launchStationCliAgent, launchToolProfileForStation, submitStationTerminal],
  )

  const handleCanvasScrollToStationHandled = useCallback((stationId: string) => {
    setPendingScrollStationId((prev) => (prev === stationId ? null : prev))
  }, [])

  useEffect(() => {
    void loadToolCommandsForStations()
  }, [activeWorkspaceId, loadToolCommandsForStations, toolCommandReloadKey])

  const terminalSessionSnapshotEntries = useMemo(
    () =>
      stations.reduce<WorkspaceSessionTerminalSnapshot[]>((acc, station) => {
        const runtime = stationTerminals[station.id]
        if (!runtime?.sessionId) {
          return acc
        }
        acc.push({
          stationId: station.id,
          shell: runtime.shell,
          cwdMode: runtime.cwdMode,
          resolvedCwd: runtime.resolvedCwd,
          active: station.id === activeStationId,
        })
        return acc
      }, []),
    [activeStationId, stationTerminals, stations],
  )

  const terminalSessionSnapshotSignature = useMemo(
    () =>
      terminalSessionSnapshotEntries
        .map(
          (entry) =>
            `${entry.stationId}:${entry.shell ?? ''}:${entry.cwdMode}:${entry.resolvedCwd ?? ''}:${
              entry.active ? '1' : '0'
            }`,
        )
        .join('|'),
    [terminalSessionSnapshotEntries],
  )

  useEffect(() => {
    tabSessionSnapshotRef.current = tabSessionSnapshotEntries
  }, [tabSessionSnapshotEntries])

  useEffect(() => {
    terminalSessionSnapshotRef.current = terminalSessionSnapshotEntries
  }, [terminalSessionSnapshotEntries])

  useEffect(() => {
    workbenchContainerSnapshotRef.current = workbenchContainerSnapshotEntries
  }, [workbenchContainerSnapshotEntries])

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      workspaceSessionHydratingRef.current = false
      return
    }

    workspaceSessionRestoreTabTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId)
    })
    workspaceSessionRestoreTabTimersRef.current = []

    const workspaceId = activeWorkspaceId
    const restoreSeq = workspaceSessionRestoreSeqRef.current + 1
    workspaceSessionRestoreSeqRef.current = restoreSeq
    workspaceSessionHydratingRef.current = true
    let cancelled = false

    const restoreWorkspaceSession = async () => {
      try {
        const response = await desktopApi.workspaceRestoreSession(workspaceId)
        if (
          cancelled ||
          workspaceSessionRestoreSeqRef.current !== restoreSeq ||
          activeWorkspaceIdRef.current !== workspaceId
        ) {
          return
        }

        let rawSnapshot: string | null = null
        try {
          const file = await desktopApi.fsReadFile(workspaceId, workspaceSessionFilePath)
          if (file.previewable) {
            rawSnapshot = file.content
          }
        } catch {
          rawSnapshot = null
        }

        const restored =
          (rawSnapshot ? parseWorkspaceSessionSnapshot(rawSnapshot) : null) ??
          parseWorkspaceSessionSnapshot(
            JSON.stringify({
              version: 1,
              updatedAtMs: Date.now(),
              windows: response.windows,
              tabs: response.tabs,
              terminals: response.terminals,
              workbenchContainers: [],
            }),
          )
        if (!restored) {
          return
        }

        pendingWorkbenchContainerSnapshotsRef.current = restored.workbenchContainers
        if (stationsRef.current.length > 0) {
          pendingWorkbenchContainerSnapshotsRef.current = null
          setWorkbenchContainers(
            restoreWorkbenchContainers(
              restored.workbenchContainers,
              stationsRef.current,
              buildDefaultWorkbenchContainerId,
              {
                mode: canvasLayoutMode,
                customLayout: canvasCustomLayout,
              },
            ),
          )
        }

        const activeNav = restored.windows[0]?.activeNavId
        if (typeof activeNav === 'string' && isNavItemId(activeNav)) {
          setActiveNavId(activeNav)
        }

        const restoredPinnedWorkbenchContainerId = restored.windows[0]?.pinnedWorkbenchContainerId
        if (
          typeof restoredPinnedWorkbenchContainerId === 'string' &&
          restoredPinnedWorkbenchContainerId.trim() &&
          restored.workbenchContainers.some(
            (container) =>
              container.id === restoredPinnedWorkbenchContainerId && container.mode === 'docked',
          )
        ) {
          setPinnedWorkbenchContainerId(restoredPinnedWorkbenchContainerId)
        } else {
          setPinnedWorkbenchContainerId(null)
        }

        const tabsToRestore = restored.tabs.slice(0, WORKSPACE_SESSION_MAX_RESTORE_TABS)
        const activeTabPath = tabsToRestore.find((tab) => tab.active)?.path ?? tabsToRestore[0]?.path ?? null
        setOpenedFiles(
          tabsToRestore.map((tab) => ({
            path: tab.path,
            content: '',
            size: 0,
            isModified: false,
            hydrated: false,
            viewType: isPreviewable(tab.path) ? 'preview' : 'editor',
          })),
        )
        setActiveFilePath(activeTabPath)
        if (activeTabPath) {
          await loadFileContentRef.current(activeTabPath, 'full')
        }

        const stationIdSet = new Set(stationsRef.current.map((station) => station.id))
        const workspaceRoot = await resolveWorkspaceRoot(workspaceId)
        const restorableTerminals = restored.terminals
          .filter((terminal) => stationIdSet.has(terminal.stationId))
          .sort((left, right) => Number(right.active) - Number(left.active))
          .slice(0, WORKSPACE_SESSION_MAX_RESTORE_TERMINALS)

        let restoredActiveStationId: string | null = null
        for (const terminal of restorableTerminals) {
          if (
            cancelled ||
            workspaceSessionRestoreSeqRef.current !== restoreSeq ||
            activeWorkspaceIdRef.current !== workspaceId
          ) {
            return
          }
          try {
            const station = stationsRef.current.find((item) => item.id === terminal.stationId)
            const restoreCwd =
              station && workspaceRoot
                ? resolveAgentWorkdirAbs(workspaceRoot, station.agentWorkdirRel)
                : terminal.resolvedCwd
            const restoreCwdMode = restoreCwd ? 'custom' : 'workspace_root'
            const terminalEnv = station
              ? {
                  GTO_WORKSPACE_ID: workspaceId,
                  GTO_AGENT_ID: station.id,
                  GTO_ROLE_KEY: station.role,
                  GTO_STATION_ID: station.id,
                }
              : undefined
            const session = await desktopApi.terminalCreate(workspaceId, {
              shell: terminal.shell,
              cwdMode: restoreCwdMode,
              cwd: restoreCwd,
              env: terminalEnv,
              agentToolKind: station ? normalizeStationToolKind(station.tool) : 'unknown',
              injectProviderEnv: false,
            })
            if (
              !shouldApplyStationSessionResult(
                workspaceId,
                activeWorkspaceIdRef.current,
                stationsRef.current.some((item) => item.id === terminal.stationId),
                stationTerminalsRef.current[terminal.stationId],
              )
            ) {
              const droppedSessionCleanup = resolveDroppedStationSessionCleanup(session.sessionId)
              if (droppedSessionCleanup) {
                void desktopApi.terminalKill(
                  droppedSessionCleanup.sessionId,
                  droppedSessionCleanup.signal,
                ).catch(() => {
                  // Dropped restore sessions must not leave orphan backend sessions behind.
                })
              }
              continue
            }
            sessionStationRef.current[session.sessionId] = terminal.stationId
            terminalSessionSeqRef.current[session.sessionId] = 0
            terminalOutputQueueRef.current[session.sessionId] = Promise.resolve()
            delete stationTerminalRestoreStateRef.current[terminal.stationId]
            ensureTerminalSessionVisible(session.sessionId)
            setStationTerminalState(terminal.stationId, {
              sessionId: session.sessionId,
              stateRaw: 'running',
              unreadCount: 0,
              shell: session.shell,
              cwdMode: session.cwdMode,
              resolvedCwd: session.resolvedCwd,
            })
            if (terminal.active && !restoredActiveStationId) {
              restoredActiveStationId = terminal.stationId
            }
          } catch {
            // Keep restore resilient: one terminal failure must not block overall restore.
          }
        }

        if (restoredActiveStationId) {
          setActiveStationId(restoredActiveStationId)
        }
      } finally {
        if (workspaceSessionRestoreSeqRef.current === restoreSeq) {
          workspaceSessionHydratingRef.current = false
        }
      }
    }

    void restoreWorkspaceSession()

    return () => {
      cancelled = true
      workspaceSessionRestoreTabTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      workspaceSessionRestoreTabTimersRef.current = []
      if (workspaceSessionRestoreSeqRef.current === restoreSeq) {
        workspaceSessionHydratingRef.current = false
      }
    }
  }, [
    activeWorkspaceId,
    canvasCustomLayout,
    canvasLayoutMode,
    ensureTerminalSessionVisible,
    loadFileContentRef,
    setActiveFilePath,
    setOpenedFiles,
    setStationTerminalState,
    workspaceSessionFilePath,
  ])

  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }
    if (workspaceSessionHydratingRef.current) {
      return
    }

    const existingTimerId = workspaceSessionPersistTimerRef.current
    if (typeof existingTimerId === 'number') {
      window.clearTimeout(existingTimerId)
    }

    const workspaceId = activeWorkspaceId
    workspaceSessionPersistTimerRef.current = window.setTimeout(() => {
      if (workspaceSessionHydratingRef.current || activeWorkspaceIdRef.current !== workspaceId) {
        return
      }
      const snapshot = buildWorkspaceSessionSnapshot({
        updatedAtMs: Date.now(),
        windows: [{ activeNavId, pinnedWorkbenchContainerId }],
        tabs: tabSessionSnapshotRef.current,
        terminals: terminalSessionSnapshotRef.current,
        workbenchContainers: workbenchContainerSnapshotRef.current,
      })
      const serialized = serializeWorkspaceSessionSnapshot(snapshot)
      void desktopApi.fsWriteFile(workspaceId, workspaceSessionFilePath, serialized).catch(() => {
        // Keep UI responsive: snapshot persistence is best-effort.
      })
      workspaceSessionPersistTimerRef.current = null
    }, WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS)

    return () => {
      const timerId = workspaceSessionPersistTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      workspaceSessionPersistTimerRef.current = null
    }
  }, [
    activeNavId,
    activeWorkspaceId,
    pinnedWorkbenchContainerId,
    tabSessionSnapshotSignature,
    workbenchContainerSnapshotSignature,
    terminalSessionSnapshotSignature,
    workspaceSessionFilePath,
  ])

  useEffect(() => {
    if (!tauriRuntime) {
      return
    }

    let disposed = false
    let cleanup = () => {}

    void desktopApi
      .subscribeSurfaceEvents({
        onWindowClosed: (payload) => {
          delete detachedProjectionDispatchQueueRef.current[payload.windowLabel]
          Object.keys(detachedProjectionSeqRef.current).forEach((key) => {
            if (key.startsWith(`${payload.windowLabel}:`)) {
              delete detachedProjectionSeqRef.current[key]
            }
          })
          setWorkbenchContainers((prev) => {
            const targetIndex = prev.findIndex(
              (container) => container.detachedWindowLabel === payload.windowLabel,
            )
            if (targetIndex < 0) {
              return prev
            }
            const floatingIndex = prev.filter((container) => container.mode === 'floating').length
            const target = prev[targetIndex]
            const restoreMode = target.resumeMode === 'floating' ? 'floating' : 'docked'
            const next = [...prev]
            next[targetIndex] = {
              ...target,
              mode: restoreMode,
              topmost: restoreMode === 'floating' ? true : false,
              frame:
                restoreMode === 'floating'
                  ? normalizeWorkbenchContainerFrame(target.frame) ??
                    createDefaultFloatingFrame(floatingIndex)
                  : null,
              detachedWindowLabel: null,
              lastActiveAtMs: Date.now(),
            }
            return next
          })
        },
        onWindowUpdated: (payload) => {
          setWorkbenchContainers((prev) =>
            prev.map((container) =>
              container.detachedWindowLabel === payload.windowLabel
                ? {
                    ...container,
                    topmost: payload.topmost,
                  }
                : container,
            ),
          )
        },
        onBridge: (payload) => {
          if (payload.targetWindowLabel !== DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL) {
            return
          }
          handleDetachedSurfaceBridgeMessage(payload)
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
  }, [handleDetachedSurfaceBridgeMessage, tauriRuntime])

  useEffect(() => {
    if (!tauriRuntime || !activeWorkspaceId) {
      return
    }

    workbenchContainers.forEach((container) => {
      if (
        container.mode !== 'detached' ||
        container.detachedWindowLabel ||
        detachedWindowOpenInFlightRef.current[container.id]
      ) {
        return
      }
      const surfaceStations = container.stationIds
        .map<SurfaceDetachedStationPayload | null>((stationId) => {
          const station = stations.find((item) => item.id === stationId)
          if (!station) {
            return null
          }
          return {
            stationId: station.id,
            name: station.name,
            role: station.role,
            tool: station.tool,
            agentWorkdirRel: station.agentWorkdirRel,
            roleWorkdirRel: station.roleWorkdirRel,
            workspaceId: activeWorkspaceId,
            sessionId: stationTerminals[station.id]?.sessionId ?? null,
          }
        })
        .filter((station): station is SurfaceDetachedStationPayload => station !== null)

      if (surfaceStations.length === 0) {
        return
      }

      detachedWindowOpenInFlightRef.current[container.id] = true
      void desktopApi
        .surfaceOpenDetachedWindow({
          workspaceId: activeWorkspaceId,
          containerId: container.id,
          title: buildWorkbenchContainerTitle(container, stations),
          activeStationId: container.activeStationId,
          layoutMode: container.layoutMode,
          customLayout: container.customLayout,
          topmost: container.topmost,
          stations: surfaceStations,
        })
        .then((response) => {
          if (activeWorkspaceIdRef.current !== activeWorkspaceId) {
            return
          }
          setWorkbenchContainers((prev) =>
            prev.map((item) =>
              item.id === container.id
                ? {
                    ...item,
                    detachedWindowLabel: response.windowLabel,
                    lastActiveAtMs: Date.now(),
                  }
                : item,
            ),
          )
        })
        .catch(() => {
          if (activeWorkspaceIdRef.current !== activeWorkspaceId) {
            return
          }
          setWorkbenchContainers((prev) => {
            const floatingIndex = prev.filter((item) => item.mode === 'floating').length
            return prev.map((item) => {
              if (item.id !== container.id) {
                return item
              }
              const restoreMode = item.resumeMode === 'floating' ? 'floating' : 'docked'
              return {
                ...item,
                mode: restoreMode,
                topmost: restoreMode === 'floating' ? true : false,
                frame:
                  restoreMode === 'floating'
                    ? normalizeWorkbenchContainerFrame(item.frame) ??
                      createDefaultFloatingFrame(floatingIndex)
                    : null,
                detachedWindowLabel: null,
              }
            })
          })
        })
        .finally(() => {
          delete detachedWindowOpenInFlightRef.current[container.id]
        })
    })
  }, [activeWorkspaceId, stationTerminals, stations, tauriRuntime, workbenchContainers])

  const handleSelectNav = useCallback(
    (id: NavItemId) => {
      const isSameTab = id === activeNavId
      setActiveNavId(id)
      if (isSameTab) {
        setLeftPaneVisible((prev) => !prev)
      } else {
        setLeftPaneVisible(true)
      }
    },
    [activeNavId],
  )

  const triggerFileSearch = useCallback((mode?: 'file' | 'content') => {
    requestFileSearch(mode)
  }, [requestFileSearch])

  const triggerFileEditorCommand = useCallback(
    (type: 'find' | 'replace' | 'findNext' | 'findPrevious') => {
      requestFileEditorCommand(type)
    },
    [requestFileEditorCommand],
  )

  useEffect(() => {
    leftPaneVisibleRef.current = leftPaneVisible
  }, [leftPaneVisible])

  useEffect(() => {
    shortcutBindingsRef.current = shortcutBindings
  }, [shortcutBindings])

  useEffect(() => {
    nativeWindowTopMacOsRef.current = nativeWindowTopMacOs
  }, [nativeWindowTopMacOs])

  useEffect(() => {
    triggerFileSearchRef.current = triggerFileSearch
  }, [triggerFileSearch])

  useEffect(() => {
    triggerFileEditorCommandRef.current = triggerFileEditorCommand
  }, [triggerFileEditorCommand])

  const shouldRouteFileEditorShortcut = useCallback((target: EventTarget | null) => {
    if (isEditableKeyboardTarget(target) && !isCodeEditorKeyboardTarget(target)) {
      return false
    }
    return activeNavId === 'files' && Boolean(activeFilePath)
  }, [activeFilePath, activeNavId])

  const shouldRouteFileEditorShortcutRef = useRef(shouldRouteFileEditorShortcut)

  useEffect(() => {
    shouldRouteFileEditorShortcutRef.current = shouldRouteFileEditorShortcut
  }, [shouldRouteFileEditorShortcut])

  const isShortcutRepeat = useCallback((event: KeyboardEvent) => event.repeat, [])

  const closeTaskQuickDispatch = useCallback(() => {
    setIsTaskQuickDispatchOpen(false)
  }, [])

  useEffect(() => {
    if (!nativeWindowTopMacOs || !desktopApi.isTauriRuntime()) {
      return
    }

    let disposed = false
    const installSeq = macOsNativeMenuInstallSeqRef.current + 1
    macOsNativeMenuInstallSeqRef.current = installSeq

    const installNativeShortcutMenu = async () => {
      try {
        const { Menu, Submenu } = await import('@tauri-apps/api/menu')
        if (disposed || installSeq !== macOsNativeMenuInstallSeqRef.current) {
          return
        }

        const searchMenu = await Submenu.new({
          text: t(locale, '工作区搜索', 'Search'),
          items: [
            {
              id: 'shell.search.open_file',
              text: t(locale, '文件搜索', 'Quick Open'),
              accelerator: formatNativeMenuAccelerator(shortcutBindings.openFileSearch, true),
              action: () => {
                triggerFileSearch('file')
              },
            },
            {
              id: 'shell.search.open_content',
              text: t(locale, '内容搜索', 'Search In Files'),
              accelerator: formatNativeMenuAccelerator(shortcutBindings.openContentSearch, true),
              action: () => {
                triggerFileSearch('content')
              },
            },
          ],
        })
        const editMenu = await Submenu.new({
          text: t(locale, '编辑', 'Edit'),
          items: [
            { item: 'Undo' },
            { item: 'Redo' },
            { item: 'Separator' },
            { item: 'Cut' },
            { item: 'Copy' },
            { item: 'Paste' },
            { item: 'SelectAll' },
          ],
        })
        const windowMenu = await Submenu.new({
          text: t(locale, '窗口', 'Window'),
          items: [{ item: 'Minimize' }, { item: 'Maximize' }, { item: 'Fullscreen' }],
        })
        const appMenu = await Submenu.new({
          text: 'GT Office',
          items: [
            { item: { About: { name: 'GT Office' } } },
            { item: 'Services' },
            { item: 'Separator' },
            { item: 'Hide' },
            { item: 'HideOthers' },
            { item: 'ShowAll' },
            { item: 'Separator' },
            { item: 'Quit' },
          ],
        })

        const nextMenu = await Menu.new({
          items: [appMenu, searchMenu, editMenu, windowMenu],
        })
        if (disposed || installSeq !== macOsNativeMenuInstallSeqRef.current) {
          void nextMenu.close().catch(() => {
            // Ignore stale menu disposal failures.
          })
          return
        }

        const previousMenu = await nextMenu.setAsAppMenu()
        void windowMenu.setAsWindowsMenuForNSApp().catch(() => {
          // The app menu still works even if the dedicated Window menu hint fails.
        })
        if (previousMenu) {
          void previousMenu.close().catch(() => {
            // Ignore old menu cleanup failures.
          })
        }
      } catch {
        // Ignore native menu installation failures and keep DOM shortcuts active.
      }
    }

    void installNativeShortcutMenu()

    return () => {
      disposed = true
    }
  }, [locale, nativeWindowTopMacOs, shortcutBindings.openContentSearch, shortcutBindings.openFileSearch, triggerFileSearch])

  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent) => {
      if (document.body.dataset.gtoShortcutRecording === 'true') {
        return
      }

      const bindings = shortcutBindingsRef.current
      const isMacOs = nativeWindowTopMacOsRef.current


      if (matchesShortcutEvent(event, bindings.taskQuickDispatch, isMacOs)) {
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        setIsTaskQuickDispatchOpen((prev) => !prev)
        return
      }

      if (matchesShortcutEvent(event, bindings.openContentSearch, isMacOs)) {
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearchRef.current('content')
        return
      }

      if (matchesShortcutEvent(event, bindings.editorFind, isMacOs)) {
        if (!shouldRouteFileEditorShortcutRef.current(event.target)) {
          return
        }
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileEditorCommandRef.current('find')
        return
      }

      if (matchesShortcutEvent(event, bindings.editorReplace, isMacOs)) {
        if (!shouldRouteFileEditorShortcutRef.current(event.target)) {
          return
        }
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileEditorCommandRef.current('replace')
        return
      }

      if (matchesShortcutEvent(event, bindings.openFileSearch, isMacOs)) {
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearchRef.current('file')
        return
      }

      // Prevent desktop WebView reload/zoom shortcuts without swallowing plain text input.
      if (desktopApi.isTauriRuntime() && shouldPreventDesktopBrowserShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', onGlobalShortcut, { capture: true })
    return () => {
      window.removeEventListener('keydown', onGlobalShortcut, { capture: true })
    }
  }, [isShortcutRepeat])

  // Sync refs when React state settles (only on mount and post-resize commit).
  useEffect(() => {
    leftPaneWidthRef.current = leftPaneWidth
  }, [leftPaneWidth])
  useEffect(() => {
    rightPaneWidthRef.current = rightPaneWidth
  }, [rightPaneWidth])

  const handleLeftPaneResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const pointerId = event.pointerId
      const startWidth = leftPaneWidthRef.current
      const startX = event.clientX

      leftPaneResizeRef.current = {
        pointerId,
        startX,
        startWidth,
        rafId: null,
        lastClientX: startX,
        currentWidth: startWidth,
      }

      const dragHandle = event.currentTarget
      dragHandle.setPointerCapture(pointerId)

      // Toggle visual feedback via DOM classes — zero React renders.
      dragHandle.classList.add('active')
      const shellContainer = shellContainerRef.current
      if (shellContainer) {
        shellContainer.classList.add('shell-pane-resizing')
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const finishResize = (releasedPointerId: number) => {
        const ref = leftPaneResizeRef.current
        if (!ref || ref.pointerId !== releasedPointerId) {
          return
        }
        if (ref.rafId) {
          cancelAnimationFrame(ref.rafId)
        }
        const finalWidth = ref.currentWidth
        leftPaneResizeRef.current = null

        // Restore body styles.
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        // Remove visual feedback classes.
        dragHandle.classList.remove('active')
        if (shellContainer) {
          shellContainer.classList.remove('shell-pane-resizing')
        }

        if (dragHandle.hasPointerCapture(releasedPointerId)) {
          dragHandle.releasePointerCapture(releasedPointerId)
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)

        // Single React commit at the end with the final value.
        leftPaneWidthRef.current = finalWidth
        setLeftPaneWidth(finalWidth)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const ref = leftPaneResizeRef.current
        if (!ref || ref.pointerId !== moveEvent.pointerId) {
          return
        }
        // Always read clientX synchronously (before RAF) so the value isn't stale.
        ref.lastClientX = moveEvent.clientX

        if (ref.rafId === null) {
          ref.rafId = requestAnimationFrame(() => {
            const innerRef = leftPaneResizeRef.current
            if (!innerRef) return

            innerRef.rafId = null
            const delta = innerRef.lastClientX - innerRef.startX
            const newWidth = clampLeftPaneWidth(innerRef.startWidth + delta, leftPaneWidthMax)

            innerRef.currentWidth = newWidth
            // Direct DOM write — bypasses React entirely.
            shellMainRef.current?.style.setProperty('--shell-left-pane-width', `${newWidth}px`)
          })
        }
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        finishResize(upEvent.pointerId)
      }

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        finishResize(cancelEvent.pointerId)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    },
    [leftPaneWidthMax],
  )

  const handleLeftPaneResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev - step, leftPaneWidthMax))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev + step, leftPaneWidthMax))
    }
  }, [leftPaneWidthMax])

  const handleRightPaneResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const pointerId = event.pointerId
      const startWidth = rightPaneWidthRef.current
      const startX = event.clientX

      rightPaneResizeRef.current = {
        pointerId,
        startX,
        startWidth,
        rafId: null,
        lastClientX: startX,
        currentWidth: startWidth,
      }

      const dragHandle = event.currentTarget
      dragHandle.setPointerCapture(pointerId)

      dragHandle.classList.add('active')
      const shellContainer = shellContainerRef.current
      if (shellContainer) {
        shellContainer.classList.add('shell-pane-resizing')
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const finishResize = (releasedPointerId: number) => {
        const ref = rightPaneResizeRef.current
        if (!ref || ref.pointerId !== releasedPointerId) {
          return
        }
        if (ref.rafId) {
          cancelAnimationFrame(ref.rafId)
        }
        const finalWidth = ref.currentWidth
        rightPaneResizeRef.current = null

        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        dragHandle.classList.remove('active')
        if (shellContainer) {
          shellContainer.classList.remove('shell-pane-resizing')
        }

        if (dragHandle.hasPointerCapture(releasedPointerId)) {
          dragHandle.releasePointerCapture(releasedPointerId)
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)

        rightPaneWidthRef.current = finalWidth
        setRightPaneWidth(finalWidth)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const ref = rightPaneResizeRef.current
        if (!ref || ref.pointerId !== moveEvent.pointerId) {
          return
        }
        ref.lastClientX = moveEvent.clientX

        if (ref.rafId === null) {
          ref.rafId = requestAnimationFrame(() => {
            const innerRef = rightPaneResizeRef.current
            if (!innerRef) return

            innerRef.rafId = null
            const delta = innerRef.startX - innerRef.lastClientX
            const newWidth = clampRightPaneWidth(innerRef.startWidth + delta, rightPaneWidthMax)

            innerRef.currentWidth = newWidth
            shellMainRef.current?.style.setProperty('--shell-right-pane-width', `${newWidth}px`)
          })
        }
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        finishResize(upEvent.pointerId)
      }

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        finishResize(cancelEvent.pointerId)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    },
    [rightPaneWidthMax],
  )

  const handleRightPaneResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setRightPaneWidth((prev) => clampRightPaneWidth(prev + step, rightPaneWidthMax))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setRightPaneWidth((prev) => clampRightPaneWidth(prev - step, rightPaneWidthMax))
    }
  }, [rightPaneWidthMax])

  const shellMainStyle = useMemo(
    () =>
      ({
        '--shell-left-pane-width': `${leftPaneWidth}px`,
        '--shell-right-pane-width': `${rightPaneWidth}px`,
      }) as CSSProperties,
    [leftPaneWidth, rightPaneWidth],
  )

  const dismissTelegramDebugToast = useCallback(() => {
    const timerId = telegramDebugToastTimerRef.current
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId)
    }
    telegramDebugToastTimerRef.current = null
    setTelegramDebugToast(null)
  }, [])

  const handleOpenSettings = useCallback(() => {
    setIsChannelStudioOpen(false)
    setIsSettingsOpen(true)
  }, [])

  const handleTaskSend = useCallback(() => {
    void dispatchTaskToAgent()
  }, [dispatchTaskToAgent])

  const handleRetryDispatchTask = useCallback(
    (taskId: string) => {
      void retryTaskDispatch(taskId)
    },
    [retryTaskDispatch],
  )

  const handleRefreshExternalChannelStatus = useCallback(() => {
    void refreshExternalChannelStatus()
  }, [refreshExternalChannelStatus])

  const handleFileTreeSelectFile = useCallback(
    (filePath: string, line?: number) => {
      void (async () => {
        setActiveNavId('files')
        setLeftPaneVisible(true)
        await loadFileContent(filePath, 'full')
        if (typeof line === 'number' && Number.isFinite(line)) {
          if (pendingFileEditorCommandFrameRef.current !== null) {
            window.cancelAnimationFrame(pendingFileEditorCommandFrameRef.current)
          }
          pendingFileEditorCommandFrameRef.current = window.requestAnimationFrame(() => {
            pendingFileEditorCommandFrameRef.current = null
            requestFileEditorCommand('gotoLine', { line, targetPath: filePath })
          })
        }
      })()
    },
    [loadFileContent, requestFileEditorCommand],
  )

  const handleStationOverviewViewChange = useCallback((patch: Partial<typeof stationOverviewState>) => {
    setStationOverviewState((prev) => ({ ...prev, ...patch }))
  }, [])

  const handleStationOverviewSelectStation = useCallback((stationId: string) => {
    setActiveStationId(stationId)
  }, [])

  const handleStationOverviewEditStation = useCallback((station: AgentStation) => {
    setEditingStation(createStationEditInput(station))
    setIsStationManageOpen(true)
  }, [])

  const handleGitHistoryOpenInEditor = useCallback(
    (filePath: string) => {
      setActiveNavId('files')
      void loadFileContent(filePath, 'full')
    },
    [loadFileContent],
  )

  const handleStationSearchSelectStation = useCallback((stationId: string) => {
    setActiveNavId('stations')
    setActiveStationId(stationId)
    setPendingScrollStationId(stationId)
  }, [])

  const pinnedWorkbenchContainer = useMemo(
    () =>
      pinnedWorkbenchContainerId
        ? workbenchContainers.find((container) => container.id === pinnedWorkbenchContainerId) ?? null
        : null,
    [pinnedWorkbenchContainerId, workbenchContainers],
  )
  const unpinnedWorkbenchContainers = useMemo(
    () =>
      pinnedWorkbenchContainer
        ? workbenchContainers.filter((container) => container.id !== pinnedWorkbenchContainer.id)
        : workbenchContainers,
    [pinnedWorkbenchContainer, workbenchContainers],
  )
  const dockedContainerOptions = useMemo(
    () =>
      workbenchContainers
        .filter((container) => container.mode === 'docked')
        .map((container, index) => {
          const activeStation = container.activeStationId
            ? stations.find((s) => s.id === container.activeStationId)
            : null
          const label = activeStation?.name ?? `Container ${index + 1}`
          return { id: container.id, label }
        }),
    [workbenchContainers, stations],
  )

  const showWorkbenchCanvas = activeNavId !== 'files' && activeNavId !== 'git'
  const showPinnedWorkbenchPane =
    Boolean(pinnedWorkbenchContainer) &&
    (activeNavId === 'files' || activeNavId === 'git' || unpinnedWorkbenchContainers.length > 0)
  const projectedWorkbenchContainers = showPinnedWorkbenchPane ? unpinnedWorkbenchContainers : workbenchContainers
  const hasGlobalTopmostWorkbench = useMemo(
    () => workbenchContainers.some((container) => container.mode === 'floating' && container.topmost),
    [workbenchContainers],
  )

  const taskComposerBaseProps = {
    locale,
    stations,
    draft: taskDraft,
    sending: taskSending,
    draftSavedAtMs: taskDraftSavedAtMs,
    notice: taskNotice,
    mentionCandidates: taskMentionCandidates,
    mentionLoading: taskMentionLoading,
    mentionError: taskMentionError,
    onDraftChange: updateTaskDraft,
    onInsertSnippet: insertTaskSnippet,
    onSendTask: handleTaskSend,
    onSearchMentionFiles: searchTaskMentionFiles,
    onClearMentionSearch: clearTaskMentionSearch,
  }

  const workbenchCanvasBaseProps = {
    locale,
    appearanceVersion: `${uiPreferences.themeMode}:${uiPreferences.monoFont}:${uiPreferences.uiFontSize}`,
    performanceDebugEnabled: performanceDebugState.enabled,
    showFloatingPortal: true as const,
    stations,
    roleFilter: stationOverviewState.roleFilter,
    activeStationId,
    terminalByStation: stationTerminals,
    agentRunningByStationId: stationAgentRunningById,
    taskSignalByStationId: stationTaskSignals,
    channelBotBindingsByStationId,
    pinnedWorkbenchContainerId,
    onTogglePinnedWorkbenchContainer: togglePinnedWorkbenchContainer,
    onSelectStation: handleCanvasSelectStation,
    onLaunchStationTerminal: handleCanvasLaunchStationTerminal,
    onLaunchCliAgent: handleCanvasLaunchCliAgent,
    onSendInputData: handleStationTerminalInput,
    onResizeTerminal: resizeStationTerminal,
    onBindTerminalSink: bindStationTerminalSink,
    onRenderedScreenSnapshot: reportRenderedScreenSnapshot,
    onLayoutModeChange: handleCanvasLayoutModeChange,
    onCustomLayoutChange: handleCanvasCustomLayoutChange,
    onFloatContainer: floatWorkbenchContainer,
    onDockContainer: dockWorkbenchContainer,
    onDetachContainer: detachWorkbenchContainer,
    onToggleContainerTopmost: toggleWorkbenchContainerTopmost,
    onCreateContainer: createWorkbenchContainer,
    onDeleteContainer: deleteWorkbenchContainer,
    onReclaimDetachedContainer: reclaimDetachedContainer,
    onMoveStationToContainer: moveStationToWorkbenchContainer,
    onMoveFloatingContainer: moveFloatingWorkbenchContainer,
    onResizeFloatingContainer: resizeFloatingWorkbenchContainer,
    onFocusFloatingContainer: focusFloatingWorkbenchContainer,
    onOpenStationManage: handleCanvasOpenStationManage,
    onOpenStationSearch: handleCanvasOpenStationSearch,
    onRemoveStation: handleCanvasRemoveStation,
  }

  const pinnedWorkbenchCanvasProps = showPinnedWorkbenchPane && pinnedWorkbenchContainer
    ? {
        ...workbenchCanvasBaseProps,
        containers: [pinnedWorkbenchContainer],
        pinnedWorkbenchContainerId,
        showStage: true,
        showFloatingPortal: false,
        floatingVisibility: 'non_topmost' as const,
        onRunStationAction: executeStationAction,
        toolCommandsByStationId,
      }
    : null

  const mainWorkbenchCanvasProps = {
    ...workbenchCanvasBaseProps,
    containers: projectedWorkbenchContainers,
    showStage: true,
    floatingVisibility: 'non_topmost' as const,
    scrollToStationId: pendingScrollStationId,
    onScrollToStationHandled: handleCanvasScrollToStationHandled,
    onRunStationAction: executeStationAction,
    toolCommandsByStationId,
  }

  const topmostWorkbenchCanvasProps = hasGlobalTopmostWorkbench
    ? {
        ...workbenchCanvasBaseProps,
        containers: workbenchContainers,
        showStage: false,
        floatingVisibility: 'topmost' as const,
        onRunStationAction: executeStationAction,
        toolCommandsByStationId,
      }
    : null

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

  return (
    <>
    <ShellRootView
      shellContainerRef={shellContainerRef}
      shellTopRef={shellTopRef}
      shellMainRef={shellMainRef}
      shellStatusRef={shellStatusRef}
      shellRailRef={shellRailRef}
      shellLeftPaneRef={shellLeftPaneRef}
      shellResizerRef={shellResizerRef}
      shellMainPaneRef={shellMainPaneRef}
      nativeWindowTopWindows={nativeWindowTopWindows}
      locale={locale}
      topControlBarProps={{
        locale,
        workspacePath: workspacePathInput,
        connectionLabel,
        windowPlatform: windowPerformancePolicy.platform,
        nativeWindowTop,
        nativeWindowTopMacOs,
        nativeWindowTopLinux,
        windowMaximized,
        performanceDebugEnabled: performanceDebugState.enabled,
        onPickWorkspaceDirectory: () => {
          void handlePickWorkspaceDirectory()
        },
        onBatchLaunchAgents: () => {
          void handleBatchLaunchAgents()
        },
        batchLaunchDisabled: isBatchLaunchingAgents || batchLaunchableAgentCount === 0,
        onOpenSettings: handleOpenSettings,
        // onTogglePerformanceDebug: togglePerformanceDebug,
        onWindowMinimize: handleWindowMinimize,
        onWindowToggleMaximize: handleWindowToggleMaximize,
        onWindowClose: handleWindowClose,
        pinnedWorkbenchContainerId,
        dockedContainerOptions,
        onTogglePinnedWorkbenchContainer: togglePinnedWorkbenchContainer,
      }}
      telegramDebugToast={telegramDebugToast}
      onDismissTelegramDebugToast={dismissTelegramDebugToast}
      shellMainStyle={shellMainStyle}
      activityRailProps={{
        items: navItems,
        activeId: activeNavId,
        onSelect: handleSelectNav,
        locale,
      }}
      activeNavId={activeNavId}
      leftPaneVisible={leftPaneVisible}
      leftPaneResizing={false}
      rightPaneResizing={false}
      leftPaneWidth={leftPaneWidth}
      leftPaneWidthMax={leftPaneWidthMax}
      rightPaneWidth={rightPaneWidth}
      rightPaneWidthMax={rightPaneWidthMax}
      onLeftPaneResizePointerDown={handleLeftPaneResizePointerDown}
      onLeftPaneResizeKeyDown={handleLeftPaneResizeKeyDown}
      onRightPaneResizePointerDown={handleRightPaneResizePointerDown}
      onRightPaneResizeKeyDown={handleRightPaneResizeKeyDown}
      fileTreePaneProps={{
        locale,
        workspaceId: activeWorkspaceId,
        selectedFilePath: activeFilePath,
        onSelectFile: handleFileTreeSelectFile,
        onCreateFile: createFileInWorkspace,
        onDeletePath: deletePathInWorkspace,
        onMovePath: movePathInWorkspace,
        onOpenSearch: requestFileSearch,
      }}
      taskCenterPaneProps={taskComposerBaseProps}
      stationOverviewPaneProps={{
        locale,
        stations,
        activeStationId,
        runtimeStateByStationId,
        view: stationOverviewState,
        onViewChange: handleStationOverviewViewChange,
        onSelectStation: handleStationOverviewSelectStation,
        onEditStation: handleStationOverviewEditStation,
        onReorderStations: reorderStations,
      }}
      gitOperationsPaneProps={{
        controller: gitController,
      }}
      communicationChannelsPaneProps={{
        appearanceVersion: `${uiPreferences.themeMode}:${uiPreferences.uiFont}:${uiPreferences.uiFontSize}`,
        locale,
        uiFont: uiPreferences.uiFont,
        agentNameMap: stationNameMap,
        dispatchHistory: taskDispatchHistory,
        retryingTaskId: taskRetryingTaskId,
        externalStatus: externalChannelStatus,
        externalEvents: externalChannelEvents,
        onRetryDispatchTask: handleRetryDispatchTask,
        onRefreshExternalStatus: handleRefreshExternalChannelStatus,
      }}
      activePaneModel={activePaneModel}
      showWorkbenchCanvas={showWorkbenchCanvas}
      workbenchCanvasProps={mainWorkbenchCanvasProps}
      pinnedWorkbenchCanvasProps={pinnedWorkbenchCanvasProps}
      fileEditorPaneProps={{
        locale,
        workspaceId: activeWorkspaceId,
        workspaceRoot: activeWorkspaceRoot,
        openedFiles,
        activeFilePath,
        loading: fileReadLoading,
        errorMessage: fileReadError,
        noticeMessage: filePreviewNotice,
        canRenderContent: fileCanRenderText,
        onSelectFile: selectFile,
        onCloseFile: closeFile,
        onSaveFile: saveFileContent,
        onFileModified: handleFileModified,
        editorCommandRequest: fileEditorCommandRequest,
      }}
      gitHistoryPaneProps={{
        controller: gitController,
        onOpenInEditor: handleGitHistoryOpenInEditor,
      }}
      topmostWorkbenchCanvasProps={topmostWorkbenchCanvasProps}
      statusBarProps={{
        locale,
        gitBranch: gitSummary?.branch ?? '-',
        gitBranches: gitController.branches,
        gitChangedFiles: gitSummary?.files.length ?? 0,
        onCheckoutBranch: gitController.checkoutTo,
        checkoutLoading: gitController.actionLoading === 'checkout',
        agentOnline: 6,
        agentTotal: 8,
        terminalSessions: terminalSessionCount,
      }}
      globalTaskDispatchOverlayProps={{
        ...taskComposerBaseProps,
        open: isTaskQuickDispatchOpen,
        shortcutLabel: formatShortcutBinding(
          shortcutBindings.taskQuickDispatch,
          nativeWindowTopMacOs,
        ),
        opacity: taskQuickDispatchOpacity,
        onClose: closeTaskQuickDispatch,
        onOpacityChange: handleTaskQuickDispatchOpacityChange,
      }}
      settingsModalProps={{
        open: isSettingsOpen,
        locale,
        workspaceId: activeWorkspaceId,
        themeMode: uiPreferences.themeMode,
        uiFont: uiPreferences.uiFont,
        monoFont: uiPreferences.monoFont,
        uiFontSize: uiPreferences.uiFontSize,
        isMacOs: nativeWindowTopMacOs,
        taskQuickDispatchShortcut: shortcutBindings.taskQuickDispatch,
        defaultTaskQuickDispatchShortcut: platformDefaultShortcutBindings.taskQuickDispatch,
        onClose: () => {
          setIsSettingsOpen(false)
        },
        onLocaleChange: (value) => setUiPreferences((prev) => ({ ...prev, locale: value })),
        onThemeModeChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            themeMode: value,
          })),
        onUiFontChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            uiFont: value,
          })),
        onMonoFontChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            monoFont: value,
          })),
        onUiFontSizeChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            uiFontSize: value,
          })),
        onTaskQuickDispatchShortcutChange: handleTaskQuickDispatchShortcutChange,
        onTaskQuickDispatchShortcutReset: handleTaskQuickDispatchShortcutReset,
        onWorkspaceResetSuccess: () => {
          window.location.reload()
        },
        autoCheckAppUpdates: uiPreferences.autoCheckAppUpdates,
        skippedAppUpdateVersion: uiPreferences.skippedAppUpdateVersion,
        onAutoCheckAppUpdatesChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            autoCheckAppUpdates: value,
          })),
        onSkipAppUpdateVersion: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            skippedAppUpdateVersion: value,
          })),
      }}
      stationManageModalProps={{
        open: isStationManageOpen,
        locale,
        workspaceId: activeWorkspaceId,
        roles: agentRoles,
        restorableSystemRoles,
        editingStation,
        saving: stationSavePending,
        deleting: stationDeletePendingId === editingStation?.id,
        deleteCleanupState:
          stationDeleteCleanupTargetId === editingStation?.id ? stationDeleteCleanupState : null,
        deleteCleanupSubmitting: stationDeleteCleanupSubmitting,
        onClose: () => {
          setIsStationManageOpen(false)
          setEditingStation(null)
          setStationDeleteCleanupTargetId(null)
          setStationDeleteCleanupState(null)
        },
        onPickWorkdir: handlePickStationWorkdir,
        onSubmit: (input) => {
          if (editingStation) {
            void updateStation(editingStation.id, input)
          } else {
            void addStation(input)
          }
        },
        onDelete: (stationId) => removeStation(stationId),
        onDeleteCleanupClose: handleStationDeleteCleanupClose,
        onDeleteCleanupStrategyChange: (strategy) =>
          handleStationDeleteCleanupChange({ strategy }),
        onDeleteCleanupReplacementChange: (replacementAgentId) =>
          handleStationDeleteCleanupChange({ replacementAgentId }),
        onDeleteCleanupConfirm: () => {
          void handleStationDeleteCleanupConfirm()
        },
        onRolesChanged: async () => {
          if (activeWorkspaceId) {
            await loadStationsFromDatabase(activeWorkspaceId)
          }
        },
      }}
      channelStudioProps={{
        open: isChannelStudioOpen,
        locale,
        workspaceId: activeWorkspaceId,
        onClose: () => {
          setIsChannelStudioOpen(false)
        },
      }}
      stationSearchModalProps={{
        open: isStationSearchOpen,
        locale,
        query: stationOverviewState.query,
        stations: filteredStations,
        onClose: () => {
          setIsStationSearchOpen(false)
        },
        onQueryChange: (value) => {
          setStationOverviewState((prev) => ({ ...prev, query: value }))
        },
        onSelectStation: handleStationSearchSelectStation,
      }}
      globalFileSearchModalProps={{
        open: isFileSearchModalOpen,
        locale,
        workspaceId: activeWorkspaceId,
        initialMode: fileSearchMode,
        onClose: () => setIsFileSearchModalOpen(false),
        onSelectFile: handleFileTreeSelectFile,
      }}
    />
      <StationActionCommandSheet
        locale={locale}
        station={pendingStationActionSheet?.station ?? null}
        action={pendingStationActionSheet?.action ?? null}
        open={Boolean(pendingStationActionSheet)}
        onClose={() => {
          setPendingStationActionSheet(null)
        }}
        onSubmit={(values) => {
          void handleSubmitStationActionSheet(values)
        }}
      />
    </>
  )
}
