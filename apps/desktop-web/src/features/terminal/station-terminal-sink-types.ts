export interface StationTerminalSink {
  write: (chunk: string) => Promise<void>
  reset: (content?: string) => Promise<void>
  restore: (content: string, cols: number, rows: number, viewportY?: number | null) => Promise<void>
  focus: () => void
  submit: () => boolean
}

export interface StationTerminalSinkBindingMeta {
  sourceSink?: StationTerminalSink | null
  sourceSessionId?: string | null
  restoreState?: string | null
  restoreCols?: number
  restoreRows?: number
  restoreViewportY?: number | null
  restorePriority?: 'active' | 'background'
  /**
   * When true, the sink is being unbound because the live xterm host was parked
   * for workspace keep-alive. Restore state is still captured for document cache
   * fallback, but the terminal buffer remains alive out of tree.
   */
  parkLiveBuffer?: boolean
  /**
   * When true, the sink is rebinding to a reclaimed parked host whose buffer is
   * already up to date. Skip full restore/reset replay.
   */
  preserveLiveBuffer?: boolean
}

export type StationTerminalSinkBindingHandler = (
  stationId: string,
  sink: StationTerminalSink | null,
  meta?: StationTerminalSinkBindingMeta,
) => void
