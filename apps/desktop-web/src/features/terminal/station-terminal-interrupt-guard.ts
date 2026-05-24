export interface StationTerminalInterruptKeyboardEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat?: boolean
}

export type StationTerminalInterruptSignalKind = 'sigint' | 'sigtstp'
export type StationTerminalInterruptConfirmKeyAction = 'none' | 'cancel' | 'confirm'

export type StationTerminalInterruptKeyAction =
  | { action: 'none'; signalKind: StationTerminalInterruptSignalKind | null }
  | { action: 'open-confirm'; signalKind: StationTerminalInterruptSignalKind }
  | { action: 'confirm-interrupt'; signalKind: StationTerminalInterruptSignalKind }

export function isStationTerminalInterruptKeyboardEvent(
  event: StationTerminalInterruptKeyboardEventLike,
): boolean {
  return resolveStationTerminalInterruptSignalKind(event) !== null
}

export function resolveStationTerminalInterruptKeyAction(input: {
  event: StationTerminalInterruptKeyboardEventLike
  agentRunning: boolean
  confirmOpen: boolean
  hasSelection: boolean
  pendingSignalKind?: StationTerminalInterruptSignalKind | null
}): StationTerminalInterruptKeyAction {
  const signalKind = resolveStationTerminalInterruptSignalKind(input.event)
  if (!signalKind || input.hasSelection || !input.agentRunning) {
    return { action: 'none', signalKind: null }
  }

  if (input.confirmOpen) {
    const pendingSignalKind = input.pendingSignalKind ?? null
    if (
      pendingSignalKind &&
      signalKind === pendingSignalKind &&
      !input.event.repeat
    ) {
      return { action: 'confirm-interrupt', signalKind }
    }
    if (pendingSignalKind && signalKind !== pendingSignalKind && !input.event.repeat) {
      return { action: 'open-confirm', signalKind }
    }
    return { action: 'none', signalKind: pendingSignalKind }
  }

  return { action: 'open-confirm', signalKind }
}

function isCtrlCKey(event: StationTerminalInterruptKeyboardEventLike): boolean {
  const key = event.key.trim().toLowerCase()
  return key === 'c' || event.code === 'KeyC'
}

function isCtrlZKey(event: StationTerminalInterruptKeyboardEventLike): boolean {
  const key = event.key.trim().toLowerCase()
  return key === 'z' || event.code === 'KeyZ'
}

export function resolveStationTerminalInterruptSignalKind(
  event: StationTerminalInterruptKeyboardEventLike,
): StationTerminalInterruptSignalKind | null {
  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return null
  }
  if (isCtrlCKey(event)) {
    return 'sigint'
  }
  if (isCtrlZKey(event)) {
    return 'sigtstp'
  }
  return null
}

export function getStationTerminalInterruptShortcut(
  signalKind: StationTerminalInterruptSignalKind,
): string {
  if (signalKind === 'sigtstp') {
    return 'Ctrl+Z'
  }
  return 'Ctrl+C'
}

export function getStationTerminalInterruptControlCharacter(
  signalKind: StationTerminalInterruptSignalKind,
): string {
  if (signalKind === 'sigtstp') {
    return '\u001a'
  }
  return '\u0003'
}

export function resolveStationTerminalInterruptConfirmKeyAction(
  event: StationTerminalInterruptKeyboardEventLike,
  pendingSignalKind: StationTerminalInterruptSignalKind | null,
): StationTerminalInterruptConfirmKeyAction {
  if (event.key === 'Escape') {
    return 'cancel'
  }
  if (
    pendingSignalKind &&
    resolveStationTerminalInterruptSignalKind(event) === pendingSignalKind &&
    !event.repeat
  ) {
    return 'confirm'
  }
  return 'none'
}
