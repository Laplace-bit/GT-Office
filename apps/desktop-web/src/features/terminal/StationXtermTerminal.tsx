import { memo, useCallback, useEffect, useRef } from 'react'
import { shouldAcceptStationTerminalLocalInput } from './station-terminal-runtime-state'
import { resolveTerminalDocument } from './station-terminal-document-scope'
import '@xterm/xterm/css/xterm.css'
import './StationXtermTerminal.scss'
import type { ITheme } from '@xterm/xterm'
import type { RenderedScreenSnapshot } from '@shell/integration/desktop-api'
import {
  consumeDeferredMacOsXtermEcho,
  isMacOsWebKitTextInputEnvironment,
  resolveDeferredMacOsTextInputHandling,
  shouldBypassXtermTextKeyEvent,
} from './macos-webkit-ime-workaround'

export interface StationTerminalSink {
  write: (chunk: string) => void
  reset: (content?: string) => void
  restore: (content: string, cols: number, rows: number) => void
  focus: () => void
  submit: () => boolean
}

export interface StationTerminalSinkBindingMeta {
  sourceSink?: StationTerminalSink | null
  sourceSessionId?: string | null
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
  isActive?: boolean
  appearanceVersion: string
  performanceDebugEnabled?: boolean
  onActivateStation: () => void
  onData: (stationId: string, data: string) => void
  onResize: (stationId: string, cols: number, rows: number) => void
  onBindSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot?: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onRestoreStateCaptured?: (
    stationId: string,
    state: { content: string; cols: number; rows: number },
    sourceSessionId: string | null,
  ) => void
}

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
const TERMINAL_MIN_VISIBLE_SIZE_PX = 4
const TERMINAL_OVERVIEW_RULER_WIDTH = 0
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

function readCssVar(name: string, doc: Document): string {
  return getComputedStyle(doc.documentElement).getPropertyValue(name).trim()
}

function readCssVarOr(name: string, fallback: string, doc: Document): string {
  const value = readCssVar(name, doc)
  return value || fallback
}

function readRootFontSizePx(doc: Document): number {
  const value = Number.parseFloat(getComputedStyle(doc.documentElement).fontSize)
  if (!Number.isFinite(value) || value <= 0) {
    return 14
  }
  return value
}

function resolveTerminalFontSize(host?: HTMLElement | null): number {
  const doc = resolveTerminalDocument(host, document)
  const baseSize = Math.max(10, Math.round(readRootFontSizePx(doc) - 1))
  if (!host) {
    return baseSize
  }
  const { clientWidth, clientHeight } = host
  if (clientWidth <= 320 || clientHeight <= 220) {
    return Math.max(10, baseSize - 2)
  }
  if (clientWidth <= 420 || clientHeight <= 300) {
    return Math.max(10, baseSize - 1)
  }
  return baseSize
}

