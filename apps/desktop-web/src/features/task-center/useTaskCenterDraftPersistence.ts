import { useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AgentStation } from '@shell/layout/model'
import {
  buildTaskCenterStorageKey,
  buildTaskCenterWorkspaceSnapshot,
  createInitialTaskDraft,
  parseTaskCenterWorkspaceSnapshot,
  serializeTaskCenterWorkspaceSnapshot,
  type TaskAttachment,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
} from './task-center-model'

interface UseTaskCenterDraftPersistenceInput {
  activeWorkspaceId: string | null
  taskCenterDraftFilePath: string
  stationsRef: MutableRefObject<AgentStation[]>
  activeStationId: string
  taskDraft: TaskDraftState
  taskAttachments: TaskAttachment[]
  taskDispatchHistory: TaskDispatchRecord[]
  taskDispatchHistoryLimit: number
  persistDebounceMs: number
  setTaskDraft: Dispatch<SetStateAction<TaskDraftState>>
  setTaskAttachments: Dispatch<SetStateAction<TaskAttachment[]>>
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

export function useTaskCenterDraftPersistence({
  activeWorkspaceId,
  taskCenterDraftFilePath,
  stationsRef,
  activeStationId,
  taskDraft,
  taskAttachments,
  taskDispatchHistory,
  taskDispatchHistoryLimit,
  persistDebounceMs,
  setTaskDraft,
  setTaskAttachments,
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

  useEffect(() => {
    return () => {
      const timerId = taskPersistTimerRef.current
      if (typeof timerId === 'number') {
        window.clearTimeout(timerId)
      }
      taskPersistTimerRef.current = null
    }
  }, [])

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
      const defaultDraft = createInitialTaskDraft(stationsRef.current, activeStationId)
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
        setTaskDraft(snapshotFromStorage.draft)
        setTaskAttachments(snapshotFromStorage.attachments)
        setTaskDispatchHistory(
          snapshotFromStorage.dispatchHistory.slice(0, taskDispatchHistoryLimit),
        )
        setTaskDraftSavedAtMs(snapshotFromStorage.updatedAtMs)
      } else {
        setTaskDraft(defaultDraft)
        setTaskAttachments([])
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
    activeStationId,
    activeWorkspaceId,
    onReadTaskSnapshotFile,
    setTaskAttachments,
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
        attachments: taskAttachments,
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
    taskAttachments,
    taskCenterDraftFilePath,
    taskDispatchHistory,
    taskDispatchHistoryLimit,
    taskDraft,
  ])
}
