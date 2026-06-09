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
}

export type StationTerminalSinkBindingHandler = (
  stationId: string,
  sink: StationTerminalSink | null,
  meta?: StationTerminalSinkBindingMeta,
) => void
