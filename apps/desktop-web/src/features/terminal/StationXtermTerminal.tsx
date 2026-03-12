import { memo, useCallback, useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'
import type { RenderedScreenSnapshot } from '@shell/integration/desktop-api'

export interface StationTerminalSink {
  write: (chunk: string) => void
  reset: (content?: string) => void
  restore: (content: string, cols: number, rows: number) => void
  focus: () => void
  submit: () => boolean
}

export interface StationTerminalSinkBindingMeta {
  sourceSink?: StationTerminalSink | null
  restoreState?: string | null
  restoreCols?: number
  restoreRows?: number
}

export type StationTerminalSinkBindingHandler = (
  stationId: string,
  sink: StationTerminalSink | null,
  meta?: StationTerminalSinkBindingMeta,
) => void

interface StationXtermTerminalProps {
  stationId: string
  sessionId: string | null
  appearanceVersion: string
  onActivateStation: () => void
  onData: (stationId: string, data: string) => void
  onResize: (stationId: string, cols: number, rows: number) => void
  onBindSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot?: (stationId: string, snapshot: RenderedScreenSnapshot) => void
}

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
const TERMINAL_MIN_VISIBLE_SIZE_PX = 4
const RENDERED_SCREEN_REPORT_THROTTLE_MS = 280
const RENDERED_SCREEN_CAPTURE_MAX_LINES = 1200
const TERMINAL_SERIALIZE_SCROLLBACK_LINES = 4000

function isShellPromptText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  if (trimmed.startsWith('PS ') && trimmed.endsWith('>')) {
    return true
  }
  return false
}

function isPlaceholderPromptContent(content: string): boolean {
  const lower = content.trim().toLowerCase()
  if (lower.includes('implement {feature}')) {
    return true
  }
  return (
    lower.startsWith('type your message') ||
    lower.startsWith('type a message') ||
    lower.includes('@path/to/file') ||
    (lower.startsWith('use /') && lower.includes('available skills'))
  )
}

function isPromptAnchorText(text: string): boolean {
  if (isShellPromptText(text)) {
    return true
  }
  const trimmed = text.trimStart()
  for (const prefix of ['› ', '❯ ', '$ ', '> ']) {
    if (!trimmed.startsWith(prefix)) {
      continue
    }
    const content = trimmed.slice(prefix.length).trim()
    if (!content) {
      continue
    }
    if (isPlaceholderPromptContent(content)) {
      continue
    }
    if (content.length > 0) {
      return true
    }
  }
  return false
}

function normalizeWheelDeltaY(event: WheelEvent, viewport: HTMLElement): number {
  if (event.deltaMode === DOM_DELTA_LINE) {
    return event.deltaY * 16
  }
  if (event.deltaMode === DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(1, viewport.clientHeight)
  }
  return event.deltaY
}

