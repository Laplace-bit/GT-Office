import { memo, useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'

export interface StationTerminalSink {
  write: (chunk: string) => void
  reset: (content?: string) => void
  focus: () => void
}

interface StationXtermTerminalProps {
  stationId: string
  sessionId: string | null
  appearanceVersion: string
  onData: (stationId: string, data: string) => void
  onResize: (stationId: string, cols: number, rows: number) => void
  onBindSink: (stationId: string, sink: StationTerminalSink | null) => void
}

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function readCssVarOr(name: string, fallback: string): string {
  const value = readCssVar(name)
  return value || fallback
}

function getTerminalTheme(): ITheme {
  return {
    background: readCssVarOr('--vb-terminal-bg', '#10151c'),
    foreground: readCssVarOr('--vb-terminal-text', '#d7e1ec'),
    cursor: readCssVarOr('--vb-terminal-caret', '#d7e1ec'),
    cursorAccent: readCssVarOr('--vb-terminal-bg', '#10151c'),
    selectionBackground: 'rgba(128, 164, 202, 0.28)',
    black: '#6f7a86',
    red: '#ef7d8d',
    green: '#7bdc9e',
    yellow: '#e7c97b',
    blue: '#8ab7ff',
    magenta: '#c996f0',
    cyan: '#75d8e0',
    white: '#e4ebf3',
    brightBlack: '#95a1ae',
    brightRed: '#ff95a6',
    brightGreen: '#9aebba',
    brightYellow: '#f2d98f',
    brightBlue: '#a4c8ff',
    brightMagenta: '#d8b1fa',
    brightCyan: '#93e8ef',
    brightWhite: '#f3f7fb',
  }
}

function StationXtermTerminalView({
  stationId,
  sessionId,
  appearanceVersion,
  onData,
  onResize,
  onBindSink,
}: StationXtermTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)

  useEffect(() => {
    onDataRef.current = onData
  }, [onData])

  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [sessionId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    let active = true
    let dataDisposable: { dispose: () => void } | null = null
    let resizeDisposable: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      ([xtermModule, fitModule]) => {
        if (!active) {
          return
        }

        const terminal = new xtermModule.Terminal({
          convertEol: true,
          cursorBlink: true,
          cursorStyle: 'bar',
          cursorWidth: 2,
          fontFamily: readCssVar('--vb-font-mono'),
          fontSize: 12,
          fontWeight: '500',
          fontWeightBold: '700',
          scrollback: 4000,
          theme: getTerminalTheme(),
          drawBoldTextInBrightColors: true,
          minimumContrastRatio: 1.2,
          allowProposedApi: true,
        })
        // Keep inactive cursor subtle and slim instead of default thick outline block.
        ;(terminal.options as typeof terminal.options & { cursorInactiveStyle?: string }).cursorInactiveStyle =
          'bar'
        const fitAddon = new fitModule.FitAddon()
        terminal.loadAddon(fitAddon)
        terminal.open(host)
        fitAddon.fit()

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon

        dataDisposable = terminal.onData((data) => onDataRef.current(stationId, data))

        // Sync terminal size with backend PTY
        resizeDisposable = terminal.onResize(({ cols, rows }) => {
          onResizeRef.current(stationId, cols, rows)
        })
        // Send initial size
        onResizeRef.current(stationId, terminal.cols, terminal.rows)

        resizeObserver = new ResizeObserver(() => {
          try {
            fitAddon.fit()
          } catch {
            // No-op: fit can fail transiently when the element is hidden.
          }
        })
        resizeObserver.observe(host)

        onBindSink(stationId, {
          write: (chunk: string) => {
            if (!chunk) {
              return
            }
            terminal.write(chunk)
          },
          reset: (content?: string) => {
            terminal.reset()
            if (content) {
              terminal.write(content)
            }
            terminal.refresh(0, Math.max(0, terminal.rows - 1))
          },
          focus: () => {
            terminal.focus()
            terminal.refresh(0, Math.max(0, terminal.rows - 1))
          },
        })
      },
    ).catch(() => {
      // No-op: xterm chunk failed to load.
    })

    return () => {
      active = false
      onBindSink(stationId, null)
      dataDisposable?.dispose()
      resizeDisposable?.dispose()
      resizeObserver?.disconnect()
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [onBindSink, stationId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    terminal.options.fontFamily = readCssVar('--vb-font-mono')
    terminal.options.theme = getTerminalTheme()
    terminal.options.cursorStyle = 'bar'
    terminal.options.cursorWidth = 2
    ;(terminal.options as typeof terminal.options & { cursorInactiveStyle?: string }).cursorInactiveStyle =
      'bar'
    try {
      fitAddonRef.current?.fit()
    } catch {
      // No-op: fit can fail transiently when the element is hidden.
    }
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [appearanceVersion])

  return (
    <div
      className="station-terminal-shell"
      onClick={(event) => {
        // Stop propagation to prevent parent handlers from interfering
        event.stopPropagation()
        terminalRef.current?.focus()
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        terminalRef.current?.focus()
      }}
    >
      <div ref={hostRef} className="station-terminal-host" />
    </div>
  )
}

export const StationXtermTerminal = memo(StationXtermTerminalView)
