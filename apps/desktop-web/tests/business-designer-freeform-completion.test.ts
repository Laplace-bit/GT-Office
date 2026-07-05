import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasRunningDesignerFreeformRun,
  type DesignerFreeformCompletionRun,
} from '../src/features/business-designer/model/designer-freeform-completion.js'

function run(status: DesignerFreeformCompletionRun['status']): DesignerFreeformCompletionRun {
  return {
    requestId: `request-${status}`,
    workspaceId: 'workspace-1',
    documentId: 'document-1',
    scenario: 'expand_canvas',
    hostBlockId: null,
    provider: 'claude',
    sessionId: `headless:${status}`,
    documentRoot: '/workspace/.gtoffice/docs/documents/document-1',
    checkpointBefore: 'abc123',
    status,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    userPromptSummary: null,
  }
}

test('business designer freeform running state follows persisted run status', () => {
  assert.equal(hasRunningDesignerFreeformRun([]), false)
  assert.equal(hasRunningDesignerFreeformRun([run('completed'), run('failed')]), false)
  assert.equal(hasRunningDesignerFreeformRun([run('cancelled')]), false)
  assert.equal(hasRunningDesignerFreeformRun([run('completed'), run('running')]), true)
})
