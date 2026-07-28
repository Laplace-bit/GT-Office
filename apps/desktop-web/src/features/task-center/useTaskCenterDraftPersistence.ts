import { useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AgentStation } from '@features/workspace-hub'
import {
  buildTaskCenterStorageKey,
  buildTaskCenterWorkspaceSnapshot,
  createInitialTaskDraft,
  parseTaskCenterWorkspaceSnapshot,
  serializeTaskCenterWorkspaceSnapshot,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
} from './task-center-model'
import {
  parseQuickDispatchRailPrefs,
  QUICK_DISPATCH_RAIL_STORAGE_KEY,
  resolveTaskTargetIdsForDispatch,
} from './global-task-dispatch-rail-state'

interface UseTaskCenterDraftPersistenceInput {
  activeWorkspaceId: string | null
  taskCenterDraftFilePath: string
  stationsRef: MutableRefObject<AgentStation[]>
  activeStationId: string
  taskDraft: TaskDraftState
  taskDispatchHistory: TaskDispatchRecord[]
  taskDispatchHistoryLimit: number
  persistDebounceMs: number
  setTaskDraft: Dispatch<SetStateAction<TaskDraftState>>
  setTaskDispatchHistory: Dispatch<SetStateAction<TaskDispatchRecord[]>>
  setTaskSending: Dispatch<SetStateAction<boolean>>
  setTaskRetryingTaskId: Dispatch<SetStateAction<string | null>>
  setTaskDraftSavedAtMs: Dispatch<SetStateAction<number | null>>
  setTaskNotice: Dispatch<SetStateAction<TaskCenterNotice | null>>
  onReadTaskSnapshotFile: (input: {
    workspaceId: string
    taskCenterDraftFilePath: string
  }) => Promise<string | null>
  onWriteTaskSnapshotFile: (input: {
    workspaceId: string
    taskCenterDraftFilePath: string
    serializedSnapshot: string
  }) => Promise<void>
}

function readFollowActiveAgentPref(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  try {
    return parseQuickDispatchRailPrefs(
      window.localStorage.getItem(QUICK_DISPATCH_RAIL_STORAGE_KEY),
    ).followActiveAgent
  } catch {
    return true
  }
}

function applyFollowActiveAgentToDraft(
  draft: TaskDraftState,
  stations: AgentStation[],
  activeStationId: string,
): TaskDraftState {
  if (!readFollowActiveAgentPref()) {
    return draft
  }
  const targetStationIds = resolveTaskTargetIdsForDispatch({
    stations,
    activeStationId,
    currentTargetIds: draft.targetStationIds,
    followActiveAgent: true,
  })
  if (
    targetStationIds.length === draft.targetStationIds.length &&
    targetStationIds.every((id, index) => id === draft.targetStationIds[index])
  ) {
    return draft
  }
  return {
    ...draft,
    targetStationIds,
  }
}

