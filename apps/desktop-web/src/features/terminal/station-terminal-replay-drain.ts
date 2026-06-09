import type { StationTerminalPendingReplayOp } from './station-terminal-pending-replay'
import type { StationTerminalSink } from './station-terminal-sink-types'

export interface DrainStationTerminalPendingReplayOptions {
  shouldContinue: () => boolean
  yieldBetweenWrites?: (() => Promise<void>) | null
}

export async function drainStationTerminalPendingReplayOps(
  sink: StationTerminalSink,
  ops: StationTerminalPendingReplayOp[],
  options: DrainStationTerminalPendingReplayOptions,
): Promise<void> {
  for (let index = 0; index < ops.length; index += 1) {
    if (!options.shouldContinue()) {
      return
    }
    const op = ops[index]
    if (op.kind === 'reset') {
      await sink.reset(op.content)
    } else {
      await sink.write(op.chunk)
    }
    if (index + 1 < ops.length && options.yieldBetweenWrites) {
      await options.yieldBetweenWrites()
    }
  }
}
