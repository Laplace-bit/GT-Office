import type { SessionCard, SessionProvider } from '@shell/integration/desktop-api'
import {
  normalizeStationToolKind,
  type StationToolKind,
} from '@features/workspace-hub/station-model'

export type { SessionCard, SessionProvider }

/** Map station tool config to the provider whose sessions should be shown. */
export function stationToolKindToSessionProvider(toolKind: StationToolKind): SessionProvider | null {
  if (toolKind === 'claude') {
    return 'claude'
  }
  if (toolKind === 'codex') {
    return 'codex'
  }
  return null
}

/** Resolve provider from station tool fields (toolKind may be absent on older snapshots). */
export function resolveStationSessionProvider(station: {
  tool: string
  toolKind?: StationToolKind
}): SessionProvider | null {
  const kind = station.toolKind ?? normalizeStationToolKind(station.tool)
  return stationToolKindToSessionProvider(kind)
}

export interface SessionHistoryState {
  cards: SessionCard[]
  loading: boolean
  error: string | null
}

export function initialSessionHistoryState(): SessionHistoryState {
  return { cards: [], loading: false, error: null }
}

export function providerIcon(provider: SessionProvider): string {
  switch (provider) {
    case 'claude': return 'sparkles'
    case 'codex': return 'bolt'
  }
}

export function providerLabel(provider: SessionProvider): string {
  switch (provider) {
    case 'claude': return 'Claude'
    case 'codex': return 'Codex'
  }
}

export function formatRelativeTime(ms: number): string {
  const now = Date.now()
  const diff = now - ms
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

export function hasStats(card: SessionCard): boolean {
  return card.filesChanged > 0 || card.insertions > 0 || card.deletions > 0 || card.commitsAhead > 0
}