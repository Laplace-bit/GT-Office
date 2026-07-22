import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSessionHistoryCacheKey,
  createSessionHistoryCache,
  resolveCachedSessionHistory,
} from '../src/features/session/session-history-cache.js'
import type { SessionCard } from '../src/shell/integration/desktop-api.js'

function makeCard(id: string): SessionCard {
  return {
    gtoSessionId: id,
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    provider: 'codex',
    lifecycle: 'stopped',
    providerSessionId: null,
    title: id,
    cwd: '/workspace/agent-1',
    startedAtMs: 1,
    lastActivityAtMs: 1,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    commitsAhead: 0,
  }
}

test('session history cache reuses a loaded Station result without rescanning', async () => {
  const cache = createSessionHistoryCache()
  const key = buildSessionHistoryCacheKey('workspace-1', 'codex', '/workspace/agent-1')
  let scans = 0

  const first = await resolveCachedSessionHistory(cache, key, false, async () => {
    scans += 1
    return [makeCard(`session-${scans}`)]
  })
  const second = await resolveCachedSessionHistory(cache, key, false, async () => {
    scans += 1
    return [makeCard(`session-${scans}`)]
  })

  assert.equal(scans, 1)
  assert.deepEqual(second, first)
})

test('session history cache bypasses stale data for an explicit refresh', async () => {
  const cache = createSessionHistoryCache()
  const key = buildSessionHistoryCacheKey('workspace-1', 'claude', '/workspace/agent-2')
  let scans = 0
  const scan = async () => {
    scans += 1
    return [makeCard(`session-${scans}`)]
  }

  await resolveCachedSessionHistory(cache, key, false, scan)
  const refreshed = await resolveCachedSessionHistory(cache, key, true, scan)

  assert.equal(scans, 2)
  assert.equal(refreshed[0]?.gtoSessionId, 'session-2')
})
