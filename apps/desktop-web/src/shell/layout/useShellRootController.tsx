import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import {
  useGitWorkspaceController,
} from '@features/git'
import {
  formatShortcutBinding,
  getDefaultShortcutBindings,
  type ShortcutBindings,
} from '@features/keybindings'
import {
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
} from '@features/task-center'
import {
  createDefaultFloatingFrame,
  createDefaultStations,
  createInitialWorkbenchContainers,
  normalizeWorkbenchContainerFrame,
  StationActionCommandSheet,
  type AgentStation,
  type UpdateStationInput,
  type WorkbenchContainerModel,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from '@features/workspace-hub'
import {
  defaultStationOverviewState,
  filterStationsForOverview,
} from '@features/workspace'
import {
  getNavItems,
  getPaneModels,
} from './navigation-model'
import {
  desktopApi,
  type ToolCommandSummary,
} from '../integration/desktop-api'
import { t } from '../i18n/ui-locale'
import {
  loadPerformanceDebugState,
} from '../state/performance-debug'
import {
  SHELL_LAYOUT_STORAGE_KEY,
  buildDefaultWorkbenchContainerId,
  buildWorkbenchContainerTitle,
  createStationEditInput,
  isCodeEditorKeyboardTarget,
  isEditableKeyboardTarget,
  isLinuxPlatform,
  isMacOsPlatform,
  loadCanvasLayoutPreference,
  nextStationNumber,
  normalizeFsPath,
} from './ShellRoot.shared'
import { useShellExternalChannelController } from './useShellExternalChannelController'
import { useShellTaskDispatchController } from './useShellTaskDispatchController'
import { useShellFileController } from './useShellFileController'
import { useShellNavRoute } from './useShellNavRoute'
import { useShellStationController } from './useShellStationController'
import { useShellTaskMentionController } from './useShellTaskMentionController'
import { useShellWorkbenchController } from './useShellWorkbenchController'
import { useShellTerminalController } from './useShellTerminalController'
import { useWorkspaceTabController } from '../state/useWorkspaceTabController'
import type { WorkspaceTearOffRequest } from './WorkspaceTabBar'
import { resolveWindowPerformancePolicy } from './window-performance-policy'
import { useShellPaneLayoutController } from './useShellPaneLayoutController'
import { useShellShortcutController } from './useShellShortcutController'
import { useShellWindowController } from './useShellWindowController'
import { useShellWorkspaceSessionController } from './useShellWorkspaceSessionController'
import { ShellRootView } from './ShellRootView'
import { WorkspaceCloseDialog } from './WorkspaceCloseDialog'
import { pickDirectory } from '../integration/directory-picker'

interface ShellRootProps {
  workspaceWindowId?: string
}

export function useShellRootController({ workspaceWindowId }: ShellRootProps = {}) {
  const isSingleWorkspaceMode = !!workspaceWindowId
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
  const shellTopRef = useRef<HTMLDivElement | null>(null)
  const {
    windowMaximized,
    handleWindowMinimize,
    handleWindowToggleMaximize,
    handleWindowClose,
  } = useShellWindowController({
    nativeWindowTop,
    nativeWindowTopWindows,
    windowPerformancePolicy,
    shellTopRef,
  })
  const platformDefaultShortcutBindings = useMemo(
    () => getDefaultShortcutBindings(nativeWindowTopMacOs),
    [nativeWindowTopMacOs],
  )
  const [activeNavId, setActiveNavId] = useShellNavRoute('stations')
  const [pinnedWorkbenchContainerId, setPinnedWorkbenchContainerId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isChannelStudioOpen, setIsChannelStudioOpen] = useState(false)
  const [isStationManageOpen, setIsStationManageOpen] = useState(false)
  const [editingStation, setEditingStation] = useState<UpdateStationInput | null>(null)
  const [isStationSearchOpen, setIsStationSearchOpen] = useState(false)
  const initialCanvasLayout = useMemo(loadCanvasLayoutPreference, [])
  const [canvasLayoutMode] = useState<WorkbenchLayoutMode>(initialCanvasLayout.mode)
  const [canvasCustomLayout] = useState<WorkbenchCustomLayout>(initialCanvasLayout.customLayout)
  const [pendingScrollStationId, setPendingScrollStationId] = useState<string | null>(null)
  const [stationOverviewState, setStationOverviewState] = useState(defaultStationOverviewState)
  const [activeStationId, setActiveStationId] = useState(initialStations[0]?.id ?? '')
  const [workbenchContainers, setWorkbenchContainers] = useState<WorkbenchContainerModel[]>(() =>
    createInitialWorkbenchContainers(initialStations, buildDefaultWorkbenchContainerId, initialCanvasLayout),
  )
  const stationsRef = useRef(initialStations)
  const workbenchContainersRef = useRef(workbenchContainers)
  const canvasLayoutModeRef = useRef(canvasLayoutMode)
  const canvasCustomLayoutRef = useRef(canvasCustomLayout)
  const detachedWindowOpenInFlightRef = useRef<Record<string, boolean>>({})
  const shellContainerRef = useRef<HTMLDivElement | null>(null)
  const shellMainRef = useRef<HTMLElement | null>(null)
  const shellStatusRef = useRef<HTMLDivElement | null>(null)
  const shellRailRef = useRef<HTMLDivElement | null>(null)
  const shellLeftPaneRef = useRef<HTMLDivElement | null>(null)
  const shellResizerRef = useRef<HTMLDivElement | null>(null)
  const shellMainPaneRef = useRef<HTMLDivElement | null>(null)
  const {
    leftPaneWidth,
    rightPaneWidth,
    shellMainContentMinWidth,
    leftPaneWidthMax,
    rightPaneWidthMax,
    leftPaneVisible,
    setLeftPaneVisible,
    shellMainStyle,
    handleSelectNav,
    handleLeftPaneResizePointerDown,
    handleLeftPaneResizeKeyDown,
    handleRightPaneResizePointerDown,
    handleRightPaneResizeKeyDown,
    updatePaneWidthBounds,
  } = useShellPaneLayoutController({
    shellMainRef,
    shellRailRef,
    shellLeftPaneRef,
    shellResizerRef,
    shellContainerRef,
    activeNavId,
    setActiveNavId,
  })
  const activeWorkspaceIdRef = useRef<string | null>(null)
  const pendingSearchRequestFrameRef = useRef<number | null>(null)
  const pendingFileEditorCommandFrameRef = useRef<number | null>(null)
  const triggerFileSearchRef = useRef<(mode?: 'file' | 'content') => void>(() => {})
  const requestCloseWorkspaceRef = useRef<(workspaceId: string) => void>(() => {})
  const triggerFileEditorCommandRef = useRef<
    (type: 'find' | 'replace' | 'findNext' | 'findPrevious') => void
  >(() => {})
  const shouldRouteFileEditorShortcutRef = useRef<(target: EventTarget | null) => boolean>(
    () => false,
  )

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

  const {
    workspacePathInput,
    activeWorkspaceId,
    activeWorkspaceRoot,
    setActiveWorkspaceRoot,
    connectionState,
    gitSummary,
    refreshGit,
    workspaceTabs,
    workspaceSwitching,
    pendingWorkspaceSwitchId,
    closingTabId,
    openWorkspaceAtPath,
    switchWorkspaceTab,
    beginWorkspaceSwitchAnimation,
    completeWorkspaceSwitch,
    closeWorkspaceTab,
    detachWorkspaceTab,
    reorderWorkspaceTab,
  } = useWorkspaceTabController(workspaceWindowId)

  const {
    uiPreferences,
    setUiPreferences,
    shortcutBindings,
    taskQuickDispatchOpacity,
    isTaskQuickDispatchOpen,
    closeTaskQuickDispatch,
    handleTaskQuickDispatchShortcutChange,
    handleTaskQuickDispatchShortcutReset,
    handleTaskQuickDispatchOpacityChange,
  } = useShellShortcutController({
    nativeWindowTopMacOs,
    tauriRuntime,
    platformDefaultShortcutBindings,
    activeWorkspaceId,
    triggerFileSearchRef,
    requestCloseWorkspaceRef,
    triggerFileEditorCommandRef,
    shouldRouteFileEditorShortcutRef,
    activeWorkspaceIdRef,
  })

  const localeRef = useRef(uiPreferences.locale)
  const locale = uiPreferences.locale

  const externalChannelController = useShellExternalChannelController({
    activeWorkspaceId,
    tauriRuntime,
    stationsRef,
    activeNavId,
    isChannelStudioOpen,
  })

  const {
    stations,
    setStations,
    stationsLoadedWorkspaceId,
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
    setActiveStationId,
    setIsStationManageOpen,
    setEditingStation,
  })

  const terminalController = useShellTerminalController({
    activeWorkspaceId,
    activeWorkspaceIdRef,
    activeStationId,
    locale,
    tauriRuntime,
    initialStations,
    stations,
    stationsRef,
    activeWorkspaceRoot,
    setActiveStationId,
    setStations,
    setIsStationManageOpen,
    setEditingStation,
    workbenchContainersRef,
    windowPerformancePolicy,
    detachedWindowOpenInFlightRef,
    externalChannelController,
    performanceDebugState,
  })

  const {
    stationTerminals,
    setStationTerminals,
    stationProcessSnapshots,
    toolCommandsByStationId,
    isBatchLaunchingAgents,
    pendingStationActionSheet,
    stationTerminalsRef,
    stationTerminalOutputCacheRef,
    stationSubmitSequenceRef,
    stationDeletePendingId,
    stationDeleteCleanupTargetId,
    stationDeleteCleanupState,
    stationDeleteCleanupSubmitting,
    handleStationDeleteCleanupChange,
    handleStationDeleteCleanupClose,
    handleStationDeleteCleanupConfirm,
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
    removeStation,
    cleanupRemovedStationRuntimeState,
    launchStationCliAgent,
    handleBatchLaunchAgents,
    loadToolCommandsForStations,
    executeStationAction,
    handleSubmitStationActionSheet,
    captureActiveWorkspaceTerminalDocument,
    resolveWorkspaceTerminalDocument,
    persistActiveWorkspaceTerminalDocument,
    findDetachedProjectionTargetsByStationId,
    publishDetachedRuntimePatch,
    publishDetachedOutputAppend,
    publishDetachedOutputReset,
    handleDetachedSurfaceBridgeMessage,
    reportRenderedScreenSnapshot,
    updateStationProcessSnapshot,
    inspectStationSessionProcesses,
    setIsBatchLaunchingAgents,
    setPendingStationActionSheet,
    terminalSessionCount,
    stationAgentRunningById,
    batchLaunchableAgentCount,
    toolCommandReloadKey,
    runtimeStateByStationId,
    resetTerminalStateOnWorkspaceSwitch,
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
    resolveWorkspaceRoot,
  } = terminalController
  const deleteCleanupSubmitting = stationDeleteCleanupSubmitting
  const taskDispatchController = useShellTaskDispatchController({
    initialStations,
    activeWorkspaceId,
    activeStationId,
    locale,
    stationsRef,
    stationTerminalsRef,
    activeWorkspaceIdRef,
    stationSubmitSequenceRef,
    tauriRuntime,
    ensureStationTerminalSession,
    submitStationTerminal,
    reconcileStationRuntimeRegistration,
  })
  const {
    taskDraft,
    taskDispatchHistory,
    taskSending,
    taskRetryingTaskId,
    taskDraftSavedAtMs,
    taskNotice,
    updateTaskDraft,
    insertTaskSnippet,
    handleTaskSend,
    handleRetryDispatchTask,
  } = taskDispatchController
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

  const workspaceSessionController = useShellWorkspaceSessionController({
    workspacePathInput,
    activeWorkspaceId,
    activeWorkspaceIdRef,
    activeWorkspaceRoot,
    setActiveWorkspaceRoot,
    workspaceTabs,
    beginWorkspaceSwitchAnimation,
    completeWorkspaceSwitch,
    closeWorkspaceTab,
    detachWorkspaceTab,
    openWorkspaceAtPath,
    terminalController,
    loadFileContentRef,
    setOpenedFiles,
    setActiveFilePath,
    resetFileState,
    tabSessionSnapshotEntries,
    tabSessionSnapshotSignature,
    stations,
    stationsRef,
    stationsLoadedWorkspaceId,
    setStations,
    workbenchContainers,
    setWorkbenchContainers,
    workbenchContainersRef,
    workbenchContainerCounterRef,
    workbenchContainerSnapshotEntries,
    workbenchContainerSnapshotSignature,
    canvasLayoutMode,
    canvasCustomLayout,
    canvasLayoutModeRef,
    canvasCustomLayoutRef,
    activeNavId,
    setActiveNavId,
    activeStationId,
    setActiveStationId,
    pinnedWorkbenchContainerId,
    setPinnedWorkbenchContainerId,
    externalChannelController,
    taskDispatchController,
    tauriRuntime,
    initialStations,
    detachedWindowOpenInFlightRef,
    locale,
    uiPreferences,
  })

  const {
    closeConfirmState,
    closeSubmitting,
    requestCloseWorkspace,
    confirmCloseWorkspace,
    dismissCloseConfirm,
    handleTearOffWorkspaceTab,
    handlePickWorkspaceDirectory,
  } = workspaceSessionController

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

  useEffect(() => {
    stationsRef.current = stations
  }, [stations])

  useEffect(() => {
    workbenchContainersRef.current = workbenchContainers
  }, [workbenchContainers])

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

  const filteredStations = useMemo(
    () => filterStationsForOverview(stations, runtimeStateByStationId, stationOverviewState),
    [runtimeStateByStationId, stationOverviewState, stations],
  )

  const channelBotBindingsByStationId = useMemo(
    () => externalChannelController.channelBotBindingsByStationId(stations),
    [externalChannelController.channelBotBindingsByStationId, stations],
  )

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
      const relative = normalizeFsPath(selected).replace(workspaceRoot + '/', '').replace(workspaceRoot + '\\', '') || '.'
      if (relative === '.' || relative === selected) {
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

  const gitController = useGitWorkspaceController({
    locale,
    workspaceId: activeWorkspaceId,
    summary: gitSummary,
    onRefreshSummary: refreshGit,
  })

  const togglePinnedWorkbenchContainer = useCallback(
    (containerId: string) => {
      setPinnedWorkbenchContainerId((prev) => (prev === containerId ? null : containerId))
    },
    [],
  )

  // Detached surface event subscription
  useEffect(() => {
    if (!tauriRuntime) {
      return
    }

    let disposed = false
    let cleanup = () => {}

    void desktopApi
      .subscribeSurfaceEvents({
        onWindowClosed: (payload) => {
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
          if (payload.targetWindowLabel !== 'main') {
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

  // Detached window open effect
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
        .map((stationId) => {
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
        .filter((station): station is NonNullable<typeof station> => station !== null)

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
    triggerFileSearchRef.current = triggerFileSearch
  }, [triggerFileSearch])

  useEffect(() => {
    requestCloseWorkspaceRef.current = requestCloseWorkspace
  }, [requestCloseWorkspace])

  useEffect(() => {
    triggerFileEditorCommandRef.current = triggerFileEditorCommand
  }, [triggerFileEditorCommand])

  const shouldRouteFileEditorShortcut = useCallback((target: EventTarget | null) => {
    if (isEditableKeyboardTarget(target) && !isCodeEditorKeyboardTarget(target)) {
      return false
    }
    return activeNavId === 'files' && Boolean(activeFilePath)
  }, [activeFilePath, activeNavId])

  useEffect(() => {
    shouldRouteFileEditorShortcutRef.current = shouldRouteFileEditorShortcut
  }, [shouldRouteFileEditorShortcut])

  const dismissTelegramDebugToast = externalChannelController.dismissTelegramDebugToast

  const handleOpenSettings = useCallback(() => {
    setIsChannelStudioOpen(false)
    setIsSettingsOpen(true)
  }, [])

  const handleRefreshExternalChannelStatus = externalChannelController.handleRefreshExternalChannelStatus

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
  useEffect(() => {
    updatePaneWidthBounds()
  }, [updatePaneWidthBounds, leftPaneWidth, rightPaneWidth, leftPaneVisible, showPinnedWorkbenchPane])

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
    taskSignalByStationId: externalChannelController.stationTaskSignals,
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

  const shellRootViewProps: ComponentProps<typeof ShellRootView> = {
    shellContainerRef,
    shellTopRef,
    shellMainRef,
    shellStatusRef,
    shellRailRef,
    shellLeftPaneRef,
    shellResizerRef,
    shellMainPaneRef,
    nativeWindowTopWindows,
    locale,
    topControlBarProps: {
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
        ...(isSingleWorkspaceMode
          ? {}
          : {
              workspaceTabs,
              activeTabId: activeWorkspaceId,
              closingTabId,
              workspaceSwitching,
              pendingWorkspaceSwitchId,
              workspaceSwitchAnimation: uiPreferences.workspaceSwitchAnimation,
              onSwitchTab: (workspaceId: string) => {
                void switchWorkspaceTab(workspaceId)
              },
              onCloseTab: (workspaceId: string) => {
                requestCloseWorkspace(workspaceId)
              },
              onAddTab: () => {
                void handlePickWorkspaceDirectory()
              },
              onReorderTabs: reorderWorkspaceTab,
              onTearOffTab: (request: WorkspaceTearOffRequest) => {
                void handleTearOffWorkspaceTab(request)
              },
            }),
        onBatchLaunchAgents: () => {
          void handleBatchLaunchAgents()
        },
        batchLaunchDisabled: isBatchLaunchingAgents || batchLaunchableAgentCount === 0,
        onOpenSettings: handleOpenSettings,
        onWindowMinimize: handleWindowMinimize,
        onWindowToggleMaximize: handleWindowToggleMaximize,
        onWindowClose: handleWindowClose,
        pinnedWorkbenchContainerId,
        dockedContainerOptions,
        onTogglePinnedWorkbenchContainer: togglePinnedWorkbenchContainer,
      },
    telegramDebugToast: externalChannelController.telegramDebugToast,
    onDismissTelegramDebugToast: dismissTelegramDebugToast,
    shellMainStyle,
    activityRailProps: {
        items: navItems,
        activeId: activeNavId,
        onSelect: handleSelectNav,
        locale,
      },
    activeNavId,
    leftPaneVisible,
    leftPaneResizing: false,
    rightPaneResizing: false,
    leftPaneWidth,
    leftPaneWidthMax,
    rightPaneWidth,
    rightPaneWidthMax,
    onLeftPaneResizePointerDown: handleLeftPaneResizePointerDown,
    onLeftPaneResizeKeyDown: handleLeftPaneResizeKeyDown,
    onRightPaneResizePointerDown: handleRightPaneResizePointerDown,
    onRightPaneResizeKeyDown: handleRightPaneResizeKeyDown,
    fileTreePaneProps: {
        locale,
        workspaceId: activeWorkspaceId,
        selectedFilePath: activeFilePath,
        onSelectFile: handleFileTreeSelectFile,
        onCreateFile: createFileInWorkspace,
        onDeletePath: deletePathInWorkspace,
        onMovePath: movePathInWorkspace,
        onOpenSearch: requestFileSearch,
      },
    taskCenterPaneProps: taskComposerBaseProps,
    stationOverviewPaneProps: {
        locale,
        stations,
        activeStationId,
        runtimeStateByStationId,
        view: stationOverviewState,
        onViewChange: handleStationOverviewViewChange,
        onSelectStation: handleStationOverviewSelectStation,
        onEditStation: handleStationOverviewEditStation,
        onReorderStations: reorderStations,
      },
    gitOperationsPaneProps: {
        controller: gitController,
      },
    communicationChannelsPaneProps: {
        appearanceVersion: `${uiPreferences.themeMode}:${uiPreferences.uiFont}:${uiPreferences.uiFontSize}`,
        locale,
        uiFont: uiPreferences.uiFont,
        agentNameMap: stationNameMap,
        dispatchHistory: taskDispatchHistory,
        retryingTaskId: taskRetryingTaskId,
        externalStatus: externalChannelController.externalChannelStatus,
        externalEvents: externalChannelController.externalChannelEvents,
        onRetryDispatchTask: handleRetryDispatchTask,
        onRefreshExternalStatus: handleRefreshExternalChannelStatus,
      },
    activePaneModel,
    showWorkbenchCanvas,
    workbenchCanvasProps: mainWorkbenchCanvasProps,
    pinnedWorkbenchCanvasProps,
    fileEditorPaneProps: {
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
      },
    gitHistoryPaneProps: {
        controller: gitController,
        onOpenInEditor: handleGitHistoryOpenInEditor,
      },
    topmostWorkbenchCanvasProps,
    statusBarProps: {
        locale,
        gitBranch: gitSummary?.branch ?? '-',
        gitBranches: gitController.branches,
        gitChangedFiles: gitSummary?.files.length ?? 0,
        onCheckoutBranch: gitController.checkoutTo,
        checkoutLoading: gitController.actionLoading === 'checkout',
        agentOnline: 6,
        agentTotal: 8,
        terminalSessions: terminalSessionCount,
      },
    globalTaskDispatchOverlayProps: {
        ...taskComposerBaseProps,
        open: isTaskQuickDispatchOpen,
        shortcutLabel: formatShortcutBinding(
          shortcutBindings.taskQuickDispatch,
          nativeWindowTopMacOs,
        ),
        opacity: taskQuickDispatchOpacity,
        onClose: closeTaskQuickDispatch,
        onOpacityChange: handleTaskQuickDispatchOpacityChange,
      },
    settingsModalProps: {
        open: isSettingsOpen,
        locale,
        workspaceId: activeWorkspaceId,
        themeMode: uiPreferences.themeMode,
        uiFont: uiPreferences.uiFont,
        monoFont: uiPreferences.monoFont,
        uiFontSize: uiPreferences.uiFontSize,
        workspaceSwitchAnimation: uiPreferences.workspaceSwitchAnimation,
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
        onWorkspaceSwitchAnimationChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            workspaceSwitchAnimation: value,
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
      },
    stationManageModalProps: {
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
        deleteCleanupSubmitting,
        onClose: () => {
          setIsStationManageOpen(false)
          setEditingStation(null)
          handleStationDeleteCleanupClose()
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
      },
    channelStudioProps: {
        open: isChannelStudioOpen,
        locale,
        workspaceId: activeWorkspaceId,
        onClose: () => {
          setIsChannelStudioOpen(false)
        },
      },
    stationSearchModalProps: {
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
      },
    globalFileSearchModalProps: {
        open: isFileSearchModalOpen,
        locale,
        workspaceId: activeWorkspaceId,
        initialMode: fileSearchMode,
        onClose: () => setIsFileSearchModalOpen(false),
        onSelectFile: handleFileTreeSelectFile,
      },
    workspaceSwitching,
    workspaceSwitchAnimation: uiPreferences.workspaceSwitchAnimation,
  }

  return {
    shellRootViewProps,
    stationActionCommandSheetProps: {
      locale,
      station: pendingStationActionSheet?.station ?? null,
      action: pendingStationActionSheet?.action ?? null,
      open: Boolean(pendingStationActionSheet),
      onClose: () => {
        setPendingStationActionSheet(null)
      },
      onSubmit: (values: Record<string, string | boolean>) => {
        void handleSubmitStationActionSheet(values)
      },
    } satisfies ComponentProps<typeof StationActionCommandSheet>,
    workspaceCloseDialogProps: {
      open: closeConfirmState !== null,
      locale: uiPreferences.locale,
      workspaceName: closeConfirmState?.workspaceName ?? '',
      workspacePath: closeConfirmState?.workspacePath ?? '',
      activeTerminalCount: closeConfirmState?.activeTerminalCount ?? 0,
      onClose: () => dismissCloseConfirm(),
      onConfirm: () => {
        void confirmCloseWorkspace()
      },
      submitting: closeSubmitting,
    } satisfies ComponentProps<typeof WorkspaceCloseDialog>,
  }
}
