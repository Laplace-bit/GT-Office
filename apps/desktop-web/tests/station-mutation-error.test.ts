import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveStationMutationErrorMessage } from '../src/features/workspace-hub/station-mutation-error.js'

test('formats create-agent errors for zh-CN users', () => {
  assert.equal(
    resolveStationMutationErrorMessage('zh-CN', 'create', new Error('role_id not found')),
    '新增 agent 失败：role_id not found',
  )
})

test('formats update-agent errors for en-US users and non-error values', () => {
  assert.equal(
    resolveStationMutationErrorMessage('en-US', 'update', 'AGENT_WORKDIR_INVALID'),
    'Failed to update agent: AGENT_WORKDIR_INVALID',
  )
})
