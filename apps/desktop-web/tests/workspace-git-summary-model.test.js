import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCachedWorkspaceGitSummary, shouldApplyWorkspaceGitSummaryRefreshResult, } from '../src/shell/layout/workspace-git-summary-model.js';
function buildSummary(workspaceId, branch) {
    return {
        workspaceId,
        primaryRepositoryPath: '.',
        branch,
        ahead: 0,
        behind: 0,
        files: [],
        repositories: [],
    };
}
test('restores cached git summary for a revisited workspace immediately', () => {
    const cache = new Map([
        ['ws-a', buildSummary('ws-a', 'main')],
        ['ws-b', buildSummary('ws-b', 'release')],
    ]);
    assert.deepEqual(resolveCachedWorkspaceGitSummary(cache, 'ws-b'), buildSummary('ws-b', 'release'));
    assert.equal(resolveCachedWorkspaceGitSummary(cache, 'ws-c'), null);
    assert.equal(resolveCachedWorkspaceGitSummary(cache, null), null);
});
test('accepts git refresh results only for the active workspace and latest request', () => {
    assert.equal(shouldApplyWorkspaceGitSummaryRefreshResult({
        workspaceId: 'ws-b',
        activeWorkspaceId: 'ws-b',
        requestId: 4,
        latestRequestId: 4,
    }), true);
    assert.equal(shouldApplyWorkspaceGitSummaryRefreshResult({
        workspaceId: 'ws-a',
        activeWorkspaceId: 'ws-b',
        requestId: 3,
        latestRequestId: 4,
    }), false);
    assert.equal(shouldApplyWorkspaceGitSummaryRefreshResult({
        workspaceId: 'ws-b',
        activeWorkspaceId: 'ws-b',
        requestId: 3,
        latestRequestId: 4,
    }), false);
});
