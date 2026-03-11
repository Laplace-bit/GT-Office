import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AgentStation } from '@features/workspace-hub'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  buildDispatchRecord,
  buildMarkdownSnippet,
  extractTaskTitleFromMarkdown,
  pushTaskDispatchHistory,
  replaceTaskDispatchRecord,
  resolveValidTaskTargets,
  type StationTaskSignal,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
  type TaskMarkdownSnippet,
} from './task-center-model'

interface UseTaskDispatchActionsInput {
  locale: Locale
  activeWorkspaceId: string | null
  stationsRef: MutableRefObject<AgentStation[]>
  taskDraft: TaskDraftState
  taskDispatchHistory: TaskDispatchRecord[]
  taskSending: boolean
  taskRetryingTaskId: string | null
  setTaskDraft: Dispatch<SetStateAction<TaskDraftState>>
  setTaskDispatchHistory: Dispatch<SetStateAction<TaskDispatchRecord[]>>
  setTaskSending: Dispatch<SetStateAction<boolean>>
  setTaskRetryingTaskId: Dispatch<SetStateAction<string | null>>
  setTaskNotice: Dispatch<SetStateAction<TaskCenterNotice | null>>
  onEnsureTaskTargetRuntime: (input: {
    workspaceId: string
    targetStationId: string
  }) => Promise<void>
  onDispatchTaskBatch: (input: {
    workspaceId: string
    title: string
    markdown: string
    targetStationIds: string[]
  }) => Promise<{
    batchId: string
    results: Array<{
      targetAgentId: string
      taskId: string
      status: 'sent' | 'failed'
      detail?: string | null
      taskFilePath?: string | null
    }>
  }>
  onVerifyTaskFileReadable: (input: {
    workspaceId: string
    taskFilePath: string
  }) => Promise<void>
  onDeliverTaskToStation: (input: {
    station: AgentStation
    taskId: string
    taskFilePath: string
    title: string
    setStationTaskSignals: Dispatch<SetStateAction<Record<string, StationTaskSignal>>>
  }) => Promise<void>
  setStationTaskSignals: Dispatch<SetStateAction<Record<string, StationTaskSignal>>>
  describeError: (error: unknown) => string
  taskDispatchHistoryLimit: number
}

export interface TaskDispatchActions {
  updateTaskDraft: (patch: Partial<TaskDraftState>) => void
  insertTaskSnippet: (snippet: TaskMarkdownSnippet) => void
  dispatchTaskToAgent: () => Promise<void>
  retryTaskDispatch: (taskId: string) => Promise<void>
}

