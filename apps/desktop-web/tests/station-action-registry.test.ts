import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStationActionRailModel } from '../src/features/workspace-hub/station-action-registry.js'
import { getStationActionDisplayLabel, type StationActionDescriptor } from '../src/features/workspace-hub/station-action-model.js'

function createAction(
  id: string,
  slashCommand: string,
  priority: number,
): StationActionDescriptor {
  return {
    id: `codex-${id}`,
    label: slashCommand,
    shortLabel: slashCommand,
    slashCommand,
    tooltip: `Run ${slashCommand}`,
    icon: 'command',
    providerKind: 'codex',
    commandFamily: 'built_in',
    kind: 'provider_native',
    category: 'prompt_insert',
    surfaceTarget: 'terminal',
    scopeKind: 'station',
    priority,
    group: 'prompt',
    requiresLiveSession: false,
    supportsDetachedWindow: true,
    supportsParallelTargets: false,
    presentation: 'direct',
    dangerLevel: 'safe',
    defaultPinned: false,
    execution: {
      type: 'insert_text',
      text: slashCommand,
    },
  }
}

test('buildStationActionRailModel respects explicit capsule order and appends custom capsules', () => {
  const actions = [
    createAction('model', '/model', 1),
    createAction('plan', '/plan', 2),
  ]

  const rail = buildStationActionRailModel(actions, {
    pinnedCommandIdsByProvider: {
      codex: ['plan', 'model'],
    },
    customCommandCapsulesByProvider: {
      codex: [
        {
          id: 'review-diff',
          label: 'Review diff',
          text: 'Review the current diff and call out risks.',
          submitMode: 'insert_and_submit',
          createdAt: 1710000000000,
        },
      ],
    },
    orderedCommandCapsuleIdsByProvider: {
      codex: ['custom:review-diff', 'preset:plan', 'preset:model'],
    },
  } as never)

  assert.deepEqual(
    rail.primaryActions.map((action: StationActionDescriptor) => getStationActionDisplayLabel(action)),
    ['Review diff', '/plan', '/model'],
  )
  assert.deepEqual(
    rail.primaryActions.map((action: StationActionDescriptor) => action.execution.type),
    ['insert_and_submit', 'insert_text', 'insert_text'],
  )
})
