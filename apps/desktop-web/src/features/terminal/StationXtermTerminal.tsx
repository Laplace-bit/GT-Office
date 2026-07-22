import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  shouldAcceptStationTerminalLocalInput,
  shouldPrioritizeStationTerminalRuntimeInit,
} from './station-terminal-runtime-state'
import { resolveTerminalDocument } from './station-terminal-document-scope'
import '@xterm/xterm/css/xterm.css'
import './StationXtermTerminal.scss'
import type { ITheme, Terminal as XtermTerminal } from '@xterm/xterm'
import type { RenderedScreenSnapshot } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  consumeDeferredMacOsXtermEcho,
  isMacOsWebKitTextInputEnvironment,
  resolveDeferredMacOsTextInputHandling,
  shouldBypassXtermTextKeyEvent,
} from './macos-webkit-ime-workaround'
import { shouldUseStationTerminalWebglRenderer } from './station-terminal-renderer-policy'
import {
  installStationTerminalWindowDiagnostics,
  recordStationTerminalFocusDiagnostic,
  resolveStationTerminalPointerDownFocusPlan,
  type StationTerminalFocusDiagnosticKind,
} from './station-terminal-focus-diagnostics'
import {
  resolveStationTerminalFocusRequest,
  shouldContinueStationTerminalFocusAttempt,
  shouldConsumeInactiveStationTerminalMouseGesture,
  shouldFlushPendingStationTerminalFocus,
  shouldRequestStationTerminalAutoFocus,
} from './station-terminal-focus-runtime'
import {
  refreshStationTerminalAfterTextureAtlasRecovery,
  scheduleStationTerminalAppearanceSyncFrame,
  scheduleStationTerminalRenderRefreshFrame,
  scheduleStationTerminalRendererRecoveryFrameDrain,
  shouldRecycleStationTerminalRenderer,
  type StationTerminalAppearanceSyncFrame,
  type StationTerminalRenderRefreshFrame,
  type StationTerminalRendererRecoveryFrameDrain,
} from './station-terminal-render-recovery'
import {
  hasTerminalFileDropPayload,
  readTerminalFileDropPayload,
  type TerminalFileDropPayload,
} from '@shell/utils/terminal-file-drop'
import {
  resolveTerminalSerializeDelayMs,
  scheduleTerminalCaptureTaskFrameDrain,
  shouldScheduleRenderedScreenCapture,
  type TerminalCaptureTaskFrameDrain,
  type TerminalCaptureTaskKind,
} from './station-terminal-capture-policy'
import {
  cancelStationTerminalFrameFlush,
  createStationTerminalFrameFlushScheduler,
  scheduleStationTerminalFrameFlush,
  type StationTerminalFrameFlushHandle,
} from './station-terminal-frame-flush-scheduler'
import {
  scheduleStationTerminalFitRetryFrame,
  type StationTerminalFitRetryFrame,
} from './station-terminal-resize'
import { normalizeStationTerminalRestoreViewportY } from './station-terminal-restore-state'
import type {
  StationTerminalSink,
  StationTerminalSinkBindingHandler,
} from './station-terminal-sink-types'

export type {
  StationTerminalSink,
  StationTerminalSinkBindingHandler,
  StationTerminalSinkBindingMeta,
} from './station-terminal-sink-types'

interface StationXtermTerminalProps {
  locale: Locale
  workspaceId?: string | null
  stationId: string
  sessionId: string | null
  stateRaw?: string | null
  isActive?: boolean
  appearanceVersion: string
  performanceDebugEnabled?: boolean
  onActivateStation: () => void
  onData: (stationId: string, data: string) => void
  onResize: (stationId: string, cols: number, rows: number) => void
  onBindSink: StationTerminalSinkBindingHandler
  onRenderedScreenSnapshot?: (stationId: string, snapshot: RenderedScreenSnapshot) => void
  onDropFilePath?: (stationId: string, payload: TerminalFileDropPayload) => Promise<void> | void
  onRestoreStateCaptured?: (
    stationId: string,
    state: { content: string; cols: number; rows: number; viewportY?: number | null },
    sourceSessionId: string | null,
  ) => void
}

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
const TERMINAL_MIN_VISIBLE_SIZE_PX = 4
const TERMINAL_OVERVIEW_RULER_WIDTH = 0
const RENDERED_SCREEN_REPORT_THROTTLE_MS = 280
const RENDERED_SCREEN_CAPTURE_MAX_LINES = 1200
// This is deliberately high enough for compiler and agent transcripts while
// staying bounded per mounted terminal. xterm's WebGL renderer keeps scrolling
// smooth without handing a giant DOM tree to the WebView.
const TERMINAL_SCROLLBACK_LINES = 20_000
const TERMINAL_SERIALIZE_SCROLLBACK_LINES = TERMINAL_SCROLLBACK_LINES
const TERMINAL_SERIALIZE_MIN_INTERVAL_MS = 2400
const TERMINAL_SERIALIZE_IDLE_TIMEOUT_MS = 1100
const TERMINAL_SERIALIZE_IDLE_FALLBACK_DELAY_MS = 120
const BACKGROUND_TERMINAL_INIT_TIMEOUT_MS = 1200
const BACKGROUND_TERMINAL_INIT_FALLBACK_DELAY_MS = 96
const TERMINAL_RENDERER_RECOVERY_DELAY_MS = 180
const TERMINAL_RENDERER_RECOVERY_FRAME_COUNT = 2
const TERMINAL_VIEWPORT_WAKE_DELAYS_MS = [0, 48, 160, 360] as const
const TERMINAL_FIT_RETRY_FRAME_LIMIT = 6
const TERMINAL_FIT_RETRY_BACKOFF_MIN_MS = 96
const TERMINAL_FIT_RETRY_BACKOFF_MAX_MS = 640
const TERMINAL_INTERACTION_FRAME_FALLBACK_MS = 48

interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

interface IdleCallbackScheduler {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout?: number },
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

interface BackgroundTerminalInitTask {
  cancelled: boolean
  run: () => void
}

let backgroundTerminalInitScheduled: { kind: 'idle' | 'timeout'; id: number } | null = null
const backgroundTerminalInitQueue: BackgroundTerminalInitTask[] = []

function scheduleBackgroundTerminalInitDrain() {
  if (typeof window === 'undefined') {
    return
  }
  if (backgroundTerminalInitScheduled || backgroundTerminalInitQueue.length === 0) {
    return
  }
  const win = window as unknown as IdleCallbackScheduler
  const runNext = (deadline: IdleDeadlineLike) => {
    backgroundTerminalInitScheduled = null
    if (!deadline.didTimeout && deadline.timeRemaining() < 6) {
      scheduleBackgroundTerminalInitDrain()
      return
    }
    let nextTask = backgroundTerminalInitQueue.shift()
    while (nextTask?.cancelled) {
      nextTask = backgroundTerminalInitQueue.shift()
    }
    nextTask?.run()
    scheduleBackgroundTerminalInitDrain()
  }

  if (win.requestIdleCallback) {
    backgroundTerminalInitScheduled = {
      kind: 'idle',
      id: win.requestIdleCallback(runNext, { timeout: BACKGROUND_TERMINAL_INIT_TIMEOUT_MS }),
    }
    return
  }

  backgroundTerminalInitScheduled = {
    kind: 'timeout',
    id: window.setTimeout(
      () => runNext({ didTimeout: true, timeRemaining: () => 0 }),
      BACKGROUND_TERMINAL_INIT_FALLBACK_DELAY_MS,
    ),
  }
}

