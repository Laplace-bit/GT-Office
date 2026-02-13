const WORKSPACE_SESSION_SNAPSHOT_FILE_REL = '.gtoffice/session.snapshot.json'
const WORKSPACE_SESSION_SNAPSHOT_VERSION = 1 as const

type TerminalCwdMode = 'workspace_root' | 'custom'

export interface WorkspaceSessionWindowSnapshot {
  activeNavId: string
}

export interface WorkspaceSessionTabSnapshot {
  path: string
  active: boolean
}

export interface WorkspaceSessionTerminalSnapshot {
  stationId: string
  shell: string | null
  cwdMode: TerminalCwdMode
  resolvedCwd: string | null
  active: boolean
}

export interface WorkspaceSessionSnapshot {
  version: 1
  updatedAtMs: number
  windows: WorkspaceSessionWindowSnapshot[]
  tabs: WorkspaceSessionTabSnapshot[]
  terminals: WorkspaceSessionTerminalSnapshot[]
}

function normalizeRelativePath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
}

function normalizeTerminalCwdMode(input: unknown): TerminalCwdMode {
  return input === 'workspace_root' ? 'workspace_root' : 'custom'
}

export function buildWorkspaceSessionFilePath(): string {
  return WORKSPACE_SESSION_SNAPSHOT_FILE_REL
}

export function buildWorkspaceSessionSnapshot(input: {
  updatedAtMs: number
  windows: WorkspaceSessionWindowSnapshot[]
  tabs: WorkspaceSessionTabSnapshot[]
  terminals: WorkspaceSessionTerminalSnapshot[]
}): WorkspaceSessionSnapshot {
  return {
    version: WORKSPACE_SESSION_SNAPSHOT_VERSION,
    updatedAtMs: Number.isFinite(input.updatedAtMs) ? input.updatedAtMs : Date.now(),
    windows: input.windows.map((item) => ({
      activeNavId: item.activeNavId,
    })),
    tabs: input.tabs.map((item) => ({
      path: normalizeRelativePath(item.path),
      active: Boolean(item.active),
    })),
    terminals: input.terminals.map((item) => ({
      stationId: item.stationId.trim(),
      shell: typeof item.shell === 'string' && item.shell.trim() ? item.shell.trim() : null,
      cwdMode: normalizeTerminalCwdMode(item.cwdMode),
      resolvedCwd:
        typeof item.resolvedCwd === 'string' && item.resolvedCwd.trim()
          ? item.resolvedCwd.trim()
          : null,
      active: Boolean(item.active),
    })),
  }
}

export function serializeWorkspaceSessionSnapshot(snapshot: WorkspaceSessionSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

export function parseWorkspaceSessionSnapshot(raw: string): WorkspaceSessionSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const record = parsed as Record<string, unknown>
    const windows = Array.isArray(record.windows) ? record.windows : []
    const tabs = Array.isArray(record.tabs) ? record.tabs : []
    const terminals = Array.isArray(record.terminals) ? record.terminals : []

    const parsedWindows = windows
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const value = entry as Record<string, unknown>
        if (typeof value.activeNavId !== 'string' || !value.activeNavId.trim()) {
          return null
        }
        return {
          activeNavId: value.activeNavId.trim(),
        } satisfies WorkspaceSessionWindowSnapshot
      })
      .filter((entry): entry is WorkspaceSessionWindowSnapshot => Boolean(entry))

    const seenTabPath = new Set<string>()
    const parsedTabs = tabs
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const value = entry as Record<string, unknown>
        if (typeof value.path !== 'string' || !value.path.trim()) {
          return null
        }
        const path = normalizeRelativePath(value.path)
        if (!path || seenTabPath.has(path)) {
          return null
        }
        seenTabPath.add(path)
        return {
          path,
          active: Boolean(value.active),
        } satisfies WorkspaceSessionTabSnapshot
      })
      .filter((entry): entry is WorkspaceSessionTabSnapshot => Boolean(entry))

    const seenStation = new Set<string>()
    const parsedTerminals = terminals
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const value = entry as Record<string, unknown>
        if (typeof value.stationId !== 'string' || !value.stationId.trim()) {
          return null
        }
        const stationId = value.stationId.trim()
        if (seenStation.has(stationId)) {
          return null
        }
        seenStation.add(stationId)
        return {
          stationId,
          shell: typeof value.shell === 'string' && value.shell.trim() ? value.shell.trim() : null,
          cwdMode: normalizeTerminalCwdMode(value.cwdMode),
          resolvedCwd:
            typeof value.resolvedCwd === 'string' && value.resolvedCwd.trim()
              ? value.resolvedCwd.trim()
              : null,
          active: Boolean(value.active),
        } satisfies WorkspaceSessionTerminalSnapshot
      })
      .filter((entry): entry is WorkspaceSessionTerminalSnapshot => Boolean(entry))

    return {
      version: WORKSPACE_SESSION_SNAPSHOT_VERSION,
      updatedAtMs: typeof record.updatedAtMs === 'number' ? record.updatedAtMs : Date.now(),
      windows: parsedWindows,
      tabs: parsedTabs,
      terminals: parsedTerminals,
    }
  } catch {
    return null
  }
}
