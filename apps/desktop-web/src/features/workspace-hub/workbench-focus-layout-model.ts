export type WorkbenchFocusSlotMode = 'stable' | 'entering' | 'exiting' | 'parked'

export type WorkbenchFocusLayoutMode = 'auto' | 'focus' | 'custom'

export function resolveFocusStageStationVisibility(
  stationId: string,
  selectedStationId: string | null,
  slotMode: WorkbenchFocusSlotMode,
): { focusHidden: boolean; inert: boolean } {
  const focusHidden = slotMode !== 'parked' && stationId !== selectedStationId
  return {
    focusHidden,
    inert: focusHidden && slotMode !== 'exiting',
  }
}

export function isSingleStationFocusLayout(
  layoutMode: WorkbenchFocusLayoutMode,
  visibleStationCount: number,
): boolean {
  return layoutMode === 'focus' && visibleStationCount === 1
}

export function preserveFocusTabOrder(
  stationIds: string[],
  visibleStationIds: Set<string>,
): string[] {
  return stationIds.filter((stationId) => visibleStationIds.has(stationId))
}

export function resolveRenderedActiveStationId(
  layoutMode: WorkbenchFocusLayoutMode,
  selectedStationId: string | null,
  effectiveActiveStationId: string | null,
): string | null {
  if (layoutMode === 'focus') {
    return selectedStationId ?? effectiveActiveStationId
  }
  return effectiveActiveStationId
}
