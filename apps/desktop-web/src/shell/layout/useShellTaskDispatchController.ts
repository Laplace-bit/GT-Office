import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MutableRefObject } from 'react'
import {
  areTaskTargetsEqual,
  buildTaskCenterDraftFilePath,
  createInitialTaskDraft,
  resolveValidTaskTargets,
  useTaskDispatchActions,
  useTaskCenterDraftPersistence,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
} from '@features/task-center'
import type { AgentStation } from '@features/workspace-hub'
import type { Locale } from '../i18n/ui-locale'
import type { StationTerminalRuntime } from './ShellRoot.shared'
import {
  TASK_DISPATCH_HISTORY_LIMIT,
  TASK_DRAFT_PERSIST_DEBOUNCE_MS,
  describeError,
  normalizeStationToolKind,
} from './ShellRoot.shared'
import { desktopApi } from '../integration/desktop-api'
import { resolveStationRuntimeRegistrationCleanup } from '@features/terminal'

interface UseShellTaskDispatchControllerInput {
  initialStations: AgentStation[]
  activeWorkspaceId: string | null
  activeStationId: string
  locale: Locale
  stationsRef: MutableRefObject<AgentStation[]>
  stationTerminalsRef: MutableRefObject<Record<string, StationTerminalRuntime>>
  activeWorkspaceIdRef: MutableRefObject<string | null>
  stationSubmitSequenceRef: MutableRefObject<Record<string, string>>
  tauriRuntime: boolean
  // Terminal callbacks passed from the terminal controller
  ensureStationTerminalSession: (stationId: string) => Promise<string | null>
  submitStationTerminal: (stationId: string) => Promise<boolean>
  reconcileStationRuntimeRegistration: (input: {
    workspaceId: string
    stationId: string
    expectedSessionId: string | null
  }) => Promise<void>
}

export interface ShellTaskDispatchController {
  taskDraft: TaskDraftState
  taskDispatchHistory: TaskDispatchRecord[]
  taskSending: boolean
  taskRetryingTaskId: string | null
  taskDraftSavedAtMs: number | null
  taskNotice: TaskCenterNotice | null
  setTaskDraft: React.Dispatch<React.SetStateAction<TaskDraftState>>
  setTaskDispatchHistory: React.Dispatch<React.SetStateAction<TaskDispatchRecord[]>>
  setTaskSending: React.Dispatch<React.SetStateAction<boolean>>
  setTaskRetryingTaskId: React.Dispatch<React.SetStateAction<string | null>>
  setTaskDraftSavedAtMs: React.Dispatch<React.SetStateAction<number | null>>
  setTaskNotice: React.Dispatch<React.SetStateAction<TaskCenterNotice | null>>
  updateTaskDraft: (patch: Partial<TaskDraftState>) => void
  insertTaskSnippet: (snippet: import('@features/task-center').TaskMarkdownSnippet) => void
  dispatchTaskToAgent: () => Promise<void>
  retryTaskDispatch: (taskId: string) => Promise<void>
  handleTaskSend: () => void
  handleRetryDispatchTask: (taskId: string) => Promise<void>
}

