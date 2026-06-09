export interface StationTerminalReplayRestoreState {
  content: string
  cols: number
  rows: number
  viewportY?: number | null
}

export type StationTerminalReplaySource =
  | {
      kind: 'restore'
      state: StationTerminalReplayRestoreState
    }
  | {
      kind: 'cache'
      content: string
    }

function stripAnsiSequences(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g,
    '',
  )
}

function measureVisibleLength(text: string): number {
  return stripAnsiSequences(text).length
}

function isValidRestoreState(restoreState: StationTerminalReplayRestoreState): boolean {
  if (measureVisibleLength(restoreState.content) === 0) {
    return false
  }
  return (
    Number.isFinite(restoreState.cols) &&
    Number.isFinite(restoreState.rows) &&
    restoreState.cols > 0 &&
    restoreState.rows > 0
  )
}

export function selectStationTerminalReplaySource(input: {
  cachedContent: string
  restoreState: StationTerminalReplayRestoreState | null
}): StationTerminalReplaySource {
  const cachedContent = input.cachedContent
  const restoreState = input.restoreState
  if (!restoreState || !isValidRestoreState(restoreState)) {
    return {
      kind: 'cache',
      content: cachedContent,
    }
  }

  const restoreVisibleLength = measureVisibleLength(restoreState.content)
  const cacheVisibleLength = measureVisibleLength(cachedContent)
  if (cacheVisibleLength > restoreVisibleLength + 256) {
    return {
      kind: 'cache',
      content: cachedContent,
    }
  }

  return {
    kind: 'restore',
    state: restoreState,
  }
}
