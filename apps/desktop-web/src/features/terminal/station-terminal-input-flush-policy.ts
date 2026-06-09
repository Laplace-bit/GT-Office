const STATION_INPUT_IMMEDIATE_CHUNK_BYTES = 24
const STATION_INPUT_IMMEDIATE_CHUNK_ENCODER = new TextEncoder()

export function shouldFlushStationInputImmediately(input: string): boolean {
  if (!input) {
    return false
  }
  if (input.includes('\n') || input.includes('\r')) {
    return true
  }
  if (STATION_INPUT_IMMEDIATE_CHUNK_ENCODER.encode(input).byteLength >= STATION_INPUT_IMMEDIATE_CHUNK_BYTES) {
    return true
  }
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    if ((code >= 0 && code < 32) || code === 127) {
      return true
    }
  }
  return input.includes('\u001b')
}
