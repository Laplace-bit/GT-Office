const DESIGNER_IPC_TRACE_WINDOW_MS = 1000
const DESIGNER_IPC_TRACE_WARNING_COUNT = 30

const designerIpcTraceStarts: number[] = []
let designerIpcTraceSequence = 0

function shouldTraceDesignerIpc(): boolean {
  return import.meta.env.DEV
}

export function nextDesignerIpcTraceId(): string {
  return `designer-ipc-${++designerIpcTraceSequence}`
}

export function traceDesignerIpc<T>(kind: string, run: (traceId: string) => Promise<T>): Promise<T> {
  const traceId = nextDesignerIpcTraceId()
  if (!shouldTraceDesignerIpc()) {
    return run(traceId)
  }

  const startedAt = performance.now()
  designerIpcTraceStarts.push(startedAt)
  while (
    designerIpcTraceStarts.length > 0 &&
    startedAt - designerIpcTraceStarts[0] > DESIGNER_IPC_TRACE_WINDOW_MS
  ) {
    designerIpcTraceStarts.shift()
  }
  const recentCount = designerIpcTraceStarts.length

  return run(traceId).finally(() => {
    const durationMs = Math.round(performance.now() - startedAt)
    const detail = { traceId, kind, durationMs, recentCount }
    if (recentCount >= DESIGNER_IPC_TRACE_WARNING_COUNT) {
      console.warn('designer.ipc.frequency', detail)
    } else {
      console.debug('designer.ipc', detail)
    }
  })
}
