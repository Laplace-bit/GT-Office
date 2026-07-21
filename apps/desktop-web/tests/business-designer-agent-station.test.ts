import test from 'node:test'
import assert from 'node:assert/strict'

import {
  scenarioForBlockKind,
} from '../src/features/business-designer/model/designer-agent-station.js'

test('scenarioForBlockKind maps the brief block to brief_to_design', () => {
  assert.equal(scenarioForBlockKind('text'), 'brief_to_design')
})

test('scenarioForBlockKind maps entity-like blocks to complete_entity', () => {
  assert.equal(scenarioForBlockKind('entityModel'), 'complete_entity')
  assert.equal(scenarioForBlockKind('objectModel'), 'complete_entity')
  assert.equal(scenarioForBlockKind('dataContract'), 'complete_entity')
})

test('scenarioForBlockKind maps flow-like blocks to complete_flow', () => {
  assert.equal(scenarioForBlockKind('businessFlow'), 'complete_flow')
  assert.equal(scenarioForBlockKind('uiWorkflow'), 'complete_flow')
})

test('scenarioForBlockKind maps apiContract to complete_api_contract', () => {
  assert.equal(scenarioForBlockKind('apiContract'), 'complete_api_contract')
})

test('scenarioForBlockKind falls back to expand_canvas for every other kind', () => {
  const others = [
    'glossary',
    'ruleTable',
    'pseudocode',
    'uiScreen',
    'technicalStack',
    'nonFunctional',
    'acceptanceCriteria',
    'openQuestions',
    'agentInstruction',
    'decisionRecord',
  ]
  for (const kind of others) {
    assert.equal(scenarioForBlockKind(kind), 'expand_canvas')
  }
})
