import test from 'node:test'
import assert from 'node:assert/strict'
import {
  confirmAgentExecutionTracker,
  createAgentExecutionTracker,
  detectAgentExecutionState,
  observeAgentExecutionIntent,
  observeAgentExecutionOutput,
  transitionAgentExecutionState,
} from '../src/features/terminal/agent-execution-state.js'

function snapshot(lines: string[]) {
  return {
    rows: lines.map((text, rowIndex) => ({
      rowIndex,
      text,
      trimmedText: text.trim(),
      isBlank: text.trim().length === 0,
    })),
  }
}

test('detects the visible Codex working marker and ignores transcript viewers', () => {
  assert.equal(
    detectAgentExecutionState(snapshot(['• Working (esc to interrupt)']), 'codex'),
    'working',
  )
  assert.equal(
    detectAgentExecutionState(snapshot(['Showing transcript', 'Use PgUp/PgDn to scroll']), 'codex'),
    null,
  )
})

test('detects interactive and blocked terminal screens before the ready prompt', () => {
  assert.equal(
    detectAgentExecutionState(snapshot(['Do you want to continue? [y/n]']), 'codex'),
    'waiting',
  )
  assert.equal(
    detectAgentExecutionState(snapshot(['Action required: sign in before continuing']), 'codex'),
    'blocked',
  )
  assert.equal(
    detectAgentExecutionState(snapshot(['Task complete', '›']), 'codex'),
    'idle',
  )
})

test('requires three observations before changing from working to ready', () => {
  const working = transitionAgentExecutionState(null, {
    sessionId: 'session-1',
    candidate: 'working',
    observedAtMs: 0,
  }).observation
  const firstIdle = transitionAgentExecutionState(working, {
    sessionId: 'session-1',
    candidate: 'idle',
    observedAtMs: 100,
  })
  const secondIdle = transitionAgentExecutionState(firstIdle.observation, {
    sessionId: 'session-1',
    candidate: 'idle',
    observedAtMs: 200,
  })
  const confirmedIdle = transitionAgentExecutionState(secondIdle.observation, {
    sessionId: 'session-1',
    candidate: 'idle',
    observedAtMs: 300,
  })

  assert.equal(firstIdle.observation.state, 'working')
  assert.equal(firstIdle.idleConfirmationDelayMs, 100)
  assert.equal(secondIdle.observation.state, 'working')
  assert.equal(confirmedIdle.observation.state, 'idle')
  assert.equal(confirmedIdle.changed, true)
})

test('tracks task execution from the background output stream and only notifies after ready is confirmed', () => {
  let tracker = createAgentExecutionTracker({
    sessionId: 'session-1',
    toolKind: 'codex',
    initialState: 'idle',
    observedAtMs: 0,
  })

  const submitted = observeAgentExecutionIntent(tracker, {
    observedAtMs: 10,
  })
  tracker = submitted.tracker
  assert.equal(submitted.transition.observation.state, 'working')
  assert.equal(submitted.transition.observation.source, 'input')
  assert.equal(submitted.notification, null)

  const workingOutput = observeAgentExecutionOutput(tracker, {
    text: '\u001b[2K\r• Working (esc to interrupt)',
    observedAtMs: 20,
  })
  tracker = workingOutput.tracker
  assert.equal(workingOutput.transition.observation.state, 'working')
  assert.equal(workingOutput.transition.observation.source, 'terminal-output')

  const idleCandidate = observeAgentExecutionOutput(tracker, {
    text: '\r\n› ',
    observedAtMs: 500,
  })
  tracker = idleCandidate.tracker
  assert.equal(idleCandidate.transition.observation.state, 'working')
  assert.equal(idleCandidate.transition.idleConfirmationDelayMs, 100)

  const secondObservation = confirmAgentExecutionTracker(tracker, { observedAtMs: 600 })
  tracker = secondObservation.tracker
  assert.equal(secondObservation.transition.observation.state, 'working')

  const completed = confirmAgentExecutionTracker(tracker, { observedAtMs: 700 })
  assert.equal(completed.transition.observation.state, 'idle')
  assert.equal(completed.transition.observation.source, 'terminal-output')
  assert.equal(completed.notification, 'completed')
})

test('does not mistake a stale prompt for completion immediately after input', () => {
  const tracker = createAgentExecutionTracker({
    sessionId: 'session-1',
    toolKind: 'codex',
    initialState: 'idle',
    observedAtMs: 0,
  })
  const submitted = observeAgentExecutionIntent(tracker, { observedAtMs: 10 })
  const stalePrompt = observeAgentExecutionOutput(submitted.tracker, {
    text: '\r\n› ',
    observedAtMs: 20,
  })

  assert.equal(stalePrompt.transition.observation.state, 'working')
  assert.ok((stalePrompt.transition.idleConfirmationDelayMs ?? 0) > 100)
  assert.equal(stalePrompt.notification, null)
})

test('makes waiting and blocked states explicit from terminal output instead of falling back to connected', () => {
  const workingTracker = createAgentExecutionTracker({
    sessionId: 'session-1',
    toolKind: 'claude',
    initialState: 'working',
    observedAtMs: 0,
  })
  const waiting = observeAgentExecutionOutput(workingTracker, {
    text: 'Do you want to continue? [y/n]',
    observedAtMs: 100,
  })
  assert.equal(waiting.transition.observation.state, 'waiting')
  assert.equal(waiting.transition.observation.reason, 'input-request')
  assert.equal(waiting.notification, 'awaiting-input')

  const approval = observeAgentExecutionOutput(workingTracker, {
    text: 'Allow this tool to run? [y/n]',
    observedAtMs: 150,
  })
  assert.equal(approval.transition.observation.state, 'waiting')
  assert.equal(approval.transition.observation.reason, 'input-request')

  const blocked = observeAgentExecutionOutput(waiting.tracker, {
    text: '\nAction required: sign in before continuing',
    observedAtMs: 200,
  })
  assert.equal(blocked.transition.observation.state, 'blocked')
  assert.equal(blocked.transition.observation.reason, 'attention-required')
  assert.equal(blocked.notification, 'blocked')
})
