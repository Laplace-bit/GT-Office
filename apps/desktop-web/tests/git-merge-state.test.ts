import test from 'node:test'
import assert from 'node:assert/strict'

import {
  IDLE_GIT_MERGE_UI_STATE,
  resolveGitMergeUiStateFromMergeStateResponse,
  resolveGitMergeUiStateFromStartMergeResult,
} from '../src/features/git/controllers/git-merge-state.js'

test('merge state model resets to idle after successful merge or when no merge is in progress', () => {
  assert.deepEqual(
    resolveGitMergeUiStateFromStartMergeResult({
      workspaceId: 'ws-1',
      success: true,
      conflicts: [{ path: 'src/conflicted.ts', status: 'both_modified' }],
      mergedCommit: 'abc123',
    }),
    IDLE_GIT_MERGE_UI_STATE,
  )

  assert.deepEqual(
    resolveGitMergeUiStateFromMergeStateResponse({
      workspaceId: 'ws-1',
      inProgress: false,
      conflicts: [{ path: 'src/conflicted.ts', status: 'both_modified' }],
    }),
    IDLE_GIT_MERGE_UI_STATE,
  )
})

test('merge state model preserves in-progress merges even after conflicts are resolved', () => {
  assert.deepEqual(
    resolveGitMergeUiStateFromStartMergeResult({
      workspaceId: 'ws-1',
      success: false,
      conflicts: [{ path: 'src/conflicted.ts', status: 'both_modified' }],
      mergedCommit: null,
    }),
    {
      isMerging: true,
      mergeConflicts: [{ path: 'src/conflicted.ts', status: 'both_modified' }],
    },
  )

  assert.deepEqual(
    resolveGitMergeUiStateFromMergeStateResponse({
      workspaceId: 'ws-1',
      inProgress: true,
      conflicts: [],
    }),
    {
      isMerging: true,
      mergeConflicts: [],
    },
  )
})
