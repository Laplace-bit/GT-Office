import {
  DEFAULT_WORKBENCH_CUSTOM_LAYOUT,
  isWorkbenchLayoutMode,
  normalizeWorkbenchCustomLayout,
  type WorkbenchCustomLayout,
  type WorkbenchLayoutMode,
} from './workbench-layout-model.js'

interface WorkbenchStationRef {
  id: string
}

export type WorkbenchContainerMode = 'docked' | 'floating' | 'detached'
export type WorkbenchContainerResumeMode = Extract<WorkbenchContainerMode, 'docked' | 'floating'>

export interface WorkbenchContainerFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface WorkbenchContainer {
  id: string
  stationIds: string[]
  activeStationId: string | null
  layoutMode: WorkbenchLayoutMode
  customLayout: WorkbenchCustomLayout
  mode: WorkbenchContainerMode
  resumeMode: WorkbenchContainerResumeMode
  topmost: boolean
  frame: WorkbenchContainerFrame | null
  detachedWindowLabel: string | null
  lastActiveAtMs: number
}

export interface WorkbenchContainerSnapshot {
  id: string
  stationIds: string[]
  activeStationId?: string | null
  layoutMode?: WorkbenchLayoutMode
  customLayout?: Partial<WorkbenchCustomLayout> | null
  mode?: WorkbenchContainerMode
  resumeMode?: WorkbenchContainerResumeMode
  topmost?: boolean
  frame?: Partial<WorkbenchContainerFrame> | null
}

const FLOATING_MIN_X = 0
const FLOATING_MIN_Y = 0
const FLOATING_MIN_WIDTH = 0.24
const FLOATING_MIN_HEIGHT = 0.28
const FLOATING_MAX_X = 1
const FLOATING_MAX_Y = 1
const FLOATING_MAX_WIDTH = 0.88
const FLOATING_MAX_HEIGHT = 0.9

export const WORKBENCH_FLOATING_MIN_X = FLOATING_MIN_X
export const WORKBENCH_FLOATING_MIN_Y = FLOATING_MIN_Y
export const WORKBENCH_FLOATING_MIN_WIDTH = FLOATING_MIN_WIDTH
export const WORKBENCH_FLOATING_MIN_HEIGHT = FLOATING_MIN_HEIGHT
export const WORKBENCH_FLOATING_MAX_X = FLOATING_MAX_X
export const WORKBENCH_FLOATING_MAX_Y = FLOATING_MAX_Y
export const WORKBENCH_FLOATING_MAX_WIDTH = FLOATING_MAX_WIDTH
export const WORKBENCH_FLOATING_MAX_HEIGHT = FLOATING_MAX_HEIGHT

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeWorkbenchContainerFrame(
  frame: Partial<WorkbenchContainerFrame> | null | undefined,
): WorkbenchContainerFrame | null {
  if (!frame) {
    return null
  }
  const width = clamp(Number(frame.width ?? 0.44), FLOATING_MIN_WIDTH, FLOATING_MAX_WIDTH)
  const height = clamp(Number(frame.height ?? 0.52), FLOATING_MIN_HEIGHT, FLOATING_MAX_HEIGHT)
  return {
    x: clamp(Number(frame.x ?? 0.08), FLOATING_MIN_X, FLOATING_MAX_X - width),
    y: clamp(Number(frame.y ?? 0.08), FLOATING_MIN_Y, FLOATING_MAX_Y - height),
    width,
    height,
  }
}

export function createDefaultFloatingFrame(index = 0): WorkbenchContainerFrame {
  const offset = (index % 5) * 0.034
  const width = 0.42
  const height = 0.5
  return normalizeWorkbenchContainerFrame({
    // Default new floating panels to the lower-right corner and stagger upward-left.
    x: 0.54 - offset,
    y: 0.42 - offset,
    width,
    height,
  }) as WorkbenchContainerFrame
}