function scheduleBackgroundTerminalInit(run: () => void): () => void {
  const task: BackgroundTerminalInitTask = { cancelled: false, run }
  backgroundTerminalInitQueue.push(task)
  scheduleBackgroundTerminalInitDrain()
  return () => {
    task.cancelled = true
  }
}

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

function bufferHasMeaningfulContent(terminal: XtermTerminal): boolean {
  const buffer = terminal.buffer.active
  const totalLines =
    typeof buffer.length === 'number'
      ? buffer.length
      : Math.max(buffer.baseY + terminal.rows, terminal.rows)
  const start = Math.max(0, totalLines - 240)
  for (let index = totalLines - 1; index >= start; index -= 1) {
    const text = buffer.getLine(index)?.translateToString(false).trim() ?? ''
    if (text.length > 0) {
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

function resolveTerminalFontFamily(host?: HTMLElement | null): string {
  const doc = resolveTerminalDocument(host, document)
  return readCssVarOr(
    '--vb-font-mono',
    "ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace",
    doc,
  )
}

function getTerminalTheme(host?: HTMLElement | null): ITheme {
  const doc = resolveTerminalDocument(host, document)
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
    black: readCssVarOr('--vb-terminal-ansi-black', '#455160', doc),
    red: readCssVarOr('--vb-terminal-ansi-red', '#ba4a58', doc),
    green: readCssVarOr('--vb-terminal-ansi-green', '#2d7d5b', doc),
    yellow: readCssVarOr('--vb-terminal-ansi-yellow', '#9b6a28', doc),
    blue: readCssVarOr('--vb-terminal-ansi-blue', '#1f6fa9', doc),
    magenta: readCssVarOr('--vb-terminal-ansi-magenta', '#835fb8', doc),
    cyan: readCssVarOr('--vb-terminal-ansi-cyan', '#2e7f8a', doc),
    white: readCssVarOr('--vb-terminal-ansi-white', '#667487', doc),
    brightBlack: readCssVarOr('--vb-terminal-ansi-bright-black', '#6a788c', doc),
    brightRed: readCssVarOr('--vb-terminal-ansi-bright-red', '#d76170', doc),
    brightGreen: readCssVarOr('--vb-terminal-ansi-bright-green', '#369a70', doc),
    brightYellow: readCssVarOr('--vb-terminal-ansi-bright-yellow', '#b8863f', doc),
    brightBlue: readCssVarOr('--vb-terminal-ansi-bright-blue', '#2b88cb', doc),
    brightMagenta: readCssVarOr('--vb-terminal-ansi-bright-magenta', '#9a74cf', doc),
    brightCyan: readCssVarOr('--vb-terminal-ansi-bright-cyan', '#3f97a3', doc),
    brightWhite: readCssVarOr('--vb-terminal-ansi-bright-white', '#1c2633', doc),
  }
}

function StationXtermTerminalView({
  locale,
  workspaceId = null,
  stationId,
  sessionId,
  stateRaw = null,
  isActive = false,
  appearanceVersion,
  performanceDebugEnabled = false,
  onActivateStation,
  onData,
  onResize,
  onBindSink,
  onRenderedScreenSnapshot,
  onDropFilePath,
  onRestoreStateCaptured,
}: StationXtermTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const boundSinkRef = useRef<StationTerminalSink | null>(null)
  const shouldPrioritizeRuntimeInit = shouldPrioritizeStationTerminalRuntimeInit(isActive, stateRaw)
  const [runtimeInitAllowed, setRuntimeInitAllowed] = useState(shouldPrioritizeRuntimeInit)
  const [rendererRecoveryVersion, setRendererRecoveryVersion] = useState(0)
  const [fileDropActive, setFileDropActive] = useState(false)
  const [fileDropLabel, setFileDropLabel] = useState<string | null>(null)
  const [fileDropPulse, setFileDropPulse] = useState<{ token: number; label: string } | null>(null)
  const isActiveRef = useRef(isActive)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const onRenderedScreenSnapshotRef = useRef(onRenderedScreenSnapshot)
  const onRestoreStateCapturedRef = useRef(onRestoreStateCaptured)
  const screenRevisionRef = useRef(0)
  const lastSnapshotSignatureRef = useRef('')
  const appearanceSyncFrameRef = useRef<StationTerminalAppearanceSyncFrame | null>(null)
  const focusTerminalRequestRef = useRef<(() => void) | null>(null)
  const focusRetryFrameRef = useRef<StationTerminalFrameFlushHandle | null>(null)
  const focusRuntimeReadyRef = useRef(false)
  const pendingAutoFocusRef = useRef(false)
  const pendingInactiveActivationCleanupRef = useRef<(() => void) | null>(null)
  const pendingInactiveActivationFrameRef = useRef<StationTerminalFrameFlushHandle | null>(null)
  const pendingInactiveActivationClickCleanupRef = useRef<(() => void) | null>(null)
  const pendingInactiveActivationClickTimeoutRef = useRef<number | null>(null)
  const pendingInactiveActivationGuardElementRef = useRef<HTMLElement | null>(null)
  const pendingInactiveActivationGuardTimeoutRef = useRef<number | null>(null)
  const rendererRecoveryTimerRef = useRef<number | null>(null)
  const rendererRecoveryFrameRef = useRef<StationTerminalRendererRecoveryFrameDrain | null>(null)
  const rendererRecoveryTokenRef = useRef(0)
  const rendererRecoveryInFlightRef = useRef(false)
  const fileDropDepthRef = useRef(0)
  const fileDropPulseTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef(sessionId)
  const stateRawRef = useRef(stateRaw)
  const isMacOsWebKitEnvironmentRef = useRef(
    typeof window !== 'undefined'
      ? isMacOsWebKitTextInputEnvironment({
          platform: window.navigator.platform,
          userAgent: window.navigator.userAgent,
        })
      : false,
  )
  const lastAutoFocusStateRef = useRef<{ active: boolean; sessionId: string | null; inputReady: boolean }>({
    active: false,
    sessionId: null,
    inputReady: false,
  })
  const lastRenderEventSeqRef = useRef(0)

  const recordFocusDiagnostic = useCallback(
    (kind: StationTerminalFocusDiagnosticKind, detail?: string) => {
      if (typeof window === 'undefined') {
        return
      }
      void recordStationTerminalFocusDiagnostic({
        targetWindow: window,
        workspaceId,
        stationId,
        sessionId,
        kind,
        detail,
      })
    },
    [sessionId, stationId, workspaceId],
  )

  const cancelPendingInactiveActivation = useCallback(() => {
    const cleanup = pendingInactiveActivationCleanupRef.current
    if (cleanup) {
      pendingInactiveActivationCleanupRef.current = null
      cleanup()
    }
    cancelStationTerminalFrameFlush(pendingInactiveActivationFrameRef.current)
    pendingInactiveActivationFrameRef.current = null
  }, [])

  const cancelPendingInactiveActivationClickSuppression = useCallback(() => {
    const cleanup = pendingInactiveActivationClickCleanupRef.current
    if (cleanup) {
      pendingInactiveActivationClickCleanupRef.current = null
      cleanup()
    }
    const timeoutId = pendingInactiveActivationClickTimeoutRef.current
    if (timeoutId !== null) {
      pendingInactiveActivationClickTimeoutRef.current = null
      window.clearTimeout(timeoutId)
    }
  }, [])

  const cancelPendingInactiveActivationGuard = useCallback(() => {
    const guardElement = pendingInactiveActivationGuardElementRef.current
    if (guardElement) {
      pendingInactiveActivationGuardElementRef.current = null
      guardElement.removeAttribute('data-terminal-activation-guard')
      recordFocusDiagnostic('activation-guard', 'released')
    }
    const timeoutId = pendingInactiveActivationGuardTimeoutRef.current
    if (timeoutId !== null) {
      pendingInactiveActivationGuardTimeoutRef.current = null
      window.clearTimeout(timeoutId)
    }
  }, [recordFocusDiagnostic])

  const armPendingInactiveActivationGuard = useCallback(
    (container: HTMLElement | null) => {
      if (typeof window === 'undefined' || !container) {
        return
      }
      cancelPendingInactiveActivationGuard()
      pendingInactiveActivationGuardElementRef.current = container
      container.setAttribute('data-terminal-activation-guard', 'true')
      recordFocusDiagnostic('activation-guard', container.className || container.tagName.toLowerCase())
      pendingInactiveActivationGuardTimeoutRef.current = window.setTimeout(() => {
        pendingInactiveActivationGuardTimeoutRef.current = null
        cancelPendingInactiveActivationGuard()
      }, 420)
    },
    [cancelPendingInactiveActivationGuard, recordFocusDiagnostic],
  )

  const armPendingInactiveActivationClickSuppression = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    cancelPendingInactiveActivationClickSuppression()
    const handleClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      recordFocusDiagnostic('activation-consumed', 'phase=click')
      cancelPendingInactiveActivationClickSuppression()
    }
    pendingInactiveActivationClickCleanupRef.current = () => {
      window.removeEventListener('click', handleClick, true)
    }
    window.addEventListener('click', handleClick, true)
    pendingInactiveActivationClickTimeoutRef.current = window.setTimeout(() => {
      pendingInactiveActivationClickTimeoutRef.current = null
      cancelPendingInactiveActivationClickSuppression()
    }, 400)
  }, [cancelPendingInactiveActivationClickSuppression, recordFocusDiagnostic])

  const armPendingInactiveActivation = useCallback(
    (pointerId: number) => {
      if (typeof window === 'undefined') {
        return
      }
      cancelPendingInactiveActivation()
      const commitActivation = (phase: 'pointerup') => {
        cancelPendingInactiveActivation()
        armPendingInactiveActivationClickSuppression()
        recordFocusDiagnostic('activation-consumed', `phase=${phase}`)
        pendingInactiveActivationFrameRef.current = scheduleStationTerminalFrameFlush(
          () => {
            pendingInactiveActivationFrameRef.current = null
            onActivateStation()
          },
          createStationTerminalFrameFlushScheduler(window),
          TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
        )
      }
      const handlePointerUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        commitActivation('pointerup')
      }
      const handlePointerCancel = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) {
          return
        }
        cancelPendingInactiveActivation()
        cancelPendingInactiveActivationClickSuppression()
        cancelPendingInactiveActivationGuard()
      }
      pendingInactiveActivationCleanupRef.current = () => {
        window.removeEventListener('pointerup', handlePointerUp, true)
        window.removeEventListener('pointercancel', handlePointerCancel, true)
      }
      window.addEventListener('pointerup', handlePointerUp, true)
      window.addEventListener('pointercancel', handlePointerCancel, true)
    },
    [
      armPendingInactiveActivationClickSuppression,
      cancelPendingInactiveActivation,
      cancelPendingInactiveActivationClickSuppression,
      cancelPendingInactiveActivationGuard,
      onActivateStation,
      recordFocusDiagnostic,
    ],
  )

  const captureInactivePrimaryMouseGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): boolean => {
      if (
        !shouldConsumeInactiveStationTerminalMouseGesture({
          isActive,
          button: event.button,
        })
      ) {
        return false
      }
      event.preventDefault()
      event.stopPropagation()
      armPendingInactiveActivationGuard(
        event.currentTarget.closest('.station-window, .terminal-station-pane') as HTMLElement | null,
      )
      recordFocusDiagnostic('activation-consumed', 'phase=pointerdown')
      const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : null
      if (typeof PointerEvent !== 'undefined' && nativeEvent instanceof PointerEvent) {
        armPendingInactiveActivation(nativeEvent.pointerId)
      } else {
        cancelPendingInactiveActivation()
        pendingInactiveActivationFrameRef.current = scheduleStationTerminalFrameFlush(
          () => {
            pendingInactiveActivationFrameRef.current = null
            onActivateStation()
          },
          createStationTerminalFrameFlushScheduler(window),
          TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
        )
      }
      return true
    },
    [
      armPendingInactiveActivation,
      armPendingInactiveActivationGuard,
      isActive,
      onActivateStation,
      recordFocusDiagnostic,
    ],
  )

  const syncTerminalAppearance = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    const host = hostRef.current
    terminal.options.fontFamily = resolveTerminalFontFamily(host)
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
    appearanceSyncFrameRef.current = scheduleStationTerminalAppearanceSyncFrame({
      scheduler: createStationTerminalFrameFlushScheduler(window),
      fallbackDelayMs: TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
      run: () => {
        appearanceSyncFrameRef.current = null
        syncTerminalAppearance()
      },
    })
  }, [syncTerminalAppearance])

  const cancelScheduledRendererRecovery = useCallback(() => {
    if (rendererRecoveryTimerRef.current !== null) {
      window.clearTimeout(rendererRecoveryTimerRef.current)
      rendererRecoveryTimerRef.current = null
    }
    if (rendererRecoveryFrameRef.current !== null) {
      rendererRecoveryFrameRef.current.cancel()
      rendererRecoveryFrameRef.current = null
    }
  }, [])

  const recycleTerminalRenderer = useCallback(
    (reason: string) => {
      if (rendererRecoveryInFlightRef.current) {
        return
      }
      rendererRecoveryInFlightRef.current = true
      recordFocusDiagnostic('viewport-wake', `renderer-recycle:${reason}`)
      setRendererRecoveryVersion((value) => value + 1)
    },
    [recordFocusDiagnostic],
  )

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    stateRawRef.current = stateRaw
  }, [stateRaw])

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
    isActiveRef.current = isActive
    if (isActive) {
      cancelPendingInactiveActivation()
      cancelPendingInactiveActivationClickSuppression()
      cancelPendingInactiveActivationGuard()
    } else {
      cancelStationTerminalFrameFlush(focusRetryFrameRef.current)
      focusRetryFrameRef.current = null
    }
    if (shouldPrioritizeRuntimeInit) {
      setRuntimeInitAllowed(true)
    }
  }, [
    cancelPendingInactiveActivation,
    cancelPendingInactiveActivationClickSuppression,
    cancelPendingInactiveActivationGuard,
    isActive,
    shouldPrioritizeRuntimeInit,
  ])

  useEffect(() => {
    if (runtimeInitAllowed) {
      return
    }
    return scheduleBackgroundTerminalInit(() => {
      setRuntimeInitAllowed(true)
    })
  }, [runtimeInitAllowed])

  useEffect(() => {
    if (!isActive) {
      return
    }
    const sink = boundSinkRef.current
    if (!sink) {
      return
    }
    onBindSink(stationId, sink, { restorePriority: 'active' })
  }, [isActive, onBindSink, stationId])

  useEffect(() => {
    screenRevisionRef.current = 0
    lastSnapshotSignatureRef.current = ''
  }, [sessionId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    installStationTerminalWindowDiagnostics(window)
  }, [])

  useEffect(() => {
    const previous = lastAutoFocusStateRef.current
    const next = {
      active: isActive,
      sessionId,
      inputReady: shouldAcceptStationTerminalLocalInput({ sessionId, stateRaw }),
    }
    const shouldAutoFocus = shouldRequestStationTerminalAutoFocus({
      previous,
      next,
    })
    lastAutoFocusStateRef.current = next
    if (!shouldAutoFocus) {
      return
    }
    pendingAutoFocusRef.current = true
    if (
      shouldFlushPendingStationTerminalFocus({
        pendingAutoFocus: pendingAutoFocusRef.current,
        focusRuntimeReady: focusRuntimeReadyRef.current,
      })
    ) {
      focusTerminalRequestRef.current?.()
    }
  }, [isActive, sessionId, stateRaw])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [sessionId, stationId])

  useEffect(() => {
    return () => {
      cancelPendingInactiveActivation()
      cancelPendingInactiveActivationClickSuppression()
      cancelPendingInactiveActivationGuard()
      cancelScheduledRendererRecovery()
      const appearanceSyncFrame = appearanceSyncFrameRef.current
      if (appearanceSyncFrame === null) {
        focusTerminalRequestRef.current = null
      } else {
        appearanceSyncFrameRef.current = null
        appearanceSyncFrame.cancel()
      }
      cancelStationTerminalFrameFlush(focusRetryFrameRef.current)
      focusRetryFrameRef.current = null
      focusRuntimeReadyRef.current = false
      focusTerminalRequestRef.current = null
      pendingAutoFocusRef.current = false
      rendererRecoveryInFlightRef.current = false
    }
  }, [
    cancelPendingInactiveActivation,
    cancelPendingInactiveActivationClickSuppression,
    cancelPendingInactiveActivationGuard,
    cancelScheduledRendererRecovery,
  ])

  const resetFileDropState = useCallback(() => {
    fileDropDepthRef.current = 0
    setFileDropActive(false)
    setFileDropLabel(null)
  }, [])

  const triggerFileDropPulse = useCallback((label: string) => {
    if (fileDropPulseTimerRef.current !== null) {
      window.clearTimeout(fileDropPulseTimerRef.current)
    }
    setFileDropPulse({ token: Date.now(), label })
    fileDropPulseTimerRef.current = window.setTimeout(() => {
      fileDropPulseTimerRef.current = null
      setFileDropPulse(null)
    }, 520)
  }, [])

  useEffect(() => {
    return () => {
      if (fileDropPulseTimerRef.current !== null) {
        window.clearTimeout(fileDropPulseTimerRef.current)
        fileDropPulseTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !runtimeInitAllowed) {
      return
    }

    let active = true
    let dataDisposable: { dispose: () => void } | null = null
    let resizeDisposable: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null
    let appearanceObserver: MutationObserver | null = null
    let refreshFrame: StationTerminalRenderRefreshFrame | null = null
    let readyFitFrame: StationTerminalFitRetryFrame | null = null
    let readyFitTimeoutId: number | null = null
    let renderFallbackFrame: StationTerminalRenderRefreshFrame | null = null
    let renderFallbackBaselineSeq = 0
    let readyFitRetryCount = 0
    let readyFitBackoffMs = TERMINAL_FIT_RETRY_BACKOFF_MIN_MS
    let reportTimeoutId: number | null = null
    let captureTaskFrameDrain: TerminalCaptureTaskFrameDrain | null = null
    const pendingCaptureTasks = new Set<TerminalCaptureTaskKind>()
    let serializeTimeoutId: number | null = null
    let serializeIdleHandle: { kind: 'idle' | 'timeout'; id: number } | null = null
    let renderDisposable: { dispose: () => void } | null = null
    // Hoisted so the teardown closure can reach them: they are assigned inside the
    // async xterm loader below, but must be disposed alongside the other resources.
    let webglAddon: import('@xterm/addon-webgl').WebglAddon | null = null
    let webglContextLossDisposable: { dispose: () => void } | null = null
    let workspaceTransitionObserver: MutationObserver | null = null
    let viewportVisibilityObserver: IntersectionObserver | null = null
    let ancestorVisibilityObserver: MutationObserver | null = null
    let captureLatestRestoreState: (() => void) | null = null
    let removeViewportWakeListeners: (() => void) | null = null
    let removeCompositionStartSyncListener: (() => void) | null = null
    let removeTerminalFocusTextureRecoveryListener: (() => void) | null = null
    let removeMacOsImeFallbackListeners: (() => void) | null = null
    let pendingNativeTextInputRef: { current: boolean } | null = null
    let pendingNativeTextInputXtermDataRef: { current: string | null } | null = null
    let lastReportAtMs = 0
    let lastSerializedAtMs = 0
    let serializedRestoreState: string | null = null
    let serializedRestoreCols = 0
    let serializedRestoreRows = 0
    let serializedRestoreViewportY: number | null = null
    let pendingRestoreViewportY: number | null = null
    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-serialize'),
      import('@xterm/addon-webgl'),
      import('@xterm/addon-unicode11'),
    ]).then(
      ([xtermModule, fitModule, serializeModule, webglModule, unicode11Module]) => {
        if (!active) {
          return
        }

        const terminal = new xtermModule.Terminal({
          convertEol: false,
          fontFamily: resolveTerminalFontFamily(host),
          fontSize: resolveTerminalFontSize(host),
          fontWeight: 'normal',
          fontWeightBold: '700',
          lineHeight: 1.2,
          scrollback: TERMINAL_SCROLLBACK_LINES,
          theme: getTerminalTheme(host),
          overviewRuler: { width: TERMINAL_OVERVIEW_RULER_WIDTH },
          drawBoldTextInBrightColors: true,
          minimumContrastRatio: 4.5,
          cursorBlink: true,
          cursorStyle: 'bar',
          cursorWidth: 2,
          cursorInactiveStyle: 'outline',
          customGlyphs: true,
          // Unicode11Addon activates xterm's proposed Unicode API.
          allowProposedApi: true,
          rescaleOverlappingGlyphs: true,
          smoothScrollDuration: 125,
          scrollOnUserInput: true,
          fastScrollSensitivity: 5,
          altClickMovesCursor: true,
          rightClickSelectsWord: true,
        })
        const fitAddon = new fitModule.FitAddon()
        const serializeAddon = new serializeModule.SerializeAddon()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(serializeAddon)
        const unicode11Addon = new unicode11Module.Unicode11Addon()
        terminal.loadAddon(unicode11Addon)
        terminal.unicode.activeVersion = '11'
        terminal.open(host)

        // WKWebView can retain a corrupt WebGL glyph texture atlas after compositor
        // changes. Its default canvas renderer avoids that GPU-only failure mode.
        if (shouldUseStationTerminalWebglRenderer(isMacOsWebKitEnvironmentRef.current)) {
          try {
            webglAddon = new webglModule.WebglAddon(false)
            webglContextLossDisposable = webglAddon.onContextLoss(() => {
              webglContextLossDisposable?.dispose()
              webglContextLossDisposable = null
              try {
                webglAddon?.dispose()
              } catch {
                // No-op: dispose should never block terminal lifecycle.
              }
              webglAddon = null
              // The default renderer takes over automatically once the addon is disposed;
              // force a refresh so the recovered surface paints immediately.
              refreshTerminal()
            })
            // loadAddon wires the WebGL surface as the active renderer after open();
            // the addon self-registers internally — there is no separate register() call.
            terminal.loadAddon(webglAddon)
          } catch (error) {
            webglContextLossDisposable?.dispose()
            webglContextLossDisposable = null
            webglAddon = null
            const message = error instanceof Error ? error.message : String(error)
            recordFocusDiagnostic('webgl-unavailable', message)
          }
        }

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon
        rendererRecoveryInFlightRef.current = false
        scheduleTerminalAppearanceSync()
        let lastReportedTerminalCols = 0
        let lastReportedTerminalRows = 0
        const reportTerminalResize = (cols: number, rows: number) => {
          const nextCols = Math.floor(cols)
          const nextRows = Math.floor(rows)
          if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows) || nextCols <= 0 || nextRows <= 0) {
            return
          }
          if (nextCols === lastReportedTerminalCols && nextRows === lastReportedTerminalRows) {
            return
          }
          lastReportedTerminalCols = nextCols
          lastReportedTerminalRows = nextRows
          onResizeRef.current(stationId, nextCols, nextRows)
        }

        const isMacOsWebKitImeFallbackEnabled = isMacOsWebKitEnvironmentRef.current
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
        terminal.attachCustomKeyEventHandler((event) => {
          const shouldBypass = shouldBypassXtermTextKeyEvent(event, isMacOsWebKitImeFallbackEnabled)
          if (shouldBypass) {
            if (pendingNativeTextInputRef) {
              pendingNativeTextInputRef.current = true
            }
            if (pendingNativeTextInputXtermDataRef) {
              pendingNativeTextInputXtermDataRef.current = null
            }
          }
          return !shouldBypass
        })
        if (isMacOsWebKitImeFallbackEnabled && terminalTextarea) {
          // macOS WebKit/WKWebView can route IME + Shift text through delayed input events that
          // xterm 6.0.0 misses on keydown/keypress. Keep xterm in charge of normal composition,
          // but let these shifted text keys fall through to the native input event path.
          pendingNativeTextInputRef = { current: false }
          pendingNativeTextInputXtermDataRef = { current: null as string | null }
          suppressedDeferredXtermEchoRef = { current: null as string | null }
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
          cancelStationTerminalFrameFlush(focusRetryFrameRef.current)
          focusRetryFrameRef.current = null
        }
        const terminalHasDomFocus = () => {
          const textarea = terminal.textarea
          if (textarea && textarea.ownerDocument.activeElement === textarea) {
            return true
          }
          return host.matches(':focus-within')
        }
        const refreshTerminal = () => {
          terminal.refresh(0, Math.max(0, terminal.rows - 1))
        }
        const scheduleRefresh = () => {
          if (refreshFrame !== null) {
            return
          }
          refreshFrame = scheduleStationTerminalRenderRefreshFrame({
            scheduler: createStationTerminalFrameFlushScheduler(window),
            fallbackDelayMs: TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
            run: () => {
              refreshFrame = null
              refreshTerminal()
            },
          })
        }
        const scheduleRenderFallbackRefresh = (baselineRenderSeq: number) => {
          renderFallbackBaselineSeq = baselineRenderSeq
          if (renderFallbackFrame !== null) {
            return
          }
          renderFallbackFrame = scheduleStationTerminalRenderRefreshFrame({
            scheduler: createStationTerminalFrameFlushScheduler(window),
            fallbackDelayMs: TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
            run: () => {
              renderFallbackFrame = null
              if (!active || lastRenderEventSeqRef.current !== renderFallbackBaselineSeq) {
                return
              }
              refreshTerminal()
            },
          })
        }
        if (terminalTextarea) {
          const handleTerminalFocusTextureRecovery = () => {
            if (!active) {
              return
            }
            refreshStationTerminalAfterTextureAtlasRecovery(terminal)
          }
          terminalTextarea.addEventListener('focus', handleTerminalFocusTextureRecovery)
          removeTerminalFocusTextureRecoveryListener = () => {
            terminalTextarea.removeEventListener('focus', handleTerminalFocusTextureRecovery)
          }
        }
        const requestTerminalFocus = (retryFrames = 8) => {
          cancelScheduledTerminalFocus()
          if (terminalHasDomFocus()) {
            pendingAutoFocusRef.current = false
            recordFocusDiagnostic('focus-skip', 'already-has-focus')
            return
          }
          let remainingFrames = Math.max(0, retryFrames)
          const attemptFocus = () => {
            if (
              !shouldContinueStationTerminalFocusAttempt({
                componentMounted: active,
                stationActive: isActiveRef.current,
              })
            ) {
              return
            }
            recordFocusDiagnostic('focus-request', `remainingFrames=${remainingFrames}`)
            try {
              terminal.focus()
            } catch (error) {
              const message = error instanceof Error ? error.message : 'unknown focus failure'
              recordFocusDiagnostic('focus-error', message)
              return
            }
            if (terminalHasDomFocus()) {
              pendingAutoFocusRef.current = false
              scheduleRefresh()
              recordFocusDiagnostic('focus-success')
              return
            }
            if (remainingFrames <= 0) {
              return
            }
            remainingFrames -= 1
            focusRetryFrameRef.current = scheduleStationTerminalFrameFlush(
              () => {
                focusRetryFrameRef.current = null
                attemptFocus()
              },
              createStationTerminalFrameFlushScheduler(window),
              TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
            )
          }
          attemptFocus()
        }
        focusTerminalRequestRef.current = () => {
          const resolution = resolveStationTerminalFocusRequest({
            focusRuntimeReady: focusRuntimeReadyRef.current,
            documentFocused: resolveTerminalDocument(host, document).hasFocus(),
          })
          if (!resolution.shouldDispatch) {
            pendingAutoFocusRef.current = resolution.shouldPersistPending
            return
          }
          requestTerminalFocus()
        }
        focusRuntimeReadyRef.current = true
        if (
          shouldFlushPendingStationTerminalFocus({
            pendingAutoFocus: pendingAutoFocusRef.current,
            focusRuntimeReady: focusRuntimeReadyRef.current,
          })
        ) {
          focusTerminalRequestRef.current()
        }
        const captureSerializedRestoreState = () => {
          if (performanceDebugEnabled) {
            return
          }
          const currentSessionId = sessionIdRef.current?.trim() ?? ''
          if (!currentSessionId) {
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
            serializedRestoreViewportY =
              typeof terminal.buffer.active.viewportY === 'number'
                ? terminal.buffer.active.viewportY
                : null
            onRestoreStateCapturedRef.current?.(
              stationId,
              {
                content: serializedRestoreState,
                cols: serializedRestoreCols,
                rows: serializedRestoreRows,
                viewportY: serializedRestoreViewportY,
              },
              currentSessionId,
            )
            lastSerializedAtMs = Date.now()
          } catch {
            // No-op: serialization should not break terminal lifecycle.
          }
        }
        captureLatestRestoreState = captureSerializedRestoreState
        const canScheduleRenderedScreenCapture = () =>
          shouldScheduleRenderedScreenCapture({
            performanceDebugEnabled,
            isActive: isActiveRef.current,
            hasRenderedScreenReporter: Boolean(onRenderedScreenSnapshotRef.current),
          })
        const captureAndReportRenderedScreenSnapshot = () => {
          if (!canScheduleRenderedScreenCapture()) {
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
        }
        const runTerminalCaptureTask = (task: TerminalCaptureTaskKind) => {
          if (!active) {
            pendingCaptureTasks.clear()
            return
          }
          if (task === 'screen') {
            captureAndReportRenderedScreenSnapshot()
          } else if (task === 'serialize') {
            captureSerializedRestoreState()
          }
        }
        const queueTerminalCaptureTask = (task: TerminalCaptureTaskKind) => {
          if (!active) {
            return
          }
          pendingCaptureTasks.add(task)
          if (captureTaskFrameDrain !== null) {
            return
          }
          captureTaskFrameDrain = scheduleTerminalCaptureTaskFrameDrain({
            pending: pendingCaptureTasks,
            scheduler: createStationTerminalFrameFlushScheduler(window),
            fallbackDelayMs: TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
            shouldContinue: () => active,
            runTask: (nextTask) => {
              runTerminalCaptureTask(nextTask)
              if (pendingCaptureTasks.size <= 0) {
                captureTaskFrameDrain = null
              }
            },
          })
        }
        const cancelScheduledIdleSerializedRestoreStateCapture = () => {
          const scheduled = serializeIdleHandle
          if (!scheduled) {
            return
          }
          serializeIdleHandle = null
          if (scheduled.kind === 'idle') {
            const win = window as unknown as IdleCallbackScheduler
            win.cancelIdleCallback?.(scheduled.id)
            return
          }
          window.clearTimeout(scheduled.id)
        }
        const queueSerializedRestoreStateCapture = (mode: 'frame' | 'idle' = 'frame') => {
          if (performanceDebugEnabled) {
            return
          }
          if (pendingCaptureTasks.has('serialize') || serializeIdleHandle !== null) {
            return
          }
          if (mode === 'idle') {
            const win = window as unknown as IdleCallbackScheduler
            const runWhenIdle = (deadline: IdleDeadlineLike) => {
              serializeIdleHandle = null
              if (!active) {
                return
              }
              if (!deadline.didTimeout && deadline.timeRemaining() < 8) {
                queueSerializedRestoreStateCapture('idle')
                return
              }
              queueSerializedRestoreStateCapture('frame')
            }
            if (win.requestIdleCallback) {
              serializeIdleHandle = {
                kind: 'idle',
                id: win.requestIdleCallback(runWhenIdle, {
                  timeout: TERMINAL_SERIALIZE_IDLE_TIMEOUT_MS,
                }),
              }
              return
            }
            serializeIdleHandle = {
              kind: 'timeout',
              id: window.setTimeout(
                () => runWhenIdle({ didTimeout: true, timeRemaining: () => 0 }),
                TERMINAL_SERIALIZE_IDLE_FALLBACK_DELAY_MS,
              ),
            }
            return
          }
          queueTerminalCaptureTask('serialize')
        }
        const scheduleSerializedRestoreStateCapture = (priority: 'urgent' | 'throttled' = 'throttled') => {
          if (performanceDebugEnabled) {
            return
          }
          if (priority === 'urgent') {
            if (serializeTimeoutId !== null) {
              window.clearTimeout(serializeTimeoutId)
              serializeTimeoutId = null
            }
            cancelScheduledIdleSerializedRestoreStateCapture()
            queueSerializedRestoreStateCapture()
            return
          }
          const delay = resolveTerminalSerializeDelayMs(
            lastSerializedAtMs,
            Date.now(),
            TERMINAL_SERIALIZE_MIN_INTERVAL_MS,
          )
          if (delay === 0) {
            queueSerializedRestoreStateCapture('idle')
            return
          }
          if (serializeTimeoutId !== null) {
            return
          }
          serializeTimeoutId = window.setTimeout(() => {
            serializeTimeoutId = null
            queueSerializedRestoreStateCapture('idle')
          }, delay)
        }
        const captureRenderedScreenSnapshot = (): RenderedScreenSnapshot | null => {
          const activeSessionId = sessionIdRef.current?.trim()
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
          if (!canScheduleRenderedScreenCapture()) {
            return
          }
          queueTerminalCaptureTask('screen')
        }
        const scheduleRenderedScreenSnapshot = () => {
          if (!canScheduleRenderedScreenCapture()) {
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
        const reviveRendererTextures = () => {
          try {
            terminal.clearTextureAtlas()
          } catch {
            // No-op: texture atlas recovery is best effort.
          }
        }
        const applyPendingRestoreViewport = (clearAfterApply: boolean) => {
          if (pendingRestoreViewportY === null) {
            return false
          }
          const maxViewportY = Math.max(0, terminal.buffer.active.baseY)
          terminal.scrollToLine(Math.min(pendingRestoreViewportY, maxViewportY))
          if (clearAfterApply) {
            pendingRestoreViewportY = null
          }
          return true
        }
        const fitAndRefresh = () => {
          if (!active) {
            return false
          }
          const { clientWidth, clientHeight } = host
          if (clientWidth < TERMINAL_MIN_VISIBLE_SIZE_PX || clientHeight < TERMINAL_MIN_VISIBLE_SIZE_PX) {
            return false
          }
          reviveRendererTextures()
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
          applyPendingRestoreViewport(true)
          refreshTerminal()
          return true
        }
        const cancelScheduledFitRetry = () => {
          readyFitFrame?.cancel()
          readyFitFrame = null
          if (readyFitTimeoutId !== null) {
            window.clearTimeout(readyFitTimeoutId)
            readyFitTimeoutId = null
          }
        }
        const markFitSettled = () => {
          readyFitRetryCount = 0
          readyFitBackoffMs = TERMINAL_FIT_RETRY_BACKOFF_MIN_MS
          cancelScheduledFitRetry()
        }
        const scheduleRendererRecoveryCheck = (reason: string) => {
          if (!active) {
            return
          }
          cancelScheduledRendererRecovery()
          const recoveryToken = rendererRecoveryTokenRef.current + 1
          rendererRecoveryTokenRef.current = recoveryToken
          const renderEventSeqAtSchedule = lastRenderEventSeqRef.current
          rendererRecoveryFrameRef.current = scheduleStationTerminalRendererRecoveryFrameDrain(
            () => {
              rendererRecoveryFrameRef.current = null
              if (!active || rendererRecoveryTokenRef.current !== recoveryToken) {
                return
              }
              rendererRecoveryTimerRef.current = window.setTimeout(() => {
                rendererRecoveryTimerRef.current = null
                if (!active || rendererRecoveryTokenRef.current !== recoveryToken) {
                  return
                }
                if (
                  !shouldRecycleStationTerminalRenderer({
                    hasMeaningfulContent: bufferHasMeaningfulContent(terminal),
                    hasSerializedRestoreState: Boolean(serializedRestoreState),
                    renderEventSeqAtSchedule,
                    currentRenderEventSeq: lastRenderEventSeqRef.current,
                  })
                ) {
                  return
                }
                recycleTerminalRenderer(reason)
              }, TERMINAL_RENDERER_RECOVERY_DELAY_MS)
            },
            {
              frameCount: TERMINAL_RENDERER_RECOVERY_FRAME_COUNT,
              scheduler: createStationTerminalFrameFlushScheduler(window),
              fallbackDelayMs: TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
            },
          )
        }
        const ensureFitWhenVisible = () => {
          readyFitFrame = null
          if (!active) {
            return
          }
          if (fitAndRefresh()) {
            markFitSettled()
            reportTerminalResize(terminal.cols, terminal.rows)
            return
          }
          readyFitRetryCount += 1
          if (readyFitRetryCount >= TERMINAL_FIT_RETRY_FRAME_LIMIT) {
            readyFitRetryCount = 0
            const retryDelay = readyFitBackoffMs
            readyFitBackoffMs = Math.min(
              TERMINAL_FIT_RETRY_BACKOFF_MAX_MS,
              readyFitBackoffMs * 2,
            )
            scheduleFitRetry('backoff', retryDelay)
            return
          }
          scheduleFitRetry()
        }
        const scheduleFitRetry = (mode: 'frame' | 'backoff' = 'frame', delayMs = readyFitBackoffMs) => {
          if (!active || readyFitFrame !== null || readyFitTimeoutId !== null) {
            return
          }
          if (mode === 'backoff') {
            readyFitTimeoutId = window.setTimeout(() => {
              readyFitTimeoutId = null
              scheduleFitRetry()
            }, delayMs)
            return
          }
          readyFitFrame = scheduleStationTerminalFitRetryFrame({
            scheduler: createStationTerminalFrameFlushScheduler(window),
            fallbackDelayMs: TERMINAL_INTERACTION_FRAME_FALLBACK_MS,
            run: ensureFitWhenVisible,
          })
        }
        const hostDocument = resolveTerminalDocument(host, document)
        const hostWindow = hostDocument.defaultView ?? window
        const handleViewportWake = (reason = 'viewport-wake') => {
          if (!active) {
            return
          }
          if (pendingAutoFocusRef.current) {
            focusTerminalRequestRef.current?.()
          }
          cancelScheduledFitRetry()
          readyFitBackoffMs = TERMINAL_FIT_RETRY_BACKOFF_MIN_MS
          if (fitAndRefresh()) {
            markFitSettled()
            reportTerminalResize(terminal.cols, terminal.rows)
            scheduleRendererRecoveryCheck(reason)
            return
          }
          scheduleFitRetry()
          scheduleRendererRecoveryCheck(`${reason}:retry`)
        }
        const viewportWakeTimeoutIdsByDelay = new Map<number, number>()
        const scheduleViewportWake = (reason: string) => {
          if (!active) {
            return
          }
          for (const delay of TERMINAL_VIEWPORT_WAKE_DELAYS_MS) {
            if (viewportWakeTimeoutIdsByDelay.has(delay)) {
              continue
            }
            const timeoutId = hostWindow.setTimeout(() => {
              viewportWakeTimeoutIdsByDelay.delete(delay)
              handleViewportWake(reason)
            }, delay)
            viewportWakeTimeoutIdsByDelay.set(delay, timeoutId)
          }
        }
        const handleVisibilityChange = () => {
          if (hostDocument.visibilityState !== 'visible') {
            return
          }
          scheduleViewportWake('document-visible')
        }
        const handlePageShow = () => {
          scheduleViewportWake('page-show')
        }
        const handleTransitionSettled = (event: Event) => {
          if (!(event.target instanceof Node)) {
            return
          }
          if (event.target === host || host.contains(event.target) || event.target.contains(host)) {
            scheduleViewportWake(event.type)
          }
        }
        const handleWindowWake = () => {
          if (pendingAutoFocusRef.current) {
            focusTerminalRequestRef.current?.()
          }
          scheduleViewportWake('window-wake')
        }
        hostWindow.addEventListener('resize', handleWindowWake)
        hostWindow.addEventListener('focus', handleWindowWake)
        hostWindow.addEventListener('pageshow', handlePageShow)
        hostDocument.addEventListener('visibilitychange', handleVisibilityChange)
        hostDocument.addEventListener('transitionend', handleTransitionSettled, true)
        hostDocument.addEventListener('animationend', handleTransitionSettled, true)
        removeViewportWakeListeners = () => {
          for (const timeoutId of viewportWakeTimeoutIdsByDelay.values()) {
            hostWindow.clearTimeout(timeoutId)
          }
          viewportWakeTimeoutIdsByDelay.clear()
          hostWindow.removeEventListener('resize', handleWindowWake)
          hostWindow.removeEventListener('focus', handleWindowWake)
          hostWindow.removeEventListener('pageshow', handlePageShow)
          hostDocument.removeEventListener('visibilitychange', handleVisibilityChange)
          hostDocument.removeEventListener('transitionend', handleTransitionSettled, true)
          hostDocument.removeEventListener('animationend', handleTransitionSettled, true)
        }
        if (typeof IntersectionObserver !== 'undefined') {
          viewportVisibilityObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0)) {
              scheduleViewportWake('intersection-visible')
            }
          })
          viewportVisibilityObserver.observe(host)
        }
        const observedAncestors: HTMLElement[] = []
        let ancestor: HTMLElement | null = host
        while (ancestor) {
          observedAncestors.push(ancestor)
          if (ancestor.classList.contains('agent-shell')) {
            break
          }
          ancestor = ancestor.parentElement
        }
        if (observedAncestors.length > 0) {
          ancestorVisibilityObserver = new MutationObserver(() => {
            scheduleViewportWake('ancestor-visibility-change')
          })
          for (const element of observedAncestors) {
            ancestorVisibilityObserver.observe(element, {
              attributes: true,
              attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
            })
          }
        }
        const shellRoot = host.closest('.agent-shell')
        if (shellRoot) {
          let wasWorkspaceSwitching = shellRoot.classList.contains('workspace-switching-active')
          workspaceTransitionObserver = new MutationObserver(() => {
            const isWorkspaceSwitching = shellRoot.classList.contains('workspace-switching-active')
            if (wasWorkspaceSwitching && !isWorkspaceSwitching) {
              scheduleViewportWake('workspace-switch-complete')
            }
            wasWorkspaceSwitching = isWorkspaceSwitching
          })
          workspaceTransitionObserver.observe(shellRoot, {
            attributes: true,
            attributeFilter: ['class'],
          })
        }
        scheduleViewportWake('terminal-open')
        let replayGeneratedInputSuppressionDepth = 0
        const writeTerminalChunk = (content: string) =>
          new Promise<void>((resolve) => {
            terminal.write(content, () => {
              resolve()
            })
          })
        const writeReplayContent = (content: string) => {
          replayGeneratedInputSuppressionDepth += 1
          return writeTerminalChunk(content).finally(() => {
            replayGeneratedInputSuppressionDepth = Math.max(0, replayGeneratedInputSuppressionDepth - 1)
          })
        }
        const submitFromXterm = () => {
          if (
            !shouldAcceptStationTerminalLocalInput({
              sessionId: sessionIdRef.current,
              stateRaw: stateRawRef.current,
            })
          ) {
            return false
          }
          try {
            if (!terminalHasDomFocus()) {
              terminal.focus()
            }
            terminal.input('\r', true)
            scheduleRefresh()
            return true
          } catch {
            return false
          }
        }

        dataDisposable = terminal.onData((data) => {
          // Replaying cached terminal output can include control sequences such as
          // CPR/DSR requests. xterm will synthesize the matching response locally;
          // do not forward those replay-only responses back into the live PTY.
          if (replayGeneratedInputSuppressionDepth > 0) {
            return
          }
          if (
            !shouldAcceptStationTerminalLocalInput({
              sessionId: sessionIdRef.current,
              stateRaw: stateRawRef.current,
            })
          ) {
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
          reportTerminalResize(cols, rows)
        })
        renderDisposable = terminal.onRender(() => {
          lastRenderEventSeqRef.current += 1
        })
        // Delay first fit/resize sync until host has real dimensions.
        ensureFitWhenVisible()

        resizeObserver = new ResizeObserver(() => {
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
          write: async (chunk: string) => {
            if (!chunk) {
              return
            }
            const renderSeqBeforeWrite = lastRenderEventSeqRef.current
            if (terminal.cols <= 0 || terminal.rows <= 0) {
              scheduleFitRetry()
            }
            await writeTerminalChunk(chunk)
            scheduleRenderFallbackRefresh(renderSeqBeforeWrite)
            scheduleSerializedRestoreStateCapture('throttled')
            scheduleRenderedScreenSnapshot()
          },
          reset: async (content?: string) => {
            pendingRestoreViewportY = null
            terminal.reset()
            if (content) {
              if (terminal.cols <= 0 || terminal.rows <= 0) {
                scheduleFitRetry()
              }
              await writeReplayContent(content)
              scheduleRefresh()
              scheduleSerializedRestoreStateCapture('urgent')
            }
            scheduleRefresh()
          },
          restore: async (content: string, cols: number, rows: number, viewportY?: number | null) => {
            if (cols > 0 && rows > 0 && (terminal.cols !== cols || terminal.rows !== rows)) {
              terminal.resize(cols, rows)
            }
            terminal.reset()
            await writeReplayContent(content)
            pendingRestoreViewportY = normalizeStationTerminalRestoreViewportY(viewportY)
            applyPendingRestoreViewport(false)
            scheduleRefresh()
            scheduleSerializedRestoreStateCapture('urgent')
            if (fitAndRefresh()) {
              reportTerminalResize(terminal.cols, terminal.rows)
              return
            }
            scheduleFitRetry()
          },
          focus: () => {
            requestTerminalFocus()
          },
          submit: () => submitFromXterm(),
        }
        boundSinkRef.current = sink
        onBindSink(stationId, sink, {
          restorePriority: isActiveRef.current ? 'active' : 'background',
        })
      },
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      recordFocusDiagnostic('xterm-init-failed', message)
      console.warn('[StationXtermTerminal] Failed to load or initialize xterm runtime.', {
        stationId,
        sessionId,
        error,
      })
    })

    return () => {
      active = false
      captureLatestRestoreState?.()
      const boundSink = boundSinkRef.current
      boundSinkRef.current = null
      onBindSink(stationId, null, {
        sourceSink: boundSink,
        sourceSessionId: sessionIdRef.current,
        restoreState: serializedRestoreState,
        restoreCols: serializedRestoreCols,
        restoreRows: serializedRestoreRows,
        restoreViewportY: serializedRestoreViewportY,
      })
      dataDisposable?.dispose()
      resizeDisposable?.dispose()
      renderDisposable?.dispose()
      webglContextLossDisposable?.dispose()
      webglContextLossDisposable = null
      try {
        webglAddon?.dispose()
      } catch {
        // No-op: addon disposal is best-effort during teardown.
      }
      webglAddon = null
      removeViewportWakeListeners?.()
      removeCompositionStartSyncListener?.()
      removeTerminalFocusTextureRecoveryListener?.()
      removeMacOsImeFallbackListeners?.()
      resizeObserver?.disconnect()
      appearanceObserver?.disconnect()
      workspaceTransitionObserver?.disconnect()
      viewportVisibilityObserver?.disconnect()
      ancestorVisibilityObserver?.disconnect()
      cancelScheduledRendererRecovery()
      refreshFrame?.cancel()
      refreshFrame = null
      renderFallbackFrame?.cancel()
      renderFallbackFrame = null
      readyFitFrame?.cancel()
      readyFitFrame = null
      if (readyFitTimeoutId !== null) {
        window.clearTimeout(readyFitTimeoutId)
      }
      if (reportTimeoutId !== null) {
        window.clearTimeout(reportTimeoutId)
      }
      captureTaskFrameDrain?.cancel()
      captureTaskFrameDrain = null
      pendingCaptureTasks.clear()
      if (serializeTimeoutId !== null) {
        window.clearTimeout(serializeTimeoutId)
      }
      if (serializeIdleHandle !== null) {
        if (serializeIdleHandle.kind === 'idle') {
          const win = window as unknown as IdleCallbackScheduler
          win.cancelIdleCallback?.(serializeIdleHandle.id)
        } else {
          window.clearTimeout(serializeIdleHandle.id)
        }
      }
      cancelStationTerminalFrameFlush(focusRetryFrameRef.current)
      focusRetryFrameRef.current = null
      focusRuntimeReadyRef.current = false
      focusTerminalRequestRef.current = null
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    onBindSink,
    performanceDebugEnabled,
    recordFocusDiagnostic,
    runtimeInitAllowed,
    rendererRecoveryVersion,
    scheduleTerminalAppearanceSync,
    cancelScheduledRendererRecovery,
    recycleTerminalRenderer,
    sessionId,
    stationId,
  ])

  useEffect(() => {
    scheduleTerminalAppearanceSync()
  }, [appearanceVersion, scheduleTerminalAppearanceSync, stationId])

  const fileDropActiveStatus = fileDropLabel
    ? t(locale, '松开以发送文件路径到终端: {label}', 'Release to send file path to terminal: {label}', {
        label: fileDropLabel,
      })
    : t(locale, '松开以发送文件路径到终端', 'Release to send file path to terminal')
  const fileDropPulseStatus = fileDropPulse
    ? t(locale, '已发送文件路径到终端: {label}', 'Sent file path to terminal: {label}', {
        label: fileDropPulse.label,
      })
    : null

  return (
    <div
      className={`station-terminal-shell${runtimeInitAllowed ? '' : ' is-runtime-pending'}`}
      data-active={isActive ? 'true' : 'false'}
      data-file-drop-active={fileDropActive ? 'true' : 'false'}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) {
          return
        }
        const focusPlan = resolveStationTerminalPointerDownFocusPlan({
          isActive,
          isMacOsWebKitEnvironment: isMacOsWebKitEnvironmentRef.current,
        })
        recordFocusDiagnostic(
          'pointerdown',
          `active=${isActive ? 1 : 0};macosWebKit=${isMacOsWebKitEnvironmentRef.current ? 1 : 0};focusStrategy=${focusPlan.focusStrategy}`,
        )
        if (focusPlan.focusStrategy === 'none') {
          return
        }
        // Check if activation is already in progress to prevent duplicate activations
        if (pendingInactiveActivationCleanupRef.current || pendingInactiveActivationFrameRef.current !== null) {
          recordFocusDiagnostic('activation-consumed', 'phase=already-pending')
          return
        }
        captureInactivePrimaryMouseGesture(event)
        recordFocusDiagnostic('focus-deferred', 'await-active-terminal')
      }}
      onClick={(event) => {
        // Stop bubbling so card body click does not override terminal-first interaction.
        event.stopPropagation()
      }}
      onDragEnterCapture={(event) => {
        if (!hasTerminalFileDropPayload(event.dataTransfer.types)) {
          return
        }
        fileDropDepthRef.current += 1
        const payload = readTerminalFileDropPayload(event.dataTransfer)
        setFileDropLabel(payload?.label ?? null)
        setFileDropActive(true)
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragOverCapture={(event) => {
        if (!hasTerminalFileDropPayload(event.dataTransfer.types)) {
          return
        }
        const payload = readTerminalFileDropPayload(event.dataTransfer)
        if (payload?.label && payload.label !== fileDropLabel) {
          setFileDropLabel(payload.label)
        }
        if (!fileDropActive) {
          setFileDropActive(true)
        }
        event.dataTransfer.dropEffect = 'copy'
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragLeaveCapture={(event) => {
        if (!hasTerminalFileDropPayload(event.dataTransfer.types)) {
          return
        }
        fileDropDepthRef.current = Math.max(0, fileDropDepthRef.current - 1)
        if (fileDropDepthRef.current === 0) {
          setFileDropActive(false)
          setFileDropLabel(null)
        }
        event.stopPropagation()
      }}
      onDropCapture={(event) => {
        const payload = readTerminalFileDropPayload(event.dataTransfer)
        if (!payload) {
          return
        }
        resetFileDropState()
        onActivateStation()
        focusTerminalRequestRef.current?.()
        triggerFileDropPulse(payload.label)
        event.preventDefault()
        event.stopPropagation()
        if (onDropFilePath) {
          void Promise.resolve(onDropFilePath(stationId, payload))
          return
        }
        onData(stationId, payload.shellText)
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
    >
      <div
        className="station-terminal-drop-overlay"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={fileDropActiveStatus}
        aria-hidden={!fileDropActive}
      >
        <div className="station-terminal-drop-pill">
          <span className="station-terminal-drop-marker" />
          <span className="station-terminal-drop-label">{fileDropLabel ?? fileDropActiveStatus}</span>
        </div>
      </div>
      {fileDropPulse ? (
        <div
          key={fileDropPulse.token}
          className="station-terminal-drop-pulse"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={fileDropPulseStatus ?? undefined}
        >
          <span className="station-terminal-drop-marker" />
          <span className="station-terminal-drop-label">{fileDropPulse.label}</span>
        </div>
      ) : null}
      <div ref={hostRef} className="station-terminal-host" aria-hidden={!runtimeInitAllowed || undefined} />
    </div>
  )
}

export const StationXtermTerminal = memo(StationXtermTerminalView)
