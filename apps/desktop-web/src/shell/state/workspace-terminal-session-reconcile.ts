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

    // A persisted snapshot can be stale (it is written debounced), so it may still
    // reference a session that was relaunched after the last persist. Never let it
    // downgrade the newer live binding: doing so drops the running agent's session
    // mapping and replay state, which loses the agent on the next workspace switch.
    if (currentRuntime.sessionId && currentRuntime.sessionId !== sessionId) {
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
