import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  createDefaultFloatingFrame,
  normalizeWorkbenchContainerFrame,
  serializeWorkbenchContainers,
  type WorkbenchContainerModel,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from '@features/workspace-hub'
import {
  applyWorkbenchContainerCustomLayoutChange,
  applyWorkbenchContainerLayoutModeChange,
} from '@features/workspace-hub/workbench-container-layout-state'
import { desktopApi } from '../integration/desktop-api'
import {
  buildFloatingContainerId,
  normalizeCanvasCustomLayout,
} from './ShellRoot.shared'

interface UseShellWorkbenchControllerInput {
  workbenchContainers: WorkbenchContainerModel[]
  setWorkbenchContainers: Dispatch<SetStateAction<WorkbenchContainerModel[]>>
  workbenchContainersRef: MutableRefObject<WorkbenchContainerModel[]>
  workbenchContainerCounterRef: MutableRefObject<number>
  detachedWindowOpenInFlightRef: MutableRefObject<Record<string, boolean>>
  tauriRuntime: boolean
  canvasLayoutMode: WorkbenchLayoutMode
  canvasCustomLayout: WorkbenchCustomLayout
  setActiveStationId: Dispatch<SetStateAction<string>>
  launchStationTerminal: (stationId: string) => Promise<void>
  launchStationCliAgent: (stationId: string) => Promise<void>
  removeStation: (stationId: string) => Promise<void>
}

export interface ShellWorkbenchController {
  workbenchContainerSnapshotEntries: ReturnType<typeof serializeWorkbenchContainers>
  workbenchContainerSnapshotSignature: string
  handleCanvasSelectStation: (containerId: string, stationId: string) => void
  createWorkbenchContainer: () => void
  deleteWorkbenchContainer: (containerId: string) => void
  floatWorkbenchContainer: (containerId: string) => void
  dockWorkbenchContainer: (containerId: string) => void
  toggleWorkbenchContainerTopmost: (containerId: string) => void
  detachWorkbenchContainer: (containerId: string) => void
  reclaimDetachedContainer: (containerId: string) => void
  moveStationToWorkbenchContainer: (stationId: string, targetContainerId: string) => void
  moveFloatingWorkbenchContainer: (containerId: string, input: { x: number; y: number }) => void
  resizeFloatingWorkbenchContainer: (
    containerId: string,
    frame: { x: number; y: number; width: number; height: number },
  ) => void
  focusFloatingWorkbenchContainer: (containerId: string) => void
  handleCanvasLaunchStationTerminal: (stationId: string) => void
  handleCanvasLaunchCliAgent: (stationId: string) => void
  handleCanvasLayoutModeChange: (containerId: string, mode: WorkbenchLayoutMode) => void
  handleCanvasCustomLayoutChange: (containerId: string, layout: WorkbenchCustomLayout) => void
  handleCanvasRemoveStation: (stationId: string) => void
}

