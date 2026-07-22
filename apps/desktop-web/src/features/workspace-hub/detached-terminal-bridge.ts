import type { WorkbenchStationRuntime } from './TerminalStationPane'

export const DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL = 'main'
// The cache is a rebind/recovery source as well as detached-window state. Keep
// a meaningful terminal transcript here instead of resetting to a 50k tail
// whenever a renderer or window changes ownership.
export const DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS = 1024 * 1024
export const DETACHED_TERMINAL_OUTPUT_APPEND_MESSAGE_CHAR_LIMIT = 24 * 1024

export type DetachedTerminalRuntimeProjectionPatch = Partial<
  Pick<WorkbenchStationRuntime, 'sessionId' | 'stateRaw' | 'shell' | 'cwdMode' | 'resolvedCwd'>
>

export function createEmptyWorkbenchStationRuntime(): WorkbenchStationRuntime {
  return {
    sessionId: null,
    unreadCount: 0,
    stateRaw: 'idle',
    shell: null,
    cwdMode: 'workspace_root',
    resolvedCwd: null,
  }
}

export function appendDetachedTerminalOutput(previous: string | undefined, chunk: string): string {
  if (!chunk) {
    return previous ?? ''
  }
  if (chunk.length >= DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS) {
    return chunk.slice(chunk.length - DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS)
  }
  const previousText = previous ?? ''
  const previousTailLength = DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS - chunk.length
  const previousTail =
    previousText.length > previousTailLength
      ? previousText.slice(previousText.length - previousTailLength)
      : previousText
  return `${previousTail}${chunk}`
}

export function normalizeDetachedTerminalUnreadDelta(unreadDelta: number | null | undefined): number {
  if (unreadDelta == null) {
    return 1
  }
  if (!Number.isFinite(unreadDelta)) {
    return 0
  }
  return Math.max(0, Math.floor(unreadDelta))
}

export interface DetachedTerminalOutputAppendDraft {
  kind: 'detached_terminal_output_append'
  workspaceId: string
  containerId: string
  stationId: string
  chunk: string
  unreadDelta: number
}

export interface DetachedTerminalOutputAppendProjectionMessage extends DetachedTerminalOutputAppendDraft {
  projectionSeq: number
}

export interface DetachedTerminalOutputAppendTakeOptions {
  nextProjectionSeq: (stationId: string) => number
  messageCharLimit?: number
}

function normalizeDetachedTerminalOutputAppendMessageCharLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return DETACHED_TERMINAL_OUTPUT_APPEND_MESSAGE_CHAR_LIMIT
  }
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function splitDetachedTerminalOutputAppendDraft(
  draft: DetachedTerminalOutputAppendDraft,
  messageCharLimit: number,
  nextProjectionSeq: (stationId: string) => number,
): DetachedTerminalOutputAppendProjectionMessage[] {
  if (!draft.chunk || messageCharLimit <= 0) {
    return []
  }
  if (messageCharLimit === Number.POSITIVE_INFINITY) {
    return [{
      ...draft,
      projectionSeq: nextProjectionSeq(draft.stationId),
    }]
  }

  const messages: DetachedTerminalOutputAppendProjectionMessage[] = []
  let nextChunk = ''
  let characterCount = 0
  let isFirstMessage = true

  for (const character of draft.chunk) {
    nextChunk += character
    characterCount += 1
    if (characterCount < messageCharLimit) {
      continue
    }
    messages.push({
      ...draft,
      chunk: nextChunk,
      unreadDelta: isFirstMessage ? draft.unreadDelta : 0,
      projectionSeq: nextProjectionSeq(draft.stationId),
    })
    nextChunk = ''
    characterCount = 0
    isFirstMessage = false
  }

  if (nextChunk) {
    messages.push({
      ...draft,
      chunk: nextChunk,
      unreadDelta: isFirstMessage ? draft.unreadDelta : 0,
      projectionSeq: nextProjectionSeq(draft.stationId),
    })
  }

  return messages
}

export function buildDetachedTerminalOutputAppendKey(input: {
  workspaceId: string
  containerId: string
  stationId: string
}): string {
  return JSON.stringify([input.workspaceId, input.containerId, input.stationId])
}

export function queueDetachedTerminalOutputAppendDraft(
  queue: Record<string, DetachedTerminalOutputAppendDraft>,
  input: {
    workspaceId: string
    containerId: string
    stationId: string
    chunk: string
    unreadDelta?: number | null
  },
): string | null {
  if (!input.workspaceId || !input.containerId || !input.stationId || !input.chunk) {
    return null
  }
  const queueKey = buildDetachedTerminalOutputAppendKey(input)
  const pending = queue[queueKey]
  if (pending) {
    pending.chunk += input.chunk
    pending.unreadDelta = Math.min(999, pending.unreadDelta + normalizeDetachedTerminalUnreadDelta(input.unreadDelta))
    return queueKey
  }
  queue[queueKey] = {
    kind: 'detached_terminal_output_append',
    workspaceId: input.workspaceId,
    containerId: input.containerId,
    stationId: input.stationId,
    chunk: input.chunk,
    unreadDelta: Math.min(999, normalizeDetachedTerminalUnreadDelta(input.unreadDelta)),
  }
  return queueKey
}

export function takeDetachedTerminalOutputAppendDrafts(
  queue: Record<string, DetachedTerminalOutputAppendDraft>,
  options: DetachedTerminalOutputAppendTakeOptions,
): DetachedTerminalOutputAppendProjectionMessage[] {
  const drafts = Object.values(queue)
  Object.keys(queue).forEach((queueKey) => {
    delete queue[queueKey]
  })
  const messageCharLimit = normalizeDetachedTerminalOutputAppendMessageCharLimit(options.messageCharLimit)
  return drafts.flatMap((draft) => splitDetachedTerminalOutputAppendDraft(draft, messageCharLimit, options.nextProjectionSeq))
}

export function normalizeDetachedTerminalRuntime(
  runtime: Partial<WorkbenchStationRuntime> | null | undefined,
): WorkbenchStationRuntime {
  return {
    ...createEmptyWorkbenchStationRuntime(),
    ...(runtime ?? {}),
    sessionId: runtime?.sessionId ?? null,
    unreadCount:
      typeof runtime?.unreadCount === 'number' && Number.isFinite(runtime.unreadCount)
        ? runtime.unreadCount
        : 0,
    stateRaw: runtime?.stateRaw ?? 'idle',
    shell: runtime?.shell ?? null,
    cwdMode: runtime?.cwdMode === 'custom' ? 'custom' : 'workspace_root',
    resolvedCwd: runtime?.resolvedCwd ?? null,
  }
}

export function stripDetachedTerminalRuntimeProjectionPatch(
  patch: Partial<WorkbenchStationRuntime>,
): DetachedTerminalRuntimeProjectionPatch | null {
  const nextPatch: DetachedTerminalRuntimeProjectionPatch = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'sessionId')) {
    nextPatch.sessionId = patch.sessionId ?? null
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'stateRaw')) {
    nextPatch.stateRaw = patch.stateRaw
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'shell')) {
    nextPatch.shell = patch.shell ?? null
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'cwdMode')) {
    nextPatch.cwdMode = patch.cwdMode === 'custom' ? 'custom' : 'workspace_root'
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'resolvedCwd')) {
    nextPatch.resolvedCwd = patch.resolvedCwd ?? null
  }
  return Object.keys(nextPatch).length > 0 ? nextPatch : null
}
