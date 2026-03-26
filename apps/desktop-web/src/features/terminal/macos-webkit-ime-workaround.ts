export interface TextInputEnvironmentLike {
  platform: string
  userAgent: string
}

export interface TextKeyEventLike {
  type: string
  key: string
  keyCode: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

export interface TextInputEventLike {
  defaultPrevented: boolean
  data: string | null
  inputType: string
}

const APPLE_WEBKIT_RE = /AppleWebKit/i
const CHROMIUM_RE = /Chrome|Chromium|CriOS|Edg|EdgiOS/i
const FIREFOX_RE = /Firefox|FxiOS/i
const DEFERRED_MACOS_IME_PENDING_INPUT_TYPES = new Set(['insertCompositionText', 'deleteCompositionText'])
const DEFERRED_MACOS_IME_FORWARD_INPUT_TYPES = new Set(['insertText', 'insertFromComposition'])

// Removed isSinglePrintableAsciiKey helper

export function isMacOsWebKitTextInputEnvironment({ platform, userAgent }: TextInputEnvironmentLike): boolean {
  return /Mac/i.test(platform) && APPLE_WEBKIT_RE.test(userAgent) && !CHROMIUM_RE.test(userAgent) && !FIREFOX_RE.test(userAgent)
}

export function shouldBypassXtermTextKeyEvent(
  event: TextKeyEventLike,
  isMacOsWebKitEnvironment: boolean,
): boolean {
  if (!isMacOsWebKitEnvironment) {
    return false
  }
  if (event.type !== 'keydown' && event.type !== 'keypress') {
    return false
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  // Control and navigation keys must always be handled by xterm directly,
  // even if WKWebView mistakenly tags them with keyCode 229 while the IME is active.
  const isControlKey = [
    'Backspace', 'Delete', 'Enter', 'Escape', 'Tab',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown'
  ].includes(event.key)
  if (isControlKey) {
    return false
  }
  
  return event.keyCode === 229 || event.key === 'Process' || Boolean(event.isComposing)
}

export function shouldKeepDeferredMacOsTextInputPending(
  event: TextInputEventLike,
  isMacOsWebKitEnvironment: boolean,
): boolean {
  return isMacOsWebKitEnvironment && !event.defaultPrevented && DEFERRED_MACOS_IME_PENDING_INPUT_TYPES.has(event.inputType)
}

export function shouldForwardDeferredMacOsTextInput(
  event: TextInputEventLike,
  isMacOsWebKitEnvironment: boolean,
): boolean {
  return (
    isMacOsWebKitEnvironment &&
    !event.defaultPrevented &&
    Boolean(event.data) &&
    DEFERRED_MACOS_IME_FORWARD_INPUT_TYPES.has(event.inputType)
  )
}

export function shouldSkipDeferredMacOsTextInput(eventData: string | null, xtermData: string | null): boolean {
  if (!eventData || !xtermData) {
    return false
  }
  // Exact match – xterm already consumed the same text.
  if (eventData === xtermData) {
    return true
  }
  // Partial containment – xterm consumed more data that includes this text.
  if (xtermData.length > eventData.length && xtermData.includes(eventData)) {
    return true
  }
  // The event data ends with the xterm data – commonly seen when WKWebView
  // replays a suffix of the committed composition.
  if (eventData.length > xtermData.length && eventData.endsWith(xtermData)) {
    return true
  }
  return false
}
