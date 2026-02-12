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

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

function normalizeWheelDeltaY(event: WheelEvent, viewport: HTMLElement): number {
  if (event.deltaMode === DOM_DELTA_LINE) {
    return event.deltaY * 16
  }
  if (event.deltaMode === DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(1, viewport.clientHeight)
  }
  return event.deltaY
}

function findScrollableStationGrid(element: HTMLElement): HTMLElement | null {
  const grid = element.closest<HTMLElement>('.station-grid')
  if (!grid) {
    return null
  }
  return grid.scrollHeight > grid.clientHeight + 1 ? grid : null
}

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function readCssVarOr(name: string, fallback: string): string {
  const value = readCssVar(name)
  return value || fallback
}

function getTerminalTheme(): ITheme {
  const isDark = document.documentElement.getAttribute('data-theme') === 'graphite-dark'
  if (!isDark) {
    return {
      background: readCssVarOr('--vb-terminal-bg', '#f4efe4'),
      foreground: readCssVarOr('--vb-terminal-text', '#3b3328'),
      cursor: readCssVarOr('--vb-terminal-caret', '#9c6a2f'),
      cursorAccent: readCssVarOr('--vb-terminal-bg', '#f4efe4'),
      selectionBackground: 'rgba(156, 106, 47, 0.2)',
      black: '#4f4335',
      red: '#b24e3f',
      green: '#5c7b3a',
      yellow: '#996b22',
      blue: '#2f6f9a',
      magenta: '#7d589e',
      cyan: '#2d7f83',
      white: '#6a5e50',
      brightBlack: '#7d6f5f',
      brightRed: '#cc6655',
      brightGreen: '#709448',
      brightYellow: '#b5832f',
      brightBlue: '#4688b3',
      brightMagenta: '#9670b3',
      brightCyan: '#40969c',
      brightWhite: '#2f281f',
    }
  }
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
      onWheelCapture={(event) => {
        const target = event.target
        if (!(target instanceof Element)) {
          return
        }
        const viewport =
          target.closest<HTMLElement>('.xterm-viewport') ??
          target.closest<HTMLElement>('.xterm')?.querySelector<HTMLElement>('.xterm-viewport') ??
          event.currentTarget.querySelector<HTMLElement>('.xterm-viewport')
        if (!viewport) {
          return
        }
        const deltaY = normalizeWheelDeltaY(event.nativeEvent, viewport)
        if (!Number.isFinite(deltaY) || deltaY === 0) {
          return
        }
        const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        const atTop = viewport.scrollTop <= 0
        const atBottom = viewport.scrollTop >= maxScrollTop - 1
        const forwardToGrid =
          maxScrollTop <= 1 || (deltaY < 0 && atTop) || (deltaY > 0 && atBottom)
        if (!forwardToGrid) {
          return
        }
        const grid = findScrollableStationGrid(event.currentTarget)
        if (!grid) {
          return
        }
        const nextScrollTop = Math.min(
          Math.max(0, grid.scrollTop + deltaY),
          Math.max(0, grid.scrollHeight - grid.clientHeight),
        )
        if (Math.abs(nextScrollTop - grid.scrollTop) < 0.1) {
          return
        }
        grid.scrollTop = nextScrollTop
        event.preventDefault()
        event.stopPropagation()
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
