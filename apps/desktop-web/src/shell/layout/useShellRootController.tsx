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
} from '@features/keybindings'
import {
  applyWorkbenchContainerActiveStationChange,
  applyWorkbenchContainerCustomLayoutChange,
  applyWorkbenchContainerFullscreenStationChange,
  applyWorkbenchContainerLayoutModeChange,
  applyWorkbenchContainerMinimizedStationIdsChange,
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
  getNavItems,
  getPaneModels,
} from './navigation-model'
import {
  desktopApi,
} from '../integration/desktop-api'
import { t } from '../i18n/ui-locale'
import type { TerminalFileDropPayload } from '@shell/utils/terminal-file-drop'
import {
  loadPerformanceDebugState,
} from '../state/performance-debug'
import { mergeStationTerminalRuntimesForPresentation } from '../state/station-terminal-runtime-presentation'
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
  toRelativePathIfInside,
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
import { resolveWindowPerformancePolicy } from './window-performance-policy'
import { useShellPaneLayoutController } from './useShellPaneLayoutController'
import { useShellShortcutController } from './useShellShortcutController'
import { useShellWindowController } from './useShellWindowController'
import { useShellWorkspaceSessionController } from './useShellWorkspaceSessionController'
import { resolveWorkspaceGitStatusFiles } from './workspace-git-summary-model'
import { ShellRootView } from './ShellRootView'
import { WorkspaceCloseDialog } from './WorkspaceCloseDialog'
import { pickDirectory } from '../integration/directory-picker'
import type { SessionRelaunchRequest } from '@features/session'

interface ShellRootProps {
  workspaceWindowId?: string
}

