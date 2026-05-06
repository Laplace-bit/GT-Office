export type WindowPlatform = 'macos' | 'linux' | 'windows' | 'web'

export interface WindowPerformancePolicyInput {
  tauriRuntime: boolean
  isMacOs: boolean
  isLinux: boolean
  performanceDebugEnabled?: boolean
}

export interface WindowPerformancePolicy {
  platform: WindowPlatform
  useCustomWindowChrome: boolean
  shouldUseNativeDecorations: boolean
}

export function resolveWindowPerformancePolicy(
  input: WindowPerformancePolicyInput,
): WindowPerformancePolicy {
  if (!input.tauriRuntime) {
    return {
      platform: 'web',
      useCustomWindowChrome: false,
      shouldUseNativeDecorations: false,
    }
  }

  if (input.isMacOs) {
    return {
      platform: 'macos',
      useCustomWindowChrome: true,
      shouldUseNativeDecorations: true,
    }
  }

  if (input.isLinux) {
    return {
      platform: 'linux',
      useCustomWindowChrome: false,
      shouldUseNativeDecorations: true,
    }
  }

  return {
    platform: 'windows',
    useCustomWindowChrome: true,
    shouldUseNativeDecorations: false,
  }
}
