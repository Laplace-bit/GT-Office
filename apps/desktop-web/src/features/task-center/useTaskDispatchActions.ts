import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AgentStation } from '@shell/layout/model'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  buildAttachmentReferenceMarkdown,
  buildDispatchRecord,
  buildMarkdownSnippet,
  buildTaskDocument,
  buildTaskId,
  createTaskAttachment,
  pushTaskDispatchHistory,
  replaceTaskDispatchRecord,
  resolveValidTaskTarget,
  type StationTaskSignal,
  type TaskAttachment,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
  type TaskMarkdownSnippet,
} from './task-center-model'

interface UseTaskDispatchActionsInput {
  locale: Locale
  activeWorkspaceId: string | null
  activeStationId: string
  stationsRef: MutableRefObject<AgentStation[]>
  taskDraft: TaskDraftState
  taskAttachments: TaskAttachment[]
  taskDispatchHistory: TaskDispatchRecord[]
  taskSending: boolean
  taskRetryingTaskId: string | null
  setTaskDraft: Dispatch<SetStateAction<TaskDraftState>>
  setTaskAttachments: Dispatch<SetStateAction<TaskAttachment[]>>
  setTaskDispatchHistory: Dispatch<SetStateAction<TaskDispatchRecord[]>>
  setTaskSending: Dispatch<SetStateAction<boolean>>
  setTaskRetryingTaskId: Dispatch<SetStateAction<string | null>>
  setTaskNotice: Dispatch<SetStateAction<TaskCenterNotice | null>>
  onPersistTaskDocument: (input: {
    workspaceId: string
    taskFilePath: string
    manifestPath: string
    markdownContent: string
    manifestContent: string
  }) => Promise<void>
  onVerifyTaskFileReadable: (input: { workspaceId: string; taskFilePath: string }) => Promise<void>
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
  addTaskAttachmentByPath: (rawPath: string) => void
  addTaskAttachmentFromInput: () => void
  removeTaskAttachment: (attachmentId: string) => void
  insertTaskAttachmentReference: (attachmentId: string) => void
  insertTaskSnippet: (snippet: TaskMarkdownSnippet) => void
  dispatchTaskToAgent: () => Promise<void>
  retryTaskDispatch: (taskId: string) => Promise<void>
}

export function useTaskDispatchActions({
  locale,
  activeWorkspaceId,
  activeStationId,
  stationsRef,
  taskDraft,
  taskAttachments,
  taskDispatchHistory,
  taskSending,
  taskRetryingTaskId,
  setTaskDraft,
  setTaskAttachments,
  setTaskDispatchHistory,
  setTaskSending,
  setTaskRetryingTaskId,
  setTaskNotice,
  onPersistTaskDocument,
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

  const addTaskAttachmentByPath = useCallback(
    (rawPath: string) => {
      const attachment = createTaskAttachment(rawPath)
      if (!attachment) {
        setTaskNotice({
          kind: 'error',
          message: t(locale, 'taskCenter.notice.attachmentInvalid'),
        })
        return
      }
      setTaskAttachments((prev) => {
        if (prev.some((item) => item.path === attachment.path)) {
          setTaskNotice({
            kind: 'info',
            message: t(locale, 'taskCenter.notice.attachmentExists'),
          })
          return prev
        }
        setTaskNotice({
          kind: 'success',
          message: t(locale, 'taskCenter.notice.attachmentAdded', { name: attachment.name }),
        })
        return [...prev, attachment]
      })
      setTaskDraft((prev) => ({ ...prev, attachmentInput: '' }))
    },
    [locale, setTaskAttachments, setTaskDraft, setTaskNotice],
  )

  const addTaskAttachmentFromInput = useCallback(() => {
    addTaskAttachmentByPath(taskDraft.attachmentInput)
  }, [addTaskAttachmentByPath, taskDraft.attachmentInput])

  const removeTaskAttachment = useCallback(
    (attachmentId: string) => {
      setTaskAttachments((prev) => prev.filter((item) => item.id !== attachmentId))
    },
    [setTaskAttachments],
  )

  const insertTaskAttachmentReference = useCallback(
    (attachmentId: string) => {
      const attachment = taskAttachments.find((item) => item.id === attachmentId)
      if (!attachment) {
        return
      }
      const reference = buildAttachmentReferenceMarkdown(attachment)
      setTaskDraft((prev) => ({
        ...prev,
        markdown: `${prev.markdown}${prev.markdown ? '\n' : ''}${reference}`,
      }))
    },
    [setTaskDraft, taskAttachments],
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
    const targetStationId = resolveValidTaskTarget(
      stationsRef.current,
      taskDraft.targetStationId,
      activeStationId,
    )
    const targetStation = stationsRef.current.find((station) => station.id === targetStationId)
    if (!targetStation) {
      setTaskNotice({
        kind: 'error',
        message: t(locale, 'taskCenter.notice.targetRequired'),
      })
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

    const createdAt = new Date()
    const taskId = buildTaskId(createdAt)
    const document = buildTaskDocument({
      taskId,
      draft: taskDraft,
      targetStation,
      attachments: taskAttachments,
      createdAt,
    })

    setTaskDispatchHistory((prev) =>
      pushTaskDispatchHistory(
        prev,
        buildDispatchRecord({
          taskId,
          title: document.title,
          targetStation,
          attachmentCount: taskAttachments.length,
          createdAtMs: createdAt.getTime(),
          status: 'sending',
          taskFilePath: document.taskFilePath,
        }),
        taskDispatchHistoryLimit,
      ),
    )
    setTaskSending(true)
    setTaskNotice({
      kind: 'info',
      message: t(locale, 'taskCenter.notice.sending'),
    })

    try {
      await onPersistTaskDocument({
        workspaceId: activeWorkspaceId,
        taskFilePath: document.taskFilePath,
        manifestPath: document.manifestPath,
        markdownContent: document.markdownContent,
        manifestContent: document.manifestContent,
      })
      await onDeliverTaskToStation({
        station: targetStation,
        taskId,
        taskFilePath: document.taskFilePath,
        title: document.title,
        setStationTaskSignals,
      })
      setTaskDispatchHistory((prev) =>
        replaceTaskDispatchRecord(prev, taskId, {
          status: 'sent',
          detail: undefined,
        }),
      )
      setTaskDraft((prev) => ({
        ...prev,
        title: '',
        markdown: '',
        attachmentInput: '',
        targetStationId,
      }))
      setTaskAttachments([])
      setTaskNotice({
        kind: 'success',
        message: t(locale, 'taskCenter.notice.sendSuccess', {
          station: targetStation.name,
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
        message: t(locale, 'taskCenter.notice.sendFailed', {
          detail,
        }),
      })
    } finally {
      setTaskSending(false)
    }
  }, [
    activeStationId,
    activeWorkspaceId,
    describeError,
    locale,
    onDeliverTaskToStation,
    onPersistTaskDocument,
    setTaskAttachments,
    setTaskDispatchHistory,
    setTaskDraft,
    setTaskNotice,
    setTaskSending,
    stationsRef,
    taskAttachments,
    taskDispatchHistoryLimit,
    taskDraft,
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
      const targetStation = stationsRef.current.find((station) => station.id === targetRecord.targetStationId)
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
      stationsRef,
      taskDispatchHistory,
      taskRetryingTaskId,
      taskSending,
    ],
  )

  return {
    updateTaskDraft,
    addTaskAttachmentByPath,
    addTaskAttachmentFromInput,
    removeTaskAttachment,
    insertTaskAttachmentReference,
    insertTaskSnippet,
    dispatchTaskToAgent,
    retryTaskDispatch,
  }
}
