import type { SessionCard, SessionProvider } from '@shell/integration/desktop-api'

export const SESSION_HISTORY_CACHE_MAX_ENTRIES = 32

export interface SessionHistoryCache {
  entries: Map<string, SessionCard[]>
  inFlight: Map<string, Promise<SessionCard[]>>
  maxEntries: number
}

export function buildSessionHistoryCacheKey(
  workspaceId: string,
  provider: SessionProvider,
  discoverCwd: string | null,
): string {
  return JSON.stringify([workspaceId, provider, discoverCwd])
}

export function createSessionHistoryCache(
  maxEntries = SESSION_HISTORY_CACHE_MAX_ENTRIES,
): SessionHistoryCache {
  return {
    entries: new Map(),
    inFlight: new Map(),
    maxEntries: Math.max(1, maxEntries),
  }
}

export function getCachedSessionHistory(
  cache: SessionHistoryCache,
  key: string,
): SessionCard[] | null {
  const cached = cache.entries.get(key)
  if (!cached) {
    return null
  }
  cache.entries.delete(key)
  cache.entries.set(key, cached)
  return cached
}

function cacheSessionHistory(cache: SessionHistoryCache, key: string, cards: SessionCard[]): SessionCard[] {
  const cachedCards = [...cards]
  cache.entries.delete(key)
  while (cache.entries.size >= cache.maxEntries) {
    const oldestKey = cache.entries.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    cache.entries.delete(oldestKey)
  }
  cache.entries.set(key, cachedCards)
  return cachedCards
}

export async function resolveCachedSessionHistory(
  cache: SessionHistoryCache,
  key: string,
  force: boolean,
  load: () => Promise<SessionCard[]>,
): Promise<SessionCard[]> {
  if (!force) {
    const cached = getCachedSessionHistory(cache, key)
    if (cached) {
      return cached
    }
  }

  const pending = cache.inFlight.get(key)
  if (pending) {
    return pending
  }

  const request = load().then((cards) => cacheSessionHistory(cache, key, cards))
  cache.inFlight.set(key, request)
  try {
    return await request
  } finally {
    if (cache.inFlight.get(key) === request) {
      cache.inFlight.delete(key)
    }
  }
}
