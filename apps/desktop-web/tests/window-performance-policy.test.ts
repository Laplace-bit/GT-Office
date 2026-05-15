import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveWindowPerformancePolicy,
} from '../src/shell/layout/window-performance-policy.js'

test('uses native decorations and conservative polling on linux', () => {
  assert.deepEqual(
    resolveWindowPerformancePolicy({
      tauriRuntime: true,
      isMacOs: false,
      isLinux: true,
    }),
    {
      platform: 'linux',
      useCustomWindowChrome: false,
      shouldUseNativeDecorations: true,
    },
  )
})

test('preserves custom chrome on macos', () => {
  assert.deepEqual(
    resolveWindowPerformancePolicy({
      tauriRuntime: true,
      isMacOs: true,
      isLinux: false,
      performanceDebugEnabled: false,
    }),
    {
      platform: 'macos',
      useCustomWindowChrome: true,
      shouldUseNativeDecorations: true,
    },
  )
})

test('uses conservative live-station polling when performance debug is enabled on macos', () => {
  assert.deepEqual(
    resolveWindowPerformancePolicy({
      tauriRuntime: true,
      isMacOs: true,
      isLinux: false,
      performanceDebugEnabled: true,
    }),
    {
      platform: 'macos',
      useCustomWindowChrome: true,
      shouldUseNativeDecorations: true,
    },
  )
})

test('preserves custom chrome on windows', () => {
  assert.deepEqual(
    resolveWindowPerformancePolicy({
      tauriRuntime: true,
      isMacOs: false,
      isLinux: false,
    }),
    {
      platform: 'windows',
      useCustomWindowChrome: true,
      shouldUseNativeDecorations: false,
    },
  )
})

test('uses web defaults outside tauri runtime', () => {
  assert.deepEqual(
    resolveWindowPerformancePolicy({
      tauriRuntime: false,
      isMacOs: false,
      isLinux: false,
    }),
    {
      platform: 'web',
      useCustomWindowChrome: false,
      shouldUseNativeDecorations: false,
    },
  )
})
