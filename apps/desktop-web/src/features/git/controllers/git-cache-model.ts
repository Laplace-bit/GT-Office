import type {
  GitDiffExpansionResponse,
  GitDiffStructuredResponse,
} from '@shell/integration/desktop-api'

export function getLruCacheValue<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const value = cache.get(key)
  if (value === undefined) {
    return undefined
  }
  cache.delete(key)
  cache.set(key, value)
  return value
}

export function setLruCacheValue<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): void {
  if (maxEntries <= 0) {
    return
  }
  cache.delete(key)
  while (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    cache.delete(oldestKey)
  }
  cache.set(key, value)
}

export function compactStructuredDiff(
  diff: GitDiffStructuredResponse,
): GitDiffStructuredResponse {
  return diff.patch ? { ...diff, patch: '' } : diff
}

export function compactExpandedDiff(
  expanded: GitDiffExpansionResponse,
): GitDiffExpansionResponse {
  if (!expanded.fullDiff?.patch) {
    return expanded
  }
  return {
    ...expanded,
    fullDiff: compactStructuredDiff(expanded.fullDiff),
  }
}
