import type { RenderedScreenSnapshot } from '@shell/integration/desktop-api'

export type AgentExecutionState = 'unknown' | 'idle' | 'working' | 'waiting' | 'blocked'

export interface AgentExecutionObservation {
  sessionId: string
  state: AgentExecutionState
  pendingIdleSinceMs: number | null
  pendingIdleConfirmations: number
}

export interface AgentExecutionStateTransition {
  observation: AgentExecutionObservation
  changed: boolean
  idleConfirmationDelayMs: number | null
}

export const AGENT_IDLE_CONFIRMATION_INTERVAL_MS = 100
export const AGENT_IDLE_CONFIRMATION_COUNT = 3
export const AGENT_IDLE_CONFIRMATION_MAX_MS = 700

const TRANSCRIPT_PATTERNS = [
  /(?:scroll|navigate).*(?:up|down)/i,
  /(?:pgup|pgdn|page up|page down)/i,
  /(?:esc|escape).*(?:edit|return|back)/i,
  /(?:showing|viewing).*(?:transcript|history)/i,
]

const WORKING_PATTERNS = [
  /(?:[\u2800-\u28ff\u25d0\u25d1\u25d2\u25d3\u25cf\u2733]|[\u2022\u00b7])\s*(?:thinking|working|processing|generating|executing|planning)\b/i,
  /\b(?:thinking|working|processing|generating|executing|planning)\s*(?:\.\.\.|\(|$)/im,
  /\besc\s+to\s+(?:interrupt|cancel|stop)\b/i,
]

const WAITING_PATTERNS = [
  /\b(?:do you want to|would you like to|continue)\b.*\?/i,
  /\b(?:select|choose|pick)\b.*\b(?:option|choice|model|directory)\b/i,
  /\b(?:type|enter|provide)\b.*\b(?:input|answer|response|message)\b/i,
  /(?:^|\s)\[(?:y\/n|yes\/no)\](?:\s|$)/i,
]

const BLOCKED_PATTERNS = [
  /\baction required\b/i,
  /\b(?:permission|authentication|authorization)\s+(?:required|failed|denied)\b/i,
  /\b(?:rate limit|quota exceeded|billing required)\b/i,
  /\b(?:cannot|unable to|failed to)\b/i,
]

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function isKnownAgentTool(toolKind: string | null | undefined): boolean {
  const normalized = toolKind?.trim().toLowerCase() ?? ''
  return normalized === 'codex' || normalized === 'claude' || normalized.includes('codex') || normalized.includes('claude')
}

function hasTerminalPrompt(rows: string[]): boolean {
  const lastVisibleRow = rows.at(-1)?.trim() ?? ''
  return /^(?:[>\$#]|\u203a|\u276f)$/.test(lastVisibleRow)
}

export function normalizeAgentExecutionState(value: string | null | undefined): AgentExecutionState {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'idle':
    case 'working':
    case 'waiting':
    case 'blocked':
    case 'unknown':
      return normalized
    default:
      return 'unknown'
  }
}

/**
 * Infer the semantic Agent state from its rendered terminal screen. Lifecycle
 * state remains authoritative elsewhere; this only distinguishes a live agent
 * that is working, waiting for a person, blocked, or ready for the next turn.
 */
export function detectAgentExecutionState(
  snapshot: Pick<RenderedScreenSnapshot, 'rows'>,
  toolKind: string | null | undefined,
): AgentExecutionState | null {
  const visibleRows = snapshot.rows
    .map((row) => row.trimmedText.trim())
    .filter((row) => row.length > 0)
  if (visibleRows.length === 0) {
    return null
  }

  const relevantRows = visibleRows.slice(-8)
  const screen = relevantRows.join('\n')
  if (includesAny(screen, TRANSCRIPT_PATTERNS)) {
    return null
  }
  if (includesAny(screen, WAITING_PATTERNS)) {
    return 'waiting'
  }
  if (includesAny(screen, BLOCKED_PATTERNS)) {
    return 'blocked'
  }
  if (hasTerminalPrompt(relevantRows)) {
    return 'idle'
  }
  if (includesAny(screen, WORKING_PATTERNS)) {
    return 'working'
  }
  if (isKnownAgentTool(toolKind)) {
    return 'idle'
  }
  return 'unknown'
}

export function transitionAgentExecutionState(
  previous: AgentExecutionObservation | null | undefined,
  input: {
    sessionId: string
    candidate: AgentExecutionState | null
    observedAtMs: number
  },
): AgentExecutionStateTransition {
  const baseline: AgentExecutionObservation =
    previous?.sessionId === input.sessionId
      ? previous
      : {
          sessionId: input.sessionId,
          state: 'unknown',
          pendingIdleSinceMs: null,
          pendingIdleConfirmations: 0,
        }
  const candidate = input.candidate
  if (candidate === null) {
    return {
      observation: baseline,
      changed: false,
      idleConfirmationDelayMs: null,
    }
  }

  if (baseline.state === 'working' && candidate === 'idle') {
    const pendingIdleSinceMs = baseline.pendingIdleSinceMs ?? input.observedAtMs
    const pendingIdleConfirmations = baseline.pendingIdleConfirmations + 1
    const elapsedMs = Math.max(0, input.observedAtMs - pendingIdleSinceMs)
    if (
      pendingIdleConfirmations < AGENT_IDLE_CONFIRMATION_COUNT &&
      elapsedMs < AGENT_IDLE_CONFIRMATION_MAX_MS
    ) {
      return {
        observation: {
          ...baseline,
          pendingIdleSinceMs,
          pendingIdleConfirmations,
        },
        changed: false,
        idleConfirmationDelayMs: AGENT_IDLE_CONFIRMATION_INTERVAL_MS,
      }
    }
  }

  const observation: AgentExecutionObservation = {
    sessionId: input.sessionId,
    state: candidate,
    pendingIdleSinceMs: null,
    pendingIdleConfirmations: 0,
  }
  return {
    observation,
    changed: baseline.state !== observation.state,
    idleConfirmationDelayMs: null,
  }
}
