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

export interface StationTerminalInactiveMouseGestureInput {
  isActive: boolean
  button: number
}

export interface StationTerminalFocusAttemptContinuationInput {
  componentMounted: boolean
  stationActive: boolean
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

export function shouldContinueStationTerminalFocusAttempt({
  componentMounted,
  stationActive,
}: StationTerminalFocusAttemptContinuationInput): boolean {
  return componentMounted && stationActive
}

export function shouldConsumeInactiveStationTerminalMouseGesture({
  isActive,
  button,
}: StationTerminalInactiveMouseGestureInput): boolean {
  return !isActive && button === 0
}
