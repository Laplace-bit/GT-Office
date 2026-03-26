import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMacOsWebKitTextInputEnvironment,
  shouldBypassXtermTextKeyEvent,
  shouldForwardDeferredMacOsTextInput,
  shouldKeepDeferredMacOsTextInputPending,
} from '../src/features/terminal/macos-webkit-ime-workaround.js'

test('detects macOS WebKit environments, including WKWebView-style user agents', () => {
  assert.equal(
    isMacOsWebKitTextInputEnvironment({
      platform: 'MacIntel',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    }),
    true,
  )

  assert.equal(
    isMacOsWebKitTextInputEnvironment({
      platform: 'MacIntel',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    }),
    false,
  )

  assert.equal(
    isMacOsWebKitTextInputEnvironment({
      platform: 'Win32',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    }),
    false,
  )
})

test('keeps generic shifted printable input on the normal xterm path on macOS WebKit', () => {
  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keydown',
        key: '@',
        keyCode: 50,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        isComposing: false,
      },
      true,
    ),
    false,
  )

  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keypress',
        key: '，',
        keyCode: 188,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        isComposing: false,
      },
      true,
    ),
    false,
  )
})

test('keeps xterm key handling for control shortcuts and navigation keys', () => {
  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keydown',
        key: 'r',
        keyCode: 82,
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      },
      true,
    ),
    false,
  )

  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keydown',
        key: 'Tab',
        keyCode: 9,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        isComposing: false,
      },
      true,
    ),
    false,
  )
})

test('treats IME composition key events as candidates for deferred input forwarding', () => {
  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keydown',
        key: 'Process',
        keyCode: 229,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      },
      true,
    ),
    true,
  )

  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keydown',
        key: 'a',
        keyCode: 65,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: true,
      },
      true,
    ),
    true,
  )
})

test('keeps deferred macOS text input pending across intermediate composition events', () => {
  assert.equal(
    shouldKeepDeferredMacOsTextInputPending(
      {
        defaultPrevented: false,
        data: '中',
        inputType: 'insertCompositionText',
      },
      true,
    ),
    true,
  )

  assert.equal(
    shouldKeepDeferredMacOsTextInputPending(
      {
        defaultPrevented: false,
        data: null,
        inputType: 'deleteCompositionText',
      },
      true,
    ),
    true,
  )

  assert.equal(
    shouldKeepDeferredMacOsTextInputPending(
      {
        defaultPrevented: true,
        data: '中',
        inputType: 'insertCompositionText',
      },
      true,
    ),
    false,
  )

  assert.equal(
    shouldKeepDeferredMacOsTextInputPending(
      {
        defaultPrevented: false,
        data: '@',
        inputType: 'insertText',
      },
      true,
    ),
    false,
  )
})

test('forwards deferred macOS text input only when xterm did not already consume it', () => {
  assert.equal(
    shouldForwardDeferredMacOsTextInput(
      {
        defaultPrevented: false,
        data: '@',
        inputType: 'insertText',
      },
      true,
    ),
    true,
  )

  assert.equal(
    shouldForwardDeferredMacOsTextInput(
      {
        defaultPrevented: false,
        data: '中',
        inputType: 'insertCompositionText',
      },
      true,
    ),
    false,
  )

  assert.equal(
    shouldForwardDeferredMacOsTextInput(
      {
        defaultPrevented: true,
        data: '@',
        inputType: 'insertText',
      },
      true,
    ),
    false,
  )

  assert.equal(
    shouldForwardDeferredMacOsTextInput(
      {
        defaultPrevented: false,
        data: null,
        inputType: 'insertText',
      },
      true,
    ),
    false,
  )
})
