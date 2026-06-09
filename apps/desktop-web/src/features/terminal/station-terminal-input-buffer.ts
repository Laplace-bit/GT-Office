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

function trimUtf8StringToMaxBytes(input: string, maxBytes: number): string {
  if (!input || maxBytes <= 0) {
    return ''
  }
  if (UTF8_TEXT_ENCODER.encode(input).byteLength <= maxBytes) {
    return input
  }

  let usedBytes = 0
  const keptCharacters: string[] = []
  const characters = Array.from(input)
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]
    const characterBytes = UTF8_TEXT_ENCODER.encode(character).byteLength
    if (usedBytes + characterBytes > maxBytes) {
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
        }, options.flushDelayMs),
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
