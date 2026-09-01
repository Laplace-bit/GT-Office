import type { RenderedScreenSnapshot } from '@shell/integration/desktop-api'

export type AgentExecutionState = 'unknown' | 'idle' | 'working' | 'waiting' | 'blocked'

export type AgentExecutionEvidenceSource =
  | 'lifecycle'
  | 'launch'
  | 'input'
  | 'terminal-output'
  | 'rendered-screen'

export type AgentExecutionEvidenceReason =
  | 'initial-state'
  | 'launch-command'
  | 'input-submitted'
  | 'working-marker'
  | 'input-request'
  | 'attention-required'
  | 'agent-prompt'
  | 'screen-state'

export interface AgentExecutionCandidate {
  state: AgentExecutionState
  source: AgentExecutionEvidenceSource
  reason: AgentExecutionEvidenceReason
}

export interface AgentExecutionObservation {
  sessionId: string
  state: AgentExecutionState
  source?: AgentExecutionEvidenceSource
  reason?: AgentExecutionEvidenceReason
  observedAtMs?: number
  pendingIdleSinceMs: number | null
  pendingIdleConfirmations: number
}

export interface AgentExecutionStateTransition {
  observation: AgentExecutionObservation
  changed: boolean
  idleConfirmationDelayMs: number | null
}

export type AgentExecutionNotification = 'completed' | 'awaiting-input' | 'blocked'

export interface AgentExecutionTracker {
  sessionId: string
  toolKind: string
  outputTail: string
  observation: AgentExecutionObservation
  pendingCandidate: AgentExecutionCandidate | null
  idleGraceUntilMs: number
}

export interface AgentExecutionTrackerTransition {
  tracker: AgentExecutionTracker
  transition: AgentExecutionStateTransition
  notification: AgentExecutionNotification | null
}

export const AGENT_IDLE_CONFIRMATION_INTERVAL_MS = 100
export const AGENT_IDLE_CONFIRMATION_COUNT = 3
export const AGENT_IDLE_CONFIRMATION_MAX_MS = 700
export const AGENT_EXECUTION_INTENT_GRACE_MS = 400
export const AGENT_EXECUTION_OUTPUT_TAIL_MAX_CHARS = 12 * 1024

const TRANSCRIPT_PATTERNS = [
  /(?:scroll|navigate).*(?:up|down)/i,
  /(?:pgup|pgdn|page up|page down)/i,
  /(?:esc|escape).*(?:edit|return|back)/i,
  /(?:showing|viewing).*(?:transcript|history)/i,
]