function wheelPixelDeltaToLineDelta(deltaY: number): number {
  const roughLineHeight = 40
  const rawLines = deltaY / roughLineHeight
  if (!Number.isFinite(rawLines) || rawLines === 0) {
    return 0
  }
  if (rawLines > 0) {
    return Math.max(1, Math.round(rawLines))
  }
  return Math.min(-1, Math.round(rawLines))
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
  onActivateStation,
  onData,
  onResize,
  onBindSink,
  onRenderedScreenSnapshot,
}: StationXtermTerminalProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const boundSinkRef = useRef<StationTerminalSink | null>(null)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const onRenderedScreenSnapshotRef = useRef(onRenderedScreenSnapshot)
  const screenRevisionRef = useRef(0)
  const lastSnapshotSignatureRef = useRef('')
  const appearanceSyncFrameRef = useRef<number | null>(null)

  const syncTerminalAppearance = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    terminal.options.fontFamily = readCssVar('--vb-font-mono')
    terminal.options.fontSize = Math.max(10, parseInt(readCssVar('--vb-font-size-base') || '14', 10) - 1)
    terminal.options.theme = getTerminalTheme()
    terminal.options.cursorStyle = 'bar'
    terminal.options.cursorWidth = 2
    terminal.options.cursorBlink = hostRef.current?.matches(':focus-within') ?? false
    ;(terminal.options as typeof terminal.options & { cursorInactiveStyle?: string }).cursorInactiveStyle =
      'bar'
    try {
      fitAddonRef.current?.fit()
    } catch {
      // No-op: fit can fail transiently when the element is hidden.
    }
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [])

  const scheduleTerminalAppearanceSync = useCallback(() => {
    if (appearanceSyncFrameRef.current !== null) {
      return
    }
    appearanceSyncFrameRef.current = window.requestAnimationFrame(() => {
      appearanceSyncFrameRef.current = null
      syncTerminalAppearance()
    })
  }, [syncTerminalAppearance])

  useEffect(() => {
    onDataRef.current = onData
  }, [onData])

  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  useEffect(() => {
    onRenderedScreenSnapshotRef.current = onRenderedScreenSnapshot
  }, [onRenderedScreenSnapshot])

  useEffect(() => {
    screenRevisionRef.current = 0
    lastSnapshotSignatureRef.current = ''
  }, [sessionId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [sessionId, stationId])

  useEffect(() => {
    return () => {
      const frameId = appearanceSyncFrameRef.current
      if (frameId === null) {
        return
      }
      appearanceSyncFrameRef.current = null
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    let active = true
    let dataDisposable: { dispose: () => void } | null = null
    let resizeDisposable: { dispose: () => void } | null = null
    let removeFocusListeners: (() => void) | null = null
    let resizeObserver: ResizeObserver | null = null
    let appearanceObserver: MutationObserver | null = null
    let refreshFrameId: number | null = null
    let readyFitFrameId: number | null = null
    let reportFrameId: number | null = null
    let reportTimeoutId: number | null = null
    let serializeFrameId: number | null = null
    let lastReportAtMs = 0
    let serializedRestoreState: string | null = null
    let serializedRestoreCols = 0
    let serializedRestoreRows = 0
    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-serialize'),
    ]).then(
      ([xtermModule, fitModule, serializeModule]) => {
        if (!active) {
          return
        }

        const terminal = new xtermModule.Terminal({
          convertEol: true,
          cursorBlink: false,
          cursorStyle: 'bar',
          cursorWidth: 2,
          fontFamily: readCssVar('--vb-font-mono'),
          fontSize: Math.max(10, parseInt(readCssVar('--vb-font-size-base') || '14', 10) - 1),
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
        const serializeAddon = new serializeModule.SerializeAddon()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(serializeAddon)
        terminal.open(host)

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon
        scheduleTerminalAppearanceSync()

        const refreshTerminal = () => {
          terminal.refresh(0, Math.max(0, terminal.rows - 1))
        }
        const scheduleRefresh = () => {
          if (refreshFrameId !== null) {
            return
          }
          refreshFrameId = window.requestAnimationFrame(() => {
            refreshFrameId = null
            refreshTerminal()
          })
        }
        const captureSerializedRestoreState = () => {
          try {
            serializedRestoreState = serializeAddon.serialize({
              scrollback: TERMINAL_SERIALIZE_SCROLLBACK_LINES,
              excludeModes: false,
              excludeAltBuffer: false,
            })
            serializedRestoreCols = terminal.cols
            serializedRestoreRows = terminal.rows
          } catch {
            // No-op: serialization should not break terminal lifecycle.
          }
        }
        const scheduleSerializedRestoreStateCapture = () => {
          if (serializeFrameId !== null) {
            return
          }
          serializeFrameId = window.requestAnimationFrame(() => {
            serializeFrameId = null
            captureSerializedRestoreState()
          })
        }
        const captureRenderedScreenSnapshot = (): RenderedScreenSnapshot | null => {
          const activeSessionId = sessionId?.trim()
          if (!activeSessionId) {
            return null
          }
          const buffer = terminal.buffer.active
          const viewportTop = buffer.viewportY
          const viewportHeight = terminal.rows
          const baseY = buffer.baseY
          const absoluteCursorRow = baseY + buffer.cursorY
          const bufferLineCount =
            typeof buffer.length === 'number'
              ? buffer.length
              : Math.max(viewportTop + viewportHeight, baseY + terminal.rows)
          const lastBufferRow = Math.max(0, bufferLineCount - 1)
          const searchFloor = Math.max(0, bufferLineCount - RENDERED_SCREEN_CAPTURE_MAX_LINES)
          let captureStart = searchFloor
          for (let absoluteRow = lastBufferRow; absoluteRow >= searchFloor; absoluteRow -= 1) {
            const line = buffer.getLine(absoluteRow)
            const text = line?.translateToString(false) ?? ''
            if (isPromptAnchorText(text)) {
              captureStart = absoluteRow
              break
            }
          }
          const rows: RenderedScreenSnapshot['rows'] = []
          for (let absoluteRow = captureStart; absoluteRow < bufferLineCount; absoluteRow += 1) {
            const line = buffer.getLine(absoluteRow)
            const text = line?.translateToString(false) ?? ''
            const trimmedText = text.trim()
            rows.push({
              rowIndex: absoluteRow,
              text,
              trimmedText,
              isBlank: trimmedText.length === 0,
            })
          }
          return {
            sessionId: activeSessionId,
            screenRevision: screenRevisionRef.current + 1,
            capturedAtMs: Date.now(),
            viewportTop,
            viewportHeight,
            baseY,
            cursorRow: Number.isFinite(absoluteCursorRow) ? absoluteCursorRow : null,
            cursorCol: Number.isFinite(buffer.cursorX) ? buffer.cursorX : null,
            rows,
          }
        }
        const flushRenderedScreenSnapshot = () => {
          if (reportFrameId !== null) {
            window.cancelAnimationFrame(reportFrameId)
          }
          reportFrameId = window.requestAnimationFrame(() => {
            reportFrameId = null
            const snapshot = captureRenderedScreenSnapshot()
            if (!snapshot) {
              return
            }
            const signature = [
              snapshot.viewportTop,
              snapshot.viewportHeight,
              snapshot.baseY,
              snapshot.cursorRow ?? '',
              snapshot.cursorCol ?? '',
              snapshot.rows.map((row) => row.text).join('\u241e'),
            ].join('\u241f')
            if (signature === lastSnapshotSignatureRef.current) {
              return
            }
            lastSnapshotSignatureRef.current = signature
            screenRevisionRef.current = snapshot.screenRevision
            lastReportAtMs = Date.now()
            onRenderedScreenSnapshotRef.current?.(stationId, snapshot)
          })
        }
        const scheduleRenderedScreenSnapshot = () => {
          const now = Date.now()
          const elapsed = now - lastReportAtMs
          const delay = elapsed >= RENDERED_SCREEN_REPORT_THROTTLE_MS
            ? 0
            : RENDERED_SCREEN_REPORT_THROTTLE_MS - elapsed
          if (reportTimeoutId !== null) {
            return
          }
          reportTimeoutId = window.setTimeout(() => {
            reportTimeoutId = null
            flushRenderedScreenSnapshot()
          }, delay)
        }
        const ensureTerminalMinSize = () => {
          if (terminal.cols > 0 && terminal.rows > 0) {
            return true
          }
          const nextCols = Math.max(1, terminal.cols)
          const nextRows = Math.max(1, terminal.rows)
          if (nextCols !== terminal.cols || nextRows !== terminal.rows) {
            terminal.resize(nextCols, nextRows)
          }
          return terminal.cols > 0 && terminal.rows > 0
        }
        const fitAndRefresh = () => {
          if (!active) {
            return false
          }
          const { clientWidth, clientHeight } = host
          if (clientWidth < TERMINAL_MIN_VISIBLE_SIZE_PX || clientHeight < TERMINAL_MIN_VISIBLE_SIZE_PX) {
            return false
          }
          try {
            fitAddon.fit()
          } catch {
            return false
          }
          if (!ensureTerminalMinSize()) {
            return false
          }
          refreshTerminal()
          return true
        }
        const ensureFitWhenVisible = () => {
          readyFitFrameId = null
          if (!active) {
            return
          }
          if (fitAndRefresh()) {
            onResizeRef.current(stationId, terminal.cols, terminal.rows)
            return
          }
          readyFitFrameId = window.requestAnimationFrame(ensureFitWhenVisible)
        }
        const scheduleFitRetry = () => {
          if (readyFitFrameId !== null) {
            return
          }
          readyFitFrameId = window.requestAnimationFrame(() => {
            readyFitFrameId = null
            ensureFitWhenVisible()
          })
        }
        const submitFromXterm = () => {
          try {
            terminal.focus()
            terminal.input('\r', true)
            scheduleRefresh()
            return true
          } catch {
            return false
          }
        }

        dataDisposable = terminal.onData((data) => onDataRef.current(stationId, data))
        const setBlinkState = (enabled: boolean) => {
          if (terminal.options.cursorBlink !== enabled) {
            terminal.options.cursorBlink = enabled
          }
          terminal.refresh(0, Math.max(0, terminal.rows - 1))
        }
        const handleFocusIn = () => {
          setBlinkState(true)
        }
        const handleFocusOut = (event: FocusEvent) => {
          const relatedTarget = event.relatedTarget
          if (relatedTarget instanceof Node && host.contains(relatedTarget)) {
            return
          }
          if (host.matches(':focus-within')) {
            return
          }
          setBlinkState(false)
        }
        host.addEventListener('focusin', handleFocusIn)
        host.addEventListener('focusout', handleFocusOut)
        removeFocusListeners = () => {
          host.removeEventListener('focusin', handleFocusIn)
          host.removeEventListener('focusout', handleFocusOut)
        }
        if (host.matches(':focus-within')) {
          setBlinkState(true)
        } else {
          setBlinkState(false)
        }

        // Sync terminal size with backend PTY
        resizeDisposable = terminal.onResize(({ cols, rows }) => {
          onResizeRef.current(stationId, cols, rows)
        })
        // Delay first fit/resize sync until host has real dimensions.
        ensureFitWhenVisible()

        resizeObserver = new ResizeObserver(() => {
          if (fitAndRefresh()) {
            return
          }
          scheduleFitRetry()
        })
        resizeObserver.observe(host)

        const fontFaceSet = (document as Document & { fonts?: FontFaceSet }).fonts
        if (fontFaceSet?.ready) {
          void fontFaceSet.ready
            .then(() => {
              if (!active) {
                return
              }
              scheduleTerminalAppearanceSync()
              if (fitAndRefresh()) {
                onResizeRef.current(stationId, terminal.cols, terminal.rows)
                return
              }
              scheduleFitRetry()
            })
            .catch(() => {
              // No-op: font readiness should not block terminal init.
            })
        }

        appearanceObserver = new MutationObserver(() => {
          scheduleTerminalAppearanceSync()
        })
        appearanceObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme', 'style'],
        })

        const sink: StationTerminalSink = {
          write: (chunk: string) => {
            if (!chunk) {
              return
            }
            if (terminal.cols <= 0 || terminal.rows <= 0) {
              scheduleFitRetry()
            }
            terminal.write(chunk, () => {
              scheduleRefresh()
              scheduleSerializedRestoreStateCapture()
              scheduleRenderedScreenSnapshot()
            })
          },
          reset: (content?: string) => {
            terminal.reset()
            if (content) {
              if (terminal.cols <= 0 || terminal.rows <= 0) {
                scheduleFitRetry()
              }
              terminal.write(content, () => {
                scheduleRefresh()
                scheduleSerializedRestoreStateCapture()
              })
            }
            scheduleRefresh()
          },
          restore: (content: string, cols: number, rows: number) => {
            if (cols > 0 && rows > 0 && (terminal.cols !== cols || terminal.rows !== rows)) {
              terminal.resize(cols, rows)
            }
            terminal.reset()
            terminal.write(content, () => {
              scheduleRefresh()
              scheduleSerializedRestoreStateCapture()
              if (fitAndRefresh()) {
                onResizeRef.current(stationId, terminal.cols, terminal.rows)
                return
              }
              scheduleFitRetry()
            })
          },
          focus: () => {
            terminal.focus()
            scheduleRefresh()
          },
          submit: () => submitFromXterm(),
        }
        boundSinkRef.current = sink
        onBindSink(stationId, sink)
      },
    ).catch(() => {
      // No-op: xterm chunk failed to load.
    })

    return () => {
      active = false
      const boundSink = boundSinkRef.current
      boundSinkRef.current = null
      onBindSink(stationId, null, {
        sourceSink: boundSink,
        restoreState: serializedRestoreState,
        restoreCols: serializedRestoreCols,
        restoreRows: serializedRestoreRows,
      })
      dataDisposable?.dispose()
      resizeDisposable?.dispose()
      removeFocusListeners?.()
      resizeObserver?.disconnect()
      appearanceObserver?.disconnect()
      if (refreshFrameId !== null) {
        window.cancelAnimationFrame(refreshFrameId)
      }
      if (readyFitFrameId !== null) {
        window.cancelAnimationFrame(readyFitFrameId)
      }
      if (reportFrameId !== null) {
        window.cancelAnimationFrame(reportFrameId)
      }
      if (reportTimeoutId !== null) {
        window.clearTimeout(reportTimeoutId)
      }
      if (serializeFrameId !== null) {
        window.cancelAnimationFrame(serializeFrameId)
      }
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    onBindSink,
    onRenderedScreenSnapshot,
    scheduleTerminalAppearanceSync,
    sessionId,
    stationId,
  ])

  useEffect(() => {
    scheduleTerminalAppearanceSync()
  }, [appearanceVersion, scheduleTerminalAppearanceSync, stationId])

  return (
    <div
      ref={shellRef}
      className="station-terminal-shell"
      onPointerDownCapture={(event) => {
        if (event.button !== 0) {
          return
        }
        // Activate/focus on pointer down so first click lands in terminal input reliably.
        const shellElement = event.currentTarget
        onActivateStation()
        terminalRef.current?.focus()
        queueMicrotask(() => {
          if (shellElement.matches(':focus-within')) {
            return
          }
          terminalRef.current?.focus()
        })
      }}
      onClick={(event) => {
        // Stop bubbling so card body click does not override terminal-first interaction.
        event.stopPropagation()
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
        const buffer = terminalRef.current?.buffer.active
        const bufferViewportY = buffer?.viewportY
        const bufferBaseY = buffer?.baseY
        const hasBufferMetrics = typeof bufferViewportY === 'number' && typeof bufferBaseY === 'number'
        const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        const atTop = hasBufferMetrics ? bufferViewportY <= 0 : viewport.scrollTop <= 0
        const atBottom = hasBufferMetrics
          ? bufferViewportY >= bufferBaseY
          : viewport.scrollTop >= maxScrollTop - 1
        const hasScrollableContent = hasBufferMetrics ? bufferBaseY > 0 : maxScrollTop > 1
        const terminalCanConsumeDelta =
          hasScrollableContent && ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom))
        if (terminalCanConsumeDelta) {
          const terminal = terminalRef.current
          if (terminal) {
            const lineDelta = wheelPixelDeltaToLineDelta(deltaY)
            if (lineDelta !== 0) {
              terminal.scrollLines(lineDelta)
              event.preventDefault()
              event.stopPropagation()
            }
          }
          return
        }
        const grid = findScrollableStationGrid(event.currentTarget)
        if (!grid) {
          return
        }
        const forwardDeltaToGrid = () => {
          const nextScrollTop = Math.min(
            Math.max(0, grid.scrollTop + deltaY),
            Math.max(0, grid.scrollHeight - grid.clientHeight),
          )
          if (Math.abs(nextScrollTop - grid.scrollTop) < 0.1) {
            return false
          }
          grid.scrollTop = nextScrollTop
          event.preventDefault()
          event.stopPropagation()
          return true
        }
        forwardDeltaToGrid()
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