export function useShellTaskDispatchController({
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
}: UseShellTaskDispatchControllerInput): ShellTaskDispatchController {
  // --- State ---
  const [taskDraft, setTaskDraft] = useState<TaskDraftState>(() =>
    createInitialTaskDraft(initialStations, initialStations[0]?.id ?? ''),
  )
  const [taskDispatchHistory, setTaskDispatchHistory] = useState<TaskDispatchRecord[]>([])
  const [taskSending, setTaskSending] = useState(false)
  const [taskRetryingTaskId, setTaskRetryingTaskId] = useState<string | null>(null)
  const [taskDraftSavedAtMs, setTaskDraftSavedAtMs] = useState<number | null>(null)
  const [taskNotice, setTaskNotice] = useState<TaskCenterNotice | null>(null)

  // --- Derived ---
  const taskCenterDraftFilePath = useMemo(() => buildTaskCenterDraftFilePath(), [])

  // --- Effects ---

  // Keep task draft target station IDs in sync when stations change
  useEffect(() => {
    const stations = stationsRef.current
    const nextTargetIds = resolveValidTaskTargets(stations, taskDraft.targetStationIds)
    if (areTaskTargetsEqual(nextTargetIds, taskDraft.targetStationIds)) {
      return
    }
    setTaskDraft((prev) => ({
      ...prev,
      targetStationIds: nextTargetIds,
    }))
  }, [stationsRef, taskDraft.targetStationIds])

  // --- Callbacks ---

  const readTaskCenterSnapshotFile = useCallback(
    async (input: { workspaceId: string; taskCenterDraftFilePath: string }) => {
      if (!tauriRuntime) {
        return null
      }
      try {
        const file = await desktopApi.fsReadFile(input.workspaceId, input.taskCenterDraftFilePath)
        if (!file.previewable) {
          return null
        }
        return file.content
      } catch {
        return null
      }
    },
    [tauriRuntime],
  )

  const writeTaskCenterSnapshotFile = useCallback(
    async (input: {
      workspaceId: string
      taskCenterDraftFilePath: string
      serializedSnapshot: string
    }) => {
      if (!tauriRuntime) {
        return
      }
      await desktopApi.fsWriteFile(
        input.workspaceId,
        input.taskCenterDraftFilePath,
        input.serializedSnapshot,
      )
    },
    [tauriRuntime],
  )

  // --- Hooks ---

  useTaskCenterDraftPersistence({
    activeWorkspaceId,
    taskCenterDraftFilePath,
    stationsRef,
    activeStationId,
    taskDraft,
    taskDispatchHistory,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
    persistDebounceMs: TASK_DRAFT_PERSIST_DEBOUNCE_MS,
    setTaskDraft,
    setTaskDispatchHistory,
    setTaskSending,
    setTaskRetryingTaskId,
    setTaskDraftSavedAtMs,
    setTaskNotice,
    onReadTaskSnapshotFile: readTaskCenterSnapshotFile,
    onWriteTaskSnapshotFile: writeTaskCenterSnapshotFile,
  })

  const ensureTaskTargetRuntime = useCallback(
    async (input: { workspaceId: string; targetStationId: string }) => {
      if (!tauriRuntime) {
        return
      }
      const station = stationsRef.current.find((item) => item.id === input.targetStationId)
      if (!station) {
        return
      }
      const sessionId = await ensureStationTerminalSession(station.id)
      if (!sessionId) {
        return
      }
      const currentStation = stationsRef.current.find((item) => item.id === input.targetStationId)
      const runtimeRegistrationCleanup = resolveStationRuntimeRegistrationCleanup(
        input.workspaceId,
        activeWorkspaceIdRef.current,
        Boolean(currentStation),
        sessionId,
        stationTerminalsRef.current[input.targetStationId],
      )
      if (runtimeRegistrationCleanup?.action === 'unregister') {
        void desktopApi.agentRuntimeUnregister(input.workspaceId, input.targetStationId).catch(() => {
          // Runtime sync effect will retry from current station ownership.
        })
        return
      }
      const registrationSessionId = runtimeRegistrationCleanup?.sessionId ?? sessionId
      const registrationResolvedCwd =
        runtimeRegistrationCleanup?.resolvedCwd ??
        stationTerminalsRef.current[input.targetStationId]?.resolvedCwd ??
        null
      const registrationStation = currentStation ?? station
      await desktopApi.agentRuntimeRegister({
        workspaceId: input.workspaceId,
        agentId: input.targetStationId,
        stationId: input.targetStationId,
        roleKey: registrationStation.role,
        sessionId: registrationSessionId,
        toolKind: normalizeStationToolKind(registrationStation.tool),
        resolvedCwd: registrationResolvedCwd,
        submitSequence: stationSubmitSequenceRef.current[input.targetStationId] ?? null,
        online: true,
      })
      await reconcileStationRuntimeRegistration({
        workspaceId: input.workspaceId,
        stationId: input.targetStationId,
        expectedSessionId: registrationSessionId,
      })
    },
    [
      tauriRuntime,
      stationsRef,
      ensureStationTerminalSession,
      stationTerminalsRef,
      activeWorkspaceIdRef,
      stationSubmitSequenceRef,
      reconcileStationRuntimeRegistration,
    ],
  )

  const dispatchTaskBatch = useCallback(
    async (input: {
      workspaceId: string
      title: string
      markdown: string
      targetStationIds: string[]
    }) => {
      const response = await desktopApi.taskDispatchBatch({
        workspaceId: input.workspaceId,
        sender: { type: 'human', agentId: null },
        targets: input.targetStationIds,
        title: input.title,
        markdown: input.markdown,
        attachments: [],
      })
      const postSubmitResults = await Promise.all(
        response.results.map(async (result) => {
          if (result.status !== 'sent') {
            return result
          }
          const submitted = await submitStationTerminal(result.targetAgentId)
          if (submitted) {
            return result
          }
          return {
            ...result,
            status: 'failed' as const,
            detail: 'XTERM_SUBMIT_FAILED',
          }
        }),
      )
      return {
        ...response,
        results: postSubmitResults,
      }
    },
    [submitStationTerminal],
  )

  const {
    updateTaskDraft,
    insertTaskSnippet,
    dispatchTaskToAgent,
    retryTaskDispatch,
  } = useTaskDispatchActions({
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
    onEnsureTaskTargetRuntime: ensureTaskTargetRuntime,
    onDispatchTaskBatch: dispatchTaskBatch,
    describeError,
    taskDispatchHistoryLimit: TASK_DISPATCH_HISTORY_LIMIT,
  })

  const handleTaskSend = useCallback(() => {
    void dispatchTaskToAgent()
  }, [dispatchTaskToAgent])

  const handleRetryDispatchTask = useCallback(
    async (taskId: string) => {
      await retryTaskDispatch(taskId)
    },
    [retryTaskDispatch],
  )

  return {
    taskDraft,
    taskDispatchHistory,
    taskSending,
    taskRetryingTaskId,
    taskDraftSavedAtMs,
    taskNotice,
    setTaskDraft,
    setTaskDispatchHistory,
    setTaskSending,
    setTaskRetryingTaskId,
    setTaskDraftSavedAtMs,
    setTaskNotice,
    updateTaskDraft,
    insertTaskSnippet,
    dispatchTaskToAgent,
    retryTaskDispatch,
    handleTaskSend,
    handleRetryDispatchTask,
  }
}
