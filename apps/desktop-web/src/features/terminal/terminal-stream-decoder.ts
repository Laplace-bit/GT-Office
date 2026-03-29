export interface TerminalChunkDecoder {
  textDecoder: TextDecoder
}

export function createTerminalChunkDecoder(): TerminalChunkDecoder {
  return {
    textDecoder: new TextDecoder(),
  }
}

function base64ToBytes(base64Chunk: string): Uint8Array {
  const atobFn = globalThis.atob
  if (typeof atobFn === 'function') {
    const binary = atobFn(base64Chunk)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  }
  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: { from: (input: string, encoding: string) => Uint8Array }
  }).Buffer
  if (bufferCtor) {
    return Uint8Array.from(bufferCtor.from(base64Chunk, 'base64'))
  }
  throw new Error('BASE64_DECODE_UNAVAILABLE')
}

export function decodeTerminalBase64Chunk(
  decoder: TerminalChunkDecoder,
  base64Chunk: string,
  stream: boolean,
): string {
  if (!base64Chunk) {
    return ''
  }
  try {
    if (!stream) {
      decoder.textDecoder = new TextDecoder()
    }
    return decoder.textDecoder.decode(base64ToBytes(base64Chunk), { stream })
  } catch {
    if (!stream) {
      return ''
    }
    try {
      decoder.textDecoder = new TextDecoder()
      return decoder.textDecoder.decode(base64ToBytes(base64Chunk), { stream: true })
    } catch {
      return ''
    }
  }
}

export function resetTerminalChunkDecoder(decoder: TerminalChunkDecoder): void {
  decoder.textDecoder = new TextDecoder()
}