const WORKING_PATTERNS = [
  /(?:[\u2800-\u28ff\u25d0-\u25d3\u25cf\u2733]|[\u2022\u00b7])\s*(?:thinking|working|processing|generating|executing|planning)\b/i,
  /\b(?:thinking|working|processing|generating|executing|planning)\s*(?:\.\.\.|\(|$)/im,
  /\besc\s+to\s+(?:interrupt|cancel|stop)\b/i,
]

const WAITING_PATTERNS = [
  /\b(?:do you want to|would you like to|continue)\b.*\?/i,
  /\b(?:select|choose|pick)\b.*\b(?:option|choice|model|directory)\b/i,
  /\b(?:type|enter|provide)\b.*\b(?:input|answer|response|message)\b/i,
  /\b(?:allow|approve|deny)\b.*\b(?:tool|command|permission|change)\b/i,
  /(?:^|\s)\[(?:y\/n|yes\/no)\](?:\s|$)/i,
]

const BLOCKED_PATTERNS = [
  /\baction required\b/i,
  /\b(?:sign in|log in|authenticate|authorize)\b.*\b(?:required|before continuing|to continue)\b/i,
  /\b(?:rate limit|quota exceeded|billing required|payment required)\b/i,
  /\b(?:approval|permission)\s+(?:required|needed)\b/i,
]

const AGENT_PROMPT_PATTERN = /^\s*(?:\u203a|\u276f)\s*(?:.*)?$/gm

interface DetectionMarker {
  candidate: AgentExecutionCandidate
  index: number
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function clampObservedAtMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function findLastPatternMatch(text: string, patterns: RegExp[]): number {
  let latest = -1
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const matcher = new RegExp(pattern.source, flags)
    let match: RegExpExecArray | null
    while ((match = matcher.exec(text)) !== null) {
      latest = Math.max(latest, match.index)
      if (match[0].length === 0) {
        matcher.lastIndex += 1
      }
    }
  }
  return latest
}

function stripTerminalControlSequences(value: string): string {
  let output = ''
  let index = 0

  while (index < value.length) {
    const char = value[index]
    if (char !== '\u001b') {
      output += char
      index += 1
      continue
    }

    const next = value[index + 1]
    if (next === ']') {
      let cursor = index + 2
      while (cursor < value.length) {
        if (value[cursor] === '\u0007') {
          cursor += 1
          break
        }
        if (value[cursor] === '\u001b' && value[cursor + 1] === '\\') {
          cursor += 2
          break
        }
        cursor += 1
      }
      if (cursor >= value.length) {
        break
      }
      index = cursor
      continue
    }

    if (next === '[') {
      let cursor = index + 2
      while (cursor < value.length && !/[\u0040-\u007e]/.test(value[cursor])) {
        cursor += 1
      }
      if (cursor >= value.length) {
        break
      }
      index = cursor + 1
      continue
    }

    index += next ? 2 : 1
  }

  return output
}

function normalizeTerminalDetectionText(value: string): string {
  return stripTerminalControlSequences(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

function selectContentCandidate(
  content: string,
  source: Extract<AgentExecutionEvidenceSource, 'terminal-output' | 'rendered-screen'>,
): AgentExecutionCandidate | null {
  const normalized = normalizeTerminalDetectionText(content)
  if (!normalized.trim() || includesAny(normalized, TRANSCRIPT_PATTERNS)) {
    return null
  }

  const markers: DetectionMarker[] = []
  const addMarker = (
    index: number,
    state: AgentExecutionState,
    reason: AgentExecutionEvidenceReason,
  ) => {
    if (index >= 0) {
      markers.push({
        index,
        candidate: { state, source, reason },
      })
    }
  }

  addMarker(findLastPatternMatch(normalized, WORKING_PATTERNS), 'working', 'working-marker')
  addMarker(findLastPatternMatch(normalized, WAITING_PATTERNS), 'waiting', 'input-request')
  addMarker(findLastPatternMatch(normalized, BLOCKED_PATTERNS), 'blocked', 'attention-required')
  addMarker(findLastPatternMatch(normalized, [AGENT_PROMPT_PATTERN]), 'idle', 'agent-prompt')
  if (markers.length === 0) {
    return null
  }

  const latestAttention = markers
    .filter((marker) => marker.candidate.state === 'waiting' || marker.candidate.state === 'blocked')
    .sort((left, right) => right.index - left.index)[0]
  const latestPrompt = markers
    .filter((marker) => marker.candidate.state === 'idle')
    .sort((left, right) => right.index - left.index)[0]
  if (latestAttention && (!latestPrompt || latestPrompt.index - latestAttention.index <= 160)) {
    return latestAttention.candidate
  }

  return markers.sort((left, right) => right.index - left.index)[0]?.candidate ?? null
}

function normalizeCandidate(
  candidate: AgentExecutionState | AgentExecutionCandidate | null,
): AgentExecutionCandidate | null {
  if (candidate === null) {
    return null
  }
  if (typeof candidate === 'string') {
    return {
      state: candidate,
      source: 'rendered-screen',
      reason: 'screen-state',
    }
  }
  return candidate
}

function clearPendingIdle(observation: AgentExecutionObservation): AgentExecutionObservation {
  if (observation.pendingIdleSinceMs === null && observation.pendingIdleConfirmations === 0) {
    return observation
  }
  return {
    ...observation,
    pendingIdleSinceMs: null,
    pendingIdleConfirmations: 0,
  }
}

function notificationForTransition(
  previousState: AgentExecutionState,
  transition: AgentExecutionStateTransition,
): AgentExecutionNotification | null {
  if (!transition.changed || previousState === 'unknown') {
    return null
  }
  if (previousState === 'working' && transition.observation.state === 'idle') {
    return 'completed'
  }
  if (transition.observation.state === 'waiting') {
    return 'awaiting-input'
  }
  if (transition.observation.state === 'blocked') {
    return 'blocked'
  }
  return null
}

function buildTrackerTransition(
  tracker: AgentExecutionTracker,
  candidate: AgentExecutionCandidate | null,
  observedAtMs: number,
): AgentExecutionTrackerTransition {
  const previousState = tracker.observation.state
  const normalizedObservedAtMs = clampObservedAtMs(observedAtMs)
  if (candidate === null) {
    const observation = clearPendingIdle(tracker.observation)
    return {
      tracker: {
        ...tracker,
        observation,
        pendingCandidate: null,
      },
      transition: {
        observation,
        changed: false,
        idleConfirmationDelayMs: null,
      },
      notification: null,
    }
  }

  if (
    tracker.observation.state === 'working' &&
    candidate.state === 'idle' &&
    normalizedObservedAtMs < tracker.idleGraceUntilMs
  ) {
    const observation = clearPendingIdle(tracker.observation)
    return {
      tracker: {
        ...tracker,
        observation,
        pendingCandidate: candidate,
      },
      transition: {
        observation,
        changed: false,
        idleConfirmationDelayMs: Math.max(1, tracker.idleGraceUntilMs - normalizedObservedAtMs),
      },
      notification: null,
    }
  }

  const transition = transitionAgentExecutionState(tracker.observation, {
    sessionId: tracker.sessionId,
    candidate,
    observedAtMs,
  })
  return {
    tracker: {
      ...tracker,
      observation: transition.observation,
      pendingCandidate: transition.idleConfirmationDelayMs === null ? null : candidate,
    },
    transition,
    notification: notificationForTransition(previousState, transition),
  }
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
 * Infer the current semantic Agent state from a rendered terminal screen.
 * Process lifecycle remains authoritative elsewhere.
 */
export function detectAgentExecutionCandidate(
  snapshot: Pick<RenderedScreenSnapshot, 'rows'>,
  _toolKind: string | null | undefined,
): AgentExecutionCandidate | null {
  const relevantRows = snapshot.rows
    .map((row) => row.trimmedText.trim())
    .filter((row) => row.length > 0)
    .slice(-12)
  return selectContentCandidate(relevantRows.join('\n'), 'rendered-screen')
}

export function detectAgentExecutionState(
  snapshot: Pick<RenderedScreenSnapshot, 'rows'>,
  toolKind: string | null | undefined,
): AgentExecutionState | null {
  return detectAgentExecutionCandidate(snapshot, toolKind)?.state ?? null
}

export function detectAgentExecutionOutputCandidate(
  outputTail: string,
  _toolKind: string | null | undefined,
): AgentExecutionCandidate | null {
  return selectContentCandidate(outputTail, 'terminal-output')
}

export function transitionAgentExecutionState(
  previous: AgentExecutionObservation | null | undefined,
  input: {
    sessionId: string
    candidate: AgentExecutionState | AgentExecutionCandidate | null
    observedAtMs: number
  },
): AgentExecutionStateTransition {
  const baseline: AgentExecutionObservation =
    previous?.sessionId === input.sessionId
      ? previous
      : {
          sessionId: input.sessionId,
          state: 'unknown',
          source: 'lifecycle',
          reason: 'initial-state',
          observedAtMs: input.observedAtMs,
          pendingIdleSinceMs: null,
          pendingIdleConfirmations: 0,
        }
  const candidate = normalizeCandidate(input.candidate)
  if (candidate === null) {
    return {
      observation: baseline,
      changed: false,
      idleConfirmationDelayMs: null,
    }
  }

  if (baseline.state === 'working' && candidate.state === 'idle') {
    const pendingIdleSinceMs = baseline.pendingIdleSinceMs ?? clampObservedAtMs(input.observedAtMs)
    const pendingIdleConfirmations = baseline.pendingIdleConfirmations + 1
    const elapsedMs = Math.max(0, clampObservedAtMs(input.observedAtMs) - pendingIdleSinceMs)
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
    state: candidate.state,
    source: candidate.source,
    reason: candidate.reason,
    observedAtMs: clampObservedAtMs(input.observedAtMs),
    pendingIdleSinceMs: null,
    pendingIdleConfirmations: 0,
  }
  return {
    observation,
    changed: baseline.state !== observation.state,
    idleConfirmationDelayMs: null,
  }
}

export function createAgentExecutionTracker(input: {
  sessionId: string
  toolKind: string | null | undefined
  initialState?: AgentExecutionState | null
  observedAtMs: number
}): AgentExecutionTracker {
  const initialState = normalizeAgentExecutionState(input.initialState)
  return {
    sessionId: input.sessionId,
    toolKind: input.toolKind?.trim() ?? '',
    outputTail: '',
    observation: {
      sessionId: input.sessionId,
      state: initialState,
      source: 'lifecycle',
      reason: 'initial-state',
      observedAtMs: clampObservedAtMs(input.observedAtMs),
      pendingIdleSinceMs: null,
      pendingIdleConfirmations: 0,
    },
    pendingCandidate: null,
    idleGraceUntilMs: 0,
  }
}

export function observeAgentExecutionIntent(
  tracker: AgentExecutionTracker,
  input: { observedAtMs: number; source?: 'launch' | 'input' },
): AgentExecutionTrackerTransition {
  const source = input.source ?? 'input'
  return buildTrackerTransition(
    {
      ...tracker,
      // A submitted turn starts a new semantic epoch. Keeping the previous
      // prompt here would make the next ordinary echo look like completion.
      outputTail: '',
      idleGraceUntilMs: clampObservedAtMs(input.observedAtMs) + AGENT_EXECUTION_INTENT_GRACE_MS,
    },
    {
      state: 'working',
      source,
      reason: source === 'launch' ? 'launch-command' : 'input-submitted',
    },
    input.observedAtMs,
  )
}

export function observeAgentExecutionOutput(
  tracker: AgentExecutionTracker,
  input: { text: string; observedAtMs: number },
): AgentExecutionTrackerTransition {
  const outputTail = `${tracker.outputTail}${input.text}`.slice(-AGENT_EXECUTION_OUTPUT_TAIL_MAX_CHARS)
  const transition = buildTrackerTransition(
    { ...tracker, outputTail },
    detectAgentExecutionOutputCandidate(outputTail, tracker.toolKind),
    input.observedAtMs,
  )
  return transition
}

export function observeAgentExecutionScreen(
  tracker: AgentExecutionTracker,
  input: { snapshot: Pick<RenderedScreenSnapshot, 'rows'>; observedAtMs: number },
): AgentExecutionTrackerTransition {
  return buildTrackerTransition(
    tracker,
    detectAgentExecutionCandidate(input.snapshot, tracker.toolKind),
    input.observedAtMs,
  )
}

export function confirmAgentExecutionTracker(
  tracker: AgentExecutionTracker,
  input: { observedAtMs: number },
): AgentExecutionTrackerTransition {
  return buildTrackerTransition(tracker, tracker.pendingCandidate, input.observedAtMs)
}