export function useShellWorkbenchController({
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
}: UseShellWorkbenchControllerInput): ShellWorkbenchController {
  const createNextWorkbenchContainerId = useCallback(() => {
    const existingIds = new Set(workbenchContainersRef.current.map((container) => container.id))
    let seed = workbenchContainerCounterRef.current
    let nextId = buildFloatingContainerId(seed)
    while (existingIds.has(nextId)) {
      seed += 1
      nextId = buildFloatingContainerId(seed)
    }
    workbenchContainerCounterRef.current = seed + 1
    return nextId
  }, [workbenchContainerCounterRef, workbenchContainersRef])

  const handleCanvasSelectStation = useCallback(
    (containerId: string, stationId: string) => {
      setActiveStationId(stationId)
      setWorkbenchContainers((prev) =>
        prev.map((container) =>
          container.id === containerId
            ? {
                ...container,
                activeStationId: stationId,
                lastActiveAtMs: Date.now(),
              }
            : container,
        ),
      )
    },
    [setActiveStationId, setWorkbenchContainers],
  )

  const createWorkbenchContainer = useCallback(() => {
    const nextId = createNextWorkbenchContainerId()
    setWorkbenchContainers((prev) => [
      ...prev,
      {
        id: nextId,
        stationIds: [],
        activeStationId: null,
        layoutMode: canvasLayoutMode,
        customLayout: canvasCustomLayout,
        mode: 'docked',
        resumeMode: 'docked',
        topmost: false,
        frame: null,
        detachedWindowLabel: null,
        lastActiveAtMs: Date.now(),
      } satisfies WorkbenchContainerModel,
    ])
  }, [canvasCustomLayout, canvasLayoutMode, createNextWorkbenchContainerId, setWorkbenchContainers])

  const deleteWorkbenchContainer = useCallback(
    (containerId: string) => {
      const currentContainer =
        workbenchContainersRef.current.find((container) => container.id === containerId) ?? null
      if (!currentContainer || currentContainer.stationIds.length > 0) {
        return
      }
      delete detachedWindowOpenInFlightRef.current[containerId]
      if (tauriRuntime && currentContainer.detachedWindowLabel) {
        void desktopApi.surfaceCloseWindow(currentContainer.detachedWindowLabel).catch(() => {
          // State is already removed locally; native window close stays best-effort.
        })
      }
      setWorkbenchContainers((prev) => prev.filter((container) => container.id !== containerId))
    },
    [detachedWindowOpenInFlightRef, setWorkbenchContainers, tauriRuntime, workbenchContainersRef],
  )

  const floatWorkbenchContainer = useCallback(
    (containerId: string) => {
      setWorkbenchContainers((prev) => {
        const floatingIndex = prev.filter((container) => container.mode === 'floating').length
        let changed = false
        const next = prev.map((container) => {
          if (container.id !== containerId) {
            return container
          }
          changed = true
          return {
            ...container,
            mode: 'floating',
            resumeMode: 'floating',
            topmost: true,
            frame:
              normalizeWorkbenchContainerFrame(container.frame) ??
              createDefaultFloatingFrame(floatingIndex),
            detachedWindowLabel: null,
            lastActiveAtMs: Date.now(),
          } satisfies WorkbenchContainerModel
        })
        return changed ? next : prev
      })
    },
    [setWorkbenchContainers],
  )

  const dockWorkbenchContainer = useCallback(
    (containerId: string) => {
      setWorkbenchContainers((prev) => {
        let changed = false
        const next = prev.map((container) => {
          if (container.id !== containerId) {
            return container
          }
          changed = true
          return {
            ...container,
            mode: 'docked',
            resumeMode: 'docked',
            topmost: false,
            frame: null,
            detachedWindowLabel: null,
            lastActiveAtMs: Date.now(),
          } satisfies WorkbenchContainerModel
        })
        return changed ? next : prev
      })
    },
    [setWorkbenchContainers],
  )

  const toggleWorkbenchContainerTopmost = useCallback(
    (containerId: string) => {
      const currentContainer =
        workbenchContainersRef.current.find((container) => container.id === containerId) ?? null
      if (
        !currentContainer ||
        (currentContainer.mode !== 'floating' && currentContainer.mode !== 'detached')
      ) {
        return
      }
      const nextTopmost = !currentContainer.topmost
      setWorkbenchContainers((prev) =>
        prev.map((container) =>
          container.id === containerId
            ? {
                ...container,
                topmost: nextTopmost,
                lastActiveAtMs: Date.now(),
              }
            : container,
        ),
      )
      if (
        tauriRuntime &&
        currentContainer.mode === 'detached' &&
        currentContainer.detachedWindowLabel
      ) {
        void desktopApi
          .surfaceSetWindowTopmost(currentContainer.detachedWindowLabel, nextTopmost)
          .then((response) => {
            setWorkbenchContainers((prev) =>
              prev.map((container) =>
                container.id === containerId
                  ? {
                      ...container,
                      topmost: response.topmost,
                    }
                  : container,
              ),
            )
          })
          .catch(() => {
            setWorkbenchContainers((prev) =>
              prev.map((container) =>
                container.id === containerId
                  ? {
                      ...container,
                      topmost: currentContainer.topmost,
                    }
                  : container,
              ),
            )
          })
      }
    },
    [setWorkbenchContainers, tauriRuntime, workbenchContainersRef],
  )

  const detachWorkbenchContainer = useCallback(
    (containerId: string) => {
      if (!tauriRuntime) {
        return
      }
      setWorkbenchContainers((prev) => {
        const floatingIndex = prev.filter((container) => container.mode === 'floating').length
        let changed = false
        const next = prev.map((container) => {
          if (container.id !== containerId) {
            return container
          }
          changed = true
          return {
            ...container,
            mode: 'detached',
            resumeMode:
              container.mode === 'floating'
                ? 'floating'
                : container.resumeMode === 'floating'
                  ? 'floating'
                  : 'docked',
            frame:
              normalizeWorkbenchContainerFrame(container.frame) ??
              createDefaultFloatingFrame(floatingIndex),
            detachedWindowLabel: null,
            lastActiveAtMs: Date.now(),
          } satisfies WorkbenchContainerModel
        })
        return changed ? next : prev
      })
    },
    [setWorkbenchContainers, tauriRuntime],
  )

  const reclaimDetachedContainer = useCallback(
    (containerId: string) => {
      const currentContainer =
        workbenchContainersRef.current.find((container) => container.id === containerId) ?? null
      if (!currentContainer) {
        return
      }
      if (tauriRuntime && currentContainer.detachedWindowLabel) {
        void desktopApi.surfaceCloseWindow(currentContainer.detachedWindowLabel).catch(() => {
          // Window close event will retry container recovery when possible.
        })
      }
      if (currentContainer.activeStationId) {
        setActiveStationId(currentContainer.activeStationId)
      }
      setWorkbenchContainers((prev) => {
        const floatingIndex = prev.filter((container) => container.mode === 'floating').length
        let changed = false
        const next = prev.map((container) => {
          if (container.id !== containerId) {
            return container
          }
          changed = true
          const restoreMode = container.resumeMode === 'floating' ? 'floating' : 'docked'
          return {
            ...container,
            mode: restoreMode,
            topmost: restoreMode === 'floating',
            frame:
              restoreMode === 'floating'
                ? normalizeWorkbenchContainerFrame(container.frame) ??
                  createDefaultFloatingFrame(floatingIndex)
                : null,
            detachedWindowLabel: null,
            lastActiveAtMs: Date.now(),
          } satisfies WorkbenchContainerModel
        })
        return changed ? next : prev
      })
    },
    [setActiveStationId, setWorkbenchContainers, tauriRuntime, workbenchContainersRef],
  )

  const moveStationToWorkbenchContainer = useCallback(
    (stationId: string, targetContainerId: string) => {
      setActiveStationId(stationId)
      setWorkbenchContainers((prev) => {
        const sourceIndex = prev.findIndex((container) => container.stationIds.includes(stationId))
        const targetIndex = prev.findIndex((container) => container.id === targetContainerId)
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
          return prev
        }
        const source = prev[sourceIndex]
        const target = prev[targetIndex]
        if (target.stationIds.includes(stationId)) {
          return prev
        }
        const now = Date.now()
        const next = [...prev]
        const remainingStationIds = source.stationIds.filter((id) => id !== stationId)
        next[sourceIndex] = {
          ...source,
          stationIds: remainingStationIds,
          activeStationId:
            source.activeStationId === stationId
              ? remainingStationIds[0] ?? null
              : source.activeStationId,
        }
        next[targetIndex] = {
          ...target,
          stationIds: [...target.stationIds, stationId],
          activeStationId: stationId,
          lastActiveAtMs: now,
        }
        return next
      })
    },
    [setActiveStationId, setWorkbenchContainers],
  )

  const moveFloatingWorkbenchContainer = useCallback(
    (containerId: string, input: { x: number; y: number }) => {
      setWorkbenchContainers((prev) =>
        prev.map((container) => {
          if (container.id !== containerId || container.mode !== 'floating') {
            return container
          }
          return {
            ...container,
            frame:
              normalizeWorkbenchContainerFrame({
                ...(container.frame ?? createDefaultFloatingFrame(0)),
                x: input.x,
                y: input.y,
              }) ?? createDefaultFloatingFrame(0),
            lastActiveAtMs: Date.now(),
          }
        }),
      )
    },
    [setWorkbenchContainers],
  )

  const resizeFloatingWorkbenchContainer = useCallback(
    (
      containerId: string,
      frame: { x: number; y: number; width: number; height: number },
    ) => {
      setWorkbenchContainers((prev) =>
        prev.map((container) => {
          if (container.id !== containerId || container.mode !== 'floating') {
            return container
          }
          return {
            ...container,
            frame: normalizeWorkbenchContainerFrame(frame) ?? createDefaultFloatingFrame(0),
            lastActiveAtMs: Date.now(),
          }
        }),
      )
    },
    [setWorkbenchContainers],
  )

  const focusFloatingWorkbenchContainer = useCallback(
    (containerId: string) => {
      setWorkbenchContainers((prev) =>
        prev.map((container) =>
          container.id === containerId && container.mode === 'floating'
            ? {
                ...container,
                lastActiveAtMs: Date.now(),
              }
            : container,
        ),
      )
    },
    [setWorkbenchContainers],
  )

  const handleCanvasLaunchStationTerminal = useCallback(
    (stationId: string) => {
      void launchStationTerminal(stationId)
    },
    [launchStationTerminal],
  )

  const handleCanvasLaunchCliAgent = useCallback(
    (stationId: string) => {
      void launchStationCliAgent(stationId)
    },
    [launchStationCliAgent],
  )

  const handleCanvasLayoutModeChange = useCallback(
    (containerId: string, mode: WorkbenchLayoutMode) => {
      // Layout toggles are container-local state. Updating canvas defaults here causes
      // unnecessary shell rerenders and can leak stale defaults back into container UX.
      setWorkbenchContainers((prev) => applyWorkbenchContainerLayoutModeChange(prev, containerId, mode))
    },
    [setWorkbenchContainers],
  )

  const handleCanvasCustomLayoutChange = useCallback(
    (containerId: string, layout: WorkbenchCustomLayout) => {
      const normalized = normalizeCanvasCustomLayout(layout)
      setWorkbenchContainers((prev) => applyWorkbenchContainerCustomLayoutChange(prev, containerId, normalized))
    },
    [setWorkbenchContainers],
  )

  const handleCanvasRemoveStation = useCallback(
    (stationId: string) => {
      void removeStation(stationId)
    },
    [removeStation],
  )

  const workbenchContainerSnapshotEntries = useMemo(
    () => serializeWorkbenchContainers(workbenchContainers),
    [workbenchContainers],
  )

  const workbenchContainerSnapshotSignature = useMemo(
    () => JSON.stringify(workbenchContainerSnapshotEntries),
    [workbenchContainerSnapshotEntries],
  )

  return {
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
  }
}
