import type { WorkbenchStationRuntime } from './TerminalStationPane'

export const DETACHED_TERMINAL_BRIDGE_MAIN_WINDOW_LABEL = 'main'
export const DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS = 50000

export type DetachedTerminalRuntimeProjectionPatch = Partial<
  Pick<WorkbenchStationRuntime, 'sessionId' | 'stateRaw' | 'shell' | 'cwdMode' | 'resolvedCwd'>
>

export function createEmptyWorkbenchStationRuntime(): WorkbenchStationRuntime {
  return {
    sessionId: null,
    unreadCount: 0,
    stateRaw: 'idle',
    shell: null,
    cwdMode: 'workspace_root',
    resolvedCwd: null,
  }
}

export function appendDetachedTerminalOutput(previous: string | undefined, chunk: string): string {
  const merged = `${previous ?? ''}${chunk}`
  return merged.length > DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS
    ? merged.slice(merged.length - DETACHED_TERMINAL_OUTPUT_CACHE_MAX_CHARS)
    : merged
}

export function normalizeDetachedTerminalRuntime(
  runtime: Partial<WorkbenchStationRuntime> | null | undefined,
): WorkbenchStationRuntime {
  return {
    ...createEmptyWorkbenchStationRuntime(),
    ...(runtime ?? {}),
    sessionId: runtime?.sessionId ?? null,
    unreadCount:
      typeof runtime?.unreadCount === 'number' && Number.isFinite(runtime.unreadCount)
        ? runtime.unreadCount
        : 0,
    stateRaw: runtime?.stateRaw ?? 'idle',
    shell: runtime?.shell ?? null,
    cwdMode: runtime?.cwdMode === 'custom' ? 'custom' : 'workspace_root',
    resolvedCwd: runtime?.resolvedCwd ?? null,
  }
}

export function stripDetachedTerminalRuntimeProjectionPatch(
  patch: Partial<WorkbenchStationRuntime>,
): DetachedTerminalRuntimeProjectionPatch | null {
  const nextPatch: DetachedTerminalRuntimeProjectionPatch = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'sessionId')) {
    nextPatch.sessionId = patch.sessionId ?? null
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'stateRaw')) {
    nextPatch.stateRaw = patch.stateRaw
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'shell')) {
    nextPatch.shell = patch.shell ?? null
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'cwdMode')) {
    nextPatch.cwdMode = patch.cwdMode === 'custom' ? 'custom' : 'workspace_root'
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'resolvedCwd')) {
    nextPatch.resolvedCwd = patch.resolvedCwd ?? null
  }
  return Object.keys(nextPatch).length > 0 ? nextPatch : null
}