export function createWorkbenchContainer(input: {
  id: string
  stationIds?: string[]
  activeStationId?: string | null
  layoutMode?: WorkbenchLayoutMode
  customLayout?: Partial<WorkbenchCustomLayout> | null
  mode?: WorkbenchContainerMode
  resumeMode?: WorkbenchContainerResumeMode
  topmost?: boolean
  frame?: Partial<WorkbenchContainerFrame> | null
  now?: number
}): WorkbenchContainer {
  const stationIds = input.stationIds ? [...input.stationIds] : []
  const mode = input.mode ?? 'docked'
  const activeStationId =
    input.activeStationId && stationIds.includes(input.activeStationId) ? input.activeStationId : stationIds[0] ?? null
  return {
    id: input.id,
    stationIds,
    activeStationId,
    layoutMode: input.layoutMode ?? 'auto',
    customLayout: normalizeWorkbenchCustomLayout(input.customLayout),
    mode,
    resumeMode: input.resumeMode ?? (mode === 'floating' ? 'floating' : 'docked'),
    topmost: Boolean(input.topmost),
    frame: mode === 'floating' || mode === 'detached' ? normalizeWorkbenchContainerFrame(input.frame) : null,
    detachedWindowLabel: null,
    lastActiveAtMs: input.now ?? Date.now(),
  }
}

export function createInitialWorkbenchContainers(
  stations: WorkbenchStationRef[],
  createId: () => string,
  layoutDefaults: { mode: WorkbenchLayoutMode; customLayout: WorkbenchCustomLayout } = {
    mode: 'auto',
    customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT,
  },
): WorkbenchContainer[] {
  if (stations.length === 0) {
    return []
  }
  return [
    createWorkbenchContainer({
      id: createId(),
      stationIds: stations.map((station) => station.id),
      activeStationId: stations[0]?.id ?? null,
      layoutMode: layoutDefaults.mode,
      customLayout: layoutDefaults.customLayout,
      mode: 'docked',
    }),
  ]
}

function normalizeResumeMode(
  mode: WorkbenchContainerMode,
  resumeMode?: WorkbenchContainerResumeMode,
): WorkbenchContainerResumeMode {
  if (resumeMode === 'floating' || resumeMode === 'docked') {
    return resumeMode
  }
  return mode === 'floating' ? 'floating' : 'docked'
}

function isSameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function isSameCustomLayout(left: WorkbenchCustomLayout, right: WorkbenchCustomLayout): boolean {
  return left.columns === right.columns && left.rows === right.rows
}