export function useTaskCenterDraftPersistence({
  activeWorkspaceId,
  taskCenterDraftFilePath,
  stationsRef,
  activeStationId,
  taskDraft,
  taskDispatchHistory,
  taskDispatchHistoryLimit,
  persistDebounceMs,
  setTaskDraft,
  setTaskDispatchHistory,
  setTaskSending,
  setTaskRetryingTaskId,
  setTaskDraftSavedAtMs,
  setTaskNotice,
  onReadTaskSnapshotFile,
  onWriteTaskSnapshotFile,
}: UseTaskCenterDraftPersistenceInput): void {
  const taskPersistTimerRef = useRef<number | null>(null)
  const taskSnapshotHydratingRef = useRef(false)
  const activeStationIdRef = useRef(activeStationId)

  useEffect(() => {
    activeStationIdRef.current = activeStationId
  }, [activeStationId])

  useEffect(() => {
    return () => {
      const timerId = taskPersistTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      taskPersistTimerRef.current = null
    }
  }, [])

  // Rehydrate only when the workspace changes — not when the active station changes.
  // Rehydrating on activeStationId used to overwrite follow-active target updates.
  useEffect(() => {
    if (!activeWorkspaceId) {
      taskSnapshotHydratingRef.current = false
      return
    }

    taskSnapshotHydratingRef.current = true
    if (typeof taskPersistTimerRef.current === 'number') {
      window.clearTimeout(taskPersistTimerRef.current)
      taskPersistTimerRef.current = null
    }

    let cancelled = false
    const hydrateTaskCenter = async () => {
      const stations = stationsRef.current
      const currentActiveStationId = activeStationIdRef.current
      const defaultDraft = createInitialTaskDraft(stations, currentActiveStationId)
      const storageKey = buildTaskCenterStorageKey(activeWorkspaceId)
      let snapshotFromStorage = null

      try {
        if (typeof window !== 'undefined') {
          const raw = window.localStorage.getItem(storageKey)
          if (raw) {
            snapshotFromStorage = parseTaskCenterWorkspaceSnapshot(raw)
          }
        }
      } catch {
        snapshotFromStorage = null
      }

      const rawFileSnapshot = await onReadTaskSnapshotFile({
        workspaceId: activeWorkspaceId,
        taskCenterDraftFilePath,
      })
      if (rawFileSnapshot && rawFileSnapshot.trim()) {
        const parsed = parseTaskCenterWorkspaceSnapshot(rawFileSnapshot)
        if (
          parsed &&
          (!snapshotFromStorage || parsed.updatedAtMs > snapshotFromStorage.updatedAtMs)
        ) {
          snapshotFromStorage = parsed
        }
      }

      if (cancelled) {
        return
      }

      if (snapshotFromStorage) {
        setTaskDraft(
          applyFollowActiveAgentToDraft(
            snapshotFromStorage.draft,
            stations,
            activeStationIdRef.current,
          ),
        )
        setTaskDispatchHistory(
          snapshotFromStorage.dispatchHistory.slice(0, taskDispatchHistoryLimit),
        )
        setTaskDraftSavedAtMs(snapshotFromStorage.updatedAtMs)
      } else {
        setTaskDraft(
          applyFollowActiveAgentToDraft(defaultDraft, stations, activeStationIdRef.current),
        )
        setTaskDispatchHistory([])
        setTaskDraftSavedAtMs(null)
      }
      setTaskSending(false)
      setTaskRetryingTaskId(null)
      setTaskNotice(null)
      taskSnapshotHydratingRef.current = false
    }

    void hydrateTaskCenter().catch(() => {
      taskSnapshotHydratingRef.current = false
    })

    return () => {
      cancelled = true
    }
  }, [
    activeWorkspaceId,
    onReadTaskSnapshotFile,
    setTaskDispatchHistory,
    setTaskDraft,
    setTaskDraftSavedAtMs,
    setTaskNotice,
    setTaskRetryingTaskId,
    setTaskSending,
    stationsRef,
    taskCenterDraftFilePath,
    taskDispatchHistoryLimit,
  ])

  useEffect(() => {
    if (!activeWorkspaceId || taskSnapshotHydratingRef.current) {
      return
    }

    if (typeof taskPersistTimerRef.current === 'number') {
      window.clearTimeout(taskPersistTimerRef.current)
    }

    const workspaceId = activeWorkspaceId
    taskPersistTimerRef.current = window.setTimeout(() => {
      const snapshot = buildTaskCenterWorkspaceSnapshot({
        updatedAtMs: Date.now(),
        draft: taskDraft,
        dispatchHistory: taskDispatchHistory.slice(0, taskDispatchHistoryLimit),
      })
      const serialized = serializeTaskCenterWorkspaceSnapshot(snapshot)

      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(buildTaskCenterStorageKey(workspaceId), serialized)
        }
      } catch {
        // Ignore local storage quota/runtime errors.
      }

      void onWriteTaskSnapshotFile({
        workspaceId,
        taskCenterDraftFilePath,
        serializedSnapshot: serialized,
      }).catch(() => {
        // Keep local snapshot as fallback when fs persistence fails.
      })
      setTaskDraftSavedAtMs(snapshot.updatedAtMs)
      taskPersistTimerRef.current = null
    }, persistDebounceMs)

    return () => {
      const timerId = taskPersistTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      taskPersistTimerRef.current = null
    }
  }, [
    activeWorkspaceId,
    onWriteTaskSnapshotFile,
    persistDebounceMs,
    setTaskDraftSavedAtMs,
    taskCenterDraftFilePath,
    taskDispatchHistory,
    taskDispatchHistoryLimit,
    taskDraft,
  ])
}
