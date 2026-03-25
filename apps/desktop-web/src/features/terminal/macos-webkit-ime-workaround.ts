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
  if (event.ctrlKey || event.metaKey || event.altKey || !event.shiftKey) {
    return false
  }
  if (event.keyCode === 229 || event.isComposing) {
    return true
  }
  return event.key.length === 1
}

export function shouldForwardDeferredMacOsTextInput(
  event: TextInputEventLike,
  isMacOsWebKitEnvironment: boolean,
): boolean {
  return (
    isMacOsWebKitEnvironment &&
    !event.defaultPrevented &&
    Boolean(event.data) &&
    event.inputType === 'insertText'
  )
}
