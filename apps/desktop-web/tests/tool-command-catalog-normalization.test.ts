import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeToolListCommandsResponse,
} from '../src/shell/integration/desktop-api.js'

test('normalizes missing command arguments and enum options to empty arrays', () => {
  const response = normalizeToolListCommandsResponse({
    workspaceId: 'workspace-1',
    catalogVersion: 1,
    station: {
      hasTerminalSession: true,
      detachedReadonly: false,
    },
    commands: [
      {
        id: 'prompt',
        label: 'Prompt',
        commandFamily: 'built_in',
        icon: 'sparkles',
        providerKind: 'codex',
        kind: 'provider_native',
        category: 'prompt_insert',
        surfaceTarget: 'terminal',
        scopeKind: 'station',
        group: 'prompt',
        priority: 10,
        presentation: 'direct',
        dangerLevel: 'safe',
        defaultPinned: false,
        enabled: true,
        requiresLiveSession: true,
        supportsDetachedWindow: true,
        supportsParallelTargets: false,
        execution: {
          type: 'open_command_sheet',
          command: '/prompt',
          submit: false,
        },
      },
      {
        id: 'effort',
        label: 'Effort',
        commandFamily: 'built_in',
        icon: 'sparkles',
        providerKind: 'codex',
        kind: 'provider_native',
        category: 'prompt_insert',
        surfaceTarget: 'terminal',
        scopeKind: 'station',
        group: 'prompt',
        priority: 20,
        presentation: 'direct',
        dangerLevel: 'safe',
        defaultPinned: false,
        enabled: true,
        requiresLiveSession: true,
        supportsDetachedWindow: true,
        supportsParallelTargets: false,
        execution: {
          type: 'open_command_sheet',
          command: '/effort',
          submit: true,
        },
        arguments: [
          {
            name: 'level',
            label: 'Level',
            kind: 'enum',
            required: true,
          },
        ],
      },
    ],
  })

  assert.deepEqual(response.commands[0]?.arguments, [])
  assert.deepEqual(response.commands[1]?.arguments[0]?.options, [])
})
