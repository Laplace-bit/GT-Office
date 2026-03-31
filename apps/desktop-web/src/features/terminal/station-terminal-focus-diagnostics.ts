export type StationTerminalPointerDownFocusStrategy = 'immediate' | 'defer-until-active'

export interface StationTerminalPointerDownFocusPlanInput {
  isActive: boolean
  isMacOsWebKitEnvironment: boolean
}

export interface StationTerminalPointerDownFocusPlan {
  activateStation: boolean
  focusStrategy: StationTerminalPointerDownFocusStrategy
}

export type StationTerminalFocusDiagnosticKind =
  | 'pointerdown'
  | 'focus-request'
  | 'focus-success'
  | 'focus-deferred'
  | 'focus-error'
  | 'window-error'
  | 'unhandled-rejection'
  | 'xterm-init-failed'

export interface StationTerminalFocusDiagnosticEvent {
  atMs: number
  stationId: string
  sessionId: string | null
  kind: StationTerminalFocusDiagnosticKind
  detail?: string
}

export const STATION_TERMINAL_FOCUS_DIAGNOSTIC_STORAGE_KEY =
  'gtoffice.terminal.focus.trace.v1'

const DEFAULT_STATION_TERMINAL_FOCUS_DIAGNOSTIC_LIMIT = 40

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type DiagnosticsWindow = Window & {
  __GTO_TERMINAL_FOCUS_DIAGNOSTICS_INSTALLED__?: boolean
}

export function resolveStationTerminalPointerDownFocusPlan({
  isActive,
  isMacOsWebKitEnvironment,
}: StationTerminalPointerDownFocusPlanInput): StationTerminalPointerDownFocusPlan {
  if (!isActive && isMacOsWebKitEnvironment) {
    return {
      activateStation: true,
      focusStrategy: 'defer-until-active',
    }
  }

  return {
    activateStation: true,
    focusStrategy: 'immediate',
  }
}

export function appendStationTerminalFocusDiagnosticEvent<T extends StationTerminalFocusDiagnosticEvent>(
  records: T[],
  record: T,
  limit = DEFAULT_STATION_TERMINAL_FOCUS_DIAGNOSTIC_LIMIT,
): T[] {
  if (limit <= 0) {
    return [...records, record]
  }
  return [...records, record].slice(-limit)
}

function readStationTerminalFocusDiagnosticEvents(
  storage: StorageLike,
): StationTerminalFocusDiagnosticEvent[] {
  try {
    const raw = storage.getItem(STATION_TERMINAL_FOCUS_DIAGNOSTIC_STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is StationTerminalFocusDiagnosticEvent => {
        return (
          typeof item === 'object' &&
          item !== null &&
          typeof item.atMs === 'number' &&
          typeof item.stationId === 'string' &&
          typeof item.kind === 'string'
        )
      })
      .map((item) => ({
        atMs: item.atMs,
        stationId: item.stationId,
        sessionId: item.sessionId ?? null,
        kind: item.kind,
        detail: item.detail,
      }))
  } catch {
    return []
  }
}

export function persistStationTerminalFocusDiagnosticEvent(
  targetWindow: Window,
  record: StationTerminalFocusDiagnosticEvent,
  limit = DEFAULT_STATION_TERMINAL_FOCUS_DIAGNOSTIC_LIMIT,
): void {
  try {
    const storage = targetWindow.sessionStorage
    const current = readStationTerminalFocusDiagnosticEvents(storage)
    const next = appendStationTerminalFocusDiagnosticEvent(current, record, limit)
    storage.setItem(STATION_TERMINAL_FOCUS_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Diagnostic persistence must never break terminal interaction.
  }
}

export function installStationTerminalWindowDiagnostics(targetWindow: Window): void {
  const diagnosticWindow = targetWindow as DiagnosticsWindow
  if (diagnosticWindow.__GTO_TERMINAL_FOCUS_DIAGNOSTICS_INSTALLED__) {
    return
  }

  diagnosticWindow.__GTO_TERMINAL_FOCUS_DIAGNOSTICS_INSTALLED__ = true

  targetWindow.addEventListener('error', (event) => {
    persistStationTerminalFocusDiagnosticEvent(targetWindow, {
      atMs: Date.now(),
      stationId: 'window',
      sessionId: null,
      kind: 'window-error',
      detail: event.message || 'unknown window error',
    })
  })

  targetWindow.addEventListener('unhandledrejection', (event) => {
    const reason =
      event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === 'string'
          ? event.reason
          : 'unknown rejection'
    persistStationTerminalFocusDiagnosticEvent(targetWindow, {
      atMs: Date.now(),
      stationId: 'window',
      sessionId: null,
      kind: 'unhandled-rejection',
      detail: reason,
    })
  })
}
