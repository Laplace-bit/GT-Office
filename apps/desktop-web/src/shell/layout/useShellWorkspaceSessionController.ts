import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  serializeWorkbenchContainers,
  type AgentStation,
  type WorkbenchContainerModel,
  type WorkbenchContainerSnapshot,
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
import { disposeParkedStationTerminalHostsForWorkspace } from '@features/terminal/station-terminal-host-pool'
import { addNotification } from '@/stores/notification'
import { desktopApi } from '../integration/desktop-api'
import { pickDirectory } from '../integration/directory-picker'
import { t, type Locale } from '../i18n/ui-locale'
import type { NavItemId } from './navigation-model'
import type { UiPreferences } from '../state/ui-preferences'
import { reconcileWorkspaceTerminalRestoredSessions } from '../state/workspace-terminal-session-reconcile'
import {
  captureWorkspacePresentationCacheEntry,
  putWorkspacePresentationCacheEntry,
  removeWorkspacePresentationCacheEntry,
  resolveWorkbenchSnapshotsForStations,
  takeWorkspacePresentationCacheEntry,
  type WorkspacePresentationCache,
  type WorkspacePresentationCacheEntry,
} from '../state/workspace-presentation-cache'
import {
  WORKSPACE_SESSION_MAX_RESTORE_TABS,
  WORKSPACE_SESSION_PERSIST_DEBOUNCE_MS,
  buildDefaultWorkbenchContainerId,
  describeError,
  isNavItemId,
  normalizeFsPath,
  type FileReadMode,
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
  workspaceTabs: Array<{ workspaceId: string; name: string; root: string; windowLabel?: string | null }>
  beginWorkspaceSwitchAnimation: (workspaceId?: string | null) => boolean
  completeWorkspaceSwitch: (workspaceId?: string | null) => void
  closeWorkspaceTab: (workspaceId: string) => Promise<void>
  detachWorkspaceTab: (workspaceId: string, windowLabel: string) => void
  attachWorkspaceTab: (workspaceId: string) => void
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

const WORKSPACE_SWITCH_CONTENT_READY_TIMEOUT_MS = 180

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function waitForWorkspaceReveal(activeFileLoad: Promise<void> | null): Promise<void> {
  if (activeFileLoad) {
    await Promise.race([
      activeFileLoad.catch(() => {}),
      waitForTimeout(WORKSPACE_SWITCH_CONTENT_READY_TIMEOUT_MS),
    ])
  }
  await waitForNextPaint()
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
  handleMergeWorkspaceTab: (workspaceId: string, targetWindowLabel: string) => Promise<void>
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
  workbenchContainers: _workbenchContainers,
  setWorkbenchContainers,
  workbenchContainersRef,
  workbenchContainerCounterRef: _workbenchContainerCounterRef,
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
  const clearVisibleStateOnNextPresentationSwitchRef = useRef(false)
  const previousActiveWorkspaceIdRef = useRef<string | null>(null)
  const pendingWorkbenchContainerSnapshotsRef = useRef<WorkbenchContainerSnapshot[] | null>(null)
  const tabSessionSnapshotRef = useRef<Array<{ path: string; active: boolean }>>([])
  const workbenchContainerSnapshotRef = useRef<WorkbenchContainerSnapshot[]>([])
  const terminalSessionSnapshotRef = useRef<WorkspaceSessionTerminalSnapshot[]>([])
  const workspacePresentationCacheRef = useRef<WorkspacePresentationCache>({})
  const activeNavIdRef = useRef(activeNavId)
  const activeStationIdRef = useRef(activeStationId)
  const pinnedWorkbenchContainerIdRef = useRef(pinnedWorkbenchContainerId)

  const workspaceSessionFilePath = useMemo(() => buildWorkspaceSessionFilePath(), [])

  // Terminal controller destructure
  const {
    stationTerminals,
    stationTerminalOutputCacheRef,
    stationTerminalOutputRevisionRef,
    stationTerminalRestoreStateRef,
    sessionStationRef,
    workspaceTerminalCacheRef,
    presentedWorkspaceIdRef,
    resetTerminalStateOnWorkspaceSwitch,
    captureActiveWorkspaceTerminalDocument,
    resolveWorkspaceTerminalDocument,
    presentWorkspaceTerminalDocument,
    suspendWorkspaceTerminalSessions,
    recoverWorkspaceTerminalSessions,
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
          sessionId: runtime.sessionId,
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
            `${entry.stationId}:${entry.sessionId ?? ''}:${entry.shell ?? ''}:${entry.cwdMode}:${entry.resolvedCwd ?? ''}:${
              entry.active ? '1' : '0'
            }`,
        )
        .join('|'),
    [terminalSessionSnapshotEntries],
  )

  const buildTerminalSnapshotsForWorkspace = useCallback(
    (workspaceId: string): WorkspaceSessionTerminalSnapshot[] => {
      if (workspaceId === presentedWorkspaceIdRef.current) {
        return terminalSessionSnapshotRef.current
      }
      const cachedDocument = workspaceTerminalCacheRef.current[workspaceId]
      if (!cachedDocument) {
        return []
      }
      return Object.entries(cachedDocument.stationTerminals).reduce<WorkspaceSessionTerminalSnapshot[]>(
        (acc, [stationId, runtime]) => {
          if (!runtime?.sessionId) {
            return acc
          }
          acc.push({
            stationId,
            sessionId: runtime.sessionId,
            shell: runtime.shell,
            cwdMode: runtime.cwdMode,
            resolvedCwd: runtime.resolvedCwd,
            active: false,
          })
          return acc
        },
        [],
      )
    },
    [presentedWorkspaceIdRef, workspaceTerminalCacheRef],
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

  useEffect(() => {
    activeNavIdRef.current = activeNavId
  }, [activeNavId])

  useEffect(() => {
    activeStationIdRef.current = activeStationId
  }, [activeStationId])

  useEffect(() => {
    pinnedWorkbenchContainerIdRef.current = pinnedWorkbenchContainerId
  }, [pinnedWorkbenchContainerId])

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

  const captureWorkspacePresentation = useCallback((workspaceId: string | null | undefined) => {
    if (!workspaceId) {
      return null
    }
    // Serialize from the live container ref so maximize/fullscreen and other
    // view-state changes are captured even before the snapshot effect flushes.
    const liveWorkbenchSnapshots =
      workbenchContainersRef.current.length > 0
        ? serializeWorkbenchContainers(workbenchContainersRef.current)
        : workbenchContainerSnapshotRef.current
    const entry = captureWorkspacePresentationCacheEntry({
      workspaceId,
      workbenchContainers: liveWorkbenchSnapshots,
      pinnedWorkbenchContainerId: pinnedWorkbenchContainerIdRef.current,
      activeNavId: activeNavIdRef.current,
      activeStationId: activeStationIdRef.current,
    })
    putWorkspacePresentationCacheEntry(workspacePresentationCacheRef.current, entry)
    return entry
  }, [workbenchContainersRef])

  // Keep presentation cache warm for the presented workspace so maximize state is
  // available on the next switch without waiting for the debounced disk snapshot.
  // Use the current snapshot entries (not the ref) so fullscreen changes in this
  // render are frozen immediately.
  useLayoutEffect(() => {
    if (!presentedWorkspaceId) {
      return
    }
    if (presentedWorkspaceIdRef.current !== presentedWorkspaceId) {
      return
    }
    workbenchContainerSnapshotRef.current = workbenchContainerSnapshotEntries
    const entry = captureWorkspacePresentationCacheEntry({
      workspaceId: presentedWorkspaceId,
      workbenchContainers: workbenchContainerSnapshotEntries,
      pinnedWorkbenchContainerId: pinnedWorkbenchContainerIdRef.current,
      activeNavId: activeNavIdRef.current,
      activeStationId: activeStationIdRef.current,
    })
    putWorkspacePresentationCacheEntry(workspacePresentationCacheRef.current, entry)
  }, [
    activeNavId,
    activeStationId,
    pinnedWorkbenchContainerId,
    presentedWorkspaceId,
    workbenchContainerSnapshotEntries,
    workbenchContainerSnapshotSignature,
  ])

  const applyPresentationLayout = useCallback(
    (
      entry: WorkspacePresentationCacheEntry | null | undefined,
      stationsForPresentation: AgentStation[],
    ) => {
      if (!entry || stationsForPresentation.length === 0) {
        return false
      }
      const nextContainers = restoreWorkbenchContainers(
        entry.workbenchContainers,
        stationsForPresentation,
        buildDefaultWorkbenchContainerId,
      )
      setWorkbenchContainers(nextContainers)
      workbenchContainersRef.current = nextContainers
      pendingWorkbenchContainerSnapshotsRef.current = null

      const stationIdSet = new Set(stationsForPresentation.map((station) => station.id))
      const preferredActiveStationId =
        (entry.activeStationId && stationIdSet.has(entry.activeStationId)
          ? entry.activeStationId
          : null) ??
        nextContainers.find((container) => container.activeStationId)?.activeStationId ??
        stationsForPresentation[0]?.id ??
        ''
      if (preferredActiveStationId) {
        setActiveStationId(preferredActiveStationId)
        activeStationIdRef.current = preferredActiveStationId
      }

      if (isNavItemId(entry.activeNavId)) {
        setActiveNavId(entry.activeNavId)
        activeNavIdRef.current = entry.activeNavId
      }

      const pinnedId =
        entry.pinnedWorkbenchContainerId &&
        nextContainers.some(
          (container) =>
            container.id === entry.pinnedWorkbenchContainerId && container.mode === 'docked',
        )
          ? entry.pinnedWorkbenchContainerId
          : null
      setPinnedWorkbenchContainerId(pinnedId)
      pinnedWorkbenchContainerIdRef.current = pinnedId
      return true
    },
    [
      setActiveNavId,
      setActiveStationId,
      setPinnedWorkbenchContainerId,
      setWorkbenchContainers,
      workbenchContainersRef,
    ],
  )

  const rememberPresentationFromSessionSnapshot = useCallback(
    (
      workspaceId: string,
      snapshot: {
        windows: Array<{ activeNavId: string; pinnedWorkbenchContainerId: string | null }>
        workbenchContainers: WorkbenchContainerSnapshot[]
        terminals: WorkspaceSessionTerminalSnapshot[]
      },
    ) => {
      const activeTerminal = snapshot.terminals.find((terminal) => terminal.active)
      const entry = captureWorkspacePresentationCacheEntry({
        workspaceId,
        workbenchContainers: snapshot.workbenchContainers,
        pinnedWorkbenchContainerId: snapshot.windows[0]?.pinnedWorkbenchContainerId ?? null,
        activeNavId: isNavItemId(snapshot.windows[0]?.activeNavId)
          ? snapshot.windows[0].activeNavId
          : 'stations',
        activeStationId:
          activeTerminal?.stationId ??
          snapshot.workbenchContainers[0]?.activeStationId ??
          snapshot.terminals[0]?.stationId ??
          '',
      })
      putWorkspacePresentationCacheEntry(workspacePresentationCacheRef.current, entry)
    },
    [],
  )

  const applyWorkspacePresentationSwitch = useCallback((input: {
    activeWorkspaceId: string | null
    departingWorkspaceId: string | null
    clearVisibleState: boolean
  }) => {
    const resetStartedAt = performance.now()
    const { activeWorkspaceId: nextWorkspaceId, departingWorkspaceId, clearVisibleState } = input
    const presentedDepartingWorkspaceId =
      presentedWorkspaceIdRef.current && presentedWorkspaceIdRef.current !== nextWorkspaceId
        ? presentedWorkspaceIdRef.current
        : departingWorkspaceId
    if (presentedDepartingWorkspaceId && presentedDepartingWorkspaceId !== nextWorkspaceId) {
      // Freeze the departing workspace layout so switching back can paint final state.
      captureWorkspacePresentation(presentedDepartingWorkspaceId)
      suspendWorkspaceTerminalSessions(presentedDepartingWorkspaceId)
      logPerformanceDebug('workspace-switch', 'persisted presentation for departing workspace', {
        departingWorkspaceId: presentedDepartingWorkspaceId,
        sessionCount: Object.keys(sessionStationRef.current).length,
        hasPresentationCache: Boolean(
          takeWorkspacePresentationCacheEntry(
            workspacePresentationCacheRef.current,
            presentedDepartingWorkspaceId,
          ),
        ),
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
    detachedWindowOpenInFlightRef.current = {}

    const stationsForPresentation = stationsRef.current
    const cachedPresentation = nextWorkspaceId
      ? takeWorkspacePresentationCacheEntry(workspacePresentationCacheRef.current, nextWorkspaceId)
      : null

    // Flip presentation ref before installing terminal document / layout.
    presentedWorkspaceIdRef.current = nextWorkspaceId

    // Always drop the previous workspace's editor tabs when the presented
    // workspace changes. File contents restore asynchronously from the session
    // snapshot after layout is already correct.
    if (presentedDepartingWorkspaceId && presentedDepartingWorkspaceId !== nextWorkspaceId) {
      resetFileState()
    }

    if (clearVisibleState) {
      externalChannelController.clearStationTaskSignals()
      taskDispatchController.setTaskDraft(
        createInitialTaskDraft(stationsForPresentation, stationsForPresentation[0]?.id ?? ''),
      )
      if (!applyPresentationLayout(cachedPresentation, stationsForPresentation)) {
        setPinnedWorkbenchContainerId(null)
        pinnedWorkbenchContainerIdRef.current = null
        setWorkbenchContainers(
          createInitialWorkbenchContainers(stationsForPresentation, buildDefaultWorkbenchContainerId),
        )
        pendingWorkbenchContainerSnapshotsRef.current = null
      }
    } else if (cachedPresentation) {
      // Warm switch: install the last known layout in the same update as presentation.
      applyPresentationLayout(cachedPresentation, stationsForPresentation)
    } else {
      // Cold switch without cache: keep containers only if stations still match;
      // otherwise park a pending empty restore so the stations effect does not
      // reconcile the previous workspace layout onto the next stations list.
      pendingWorkbenchContainerSnapshotsRef.current = null
    }

    if (nextWorkspaceId && stationsForPresentation.length > 0) {
      const presentedDocument = presentWorkspaceTerminalDocument(
        nextWorkspaceId,
        stationsForPresentation,
      )
      if (presentedDocument && !cachedPresentation) {
        const stationIdSet = new Set(stationsForPresentation.map((station) => station.id))
        const preferredActiveStationId =
          (activeStationIdRef.current && stationIdSet.has(activeStationIdRef.current)
            ? activeStationIdRef.current
            : null) ??
          stationsForPresentation.find((station) =>
            Boolean(presentedDocument.stationTerminals[station.id]?.sessionId),
          )?.id ??
          stationsForPresentation[0]?.id ??
          ''
        if (preferredActiveStationId && preferredActiveStationId !== activeStationIdRef.current) {
          setActiveStationId(preferredActiveStationId)
          activeStationIdRef.current = preferredActiveStationId
        }
      }
    }
    setPresentedWorkspaceId(nextWorkspaceId)
    logPerformanceDebug('workspace-switch', 'workspace presentation switch applied', {
      activeWorkspaceId: nextWorkspaceId,
      clearVisibleState,
      usedPresentationCache: Boolean(cachedPresentation),
      durationMs: Math.round(performance.now() - resetStartedAt),
    })
  }, [
    applyPresentationLayout,
    captureWorkspacePresentation,
    externalChannelController.resetExternalChannelState,
    externalChannelController.clearStationTaskSignals,
    presentWorkspaceTerminalDocument,
    resetFileState,
    resetTerminalStateOnWorkspaceSwitch,
    setActiveStationId,
    setPinnedWorkbenchContainerId,
    setWorkbenchContainers,
    suspendWorkspaceTerminalSessions,
  ])

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
      if (presentedWorkspaceIdRef.current === workspaceId) {
        captureActiveWorkspaceTerminalDocument(workspaceId)
        captureWorkspacePresentation(workspaceId)
      }
      const cachedDoc = workspaceTerminalCacheRef.current[workspaceId]
      await closeWorkspaceTab(workspaceId)
      if (cachedDoc) {
        const runtimeStationIds = new Set(Object.values(cachedDoc.sessionStation))
        runtimeStationIds.forEach((stationId) => {
          desktopApi.agentRuntimeUnregister(workspaceId, stationId).catch(() => {})
        })
        delete workspaceTerminalCacheRef.current[workspaceId]
        const outputStationIds = Object.keys(cachedDoc.stationTerminals)
        for (const stationId of outputStationIds) {
          delete stationTerminalOutputCacheRef.current[stationId]
          delete stationTerminalOutputRevisionRef.current[stationId]
          delete stationTerminalRestoreStateRef.current[stationId]
        }
      }
      // Drop keep-alive xterm hosts and presentation cache for the closed workspace.
      disposeParkedStationTerminalHostsForWorkspace(workspaceId)
      removeWorkspacePresentationCacheEntry(workspacePresentationCacheRef.current, workspaceId)
      addNotification({
        type: 'success',
        message: t(
          uiPreferences.locale,
          'workspaceTab.closeSuccess',
          'workspaceTab.closeSuccess',
        ),
      })
    } catch {
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
  }, [
    captureActiveWorkspaceTerminalDocument,
    captureWorkspacePresentation,
    closeConfirmState,
    closeWorkspaceTab,
    uiPreferences.locale,
  ])

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
        if (desktopApi.isTauriRuntime()) {
          const snapshot = buildWorkspaceSessionSnapshot({
            updatedAtMs: Date.now(),
            windows: [{ activeNavId, pinnedWorkbenchContainerId }],
            tabs: tabSessionSnapshotRef.current,
            terminals: buildTerminalSnapshotsForWorkspace(workspaceId),
            workbenchContainers: workbenchContainerSnapshotRef.current,
          })
          await desktopApi.fsWriteFile(
            workspaceId,
            workspaceSessionFilePath,
            serializeWorkspaceSessionSnapshot(snapshot),
          )
        }
        const openResponse = await desktopApi.workspaceOpenInNewWindow(workspaceId, {
          x: Math.max(0, screenX - 220),
          y: Math.max(0, screenY - 18),
        })
        detachWorkspaceTab(workspaceId, openResponse.windowLabel)
        const fallbackTab =
          workspaceId === activeWorkspaceId
            ? workspaceTabs.find((tab) => tab.workspaceId !== workspaceId && !tab.windowLabel) ?? null
            : null
        if (fallbackTab) {
          clearVisibleStateOnNextPresentationSwitchRef.current = true
          await openWorkspaceAtPath(fallbackTab.root, 'restore')
        } else if (workspaceId === activeWorkspaceId) {
          clearVisibleStateOnNextPresentationSwitchRef.current = true
        }
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
    [
      activeNavId,
      activeWorkspaceId,
      buildTerminalSnapshotsForWorkspace,
      detachWorkspaceTab,
      openWorkspaceAtPath,
      pinnedWorkbenchContainerId,
      workspaceTabs,
      workspaceSessionFilePath,
    ],
  )

  const handleMergeWorkspaceTab = useCallback(
    async (workspaceId: string, _targetWindowLabel: string) => {
      attachWorkspaceTab(workspaceId)
      try {
        await desktopApi.windowClose()
      } catch (error) {
        logPerformanceDebug('workspace-tabs', 'failed to close detached workspace window during merge', {
          workspaceId,
          error: describeError(error),
        })
      }
    },
    [attachWorkspaceTab],
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

  // Workspace presentation switch effect — do not clear files/layout here.
  // Intermediate clears before the warm layout pass are the main cause of the
  // "wrong layout then correct layout" flash on workspace tab switches.
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
    const departingWorkspaceIsClosing =
      closeSubmitting && closeConfirmState?.workspaceId === departingWorkspaceId
    if (activeWorkspaceId && departingWorkspaceIsClosing) {
      applyWorkspacePresentationSwitch({
        activeWorkspaceId: null,
        departingWorkspaceId,
        clearVisibleState: true,
      })
      return
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
  }, [
    activeWorkspaceId,
    applyWorkspacePresentationSwitch,
    closeConfirmState?.workspaceId,
    closeSubmitting,
    completeWorkspaceSwitch,
  ])

  // Terminal document hydration effect — keep live session maps aligned after
  // async station reloads. Presentation switch already hydrates synchronously.
  useEffect(() => {
    if (!presentedWorkspaceId || activeWorkspaceId !== presentedWorkspaceId) {
      return
    }
    if (stationsLoadedWorkspaceId !== presentedWorkspaceId) {
      return
    }

    const stationIdSet = new Set(stations.map((station) => station.id))
    presentWorkspaceTerminalDocument(presentedWorkspaceId, stations)
    externalChannelController.pruneStationTaskSignals(stationIdSet)
    recoverWorkspaceTerminalSessions(presentedWorkspaceId)

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
    recoverWorkspaceTerminalSessions,
    externalChannelController.pruneStationTaskSignals,
    presentWorkspaceTerminalDocument,
    stationsLoadedWorkspaceId,
    stations,
    setActiveStationId,
  ])

  // Workbench container reconciliation — useLayoutEffect so a station inventory
  // swap never paints the previous workspace's layout for a frame.
  useLayoutEffect(() => {
    setWorkbenchContainers((prev) => {
      const pendingSnapshots = pendingWorkbenchContainerSnapshotsRef.current
      if (pendingSnapshots) {
        pendingWorkbenchContainerSnapshotsRef.current = null
        return restoreWorkbenchContainers(pendingSnapshots, stations, buildDefaultWorkbenchContainerId)
      }

      const stationIdSet = new Set(stations.map((station) => station.id))
      const previousStationCount = prev.reduce(
        (count, container) => count + container.stationIds.length,
        0,
      )
      const retainedStationCount = prev.reduce(
        (count, container) =>
          count + container.stationIds.filter((stationId) => stationIdSet.has(stationId)).length,
        0,
      )
      const looksLikeWorkspaceSwap = previousStationCount > 0 && retainedStationCount === 0
      const targetWorkspaceId =
        activeWorkspaceId && stationsLoadedWorkspaceId === activeWorkspaceId
          ? activeWorkspaceId
          : presentedWorkspaceIdRef.current &&
              stationsLoadedWorkspaceId === presentedWorkspaceIdRef.current
            ? presentedWorkspaceIdRef.current
            : null
      if (looksLikeWorkspaceSwap || previousStationCount === 0) {
        const cachedSnapshots = resolveWorkbenchSnapshotsForStations(
          workspacePresentationCacheRef.current,
          targetWorkspaceId,
          stations.map((station) => station.id),
        )
        if (cachedSnapshots) {
          return restoreWorkbenchContainers(
            cachedSnapshots,
            stations,
            buildDefaultWorkbenchContainerId,
          )
        }
      }
      return reconcileWorkbenchContainers(prev, stations, buildDefaultWorkbenchContainerId)
    })
  }, [activeWorkspaceId, stations, stationsLoadedWorkspaceId])

  // Warm presentation before paint: once stations for the target workspace are
  // ready and we have a cached presentation/terminal document, install the full
  // final UI in the same layout pass (layout + terminals + presented id).
  useLayoutEffect(() => {
    const pending = pendingWorkspacePresentationSwitchRef.current
    if (!pending?.targetWorkspaceId || !activeWorkspaceId) {
      return
    }
    if (pending.targetWorkspaceId !== activeWorkspaceId) {
      return
    }
    if (stationsLoadedWorkspaceId !== activeWorkspaceId) {
      return
    }
    if (stationsRef.current.length === 0) {
      return
    }
    const workspaceId = activeWorkspaceId
    const hasWarmPresentationCache = Boolean(
      takeWorkspacePresentationCacheEntry(workspacePresentationCacheRef.current, workspaceId) ||
        workspaceTerminalCacheRef.current[workspaceId],
    )
    if (!hasWarmPresentationCache) {
      return
    }
    if (presentedWorkspaceIdRef.current === workspaceId) {
      pendingWorkspacePresentationSwitchRef.current = null
      return
    }
    const clearVisibleState = clearVisibleStateOnNextPresentationSwitchRef.current
    clearVisibleStateOnNextPresentationSwitchRef.current = false
    applyWorkspacePresentationSwitch({
      activeWorkspaceId: workspaceId,
      departingWorkspaceId: pending.departingWorkspaceId,
      clearVisibleState,
    })
    pendingWorkspacePresentationSwitchRef.current = null
    recoverWorkspaceTerminalSessions(workspaceId)
    logPerformanceDebug('workspace-session', 'warm presentation applied in layout pass', {
      workspaceId,
      stationCount: stationsRef.current.length,
    })
  }, [
    activeWorkspaceId,
    applyWorkspacePresentationSwitch,
    recoverWorkspaceTerminalSessions,
    stations,
    stationsLoadedWorkspaceId,
  ])

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
        // Cold path presentation is applied after snapshot IPC below. Warm path
        // already presented in the layout effect before paint.
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
          const clearVisibleState = clearVisibleStateOnNextPresentationSwitchRef.current
          clearVisibleStateOnNextPresentationSwitchRef.current = false
          applyWorkspacePresentationSwitch({
            activeWorkspaceId: workspaceId,
            departingWorkspaceId: pendingPresentationSwitch.departingWorkspaceId,
            clearVisibleState,
          })
          pendingWorkspacePresentationSwitchRef.current = null
        }
        if (!restored) {
          completeWorkspaceSwitch(workspaceId)
          return
        }

        // Keep the in-memory presentation cache aligned with disk/session restore.
        rememberPresentationFromSessionSnapshot(workspaceId, restored)

        if (restored.terminals.length > 0 && stationsRef.current.length > 0) {
          const restoredSessionIds = Array.from(
            new Set(
              restored.terminals
                .map((terminal) => terminal.sessionId?.trim() ?? '')
                .filter((sessionId): sessionId is string => sessionId.length > 0),
            ),
          )
          const liveSessionIds = new Set(
            (
              await Promise.all(
                restoredSessionIds.map(async (sessionId) => {
                  try {
                    const response = await desktopApi.terminalHasSession(workspaceId, sessionId)
                    const isExpectedSession =
                      response.workspaceId === workspaceId &&
                      response.sessionId === sessionId &&
                      response.alive
                    return isExpectedSession ? sessionId : null
                  } catch {
                    return null
                  }
                }),
              )
            ).filter((sessionId): sessionId is string => Boolean(sessionId)),
          )
          const terminalDocument = resolveWorkspaceTerminalDocument(workspaceId, stationsRef.current)
          reconcileWorkspaceTerminalRestoredSessions(
            terminalDocument,
            restored.terminals,
            liveSessionIds,
          )
          workspaceTerminalCacheRef.current[workspaceId] = terminalDocument
          // Refresh the already-presented surface after live-session reconciliation.
          if (presentedWorkspaceIdRef.current === workspaceId) {
            presentWorkspaceTerminalDocument(workspaceId, stationsRef.current)
          }
        }

        // Apply layout from the restored snapshot. When warm presentation already
        // installed an identical cache entry this is a no-op-looking reapply and
        // avoids a later reconcile flash if containers were still stale.
        if (stationsRef.current.length > 0) {
          const presentationEntry = takeWorkspacePresentationCacheEntry(
            workspacePresentationCacheRef.current,
            workspaceId,
          )
          if (presentationEntry) {
            applyPresentationLayout(presentationEntry, stationsRef.current)
          } else {
            const nextContainers = restoreWorkbenchContainers(
              restored.workbenchContainers,
              stationsRef.current,
              buildDefaultWorkbenchContainerId,
            )
            setWorkbenchContainers(nextContainers)
            workbenchContainersRef.current = nextContainers
            pendingWorkbenchContainerSnapshotsRef.current = null
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
          }
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
            mtimeMs: 0,
          })),
        )
        setActiveFilePath(activeTabPath)
        const activeFileLoad = activeTabPath ? loadFileContentRef.current(activeTabPath, 'full') : null

        if (shouldAnimateWorkspaceSwitch) {
          await waitForWorkspaceReveal(activeFileLoad)
          if (
            cancelled ||
            workspaceSessionRestoreSeqRef.current !== restoreSeq ||
            activeWorkspaceIdRef.current !== workspaceId
          ) {
            completeWorkspaceSwitch(workspaceId)
            return
          }
          completeWorkspaceSwitch(workspaceId)
        } else {
          if (activeFileLoad) {
            void activeFileLoad.catch(() => {})
          }
          completeWorkspaceSwitch(workspaceId)
        }

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
        clearVisibleStateOnNextPresentationSwitchRef.current = false
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
    applyPresentationLayout,
    applyWorkspacePresentationSwitch,
    beginWorkspaceSwitchAnimation,
    completeWorkspaceSwitch,
    loadFileContentRef,
    presentWorkspaceTerminalDocument,
    recoverWorkspaceTerminalSessions,
    rememberPresentationFromSessionSnapshot,
    resolveWorkspaceTerminalDocument,
    setActiveFilePath,
    setActiveNavId,
    setOpenedFiles,
    setPinnedWorkbenchContainerId,
    setWorkbenchContainers,
    workbenchContainersRef,
    stationsLoadedWorkspaceId,
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
      // Keep warm-switch presentation cache current without waiting for disk IO.
      rememberPresentationFromSessionSnapshot(workspaceId, snapshot)
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
    rememberPresentationFromSessionSnapshot,
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
    if (desktopApi.isTauriRuntime() && stationsLoadedWorkspaceId !== activeWorkspaceId) {
      return
    }
    setStations((prev) =>
      prev.map((station) =>
        station.workspaceId === activeWorkspaceId
          ? station
          : { ...station, workspaceId: activeWorkspaceId },
      ),
    )
  }, [activeWorkspaceId, stationsLoadedWorkspaceId, setStations])

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
    handleMergeWorkspaceTab,
    handlePickWorkspaceDirectory,
  }
}
