import test from 'node:test'
import assert from 'node:assert/strict'
import * as macOsWebKitImeWorkaround from '../src/features/terminal/macos-webkit-ime-workaround.js'
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

test('defers shifted ASCII symbols with keyCode 229 to the native fallback in WKWebView', () => {
  // WKWebView can report Shift+2 -> '!' as keyCode 229. Because xterm drops this,
  // we must bypass xterm and let the native input fallback handle it.
  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keydown',
        key: '!',
        keyCode: 229,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: true,
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
        key: '#',
        keyCode: 229,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: true,
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
        key: '$',
        keyCode: 229,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        isComposing: false,
      },
      true,
    ),
    true,
  )
})

test('keeps xterm key handling for control shortcuts and navigation keys even if keyCode is 229', () => {
  assert.equal(
    shouldBypassXtermTextKeyEvent(
      {
        type: 'keydown',
        key: 'Backspace',
        keyCode: 229,
        ctrlKey: false,
        metaKey: false,
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

test('only defers broken WKWebView composition key signatures and keeps normal composing keys on xterm path', () => {
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
    false,
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

test('forwards deferred macOS text input from insertFromComposition events in WKWebView', () => {
  assert.equal(
    shouldForwardDeferredMacOsTextInput(
      {
        defaultPrevented: false,
        data: '中',
        inputType: 'insertFromComposition',
      },
      true,
    ),
    true,
  )

  assert.equal(
    shouldForwardDeferredMacOsTextInput(
      {
        defaultPrevented: true,
        data: '中',
        inputType: 'insertFromComposition',
      },
      true,
    ),
    false,
  )
})

test('skips deferred native forwarding when xterm already emitted the same committed text', () => {
  assert.equal(Reflect.has(macOsWebKitImeWorkaround, 'shouldSkipDeferredMacOsTextInput'), true)

  const shouldSkipDeferredMacOsTextInput = Reflect.get(
    macOsWebKitImeWorkaround,
    'shouldSkipDeferredMacOsTextInput',
  ) as ((eventData: string | null, xtermData: string | null) => boolean)

  assert.equal(shouldSkipDeferredMacOsTextInput('，', '，'), true)
  assert.equal(shouldSkipDeferredMacOsTextInput('。', '，'), false)
  assert.equal(shouldSkipDeferredMacOsTextInput('，', null), false)
  assert.equal(shouldSkipDeferredMacOsTextInput(null, '，'), false)
})

test('skips deferred native forwarding when xterm data contains or overlaps with event data', () => {
  const shouldSkipDeferredMacOsTextInput = Reflect.get(
    macOsWebKitImeWorkaround,
    'shouldSkipDeferredMacOsTextInput',
  ) as ((eventData: string | null, xtermData: string | null) => boolean)

  // xterm consumed more data that includes the event data.
  assert.equal(shouldSkipDeferredMacOsTextInput('中', '中文'), true)
  // Event data suffix matches xterm data.
  assert.equal(shouldSkipDeferredMacOsTextInput('中文', '文'), true)
  // No overlap.
  assert.equal(shouldSkipDeferredMacOsTextInput('中', '文'), false)
})

test('preserves xterm helper textarea state when forwarding deferred macOS text input', () => {
  assert.equal(Reflect.has(macOsWebKitImeWorkaround, 'resolveDeferredMacOsTextInputHandling'), true)

  const resolveDeferredMacOsTextInputHandling = Reflect.get(
    macOsWebKitImeWorkaround,
    'resolveDeferredMacOsTextInputHandling',
  ) as ((input: {
    event: {
      defaultPrevented: boolean
      data: string | null
      inputType: string
    }
    isMacOsWebKitEnvironment: boolean
    textareaValue: string
    xtermData: string | null
  }) => {
    action: 'pending' | 'reset' | 'forward'
    text: string | null
    nextTextareaValue: string
  })

  assert.deepEqual(
    resolveDeferredMacOsTextInputHandling({
      event: {
        defaultPrevented: false,
        data: '中',
        inputType: 'insertFromComposition',
      },
      isMacOsWebKitEnvironment: true,
      textareaValue: '中',
      xtermData: null,
    }),
    {
      action: 'forward',
      text: '中',
      nextTextareaValue: '中',
    },
  )
})

test('preserves xterm helper textarea state when deferred macOS text input was already consumed by xterm', () => {
  const resolveDeferredMacOsTextInputHandling = Reflect.get(
    macOsWebKitImeWorkaround,
    'resolveDeferredMacOsTextInputHandling',
  ) as ((input: {
    event: {
      defaultPrevented: boolean
      data: string | null
      inputType: string
    }
    isMacOsWebKitEnvironment: boolean
    textareaValue: string
    xtermData: string | null
  }) => {
    action: 'pending' | 'reset' | 'forward'
    text: string | null
    nextTextareaValue: string
  })

  assert.deepEqual(
    resolveDeferredMacOsTextInputHandling({
      event: {
        defaultPrevented: false,
        data: '，',
        inputType: 'insertText',
      },
      isMacOsWebKitEnvironment: true,
      textareaValue: '，',
      xtermData: '，',
    }),
    {
      action: 'reset',
      text: null,
      nextTextareaValue: '，',
    },
  )
})

test('strips late xterm echo after native macOS forwarding', () => {
  assert.equal(Reflect.has(macOsWebKitImeWorkaround, 'consumeDeferredMacOsXtermEcho'), true)

  const consumeDeferredMacOsXtermEcho = Reflect.get(
    macOsWebKitImeWorkaround,
    'consumeDeferredMacOsXtermEcho',
  ) as ((pendingEcho: string | null, xtermData: string | null) => {
    remainingEcho: string | null
    forwardedData: string | null
  })

  assert.deepEqual(consumeDeferredMacOsXtermEcho('中', '中'), {
    remainingEcho: null,
    forwardedData: null,
  })
  assert.deepEqual(consumeDeferredMacOsXtermEcho('中', '中文'), {
    remainingEcho: null,
    forwardedData: '文',
  })
  assert.deepEqual(consumeDeferredMacOsXtermEcho('中文', '中'), {
    remainingEcho: '文',
    forwardedData: null,
  })
  assert.deepEqual(consumeDeferredMacOsXtermEcho('文', '文'), {
    remainingEcho: null,
    forwardedData: null,
  })
  assert.deepEqual(consumeDeferredMacOsXtermEcho('中', '文'), {
    remainingEcho: null,
    forwardedData: '文',
  })
})
