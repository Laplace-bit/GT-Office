import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveStationActionPreferenceKey,
  resolveStationActionTooltip,
} from '../src/features/workspace-hub/station-action-copy.js'

function createAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'codex-model',
    label: 'Model',
    shortLabel: '/model',
    slashCommand: '/model',
    tooltip: 'Choose the active Codex model',
    icon: 'sparkles',
    providerKind: 'codex',
    commandFamily: 'built_in',
    kind: 'provider_native',
    category: 'prompt_insert',
    surfaceTarget: 'terminal',
    scopeKind: 'station',
    priority: 10,
    group: 'session',
    requiresLiveSession: true,
    supportsDetachedWindow: true,
    supportsParallelTargets: false,
    presentation: 'direct',
    dangerLevel: 'safe',
    defaultPinned: false,
    execution: {
      type: 'insert_and_submit',
      text: '/model',
    },
    ...overrides,
  }
}

test('normalizes multi-word slash commands into preference keys', () => {
  assert.equal(
    resolveStationActionPreferenceKey(
      createAction({
        id: 'codex-tools-desc',
        slashCommand: '/tools desc',
      }),
    ),
    'tools-desc',
  )
})

test('prefers localized provider metadata over backend english tooltips', () => {
  assert.equal(
    resolveStationActionTooltip('zh-CN', createAction()),
    '调整模型、推理强度或执行模式。',
  )
})

test('localizes disabled live-session guidance for quick commands', () => {
  assert.equal(
    resolveStationActionTooltip(
      'zh-CN',
      createAction({
        disabled: true,
        disabledReason: 'Start a live Codex session first',
        }),
    ),
    '请先启动一个 Codex 实时会话。',
  )
})
