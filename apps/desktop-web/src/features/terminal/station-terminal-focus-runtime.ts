export interface StationTerminalFocusRequestInput {
  focusRuntimeReady: boolean
}

export interface StationTerminalFocusRequestResolution {
  shouldDispatch: boolean
  shouldPersistPending: boolean
}

export interface StationTerminalPendingFocusFlushInput {
  pendingAutoFocus: boolean
  focusRuntimeReady: boolean
}

export function resolveStationTerminalFocusRequest({
  focusRuntimeReady,
}: StationTerminalFocusRequestInput): StationTerminalFocusRequestResolution {
  if (!focusRuntimeReady) {
    return {
      shouldDispatch: false,
      shouldPersistPending: true,
    }
  }

  return {
    shouldDispatch: true,
    shouldPersistPending: false,
  }
}

export function shouldFlushPendingStationTerminalFocus({
  pendingAutoFocus,
  focusRuntimeReady,
}: StationTerminalPendingFocusFlushInput): boolean {
  return pendingAutoFocus && focusRuntimeReady
}