export function useTaskDispatchActions({
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
  onEnsureTaskTargetRuntime,
  onDispatchTaskBatch,
  onVerifyTaskFileReadable,
  onDeliverTaskToStation,
  setStationTaskSignals,
  describeError,
  taskDispatchHistoryLimit,
}: UseTaskDispatchActionsInput): TaskDispatchActions {
  const updateTaskDraft = useCallback(
    (patch: Partial<TaskDraftState>) => {
      setTaskDraft((prev) => ({ ...prev, ...patch }))
    },
    [setTaskDraft],
  )

  const insertTaskSnippet = useCallback(
    (snippet: TaskMarkdownSnippet) => {
      const block = buildMarkdownSnippet(snippet)
      setTaskDraft((prev) => ({
        ...prev,
        markdown: `${prev.markdown}${block}`,
      }))
    },
    [setTaskDraft],
  )

  const dispatchTaskToAgent = useCallback(async () => {
    if (taskSending || taskRetryingTaskId) {
      return
    }
    if (!activeWorkspaceId) {
      setTaskNotice({
        kind: 'error',
        message: t(locale, 'taskCenter.notice.workspaceRequired'),
      })
      return
    }
    if (!taskDraft.markdown.trim()) {
      setTaskNotice({
        kind: 'error',
        message: t(locale, 'taskCenter.notice.contentRequired'),
      })
      return
    }

    const targetStationIds = resolveValidTaskTargets(
      stationsRef.current,
      taskDraft.targetStationIds,
    )
    if (targetStationIds.length === 0) {
      setTaskNotice({
        kind: 'error',
        message: t(locale, 'taskCenter.notice.targetRequired'),
      })
      return
    }

    setTaskSending(true)
    setTaskNotice({
      kind: 'info',
      message: t(locale, 'taskCenter.notice.sending'),
    })

    const createdAtMs = Date.now()
    const normalizedTitle = extractTaskTitleFromMarkdown(taskDraft.markdown)

    try {
      await Promise.allSettled(
        targetStationIds.map((targetStationId) =>
          onEnsureTaskTargetRuntime({
            workspaceId: activeWorkspaceId,
            targetStationId,
          }),
        ),
      )

      const response = await onDispatchTaskBatch({
        workspaceId: activeWorkspaceId,
        title: normalizedTitle,
        markdown: taskDraft.markdown,
        targetStationIds,
      })

      let sentCount = 0
      let failedCount = 0
      setTaskDispatchHistory((prev) => {
        let next = prev
        response.results.forEach((result) => {
          if (result.status === 'sent') {
            sentCount += 1
          } else {
            failedCount += 1
          }
          const station = stationsRef.current.find(
            (item) => item.id === result.targetAgentId,
          )
          next = pushTaskDispatchHistory(
            next,
            buildDispatchRecord({
              batchId: response.batchId,
              taskId: result.taskId,
              title: normalizedTitle,
              targetStationId: result.targetAgentId,
              targetStationName: station?.name ?? result.targetAgentId,
              createdAtMs,
              status: result.status,
              taskFilePath: result.taskFilePath ?? '',
              detail: result.detail ?? undefined,
            }),
            taskDispatchHistoryLimit,
          )
        })
        return next
      })

      if (sentCount > 0) {
        setTaskDraft((prev) => ({
          ...prev,
          markdown: '',
          targetStationIds,
        }))
      }

      setTaskNotice({
        kind: failedCount > 0 ? 'error' : 'success',
        message: t(locale, 'taskCenter.notice.batchSummary', {
          sent: sentCount,
          failed: failedCount,
        }),
      })
    } catch (error) {
      const detail = describeError(error)
      setTaskNotice({
        kind: 'error',
        message: t(locale, 'taskCenter.notice.sendFailed', {
          detail,
        }),
      })
    } finally {
      setTaskSending(false)
    }
  }, [
    activeWorkspaceId,
    describeError,
    locale,
    onDispatchTaskBatch,
    onEnsureTaskTargetRuntime,
    setTaskDispatchHistory,
    setTaskDraft,
    setTaskNotice,
    setTaskSending,
    stationsRef,
    taskDispatchHistoryLimit,
    taskDraft.markdown,
    taskDraft.targetStationIds,
    taskRetryingTaskId,
    taskSending,
  ])

  const retryTaskDispatch = useCallback(
    async (taskId: string) => {
      if (taskSending || taskRetryingTaskId) {
        return
      }
      if (!activeWorkspaceId) {
        setTaskNotice({
          kind: 'error',
          message: t(locale, 'taskCenter.notice.workspaceRequired'),
        })
        return
      }
      const targetRecord = taskDispatchHistory.find((record) => record.taskId === taskId)
      if (!targetRecord || targetRecord.status !== 'failed') {
        return
      }
      const targetStation = stationsRef.current.find(
        (station) => station.id === targetRecord.targetStationId,
      )
      if (!targetStation) {
        setTaskNotice({
          kind: 'error',
          message: t(locale, 'taskCenter.notice.targetRequired'),
        })
        return
      }

      setTaskRetryingTaskId(taskId)
      setTaskNotice({
        kind: 'info',
        message: t(locale, 'taskCenter.notice.retrying'),
      })
      setTaskDispatchHistory((prev) =>
        replaceTaskDispatchRecord(prev, taskId, {
          status: 'sending',
          detail: undefined,
        }),
      )

      try {
        await onVerifyTaskFileReadable({
          workspaceId: activeWorkspaceId,
          taskFilePath: targetRecord.taskFilePath,
        })
        await onDeliverTaskToStation({
          station: targetStation,
          taskId: targetRecord.taskId,
          taskFilePath: targetRecord.taskFilePath,
          title: targetRecord.title,
          setStationTaskSignals,
        })
        setTaskDispatchHistory((prev) =>
          replaceTaskDispatchRecord(prev, taskId, {
            status: 'sent',
            detail: undefined,
          }),
        )
        setTaskNotice({
          kind: 'success',
          message: t(locale, 'taskCenter.notice.retrySuccess', {
            taskId: targetRecord.taskId,
          }),
        })
      } catch (error) {
        const detail = describeError(error)
        setTaskDispatchHistory((prev) =>
          replaceTaskDispatchRecord(prev, taskId, {
            status: 'failed',
            detail,
          }),
        )
        setTaskNotice({
          kind: 'error',
          message: t(locale, 'taskCenter.notice.retryFailed', {
            detail,
          }),
        })
      } finally {
        setTaskRetryingTaskId(null)
      }
    },
    [
      activeWorkspaceId,
      describeError,
      locale,
      onDeliverTaskToStation,
      onVerifyTaskFileReadable,
      setTaskDispatchHistory,
      setTaskNotice,
      setTaskRetryingTaskId,
      setStationTaskSignals,
      stationsRef,
      taskDispatchHistory,
      taskRetryingTaskId,
      taskSending,
    ],
  )

  return {
    updateTaskDraft,
    insertTaskSnippet,
    dispatchTaskToAgent,
    retryTaskDispatch,
  }
}
