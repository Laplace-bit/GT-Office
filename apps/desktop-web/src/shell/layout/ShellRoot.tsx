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
import {
  formatShortcutBinding,
  areShortcutBindingsEqual,
  defaultShortcutBindings,
  matchesShortcutEvent,
  resolveShortcutBindingsFromSettings,
  shortcutBindingToKeystroke,
  type ShortcutBinding,
} from '@features/keybindings'
import {
  DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  areTaskTargetsEqual,
  buildTaskCenterDraftFilePath,
  buildTaskDispatchCommand,
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
import type { StationTerminalSink, StationTerminalSinkBindingHandler } from '@features/terminal'
import {
  buildStationChannelBotBindingMap,
  resolveConnectorAccounts,
} from '@features/tool-adapter'
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
  stripDetachedTerminalRuntimeProjectionPatch,
  type AgentStation,
  type DetachedTerminalRuntimeProjectionPatch,
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
  type TerminalMetaPayload,
  type TerminalOutputPayload,
  type TerminalStatePayload,
} from '../integration/desktop-api'
import { t } from '../i18n/ui-locale'
import {
  applyUiPreferences,
  loadUiPreferences,
  saveUiPreferences,
} from '../state/ui-preferences'
import { pickDirectory } from '../integration/directory-picker'
import {
  EXTERNAL_CHANNEL_EVENT_HISTORY_LIMIT,
  EXTERNAL_CHANNEL_STATUS_POLL_MS,
  SHELL_LAYOUT_STORAGE_KEY,
  STATION_INPUT_FLUSH_MS,
  STATION_INPUT_MAX_BUFFER_BYTES,
  STATION_TASK_SIGNAL_VISIBLE_MS,
  STATION_TASK_SUBMIT_MAX_RETRY_FRAMES,
  TASK_DISPATCH_HISTORY_LIMIT,
  TASK_DRAFT_PERSIST_DEBOUNCE_MS,
  TELEGRAM_DEBUG_TOAST_VISIBLE_MS,
  WORKSPACE_SESSION_MAX_RESTORE_TABS,
  WORKSPACE_SESSION_MAX_RESTORE_TERMINALS,
  WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS,
  buildDefaultWorkbenchContainerId,
  buildExternalConversationKey,
  buildExternalEndpointKey,
  buildStationLaunchCommand,
  buildWorkbenchContainerTitle,
  clampLeftPaneWidth,
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
  nextStationNumber,
  normalizeExternalChannel,
  normalizeFsPath,
  normalizeStationToolKind,
  normalizeSubmitSequence,
  readNumber,
  readRecord,
  readString,
  readTaskQuickDispatchOpacityFromSettings,
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

import './ShellRoot.scss'

export function ShellRoot() {
  const initialStations = useMemo(() => createDefaultStations(), [])
  const stationCounterRef = useRef(nextStationNumber(initialStations))
  const workbenchContainerCounterRef = useRef(initialStations.length + 1)
  const tauriRuntime = desktopApi.isTauriRuntime()
  const nativeWindowTop = tauriRuntime
  const nativeWindowTopMacOs = tauriRuntime && isMacOsPlatform()
  const nativeWindowTopLinux = tauriRuntime && !nativeWindowTopMacOs && isLinuxPlatform()
  const nativeWindowTopWindows = nativeWindowTop && !nativeWindowTopMacOs && !nativeWindowTopLinux
  const [uiPreferences, setUiPreferences] = useState(loadUiPreferences)
  const [shortcutBindings, setShortcutBindings] = useState(() => defaultShortcutBindings)
  const [taskQuickDispatchOpacity, setTaskQuickDispatchOpacity] = useState(
    DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  )
  const [leftPaneWidth, setLeftPaneWidth] = useState(loadLeftPaneWidthPreference)
  const [leftPaneResizing, setLeftPaneResizing] = useState(false)
  const [leftPaneVisible, setLeftPaneVisible] = useState(true)
  const [activeNavId, setActiveNavId] = useState<NavItemId>('stations')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isTaskQuickDispatchOpen, setIsTaskQuickDispatchOpen] = useState(false)
  const [isChannelStudioOpen, setIsChannelStudioOpen] = useState(false)
  const [isStationManageOpen, setIsStationManageOpen] = useState(false)
  const [editingStation, setEditingStation] = useState<UpdateStationInput | null>(null)
  const [stationDeletePendingId, setStationDeletePendingId] = useState<string | null>(null)
  const [isStationSearchOpen, setIsStationSearchOpen] = useState(false)
  const initialCanvasLayout = useMemo(loadCanvasLayoutPreference, [])
  const [canvasLayoutMode, setCanvasLayoutMode] = useState<WorkbenchLayoutMode>(initialCanvasLayout.mode)
  const [canvasCustomLayout, setCanvasCustomLayout] = useState<WorkbenchCustomLayout>(initialCanvasLayout.customLayout)
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
  const [stationTaskSignals, setStationTaskSignals] = useState<Record<string, StationTaskSignal>>({})
  const [stationTerminals, setStationTerminals] = useState<Record<string, StationTerminalRuntime>>(
    () => createInitialStationTerminals(initialStations),
  )
  const stationTerminalsRef = useRef(stationTerminals)
  const stationsRef = useRef(initialStations)
  const workbenchContainersRef = useRef(workbenchContainers)
  const canvasLayoutModeRef = useRef(canvasLayoutMode)
  const canvasCustomLayoutRef = useRef(canvasCustomLayout)
  const detachedProjectionSeqRef = useRef<Record<string, number>>({})
  const detachedProjectionDispatchQueueRef = useRef<Record<string, Promise<void>>>({})
  const sessionStationRef = useRef<Record<string, string>>({})
  const terminalSessionSeqRef = useRef<Record<string, number>>({})
  const terminalOutputQueueRef = useRef<Record<string, Promise<void>>>({})
  const stationTerminalSinkRef = useRef<Record<string, StationTerminalSink>>({})
  const stationTerminalOutputCacheRef = useRef<Record<string, string>>({})
  const stationTerminalRestoreStateRef = useRef<Record<string, { content: string; cols: number; rows: number }>>({})
  const stationTerminalInputQueueRef = useRef<Record<string, string>>({})
  const stationSubmitSequenceRef = useRef<Record<string, string>>({})
  const stationTerminalInputFlushTimerRef = useRef<Record<string, number | null>>({})
  const stationTerminalInputSendingRef = useRef<Record<string, boolean>>({})
  const terminalSessionVisibilityRef = useRef<Record<string, boolean>>({})
  const leftPaneResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(
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
  const registeredAgentRuntimeRef = useRef<
    Record<string, { workspaceId: string; sessionId: string; toolKind: string; resolvedCwd: string | null }>
  >({})
  const tabSessionSnapshotRef = useRef<Array<{ path: string; active: boolean }>>([])
  const terminalSessionSnapshotRef = useRef<WorkspaceSessionTerminalSnapshot[]>([])
  const workbenchContainerSnapshotRef = useRef<WorkbenchContainerSnapshot[]>([])

  useEffect(() => {
    window.__GTO_OPEN_CHANNEL_STUDIO__ = () => {
      setIsSettingsOpen(false)
      setIsChannelStudioOpen(true)
    }
    return () => {
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
    stationSavePending,
    loadStationsFromDatabase,
    addStation,
    updateStation,
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
    fileSearchRequest,
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
    consumeFileSearchRequest,
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
    stationsRef.current = stations
  }, [stations])

  useEffect(() => {
    workbenchContainersRef.current = workbenchContainers
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
        const runtimeShortcuts = resolveShortcutBindingsFromSettings(response.values)
        setShortcutBindings((prev) =>
          areShortcutBindingsEqual(prev, runtimeShortcuts) ? prev : runtimeShortcuts,
        )
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
  }, [activeWorkspaceId, setStations])

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
        taskQuickDispatch: defaultShortcutBindings.taskQuickDispatch,
      }
      persistShortcutBindings(next)
      return next
    })
  }, [persistShortcutBindings])

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
        canvasLayoutMode,
        canvasCustomLayout,
      }),
    )
  }, [canvasCustomLayout, canvasLayoutMode, leftPaneWidth])

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

    void desktopApi.windowSetDecorations(nativeWindowTopMacOs)
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
  }, [nativeWindowTop, nativeWindowTopMacOs])

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
    const platform = nativeWindowTopMacOs
      ? 'macos'
      : nativeWindowTopLinux
        ? 'linux'
        : nativeWindowTopWindows
          ? 'windows'
          : tauriRuntime
            ? 'unknown'
            : 'web'

    root.setAttribute('data-vb-platform', platform)

    return () => {
      if (root.getAttribute('data-vb-platform') === platform) {
        root.removeAttribute('data-vb-platform')
      }
    }
  }, [nativeWindowTopLinux, nativeWindowTopMacOs, nativeWindowTopWindows, tauriRuntime])

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

  const appendStationTerminalOutput = useMemo(
    () => (stationId: string, chunk: string) => {
      stationTerminalOutputCacheRef.current[stationId] = appendDetachedTerminalOutput(
        stationTerminalOutputCacheRef.current[stationId],
        chunk,
      )
      stationTerminalSinkRef.current[stationId]?.write(chunk)
      publishDetachedOutputAppend(stationId, chunk)
    },
    [publishDetachedOutputAppend],
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
      stationTerminalSinkRef.current[stationId]?.reset(nextContent)
      publishDetachedOutputReset(stationId, nextContent)
    },
    [publishDetachedOutputReset],
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
        if (meta?.restoreState) {
          stationTerminalRestoreStateRef.current[stationId] = {
            content: meta.restoreState,
            cols: meta.restoreCols ?? 0,
            rows: meta.restoreRows ?? 0,
          }
        }
        delete stationTerminalSinkRef.current[stationId]
        return
      }
      stationTerminalSinkRef.current[stationId] = sink
      const station = stationsRef.current.find((item) => item.id === stationId)
      const cachedContent = stationTerminalOutputCacheRef.current[stationId] ?? getStationIdleBanner(station)
      const restoreState = stationTerminalRestoreStateRef.current[stationId]
      if (restoreState) {
        sink.restore(restoreState.content, restoreState.cols, restoreState.rows)
        return
      }
      sink.reset(cachedContent)
    },
    [],
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
    () => (base64Chunk: string): string => {
      try {
        const binary = window.atob(base64Chunk)
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
        return new TextDecoder().decode(bytes)
      } catch {
        return ''
      }
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
              const unread = stationId !== activeStationId
              const seq = terminalSessionSeqRef.current[payload.sessionId] ?? 0
              if (payload.seq <= seq) {
                return
              }
              if (payload.seq === seq + 1) {
                const text = decodeBase64Chunk(payload.chunk)
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
                const text = decodeBase64Chunk(delta.chunk)
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
              resetStationTerminalOutput(stationId, decodeBase64Chunk(snapshot.chunk))
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
          setStationTerminalState(stationId, { stateRaw: payload.to })
          appendStationTerminalOutput(stationId, `\n[terminal:${payload.to}]\n`)
          if (payload.to === 'exited' || payload.to === 'killed' || payload.to === 'failed') {
            delete terminalSessionSeqRef.current[payload.sessionId]
            delete terminalOutputQueueRef.current[payload.sessionId]
          }
        },
        onMeta: (payload: TerminalMetaPayload) => {
          const stationId = sessionStationRef.current[payload.sessionId]
          if (!stationId) {
            return
          }
          const tail = decodeBase64Chunk(payload.tailChunk)
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
          bindExternalTraceTarget(payload.traceId, payload.targetAgentId)
        },
        onExternalDispatchProgress: (payload) => {
          bindExternalTraceTarget(payload.traceId, payload.targetAgentId)
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
    terminalSessionVisibilityRef.current = {}
    stationTerminalRestoreStateRef.current = {}
    stationTerminalOutputCacheRef.current = stationsRef.current.reduce<Record<string, string>>((acc, station) => {
      acc[station.id] = getStationIdleBanner(station)
      return acc
    }, {})
    Object.values(stationTerminalInputFlushTimerRef.current).forEach((timerId) => {
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
    })
    stationTerminalInputFlushTimerRef.current = {}
    stationTerminalInputQueueRef.current = {}
    stationTerminalInputSendingRef.current = {}
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
    Object.entries(stationTerminalInputFlushTimerRef.current).forEach(([stationId, timerId]) => {
      if (stationIdSet.has(stationId)) {
        return
      }
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      delete stationTerminalInputFlushTimerRef.current[stationId]
      delete stationTerminalInputQueueRef.current[stationId]
      delete stationTerminalInputSendingRef.current[stationId]
    })
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
    () => async (stationId: string): Promise<string | null> => {
      const existing = stationTerminalsRef.current[stationId]?.sessionId
      if (existing) {
        return existing
      }

      if (!activeWorkspaceId) {
        appendStationTerminalOutput(stationId, t(locale, 'system.bindWorkspace'))
        return null
      }
      if (!desktopApi.isTauriRuntime()) {
        appendStationTerminalOutput(stationId, t(locale, 'system.webPreviewNoPty'))
        return null
      }

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
        const workspaceRoot = await resolveWorkspaceRoot(activeWorkspaceId)
        if (!workspaceRoot) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.launchFailed', {
              detail: 'WORKSPACE_CONTEXT_UNAVAILABLE',
            }),
          )
          return null
        }

        await desktopApi.fsWriteFile(
          activeWorkspaceId,
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
        const session = await desktopApi.terminalCreate(activeWorkspaceId, {
          cwd: agentWorkspaceCwd,
          cwdMode: 'custom',
          env: terminalEnv,
          agentToolKind: normalizeStationToolKind(station.tool),
        })
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
          })}${t(locale, 'system.stationWorkspaceInfo', {
            roleDir: station.roleWorkdirRel,
            agentDir: station.agentWorkdirRel,
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
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.launchFailed', {
            detail: describeError(error),
          }),
        )
        return null
      }
    },
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
    () => {
      const clearFlushTimer = (stationId: string) => {
        const timerId = stationTerminalInputFlushTimerRef.current[stationId]
        if (typeof timerId === 'number') {
          window.clearTimeout(timerId)
        }
        stationTerminalInputFlushTimerRef.current[stationId] = null
      }

      const flushStationInput = async (stationId: string) => {
        clearFlushTimer(stationId)
        if (stationTerminalInputSendingRef.current[stationId]) {
          return
        }
        const queuedInput = stationTerminalInputQueueRef.current[stationId] ?? ''
        if (!queuedInput) {
          return
        }
        stationTerminalInputQueueRef.current[stationId] = ''
        stationTerminalInputSendingRef.current[stationId] = true

        if (!desktopApi.isTauriRuntime()) {
          appendStationTerminalOutput(stationId, t(locale, 'system.webPreviewNoInput'))
          stationTerminalInputSendingRef.current[stationId] = false
          return
        }

        try {
          let sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
          if (!sessionId) {
            sessionId = await ensureStationTerminalSession(stationId)
            if (!sessionId) {
              stationTerminalInputSendingRef.current[stationId] = false
              return
            }
          }
          await desktopApi.terminalWrite(sessionId, queuedInput)
        } catch (error) {
          appendStationTerminalOutput(
            stationId,
            t(locale, 'system.sendFailed', {
              detail: describeError(error),
            }),
          )
        } finally {
          stationTerminalInputSendingRef.current[stationId] = false
          if (stationTerminalInputQueueRef.current[stationId]) {
            queueMicrotask(() => {
              void flushStationInput(stationId)
            })
          }
        }
      }

      return (stationId: string, input: string) => {
        if (!input) {
          return
        }
        const previous = stationTerminalInputQueueRef.current[stationId] ?? ''
        const merged = `${previous}${input}`
        stationTerminalInputQueueRef.current[stationId] =
          merged.length > STATION_INPUT_MAX_BUFFER_BYTES
            ? merged.slice(merged.length - STATION_INPUT_MAX_BUFFER_BYTES)
            : merged

        clearFlushTimer(stationId)
        if (shouldFlushStationInputImmediately(input)) {
          void flushStationInput(stationId)
          return
        }
        stationTerminalInputFlushTimerRef.current[stationId] = window.setTimeout(() => {
          stationTerminalInputFlushTimerRef.current[stationId] = null
          void flushStationInput(stationId)
        }, STATION_INPUT_FLUSH_MS)
      }
    },
    [appendStationTerminalOutput, ensureStationTerminalSession, locale],
  )

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

  const handleStationTerminalInput = useCallback(
    (stationId: string, data: string) => {
      const submitSequence = normalizeSubmitSequence(data)
      if (submitSequence) {
        stationSubmitSequenceRef.current[stationId] = submitSequence
        const workspaceId = activeWorkspaceIdRef.current
        const sessionId = stationTerminalsRef.current[stationId]?.sessionId
        const station = stationsRef.current.find((entry) => entry.id === stationId)
        const stationRole = station?.role ?? null
        if (workspaceId && sessionId) {
          void desktopApi.agentRuntimeRegister({
            workspaceId,
            agentId: stationId,
            stationId,
            roleKey: stationRole,
            sessionId,
            toolKind: normalizeStationToolKind(station?.tool),
            resolvedCwd: stationTerminalsRef.current[stationId]?.resolvedCwd ?? null,
            submitSequence,
            online: true,
          }).catch(() => {
            // Best-effort runtime update; next periodic sync will retry.
          })
        }
      }
      sendStationTerminalInput(stationId, data)
    },
    [sendStationTerminalInput],
  )

  const writeStationTerminalCommand = useCallback(
    async (stationId: string, command: string) => {
      if (!desktopApi.isTauriRuntime()) {
        appendStationTerminalOutput(stationId, t(locale, 'system.webPreviewNoInput'))
        return false
      }
      let sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      if (!sessionId) {
        sessionId = await ensureStationTerminalSession(stationId)
      }
      if (!sessionId) {
        return false
      }
      await desktopApi.terminalWrite(sessionId, command)
      return true
    },
    [appendStationTerminalOutput, ensureStationTerminalSession, locale],
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
        const state = stationTerminalRestoreStateRef.current[stationId]
        if (state) {
          acc[stationId] = state
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
          void ensureStationTerminalSession(message.stationId)
          return
        }
        case 'detached_terminal_write_input': {
          const container = resolveDetachedBridgeContainer(sourceWindowLabel, message.containerId, message.stationId)
          if (!container) {
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
          stationTerminalRestoreStateRef.current[message.stationId] = message.state
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
      queueDetachedProjectionMessage,
      resizeStationTerminal,
      resolveDetachedBridgeContainer,
    ],
  )

  const reportRenderedScreenSnapshot = useMemo(
    () => (stationId: string, snapshot: RenderedScreenSnapshot) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }
      const sessionId = stationTerminalsRef.current[stationId]?.sessionId ?? null
      if (!sessionId || snapshot.sessionId !== sessionId) {
        return
      }
      void desktopApi.terminalReportRenderedScreen(snapshot).catch(() => {
        // Snapshot reporting is best-effort and must not affect terminal interaction.
      })
    },
    [],
  )

  const launchStationCliAgent = useMemo(
    () => async (stationId: string) => {
      const sessionId = await ensureStationTerminalSession(stationId)
      if (!sessionId) {
        return
      }
      const station = stationsRef.current.find((entry) => entry.id === stationId)
      const launchCommand = station ? buildStationLaunchCommand(station) : null
      if (!launchCommand) {
        stationTerminalSinkRef.current[stationId]?.focus()
        return
      }
      sendStationTerminalInput(stationId, launchCommand)
      stationTerminalSinkRef.current[stationId]?.focus()
    },
    [ensureStationTerminalSession, sendStationTerminalInput],
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
      await desktopApi.agentRuntimeRegister({
        workspaceId: input.workspaceId,
        agentId: station.id,
        stationId: station.id,
        roleKey: station.role,
        sessionId,
        toolKind: normalizeStationToolKind(station.tool),
        resolvedCwd: stationTerminalsRef.current[station.id]?.resolvedCwd ?? null,
        submitSequence: stationSubmitSequenceRef.current[station.id] ?? null,
        online: true,
      })
    },
    [ensureStationTerminalSession],
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

  const verifyTaskFileReadable = useCallback(
    async (input: { workspaceId: string; taskFilePath: string }) => {
      await desktopApi.fsReadFile(input.workspaceId, input.taskFilePath)
    },
    [],
  )

  const deliverTaskToStation = useCallback(
    async (input: {
      station: AgentStation
      taskId: string
      taskFilePath: string
      title: string
    }) => {
      const { station, taskId, taskFilePath, title } = input
      const sessionId = await ensureStationTerminalSession(station.id)
      if (!sessionId) {
        throw new Error('TARGET_AGENT_SESSION_UNAVAILABLE')
      }
      appendStationTerminalOutput(
        station.id,
        t(locale, 'system.taskDispatched', {
          taskId,
          path: taskFilePath,
        }),
      )
      const accepted = await writeStationTerminalCommand(
        station.id,
        buildTaskDispatchCommand(taskId, taskFilePath),
      )
      if (!accepted) {
        throw new Error('TARGET_AGENT_SESSION_UNAVAILABLE')
      }
      const submitted = await submitStationTerminal(station.id)
      if (!submitted) {
        throw new Error('XTERM_SUBMIT_FAILED')
      }
      emitStationTaskSignal({
        stationId: station.id,
        taskId,
        title,
        receivedAtMs: Date.now(),
      })
    },
    [
      appendStationTerminalOutput,
      emitStationTaskSignal,
      ensureStationTerminalSession,
      locale,
      submitStationTerminal,
      writeStationTerminalCommand,
    ],
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
    onVerifyTaskFileReadable: verifyTaskFileReadable,
    onDeliverTaskToStation: deliverTaskToStation,
    setStationTaskSignals,
    describeError,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
  })

  const removeStation = useMemo(
    () => async (stationId: string) => {
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
            return
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
        // Defensive branch: runtime has stale session id but mapping lookup missed it.
        appendStationTerminalOutput(
          stationId,
          t(locale, 'system.killFailed', {
            detail: runtime.sessionId,
          }),
        )
        return
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
      const flushTimerId = stationTerminalInputFlushTimerRef.current[stationId]
      if (typeof flushTimerId === 'number') {
        window.clearTimeout(flushTimerId)
      }
      delete stationTerminalInputFlushTimerRef.current[stationId]
      delete stationTerminalInputQueueRef.current[stationId]
      delete stationTerminalInputSendingRef.current[stationId]
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
      const workspaceId = activeWorkspaceIdRef.current
      if (workspaceId && desktopApi.isTauriRuntime()) {
        setStationDeletePendingId(stationId)
        try {
          await desktopApi.agentDelete({
            workspaceId,
            agentId: stationId,
          })
          await loadStationsFromDatabase(workspaceId)
        } finally {
          setStationDeletePendingId(null)
        }
      }
      if (workspaceId && desktopApi.isTauriRuntime()) {
        void desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {
          // Runtime sync effect will retry if this one fails.
        })
      }
      setIsStationManageOpen(false)
      setEditingStation(null)
    },
    [
      appendStationTerminalOutput,
      clearStationTaskSignalTimer,
      loadStationsFromDatabase,
      locale,
      setStations,
      setStationTerminalState,
    ],
  )

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
    setCanvasLayoutMode,
    canvasCustomLayout,
    setCanvasCustomLayout,
    setActiveStationId,
    launchStationTerminal,
    launchStationCliAgent,
    removeStation,
  })

  const terminalSessionCount = useMemo(
    () => Object.values(stationTerminals).filter((runtime) => runtime.sessionId).length,
    [stationTerminals],
  )

  const handleCanvasOpenStationManage = useCallback(() => {
    setEditingStation(null)
    setIsStationManageOpen(true)
  }, [])

  const handleCanvasOpenStationSearch = useCallback(() => {
    setIsStationSearchOpen(true)
  }, [])

  const handleCanvasScrollToStationHandled = useCallback((stationId: string) => {
    setPendingScrollStationId((prev) => (prev === stationId ? null : prev))
  }, [])

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

        const tabsToRestore = restored.tabs.slice(0, WORKSPACE_SESSION_MAX_RESTORE_TABS)
        const activeTabPath = tabsToRestore.find((tab) => tab.active)?.path ?? tabsToRestore[0]?.path ?? null
        setOpenedFiles(
          tabsToRestore.map((tab) => ({
            path: tab.path,
            content: '',
            size: 0,
            isModified: false,
            hydrated: false,
          })),
        )
        setActiveFilePath(activeTabPath)
        if (activeTabPath) {
          await loadFileContentRef.current(activeTabPath, 'full')
        }

        const stationIdSet = new Set(stationsRef.current.map((station) => station.id))
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
          const restoreCwdMode =
            terminal.cwdMode === 'custom' && terminal.resolvedCwd ? 'custom' : 'workspace_root'
          const restoreCwd = restoreCwdMode === 'custom' ? terminal.resolvedCwd : null

          try {
            const station = stationsRef.current.find((item) => item.id === terminal.stationId)
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
            })
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
        windows: [{ activeNavId }],
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

  const triggerFileSearch = useCallback((mode: 'file' | 'content') => {
    setActiveNavId('files')
    setLeftPaneVisible(true)
    requestFileSearch(mode)
  }, [requestFileSearch])

  const triggerFileEditorCommand = useCallback(
    (type: 'find' | 'replace' | 'findNext' | 'findPrevious') => {
      requestFileEditorCommand(type)
    },
    [requestFileEditorCommand],
  )

  const closeTaskQuickDispatch = useCallback(() => {
    setIsTaskQuickDispatchOpen(false)
  }, [])

  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent) => {
      if (document.body.dataset.gtoShortcutRecording === 'true') {
        return
      }
      const editableTarget = isEditableKeyboardTarget(event.target)
      const codeEditorTarget = isCodeEditorKeyboardTarget(event.target)

      if (matchesShortcutEvent(event, shortcutBindings.taskQuickDispatch, nativeWindowTopMacOs)) {
        event.preventDefault()
        event.stopPropagation()
        setIsTaskQuickDispatchOpen((prev) => !prev)
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.openContentSearch, nativeWindowTopMacOs)) {
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearch('content')
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.editorFind, nativeWindowTopMacOs)) {
        if (codeEditorTarget) {
          return
        }
        if (editableTarget) {
          return
        }
        if (activeNavId === 'files' && activeFilePath) {
          event.preventDefault()
          event.stopPropagation()
          triggerFileEditorCommand('find')
          return
        }
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.editorReplace, nativeWindowTopMacOs)) {
        if (codeEditorTarget) {
          return
        }
        if (editableTarget) {
          return
        }
        if (activeNavId === 'files' && activeFilePath) {
          event.preventDefault()
          event.stopPropagation()
          triggerFileEditorCommand('replace')
        }
        return
      }

      if (matchesShortcutEvent(event, shortcutBindings.openFileSearch, nativeWindowTopMacOs)) {
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearch('file')
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
  }, [
    activeFilePath,
    activeNavId,
    nativeWindowTopMacOs,
    shortcutBindings,
    triggerFileEditorCommand,
    triggerFileSearch,
  ])

  const handleLeftPaneResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const pointerId = event.pointerId
      leftPaneResizeRef.current = {
        pointerId,
        startX: event.clientX,
        startWidth: leftPaneWidth,
      }
      setLeftPaneResizing(true)

      const dragHandle = event.currentTarget
      dragHandle.setPointerCapture(pointerId)

      const previousBodyCursor = document.body.style.cursor
      const previousBodyUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const finishResize = (releasedPointerId: number) => {
        if (leftPaneResizeRef.current?.pointerId !== releasedPointerId) {
          return
        }
        leftPaneResizeRef.current = null
        setLeftPaneResizing(false)
        document.body.style.cursor = previousBodyCursor
        document.body.style.userSelect = previousBodyUserSelect
        if (dragHandle.hasPointerCapture(releasedPointerId)) {
          dragHandle.releasePointerCapture(releasedPointerId)
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (leftPaneResizeRef.current?.pointerId !== moveEvent.pointerId) {
          return
        }
        const delta = moveEvent.clientX - leftPaneResizeRef.current.startX
        setLeftPaneWidth(clampLeftPaneWidth(leftPaneResizeRef.current.startWidth + delta))
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
    [leftPaneWidth],
  )

  const handleLeftPaneResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev - step))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev + step))
    }
  }, [])

  const shellMainStyle = useMemo(
    () =>
      ({
        '--shell-left-pane-width': `${leftPaneWidth}px`,
      }) as CSSProperties,
    [leftPaneWidth],
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

  const handleFileTreeSearchRequestConsumed = useCallback((nonce: number) => {
    consumeFileSearchRequest(nonce)
  }, [consumeFileSearchRequest])

  const handleFileTreeSelectFile = useCallback(
    (filePath: string) => {
      void loadFileContent(filePath, 'full')
    },
    [loadFileContent],
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

  const showWorkbenchCanvas = activeNavId !== 'files' && activeNavId !== 'git'
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
    showFloatingPortal: true as const,
    stations,
    containers: workbenchContainers,
    activeStationId,
    terminalByStation: stationTerminals,
    taskSignalByStationId: stationTaskSignals,
    channelBotBindingsByStationId,
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

  return (
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
        nativeWindowTop,
        nativeWindowTopMacOs,
        nativeWindowTopLinux,
        windowMaximized,
        onPickWorkspaceDirectory: () => {
          void handlePickWorkspaceDirectory()
        },
        onOpenSettings: handleOpenSettings,
        onWindowMinimize: handleWindowMinimize,
        onWindowToggleMaximize: handleWindowToggleMaximize,
        onWindowClose: handleWindowClose,
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
      leftPaneResizing={leftPaneResizing}
      leftPaneWidth={leftPaneWidth}
      onLeftPaneResizePointerDown={handleLeftPaneResizePointerDown}
      onLeftPaneResizeKeyDown={handleLeftPaneResizeKeyDown}
      fileTreePaneProps={{
        locale,
        workspaceId: activeWorkspaceId,
        selectedFilePath: activeFilePath,
        searchRequest: fileSearchRequest,
        onSearchRequestConsumed: handleFileTreeSearchRequestConsumed,
        onSelectFile: handleFileTreeSelectFile,
        onCreateFile: createFileInWorkspace,
        onDeletePath: deletePathInWorkspace,
        onMovePath: movePathInWorkspace,
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
      }}
      gitOperationsPaneProps={{
        controller: gitController,
      }}
      communicationChannelsPaneProps={{
        locale,
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
      workbenchCanvasProps={{
        ...workbenchCanvasBaseProps,
        showStage: true,
        floatingVisibility: 'non_topmost',
        scrollToStationId: pendingScrollStationId,
        onScrollToStationHandled: handleCanvasScrollToStationHandled,
      }}
      fileEditorPaneProps={{
        locale,
        workspaceId: activeWorkspaceId,
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
      topmostWorkbenchCanvasProps={
        hasGlobalTopmostWorkbench
          ? {
              ...workbenchCanvasBaseProps,
              showStage: false,
              floatingVisibility: 'topmost',
            }
          : null
      }
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
        defaultTaskQuickDispatchShortcut: defaultShortcutBindings.taskQuickDispatch,
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
      }}
      stationManageModalProps={{
        open: isStationManageOpen,
        locale,
        roles: agentRoles,
        editingStation,
        saving: stationSavePending,
        deleting: stationDeletePendingId === editingStation?.id,
        onClose: () => {
          setIsStationManageOpen(false)
          setEditingStation(null)
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
    />
  )
}
