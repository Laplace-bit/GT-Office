export type TerminalDebugLane = 'event' | 'recovery' | 'xterm'

export type TerminalDebugKind =
  | 'output'
  | 'state'
  | 'meta'
  | 'delta'
  | 'snapshot'
  | 'screen'
  | 'write'
  | 'reset'
  | 'restore'

export interface TerminalDebugRecord {
  id: string
  atMs: number
  stationId: string
  sessionId: string | null
  screenRevision?: number | null
  lane: TerminalDebugLane
  kind: TerminalDebugKind
  source?: string | null
  summary: string
  body: string
  humanText?: string | null
}

export interface TerminalDebugRecordInput {
  atMs?: number
  sessionId?: string | null
  screenRevision?: number | null
  lane: TerminalDebugLane
  kind: TerminalDebugKind
  source?: string | null
  summary: string
  body: string
  humanText?: string | null
}

const DEFAULT_PREVIEW_LIMIT = 120
const DEFAULT_BODY_LIMIT = 0

function escapeControlByte(char: string): string {
  return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`
}

function normalizeDebugText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, escapeControlByte)
}

export function formatTerminalDebugPreview(value: string, limit = DEFAULT_PREVIEW_LIMIT): string {
  const normalized = normalizeDebugText(value).replace(/\n/g, '\\n')
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`
}

export function formatTerminalDebugBody(value: string, limit = DEFAULT_BODY_LIMIT): string {
  const normalized = normalizeDebugText(value)
  if (limit <= 0) {
    return normalized
  }
  if (normalized.length <= limit) {
    return normalized
  }
  const omitted = normalized.length - limit
  return `${normalized.slice(0, limit)}\n\n...[truncated ${omitted} chars]`
}

export function appendTerminalDebugRecord(
  records: TerminalDebugRecord[],
  record: TerminalDebugRecord,
  limit: number,
): TerminalDebugRecord[] {
  if (limit <= 0) {
    return [...records, record]
  }
  return [...records, record].slice(-limit)
}

export function hydrateTerminalDebugRecordHumanText(
  records: TerminalDebugRecord[],
  sessionId: string | null,
  screenRevision: number,
  humanText: string | null | undefined,
): TerminalDebugRecord[] {
  const normalizedHumanText = humanText?.trim() ? humanText.trim() : null
  let changed = false
  const next = records.map((record) => {
    if (record.sessionId !== sessionId || record.screenRevision !== screenRevision) {
      return record
    }
    if ((record.humanText ?? null) === normalizedHumanText) {
      return record
    }
    changed = true
    return {
      ...record,
      humanText: normalizedHumanText,
    }
  })
  return changed ? next : records
}
