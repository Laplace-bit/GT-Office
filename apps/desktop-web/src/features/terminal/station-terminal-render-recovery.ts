export interface StationTerminalRendererRecoveryInput {
  hasMeaningfulContent: boolean
  hasSerializedRestoreState: boolean
  renderEventSeqAtSchedule: number
  currentRenderEventSeq: number
}

export function shouldRecycleStationTerminalRenderer({
  hasMeaningfulContent,
  hasSerializedRestoreState,
  renderEventSeqAtSchedule,
  currentRenderEventSeq,
}: StationTerminalRendererRecoveryInput): boolean {
  if (currentRenderEventSeq !== renderEventSeqAtSchedule) {
    return false
  }
  if (!hasMeaningfulContent && !hasSerializedRestoreState) {
    return false
  }
  return true
}