function filterStationsForSearch(stations: AgentStation[], query: string): AgentStation[] {
  const normalizedQuery = query.trim().toLowerCase()
  return stations
    .filter((station) => {
      if (!normalizedQuery) {
        return true
      }
      const searchable =
        `${station.id} ${station.name} ${station.tool} ${station.agentWorkdirRel}`.toLowerCase()
      return searchable.includes(normalizedQuery)
    })
    .sort((left, right) => left.orderIndex - right.orderIndex)
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
    handleWindowStartDragging,
    handleWindowDoubleClick,
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
  const [stationSearchQuery, setStationSearchQuery] = useState('')
  const [activeStationId, setActiveStationId] = useState(initialStations[0]?.id ?? '')
  const [workbenchContainers, setWorkbenchContainers] = useState<WorkbenchContainerModel[]>(() =>
    createInitialWorkbenchContainers(initialStations, buildDefaultWorkbenchContainerId),
  )
  const stationsRef = useRef(initialStations)
  const workbenchContainersRef = useRef(workbenchContainers)
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
  const revealActiveTerminalRef = useRef<() => void>(() => {})

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
    attachWorkspaceTab,
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
    revealActiveTerminalRef,
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
    stationSavePending,
    loadStationsFromDatabase,
    addStation,
    updateStation,
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
    detachedWindowOpenInFlightRef,
    externalChannelController,
    performanceDebugState,
  })

  const {
    stationTerminals,
    workspaceTerminalCacheRef,
    toolCommandsByStationId,
    isBatchLaunchingAgents,
    pendingStationActionSheet,
    stationTerminalsRef,
    stationSubmitSequenceRef,
    stationDeletePendingId,
    stationDeleteCleanupTargetId,
    stationDeleteCleanupState,
    stationDeleteCleanupSubmitting,
    handleStationDeleteCleanupChange,
    handleStationDeleteCleanupClose,
    handleStationDeleteCleanupConfirm,
    bindStationTerminalSink,
    ensureStationTerminalSession,
    launchStationTerminal,
    handleStationTerminalInput,
    submitStationTerminal,
    resizeStationTerminal,
    forceCloseStationTerminal,
    confirmForceCloseStationTerminal,
    dismissForceCloseConfirm,
    forceCloseConfirmPendingId,
    reconcileStationRuntimeRegistration,
    removeStation,
    launchStationCliAgent,
    relaunchGtoSession,
    handleBatchLaunchAgents,
    executeStationAction,
    handleSubmitStationActionSheet,
    handleDetachedSurfaceBridgeMessage,
    reportRenderedScreenSnapshot,
    setPendingStationActionSheet,
    terminalSessionCount,
    stationAgentRunningById,
    batchLaunchableAgentCount,
    writeStationTerminalWithSubmit,
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
    handleCanvasFullscreenStationChange,
    handleCanvasMinimizedStationIdsChange,
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
    attachWorkspaceTab,
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
    presentedWorkspaceId,
    closeConfirmState,
    closeSubmitting,
    requestCloseWorkspace,
    confirmCloseWorkspace,
    dismissCloseConfirm,
    handleTearOffWorkspaceTab,
    handleMergeWorkspaceTab,
    handlePickWorkspaceDirectory,
  } = workspaceSessionController

  const presentedWorkspaceRoot = useMemo(() => {
    if (!presentedWorkspaceId) {
      return null
    }
    if (presentedWorkspaceId === activeWorkspaceId) {
      return activeWorkspaceRoot
    }
    return workspaceTabs.find((tab) => tab.workspaceId === presentedWorkspaceId)?.root ?? null
  }, [activeWorkspaceId, activeWorkspaceRoot, presentedWorkspaceId, workspaceTabs])
  const presentedGitStatusFiles = useMemo(
    () => resolveWorkspaceGitStatusFiles(gitSummary, presentedWorkspaceId),
    [gitSummary, presentedWorkspaceId],
  )

  // Resolve terminal runtimes for the first paint of a workspace switch. React
  // state may still be idle/missing while the cached document already knows the
  // live sessions — merging here keeps StationCard on the terminal surface
  // instead of flashing session history.
  const terminalByStationForPresentation = useMemo(() => {
    const cacheWorkspaceId =
      activeWorkspaceId && stationsLoadedWorkspaceId === activeWorkspaceId
        ? activeWorkspaceId
        : presentedWorkspaceId
    const cachedDocument = cacheWorkspaceId
      ? workspaceTerminalCacheRef.current[cacheWorkspaceId]
      : null
    return mergeStationTerminalRuntimesForPresentation({
      stations,
      liveRuntimes: stationTerminals,
      cachedDocument,
      workspaceId: cacheWorkspaceId,
    })
  }, [
    activeWorkspaceId,
    presentedWorkspaceId,
    stationTerminals,
    stations,
    stationsLoadedWorkspaceId,
    workspaceTerminalCacheRef,
  ])

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

  // Keep inventory refs synchronous with the current render so workspace-switch
  // capture paths (especially fullscreen/maximize) never read a stale frame.
  stationsRef.current = stations
  workbenchContainersRef.current = workbenchContainers

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

  const gitController = useGitWorkspaceController({
    locale,
    workspaceId: activeWorkspaceId,
    summary: gitSummary,
    onRefreshSummary: refreshGit,
  })

  const activeGitSummary = gitController.summary
  const hasUnavailableGitRepository = Boolean(
    gitSummary?.state === 'invalid' ||
    gitSummary?.repositories.some((repository) => repository.state === 'invalid'),
  )

  const activePaneModel = useMemo(() => {
    if (activeNavId !== 'git') {
      return paneModels[activeNavId]
    }

    if (!activeGitSummary) {
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
        branch: activeGitSummary.branch,
        ahead: activeGitSummary.ahead,
        behind: activeGitSummary.behind,
      }),
      items:
        activeGitSummary.files.length > 0
          ? activeGitSummary.files.slice(0, 8).map((file) => `${file.status} ${file.path}`)
          : [
              t(
                locale,
                hasUnavailableGitRepository
                  ? 'shell.git.statusInvalid'
                  : 'shell.git.workspaceClean',
              ),
            ],
    }
  }, [activeGitSummary, activeNavId, hasUnavailableGitRepository, locale, paneModels])

  const filteredStations = useMemo(
    () => filterStationsForSearch(stations, stationSearchQuery),
    [stationSearchQuery, stations],
  )

  const channelBotBindingsByStationId = useMemo(
    () => externalChannelController.channelBotBindingsByStationId(stations),
    [externalChannelController.channelBotBindingsByStationId, stations],
  )

  useEffect(() => {
    if (activeNavId !== 'stations') {
      return
    }
    if (stations.length === 0) {
      return
    }
    if (!stations.some((station) => station.id === activeStationId)) {
      setActiveStationId(stations[0].id)
    }
  }, [activeNavId, activeStationId, stations])

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
          const message = payload.payload
          const currentWorkspaceId = activeWorkspaceIdRef.current
          if (!currentWorkspaceId || message.workspaceId !== currentWorkspaceId) {
            return
          }
          if (message.kind === 'detached_terminal_activate_station') {
            setWorkbenchContainers((prev) => {
              const next = applyWorkbenchContainerActiveStationChange(
                prev,
                message.containerId,
                message.stationId,
              )
              if (next === prev) {
                return prev
              }
              return next.map((container) =>
                container.id === message.containerId
                  ? {
                      ...container,
                      lastActiveAtMs: Date.now(),
                    }
                  : container,
              )
            })
            setActiveStationId(message.stationId)
            return
          }
          if (message.kind === 'detached_terminal_update_container_view_state') {
            setWorkbenchContainers((prev) => {
              let next = prev
              if (Object.prototype.hasOwnProperty.call(message, 'activeStationId')) {
                next = applyWorkbenchContainerActiveStationChange(
                  next,
                  message.containerId,
                  message.activeStationId ?? null,
                )
              }
              if (message.layoutMode === 'custom' && message.customLayout) {
                next = applyWorkbenchContainerCustomLayoutChange(
                  next,
                  message.containerId,
                  message.customLayout,
                )
              } else if (message.layoutMode) {
                next = applyWorkbenchContainerLayoutModeChange(
                  next,
                  message.containerId,
                  message.layoutMode,
                )
              } else if (message.customLayout) {
                next = applyWorkbenchContainerCustomLayoutChange(
                  next,
                  message.containerId,
                  message.customLayout,
                )
              }
              if (Object.prototype.hasOwnProperty.call(message, 'fullscreenStationId')) {
                next = applyWorkbenchContainerFullscreenStationChange(
                  next,
                  message.containerId,
                  message.fullscreenStationId ?? null,
                )
              }
              if (Array.isArray(message.minimizedStationIds)) {
                next = applyWorkbenchContainerMinimizedStationIdsChange(
                  next,
                  message.containerId,
                  message.minimizedStationIds,
                )
              }
              if (
                next !== prev &&
                typeof message.activeStationId === 'string' &&
                message.activeStationId
              ) {
                next = next.map((container) =>
                  container.id === message.containerId
                    ? {
                        ...container,
                        lastActiveAtMs: Date.now(),
                      }
                    : container,
                )
              }
              return next
            })
            if (typeof message.activeStationId === 'string' && message.activeStationId) {
              setActiveStationId(message.activeStationId)
            }
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
            tool: station.tool,
            agentWorkdirRel: station.agentWorkdirRel,
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
          fullscreenStationId: container.fullscreenStationId,
          minimizedStationIds: container.minimizedStationIds,
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

  const handleStationEdit = useCallback((station: AgentStation) => {
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

  const showWorkbenchCanvas = activeNavId !== 'files' && activeNavId !== 'git' && activeNavId !== 'designer'
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

  const revealActiveTerminal = useCallback(() => {
    const station =
      stations.find((entry) => entry.id === activeStationId && entry.scope !== 'designer') ??
      stations.find((entry) => entry.scope !== 'designer') ??
      null
    if (!station) {
      return
    }
    setActiveNavId('stations')
    setLeftPaneVisible(true)
    setActiveStationId(station.id)
    setPendingScrollStationId(station.id)
    void launchStationTerminal(station.id)
  }, [activeStationId, launchStationTerminal, setActiveNavId, setLeftPaneVisible, stations])

  useEffect(() => {
    revealActiveTerminalRef.current = revealActiveTerminal
  }, [revealActiveTerminal])

  const handleTerminalFilePathDrop = useCallback(
    async (stationId: string, payload: TerminalFileDropPayload) => {
      setActiveStationId(stationId)
      await launchStationTerminal(stationId)
      handleStationTerminalInput(stationId, payload.shellText)
    },
    [handleStationTerminalInput, launchStationTerminal],
  )

  // Designer agent station dispatch: the designer pane owns ensure/renderScenario/
  // checkpointTurn (feature controller); the shell owns the terminal session
  // mechanics. After `ensure` creates the designer agent profile we must reload
  // the station list so writeStationTerminalWithSubmit can find it, then write
  // the rendered prompt + submit into the designer station terminal.
  const handleDispatchDesignerStationPrompt = useCallback(
    async (stationId: string, prompt: string): Promise<boolean> => {
      const workspaceId = presentedWorkspaceId
      if (!workspaceId) {
        return false
      }
      await loadStationsFromDatabase(workspaceId)
      return writeStationTerminalWithSubmit(stationId, prompt)
    },
    [loadStationsFromDatabase, presentedWorkspaceId, writeStationTerminalWithSubmit],
  )

  const workbenchCanvasBaseProps = {
    locale,
    appearanceVersion: `${uiPreferences.themeMode}:${uiPreferences.monoFont}:${uiPreferences.uiFontSize}`,
    performanceDebugEnabled: performanceDebugState.enabled,
    showFloatingPortal: true as const,
    workspaceId: presentedWorkspaceId,
    workspaceCwd: presentedWorkspaceRoot,
    stations,
    activeStationId,
    terminalByStation: terminalByStationForPresentation,
    agentRunningByStationId: stationAgentRunningById,
    taskSignalByStationId: externalChannelController.stationTaskSignals,
    channelBotBindingsByStationId,
    pinnedWorkbenchContainerId,
    onTogglePinnedWorkbenchContainer: togglePinnedWorkbenchContainer,
    onSelectStation: handleCanvasSelectStation,
    onLaunchStationTerminal: handleCanvasLaunchStationTerminal,
    onLaunchCliAgent: handleCanvasLaunchCliAgent,
    onSessionRelaunch: (stationId: string, request: SessionRelaunchRequest) => {
      void relaunchGtoSession(stationId, request)
    },
    onForceCloseTerminal: forceCloseStationTerminal,
    onSendInputData: handleStationTerminalInput,
    onResizeTerminal: resizeStationTerminal,
    onBindTerminalSink: bindStationTerminalSink,
    onRenderedScreenSnapshot: reportRenderedScreenSnapshot,
    onDropFilePath: handleTerminalFilePathDrop,
    onLayoutModeChange: handleCanvasLayoutModeChange,
    onCustomLayoutChange: handleCanvasCustomLayoutChange,
    onFullscreenStationChange: handleCanvasFullscreenStationChange,
    onMinimizedStationIdsChange: handleCanvasMinimizedStationIdsChange,
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
    onEditStation: handleStationEdit,
    onRemoveStation: handleCanvasRemoveStation,
  }
  const pinnedWorkbenchCanvasProps = showPinnedWorkbenchPane && pinnedWorkbenchContainer
    ? {
        ...workbenchCanvasBaseProps,
        containers: [pinnedWorkbenchContainer],
        workspaceTransitioning: workspaceSwitching,
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
    workspaceTransitioning: workspaceSwitching,
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
        workspaceTransitioning: workspaceSwitching,
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
          if (isSingleWorkspaceMode) {
            void handleWindowClose()
            return
          }
          requestCloseWorkspace(workspaceId)
        },
        onAddTab: isSingleWorkspaceMode
          ? undefined
          : () => {
              void handlePickWorkspaceDirectory()
            },
        onReorderTabs: reorderWorkspaceTab,
        onTearOffTab: isSingleWorkspaceMode
          ? undefined
          : (request) => {
              void handleTearOffWorkspaceTab(request)
            },
        onReceiveMergedTab: isSingleWorkspaceMode
          ? undefined
          : (workspaceId: string) => {
              attachWorkspaceTab(workspaceId)
            },
        onMergeTabIntoWindow: isSingleWorkspaceMode
          ? (workspaceId: string, targetWindowLabel: string) => {
              void handleMergeWorkspaceTab(workspaceId, targetWindowLabel)
            }
          : undefined,
        onBatchLaunchAgents: () => {
          void handleBatchLaunchAgents()
        },
        batchLaunchDisabled: isBatchLaunchingAgents || batchLaunchableAgentCount === 0,
        onOpenSettings: handleOpenSettings,
        onWindowMinimize: handleWindowMinimize,
        onWindowToggleMaximize: handleWindowToggleMaximize,
        onWindowClose: handleWindowClose,
        onBeginWindowDrag: handleWindowStartDragging,
        onWindowDoubleClick: handleWindowDoubleClick,
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
        workspaceId: presentedWorkspaceId,
        workspaceRoot: presentedWorkspaceRoot,
        gitStatusFiles: presentedGitStatusFiles,
        isMacOs: nativeWindowTopMacOs,
        selectedFilePath: activeFilePath,
        onSelectFile: handleFileTreeSelectFile,
        onCreateFile: createFileInWorkspace,
        onDeletePath: deletePathInWorkspace,
        onMovePath: movePathInWorkspace,
        onOpenSearch: requestFileSearch,
    },
    taskCenterPaneProps: taskComposerBaseProps,
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
    businessDesignerPaneProps: {
      locale,
      workspaceId: presentedWorkspaceId,
      workspaceRoot: presentedWorkspaceRoot,
      active: activeNavId === 'designer',
      libraryPanelVisible: leftPaneVisible,
      onLibraryPanelVisibleChange: setLeftPaneVisible,
      onDispatchDesignerStationPrompt: handleDispatchDesignerStationPrompt,
    },
    activePaneModel,
    showWorkbenchCanvas,
    workbenchCanvasProps: mainWorkbenchCanvasProps,
    pinnedWorkbenchCanvasProps,
    fileEditorPaneProps: {
      locale,
      workspaceId: presentedWorkspaceId,
      workspaceRoot: presentedWorkspaceRoot,
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
      autoSaveEnabled: uiPreferences.fileEditorAutoSaveEnabled,
      autoSaveDelayMs: uiPreferences.fileEditorAutoSaveDelayMs,
    },
    gitHistoryPaneProps: {
      controller: gitController,
      onOpenInEditor: handleGitHistoryOpenInEditor,
    },
    topmostWorkbenchCanvasProps,
    statusBarProps: {
      locale,
      gitBranch: activeGitSummary?.branch ?? '-',
      gitBranches: gitController.branches,
      gitChangedFiles: hasUnavailableGitRepository
        ? null
        : activeGitSummary?.totalChanges ?? activeGitSummary?.files.length ?? 0,
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
        fileEditorAutoSaveEnabled: uiPreferences.fileEditorAutoSaveEnabled,
        fileEditorAutoSaveDelayMs: uiPreferences.fileEditorAutoSaveDelayMs,
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
        onFileEditorAutoSaveEnabledChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            fileEditorAutoSaveEnabled: value,
          })),
        onFileEditorAutoSaveDelayChange: (value) =>
          setUiPreferences((prev) => ({
            ...prev,
            fileEditorAutoSaveDelayMs: value,
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
        query: stationSearchQuery,
        stations: filteredStations,
        onClose: () => {
          setIsStationSearchOpen(false)
        },
        onQueryChange: (value) => {
          setStationSearchQuery(value)
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
    stationForceCloseConfirmDialogProps: {
      open: forceCloseConfirmPendingId !== null,
      locale: uiPreferences.locale,
      stationName: forceCloseConfirmPendingId
        ? (stations.find((s) => s.id === forceCloseConfirmPendingId)?.name ?? forceCloseConfirmPendingId)
        : '',
      onClose: dismissForceCloseConfirm,
      onConfirm: () => {
        void confirmForceCloseStationTerminal()
      },
    },
  }
}
