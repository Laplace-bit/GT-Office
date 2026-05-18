import type { WorkspaceSessionTerminalSnapshot } from '@features/workspace'
import type { WorkspaceTerminalSessionDocument } from './workspace-terminal-session-store.js'

export function reconcileWorkspaceTerminalRestoredSessions(
  document: WorkspaceTerminalSessionDocument,
  restoredTerminals: WorkspaceSessionTerminalSnapshot[],
  liveSessionIds: ReadonlySet<string>,
): void {
  restoredTerminals.forEach((terminal) => {
    const sessionId = terminal.sessionId?.trim() ?? ''
    if (!sessionId) {
      return
    }

    const currentRuntime = document.stationTerminals[terminal.stationId]
    if (!currentRuntime) {
      return
    }

    if (!liveSessionIds.has(sessionId)) {
      if (currentRuntime.sessionId === sessionId) {
        document.stationTerminals[terminal.stationId] = {
          ...currentRuntime,
          sessionId: null,
          stateRaw: 'idle',
          shell: null,
          cwdMode: 'workspace_root',
          resolvedCwd: null,
        }
      }
      delete document.sessionStation[sessionId]
      delete document.sessionSeq[sessionId]
      delete document.sessionVisibility[sessionId]
      delete document.restoreState[terminal.stationId]
      return
    }

    const previousSessionId = currentRuntime.sessionId
    if (previousSessionId && previousSessionId !== sessionId) {
      delete document.sessionStation[previousSessionId]
      delete document.sessionSeq[previousSessionId]
      delete document.sessionVisibility[previousSessionId]
    }

    document.stationTerminals[terminal.stationId] = {
      ...currentRuntime,
      sessionId,
      stateRaw: 'running',
      shell: terminal.shell,
      cwdMode: terminal.cwdMode,
      resolvedCwd: terminal.resolvedCwd,
    }
    document.sessionStation[sessionId] = terminal.stationId
    document.sessionSeq[sessionId] = document.sessionSeq[sessionId] ?? 0
    document.sessionVisibility[sessionId] = false
  })
}
