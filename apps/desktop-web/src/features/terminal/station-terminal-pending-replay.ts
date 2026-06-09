export type StationTerminalPendingReplayOp =
  | { kind: 'write'; chunk: string }
  | { kind: 'reset'; content: string }

export interface StationTerminalPendingReplay {
  version: number
  ops: StationTerminalPendingReplayOp[]
}

export interface StationTerminalPendingReplayCompactOptions {
  writeChunkCharLimit?: number
}

export function appendStationTerminalPendingReplayOp(
  pendingReplay: StationTerminalPendingReplay,
  op: StationTerminalPendingReplayOp,
): void {
  if (op.kind === 'reset') {
    pendingReplay.ops = [op]
    return
  }

  if (!op.chunk) {
    return
  }

  const previous = pendingReplay.ops[pendingReplay.ops.length - 1]
  if (previous?.kind === 'write') {
    previous.chunk += op.chunk
    return
  }

  pendingReplay.ops.push(op)
}

function normalizeStationTerminalPendingReplayWriteChunkLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.POSITIVE_INFINITY
  }
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function appendStationTerminalPendingReplayWriteChunks(
  pendingReplay: StationTerminalPendingReplay,
  chunk: string,
  writeChunkCharLimit: number,
): void {
  if (!chunk) {
    return
  }
  if (writeChunkCharLimit === Number.POSITIVE_INFINITY) {
    appendStationTerminalPendingReplayOp(pendingReplay, { kind: 'write', chunk })
    return
  }
  if (writeChunkCharLimit <= 0) {
    return
  }

  let nextChunk = ''
  let characterCount = 0
  for (const character of chunk) {
    nextChunk += character
    characterCount += 1
    if (characterCount >= writeChunkCharLimit) {
      pendingReplay.ops.push({ kind: 'write', chunk: nextChunk })
      nextChunk = ''
      characterCount = 0
    }
  }
  if (nextChunk) {
    pendingReplay.ops.push({ kind: 'write', chunk: nextChunk })
  }
}

export function compactStationTerminalPendingReplayOps(
  ops: StationTerminalPendingReplayOp[],
  options?: StationTerminalPendingReplayCompactOptions,
): StationTerminalPendingReplayOp[] {
  const compactedReplay: StationTerminalPendingReplay = {
    version: 0,
    ops: [],
  }

  ops.forEach((op) => {
    appendStationTerminalPendingReplayOp(compactedReplay, op)
  })

  const writeChunkCharLimit = normalizeStationTerminalPendingReplayWriteChunkLimit(options?.writeChunkCharLimit)
  if (writeChunkCharLimit === Number.POSITIVE_INFINITY) {
    return compactedReplay.ops
  }

  const chunkedReplay: StationTerminalPendingReplay = {
    version: 0,
    ops: [],
  }
  compactedReplay.ops.forEach((op) => {
    if (op.kind === 'reset') {
      appendStationTerminalPendingReplayOp(chunkedReplay, op)
      return
    }
    appendStationTerminalPendingReplayWriteChunks(chunkedReplay, op.chunk, writeChunkCharLimit)
  })

  return chunkedReplay.ops
}
