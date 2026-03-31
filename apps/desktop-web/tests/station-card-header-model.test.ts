import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStationCardIdentityMeta,
  handleStationCardPrimaryLaunch,
  resolveStationCardLaunchIcon,
  resolveStationCardLaunchState,
} from '../src/features/workspace-hub/station-card-header-model.js'

test('primary launch starts the current cli agent when the card has no live session', () => {
  const calls: string[] = []

  handleStationCardPrimaryLaunch({
    stationId: 'agent-01',
    sessionId: null,
    agentRunning: false,
    onSelectStation: (stationId: string) => {
      calls.push(`select:${stationId}`)
    },
    requestTerminalFocus: () => {
      calls.push('focus')
    },
    onLaunchCliAgent: (stationId: string) => {
      calls.push(`launch:${stationId}`)
    },
  })

  assert.deepEqual(calls, ['select:agent-01', 'focus', 'launch:agent-01'])
})

test('primary launch reuses the current session when the agent is already running', () => {
  const calls: string[] = []

  handleStationCardPrimaryLaunch({
    stationId: 'agent-02',
    sessionId: 'ts_002',
    agentRunning: true,
    onSelectStation: (stationId: string) => {
      calls.push(`select:${stationId}`)
    },
    requestTerminalFocus: () => {
      calls.push('focus')
    },
    onLaunchCliAgent: (stationId: string) => {
      calls.push(`launch:${stationId}`)
    },
  })

  assert.deepEqual(calls, ['select:agent-02', 'focus'])
})

test('primary launch still starts cli agent when the terminal session exists but the agent process is absent', () => {
  const calls: string[] = []

  handleStationCardPrimaryLaunch({
    stationId: 'agent-03',
    sessionId: 'ts_003',
    agentRunning: false,
    onSelectStation: (stationId: string) => {
      calls.push(`select:${stationId}`)
    },
    requestTerminalFocus: () => {
      calls.push('focus')
    },
    onLaunchCliAgent: (stationId: string) => {
      calls.push(`launch:${stationId}`)
    },
  })

  assert.deepEqual(calls, ['select:agent-03', 'focus', 'launch:agent-03'])
})

test('header identity meta exposes name, role, and tool in grouped order while launch state follows actual agent runtime', () => {
  assert.deepEqual(buildStationCardIdentityMeta('Alpha', '产品角色', 'codex cli'), [
    { kind: 'name', label: 'Alpha' },
    { kind: 'role', label: '产品角色' },
    { kind: 'tool', label: 'codex cli' },
  ])
  assert.equal(resolveStationCardLaunchState({ sessionId: 'ts_003', stateRaw: null, agentRunning: true }), 'live')
  assert.equal(resolveStationCardLaunchState({ sessionId: 'ts_003', stateRaw: null, agentRunning: false }), 'idle')
  assert.equal(resolveStationCardLaunchState({ sessionId: null, stateRaw: 'failed', agentRunning: false }), 'alert')
  assert.equal(resolveStationCardLaunchState({ sessionId: null, stateRaw: null, agentRunning: false }), 'idle')
})

test('launch icon switches to a softer circle indicator only while the agent is live', () => {
  assert.equal(resolveStationCardLaunchIcon('idle'), 'play')
  assert.equal(resolveStationCardLaunchIcon('live'), 'circle')
  assert.equal(resolveStationCardLaunchIcon('alert'), 'play')
})
