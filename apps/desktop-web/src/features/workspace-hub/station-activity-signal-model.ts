export type StationActivitySignalLevel = 'low' | 'medium' | 'high'

export function resolveStationActivitySignalLevelFromDelta(
  delta: number,
): StationActivitySignalLevel | null {
  if (!Number.isFinite(delta) || delta <= 0) {
    return null
  }
  if (delta >= 6) {
    return 'high'
  }
  if (delta >= 3) {
    return 'medium'
  }
  return 'low'
}

export function resolveStationActivitySignalTimeoutMs(level: StationActivitySignalLevel): number {
  if (level === 'high') {
    return 780
  }
  if (level === 'medium') {
    return 960
  }
  return 1180
}
