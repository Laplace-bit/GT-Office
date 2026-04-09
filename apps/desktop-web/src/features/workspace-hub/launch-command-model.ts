import type { StationToolKind } from './station-model.js'

export type LaunchCommandHistory = Partial<Record<StationToolKind, string[]>>

const STORAGE_KEY = 'gtoffice.launchCommandHistory.v1'
const MAX_ENTRIES_PER_PROVIDER = 5

export function loadLaunchCommandHistory(): LaunchCommandHistory {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as LaunchCommandHistory
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    return parsed
  } catch {
    return {}
  }
}

export function saveLaunchCommandHistory(history: LaunchCommandHistory): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
}

export function clearLaunchCommandHistory(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.removeItem(STORAGE_KEY)
}

export function recordLaunchCommand(
  provider: StationToolKind,
  command: string,
): LaunchCommandHistory {
  const trimmed = command.trim()
  if (!trimmed || provider === 'shell' || provider === 'unknown') {
    return loadLaunchCommandHistory()
  }
  const history = loadLaunchCommandHistory()
  const existing = history[provider] ?? []
  const filtered = existing.filter((entry) => entry !== trimmed)
  const updated = [trimmed, ...filtered].slice(0, MAX_ENTRIES_PER_PROVIDER)
  const result: LaunchCommandHistory = { ...history, [provider]: updated }
  saveLaunchCommandHistory(result)
  return result
}

export function getLaunchCommandHistoryForProvider(
  history: LaunchCommandHistory,
  provider: StationToolKind,
): string[] {
  return history[provider] ?? []
}