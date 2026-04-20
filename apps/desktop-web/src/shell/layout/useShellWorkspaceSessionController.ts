import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type { OpenedFile } from '@features/file-explorer'
import {
  createInitialWorkbenchContainers,
  reconcileWorkbenchContainers,
  restoreWorkbenchContainers,
  type AgentStation,
  type WorkbenchContainerModel,
  type WorkbenchContainerSnapshot,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from '@features/workspace-hub'
import {
  buildWorkspaceSessionFilePath,
  buildWorkspaceSessionSnapshot,
  parseWorkspaceSessionSnapshot,
  serializeWorkspaceSessionSnapshot,
  type WorkspaceSessionTerminalSnapshot,
} from '@features/workspace'
import {
  isPreviewable,
} from '@features/file-preview'
import {
  createInitialTaskDraft,
} from '@features/task-center'
import { addNotification } from '@/stores/notification'
import { desktopApi } from '../integration/desktop-api'
import { pickDirectory } from '../integration/directory-picker'
import { t, type Locale } from '../i18n/ui-locale'
import type { NavItemId } from './navigation-model'
import type { UiPreferences } from '../state/ui-preferences'
import {
  WORKSPACE_SESSION_MAX_RESTORE_TABS,
  WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS,
  buildDefaultWorkbenchContainerId,
  describeError,
  isNavItemId,
  normalizeFsPath,
  type FileReadMode,
  type StationTerminalRuntime,
} from './ShellRoot.shared'
import {
  logPerformanceDebug,
} from '../state/performance-debug'
import type { ShellExternalChannelController } from './useShellExternalChannelController'
import type { ShellTerminalController } from './useShellTerminalController'
import type { ShellTaskDispatchController } from './useShellTaskDispatchController'
import type { WorkspaceTearOffRequest } from './WorkspaceTabBar'

interface UseShellWorkspaceSessionControllerInput {
  // Workspace tab controller outputs
  workspacePathInput: string
  activeWorkspaceId: string | null
  activeWorkspaceIdRef: MutableRefObject<string | null>
  activeWorkspaceRoot: string | null
  setActiveWorkspaceRoot: React.Dispatch<React.SetStateAction<string | null>>
  workspaceTabs: Array<{ workspaceId: string; name: string; root: string }>
  beginWorkspaceSwitchAnimation: (workspaceId?: string | null) => boolean
  completeWorkspaceSwitch: (workspaceId?: string | null) => void
  closeWorkspaceTab: (workspaceId: string) => Promise<void>
  detachWorkspaceTab: (workspaceId: string, windowLabel: string) => void
  openWorkspaceAtPath: (
    path: string,
    reason?: 'manual' | 'restore' | 'picker' | 'debounce',
  ) => Promise<void>

  // Terminal controller outputs
  terminalController: ShellTerminalController

  // File controller outputs
  loadFileContentRef: MutableRefObject<
    (filePath: string, mode?: FileReadMode, options?: { activate?: boolean }) => Promise<void>
  >
  setOpenedFiles: React.Dispatch<React.SetStateAction<OpenedFile[]>>
  setActiveFilePath: React.Dispatch<React.SetStateAction<string | null>>
  resetFileState: () => void
  tabSessionSnapshotEntries: Array<{ path: string; active: boolean }>
  tabSessionSnapshotSignature: string

  // Station controller outputs
  stations: AgentStation[]
  stationsRef: MutableRefObject<AgentStation[]>
  stationsLoadedWorkspaceId: string | null
  setStations: React.Dispatch<React.SetStateAction<AgentStation[]>>

  // Workbench state
  workbenchContainers: WorkbenchContainerModel[]
  setWorkbenchContainers: React.Dispatch<React.SetStateAction<WorkbenchContainerModel[]>>
  workbenchContainersRef: MutableRefObject<WorkbenchContainerModel[]>
  workbenchContainerCounterRef: MutableRefObject<number>
  workbenchContainerSnapshotEntries: WorkbenchContainerSnapshot[]
  workbenchContainerSnapshotSignature: string
  canvasLayoutMode: WorkbenchLayoutMode
  canvasCustomLayout: WorkbenchCustomLayout
  canvasLayoutModeRef: MutableRefObject<WorkbenchLayoutMode>
  canvasCustomLayoutRef: MutableRefObject<WorkbenchCustomLayout>

  // Navigation state
  activeNavId: NavItemId
  setActiveNavId: (navId: NavItemId) => void
  activeStationId: string
  setActiveStationId: React.Dispatch<React.SetStateAction<string>>

  // Pinned workbench
  pinnedWorkbenchContainerId: string | null
  setPinnedWorkbenchContainerId: React.Dispatch<React.SetStateAction<string | null>>

  // External channel controller
  externalChannelController: ShellExternalChannelController

  // Task dispatch controller
  taskDispatchController: ShellTaskDispatchController

  // Misc
  tauriRuntime: boolean
  initialStations: AgentStation[]
  detachedWindowOpenInFlightRef: MutableRefObject<Record<string, boolean>>
  locale: Locale
  uiPreferences: UiPreferences
}

export interface ShellWorkspaceSessionController {
  // State
  presentedWorkspaceId: string | null
  closeConfirmState: {
    workspaceId: string
    workspaceName: string
    workspacePath: string
    activeTerminalCount: number
  } | null
  closeSubmitting: boolean

  // Refs
  previousActiveWorkspaceIdRef: MutableRefObject<string | null>
  pendingWorkbenchContainerSnapshotsRef: MutableRefObject<WorkbenchContainerSnapshot[] | null>

  // Terminal snapshot
  terminalSessionSnapshotEntries: WorkspaceSessionTerminalSnapshot[]
  terminalSessionSnapshotSignature: string

  // Callbacks
  applyWorkspacePresentationSwitch: (input: {
    activeWorkspaceId: string | null
    departingWorkspaceId: string | null
    clearVisibleState: boolean
  }) => void
  requestCloseWorkspace: (workspaceId: string) => void
  confirmCloseWorkspace: () => Promise<void>
  dismissCloseConfirm: () => void
  handleTearOffWorkspaceTab: (request: WorkspaceTearOffRequest) => Promise<void>
  handlePickWorkspaceDirectory: () => Promise<void>
}

export function useShellWorkspaceSessionController({
  workspacePathInput,
  activeWorkspaceId,
  activeWorkspaceIdRef,
  activeWorkspaceRoot,
  setActiveWorkspaceRoot: _setActiveWorkspaceRoot,
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
  workbenchContainers: _workbenchContainers,
  setWorkbenchContainers,
  workbenchContainersRef,
  workbenchContainerCounterRef: _workbenchContainerCounterRef,
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
  tauriRuntime: _tauriRuntime,
  initialStations: _initialStations,
  detachedWindowOpenInFlightRef,
  locale: _locale,
  uiPreferences,
}: UseShellWorkspaceSessionControllerInput): ShellWorkspaceSessionController {
  // ----- State -----
  const [closeConfirmState, setCloseConfirmState] = useState<{
    workspaceId: string
    workspaceName: string
    workspacePath: string
    activeTerminalCount: number
  } | null>(null)
  const [closeSubmitting, setCloseSubmitting] = useState(false)
  const [presentedWorkspaceId, setPresentedWorkspaceId] = useState<string | null>(null)

  // ----- Refs -----
  const workspaceSessionPersistTimerRef = useRef<number | null>(null)
  const workspaceSessionHydratingRef = useRef(false)
  const workspaceSessionRestoreSeqRef = useRef(0)
  const workspaceSessionRestoreTabTimersRef = useRef<number[]>([])
  const workspaceSessionRestoreWaitRef = useRef<string | null>(null)
  const workspaceSessionRestoreWaitStartRef = useRef<number | null>(null)
  const pendingWorkspacePresentationSwitchRef = useRef<{
    departingWorkspaceId: string | null
    targetWorkspaceId: string | null
  } | null>(null)
  const previousActiveWorkspaceIdRef = useRef<string | null>(null)
  const pendingWorkbenchContainerSnapshotsRef = useRef<WorkbenchContainerSnapshot[] | null>(null)
  const tabSessionSnapshotRef = useRef<Array<{ path: string; active: boolean }>>([])
  const workbenchContainerSnapshotRef = useRef<WorkbenchContainerSnapshot[]>([])
  const terminalSessionSnapshotRef = useRef<WorkspaceSessionTerminalSnapshot[]>([])

  const workspaceSessionFilePath = useMemo(() => buildWorkspaceSessionFilePath(), [])

  // Terminal controller destructure
  const {
    stationTerminals,
    setStationTerminals,
    stationTerminalsRef,
    stationTerminalOutputCacheRef,
    stationTerminalOutputRevisionRef,
    stationTerminalRestoreStateRef,
    stationTerminalPendingReplayRef,
    stationTerminalInputControllerRef,
    stationTerminalSinkRef: _stationTerminalSinkRef,
    ensureStationTerminalSessionInFlightRef,
    sessionStationRef,
    terminalSessionSeqRef,
    terminalOutputQueueRef,
    terminalSessionVisibilityRef,
    workspaceTerminalCacheRef,
    presentedWorkspaceIdRef,
    resetTerminalStateOnWorkspaceSwitch,
    captureActiveWorkspaceTerminalDocument,
    resolveWorkspaceTerminalDocument,
    persistActiveWorkspaceTerminalDocument: _persistActiveWorkspaceTerminalDocument,
  } = terminalController

  // ----- Terminal session snapshot -----
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

  // ----- Ref syncs -----
  useEffect(() => {
    presentedWorkspaceIdRef.current = presentedWorkspaceId
  }, [presentedWorkspaceId])

  useEffect(() => {
    tabSessionSnapshotRef.current = tabSessionSnapshotEntries
  }, [tabSessionSnapshotEntries])

  useEffect(() => {
    workbenchContainerSnapshotRef.current = workbenchContainerSnapshotEntries
  }, [workbenchContainerSnapshotEntries])

  useEffect(() => {
    terminalSessionSnapshotRef.current = terminalSessionSnapshotEntries
  }, [terminalSessionSnapshotEntries])

  // ----- Cleanup timer refs on unmount -----
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
    }
  }, [])

  // ----- Callbacks -----

  const applyWorkspacePresentationSwitch = useCallback((input: {
    activeWorkspaceId: string | null
    departingWorkspaceId: string | null
    clearVisibleState: boolean
  }) => {
    const resetStartedAt = performance.now()
    const { activeWorkspaceId: nextWorkspaceId, departingWorkspaceId, clearVisibleState } = input
    if (departingWorkspaceId && departingWorkspaceId !== nextWorkspaceId) {
      captureActiveWorkspaceTerminalDocument(departingWorkspaceId)
      logPerformanceDebug('workspace-switch', 'persisted terminal document for departing workspace', {
        departingWorkspaceId,
        sessionCount: Object.keys(sessionStationRef.current).length,
      })
    }
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
    resetTerminalStateOnWorkspaceSwitch()
    taskDispatchController.setTaskDispatchHistory([])
    taskDispatchController.setTaskSending(false)
    taskDispatchController.setTaskRetryingTaskId(null)
    taskDispatchController.setTaskDraftSavedAtMs(null)
    taskDispatchController.setTaskNotice(null)
    externalChannelController.resetExternalChannelState()
    pendingWorkbenchContainerSnapshotsRef.current = null
    detachedWindowOpenInFlightRef.current = {}
    if (clearVisibleState) {
      resetFileState()
      setPinnedWorkbenchContainerId(null)
      setWorkbenchContainers(
        createInitialWorkbenchContainers(stationsRef.current, buildDefaultWorkbenchContainerId, {
          mode: canvasLayoutModeRef.current,
          customLayout: canvasCustomLayoutRef.current,
        }),
      )
      externalChannelController.clearStationTaskSignals()
      taskDispatchController.setTaskDraft(createInitialTaskDraft(stationsRef.current, stationsRef.current[0]?.id ?? ''))
    }
    setPresentedWorkspaceId(nextWorkspaceId)
    logPerformanceDebug('workspace-switch', 'workspace presentation switch applied', {
      activeWorkspaceId: nextWorkspaceId,
      clearVisibleState,
      durationMs: Math.round(performance.now() - resetStartedAt),
    })
  }, [captureActiveWorkspaceTerminalDocument, externalChannelController.resetExternalChannelState, externalChannelController.clearStationTaskSignals, resetFileState, resetTerminalStateOnWorkspaceSwitch])

  const requestCloseWorkspace = useCallback(
    (workspaceId: string) => {
      const tab = workspaceTabs.find((t) => t.workspaceId === workspaceId)
      if (!tab) return
      const cachedDoc = workspaceTerminalCacheRef.current[workspaceId]
      const terminalCount = cachedDoc
        ? Object.keys(cachedDoc.sessionStation).length
        : 0
      setCloseConfirmState({
        workspaceId,
        workspaceName: tab.name || tab.root.split('/').pop() || workspaceId,
        workspacePath: tab.root,
        activeTerminalCount: terminalCount,
      })
    },
    [workspaceTabs],
  )

  const confirmCloseWorkspace = useCallback(async () => {
    if (!closeConfirmState) return
    const { workspaceId } = closeConfirmState
    setCloseSubmitting(true)
    try {
      const cachedDoc = workspaceTerminalCacheRef.current[workspaceId]
      if (cachedDoc) {
        const sessionIds = Object.keys(cachedDoc.sessionStation)
        for (const sessionId of sessionIds) {
          desktopApi.terminalKill(sessionId, 'TERM').catch(() => {})
        }
        delete workspaceTerminalCacheRef.current[workspaceId]
      }
      if (cachedDoc) {
        const stationIds = Object.keys(cachedDoc.stationTerminals)
        for (const stationId of stationIds) {
          delete stationTerminalOutputCacheRef.current[stationId]
          delete stationTerminalOutputRevisionRef.current[stationId]
          delete stationTerminalRestoreStateRef.current[stationId]
        }
      }
      await closeWorkspaceTab(workspaceId)
      addNotification({
        type: 'success',
        message: t(
          uiPreferences.locale,
          'workspaceTab.closeSuccess',
          'workspaceTab.closeSuccess',
        ),
      })
    } catch (error) {
      addNotification({
        type: 'error',
        message: t(
          uiPreferences.locale,
          'workspaceTab.closeError',
          'workspaceTab.closeError',
        ),
      })
    } finally {
      setCloseSubmitting(false)
      setCloseConfirmState(null)
    }
  }, [closeConfirmState, closeWorkspaceTab, uiPreferences.locale])

  const dismissCloseConfirm = useCallback(() => {
    setCloseConfirmState(null)
  }, [])

  const handleTearOffWorkspaceTab = useCallback(
    async ({
      workspaceId,
      screenX,
      screenY,
    }: {
      workspaceId: string
      screenX: number
      screenY: number
    }) => {
      const startedAt = performance.now()
      try {
        const openResponse = await desktopApi.workspaceOpenInNewWindow(workspaceId, {
          x: Math.max(0, screenX - 220),
          y: Math.max(0, screenY - 18),
        })
        detachWorkspaceTab(workspaceId, openResponse.windowLabel)
        logPerformanceDebug('workspace-tabs', 'tore off workspace tab into new window', {
          workspaceId,
          durationMs: Math.round(performance.now() - startedAt),
          screenX,
          screenY,
        })
      } catch (error) {
        logPerformanceDebug('workspace-tabs', 'failed to tear off workspace tab', {
          workspaceId,
          durationMs: Math.round(performance.now() - startedAt),
          error: describeError(error),
        })
      }
    },
    [detachWorkspaceTab],
  )

  const handlePickWorkspaceDirectory = useMemo(
    () => async () => {
      const selected = await pickDirectory({
        defaultPath: workspacePathInput || activeWorkspaceRoot || '/mnt/c/project/vbCode',
      })
      if (!selected) {
        return
      }
      const normalized = normalizeFsPath(selected)
      await openWorkspaceAtPath(normalized, 'picker')
    },
    [activeWorkspaceRoot, openWorkspaceAtPath, workspacePathInput],
  )

  // ----- Effects -----

  // Workspace presentation switch effect
  useEffect(() => {
    const departingWorkspaceId = previousActiveWorkspaceIdRef.current
    if (departingWorkspaceId === activeWorkspaceId) {
      return
    }
    previousActiveWorkspaceIdRef.current = activeWorkspaceId
    pendingWorkspacePresentationSwitchRef.current = {
      departingWorkspaceId,
      targetWorkspaceId: activeWorkspaceId,
    }
    if (!activeWorkspaceId) {
      applyWorkspacePresentationSwitch({
        activeWorkspaceId: null,
        departingWorkspaceId,
        clearVisibleState: true,
      })
      pendingWorkspacePresentationSwitchRef.current = null
      completeWorkspaceSwitch()
    }
  }, [activeWorkspaceId, applyWorkspacePresentationSwitch, completeWorkspaceSwitch])

  // Terminal document hydration effect
  useEffect(() => {
    if (!presentedWorkspaceId || activeWorkspaceId !== presentedWorkspaceId) {
      return
    }
    if (stationsLoadedWorkspaceId !== presentedWorkspaceId) {
      return
    }
    const stationIdSet = new Set(stations.map((station) => station.id))
    const terminalDocument = resolveWorkspaceTerminalDocument(presentedWorkspaceId, stations)
    stationTerminalsRef.current = { ...terminalDocument.stationTerminals }
    stationTerminalOutputCacheRef.current = { ...terminalDocument.outputCache }
    stationTerminalOutputRevisionRef.current = { ...terminalDocument.outputRevision }
    stationTerminalRestoreStateRef.current = { ...terminalDocument.restoreState }
    sessionStationRef.current = { ...terminalDocument.sessionStation }
    terminalSessionSeqRef.current = { ...terminalDocument.sessionSeq }
    terminalSessionVisibilityRef.current = { ...terminalDocument.sessionVisibility }
    setStationTerminals({ ...terminalDocument.stationTerminals })

    Object.keys(stationTerminalPendingReplayRef.current).forEach((stationId) => {
      if (!stationIdSet.has(stationId)) {
        delete stationTerminalPendingReplayRef.current[stationId]
      }
    })
    externalChannelController.pruneStationTaskSignals(stationIdSet)
    stations.forEach((station) => {
      if (!stationTerminalOutputCacheRef.current[station.id]) {
        stationTerminalOutputCacheRef.current[station.id] = ''
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
    captureActiveWorkspaceTerminalDocument(presentedWorkspaceId)

    if (!activeStationId && stations[0]) {
      setActiveStationId(stations[0].id)
      return
    }
    if (activeStationId && !stationIdSet.has(activeStationId)) {
      setActiveStationId(stations[0]?.id ?? '')
    }
  }, [
    activeStationId,
    activeWorkspaceId,
    presentedWorkspaceId,
    captureActiveWorkspaceTerminalDocument,
    externalChannelController.pruneStationTaskSignals,
    resolveWorkspaceTerminalDocument,
    stationsLoadedWorkspaceId,
    stations,
  ])

  // Workbench container reconciliation effect
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

  // Active station in container sync effect
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

  // Workspace session restore effect
  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      workspaceSessionRestoreWaitRef.current = null
      workspaceSessionHydratingRef.current = false
      completeWorkspaceSwitch()
      return
    }

    if (stationsLoadedWorkspaceId !== activeWorkspaceId) {
      if (workspaceSessionRestoreWaitRef.current !== activeWorkspaceId) {
        workspaceSessionRestoreWaitRef.current = activeWorkspaceId
        workspaceSessionRestoreWaitStartRef.current = performance.now()
        logPerformanceDebug('workspace-session', 'waiting for station snapshot before restore', {
          activeWorkspaceId,
          stationsLoadedWorkspaceId,
        })
      }
      workspaceSessionHydratingRef.current = true
      return
    }
    if (workspaceSessionRestoreWaitRef.current === activeWorkspaceId) {
      const waitDurationMs = workspaceSessionRestoreWaitStartRef.current
        ? Math.round(performance.now() - workspaceSessionRestoreWaitStartRef.current)
        : 0
      logPerformanceDebug('workspace-session', 'station snapshot wait ended', {
        activeWorkspaceId,
        waitDurationMs,
      })
    }
    workspaceSessionRestoreWaitRef.current = null

    workspaceSessionRestoreTabTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId)
    })
    workspaceSessionRestoreTabTimersRef.current = []

    const workspaceId = activeWorkspaceId
    const restoreSeq = workspaceSessionRestoreSeqRef.current + 1
    workspaceSessionRestoreSeqRef.current = restoreSeq
    workspaceSessionHydratingRef.current = true
    const restoreStartedAt = performance.now()
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
        const shouldAnimateWorkspaceSwitch = beginWorkspaceSwitchAnimation(workspaceId)
        if (
          cancelled ||
          workspaceSessionRestoreSeqRef.current !== restoreSeq ||
          activeWorkspaceIdRef.current !== workspaceId
        ) {
          completeWorkspaceSwitch(workspaceId)
          return
        }
        const pendingPresentationSwitch = pendingWorkspacePresentationSwitchRef.current
        if (pendingPresentationSwitch?.targetWorkspaceId === workspaceId) {
          applyWorkspacePresentationSwitch({
            activeWorkspaceId: workspaceId,
            departingWorkspaceId: pendingPresentationSwitch.departingWorkspaceId,
            clearVisibleState: false,
          })
          pendingWorkspacePresentationSwitchRef.current = null
        }
        if (!restored) {
          completeWorkspaceSwitch(workspaceId)
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
          void loadFileContentRef.current(activeTabPath, 'full')
        }

        if (shouldAnimateWorkspaceSwitch) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              completeWorkspaceSwitch(workspaceId)
            })
          })
        } else {
          completeWorkspaceSwitch(workspaceId)
        }

        // Terminal restoration is handled by the terminal controller's
        // workspace presentation restore flow
        captureActiveWorkspaceTerminalDocument(workspaceId)
        logPerformanceDebug('workspace-session', 'restored workspace session', {
          workspaceId,
          restoreSeq,
          durationMs: Math.round(performance.now() - restoreStartedAt),
          restoredTabCount: tabsToRestore.length,
          restoredWorkbenchContainerCount: restored.workbenchContainers.length,
        })
      } finally {
        if (workspaceSessionRestoreSeqRef.current === restoreSeq) {
          workspaceSessionHydratingRef.current = false
        }
      }
    }

    void restoreWorkspaceSession().catch((error) => {
      const pendingPresentationSwitch = pendingWorkspacePresentationSwitchRef.current
      if (pendingPresentationSwitch?.targetWorkspaceId === workspaceId) {
        applyWorkspacePresentationSwitch({
          activeWorkspaceId: workspaceId,
          departingWorkspaceId: pendingPresentationSwitch.departingWorkspaceId,
          clearVisibleState: true,
        })
        pendingWorkspacePresentationSwitchRef.current = null
      }
      logPerformanceDebug('workspace-session', 'failed to restore workspace session', {
        workspaceId,
        restoreSeq,
        durationMs: Math.round(performance.now() - restoreStartedAt),
        error: error instanceof Error ? error.message : String(error),
      })
      completeWorkspaceSwitch(workspaceId)
    })

    return () => {
      cancelled = true
      if (workspaceSessionRestoreSeqRef.current === restoreSeq) {
        logPerformanceDebug('workspace-session', 'cancelled workspace session restore', {
          workspaceId,
          restoreSeq,
          durationMs: Math.round(performance.now() - restoreStartedAt),
        })
      }
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
    captureActiveWorkspaceTerminalDocument,
    loadFileContentRef,
    stationsLoadedWorkspaceId,
    setActiveFilePath,
    setStationTerminals,
    applyWorkspacePresentationSwitch,
    completeWorkspaceSwitch,
    workspaceSessionFilePath,
  ])

  // Workspace session persist effect (debounced)
  useEffect(() => {
    if (!presentedWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }
    if (workspaceSessionHydratingRef.current) {
      return
    }

    const existingTimerId = workspaceSessionPersistTimerRef.current
    if (typeof existingTimerId === 'number') {
      window.clearTimeout(existingTimerId)
    }

    const workspaceId = presentedWorkspaceId
    workspaceSessionPersistTimerRef.current = window.setTimeout(() => {
      if (workspaceSessionHydratingRef.current || presentedWorkspaceIdRef.current !== workspaceId) {
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
    pinnedWorkbenchContainerId,
    presentedWorkspaceId,
    tabSessionSnapshotSignature,
    workbenchContainerSnapshotSignature,
    terminalSessionSnapshotSignature,
    workspaceSessionFilePath,
  ])

  // Station workspace ID sync effect
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

  return {
    // State
    presentedWorkspaceId,
    closeConfirmState,
    closeSubmitting,

    // Refs
    previousActiveWorkspaceIdRef,
    pendingWorkbenchContainerSnapshotsRef,

    // Terminal snapshot
    terminalSessionSnapshotEntries,
    terminalSessionSnapshotSignature,

    // Callbacks
    applyWorkspacePresentationSwitch,
    requestCloseWorkspace,
    confirmCloseWorkspace,
    dismissCloseConfirm,
    handleTearOffWorkspaceTab,
    handlePickWorkspaceDirectory,
  }
}
