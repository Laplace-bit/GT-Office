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

export type TerminalCaptureTaskKind = 'serialize' | 'screen'

export function takeNextTerminalCaptureTask(
  pending: Set<TerminalCaptureTaskKind>,
): TerminalCaptureTaskKind | null {
  if (pending.has('screen')) {
    pending.delete('screen')
    return 'screen'
  }
  if (pending.has('serialize')) {
    pending.delete('serialize')
    return 'serialize'
  }
  return null
}
