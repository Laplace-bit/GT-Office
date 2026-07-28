export interface QuickDispatchRailPosition {
  left: number
  top: number
}

export interface QuickDispatchRailExpandedState {
  expanded: boolean
  retainedWhileFocused: boolean
}

export interface QuickDispatchRailSnapshot {
  version: 1 | 2
  position?: QuickDispatchRailPosition
  enterToSend?: boolean
  pinned?: boolean
  followActiveAgent?: boolean
}

export interface QuickDispatchRailPrefs {
  position: QuickDispatchRailPosition | null
  enterToSend: boolean
  pinned: boolean
  followActiveAgent: boolean
}

export interface QuickDispatchRailExpandOptions {
  focused: boolean
  markdown: string
  sending: boolean
  hasNotice: boolean
  targetPickerOpen: boolean
  mentionOpen: boolean
}

export interface QuickDispatchRailPositionOptions {
  viewportWidth: number
  viewportHeight: number
  railWidth: number
  railHeight: number
  margin: number
}

export interface ClampQuickDispatchRailPositionOptions extends QuickDispatchRailPositionOptions {
  position: QuickDispatchRailPosition
}

export const QUICK_DISPATCH_RAIL_STORAGE_KEY = 'gtoffice.task-center.quick-dispatch-rail.v1'
export const DEFAULT_QUICK_DISPATCH_ENTER_TO_SEND = false
export const DEFAULT_QUICK_DISPATCH_PINNED = false
export const DEFAULT_QUICK_DISPATCH_FOLLOW_ACTIVE_AGENT = true

const DEFAULT_PREFS: QuickDispatchRailPrefs = {
  position: null,
  enterToSend: DEFAULT_QUICK_DISPATCH_ENTER_TO_SEND,
  pinned: DEFAULT_QUICK_DISPATCH_PINNED,
  followActiveAgent: DEFAULT_QUICK_DISPATCH_FOLLOW_ACTIVE_AGENT,
}

export function shouldExpandQuickDispatchRail(
  options: QuickDispatchRailExpandOptions,
): boolean {
  return (
    options.markdown.trim().length > 0 ||
    options.sending ||
    options.hasNotice ||
    options.targetPickerOpen ||
    options.mentionOpen
  )
}

export function resolveQuickDispatchRailExpandedState(
  options: QuickDispatchRailExpandOptions & {
    retainedWhileFocused: boolean
  },
): QuickDispatchRailExpandedState {
  const baseExpanded = shouldExpandQuickDispatchRail(options)
  const retainedWhileFocused = baseExpanded
    ? true
    : options.focused
      ? options.retainedWhileFocused
      : false

  return {
    expanded: baseExpanded || (options.focused && retainedWhileFocused),
    retainedWhileFocused,
  }
}

export function resolveDefaultQuickDispatchRailPosition(
  options: QuickDispatchRailPositionOptions,
): QuickDispatchRailPosition {
  return clampQuickDispatchRailPosition({
    ...options,
    position: {
      left: options.viewportWidth - options.railWidth - options.margin,
      top: options.viewportHeight - options.railHeight - options.margin,
    },
  })
}

export function clampQuickDispatchRailPosition(
  options: ClampQuickDispatchRailPositionOptions,
): QuickDispatchRailPosition {
  const minLeft = options.margin
  const minTop = options.margin
  const maxLeft = Math.max(minLeft, options.viewportWidth - options.railWidth - options.margin)
  const maxTop = Math.max(minTop, options.viewportHeight - options.railHeight - options.margin)

  return {
    left: Math.min(maxLeft, Math.max(minLeft, Math.round(options.position.left))),
    top: Math.min(maxTop, Math.max(minTop, Math.round(options.position.top))),
  }
}

function parsePosition(value: unknown): QuickDispatchRailPosition | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const point = value as Record<string, unknown>
  if (
    typeof point.left !== 'number' ||
    Number.isNaN(point.left) ||
    typeof point.top !== 'number' ||
    Number.isNaN(point.top)
  ) {
    return null
  }
  return {
    left: point.left,
    top: point.top,
  }
}

export function parseQuickDispatchRailSnapshot(raw: string): QuickDispatchRailSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const snapshot = parsed as Record<string, unknown>
    if (snapshot.version !== 1 && snapshot.version !== 2) {
      return null
    }

    const position = parsePosition(snapshot.position)
    // v1 required a valid position; v2 may only store preference flags.
    if (snapshot.version === 1 && !position) {
      return null
    }

    return {
      version: snapshot.version,
      position: position ?? undefined,
      enterToSend:
        typeof snapshot.enterToSend === 'boolean' ? snapshot.enterToSend : undefined,
      pinned: typeof snapshot.pinned === 'boolean' ? snapshot.pinned : undefined,
      followActiveAgent:
        typeof snapshot.followActiveAgent === 'boolean'
          ? snapshot.followActiveAgent
          : undefined,
    }
  } catch {
    return null
  }
}

export function serializeQuickDispatchRailSnapshot(
  snapshot: QuickDispatchRailSnapshot,
): string {
  return JSON.stringify(snapshot)
}

export function parseQuickDispatchRailPrefs(raw: string | null | undefined): QuickDispatchRailPrefs {
  if (!raw) {
    return { ...DEFAULT_PREFS }
  }
  const snapshot = parseQuickDispatchRailSnapshot(raw)
  if (!snapshot) {
    return { ...DEFAULT_PREFS }
  }
  return {
    position: snapshot.position ?? null,
    enterToSend: snapshot.enterToSend ?? DEFAULT_QUICK_DISPATCH_ENTER_TO_SEND,
    pinned: snapshot.pinned ?? DEFAULT_QUICK_DISPATCH_PINNED,
    followActiveAgent:
      snapshot.followActiveAgent ?? DEFAULT_QUICK_DISPATCH_FOLLOW_ACTIVE_AGENT,
  }
}

export function serializeQuickDispatchRailPrefs(prefs: QuickDispatchRailPrefs): string {
  const snapshot: QuickDispatchRailSnapshot = {
    version: 2,
    enterToSend: prefs.enterToSend,
    pinned: prefs.pinned,
    followActiveAgent: prefs.followActiveAgent,
  }
  if (prefs.position) {
    snapshot.position = prefs.position
  }
  return serializeQuickDispatchRailSnapshot(snapshot)
}

export function resolveDefaultTaskTargetIds(
  stations: Array<{ id: string }>,
  activeStationId: string | null | undefined,
  currentTargetIds: string[],
): string[] {
  const stationIds = new Set(stations.map((station) => station.id))
  const validCurrent = currentTargetIds.filter((id) => stationIds.has(id))
  if (validCurrent.length > 0) {
    return validCurrent
  }
  if (activeStationId && stationIds.has(activeStationId)) {
    return [activeStationId]
  }
  const fallback = stations[0]?.id
  return fallback ? [fallback] : []
}

export function resolveTaskTargetIdsForDispatch(options: {
  stations: Array<{ id: string }>
  activeStationId: string | null | undefined
  currentTargetIds: string[]
  followActiveAgent: boolean
}): string[] {
  const { stations, activeStationId, currentTargetIds, followActiveAgent } = options
  if (followActiveAgent) {
    const stationIds = new Set(stations.map((station) => station.id))
    if (activeStationId && stationIds.has(activeStationId)) {
      return [activeStationId]
    }
    const fallback = stations[0]?.id
    return fallback ? [fallback] : []
  }
  return resolveDefaultTaskTargetIds(stations, activeStationId, currentTargetIds)
}
