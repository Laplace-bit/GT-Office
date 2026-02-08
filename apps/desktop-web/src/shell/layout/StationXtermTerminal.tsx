import { memo, useEffect, useMemo, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'

export interface StationTerminalSink {
  write: (chunk: string) => void
  reset: (content?: string) => void
  focus: () => void
}

interface StationXtermTerminalProps {
  stationId: string
  appearanceVersion: string
  onData: (stationId: string, data: string) => void
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
  appearanceVersion,
  onData,
  onBindSink,
}: StationXtermTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const onDataRef = useRef(onData)
  const queueRef = useRef('')
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    onDataRef.current = onData
  }, [onData])

  const flushQueuedWrites = useMemo(
    () => () => {
      frameRef.current = null
      const terminal = terminalRef.current
      const queued = queueRef.current
      if (!terminal || !queued) {
        return
      }
      queueRef.current = ''
      terminal.write(queued)
    },
    [],
  )

  const enqueueWrite = useMemo(
    () => (chunk: string) => {
      if (!chunk) {
        return
      }
      queueRef.current = `${queueRef.current}${chunk}`
      if (frameRef.current !== null) {
        return
      }
      frameRef.current = window.requestAnimationFrame(flushQueuedWrites)
    },
    [flushQueuedWrites],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    let active = true
    let dataDisposable: { dispose: () => void } | null = null
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
        resizeObserver = new ResizeObserver(() => {
          try {
            fitAddon.fit()
          } catch {
            // No-op: fit can fail transiently when the element is hidden.
          }
        })
        resizeObserver.observe(host)

        onBindSink(stationId, {
          write: enqueueWrite,
          reset: (content?: string) => {
            terminal.reset()
            queueRef.current = ''
            if (content) {
              enqueueWrite(content)
            }
          },
          focus: () => {
            terminal.focus()
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
      resizeObserver?.disconnect()
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      queueRef.current = ''
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [enqueueWrite, onBindSink, stationId])

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
  }, [appearanceVersion])

  return (
    <div
      className="station-terminal-shell"
      onClick={() => {
        terminalRef.current?.focus()
      }}
    >
      <div ref={hostRef} className="station-terminal-host" />
    </div>
  )
}

export const StationXtermTerminal = memo(StationXtermTerminalView)