function getTerminalTheme(host?: HTMLElement | null): ITheme {
  const doc = resolveTerminalDocument(host, document)
  const isDark = doc.documentElement.getAttribute('data-theme') === 'graphite-dark'
  if (!isDark) {
    return {
      background: readCssVarOr('--vb-terminal-bg', '#f5f8fd', doc),
      foreground: readCssVarOr('--vb-terminal-text', '#1f2937', doc),
      cursor: readCssVarOr('--vb-terminal-caret', '#0a84ff', doc),
      cursorAccent: readCssVarOr('--vb-terminal-bg', '#f5f8fd', doc),
      selectionForeground: readCssVarOr('--vb-terminal-selection-text', '#0b1b31', doc),
      selectionBackground: readCssVarOr('--vb-terminal-selection-bg', 'rgba(10, 132, 255, 0.24)', doc),
      selectionInactiveBackground: readCssVarOr('--vb-terminal-selection-inactive', 'rgba(97, 138, 191, 0.18)', doc),
      overviewRulerBorder: 'transparent',
      scrollbarSliderBackground: readCssVarOr('--vb-terminal-scrollbar-thumb', 'rgba(84, 106, 134, 0.34)', doc),
      scrollbarSliderHoverBackground: readCssVarOr(
        '--vb-terminal-scrollbar-thumb-hover',
        'rgba(84, 106, 134, 0.52)',
        doc,
      ),
      scrollbarSliderActiveBackground: readCssVarOr(
        '--vb-terminal-scrollbar-thumb-active',
        'rgba(84, 106, 134, 0.68)',
        doc,
      ),
      black: '#455160',
      red: '#ba4a58',
      green: '#2d7d5b',
      yellow: '#9b6a28',
      blue: '#1f6fa9',
      magenta: '#835fb8',
      cyan: '#2e7f8a',
      white: '#667487',
      brightBlack: '#6a788c',
      brightRed: '#d76170',
      brightGreen: '#369a70',
      brightYellow: '#b8863f',
      brightBlue: '#2b88cb',
      brightMagenta: '#9a74cf',
      brightCyan: '#3f97a3',
      brightWhite: '#1c2633',
    }
  }
  return {
    background: readCssVarOr('--vb-terminal-bg', '#0f141c', doc),
    foreground: readCssVarOr('--vb-terminal-text', '#e6edf7', doc),
    cursor: readCssVarOr('--vb-terminal-caret', '#0a84ff', doc),
    cursorAccent: readCssVarOr('--vb-terminal-bg', '#0f141c', doc),
    selectionForeground: readCssVarOr('--vb-terminal-selection-text', '#f7fbff', doc),
    selectionBackground: readCssVarOr('--vb-terminal-selection-bg', 'rgba(122, 168, 255, 0.34)', doc),
    selectionInactiveBackground: readCssVarOr('--vb-terminal-selection-inactive', 'rgba(95, 128, 178, 0.24)', doc),
    overviewRulerBorder: 'transparent',
    scrollbarSliderBackground: readCssVarOr('--vb-terminal-scrollbar-thumb', 'rgba(130, 155, 186, 0.42)', doc),
    scrollbarSliderHoverBackground: readCssVarOr(
      '--vb-terminal-scrollbar-thumb-hover',
      'rgba(156, 179, 208, 0.6)',
      doc,
    ),
    scrollbarSliderActiveBackground: readCssVarOr(
      '--vb-terminal-scrollbar-thumb-active',
      'rgba(173, 196, 224, 0.74)',
      doc,
    ),
    black: '#768396',
    red: '#f08b96',
    green: '#80e2a7',
    yellow: '#ebcb7e',
    blue: '#8ab8ff',
    magenta: '#cfa0f1',
    cyan: '#7fdce5',
    white: '#e6edf7',
    brightBlack: '#9aa8bc',
    brightRed: '#ff9fab',
    brightGreen: '#9beabc',
    brightYellow: '#f5d993',
    brightBlue: '#a5c9ff',
    brightMagenta: '#ddb9f8',
    brightCyan: '#97e9ef',
    brightWhite: '#f5f8ff',
  }
}

