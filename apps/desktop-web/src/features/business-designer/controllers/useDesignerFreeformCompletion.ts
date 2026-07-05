import { useCallback, useEffect, useState } from 'react'
import {
  listDesignerFreeformCompletionRuns,
  readDesignerFreeformCompletionRunLog,
  startDesignerFreeformCompletion,
  updateDesignerFreeformCompletionRunStatus,
} from './designerDesktopApi'
import { nextDesignerIpcTraceId, traceDesignerIpc } from './designerIpcTrace'
import type {
  DesignerFreeformCompletionProvider,
  DesignerFreeformCompletionRun,
  DesignerFreeformCompletionScenario,
} from '../model/designer-freeform-completion'
import { hasRunningDesignerFreeformRun } from '../model/designer-freeform-completion'

interface UseDesignerFreeformCompletionInput {
  workspaceId: string | null
  documentId: string | null
}

interface StartFreeformCompletionParams {
  scenario: DesignerFreeformCompletionScenario
  hostBlockId?: string | null
  userPrompt?: string | null
  provider?: DesignerFreeformCompletionProvider | null
}

export interface DesignerFreeformCompletionController {
  runs: DesignerFreeformCompletionRun[]
  starting: boolean
  running: boolean
  error: string | null
  runLogs: Record<string, string>
  logLoadingRunId: string | null
  refreshRuns: () => Promise<void>
  startCompletion: (params: StartFreeformCompletionParams) => Promise<DesignerFreeformCompletionRun | null>
  readRunLog: (run: DesignerFreeformCompletionRun) => Promise<void>
  stopRun: (run: DesignerFreeformCompletionRun) => Promise<void>
}

export function useDesignerFreeformCompletion({
  workspaceId,
  documentId,
}: UseDesignerFreeformCompletionInput): DesignerFreeformCompletionController {
  const [runs, setRuns] = useState<DesignerFreeformCompletionRun[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runLogs, setRunLogs] = useState<Record<string, string>>({})
  const [logLoadingRunId, setLogLoadingRunId] = useState<string | null>(null)

  const refreshRuns = useCallback(async () => {
    if (!workspaceId || !documentId) {
      setRuns([])
      return
    }
    try {
      const result = await traceDesignerIpc('business_designer.list_freeform_completion_runs', (traceId) =>
        listDesignerFreeformCompletionRuns(workspaceId, documentId, traceId),
      )
      setRuns(result.runs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [documentId, workspaceId])

  const startCompletion = useCallback(
    async (params: StartFreeformCompletionParams) => {
      if (!workspaceId || !documentId) {
        return null
      }
      setStarting(true)
      try {
        const result = await startDesignerFreeformCompletion(workspaceId, {
          traceId: nextDesignerIpcTraceId(),
          documentId,
          scenario: params.scenario,
          hostBlockId: params.hostBlockId ?? null,
          userPrompt: params.userPrompt ?? null,
          provider: params.provider ?? null,
        })
        setRuns((current) => [result, ...current.filter((run) => run.requestId !== result.requestId)])
        void readDesignerFreeformCompletionRunLog(workspaceId, {
          traceId: nextDesignerIpcTraceId(),
          documentId: result.documentId,
          requestId: result.requestId,
        })
          .then((logResult) => {
            setRunLogs((current) => ({
              ...current,
              [result.requestId]: logResult.log,
            }))
          })
          .catch((logError) => {
            setError(logError instanceof Error ? logError.message : String(logError))
          })
        setError(null)
        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setStarting(false)
      }
    },
    [documentId, workspaceId],
  )

  const readRunLog = useCallback(
    async (run: DesignerFreeformCompletionRun) => {
      if (!workspaceId) {
        return
      }
      setLogLoadingRunId(run.requestId)
      try {
        const result = await readDesignerFreeformCompletionRunLog(workspaceId, {
          traceId: nextDesignerIpcTraceId(),
          documentId: run.documentId,
          requestId: run.requestId,
        })
        setRunLogs((current) => ({
          ...current,
          [run.requestId]: result.log,
        }))
        void refreshRuns()
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLogLoadingRunId(null)
      }
    },
    [refreshRuns, workspaceId],
  )

  const stopRun = useCallback(
    async (run: DesignerFreeformCompletionRun) => {
      if (!workspaceId || !documentId || run.status !== 'running') {
        return
      }
      try {
        const updated = await updateDesignerFreeformCompletionRunStatus(workspaceId, {
          traceId: nextDesignerIpcTraceId(),
          documentId,
          requestId: run.requestId,
          status: 'cancelled',
        })
        setRuns((current) =>
          current.map((candidate) =>
            candidate.requestId === updated.requestId ? updated : candidate,
          ),
        )
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [documentId, workspaceId],
  )

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  useEffect(() => {
    const runningRuns = runs.filter((run) => run.status === 'running')
    if (!workspaceId || !documentId || runningRuns.length === 0) {
      return
    }
    const timer = window.setInterval(() => {
      void refreshRuns()
      for (const run of runningRuns) {
        if (!Object.prototype.hasOwnProperty.call(runLogs, run.requestId)) {
          continue
        }
        void readDesignerFreeformCompletionRunLog(workspaceId, {
          traceId: nextDesignerIpcTraceId(),
          documentId: run.documentId,
          requestId: run.requestId,
        })
          .then((result) => {
            setRunLogs((current) => ({
              ...current,
              [run.requestId]: result.log,
            }))
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : String(err))
          })
      }
    }, 2_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [documentId, refreshRuns, runLogs, runs, workspaceId])

  return {
    runs,
    starting,
    running: starting || hasRunningDesignerFreeformRun(runs),
    error,
    runLogs,
    logLoadingRunId,
    refreshRuns,
    startCompletion,
    readRunLog,
    stopRun,
  }
}
