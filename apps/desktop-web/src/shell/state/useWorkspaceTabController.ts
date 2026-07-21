import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopApi } from '../integration/desktop-api'
import type { WorkspaceTabInfo } from './workspace-tab-model'
import { normalizeWorkspaceTabsResponse } from './workspace-tab-normalization'
import {
  resolveVisibleWorkspaceTabs,
  resolveWorkspaceAfterClose,
} from './workspace-tab-visibility'

function applyTabOrder(tabs: WorkspaceTabInfo[], order: string[]): WorkspaceTabInfo[] {
  if (order.length === 0) {
    return tabs
  }
  const tabMap = new Map(tabs.map((t) => [t.workspaceId, t]))
  const ordered: WorkspaceTabInfo[] = []
  const addedIds = new Set<string>()
  for (const id of order) {
    const tab = tabMap.get(id)
    if (tab) {
      ordered.push(tab)
      addedIds.add(id)
    }
  }
  for (const tab of tabs) {
    if (!addedIds.has(tab.workspaceId)) {
      ordered.push(tab)
    }
  }
  return ordered
}
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
  attachWorkspaceTab: (workspaceId: string) => void
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
    adoptActiveWorkspace,
    openWorkspaceAtPath,
  } = useShellWorkspaceController(workspaceWindowId)

  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabInfo[]>([])
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false)
  const [pendingWorkspaceSwitchId, setPendingWorkspaceSwitchId] = useState<string | null>(null)
  const [closingTabId, setClosingTabId] = useState<string | null>(null)
  const pendingWorkspaceSwitchIdRef = useRef<string | null>(null)
  const tabOrderRef = useRef<string[]>([])
  const workspaceListFetchSeqRef = useRef(0)
  const visibleTabs = useMemo(
    () =>
      resolveVisibleWorkspaceTabs({
        isSingleWorkspaceMode,
        workspaceWindowId,
        workspaceTabs,
        activeWorkspaceId,
        activeWorkspaceRoot,
      }),
    [
      activeWorkspaceId,
      activeWorkspaceRoot,
      isSingleWorkspaceMode,
      workspaceWindowId,
      workspaceTabs,
    ],
  )

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
        await adoptActiveWorkspace(response.activeWorkspaceId)
      } catch (error) {
        logPerformanceDebug('workspace-tabs', 'failed to switch tab', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        })
        completeWorkspaceSwitch(workspaceId)
      }
    },
    [activeWorkspaceId, adoptActiveWorkspace, beginWorkspaceSwitchAnimation, completeWorkspaceSwitch],
  )

  // --- Tab close ---

  const closeWorkspaceTab = useCallback(
    async (workspaceId: string) => {
      logPerformanceDebug('workspace-tabs', 'closing tab', { workspaceId })
      // Trigger closing animation
      setClosingTabId(workspaceId)
      try {
        const nextWorkspaceId = resolveWorkspaceAfterClose({
          tabs: visibleTabs,
          closedWorkspaceId: workspaceId,
          activeWorkspaceId,
        })
        const response = await desktopApi.workspaceClose(workspaceId, nextWorkspaceId)
        await adoptActiveWorkspace(response.activeWorkspaceId, workspaceId)
        // Wait for the CSS closing animation to complete before removing the tab
        await new Promise<void>((resolve) => setTimeout(resolve, 220))
        setWorkspaceTabs((prev) => prev.filter((t) => t.workspaceId !== workspaceId))
      } catch (error) {
        logPerformanceDebug('workspace-tabs', 'failed to close tab', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        setClosingTabId(null)
      }
    },
    [activeWorkspaceId, adoptActiveWorkspace, visibleTabs],
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

  const attachWorkspaceTab = useCallback((workspaceId: string) => {
    setWorkspaceTabs((prev) =>
      prev.map((t) =>
        t.workspaceId === workspaceId ? { ...t, detached: false, windowLabel: null } : t,
      ),
    )
  }, [])

  // --- Tab reorder ---

  const reorderWorkspaceTab = useCallback(
    (fromIndex: number, toIndex: number) => {
      setWorkspaceTabs((prev) => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        if (!moved) {
          return prev
        }
        next.splice(toIndex, 0, moved)
        tabOrderRef.current = next.map((t) => t.workspaceId)
        return next
      })
    },
    [],
  )

  const applyWorkspaceListResponse = useCallback((response: Awaited<ReturnType<typeof desktopApi.workspaceList>>) => {
    const tabs = normalizeWorkspaceTabsResponse(response)
    const ordered = applyTabOrder(tabs, tabOrderRef.current)
    tabOrderRef.current = ordered.map((t) => t.workspaceId)
    setWorkspaceTabs(ordered)
  }, [])

  const refreshTabs = useCallback(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    const fetchSeq = workspaceListFetchSeqRef.current + 1
    workspaceListFetchSeqRef.current = fetchSeq
    void desktopApi.workspaceList().then((response) => {
      if (workspaceListFetchSeqRef.current !== fetchSeq) {
        return
      }
      applyWorkspaceListResponse(response)
    })
  }, [applyWorkspaceListResponse])

  // --- Sync workspace list on mount ---

  useEffect(() => {
    refreshTabs()
  }, [refreshTabs])

  // --- Subscribe to workspace events ---

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) return

    let unlisten: (() => void) | null = null
    let unlistenWindowClosed: (() => void) | null = null

    void desktopApi
      .subscribeWorkspaceEvents({
        onUpdated: refreshTabs,
        onActiveChanged: refreshTabs,
      })
      .then((fn) => {
        unlisten = fn
      })

    void desktopApi
      .subscribeWorkspaceWindowClosed(refreshTabs)
      .then((fn) => {
        unlistenWindowClosed = fn
      })

    return () => {
      unlisten?.()
      unlistenWindowClosed?.()
    }
  }, [refreshTabs])

  // Re-sync when bootstrap binds a workspace before the first list fetch settles.
  useEffect(() => {
    if (!activeWorkspaceId || !desktopApi.isTauriRuntime()) {
      return
    }
    const anchorWorkspaceId = isSingleWorkspaceMode
      ? workspaceWindowId?.trim() || null
      : activeWorkspaceId
    if (!anchorWorkspaceId) {
      return
    }
    const hasAnchorTab = workspaceTabs.some((tab) => tab.workspaceId === anchorWorkspaceId)
    if (!hasAnchorTab) {
      refreshTabs()
    }
  }, [
    activeWorkspaceId,
    activeWorkspaceRoot,
    isSingleWorkspaceMode,
    refreshTabs,
    workspaceTabs,
    workspaceWindowId,
  ])

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
    attachWorkspaceTab,
    reorderWorkspaceTab,
  }
}
