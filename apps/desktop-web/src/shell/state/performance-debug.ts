export interface PerformanceDebugState {
  enabled: boolean
}

const STORAGE_KEY = 'gtoffice.performance.debug.v1'

export const defaultPerformanceDebugState: PerformanceDebugState = {
  enabled: true,
}

export function loadPerformanceDebugState(): PerformanceDebugState {
  if (typeof window === 'undefined') {
    return defaultPerformanceDebugState
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultPerformanceDebugState
    }
    const parsed = JSON.parse(raw) as Partial<PerformanceDebugState> | null
    return {
      enabled: parsed?.enabled === true,
    }
  } catch {
    return defaultPerformanceDebugState
  }
}

export function savePerformanceDebugState(state: PerformanceDebugState): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      enabled: state.enabled === true,
    }),
  )
}

export function logPerformanceDebug(
  scope: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true
  const enabled = isDev || loadPerformanceDebugState().enabled
  if (!enabled) {
    return
  }

  const prefix = `[perf:${scope}] ${message}`
  if (detail && Object.keys(detail).length > 0) {
    console.debug(prefix, detail)
    return
  }
  console.debug(prefix)
}
