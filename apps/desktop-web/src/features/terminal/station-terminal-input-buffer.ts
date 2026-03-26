export interface BufferedStationInputController {
  enqueue(stationId: string, input: string): void
  clear(stationId: string): void
  dispose(): void
}

interface CreateBufferedStationInputControllerOptions<TTimer> {
  flushDelayMs: number
  maxBufferBytes: number
  shouldFlushImmediately: (input: string) => boolean
  scheduleTimer: (callback: () => void, delayMs: number) => TTimer
  clearTimer: (timerId: TTimer) => void
  sendInput: (stationId: string, input: string) => Promise<void>
}

export function createBufferedStationInputController<TTimer>(
  options: CreateBufferedStationInputControllerOptions<TTimer>,
): BufferedStationInputController {
  const queuedInputByStation = new Map<string, string>()
  const sendingByStation = new Map<string, boolean>()
  const flushTimerByStation = new Map<string, TTimer>()
  let disposed = false

  const clearStationFlushTimer = (stationId: string) => {
    const timerId = flushTimerByStation.get(stationId)
    if (timerId !== undefined) {
      options.clearTimer(timerId)
      flushTimerByStation.delete(stationId)
    }
  }

  const flushStationInput = async (stationId: string): Promise<void> => {
    if (disposed) {
      return
    }
    clearStationFlushTimer(stationId)
    if (sendingByStation.get(stationId)) {
      return
    }
    const queuedInput = queuedInputByStation.get(stationId) ?? ''
    if (!queuedInput) {
      return
    }
    queuedInputByStation.delete(stationId)
    sendingByStation.set(stationId, true)
    try {
      await options.sendInput(stationId, queuedInput)
    } finally {
      sendingByStation.set(stationId, false)
      if (!disposed && (queuedInputByStation.get(stationId) ?? '')) {
        queueMicrotask(() => {
          void flushStationInput(stationId)
        })
      }
    }
  }

  return {
    enqueue(stationId: string, input: string) {
      if (disposed || !input) {
        return
      }
      const previous = queuedInputByStation.get(stationId) ?? ''
      const merged = `${previous}${input}`
      queuedInputByStation.set(
        stationId,
        merged.length > options.maxBufferBytes
          ? merged.slice(merged.length - options.maxBufferBytes)
          : merged,
      )
      clearStationFlushTimer(stationId)
      if (options.shouldFlushImmediately(input)) {
        void flushStationInput(stationId)
        return
      }
      flushTimerByStation.set(
        stationId,
        options.scheduleTimer(() => {
          flushTimerByStation.delete(stationId)
          void flushStationInput(stationId)
        }, options.flushDelayMs),
      )
    },
    clear(stationId: string) {
      clearStationFlushTimer(stationId)
      queuedInputByStation.delete(stationId)
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      Array.from(flushTimerByStation.keys()).forEach((stationId) => {
        clearStationFlushTimer(stationId)
      })
      queuedInputByStation.clear()
    },
  }
}
