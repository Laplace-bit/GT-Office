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
