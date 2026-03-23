import type { WorkbenchContainerSnapshot } from '@features/workspace-hub'
import {
  isWorkbenchLayoutMode,
  normalizeWorkbenchCustomLayout,
  type WorkbenchCustomLayout,
} from '@features/workspace-hub/workbench-layout-model'

const WORKSPACE_SESSION_SNAPSHOT_FILE_REL = '.gtoffice/session.snapshot.json'
const WORKSPACE_SESSION_SNAPSHOT_VERSION = 1 as const

type TerminalCwdMode = 'workspace_root' | 'custom'

export interface WorkspaceSessionWindowSnapshot {
  activeNavId: string
  pinnedWorkbenchContainerId: string | null
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
  workbenchContainers: WorkbenchContainerSnapshot[]
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
  workbenchContainers?: WorkbenchContainerSnapshot[]
}): WorkspaceSessionSnapshot {
  return {
    version: WORKSPACE_SESSION_SNAPSHOT_VERSION,
    updatedAtMs: Number.isFinite(input.updatedAtMs) ? input.updatedAtMs : Date.now(),
    windows: input.windows.map((item) => ({
      activeNavId: item.activeNavId,
      pinnedWorkbenchContainerId:
        typeof item.pinnedWorkbenchContainerId === 'string' && item.pinnedWorkbenchContainerId.trim()
          ? item.pinnedWorkbenchContainerId.trim()
          : null,
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
    workbenchContainers: (input.workbenchContainers ?? []).map((item) => ({
      id: item.id.trim(),
      stationIds: item.stationIds.map((stationId) => stationId.trim()).filter(Boolean),
      activeStationId: typeof item.activeStationId === 'string' && item.activeStationId.trim()
        ? item.activeStationId.trim()
        : null,
      layoutMode: isWorkbenchLayoutMode(item.layoutMode) ? item.layoutMode : 'auto',
      customLayout: normalizeWorkbenchCustomLayout(item.customLayout),
      mode: item.mode,
      resumeMode: item.resumeMode,
      topmost: Boolean(item.topmost),
      frame: item.frame
        ? {
            x: typeof item.frame.x === 'number' ? item.frame.x : undefined,
            y: typeof item.frame.y === 'number' ? item.frame.y : undefined,
            width: typeof item.frame.width === 'number' ? item.frame.width : undefined,
            height: typeof item.frame.height === 'number' ? item.frame.height : undefined,
          }
        : null,
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
    const workbenchContainers = Array.isArray(record.workbenchContainers)
      ? record.workbenchContainers
      : []

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
          pinnedWorkbenchContainerId:
            typeof value.pinnedWorkbenchContainerId === 'string' && value.pinnedWorkbenchContainerId.trim()
              ? value.pinnedWorkbenchContainerId.trim()
              : null,
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

    const parsedWorkbenchContainers: WorkbenchContainerSnapshot[] = workbenchContainers
      .map<WorkbenchContainerSnapshot | null>((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const value = entry as Record<string, unknown>
        if (typeof value.id !== 'string' || !value.id.trim()) {
          return null
        }
        const stationIds = Array.isArray(value.stationIds)
          ? value.stationIds
              .filter((stationId): stationId is string => typeof stationId === 'string')
              .map((stationId) => stationId.trim())
              .filter(Boolean)
          : []
        const mode =
          value.mode === 'floating' || value.mode === 'detached' || value.mode === 'docked'
            ? value.mode
            : 'docked'
        const resumeMode = value.resumeMode === 'floating' ? 'floating' : 'docked'
        const activeStationId =
          typeof value.activeStationId === 'string' && stationIds.includes(value.activeStationId.trim())
            ? value.activeStationId.trim()
            : null
        const layoutMode = isWorkbenchLayoutMode(value.layoutMode) ? value.layoutMode : 'auto'
        const customLayout = normalizeWorkbenchCustomLayout(
          (value.customLayout as Partial<WorkbenchCustomLayout> | null | undefined) ?? null,
        )
        const frameValue = value.frame
        const frame =
          frameValue && typeof frameValue === 'object'
            ? {
                x:
                  typeof (frameValue as Record<string, unknown>).x === 'number'
                    ? ((frameValue as Record<string, unknown>).x as number)
                    : undefined,
                y:
                  typeof (frameValue as Record<string, unknown>).y === 'number'
                    ? ((frameValue as Record<string, unknown>).y as number)
                    : undefined,
                width:
                  typeof (frameValue as Record<string, unknown>).width === 'number'
                    ? ((frameValue as Record<string, unknown>).width as number)
                    : undefined,
                height:
                  typeof (frameValue as Record<string, unknown>).height === 'number'
                    ? ((frameValue as Record<string, unknown>).height as number)
                    : undefined,
              }
            : null
        return {
          id: value.id.trim(),
          stationIds,
          activeStationId,
          layoutMode,
          customLayout,
          mode,
          resumeMode,
          topmost: Boolean(value.topmost),
          frame,
        } satisfies WorkbenchContainerSnapshot
      })
      .filter((entry): entry is WorkbenchContainerSnapshot => entry !== null)

    return {
      version: WORKSPACE_SESSION_SNAPSHOT_VERSION,
      updatedAtMs: typeof record.updatedAtMs === 'number' ? record.updatedAtMs : Date.now(),
      windows: parsedWindows,
      tabs: parsedTabs,
      terminals: parsedTerminals,
      workbenchContainers: parsedWorkbenchContainers,
    }
  } catch {
    return null
  }
}
