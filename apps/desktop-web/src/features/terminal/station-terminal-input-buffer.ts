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

const UTF8_TEXT_ENCODER = new TextEncoder()

function normalizeStationInputBufferMaxBytes(value: number): number {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function normalizeStationInputBufferFlushDelayMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function trimUtf8StringToMaxBytes(input: string, maxBytes: number): string {
  const normalizedMaxBytes = normalizeStationInputBufferMaxBytes(maxBytes)
  if (!input || normalizedMaxBytes <= 0) {
    return ''
  }
  if (normalizedMaxBytes === Number.POSITIVE_INFINITY) {
    return input
  }
  if (UTF8_TEXT_ENCODER.encode(input).byteLength <= normalizedMaxBytes) {
    return input
  }

  let usedBytes = 0
  const keptCharacters: string[] = []
  const characters = Array.from(input)
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]
    const characterBytes = UTF8_TEXT_ENCODER.encode(character).byteLength
    if (usedBytes + characterBytes > normalizedMaxBytes) {
      break
    }
    usedBytes += characterBytes
    keptCharacters.push(character)
  }
  return keptCharacters.reverse().join('')
}

export function createBufferedStationInputController<TTimer>(
  options: CreateBufferedStationInputControllerOptions<TTimer>,
): BufferedStationInputController {
  const normalizedFlushDelayMs = normalizeStationInputBufferFlushDelayMs(options.flushDelayMs)
  const queuedInputByStation = new Map<string, string>()
  const sendingTokenByStation = new Map<string, number>()
  const flushTimerByStation = new Map<string, TTimer>()
  let disposed = false
  let nextSendingToken = 1

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
    if (sendingTokenByStation.has(stationId)) {
      return
    }
    const queuedInput = queuedInputByStation.get(stationId) ?? ''
    if (!queuedInput) {
      return
    }
    queuedInputByStation.delete(stationId)
    const sendingToken = nextSendingToken
    nextSendingToken += 1
    sendingTokenByStation.set(stationId, sendingToken)
    try {
      await options.sendInput(stationId, queuedInput)
    } finally {
      if (disposed) {
        sendingTokenByStation.delete(stationId)
        return
      }
      if (sendingTokenByStation.get(stationId) !== sendingToken) {
        return
      }
      sendingTokenByStation.delete(stationId)
      if (!disposed && (queuedInputByStation.get(stationId) ?? '')) {
        queueMicrotask(() => {
          void flushStationInput(stationId)
        })
      }
    }
  }

  return {
    enqueue(stationId: string, input: string) {
      const normalizedStationId = stationId.trim()
      if (disposed || !normalizedStationId || !input) {
        return
      }
      const previous = queuedInputByStation.get(normalizedStationId) ?? ''
      const merged = `${previous}${input}`
      queuedInputByStation.set(normalizedStationId, trimUtf8StringToMaxBytes(merged, options.maxBufferBytes))
      clearStationFlushTimer(normalizedStationId)
      if (options.shouldFlushImmediately(input)) {
        void flushStationInput(normalizedStationId)
        return
      }
      flushTimerByStation.set(
        normalizedStationId,
        options.scheduleTimer(() => {
          flushTimerByStation.delete(normalizedStationId)
          void flushStationInput(normalizedStationId)
        }, normalizedFlushDelayMs),
      )
    },
    clear(stationId: string) {
      const normalizedStationId = stationId.trim()
      if (!normalizedStationId) {
        return
      }
      clearStationFlushTimer(normalizedStationId)
      queuedInputByStation.delete(normalizedStationId)
      sendingTokenByStation.delete(normalizedStationId)
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
