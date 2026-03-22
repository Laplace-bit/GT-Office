export const DETACHED_TERMINAL_RUNTIME_SYNC_STORAGE_KEY =
  'gtoffice.workspace-hub.detached-terminal-runtime-sync.v1'

export interface DetachedTerminalRuntimeSyncPayload {
  workspaceId: string
  stationId: string
  sessionId: string
  shell: string | null
  cwdMode: 'workspace_root' | 'custom'
  resolvedCwd: string | null
  stateRaw: string
  tsMs: number
}

export function readDetachedTerminalRuntimeSyncPayload(
  raw: string | null | undefined,
): DetachedTerminalRuntimeSyncPayload | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DetachedTerminalRuntimeSyncPayload>
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.stationId !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.cwdMode !== 'string' ||
      typeof parsed.stateRaw !== 'string' ||
      typeof parsed.tsMs !== 'number'
    ) {
      return null
    }
    return {
      workspaceId: parsed.workspaceId,
      stationId: parsed.stationId,
      sessionId: parsed.sessionId,
      shell: typeof parsed.shell === 'string' ? parsed.shell : null,
      cwdMode: parsed.cwdMode === 'custom' ? 'custom' : 'workspace_root',
      resolvedCwd: typeof parsed.resolvedCwd === 'string' ? parsed.resolvedCwd : null,
      stateRaw: parsed.stateRaw,
      tsMs: parsed.tsMs,
    }
  } catch {
    return null
  }
}

