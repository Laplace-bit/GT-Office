import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isStationAgentProcessRunning,
  matchesStationToolProcess,
  resolveStationCliLaunchCommand,
} from '../src/features/workspace-hub/station-agent-runtime-model.js'

test('matches codex and claude processes from executable names and command arguments', () => {
  assert.equal(
    matchesStationToolProcess('codex', {
      pid: 42,
      parentPid: 12,
      executable: 'node',
      args: '/usr/local/lib/node_modules/@openai/codex/bin/codex.js',
      depth: 1,
    }),
    true,
  )
  assert.equal(
    matchesStationToolProcess('claude', {
      pid: 43,
      parentPid: 12,
      executable: 'claude',
      args: 'claude',
      depth: 1,
    }),
    true,
  )
  assert.equal(
    matchesStationToolProcess('gemini', {
      pid: 44,
      parentPid: 12,
      executable: 'zsh',
      args: '-zsh',
      depth: 0,
    }),
    false,
  )
})

test('detects whether the station agent is actually running inside the current terminal session', () => {
  assert.equal(
    isStationAgentProcessRunning('codex', {
      sessionId: 'ts_101',
      rootPid: 10,
      currentProcess: {
        pid: 11,
        parentPid: 10,
        executable: 'codex',
        args: 'codex',
        depth: 1,
      },
      processes: [
        {
          pid: 10,
          parentPid: 1,
          executable: 'zsh',
          args: '-zsh',
          depth: 0,
        },
        {
          pid: 11,
          parentPid: 10,
          executable: 'codex',
          args: 'codex',
          depth: 1,
        },
      ],
    }),
    true,
  )
  assert.equal(
    isStationAgentProcessRunning('codex', {
      sessionId: 'ts_102',
      rootPid: 20,
      currentProcess: {
        pid: 20,
        parentPid: 1,
        executable: 'zsh',
        args: '-zsh',
        depth: 0,
      },
      processes: [
        {
          pid: 20,
          parentPid: 1,
          executable: 'zsh',
          args: '-zsh',
          depth: 0,
        },
      ],
    }),
    false,
  )
})

test('resolves the default cli launch command from the station tool kind', () => {
  assert.equal(resolveStationCliLaunchCommand('codex'), 'codex')
  assert.equal(resolveStationCliLaunchCommand('claude'), 'claude')
  assert.equal(resolveStationCliLaunchCommand('gemini'), 'gemini')
  assert.equal(resolveStationCliLaunchCommand('shell'), null)
})
