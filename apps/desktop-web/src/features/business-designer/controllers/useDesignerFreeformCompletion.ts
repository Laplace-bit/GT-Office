import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopApi, type TerminalStatePayload } from '@shell/integration/desktop-api'
import {
  createTerminalChunkDecoder,
  decodeTerminalBase64Chunk,
} from '@features/terminal/terminal-stream-decoder'
import {
  listDesignerFreeformCompletionRuns,
  startDesignerFreeformCompletion,
  updateDesignerFreeformCompletionRunStatus,
} from './designerDesktopApi'
import { nextDesignerIpcTraceId, traceDesignerIpc } from './designerIpcTrace'
import type {
  DesignerFreeformCompletionProvider,
  DesignerFreeformCompletionRun,
  DesignerFreeformCompletionScenario,
} from '../model/designer-freeform-completion'

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
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runLogs, setRunLogs] = useState<Record<string, string>>({})
  const [logLoadingRunId, setLogLoadingRunId] = useState<string | null>(null)
  const runsRef = useRef<DesignerFreeformCompletionRun[]>([])

  useEffect(() => {
    runsRef.current = runs
  }, [runs])

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
      setRunning(true)
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
        setError(null)
        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setRunning(false)
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
        const snapshot = await desktopApi.terminalReadSnapshot(workspaceId, run.sessionId, 48_000)
        const decoder = createTerminalChunkDecoder()
        const text = decodeTerminalBase64Chunk(decoder, snapshot.chunk, false)
        setRunLogs((current) => ({
          ...current,
          [run.requestId]: text || snapshot.chunk,
        }))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLogLoadingRunId(null)
      }
    },
    [workspaceId],
  )

  const stopRun = useCallback(
    async (run: DesignerFreeformCompletionRun) => {
      if (!workspaceId || !documentId || run.status !== 'running') {
        return
      }
      try {
        await desktopApi.terminalKill(workspaceId, run.sessionId, 'TERM')
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
    if (!workspaceId || !documentId || !desktopApi.isTauriRuntime()) {
      return
    }
    let disposed = false
    let cleanup: (() => void) | null = null

    const handleTerminalState = (payload: TerminalStatePayload) => {
      if (payload.workspaceId !== workspaceId) {
        return
      }
      const run = runsRef.current.find(
        (candidate) => candidate.sessionId === payload.sessionId && candidate.status === 'running',
      )
      if (!run || (payload.to !== 'exited' && payload.to !== 'failed' && payload.to !== 'killed')) {
        return
      }
      const status =
        payload.to === 'killed' ? 'cancelled' : payload.to === 'failed' ? 'failed' : 'completed'
      void updateDesignerFreeformCompletionRunStatus(workspaceId, {
        traceId: nextDesignerIpcTraceId(),
        documentId,
        requestId: run.requestId,
        status,
      })
        .then((updated) => {
          if (disposed) {
            return
          }
          setRuns((current) =>
            current.map((candidate) =>
              candidate.requestId === updated.requestId ? updated : candidate,
            ),
          )
        })
        .catch((err) => {
          if (!disposed) {
            setError(err instanceof Error ? err.message : String(err))
          }
        })
    }

    void desktopApi.subscribeTerminalEvents({
      onOutput: () => {},
      onStateChanged: handleTerminalState,
      onMeta: () => {},
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [documentId, workspaceId])

  return {
    runs,
    running,
    error,
    runLogs,
    logLoadingRunId,
    refreshRuns,
    startCompletion,
    readRunLog,
    stopRun,
  }
}
