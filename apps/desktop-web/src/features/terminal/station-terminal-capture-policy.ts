export function resolveTerminalSerializeDelayMs(
  lastSerializedAtMs: number,
  nowMs: number,
  minIntervalMs: number,
): number {
  if (minIntervalMs <= 0 || lastSerializedAtMs <= 0) {
    return 0
  }
  return Math.max(0, minIntervalMs - Math.max(0, nowMs - lastSerializedAtMs))
}
