import test from 'node:test'
import assert from 'node:assert/strict'

import {
  areWorkspaceGitSummariesEquivalent,
  resolveCachedWorkspaceGitSummary,
  resolveWorkspaceGitStatusFiles,
  shouldAdoptActiveWorkspace,
  shouldApplyWorkspaceGitSummaryRefreshResult,
  shouldClearWorkspaceStateForCloseResult,
  shouldClearWorkspaceStateForClosedEvent,
} from '../src/shell/layout/workspace-git-summary-model.js'
import type { GitStatusResponse } from '../src/shell/integration/desktop-api.js'

function buildSummary(workspaceId: string, branch: string): GitStatusResponse {
  return {
    workspaceId,
    primaryRepositoryPath: '.',
    branch,
    ahead: 0,
    behind: 0,
    files: [],
    repositories: [],
    totalChanges: 0,
    truncated: false,
    kind: 'root',
    state: 'ready',
  }
}

test('restores cached git summary for a revisited workspace immediately', () => {
  const cache = new Map<string, GitStatusResponse | null>([
    ['ws-a', buildSummary('ws-a', 'main')],
    ['ws-b', buildSummary('ws-b', 'release')],
  ])

  assert.deepEqual(resolveCachedWorkspaceGitSummary(cache, 'ws-b'), buildSummary('ws-b', 'release'))
  assert.equal(resolveCachedWorkspaceGitSummary(cache, 'ws-c'), null)
  assert.equal(resolveCachedWorkspaceGitSummary(cache, null), null)
})

test('does not repeat workspace adoption while context loading is still in flight', () => {
  assert.equal(
    shouldAdoptActiveWorkspace({
      requestedWorkspaceId: 'ws-b',
      activeWorkspaceId: 'ws-b',
    }),
    false,
  )
  assert.equal(
    shouldAdoptActiveWorkspace({
      requestedWorkspaceId: 'ws-b',
      activeWorkspaceId: 'ws-a',
    }),
    true,
  )
})

test('passes git files only when the summary belongs to the presented workspace', () => {
  const summary = {
    ...buildSummary('ws-a', 'main'),
    files: [
      {
        path: 'src/main.ts',
        staged: false,
        status: ' M',
        repositoryPath: '',
        repoRelativePath: 'src/main.ts',
        entryKind: 'file' as const,
      },
    ],
  }

  assert.equal(resolveWorkspaceGitStatusFiles(summary, 'ws-a'), summary.files)
  assert.deepEqual(resolveWorkspaceGitStatusFiles(summary, 'ws-b'), [])
  assert.deepEqual(resolveWorkspaceGitStatusFiles(summary, null), [])
})

test('a null close result clears state only when the closed workspace is still active', () => {
  assert.equal(
    shouldClearWorkspaceStateForCloseResult({
      closedWorkspaceId: 'ws-a',
      activeWorkspaceId: 'ws-a',
      nextActiveWorkspaceId: null,
    }),
    true,
  )
  assert.equal(
    shouldClearWorkspaceStateForCloseResult({
      closedWorkspaceId: 'ws-inactive',
      activeWorkspaceId: 'ws-active',
      nextActiveWorkspaceId: null,
    }),
    false,
  )
  assert.equal(
    shouldClearWorkspaceStateForCloseResult({
      closedWorkspaceId: 'ws-a',
      activeWorkspaceId: 'ws-a',
      nextActiveWorkspaceId: 'ws-b',
    }),
    false,
  )
})

test('accepts git refresh results only for the active workspace and latest request', () => {
  assert.equal(
    shouldApplyWorkspaceGitSummaryRefreshResult({
      workspaceId: 'ws-b',
      activeWorkspaceId: 'ws-b',
      requestId: 4,
      latestRequestId: 4,
    }),
    true,
  )

  assert.equal(
    shouldApplyWorkspaceGitSummaryRefreshResult({
      workspaceId: 'ws-a',
      activeWorkspaceId: 'ws-b',
      requestId: 3,
      latestRequestId: 4,
    }),
    false,
  )

  assert.equal(
    shouldApplyWorkspaceGitSummaryRefreshResult({
      workspaceId: 'ws-b',
      activeWorkspaceId: 'ws-b',
      requestId: 3,
      latestRequestId: 4,
    }),
    false,
  )
})

test('rejects an in-flight git refresh after the active workspace is cleared', () => {
  assert.equal(
    shouldApplyWorkspaceGitSummaryRefreshResult({
      workspaceId: 'ws-a',
      activeWorkspaceId: null,
      requestId: 5,
      latestRequestId: 5,
    }),
    false,
  )

  assert.equal(resolveCachedWorkspaceGitSummary(new Map(), null), null)
})

test('treats unchanged git content as equivalent regardless of event revision', () => {
  const current = { ...buildSummary('ws-a', 'main'), revision: 3 }
  const next = { ...buildSummary('ws-a', 'main'), revision: 4 }

  assert.equal(areWorkspaceGitSummariesEquivalent(current, next), true)
  assert.equal(
    areWorkspaceGitSummariesEquivalent(current, buildSummary('ws-a', 'release')),
    false,
  )
  assert.equal(areWorkspaceGitSummariesEquivalent(current, null), false)
})

test('detects top-level truncation and repository-state changes while ignoring revision', () => {
  const current = { ...buildSummary('ws-a', 'main'), revision: 3 }

  assert.equal(
    areWorkspaceGitSummariesEquivalent(current, { ...current, totalChanges: 12 }),
    false,
  )
  assert.equal(
    areWorkspaceGitSummariesEquivalent(current, { ...current, truncated: true }),
    false,
  )
  assert.equal(
    areWorkspaceGitSummariesEquivalent(current, { ...current, state: 'invalid' }),
    false,
  )
  assert.equal(
    areWorkspaceGitSummariesEquivalent(current, { ...current, headOid: 'abc123' }),
    false,
  )
})

test('clears closed workspace state for the active or locked window only', () => {
  assert.equal(
    shouldClearWorkspaceStateForClosedEvent({
      closedWorkspaceId: 'ws-active',
      activeWorkspaceId: 'ws-active',
      lockedWorkspaceId: null,
    }),
    true,
  )
  assert.equal(
    shouldClearWorkspaceStateForClosedEvent({
      closedWorkspaceId: 'ws-detached',
      activeWorkspaceId: 'ws-main',
      lockedWorkspaceId: 'ws-detached',
    }),
    true,
  )
  assert.equal(
    shouldClearWorkspaceStateForClosedEvent({
      closedWorkspaceId: 'ws-other',
      activeWorkspaceId: 'ws-main',
      lockedWorkspaceId: 'ws-detached',
    }),
    false,
  )
})