function StationXtermTerminalView({
  stationId,
  sessionId,
  isActive = false,
  appearanceVersion,
  performanceDebugEnabled = false,
  onActivateStation,
  onData,
  onResize,
  onBindSink,
  onRenderedScreenSnapshot,
  onRestoreStateCaptured,
}: StationXtermTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const boundSinkRef = useRef<StationTerminalSink | null>(null)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const onRenderedScreenSnapshotRef = useRef(onRenderedScreenSnapshot)
  const onRestoreStateCapturedRef = useRef(onRestoreStateCaptured)
  const screenRevisionRef = useRef(0)
  const lastSnapshotSignatureRef = useRef('')
  const appearanceSyncFrameRef = useRef<number | null>(null)
  const focusTerminalRequestRef = useRef<(() => void) | null>(null)
  const focusRetryFrameRef = useRef<number | null>(null)
  const pendingAutoFocusRef = useRef(false)
  const lastAutoFocusStateRef = useRef<{ active: boolean; sessionId: string | null }>({
    active: false,
    sessionId: null,
  })

  const syncTerminalAppearance = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    const host = hostRef.current
    const doc = resolveTerminalDocument(host, document)
    terminal.options.fontFamily = readCssVar('--vb-font-mono', doc)
    terminal.options.fontSize = resolveTerminalFontSize(host)
    terminal.options.theme = getTerminalTheme(host)
    terminal.options.overviewRuler = { width: TERMINAL_OVERVIEW_RULER_WIDTH }
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
    onRestoreStateCapturedRef.current = onRestoreStateCaptured
  }, [onRestoreStateCaptured])

  useEffect(() => {
    screenRevisionRef.current = 0
    lastSnapshotSignatureRef.current = ''
  }, [sessionId])

  useEffect(() => {
    const previous = lastAutoFocusStateRef.current
    const sessionChanged = previous.sessionId !== sessionId
    const shouldAutoFocus = isActive && (!previous.active || sessionChanged)
    lastAutoFocusStateRef.current = { active: isActive, sessionId }
    if (!shouldAutoFocus) {
      return
    }
    pendingAutoFocusRef.current = true
    focusTerminalRequestRef.current?.()
  }, [isActive, sessionId])

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
        focusTerminalRequestRef.current = null
      } else {
        appearanceSyncFrameRef.current = null
        window.cancelAnimationFrame(frameId)
      }
      const focusFrameId = focusRetryFrameRef.current
      if (focusFrameId !== null) {
        focusRetryFrameRef.current = null
        window.cancelAnimationFrame(focusFrameId)
      }
      focusTerminalRequestRef.current = null
      pendingAutoFocusRef.current = false
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
    let resizeObserver: ResizeObserver | null = null
    let appearanceObserver: MutationObserver | null = null
    let refreshFrameId: number | null = null
    let readyFitFrameId: number | null = null
    let reportFrameId: number | null = null
    let reportTimeoutId: number | null = null
    let serializeFrameId: number | null = null
    let removeCompositionStartSyncListener: (() => void) | null = null
    let removeMacOsImeFallbackListeners: (() => void) | null = null
    let pendingNativeTextInputRef: { current: boolean } | null = null
    let pendingNativeTextInputXtermDataRef: { current: string | null } | null = null
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
          fontFamily: readCssVar('--vb-font-mono', resolveTerminalDocument(host, document)),
          fontSize: resolveTerminalFontSize(host),
          fontWeight: '500',
          fontWeightBold: '700',
          scrollback: 4000,
          theme: getTerminalTheme(host),
          overviewRuler: { width: TERMINAL_OVERVIEW_RULER_WIDTH },
          drawBoldTextInBrightColors: true,
          minimumContrastRatio: 1,
        })
        const fitAddon = new fitModule.FitAddon()
        const serializeAddon = new serializeModule.SerializeAddon()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(serializeAddon)
        terminal.open(host)

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon
        scheduleTerminalAppearanceSync()

        const isMacOsWebKitImeFallbackEnabled = isMacOsWebKitTextInputEnvironment({
          platform: window.navigator.platform,
          userAgent: window.navigator.userAgent,
        })
        let suppressedDeferredXtermEchoRef: { current: string | null } | null = null
        const terminalTextarea = terminal.textarea
        if (terminalTextarea) {
          // Backport the upstream xterm fix that re-syncs the helper textarea before IME
          // composition starts. Dynamic TUIs like Claude Code redraw aggressively, and
          // xterm 6.0.0 can otherwise lock the IME anchor to a stale cursor position.
          const syncTextareaBeforeCompositionStart = () => {
            const terminalCore = terminal as typeof terminal & {
              _core?: { _syncTextArea?: () => void }
            }
            terminalCore._core?._syncTextArea?.()
          }
          terminalTextarea.addEventListener('compositionstart', syncTextareaBeforeCompositionStart, true)
          removeCompositionStartSyncListener = () => {
            terminalTextarea.removeEventListener('compositionstart', syncTextareaBeforeCompositionStart, true)
          }
        }
        if (isMacOsWebKitImeFallbackEnabled && terminalTextarea) {
          // macOS WebKit/WKWebView can route IME + Shift text through delayed input events that
          // xterm 6.0.0 misses on keydown/keypress. Keep xterm in charge of normal composition,
          // but let these shifted text keys fall through to the native input event path.
          pendingNativeTextInputRef = { current: false }
          pendingNativeTextInputXtermDataRef = { current: null as string | null }
          suppressedDeferredXtermEchoRef = { current: null as string | null }
          terminal.attachCustomKeyEventHandler((event) => {
            const shouldBypass = shouldBypassXtermTextKeyEvent(event, isMacOsWebKitImeFallbackEnabled)
            if (shouldBypass) {
              pendingNativeTextInputRef!.current = true
              pendingNativeTextInputXtermDataRef!.current = null
            }
            return !shouldBypass
          })
          const resetPendingNativeTextInput = () => {
            pendingNativeTextInputRef!.current = false
            pendingNativeTextInputXtermDataRef!.current = null
          }
          const handleDeferredMacOsImeTextInput = (rawEvent: Event) => {
            const event = rawEvent as InputEvent
            if (!pendingNativeTextInputRef?.current) {
              return
            }
            const resolution = resolveDeferredMacOsTextInputHandling({
              event,
              isMacOsWebKitEnvironment: isMacOsWebKitImeFallbackEnabled,
              textareaValue: terminalTextarea.value,
              xtermData: pendingNativeTextInputXtermDataRef?.current ?? null,
            })
            if (resolution.action === 'pending') {
              return
            }
            resetPendingNativeTextInput()
            // Let xterm own the helper textarea lifecycle. Clearing it here desynchronizes
            // WebKit's native text state from xterm's composition bookkeeping, which can
            // leave stale glyphs visible after Backspace on macOS.
            if (resolution.nextTextareaValue !== terminalTextarea.value) {
              terminalTextarea.value = resolution.nextTextareaValue
            }
            if (resolution.action === 'forward' && resolution.text) {
              const suppressedDeferredXtermEcho = suppressedDeferredXtermEchoRef
              if (suppressedDeferredXtermEcho) {
                suppressedDeferredXtermEcho.current = resolution.text
              }
              onDataRef.current(stationId, resolution.text)
            }
          }
          // After IME composition ends, reset the deferred input flag so the next
          // keystroke is not mistakenly treated as a continuation of the old
          // composition.  Do NOT clear terminalTextarea.value here – xterm manages
          // the textarea content internally, and wiping it externally causes the
          // display to get out of sync (e.g. stale text after Backspace).
          const handleCompositionEnd = () => {
            queueMicrotask(() => {
              resetPendingNativeTextInput()
            })
          }
          terminalTextarea.addEventListener('input', handleDeferredMacOsImeTextInput)
          terminalTextarea.addEventListener('compositionend', handleCompositionEnd)
          terminalTextarea.addEventListener('blur', resetPendingNativeTextInput, true)
          removeMacOsImeFallbackListeners = () => {
            resetPendingNativeTextInput()
            const suppressedDeferredXtermEcho = suppressedDeferredXtermEchoRef
            if (suppressedDeferredXtermEcho) {
              suppressedDeferredXtermEcho.current = null
            }
            terminalTextarea.removeEventListener('input', handleDeferredMacOsImeTextInput)
            terminalTextarea.removeEventListener('compositionend', handleCompositionEnd)
            terminalTextarea.removeEventListener('blur', resetPendingNativeTextInput, true)
          }
        }

        const cancelScheduledTerminalFocus = () => {
          const frameId = focusRetryFrameRef.current
          if (frameId === null) {
            return
          }
          focusRetryFrameRef.current = null
          window.cancelAnimationFrame(frameId)
        }
        const terminalHasDomFocus = () => {
          const textarea = terminal.textarea
          if (textarea && textarea.ownerDocument.activeElement === textarea) {
            return true
          }
          return host.matches(':focus-within')
        }
        const requestTerminalFocus = (retryFrames = 8) => {
          cancelScheduledTerminalFocus()
          let remainingFrames = Math.max(0, retryFrames)
          const attemptFocus = () => {
            if (!active) {
              return
            }
            try {
              terminal.focus()
            } catch {
              return
            }
            scheduleRefresh()
            if (terminalHasDomFocus()) {
              return
            }
            if (remainingFrames <= 0) {
              return
            }
            remainingFrames -= 1
            focusRetryFrameRef.current = window.requestAnimationFrame(() => {
              focusRetryFrameRef.current = null
              attemptFocus()
            })
          }
          attemptFocus()
        }
        focusTerminalRequestRef.current = () => {
          pendingAutoFocusRef.current = false
          requestTerminalFocus()
        }
        if (pendingAutoFocusRef.current) {
          focusTerminalRequestRef.current()
        }

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
          if (performanceDebugEnabled) {
            return
          }
          try {
            serializedRestoreState = serializeAddon.serialize({
              scrollback: TERMINAL_SERIALIZE_SCROLLBACK_LINES,
              excludeModes: false,
              excludeAltBuffer: false,
            })
            serializedRestoreCols = terminal.cols
            serializedRestoreRows = terminal.rows
            onRestoreStateCapturedRef.current?.(
              stationId,
              {
                content: serializedRestoreState,
                cols: serializedRestoreCols,
                rows: serializedRestoreRows,
              },
              sessionId ?? null,
            )
          } catch {
            // No-op: serialization should not break terminal lifecycle.
          }
        }
        const scheduleSerializedRestoreStateCapture = () => {
          if (performanceDebugEnabled) {
            return
          }
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
          if (performanceDebugEnabled || !onRenderedScreenSnapshotRef.current) {
            return
          }
          if (reportFrameId !== null) {
            window.cancelAnimationFrame(reportFrameId)
          }
          reportFrameId = window.requestAnimationFrame(() => {
            reportFrameId = null
            if (!onRenderedScreenSnapshotRef.current) {
              return
            }
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
          if (performanceDebugEnabled || !onRenderedScreenSnapshotRef.current) {
            return
          }
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
            const nextFontSize = resolveTerminalFontSize(host)
            if (terminal.options.fontSize !== nextFontSize) {
              terminal.options.fontSize = nextFontSize
            }
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
          if (!shouldAcceptStationTerminalLocalInput(sessionId)) {
            return false
          }
          try {
            terminal.focus()
            terminal.input('\r', true)
            scheduleRefresh()
            return true
          } catch {
            return false
          }
        }

        dataDisposable = terminal.onData((data) => {
          if (!shouldAcceptStationTerminalLocalInput(sessionId)) {
            return
          }
          if (isMacOsWebKitImeFallbackEnabled && pendingNativeTextInputRef?.current && pendingNativeTextInputXtermDataRef) {
            // Remember what xterm already consumed during a deferred IME cycle so the
            // native input fallback does not replay the same committed text.
            pendingNativeTextInputXtermDataRef.current = (pendingNativeTextInputXtermDataRef.current ?? '') + data
          }
          if (isMacOsWebKitImeFallbackEnabled && suppressedDeferredXtermEchoRef) {
            const echoConsumption = consumeDeferredMacOsXtermEcho(
              suppressedDeferredXtermEchoRef.current,
              data,
            )
            suppressedDeferredXtermEchoRef.current = echoConsumption.remainingEcho
            if (!echoConsumption.forwardedData) {
              return
            }
            onDataRef.current(stationId, echoConsumption.forwardedData)
            return
          }
          onDataRef.current(stationId, data)
        })
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

        const fontFaceSet = (resolveTerminalDocument(host, document) as Document & { fonts?: FontFaceSet }).fonts
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
        appearanceObserver.observe(resolveTerminalDocument(host, document).documentElement, {
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
            requestTerminalFocus()
          },
          submit: () => submitFromXterm(),
        }
        boundSinkRef.current = sink
        onBindSink(stationId, sink)
      },
    ).catch((error) => {
      console.warn('[StationXtermTerminal] Failed to load or initialize xterm runtime.', {
        stationId,
        sessionId,
        error,
      })
    })

    return () => {
      active = false
      const boundSink = boundSinkRef.current
      boundSinkRef.current = null
      onBindSink(stationId, null, {
        sourceSink: boundSink,
        sourceSessionId: sessionId,
        restoreState: serializedRestoreState,
        restoreCols: serializedRestoreCols,
        restoreRows: serializedRestoreRows,
      })
      dataDisposable?.dispose()
      resizeDisposable?.dispose()
      removeCompositionStartSyncListener?.()
      removeMacOsImeFallbackListeners?.()
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
      if (focusRetryFrameRef.current !== null) {
        window.cancelAnimationFrame(focusRetryFrameRef.current)
        focusRetryFrameRef.current = null
      }
      focusTerminalRequestRef.current = null
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    onBindSink,
    performanceDebugEnabled,
    scheduleTerminalAppearanceSync,
    sessionId,
    stationId,
  ])

  useEffect(() => {
    scheduleTerminalAppearanceSync()
  }, [appearanceVersion, scheduleTerminalAppearanceSync, stationId])

  return (
    <div
      className="station-terminal-shell"
      onPointerDownCapture={(event) => {
        if (event.button !== 0) {
          return
        }
        // Activate/focus on pointer down so first click lands in terminal input reliably.
        onActivateStation()
        focusTerminalRequestRef.current?.()
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
        focusTerminalRequestRef.current?.()
      }}
    >
      <div ref={hostRef} className="station-terminal-host" />
    </div>
  )
}

export const StationXtermTerminal = memo(StationXtermTerminalView)
