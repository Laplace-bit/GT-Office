import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopApi } from '../integration/desktop-api'
import type { WorkspaceTabInfo } from './workspace-tab-model'
import { logPerformanceDebug } from './performance-debug'
import { useShellWorkspaceController } from '../layout/useShellWorkspaceController'

export interface UseWorkspaceTabControllerResult {
  workspacePathInput: string
  setWorkspacePathInput: React.Dispatch<React.SetStateAction<string>>
  activeWorkspaceId: string | null
  activeWorkspaceRoot: string | null
  setActiveWorkspaceRoot: React.Dispatch<React.SetStateAction<string | null>>
  connectionState: ReturnType<typeof useShellWorkspaceController>['connectionState']
  gitSummary: ReturnType<typeof useShellWorkspaceController>['gitSummary']
  refreshGit: ReturnType<typeof useShellWorkspaceController>['refreshGit']
  workspaceTabs: WorkspaceTabInfo[]
  workspaceSwitching: boolean
  pendingWorkspaceSwitchId: string | null
  closingTabId: string | null
  openWorkspaceAtPath: ReturnType<typeof useShellWorkspaceController>['openWorkspaceAtPath']
  switchWorkspaceTab: (workspaceId: string) => Promise<void>
  beginWorkspaceSwitchAnimation: (workspaceId?: string | null) => boolean
  completeWorkspaceSwitch: (workspaceId?: string | null) => void
  closeWorkspaceTab: (workspaceId: string) => Promise<void>
  detachWorkspaceTab: (workspaceId: string, windowLabel: string) => void
  reorderWorkspaceTab: (fromIndex: number, toIndex: number) => void
}

export function useWorkspaceTabController(
  workspaceWindowId?: string,
): UseWorkspaceTabControllerResult {
  const isSingleWorkspaceMode = !!workspaceWindowId
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

  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabInfo[]>([])
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false)
  const [pendingWorkspaceSwitchId, setPendingWorkspaceSwitchId] = useState<string | null>(null)
  const [closingTabId, setClosingTabId] = useState<string | null>(null)
  const pendingWorkspaceSwitchIdRef = useRef<string | null>(null)

  const beginWorkspaceSwitchAnimation = useCallback((workspaceId?: string | null) => {
    if (workspaceId && pendingWorkspaceSwitchIdRef.current !== workspaceId) {
      return false
    }
    if (!pendingWorkspaceSwitchIdRef.current) {
      return false
    }
    setWorkspaceSwitching(true)
    return true
  }, [])

  const completeWorkspaceSwitch = useCallback((workspaceId?: string | null) => {
    if (workspaceId && pendingWorkspaceSwitchIdRef.current !== workspaceId) {
      return
    }
    pendingWorkspaceSwitchIdRef.current = null
    setPendingWorkspaceSwitchId(null)
    setWorkspaceSwitching(false)
  }, [])

  // --- Tab switching ---

  const switchWorkspaceTab = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === activeWorkspaceId) return
      logPerformanceDebug('workspace-tabs', 'switching tab', { workspaceId })
      pendingWorkspaceSwitchIdRef.current = workspaceId
      setPendingWorkspaceSwitchId(workspaceId)
      beginWorkspaceSwitchAnimation(workspaceId)
      try {
        const response = await desktopApi.workspaceSwitchActive(workspaceId)
        const tab = workspaceTabs.find((t) => t.workspaceId === response.activeWorkspaceId)
        if (tab) {
          void openWorkspaceAtPath(tab.root, 'restore')
        }
      } catch (error) {
        logPerformanceDebug('workspace-tabs', 'failed to switch tab', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        })
        completeWorkspaceSwitch(workspaceId)
      }
    },
    [activeWorkspaceId, beginWorkspaceSwitchAnimation, completeWorkspaceSwitch, workspaceTabs, openWorkspaceAtPath],
  )

  // --- Tab close ---

  const closeWorkspaceTab = useCallback(
    async (workspaceId: string) => {
      logPerformanceDebug('workspace-tabs', 'closing tab', { workspaceId })
      // Trigger closing animation
      setClosingTabId(workspaceId)
      try {
        await desktopApi.workspaceClose(workspaceId)
        // Wait for the CSS closing animation to complete before removing the tab
        await new Promise<void>((resolve) => setTimeout(resolve, 220))
        setWorkspaceTabs((prev) => prev.filter((t) => t.workspaceId !== workspaceId))
      } catch (error) {
        logPerformanceDebug('workspace-tabs', 'failed to close tab', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setClosingTabId(null)
      }
    },
    [],
  )

  // --- Tab detach (tear-off into new window) ---

  const detachWorkspaceTab = useCallback(
    (workspaceId: string, windowLabel: string) => {
      setWorkspaceTabs((prev) =>
        prev.map((t) =>
          t.workspaceId === workspaceId ? { ...t, detached: true, windowLabel } : t,
        ),
      )
    },
    [],
  )

  // --- Tab reorder ---

  const reorderWorkspaceTab = useCallback(
    (fromIndex: number, toIndex: number) => {
      setWorkspaceTabs((prev) => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
    },
    [],
  )

  // --- Sync workspace list on mount ---

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) return

    let cancelled = false
    void desktopApi.workspaceList().then((response) => {
      if (cancelled) return
      const tabs: WorkspaceTabInfo[] = response.workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        name: w.name,
        root: w.root,
        active: w.active,
      }))
      setWorkspaceTabs(tabs)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // --- Subscribe to workspace events ---

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) return

    let unlisten: (() => void) | null = null
    let unlistenWindowClosed: (() => void) | null = null

    void desktopApi
      .subscribeWorkspaceEvents({
        onUpdated: () => {
          void desktopApi.workspaceList().then((response) => {
            const tabs: WorkspaceTabInfo[] = response.workspaces.map((w) => ({
              workspaceId: w.workspaceId,
              name: w.name,
              root: w.root,
              active: w.active,
            }))
            setWorkspaceTabs(tabs)
          })
        },
        onActiveChanged: () => {
          void desktopApi.workspaceList().then((response) => {
            const tabs: WorkspaceTabInfo[] = response.workspaces.map((w) => ({
              workspaceId: w.workspaceId,
              name: w.name,
              root: w.root,
              active: w.active,
            }))
            setWorkspaceTabs(tabs)
          })
        },
      })
      .then((fn) => {
        unlisten = fn
      })

    void desktopApi
      .subscribeWorkspaceWindowClosed((payload) => {
        setWorkspaceTabs((prev) => prev.filter((t) => t.windowLabel !== payload.windowLabel))
      })
      .then((fn) => {
        unlistenWindowClosed = fn
      })

    return () => {
      unlisten?.()
      unlistenWindowClosed?.()
    }
  }, [])

  // --- Filter tabs in single-workspace mode ---

  const visibleTabs = useMemo(
    () =>
      isSingleWorkspaceMode
        ? workspaceTabs.filter((t) => t.workspaceId === workspaceWindowId)
        : workspaceTabs,
    [isSingleWorkspaceMode, workspaceWindowId, workspaceTabs],
  )

  return {
    workspacePathInput,
    setWorkspacePathInput,
    activeWorkspaceId,
    activeWorkspaceRoot,
    setActiveWorkspaceRoot,
    connectionState,
    gitSummary,
    refreshGit,
    workspaceTabs: visibleTabs,
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
  }
}