function isSameFrame(
  left: WorkbenchContainerFrame | null,
  right: WorkbenchContainerFrame | null,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

function normalizeContainerSnapshot(
  snapshot: WorkbenchContainerSnapshot,
  stationIdSet: Set<string>,
  now: number,
): WorkbenchContainer | null {
  const id = snapshot.id.trim()
  if (!id) {
    return null
  }
  const stationIds = snapshot.stationIds
    .filter((stationId) => stationIdSet.has(stationId))
    .map((stationId) => stationId.trim())
    .filter(Boolean)
  const requestedMode =
    snapshot.mode === 'floating' || snapshot.mode === 'detached' || snapshot.mode === 'docked'
      ? snapshot.mode
      : 'docked'
  const requestedTopmost = Boolean(snapshot.topmost)
  const mode = requestedMode
  const activeStationId =
    snapshot.activeStationId && stationIds.includes(snapshot.activeStationId)
      ? snapshot.activeStationId
      : stationIds[0] ?? null
  const layoutMode = isWorkbenchLayoutMode(snapshot.layoutMode) ? snapshot.layoutMode : 'auto'
  return {
    id,
    stationIds,
    activeStationId,
    layoutMode,
    customLayout: normalizeWorkbenchCustomLayout(snapshot.customLayout),
    mode,
    resumeMode: normalizeResumeMode(mode, snapshot.resumeMode),
    topmost: requestedTopmost,
    frame:
      mode === 'floating' || mode === 'detached'
        ? normalizeWorkbenchContainerFrame(snapshot.frame)
        : null,
    detachedWindowLabel: null,
    lastActiveAtMs: now,
  }
}

function ensureContainerList(
  containers: WorkbenchContainer[],
  stations: WorkbenchStationRef[],
  createId: () => string,
  defaultLayout: { mode: WorkbenchLayoutMode; customLayout: WorkbenchCustomLayout },
): WorkbenchContainer[] {
  if (containers.length === 0) {
    return createInitialWorkbenchContainers(stations, createId, defaultLayout)
  }
  const nextContainers = containers
  const stationIdSet = new Set(stations.map((station) => station.id))
  const assignedStationIds = new Set(nextContainers.flatMap((container) => container.stationIds))
  const unassignedStationIds = Array.from(stationIdSet).filter((stationId) => !assignedStationIds.has(stationId))
  if (unassignedStationIds.length === 0) {
    return nextContainers
  }
  const targetIndex = nextContainers.findIndex((container) => container.mode !== 'detached') >= 0
    ? nextContainers.findIndex((container) => container.mode !== 'detached')
    : 0
  const target = nextContainers[targetIndex]
  const mergedTarget = {
    ...target,
    stationIds: [...target.stationIds, ...unassignedStationIds],
    activeStationId: target.activeStationId ?? unassignedStationIds[0] ?? null,
  }
  const mergedContainers = [...nextContainers]
  mergedContainers[targetIndex] = mergedTarget
  return mergedContainers
}

export function restoreWorkbenchContainers(
  snapshots: WorkbenchContainerSnapshot[] | null | undefined,
  stations: WorkbenchStationRef[],
  createId: () => string,
  defaultLayout: { mode: WorkbenchLayoutMode; customLayout: WorkbenchCustomLayout } = {
    mode: 'auto',
    customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT,
  },
): WorkbenchContainer[] {
  const stationIdSet = new Set(stations.map((station) => station.id))
  const now = Date.now()
  const restored = (snapshots ?? [])
    .map((snapshot) => normalizeContainerSnapshot(snapshot, stationIdSet, now))
    .filter((container): container is WorkbenchContainer => Boolean(container))
  return ensureContainerList(restored, stations, createId, defaultLayout)
}

export function reconcileWorkbenchContainers(
  containers: WorkbenchContainer[],
  stations: WorkbenchStationRef[],
  createId: () => string,
  defaultLayout: { mode: WorkbenchLayoutMode; customLayout: WorkbenchCustomLayout } = {
    mode: 'auto',
    customLayout: DEFAULT_WORKBENCH_CUSTOM_LAYOUT,
  },
): WorkbenchContainer[] {
  const stationIdSet = new Set(stations.map((station) => station.id))
  let changed = false
  const nextContainers = containers.map((container) => {
    const mode = container.mode
    const filteredStationIds = container.stationIds.filter((stationId) => stationIdSet.has(stationId))
    const stationIds = isSameStringArray(filteredStationIds, container.stationIds)
      ? container.stationIds
      : filteredStationIds
    const activeStationId =
      container.activeStationId && stationIds.includes(container.activeStationId)
        ? container.activeStationId
        : stationIds[0] ?? null
    const normalizedCustomLayout = normalizeWorkbenchCustomLayout(container.customLayout)
    const customLayout = isSameCustomLayout(normalizedCustomLayout, container.customLayout)
      ? container.customLayout
      : normalizedCustomLayout
    const normalizedFrame =
      mode === 'floating' || mode === 'detached'
        ? normalizeWorkbenchContainerFrame(container.frame) ?? createDefaultFloatingFrame(0)
        : null
    const frame = isSameFrame(normalizedFrame, container.frame) ? container.frame : normalizedFrame
    const topmost = mode === 'docked' ? false : container.topmost
    const resumeMode =
      mode === 'floating'
        ? 'floating'
        : container.resumeMode === 'floating' && mode !== 'docked'
          ? 'floating'
          : 'docked'
    if (
      stationIds === container.stationIds &&
      activeStationId === container.activeStationId &&
      customLayout === container.customLayout &&
      frame === container.frame &&
      topmost === container.topmost &&
      resumeMode === container.resumeMode
    ) {
      return container
    }
    changed = true
    return {
      ...container,
      mode,
      stationIds,
      activeStationId,
      customLayout,
      frame,
      topmost,
      resumeMode,
    } satisfies WorkbenchContainer
  })
  return ensureContainerList(changed ? nextContainers : containers, stations, createId, defaultLayout)
}

export function serializeWorkbenchContainers(
  containers: WorkbenchContainer[],
): WorkbenchContainerSnapshot[] {
  return containers.map((container) => ({
    id: container.id,
    stationIds: [...container.stationIds],
    activeStationId: container.activeStationId,
    layoutMode: container.layoutMode,
    customLayout: container.customLayout,
    mode: container.mode,
    resumeMode: container.resumeMode,
    topmost: container.topmost,
    frame:
      container.mode === 'floating' || container.mode === 'detached'
        ? container.frame
        : null,
  }))
}

export function findContainerByStationId(
  containers: WorkbenchContainer[],
  stationId: string,
): WorkbenchContainer | null {
  return containers.find((container) => container.stationIds.includes(stationId)) ?? null
}

export function sortFloatingContainers(containers: WorkbenchContainer[]): WorkbenchContainer[] {
  return [...containers].sort((left, right) => {
    if (left.topmost !== right.topmost) {
      return left.topmost ? 1 : -1
    }
    return left.lastActiveAtMs - right.lastActiveAtMs
  })
}
