export interface QuickDispatchRailPosition {
  left: number
  top: number
}

export interface QuickDispatchRailExpandedState {
  expanded: boolean
  retainedWhileFocused: boolean
}

export interface QuickDispatchRailSnapshot {
  version: 1
  position: QuickDispatchRailPosition
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

export function parseQuickDispatchRailSnapshot(raw: string): QuickDispatchRailSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const snapshot = parsed as Record<string, unknown>
    if (snapshot.version !== 1) {
      return null
    }

    const position = snapshot.position
    if (!position || typeof position !== 'object') {
      return null
    }

    const point = position as Record<string, unknown>
    if (
      typeof point.left !== 'number' ||
      Number.isNaN(point.left) ||
      typeof point.top !== 'number' ||
      Number.isNaN(point.top)
    ) {
      return null
    }

    return {
      version: 1,
      position: {
        left: point.left,
        top: point.top,
      },
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
